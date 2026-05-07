// API: gerencia platform.user_module_roles. Só admin acessa.
//   GET  ?userId=X     → lista as 3 linhas (ou as que existirem) do usuário
//   POST { userId, roles: [{ modulo, can_edit_rc, can_edit_pc, can_approve,
//          can_edit_log, approval_ceiling_brl, weekly_budget_brl }] }
//   → upsert em batch.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MODULOS = ["avulsos", "projetos", "pcs"] as const;
type Modulo = typeof MODULOS[number];

type RolePayload = {
  modulo: Modulo;
  can_edit_pv: boolean;
  can_edit_rc: boolean;
  can_edit_pc: boolean;
  can_approve: boolean;
  can_edit_log: boolean;
  approval_ceiling_brl: number | null;
  weekly_budget_brl: number | null;
};

async function requireAdmin() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data } = await supa.schema("platform" as never).from("user_profiles")
    .select("is_admin").eq("id", user.id).maybeSingle();
  const isAdmin = (data as { is_admin?: boolean } | null)?.is_admin === true;
  if (!isAdmin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = supaAdmin();
  const { data, error } = await admin.schema("platform" as never).from("user_module_roles")
    .select("modulo, can_edit_pv, can_edit_rc, can_edit_pc, can_approve, can_edit_log, approval_ceiling_brl, weekly_budget_brl")
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ roles: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  let body: { userId: string; roles: RolePayload[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.userId || !Array.isArray(body.roles)) {
    return NextResponse.json({ error: "userId e roles obrigatórios" }, { status: 400 });
  }
  for (const r of body.roles) {
    if (!MODULOS.includes(r.modulo)) {
      return NextResponse.json({ error: `modulo inválido: ${r.modulo}` }, { status: 400 });
    }
  }

  const admin = supaAdmin();
  const rows = body.roles.map((r) => ({
    user_id: body.userId,
    modulo: r.modulo,
    can_edit_pv: !!r.can_edit_pv,
    can_edit_rc: !!r.can_edit_rc,
    can_edit_pc: !!r.can_edit_pc,
    can_approve: !!r.can_approve,
    can_edit_log: !!r.can_edit_log,
    approval_ceiling_brl: r.approval_ceiling_brl,
    weekly_budget_brl: r.weekly_budget_brl,
  }));
  const { error } = await admin.schema("platform" as never).from("user_module_roles")
    .upsert(rows, { onConflict: "user_id,modulo" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: rows.length });
}
