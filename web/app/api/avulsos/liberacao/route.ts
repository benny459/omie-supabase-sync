// PV/OS "Aguardando Liberação" — cliente pediu a venda mas ainda não enviou
// pedido de compra formal. Check de permissão explícito (is_admin OU
// can_release_pv=true no módulo avulsos), depois mutação via supaAdmin.
// Padrão idêntico às demais rotas admin do projeto (RLS via .schema() se
// mostrou frágil em prod — passamos pelo caminho mais confiável).
//
// GET  → { map: { [pv_os_label]: true } } — todos ativos
// POST { pv_os_label, empresa, aguardando } → upsert / toggle

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

async function checkCanRelease(): Promise<{ userId: string; email: string | null } | null> {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = supaAdmin();
  const [{ data: profile }, { data: role }] = await Promise.all([
    admin.schema("platform" as never).from("user_profiles")
      .select("is_admin").eq("id", user.id).maybeSingle(),
    admin.schema("platform" as never).from("user_module_roles")
      .select("can_release_pv").eq("user_id", user.id).eq("modulo", "avulsos").maybeSingle(),
  ]);
  const isAdmin = !!(profile as { is_admin?: boolean } | null)?.is_admin;
  const canRelease = !!(role as { can_release_pv?: boolean } | null)?.can_release_pv;
  if (!isAdmin && !canRelease) return null;
  return { userId: user.id, email: user.email ?? null };
}

export async function GET() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("platform" as never)
    .from("pv_liberacao_status")
    .select("pv_os_label")
    .eq("aguardando_liberacao", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map: Record<string, true> = {};
  for (const r of (data ?? []) as Array<{ pv_os_label: string }>) map[r.pv_os_label] = true;
  return NextResponse.json({ map });
}

export async function POST(req: Request) {
  const auth = await checkCanRelease();
  if (!auth) return NextResponse.json({ error: "Sem permissão pra marcar Aguardando Liberação" }, { status: 403 });

  let body: { pv_os_label?: string; empresa?: string; aguardando?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const pv = String(body.pv_os_label ?? "").trim();
  const empresa = String(body.empresa ?? "").trim();
  const aguardando = !!body.aguardando;
  if (!pv || !empresa) return NextResponse.json({ error: "pv_os_label e empresa obrigatórios" }, { status: 400 });

  const now = new Date().toISOString();
  // Upsert: se aguardando=true, cria/atualiza pra ativo. Se false, mantém a
  // linha (audit) mas seta aguardando_liberacao=false + campos de desmarcação.
  const payload = aguardando
    ? { pv_os_label: pv, empresa, aguardando_liberacao: true, marcado_por: auth.email, marcado_em: now,
        desmarcado_por: null, desmarcado_em: null }
    : { pv_os_label: pv, empresa, aguardando_liberacao: false,
        desmarcado_por: auth.email, desmarcado_em: now };

  const admin = supaAdmin();
  const { error } = await admin
    .schema("platform" as never)
    .from("pv_liberacao_status")
    .upsert(payload, { onConflict: "pv_os_label" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, pv_os_label: pv, aguardando });
}
