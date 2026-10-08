// GET /api/compras?desde=365|todos — lista de requisições e pedidos (Kanban/Tabela).
// Antes de listar, casa as NF-e que chegaram pela Focus com os pedidos
// (compras.casar_nfs_focus — idempotente) para o selo "NF chegou" aparecer.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, valoresSePuder } from "@/lib/compras-server";
import { lerAjustes, devolvidoPorPc } from "@/lib/pc-ajustes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const p = new URL(req.url).searchParams.get("desde") ?? "365";
  let desde: string | null = null;
  if (p !== "todos") {
    const dias = Math.max(1, Math.min(4000, Number(p) || 365));
    desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  }
  try {
    // Rotinas idempotentes e baratas que mantêm o resto do sistema em dia:
    // NF da Focus → pedido; previsões a pagar substituídas pela conta real;
    // RCs publicadas nos baldes de PV/OS (Avulsos/Projetos).
    await Promise.all([
      rpc("compras_casar_nfs").catch(() => null),
      rpc("compras_conciliar_previsoes").catch(() => null),
      rpc("compras_publicar_rcs").catch(() => null),
    ]);
    const [pedidosBrutos, nfSug, nfsPorPedido, semPedido, ajustes] = await Promise.all([
      rpc("compras_lista", { p_desde: desde }),
      rpc("compras_nfs_sugeridas"),
      rpc("compras_nfs_por_pedido"),
      rpc("compras_nfs_sem_pedido", { p_empresa: "SF" }),
      lerAjustes({}),
    ]);
    /* sql/146: PC do Omie cancelado no painel sai da lista (o do painel já sai por
       cancelado = true); devolução marca o pedido para a pílula "Devolução" e o filtro. */
    const canc = new Set(ajustes.cancelados.map((c) => `${c.empresa}|${c.numero}`));
    const dev = devolvidoPorPc(ajustes.devolucoes);
    const pedidos = ((pedidosBrutos ?? []) as { tipo: string; emp: string; num: string }[])
      .filter((p) => p.tipo !== "PC" || !canc.has(`${p.emp}|${p.num}`))
      .map((p) => { const d = p.tipo === "PC" ? dev.get(`${p.emp}|${p.num}`) : undefined; return d ? { ...p, devolucao: d.tipo, devolvido: d.valor } : p; });
    return NextResponse.json({ ...valoresSePuder(q, { pedidos, nfSug, nfsPorPedido, semPedido }), desde, pode: q.pode });
  } catch (e) { return erro(e); }
}
