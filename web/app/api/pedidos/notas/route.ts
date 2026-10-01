// Anotações por pedido (balãozinho na tela de Operação) — platform.pedido_notas.
// Quem escreve e quando ficam gravados a partir da sessão, nunca do corpo do
// pedido. Mesmo padrão das demais rotas: auth pela sessão, escrita via supaAdmin.
//
// GET    ?modulo=avulsos           → { notas: { [pedido]: Nota[] } } (mais antigas primeiro)
// POST   { modulo, pedido, empresa?, texto } → { nota }
// DELETE ?id=123                   → só o autor (ou admin) apaga a própria nota

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MODULOS = new Set(["avulsos", "projetos", "pcs"]);

async function usuario() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await supaAdmin().schema("platform" as never).from("user_profiles")
    .select("nome, is_admin").eq("id", user.id).maybeSingle();
  const p = perfil as { nome?: string | null; is_admin?: boolean } | null;
  return { id: user.id, email: user.email ?? null, nome: p?.nome?.trim() || user.email || "—", admin: !!p?.is_admin };
}

export async function GET(req: Request) {
  if (!(await usuario())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const modulo = new URL(req.url).searchParams.get("modulo") ?? "";
  if (!MODULOS.has(modulo)) return NextResponse.json({ error: "modulo inválido" }, { status: 400 });
  const { data, error } = await supaAdmin().schema("platform" as never).from("pedido_notas")
    .select("id, pedido, texto, autor_id, autor_nome, autor_email, criado_em")
    .eq("modulo", modulo).order("criado_em", { ascending: true }).limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const notas: Record<string, unknown[]> = {};
  for (const n of (data ?? []) as { pedido: string }[]) (notas[n.pedido] ??= []).push(n);
  return NextResponse.json({ notas });
}

export async function POST(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { modulo?: string; pedido?: string; empresa?: string; texto?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const modulo = String(body.modulo ?? ""), pedido = String(body.pedido ?? "").trim(), texto = String(body.texto ?? "").trim();
  if (!MODULOS.has(modulo) || !pedido) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  if (!texto || texto.length > 2000) return NextResponse.json({ error: "Escreva de 1 a 2000 caracteres" }, { status: 400 });
  const { data, error } = await supaAdmin().schema("platform" as never).from("pedido_notas")
    .insert({ modulo, pedido, empresa: String(body.empresa ?? "SF") || "SF", texto, autor_id: u.id, autor_nome: u.nome, autor_email: u.email })
    .select("id, pedido, texto, autor_id, autor_nome, autor_email, criado_em").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ nota: data });
}

export async function DELETE(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const adm = supaAdmin().schema("platform" as never);
  const { data: n } = await adm.from("pedido_notas").select("autor_id").eq("id", id).maybeSingle();
  if (!n) return NextResponse.json({ error: "Anotação não encontrada" }, { status: 404 });
  if ((n as { autor_id: string | null }).autor_id !== u.id && !u.admin) {
    return NextResponse.json({ error: "Só quem escreveu pode apagar" }, { status: 403 });
  }
  const { error } = await adm.from("pedido_notas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
