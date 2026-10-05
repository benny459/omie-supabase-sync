// /api/aparencia/sync — a Aparência do usuário (platform.aparencia_usuario) para
// a app de Serviços, que tem login próprio e só sabe o e-mail (05/10/26).
//   op "ler"    { email }          → { prefs }
//   op "salvar" { email, prefs }   → { prefs }  (só se o e-mail já tem conta na plataforma)
// Autenticação: o mesmo passe HMAC do cadastro único (lib/cadastros-passe,
// CADASTROS_SYNC_SECRET). Rota pública no middleware; a guarda é o passe.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { passeValido } from "@/lib/cadastros-passe";
import { normalizar } from "@/lib/aparencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const corpo = await req.text();
  if (!passeValido(req.headers.get("x-cadastros-passe"), corpo)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let b: { app?: string; op?: string; email?: string; prefs?: unknown };
  try { b = JSON.parse(corpo); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const email = String(b.email ?? "").trim().toLowerCase();
  if (b.app !== "servicos" || !/^[^@\s]+@[^@\s]+$/.test(email)) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  const db = supaAdmin().schema("platform");
  if (b.op === "ler") {
    const { data, error } = await db.rpc("aparencia_por_email", { p_email: email });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ prefs: data && Object.keys(data as object).length ? normalizar(data) : null });
  }
  if (b.op === "salvar") {
    const prefs = normalizar(b.prefs);
    const { data, error } = await db.rpc("aparencia_salvar_por_email", { p_email: email, p_prefs: prefs, p_de: "servicos" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ...((data as object) ?? {}), prefs });
  }
  return NextResponse.json({ error: "op inválida" }, { status: 400 });
}
