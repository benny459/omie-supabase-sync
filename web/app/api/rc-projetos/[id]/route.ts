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
  const approval = supa.schema("approval" as never);

  // Arquiva ANTES de apagar, como o upload faz. Apagar item a item ia direto
  // ao DELETE, sem rastro — a única porta de remoção que escapava da lixeira.
  const { data: r, error: lerErr } = await approval
    .from("rc_projetos_itens")
    .select("id, empresa, codigo_projeto, equipamento, item, item_norm, qtd, modelo, observacao, pc_numero, criado_em, criado_por, cat_ncod_prod, cat_codigo, cat_valor_unit, cat_fornecedor, cat_entrega_dias, cat_fat_dias")
    .eq("id", id).maybeSingle();
  if (lerErr) return NextResponse.json({ error: lerErr.message }, { status: 500 });
  if (!r) return NextResponse.json({ ok: true });
  const it = r as Record<string, unknown>;
  const { error: arqErr } = await approval.from("rc_projetos_itens_lixeira").insert({
    item_id: it.id, empresa: it.empresa, codigo_projeto: it.codigo_projeto,
    equipamento: it.equipamento, item: it.item, item_norm: it.item_norm,
    qtd: it.qtd, modelo: it.modelo, observacao: it.observacao,
    pc_numero: it.pc_numero, criado_em: it.criado_em, criado_por: it.criado_por,
    cat_ncod_prod: it.cat_ncod_prod, cat_codigo: it.cat_codigo, cat_valor_unit: it.cat_valor_unit,
    cat_fornecedor: it.cat_fornecedor, cat_entrega_dias: it.cat_entrega_dias, cat_fat_dias: it.cat_fat_dias,
    apagado_por: user.email || user.id,
    apagado_por_upload: "item apagado individualmente",
  });
  if (arqErr) {
    return NextResponse.json({ error: `não consegui arquivar o item — nada foi apagado: ${arqErr.message}` }, { status: 500 });
  }

  const { error } = await approval
    .from("rc_projetos_itens")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
