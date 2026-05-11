import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin, generateTempPassword } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Body = {
  email: string;
  nome?: string;
  role?: "admin" | "aprovador" | "comprador" | "viewer";
};

export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = (body.email ?? "").trim().toLowerCase();
  const nome  = (body.nome ?? "").trim() || null;
  const role  = body.role ?? "viewer";
  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  if (!["admin","aprovador","comprador","viewer"].includes(role)) {
    return NextResponse.json({ error: "Role inválido" }, { status: 400 });
  }

  const admin = supaAdmin();
  const password = generateTempPassword();

  // Cria usuário no auth
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password,
    email_confirm: true,
    user_metadata: { nome, role, must_change_password: true },
  });
  if (cErr || !created?.user) {
    return NextResponse.json({ error: cErr?.message ?? "Falha ao criar usuário" }, { status: 500 });
  }

  // Cria/atualiza o profile em platform.user_profiles
  const { error: pErr } = await admin
    .schema("platform")
    .from("user_profiles")
    .upsert({
      id: created.user.id,
      email,
      nome,
      role,
      is_admin: role === "admin",
      ativo: true,
    }, { onConflict: "id" });
  if (pErr) {
    // Rollback auth user
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    userId: created.user.id,
    email,
    password,
    nome,
    role,
  });
}
