// POST /api/compras/acao — ações sobre requisições e pedidos:
//   mover      {id, etapa}                   etapa do Kanban (regras do Omie)
//   aprovar    {ids, status}                 aprovado | aguardando | nao_aprovado
//   receber    {id, nf, chave?, dt, qtds, final, chaveFocus?}
//   cancelar   {id}   ·  excluir {id}  ·  duplicar {id}
//   nf         {chave, pedido, status}       confirmar/descartar NF da Focus
//
// Pedido do painel: tudo grava em compras.*. Pedido importado do Omie
// (histórico): só leitura nos campos; aprovação continua pela rota de sempre
// (/api/approvals/set-status, com alçada e teto semanal) e etapa avança pela
// etapa_manual. Nada aqui chama o Omie.
import { postWebexMessage, buildApprovalMarkdown } from "@/lib/webex";
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, motivoNaoDecide, posGravar, type Quem } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { ordemEtapa, type Pedido } from "@/lib/compras";
import { aprovPainelExigeAprovador, acaoDoStatus } from "@/lib/aprovacao-permissao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_OMIE: Record<string, string> = { aprovado: "APROVADO", aguardando: "PENDENTE", nao_aprovado: "NAO_APROVADO" };

async function pedido(id: number) {
  const p = await rpc<Pedido | null>("compras_pedido", { p_id: id });
  if (!p) throw new Error(`Pedido ${id} não encontrado`);
  return p;
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  try {
    const r = await executar(q, req, b);
    // previsões a pagar e RCs na operação acompanham qualquer mudança
    const ids = [b.id, b.pedido, ...((b.ids as unknown[]) ?? []), (r as { id?: unknown })?.id].map(Number).filter(Boolean);
    for (const id of [...new Set(ids)]) await posGravar(id);
    return NextResponse.json(r);
  } catch (e) { return erro(e); }
}

async function executar(q: Quem, req: Request, b: Record<string, unknown>): Promise<unknown> {
  {
    switch (b.acao) {
      case "mover": return mover(q, Number(b.id), String(b.etapa));
      case "aprovar": return aprovar(q, req, (b.ids as number[]) ?? [], String(b.status));
      case "venda": return rpc("compras_vincular_venda", { p_id: Number(b.id), p_pv: String(b.pv ?? ""), p_cliente: String(b.cliente ?? ""), p_por: q.email });
      case "receber": {
        const p = await pedido(Number(b.id));
        if (p.tipo !== "PC") throw new Error("Só pedido de compra é recebido");
        if (b.chaveFocus) {
          await rpc("compras_nf_decidir", { p_chave: String(b.chaveFocus), p_pedido: p.id, p_status: "confirmado", p_por: q.email });
        }
        return rpc("compras_receber", {
          p_id: p.id, p_nf: String(b.nf ?? ""), p_chave: b.chave ? String(b.chave) : null,
          p_dt: String(b.dt ?? new Date().toISOString().slice(0, 10)), p_qtds: b.qtds ?? [], p_final: !!b.final, p_por: q.email,
        });
      }
      case "cancelar": return rpc("compras_cancelar", { p_id: Number(b.id), p_por: q.email });
      case "excluir": {
        // Exclusão definitiva (some sem rastro) só para admin; o time usa Cancelar.
        if (!q.perms.is_admin) throw new Error("Só administrador exclui; use Cancelar");
        return rpc("compras_excluir", { p_id: Number(b.id) });
      }
      case "duplicar": return rpc("compras_duplicar", { p_id: Number(b.id), p_por: q.email, p_uid: q.uid });
      case "nf": return rpc("compras_nf_decidir", {
        p_chave: String(b.chave), p_pedido: Number(b.pedido), p_status: String(b.status), p_por: q.email,
      });
      // NF ↔ pedido (caixa "NF sem pedido" e cartões do Faturado)
      case "nf_casar": return rpc("compras_nf_casar", { p_chave: String(b.chave), p_pedido: Number(b.pedido), p_por: q.email });
      case "nf_descasar": return rpc("compras_nf_descasar", { p_chave: String(b.chave), p_pedido: Number(b.pedido), p_por: q.email });
      case "nf_dispensar": {
        if (!q.pode["compras.dispensar_nf"]) throw new Error("Sem permissão para dispensar NF sem pedido");
        return rpc("compras_nf_dispensar", { p_chave: String(b.chave), p_motivo: String(b.motivo ?? ""), p_por: q.email });
      }
      default: throw new Error("ação inválida");
    }
  }
}

async function mover(q: Quem, id: number, etapa: string) {
  const p = await pedido(id);
  if (ordemEtapa(etapa) < 0) throw new Error("Etapa inválida");
  if (etapa === "80" && !q.pode["compras.conferir"]) throw new Error("Sem permissão para conferir e liberar pagamento");
  if (p.etapa === "20" && etapa !== "20") throw new Error("Requisição vira pedido pela folha (Gerar Pedido de Compra)");
  if (["40", "60", "80"].includes(etapa) && p.origem === "painel" && p.aprov !== "aprovado") {
    throw new Error("Pedido ainda não aprovado — aprove antes de avançar");
  }
  if (etapa === "60" && !p.nf) throw new Error("Registre o recebimento com a NF-e");
  if (etapa === "35") throw new Error("Não há mais etapa Enviado: aprovado = enviado ao fornecedor");
  if (["40", "60", "80"].includes(etapa) && p.aprov !== "aprovado") throw new Error("Só pedido aprovado avança para Faturado");
  if (etapa === "15" && p.origem === "painel" && p.tipo === "PC") {
    const v = await rpc<{ vinculoErro?: string | null; regraVinculo?: boolean } | null>("compras_vinculo", { p_id: id });
    if (v?.regraVinculo && v.vinculoErro) throw new Error(v.vinculoErro);
  }
  if (etapa === "15" && p.origem === "omie" && p.aprov !== "aprovado") {
    // Solicitar aprovação de pedido do Omie = status PENDENTE em approval.approvals.
    await gravarAprovacaoOmie(q, null, [p], "aguardando");
  }
  return rpc("compras_mover", { p_id: id, p_etapa: etapa, p_por: q.email });
}

