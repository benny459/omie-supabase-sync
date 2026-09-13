// Exceções por usuário da régua de reports do Cesar (cesar_report_user_config).
// Sem exceção, todo mundo com a tela pode incorporar para a equipe; a exceção
// rebaixa (proprio) ou trava (nenhum) uma pessoa específica. Só admin mexe.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";

const admPublico = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: "public" } },
);

async function soAdmin() {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!perms.is_admin) return NextResponse.json({ error: "Só admin" }, { status: 403 });
  return null;
}

export async function GET() {
  const bloq = await soAdmin();
  if (bloq) return bloq;
  const { data, error } = await admPublico()
    .from("cesar_report_user_config")
    .select("email, modo")
    .order("email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ excecoes: data ?? [] });
}

export async function PUT(req: Request) {
  const bloq = await soAdmin();
  if (bloq) return bloq;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim().slice(0, 120);
  const modo = String(body.modo || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "e-mail inválido" }, { status: 400 });
  }
  if (!["todos", "proprio", "nenhum"].includes(modo)) {
    return NextResponse.json({ error: "modo inválido" }, { status: 400 });
  }
  const { error } = await admPublico()
    .from("cesar_report_user_config")
    .upsert({ email, modo, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const bloq = await soAdmin();
  if (bloq) return bloq;
  const email = (new URL(req.url).searchParams.get("email") || "").toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "email obrigatório" }, { status: 400 });
  const { error } = await admPublico().from("cesar_report_user_config").delete().ilike("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
