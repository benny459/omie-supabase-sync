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
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, podeAprovar, type Quem } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { ordemEtapa, type Pedido } from "@/lib/compras";

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
    switch (b.acao) {
      case "mover": return NextResponse.json(await mover(q, Number(b.id), String(b.etapa)));
      case "aprovar": return NextResponse.json(await aprovar(q, req, (b.ids as number[]) ?? [], String(b.status)));
      case "receber": {
        const p = await pedido(Number(b.id));
        if (p.tipo !== "PC") throw new Error("Só pedido de compra é recebido");
        if (b.chaveFocus) {
          await rpc("compras_nf_decidir", { p_chave: String(b.chaveFocus), p_pedido: p.id, p_status: "confirmado", p_por: q.email });
        }
        return NextResponse.json(await rpc("compras_receber", {
          p_id: p.id, p_nf: String(b.nf ?? ""), p_chave: b.chave ? String(b.chave) : null,
          p_dt: String(b.dt ?? new Date().toISOString().slice(0, 10)), p_qtds: b.qtds ?? [], p_final: !!b.final, p_por: q.email,
        }));
      }
      case "cancelar": return NextResponse.json(await rpc("compras_cancelar", { p_id: Number(b.id), p_por: q.email }));
      case "excluir": return NextResponse.json(await rpc("compras_excluir", { p_id: Number(b.id) }));
      case "duplicar": return NextResponse.json(await rpc("compras_duplicar", { p_id: Number(b.id), p_por: q.email, p_uid: q.uid }));
      case "nf": return NextResponse.json(await rpc("compras_nf_decidir", {
        p_chave: String(b.chave), p_pedido: Number(b.pedido), p_status: String(b.status), p_por: q.email,
      }));
      default: return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }
  } catch (e) { return erro(e); }
}

async function mover(q: Quem, id: number, etapa: string) {
  const p = await pedido(id);
  if (ordemEtapa(etapa) < 0) throw new Error("Etapa inválida");
  if (p.etapa === "20" && etapa !== "20") throw new Error("Requisição vira pedido pela folha (Gerar Pedido de Compra)");
  if (["40", "60", "80"].includes(etapa) && p.origem === "painel" && p.aprov !== "aprovado") {
    throw new Error("Pedido ainda não aprovado — aprove antes de avançar");
  }
  if (etapa === "60" && !p.nf) throw new Error("Registre o recebimento com a NF-e");
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
    if (status === "aprovado") {
      const nao = await podeAprovar(q, Number(p.valor) || 0);
      if (nao) { falhas.push({ num: p.num, erro: nao }); continue; }
    }
    okPainel.push(p.id!);
  }
  if (okPainel.length) await rpc("compras_aprovar", { p_ids: okPainel, p_status: status, p_por: q.email });
  const okOmie = await gravarAprovacaoOmie(q, req, doOmie, status, falhas);
  return { alterados: okPainel.length + okOmie, falhas };
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
