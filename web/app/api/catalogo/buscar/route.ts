// GET /api/catalogo/buscar?q=membrana 4040&lim=12 — autocompletar da lista de materiais.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { buscarCatalogo } from "@/lib/catalogo";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ itens: [] });
  try {
    const itens = await buscarCatalogo(q.slice(0, 120), Number(u.searchParams.get("lim") ?? 12));
    return NextResponse.json({ itens });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
