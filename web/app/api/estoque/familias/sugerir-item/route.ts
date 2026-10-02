// "Novo item": sugere a família pela descrição (+ NCM) com a IA — POST { descricao, ncm? } → { sugestao }.
import { NextResponse } from "next/server";
import { quemEstoque } from "@/lib/estoque-server";
import { sugerirFamiliaTexto } from "@/lib/estoque-familia-ia";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { descricao?: string; ncm?: string };
  try { return NextResponse.json({ sugestao: await sugerirFamiliaTexto(String(b.descricao ?? "").slice(0, 200), b.ncm ?? null) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
