import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Row = { empresa: string; ncod_ped: number };
type Body = { rows: Row[] };

/**
 * Deleta linhas de approval.approvals em lote.
 * Regras:
 *   - admin: pode apagar qualquer linha
 *   - aprovador/comprador: só pode apagar linhas secundárias (ncod_ped < 0 = row
 *     extra criada pelo usuário). Linhas reais do Omie (ncod_ped > 0) são admin-only.
 *   - viewer: bloqueado
 */
export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows[] obrigatório" }, { status: 400 });
  }
  if (body.rows.length > 200) {
    return NextResponse.json({ error: "máximo 200 itens por lote" }, { status: 400 });
  }

  const { data: me } = await supa
    .schema("platform" as never).from("user_profiles")
    .select("is_admin, role").eq("id", user.id).maybeSingle();
  const profile = me as { is_admin?: boolean; role?: string } | null;
  const isAdmin = profile?.is_admin === true || profile?.role === "admin";
  const canEditAny = isAdmin || profile?.role === "aprovador" || profile?.role === "comprador";
  if (!canEditAny) {
    return NextResponse.json({ error: "Sem permissão para apagar" }, { status: 403 });
  }

  const blocked = body.rows.filter(r => r.ncod_ped > 0);
  if (blocked.length > 0 && !isAdmin) {
    return NextResponse.json({
      error: `Somente admin pode apagar linhas principais (Omie). ${blocked.length} linha(s) bloqueada(s).`,
    }, { status: 403 });
  }

  const admin = supaAdmin();
  const results = await Promise.all(body.rows.map(async (r) => {
    const { error } = await admin
      .schema("approval")
      .from("approvals")
      .delete()
      .eq("empresa", r.empresa)
      .eq("ncod_ped", r.ncod_ped);
    return { empresa: r.empresa, ncod_ped: r.ncod_ped, ok: !error, error: error?.message };
  }));

  const failed = results.filter(x => !x.ok);
  const ok = results.filter(x => x.ok);

  return NextResponse.json({ ok: failed.length === 0, count: ok.length, failed });
}
