// Aprovação automática de PCs avulsos pelo Agente IA (06/10/26, pedido do Benny).
//
// Regra (fonte única: orders.compras_auto_aprov_candidatos — sql/90):
//   PC de Operação › Vendas avulsas, incluído nos últimos 30 dias, ainda pendente,
//   valor ≤ RC que atende e condição de pagamento FATURADA (prazo depois da NF).
// Quem aprova fica registrado como "Agente IA". Roda 3× ao dia (cron 08h/12h/17h
// de Brasília), pelo botão "Aprovação automática (IA)" em Compras e pelo Cesar.
// Idempotente: só toca o que continua pendente; nunca reaprova nem desfaz.
//
// PC de PROJETO (07/10/26, decisão do Benny): a mesma regra da aprovação manual
// de projeto — fluxo aprovado e o projeto inteiro cabendo no budget de materiais
// (lib/aprovacao-projeto-regra). Sem comparação item a item. Estourou ou sem fluxo
// aprovado → fica pendente para os administradores, com o motivo no log.
// Nada é gravado no Omie.
import { randomUUID } from "node:crypto";
import { rpc, posGravar } from "@/lib/compras-server";
import { postWebexMessage, buildApprovalMarkdown } from "@/lib/webex";
import { contextoProjeto, avaliarComContexto } from "@/lib/aprovacao-projeto";
import { ehProjetoDeObra } from "@/lib/aprovacao-projeto-regra";

export const AGENTE_IA = "Aria";

export type CandidatoIA = {
  empresa: string; pc: string; pedido_id: number | null; origem: string | null; ncods: number[];
  fornecedor: string | null; valor_pc: number | null; cmp_pc: number | null; cmp_rc: number | null;
  base: "itens" | "venda" | "projeto"; condicao: string | null; faturada: boolean; pv_os: string | null; projeto: string | null;
  incluido: string | null; pendente: boolean; elegivel: boolean; motivo: string;
};

export type LinhaRodada = CandidatoIA & { decisao: "aprovado" | "elegivel" | "pulado" | "falhou"; detalhe?: string };

/** Só os PCs ainda pendentes (os já decididos ficam fora da lista e do log). */
export async function candidatosIA(dias = 30): Promise<CandidatoIA[]> {
  const todos = await rpc<CandidatoIA[]>("compras_auto_aprov_candidatos", { p_dias: dias });
  const avulsos = (todos ?? []).filter((c) => c.pendente);
  const jaTem = new Set(avulsos.map((c) => `${c.empresa}|${c.pc}`));
  const projeto = await candidatosProjetoIA(dias).catch(() => [] as CandidatoIA[]);
  return [...avulsos, ...projeto.filter((c) => !jaTem.has(`${c.empresa}|${c.pc}`))];
}

type PedLista = { id: number; tipo: string; num: string; emp: string; aprov: string; proj?: string | null; emissao?: string | null };
type PedCompleto = { id: number; num: string; emp: string; origem: string; projCod?: number | null; proj?: string | null; forn?: string | null;
  parc?: string | null; pv?: string | null; valor?: number | null; ncodPed?: number | null; emissao?: string | null; aprov?: string | null };

/** PCs de projeto pendentes nos últimos `dias`, avaliados pela regra do projeto. */
export async function candidatosProjetoIA(dias = 30): Promise<CandidatoIA[]> {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const lista = ((await rpc<PedLista[]>("compras_lista", { p_desde: desde })) ?? [])
    .filter((p) => p.tipo === "PC" && (p.aprov === "aguardando" || p.aprov === "nao_solicitada") && ehProjetoDeObra(p.proj)
      && (!p.emissao || p.emissao >= desde));
  const ctxs = new Map<string, Awaited<ReturnType<typeof contextoProjeto>>>();
  const out: CandidatoIA[] = [];
  for (const l of lista.slice(0, 80)) {
    const p = await rpc<PedCompleto | null>("compras_pedido", { p_id: l.id }).catch(() => null);
    if (!p?.projCod) continue;
    const chave = `${p.emp}|${p.projCod}`;
    let ctx = ctxs.get(chave);
    if (!ctx) { ctx = await contextoProjeto(p.emp, Number(p.projCod)); ctxs.set(chave, ctx); }
    const av = avaliarComContexto(ctx, p.num, Number(p.valor) || 0);
    out.push({
      empresa: p.emp, pc: p.num, pedido_id: p.id, origem: p.origem, ncods: p.ncodPed ? [Number(p.ncodPed)] : [],
      fornecedor: p.forn ?? null, valor_pc: av.valorPc, cmp_pc: av.total, cmp_rc: av.teto, base: "projeto",
      condicao: p.parc ?? null, faturada: false, pv_os: p.pv ?? null, projeto: p.proj ?? null, incluido: p.emissao ?? null,
      pendente: true, elegivel: av.aprova, motivo: av.aprova ? av.motivo : `projeto: ${av.motivo}`,
    });
  }
  return out;
}

