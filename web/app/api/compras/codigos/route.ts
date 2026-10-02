// GET /api/compras/codigos?q= — códigos equivalentes (todos os que respondem no
// mesmo item de hoje: Omie, mesclados, recodificados). Usado na busca da lista/
// tabela de Compras para achar PCs antigos pelo código novo e vice-versa (sql/38).
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const s = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (s.length < 3) return NextResponse.json([]);
  try { return NextResponse.json(await rpc("compras_codigos_equivalentes", { p_q: s })); }
  catch (e) { return erro(e); }
}
