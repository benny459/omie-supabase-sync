// GET /api/compras/nf-sem-pedido — caixa "NF sem pedido" (com sugestões de pedido).
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, valoresSePuder } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  try { return NextResponse.json(valoresSePuder(q, await rpc("compras_nfs_sem_pedido", { p_empresa: "SF" }))); }
  catch (e) { return erro(e); }
}