/** Simula (aplicar=false) ou aprova os elegíveis. Sempre grava o log da rodada. */
export async function rodarAprovacaoIA(opts: { aplicar: boolean; disparo: string; dias?: number }) {
  const rodada = randomUUID();
  const lista = await candidatosIA(opts.dias ?? 30);
  const linhas: LinhaRodada[] = [];
  for (const c of lista) {
    if (!c.elegivel) { linhas.push({ ...c, decisao: "pulado" }); continue; }
    if (!opts.aplicar) { linhas.push({ ...c, decisao: "elegivel" }); continue; }
    try {
      await aprovar(c);
      linhas.push({ ...c, decisao: "aprovado" });
    } catch (e) {
      linhas.push({ ...c, decisao: "falhou", detalhe: (e as Error).message });
    }
  }
  await rpc("compras_auto_aprov_log", {
    p: linhas.map((l) => ({
      rodada, modo: opts.aplicar ? "aplicado" : "simulacao", disparo: opts.disparo,
      empresa: l.empresa, pc: l.pc, origem: l.origem, pedido_id: l.pedido_id, fornecedor: l.fornecedor,
      cmp_pc: l.cmp_pc, cmp_rc: l.cmp_rc, base: l.base, condicao: l.condicao, pv_os: l.pv_os, projeto: l.projeto,
      decisao: l.decisao, motivo: l.detalhe ? `${l.motivo} — ${l.detalhe}` : l.motivo,
    })),
  }).catch(() => null);
  if (opts.aplicar) await enviarWebexPendentes().catch(() => null);
  return {
    rodada, modo: opts.aplicar ? "aplicado" : "simulacao",
    aprovados: linhas.filter((l) => l.decisao === "aprovado").length,
    elegiveis: linhas.filter((l) => l.decisao === "elegivel" || l.decisao === "aprovado").length,
    pulados: linhas.filter((l) => l.decisao === "pulado").length,
    falhas: linhas.filter((l) => l.decisao === "falhou").length,
    linhas,
  };
}

async function aprovar(c: CandidatoIA) {
  const valor = Number(c.valor_pc) || null;
  if (c.origem === "painel") {
    if (!c.pedido_id) throw new Error("PC sem cadastro em Compras");
    const r = await rpc<{ alterados?: number; bloqueados?: { erro: string }[] }>("compras_aprovar",
      { p_ids: [c.pedido_id], p_status: "aprovado", p_por: AGENTE_IA });
    if (r?.bloqueados?.length) throw new Error(r.bloqueados[0].erro);
  } else {
    // PC do Omie: as linhas da venda em approval.approvals (o que a tela lê)…
    const n = await rpc<number>("compras_auto_aprov_omie",
      { p_empresa: c.empresa, p_ncods: c.ncods, p_valor: valor, p_por: AGENTE_IA });
    if (!n) throw new Error("nada a aprovar (já decidido por outra pessoa)");
    // …e o espelho em Compras, se houver.
    if (c.pedido_id) await rpc("compras_aprovar", { p_ids: [c.pedido_id], p_status: "aprovado", p_por: AGENTE_IA }).catch(() => null);
  }
  if (c.pedido_id) {
    await rpc("compras_registrar", { p_id: c.pedido_id, p_texto: `Aprovado automaticamente pela Aria — ${c.motivo}`, p_por: AGENTE_IA }).catch(() => null);
    await posGravar(c.pedido_id).catch(() => null);
  }
}

export async function ultimasRodadasIA(limite = 200) {
  return rpc<Record<string, unknown>[]>("compras_auto_aprov_ultimas", { p_limite: limite });
}

/** Cartão no Webex "Pedidos Aprovados!" de cada PC aprovado pela Aria que ainda não foi
 *  anunciado (inclui aprovações feitas fora da rotina). Roda no fim de toda rodada. */
export async function enviarWebexPendentes() {
  const pend = await rpc<{ id: number; pc: string; fornecedor: string | null; condicao: string | null; valor_pc: number | null;
    projeto: string | null; pv_os: string | null; motivo: string | null }[]>("compras_auto_aprov_webex_pendentes", { p_dias: 2 });
  const ok: number[] = [];
  for (const c of pend ?? []) {
    const r = await postWebexMessage(buildApprovalMarkdown({
      pc_numero: c.pc, nome_fornecedor: c.fornecedor, pc_forma_pagamento: c.condicao, valor: Number(c.valor_pc) || null,
      projeto_nome: c.projeto, pv_os_label: c.pv_os, aprovador_email: `Aria (aprovação automática) — ${c.motivo ?? ""}`,
      status_label: "Aprovado",
    })).catch(() => ({ ok: false }));
    if ((r as { ok?: boolean }).ok) ok.push(c.id);
  }
  if (ok.length) await rpc("compras_auto_aprov_webex_ok", { p_ids: ok });
  return { enviados: ok.length, pendentes: (pend ?? []).length };
}
