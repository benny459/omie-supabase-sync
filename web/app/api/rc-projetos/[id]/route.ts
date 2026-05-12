// PATCH /api/rc-projetos/[id]  — atualiza campos do item (principal: pc_numero)
// DELETE /api/rc-projetos/[id] — remove item
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

const PATCHABLE = new Set(["pc_numero", "qtd", "modelo", "observacao", "equipamento", "item"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = { atualizado_por: user.email || user.id };
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) {
      patch[k] = v === "" ? null : v;
    }
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nenhum campo válido pra atualizar" }, { status: 400 });
  }

  const { error, data } = await supa
    .schema("approval" as never)
    .from("rc_projetos_itens")
    .update(patch)
    .eq("id", id)
    .select("id, pc_numero, qtd, modelo, observacao")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, row: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_itens")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
