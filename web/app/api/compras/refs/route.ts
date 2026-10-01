// GET /api/compras/refs?emp=SF — categorias, condições de parcela, contas,
// compradores, departamentos, locais de estoque e projetos.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const emp = (new URL(req.url).searchParams.get("emp") ?? "SF").toUpperCase();
  try { return NextResponse.json(await rpc("compras_refs", { p_empresa: emp })); }
  catch (e) { return erro(e); }
}
