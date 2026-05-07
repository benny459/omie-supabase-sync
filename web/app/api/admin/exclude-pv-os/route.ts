// Admin: exclui ou re-inclui um PV/OS no painel.
// POST { action: 'exclude'|'restore', empresa, pv_os_label, motivo? }
import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { user, error: g } = await requireAdmin();
  if (g) return g;

  let body: { action: "exclude" | "restore"; empresa: string; pv_os_label: string; motivo?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.empresa || !body.pv_os_label || !["exclude", "restore"].includes(body.action)) {
    return NextResponse.json({ error: "action, empresa e pv_os_label obrigatórios" }, { status: 400 });
  }

  const admin = supaAdmin();
  if (body.action === "exclude") {
    const { error } = await admin.schema("platform" as never).from("excluded_pv_os")
      .upsert({
        empresa: body.empresa,
        pv_os_label: body.pv_os_label,
        motivo: body.motivo ?? null,
        excluded_by: user!.id,
        excluded_at: new Date().toISOString(),
      }, { onConflict: "empresa,pv_os_label" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin.schema("platform" as never).from("excluded_pv_os")
      .delete().eq("empresa", body.empresa).eq("pv_os_label", body.pv_os_label);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
