/**
 * Estoque v2 — tipos e regras da lista e da ficha do item (fase 1, só leitura).
 * Porte das regras do mockup web/docs/mockups/estoque-ficha-item (branch mockup/estoque-v2).
 *
 * SALDO: a tela nunca recalcula saldo. O número vem pronto de orders.v_estoque_saldo_local
 * (via v_estoque_item.saldo e .locais[].saldo) = espelho do Omie + ajustes do painel.
 * Na fase 3 (ajuste SÓ no painel, nunca enviado ao Omie) muda a view; aqui, só os rótulos
 * "saldo do Omie × ajustado" passam a aparecer porque saldo_omie/ajuste já vêm no JSON.
 */

export type Tom = "ok" | "warn" | "crit" | "info" | "violet" | "off";

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

export type LocalEstoque = { local: string; saldo: number; saldo_omie: number; ajuste: number; pendente: number; reservado: number; cmc: number };

export type ItemEstoque = {
  empresa: string; n_cod_prod: number; codigo: string; descricao: string; unidade: string; ncm: string | null;
  saldo: number; saldo_omie: number; ajuste: number; fisico: number; reservado: number; pendente: number; cmc: number;
  estoque_minimo: number; data_posicao: string | null; locais: LocalEstoque[]; n_locais: number; local_negativo: boolean;
  consumo_90d: number; ult_mov: string | null; n_mov: number; pcs_velhos: number; rec_a_mais: number; ult_pc: string | null;
  duplicidade: boolean;
  familia: string | null; codigo_familia: number | null;
  /** Se este código foi mesclado em outro (fica fora da lista; a ficha mostra o aviso). */
  mesclado_em: number | null; mesclado_em_codigo: string | null;
  /** Painel: família com prefixo, código novo (F0001) e o do Omie ao lado; apelidos depois de recodificar. */
  familia_id: number | null; familia_prefixo: string | null; familia_material: boolean | null;
  codigo_novo: string | null; codigo_omie: string | null; codigos_antigos: string[];
  cadastro_id: number | null; ean: string | null; preco_ref: number | null; local_padrao: string | null;
  alarme_minimo: number | null; alarme_ponto_pedido: number | null; alarme_maximo: number | null;
  foto_url: string | null; cadastro_obs: string | null; ativo: boolean;
  omie_status: "nao_enviado" | "ok" | "erro" | "desligado" | null; omie_erro: string | null;
};

export type AjusteEstoque = {
  id: number; empresa: string; n_cod_prod: number; codigo_local_estoque: string; tipo: "inventario" | "mesclagem";
  janela_id: number | null; mescla_id: number | null; saldo_antes: number; contagem: number; diferenca: number;
  cmc: number; valor: number; motivo: string; obs: string | null; status: "aplicado" | "revertido";
  revisao: "pendente" | "conferido" | "contestado"; revisado_por_email: string | null; revisado_em: string | null;
  revertido_por_email: string | null; revertido_em: string | null; created_by_email: string | null; created_at: string;
};

export type JanelaInventario = {
  id: number; nome: string; escopo: { familia?: string; local?: string }; valida_ate: string; revogada_em: string | null;
  revogada_por_email?: string | null; created_by_email?: string | null; created_at?: string;
};

export function normAjuste(r: Record<string, unknown>): AjusteEstoque {
  return {
    id: n(r.id), empresa: String(r.empresa), n_cod_prod: n(r.n_cod_prod), codigo_local_estoque: String(r.codigo_local_estoque),
    tipo: r.tipo as AjusteEstoque["tipo"], janela_id: r.janela_id != null ? n(r.janela_id) : null, mescla_id: r.mescla_id != null ? n(r.mescla_id) : null,
    saldo_antes: n(r.saldo_antes), contagem: n(r.contagem), diferenca: n(r.diferenca), cmc: n(r.cmc), valor: n(r.valor),
    motivo: String(r.motivo ?? ""), obs: (r.obs as string) ?? null, status: r.status as AjusteEstoque["status"],
    revisao: r.revisao as AjusteEstoque["revisao"], revisado_por_email: (r.revisado_por_email as string) ?? null,
    revisado_em: (r.revisado_em as string) ?? null, revertido_por_email: (r.revertido_por_email as string) ?? null,
    revertido_em: (r.revertido_em as string) ?? null, created_by_email: (r.created_by_email as string) ?? null, created_at: String(r.created_at),
  };
}

