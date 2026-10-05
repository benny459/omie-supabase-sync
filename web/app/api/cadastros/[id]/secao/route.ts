// GET /api/cadastros/:id/secao?s=base|financeiro|comercial|faturamento|compras|servicos
// Ficha 360 (lib/cadastros-360): cada secção carrega à vez, para a primeira aparecer depressa.
import { NextResponse } from "next/server";
import { exigirCadastros, erroCad } from "@/lib/cadastros-server";
import { SECOES, secao360, type Secao } from "@/lib/cadastros-360";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  const s = new URL(req.url).searchParams.get("s") as Secao;
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  if (!SECOES.includes(s)) return NextResponse.json({ error: "secção inválida" }, { status: 400 });
  try {
    return NextResponse.json(await secao360(id, s, q));
  } catch (e) { return erroCad(e); }
}
