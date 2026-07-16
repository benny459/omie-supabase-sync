// POST /api/rc-projetos/itens/bulk-link — vincula vários itens da Lista de
// Materiais a um mesmo PC.
// Body: { empresa, codigo_projeto, ids: string[], pc_numero: string }
// Retorna: { updated: n, substituidos: n } — quantos tinham PC antes.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; codigo_projeto?: number; ids?: string[]; pc_numero?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const codigoProjeto = Number(body.codigo_projeto);
  const pc = String(body.pc_numero ?? "").trim();
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string" && s.length > 0) : [];
  if (!empresa || !codigoProjeto || !pc || ids.length === 0) {
    return NextResponse.json({ error: "empresa, codigo_projeto, pc_numero e ids obrigatórios" }, { status: 400 });
  }

  const userEmail = user.email || user.id;
  const approval = supa.schema("approval" as never);

  // Conta quantos já tinham PC antes (pra reportar substituições no toast)
  const { data: preRows, error: preErr } = await approval
    .from("rc_projetos_itens")
    .select("id, pc_numero")
    .in("id", ids)
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto);
  if (preErr) return NextResponse.json({ error: preErr.message }, { status: 500 });
  type Pre = { id: string; pc_numero: string | null };
  const substituidos = ((preRows ?? []) as Pre[]).filter((r) => r.pc_numero && r.pc_numero !== pc).length;

  const { error } = await approval
    .from("rc_projetos_itens")
    .update({ pc_numero: pc, atualizado_por: userEmail, atualizado_em: new Date().toISOString() })
    .in("id", ids)
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: ids.length, substituidos });
}