export type MovEstoque = {
  id_mov: number; dt_mov: string; des_origem: string | null; tipo: string | null; qtde: number; valor: number; saldo: number;
  cmc: number; doc: string | null; num_pedido: string | null; codigo_local_estoque: string; cancelado: boolean;
  pv_numero: string | null; cliente: string | null; projeto: string | null; id_prod?: number;
};

export type PcItem = {
  pedido_id: number; numero: string; emissao: string | null; etapa: string | null; origem: string | null;
  fornecedor: string | null; projeto: string | null; dt_rec: string | null; qtd: number; qtd_recebida: number; valor_unit: number;
  /** PC de um código mesclado neste (a ficha do principal traz o histórico dos mesclados). */
  de_codigo?: string | null;
};

export type ParDup = { empresa: string; prod_a: number; prod_b: number; tipo: "exata" | "similar"; sim: number; chave: string | null };

export function normItem(r: Record<string, unknown>): ItemEstoque {
  const locais = (Array.isArray(r.locais) ? r.locais : []) as Record<string, unknown>[];
  return {
    empresa: String(r.empresa), n_cod_prod: n(r.n_cod_prod), codigo: String(r.codigo ?? r.n_cod_prod),
    descricao: String(r.descricao ?? ""), unidade: String(r.unidade || "UN"), ncm: (r.ncm as string) || null,
    saldo: n(r.saldo), saldo_omie: n(r.saldo_omie), ajuste: n(r.ajuste), fisico: n(r.fisico), reservado: n(r.reservado),
    pendente: n(r.pendente), cmc: n(r.cmc), estoque_minimo: n(r.estoque_minimo), data_posicao: (r.data_posicao as string) || null,
    locais: locais.map((l) => ({ local: String(l.local), saldo: n(l.saldo), saldo_omie: n(l.saldo_omie), ajuste: n(l.ajuste),
      pendente: n(l.pendente), reservado: n(l.reservado), cmc: n(l.cmc) })),
    n_locais: n(r.n_locais), local_negativo: !!r.local_negativo, consumo_90d: n(r.consumo_90d),
    ult_mov: (r.ult_mov as string) || null, n_mov: n(r.n_mov), pcs_velhos: n(r.pcs_velhos), rec_a_mais: n(r.rec_a_mais),
    ult_pc: (r.ult_pc as string) || null, duplicidade: !!r.duplicidade,
    familia: (r.familia as string) || null, codigo_familia: r.codigo_familia != null ? n(r.codigo_familia) : null,
    mesclado_em: r.mesclado_em != null ? n(r.mesclado_em) : null, mesclado_em_codigo: (r.mesclado_em_codigo as string) || null,
    familia_id: r.familia_id != null ? n(r.familia_id) : null, familia_prefixo: (r.familia_prefixo as string) || null,
    familia_material: r.familia_material == null ? null : !!r.familia_material,
    codigo_novo: (r.codigo_novo as string) || null, codigo_omie: (r.codigo_omie as string) || null,
    codigos_antigos: Array.isArray(r.codigos_antigos) ? (r.codigos_antigos as string[]) : [],
    cadastro_id: r.cadastro_id != null ? n(r.cadastro_id) : null, ean: (r.ean as string) || null,
    preco_ref: r.preco_ref != null ? n(r.preco_ref) : null, local_padrao: r.local_padrao != null ? String(r.local_padrao) : null,
    alarme_minimo: r.alarme_minimo != null ? n(r.alarme_minimo) : null, alarme_ponto_pedido: r.alarme_ponto_pedido != null ? n(r.alarme_ponto_pedido) : null,
    alarme_maximo: r.alarme_maximo != null ? n(r.alarme_maximo) : null, foto_url: (r.foto_url as string) || null,
    cadastro_obs: (r.cadastro_obs as string) || null, ativo: r.ativo !== false,
    omie_status: (r.omie_status as ItemEstoque["omie_status"]) ?? null, omie_erro: (r.omie_erro as string) || null,
  };
}

