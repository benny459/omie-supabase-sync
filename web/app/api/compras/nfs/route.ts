// GET /api/compras/nfs?id= — NF-e que chegaram pela Focus e podem ser deste pedido.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, valoresSePuder } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try { return NextResponse.json(valoresSePuder(q, await rpc("compras_nfs_do_pedido", { p_id: id }))); }
  catch (e) { return erro(e); }
}
