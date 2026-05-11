import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { error: guardErr, user } = await requireAdmin();
  if (guardErr) return guardErr;

  let body: { userId: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.userId) {
    return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
  }
  if (user && body.userId === user.id) {
    return NextResponse.json({ error: "Você não pode deletar a si mesmo" }, { status: 400 });
  }

  const admin = supaAdmin();
  // Profile tem ON DELETE CASCADE no id (deveria). Mesmo assim deletar explicitamente.
  await admin.schema("platform").from("user_profiles").delete().eq("id", body.userId);
  const { error } = await admin.auth.admin.deleteUser(body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