export function normMov(r: Record<string, unknown>): MovEstoque {
  return {
    id_mov: n(r.id_mov), dt_mov: String(r.dt_mov ?? ""), des_origem: (r.des_origem as string) ?? null, tipo: (r.tipo as string) ?? null,
    qtde: n(r.qtde), valor: n(r.valor), saldo: n(r.saldo), cmc: n(r.cmc), doc: (r.doc as string) ?? null,
    num_pedido: (r.num_pedido as string) ?? null, codigo_local_estoque: String(r.codigo_local_estoque ?? ""),
    cancelado: !!r.cancelado, pv_numero: (r.pv_numero as string) ?? null, cliente: (r.cliente as string) ?? null,
    projeto: (r.projeto as string) ?? null, id_prod: r.id_prod != null ? n(r.id_prod) : undefined,
  };
}

export function normPc(r: Record<string, unknown>): PcItem {
  return {
    pedido_id: n(r.pedido_id), numero: String(r.numero ?? ""), emissao: (r.emissao as string) ?? null, etapa: (r.etapa as string) ?? null,
    origem: (r.origem as string) ?? null, fornecedor: (r.fornecedor as string) ?? null, projeto: (r.projeto as string) ?? null,
    dt_rec: (r.dt_rec as string) ?? null, qtd: n(r.qtd), qtd_recebida: n(r.qtd_recebida), valor_unit: n(r.valor_unit),
    de_codigo: (r.de_codigo as string) ?? null,
  };
}

// ── Datas e locais ───────────────────────────────────────────────────────────
export const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export const somaDias = (iso: string, d: number) => new Date(new Date(iso + "T12:00:00Z").getTime() + d * 864e5).toISOString().slice(0, 10);
export const dias = (iso: string | null | undefined) =>
  iso ? Math.round((new Date(hoje() + "T12:00:00Z").getTime() - new Date(iso.slice(0, 10) + "T12:00:00Z").getTime()) / 864e5) : null;

const LOCAIS: Record<string, string> = { "2264756939": "Principal", "12172796544": "Local 2" };
export const nomeLocal = (l: string | number | null | undefined) => (l == null ? "—" : LOCAIS[String(l)] ?? `Local ${l}`);

// ── Regras ───────────────────────────────────────────────────────────────────
export const consumoDia = (p: ItemEstoque) => p.consumo_90d / 90;
export const valorItem = (p: ItemEstoque) => Math.max(p.saldo, 0) * p.cmc;
export function cobertura(p: ItemEstoque): number | null {
  const cd = consumoDia(p);
  if (!cd) return null;
  return p.saldo <= 0 ? 0 : Math.round(p.saldo / cd);
}
export const parado = (p: ItemEstoque) => p.saldo > 0 && (dias(p.ult_mov) ?? 9999) > 180;

export function situacao(p: ItemEstoque): [string, Tom] {
  if (consumoDia(p) && p.saldo <= 0) return ["Ruptura", "crit"];
  if (p.saldo < 0) return ["Negativo", "violet"];
  const c = cobertura(p);
  if (c !== null && c < 30) return ["Cobertura baixa", "warn"];
  if (parado(p)) return ["Parado", "off"];
  if (p.saldo === 0) return ["Zerado", "off"];
  return ["Saudável", "ok"];
}

