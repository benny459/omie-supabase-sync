// GET/POST comentários bucket-level (por empresa+pv_os_label).
// Tabela approval.pv_os_comments. RLS: authenticated CRUD próprio.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa")?.trim();
  const pv = url.searchParams.get("pv_os_label")?.trim();
  if (!empresa || !pv) {
    return NextResponse.json({ error: "empresa e pv_os_label são obrigatórios" }, { status: 400 });
  }

  const { data, error } = await supa
    .schema("approval" as never)
    .from("pv_os_comments")
    .select("id, autor_email, texto, created_at, deleted_at")
    .eq("empresa", empresa)
    .eq("pv_os_label", pv)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; pv_os_label?: string; texto?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const pv = String(body.pv_os_label ?? "").trim();
  const texto = String(body.texto ?? "").trim();
  if (!empresa || !pv || !texto) {
    return NextResponse.json({ error: "empresa, pv_os_label e texto são obrigatórios" }, { status: 400 });
  }

  const { data, error } = await supa
    .schema("approval" as never)
    .from("pv_os_comments")
    .insert({
      empresa,
      pv_os_label: pv,
      autor_id: user.id,
      autor_email: user.email ?? "unknown",
      texto,
    })
    .select("id, autor_email, texto, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
