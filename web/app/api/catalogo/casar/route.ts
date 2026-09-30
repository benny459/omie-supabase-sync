// POST /api/catalogo/casar { itens: string[] } — casa texto livre (Excel colado,
// planilha subida) com o catálogo de compras do Omie.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { casarCatalogo } from "@/lib/catalogo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { itens?: unknown } | null;
  const itens = Array.isArray(b?.itens) ? b!.itens.map((x) => String(x ?? "").slice(0, 300)) : [];
  if (itens.length > 1000) return NextResponse.json({ error: "Máximo de 1000 itens por vez" }, { status: 400 });
  try {
    return NextResponse.json({ casamentos: await casarCatalogo(itens) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
