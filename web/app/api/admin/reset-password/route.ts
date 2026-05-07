// API: admin gera nova senha provisória pra um usuário. Retorna a senha em
// claro pro admin copiar e enviar manualmente. Só admin pode chamar.
import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function generatePassword(): string {
  // 12 chars: letras (sem ambíguas) + números + 1 símbolo
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 12; i++) out += chars[buf[i] % chars.length];
  return `WW-${out}-26`;
}

export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  let body: { userId: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.userId) {
    return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
  }

  const newPassword = generatePassword();
  const admin = supaAdmin();
  const { data, error } = await admin.auth.admin.updateUserById(body.userId, { password: newPassword });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, password: newPassword, email: data.user?.email ?? null });
}