/** Alarme por peça chega na fase 2 (platform.estoque_alarme). Até lá: sem alarme. */
/** Alarme por peça (mínimo / ponto de pedido / máximo do cadastro do item no painel). */
export const temAlarme = (p: ItemEstoque) => p.alarme_minimo != null;
export function alarme(p: ItemEstoque): [string, Tom] {
  if (!temAlarme(p)) return ["sem alarme", "off"];
  const mn = p.alarme_minimo ?? 0, pp = p.alarme_ponto_pedido ?? mn, mx = p.alarme_maximo;
  const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  if (p.saldo <= mn) return [`abaixo do mín. ${NUM.format(mn)}`, "crit"];
  if (p.saldo <= pp) return [`pedir (≤ ${NUM.format(pp)})`, "warn"];
  if (mx != null && p.saldo > mx) return [`acima do máx. ${NUM.format(mx)}`, "violet"];
  return ["alarme ok", "ok"];
}
/** Código para mostrar: o novo do painel (se já gerado) e o do Omie ao lado. */
export const codigos = (p: ItemEstoque) => (p.codigo_novo ? `${p.codigo_novo} · Omie ${p.codigo_omie ?? p.codigo}` : p.codigo);
/** Texto para busca: descrição + todos os códigos (Omie, novo, antigos). */
export const textoBusca = (p: ItemEstoque) => [p.descricao, p.codigo, p.codigo_novo, p.codigo_omie, ...p.codigos_antigos].filter(Boolean).join(" ");

/**
 * Sinais de auditoria que a LISTA consegue ver só com v_estoque_item (sem Kardex nem preços).
 * A ficha roda a auditoria completa (auditoria()), que inclui quebra de Kardex e preço fora da curva.
 */
export function alertasLista(p: ItemEstoque): number {
  let k = 0;
  if (p.saldo < 0) k++;
  else if (p.local_negativo && p.n_locais > 1) k++;
  if (p.pcs_velhos > 0) k++;
  if (p.rec_a_mais > 0) k++;
  if (p.duplicidade) k++;
  if (consumoDia(p) > 0 && !temAlarme(p)) k++;
  if (p.saldo > 0 && p.cmc === 0) k++;
  return k;
}

/** Chave do saldo corrente no Kardex: produto + local (a ficha de um principal traz o Kardex dos mesclados). */
export const chaveSaldo = (m: MovEstoque) => `${m.id_prod ?? ""}:${m.codigo_local_estoque}`;

/** Quebras de sequência no Kardex: saldo anterior (do mesmo produto e local) + qtde ≠ saldo. Índices em movs. */
export function quebras(movs: MovEstoque[]): Set<number> {
  const ult: Record<string, number> = {}, out = new Set<number>();
  movs.forEach((m, i) => {
    if (m.cancelado) return;
    const l = chaveSaldo(m);
    if (ult[l] != null && Math.abs(ult[l] + m.qtde - m.saldo) > 0.001) out.add(i);
    ult[l] = m.saldo;
  });
  return out;
}

export type PontoAuditoria = {
  tom: Tom; icone: string; titulo: string; detalhe: string;
  acao?: { rotulo: string; aba?: AbaFicha; emBreve?: boolean; ajustar?: boolean };
};
export type AbaFicha = "uso" | "mov" | "compras" | "forn" | "auditoria";

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const q = (v: number) => NUM.format(v || 0);
const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmmaa = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");

/** PC ainda a receber: não recebido/conferido no painel e quantidade recebida menor que a pedida. */
export const pcAberto = (x: PcItem) => !["60", "80"].includes(x.etapa ?? "") && !x.dt_rec && x.qtd_recebida < x.qtd;