async function aprovar(q: Quem, req: Request, ids: number[], status: string) {
  if (!STATUS_OMIE[status]) throw new Error("status inválido");
  const pedidos = await Promise.all(ids.map((id) => pedido(Number(id))));
  const falhas: { num: string; erro: string }[] = [];
  const okPainel: number[] = [];
  const doOmie: Pedido[] = [];
  for (const p of pedidos) {
    if (p.tipo !== "PC") { falhas.push({ num: p.num, erro: "requisição não é aprovada" }); continue; }
    if (p.origem === "omie") { doOmie.push(p); continue; }
    /* 08/10/26 (Benny): só pode reprovar quem aprova. Aprovar, "não aprovado" e devolver um
       aprovado para "aguardando" passam pela MESMA checagem (lib/aprovacao-permissao), com a
       regra do projeto (estourou o budget → só admin). Pedir aprovação continua livre. */
    if (aprovPainelExigeAprovador(p.aprov, status)) {
      const nao = await motivoNaoDecide(q, { emp: p.emp, num: p.num, valor: Number(p.valor) || 0, projCod: p.projCod, proj: p.proj }, acaoDoStatus(status));
      if (nao) { falhas.push({ num: p.num, erro: nao }); continue; }
    }
    okPainel.push(p.id!);
  }
  let bloqueados = 0;
  if (okPainel.length) {
    // PC sem vínculo (RC por item, PV/OS ou as marcações com motivo) não vai a aprovação — sql/51
    const r = await rpc<{ bloqueados?: { num: string; erro: string }[] }>("compras_aprovar", { p_ids: okPainel, p_status: status, p_por: q.email });
    for (const b of r?.bloqueados ?? []) falhas.push({ num: b.num, erro: b.erro });
    bloqueados = (r?.bloqueados ?? []).length;
    // Webex "Pedidos Aprovados!" — o mesmo cartão que os PCs do Omie já mandavam (06/10/26).
    const travados = new Set((r?.bloqueados ?? []).map((b) => b.num));
    if (status === "aprovado" || status === "nao_aprovado") {
      for (const p of pedidos.filter((x) => okPainel.includes(x.id!) && !travados.has(x.num))) {
        const { data: pa } = p.parc ? await supaAdmin().schema("finance").from("parcelas").select("descricao").eq("codigo", p.parc).maybeSingle() : { data: null };
        await postWebexMessage(buildApprovalMarkdown({
          pc_numero: p.num, nome_fornecedor: p.forn ?? null, pc_forma_pagamento: (pa as { descricao?: string } | null)?.descricao ?? p.parc ?? null,
          valor: Number(p.valor) || null, projeto_nome: p.proj ?? null, pv_os_label: p.pv ?? null,
          aprovador_email: q.email, status_label: status === "aprovado" ? "Aprovado" : "Não aprovado",
        })).catch(() => null);
      }
    }
  }
  const okOmie = await gravarAprovacaoOmie(q, req, doOmie, status, falhas);
  return { alterados: okPainel.length - bloqueados + okOmie, falhas };
}

/** Pedido do Omie: aprovação pelo caminho de sempre (set-status valida
 *  alçada, teto semanal, atribuição de cliente e fluxo do projeto). */
async function gravarAprovacaoOmie(q: Quem, req: Request | null, ps: Pedido[], status: string,
                                   falhas: { num: string; erro: string }[] = []) {
  if (!ps.length) return 0;
  let ok = 0;
  const okIds: number[] = [];
  const cookie = req?.headers.get("cookie") ?? "";
  const origem = req ? new URL(req.url).origin : null;
  for (const p of ps) {
    if (!p.ncodPed) { falhas.push({ num: p.num, erro: "sem código do Omie" }); continue; }
    const { data: ap } = await supaAdmin().schema("approval").from("approvals")
      .select("modulo").eq("empresa", p.emp).eq("ncod_ped", p.ncodPed).maybeSingle();
    const modulo = (ap as { modulo?: string } | null)?.modulo ?? "pcs";
    if (!origem) {
      // sem request (mover para Aprovação): só marca pendente, sem alçada a validar
      const { error } = await supaAdmin().schema("approval").from("approvals").upsert(
        { empresa: p.emp, ncod_ped: p.ncodPed, modulo, source: "native", status: STATUS_OMIE[status] },
        { onConflict: "empresa,ncod_ped" });
      if (error) { falhas.push({ num: p.num, erro: error.message }); continue; }
    } else {
      const r = await fetch(`${origem}/api/approvals/set-status`, {
        method: "POST", headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ empresa: p.emp, ncod_ped: p.ncodPed, status: STATUS_OMIE[status], modulo, valorPc: p.valor }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        falhas.push({ num: p.num, erro: String((j as { error?: string }).error ?? r.statusText) });
        continue;
      }
    }
    okIds.push(p.id!); ok++;
  }
  if (okIds.length) await rpc("compras_aprovar", { p_ids: okIds, p_status: status, p_por: q.email });
  return ok;
}
