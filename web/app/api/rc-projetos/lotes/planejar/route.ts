// POST /api/rc-projetos/lotes/planejar { empresa, codigo, item_ids[] } (08/10/26, spec F)
// "✨ Planejar com o agente" a partir dos itens marcados na lista: só aponta em quais lotes
// eles caem (a consolidação é a mesma de sempre) — a tela destaca esses lotes.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { lotesDoProjeto } from "@/lib/agente-compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo?: number; item_ids?: string[] };
  const ids = new Set((b.item_ids ?? []).map(String));
  if (!b.codigo || !ids.size) return NextResponse.json({ error: "codigo e item_ids obrigatórios" }, { status: 400 });
  const { lotes } = await lotesDoProjeto(String(b.empresa ?? "SF").toUpperCase(), Number(b.codigo));
  const com = lotes.filter((l) => l.itens.some((x) => ids.has(x.id)));
  const fora = [...ids].filter((id) => !lotes.some((l) => l.itens.some((x) => x.id === id)));
  return NextResponse.json({ ok: true, lotes: com.map((l) => ({ chave: l.chave, forn: l.forn, pedir: l.pedir, itens: l.itens.filter((x) => ids.has(x.id)).map((x) => x.id) })),
    fora_dos_lotes: fora });
}