/** Auditoria completa da ficha — mesmas verificações do mockup (exceto as que dependem de alarme/ajuste, fases 2–3). */
export function auditoria(p: ItemEstoque, movs: MovEstoque[], pcs: PcItem[], temDup: boolean): PontoAuditoria[] {
  const pts: PontoAuditoria[] = [], s = p.saldo, u = p.unidade.toLowerCase();
  const negLoc = p.locais.filter((l) => l.saldo < 0);
  if (s >= 0 && negLoc.length && p.locais.length > 1)
    pts.push({ tom: "crit", icone: "alerta", titulo: `Saldo negativo no ${nomeLocal(negLoc[0].local)}`,
      detalhe: `${q(negLoc[0].saldo)} ${u} — o total parece certo, mas um local está negativo. Provável transferência entre locais não lançada.`,
      acao: { rotulo: "Ajustar local", ajustar: true } });
  if (s < 0)
    pts.push({ tom: "crit", icone: "alerta", titulo: "Saldo negativo",
      detalhe: `Saldo ${q(s)} ${u} — fisicamente impossível. Faça a contagem e ajuste.`, acao: { rotulo: "Ajustar saldo", ajustar: true } });
  const qb = quebras(movs);
  if (qb.size) {
    const m = movs[[...qb][0]];
    pts.push({ tom: "crit", icone: "quebra", titulo: `Saldo não fecha em ${qb.size} movimento${qb.size > 1 ? "s" : ""}`,
      detalhe: `Primeiro em ${ddmmaa(m.dt_mov)}: ${m.des_origem ?? ""} ${m.doc ?? ""} (${m.qtde > 0 ? "+" : ""}${q(m.qtde)}) registrou saldo ${q(m.saldo)}. Indica lançamento retroativo ou fora de ordem no Omie.`,
      acao: { rotulo: "Ver no Kardex", aba: "mov" } });
  }
  const meus = movs.filter((m) => m.id_prod == null || m.id_prod === p.n_cod_prod);
  if (meus.length) {
    const ultLoc: Record<string, number> = {};
    meus.forEach((m) => { if (!m.cancelado) ultLoc[m.codigo_local_estoque] = m.saldo; });
    const k = Object.values(ultLoc).reduce((a, b) => a + b, 0);
    if (Math.abs(k - p.saldo_omie) > 0.001 && Object.keys(ultLoc).length === p.locais.length)
      pts.push({ tom: "warn", icone: "soma", titulo: "Posição ≠ último saldo do Kardex",
        detalhe: `Posição do Omie ${q(p.saldo_omie)} × último saldo dos movimentos ${q(k)}.` });
  }
  const H = hoje(), ano = somaDias(H, -365);
  const rec = pcs.filter((x) => x.valor_unit > 0 && (x.emissao ?? "") >= ano).map((x) => x.valor_unit).sort((a, b) => a - b);
  if (rec.length >= 3) {
    const med = rec[Math.floor(rec.length / 2)];
    const fora = pcs.filter((x) => x.valor_unit > 0 && (x.emissao ?? "") >= ano && (x.valor_unit < med * 0.6 || x.valor_unit > med * 1.5));
    if (fora.length)
      pts.push({ tom: "warn", icone: "preco", titulo: `${fora.length} preço${fora.length > 1 ? "s" : ""} fora da curva`,
        detalhe: `Mediana de 12 meses ${brl(med)}. Ex.: PC ${fora[0].numero} a ${brl(fora[0].valor_unit)} (${ddmmaa(fora[0].emissao)}). Pode ser bonificação, erro de unidade ou digitação.`,
        acao: { rotulo: "Ver preços", aba: "forn" } });
  }
  const dois = somaDias(H, -730);
  const abertos = pcs.filter((x) => pcAberto(x) && (x.emissao ?? "") >= dois);
  const velhos = abertos.filter((x) => (dias(x.emissao) ?? 0) > 60);
  const qAb = abertos.reduce((a, x) => a + x.qtd - x.qtd_recebida, 0);
  if (velhos.length)
    pts.push({ tom: "warn", icone: "pc", titulo: `${velhos.length} PC${velhos.length > 1 ? "s" : ""} aberto${velhos.length > 1 ? "s" : ""} há mais de 60 dias`,
      detalhe: `Saldo a receber pelos PCs dos últimos 24 meses: ${q(qAb)} × pendente no Omie: ${q(p.pendente)}. Provavelmente PCs que nunca foram baixados ou cancelados.`,
      acao: { rotulo: "Ver PCs", aba: "compras" } });
  const amais = pcs.filter((x) => x.qtd_recebida > x.qtd);
  if (amais.length)
    pts.push({ tom: "warn", icone: "mais", titulo: "Recebido acima do pedido",
      detalhe: `PC ${amais[0].numero}: pedido ${q(amais[0].qtd)}, recebido ${q(amais[0].qtd_recebida)}.`, acao: { rotulo: "Ver PCs", aba: "compras" } });
  const semCli = movs.filter((m) => m.qtde < 0 && !m.cancelado && !m.cliente && m.dt_mov >= ano);
  if (semCli.length)
    pts.push({ tom: "info", icone: "semcli", titulo: `${semCli.length} saída${semCli.length > 1 ? "s" : ""} sem cliente (12 meses)`,
      detalhe: `${q(semCli.reduce((a, m) => a - m.qtde, 0))} ${u} saíram sem vínculo com pedido de venda (remessas, ajustes manuais). O cliente da remessa entra com o sync de remessas (fase 5).`,
      acao: { rotulo: "Ver usos", aba: "uso" } });
  if (temDup)
    pts.push({ tom: "warn", icone: "dup", titulo: "Possível duplicidade", detalhe: "Outro código com descrição igual ou muito parecida — veja na aba Duplicidades do Estoque." });
  if (consumoDia(p) > 0 && !temAlarme(p))
    pts.push({ tom: "warn", icone: "sino", titulo: "Sem alarme",
      detalhe: `Item com consumo de ${q(Math.round(consumoDia(p) * 30))} ${u}/mês e nenhum mínimo definido.`, acao: { rotulo: "Definir", emBreve: true } });
  if (s > 0 && p.cmc === 0)
    pts.push({ tom: "warn", icone: "zero", titulo: "CMC zerado", detalhe: "Item com saldo e custo médio zero — o valor do estoque fica subestimado." });
  if (parado(p))
    pts.push({ tom: "info", icone: "parado", titulo: "Parado", detalhe: `Sem movimento há ${dias(p.ult_mov) ?? "mais de 1000"} dias com ${brl(valorItem(p))} em estoque.` });
  if (!pts.some((x) => x.tom === "crit" || x.tom === "warn"))
    pts.push({ tom: "ok", icone: "ok", titulo: "Nada crítico", detalhe: "Saldo positivo, sequência do Kardex fecha e sem duplicidade." });
  return pts;
}

/** Preço por fornecedor (todo o histórico): PCs, mín, média, máx, última compra. */
export function precosPorFornecedor(pcs: PcItem[]) {
  const m = new Map<string, PcItem[]>();
  for (const x of pcs) if (x.valor_unit > 0) {
    const k = x.fornecedor || "(fornecedor não cadastrado)";
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return [...m.entries()].map(([fornecedor, l]) => {
    const vs = l.map((x) => x.valor_unit);
    return {
      fornecedor, n: l.length, min: Math.min(...vs), media: vs.reduce((a, b) => a + b, 0) / vs.length, max: Math.max(...vs),
      ultima: l.map((x) => x.emissao ?? "").sort().slice(-1)[0] || null,
    };
  }).sort((a, b) => b.n - a.n);
}

/** CSV com ; e BOM (abre direto no Excel em pt-BR). */
export function baixarCSV(nome: string, linhas: (string | number | null | undefined)[][]) {
  const csv = linhas.map((l) => l.map((v) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
