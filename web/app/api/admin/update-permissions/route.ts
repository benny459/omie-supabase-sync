import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  let body: {
    userId: string;
    role?: "admin" | "aprovador" | "comprador" | "viewer";
    is_admin?: boolean;       // toggle direto de admin
    permissions?: unknown;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.userId) {
    return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.role) {
    if (!["admin","aprovador","comprador","viewer"].includes(body.role)) {
      return NextResponse.json({ error: "Role inválido" }, { status: 400 });
    }
    patch.role = body.role;
    patch.is_admin = body.role === "admin";
  }
  if (typeof body.is_admin === "boolean") {
    patch.is_admin = body.is_admin;
    // Mantém role coerente: admin → 'admin', senão deixa o role anterior (não toca)
    if (body.is_admin) patch.role = "admin";
  }
  if (body.permissions !== undefined) {
    patch.permissions = body.permissions;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const admin = supaAdmin();
  const { error } = await admin
    .schema("platform")
    .from("user_profiles")
    .update(patch)
    .eq("id", body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
