// Duplicidades — tudo só no painel, nada vai ao Omie.
// GET  /api/estoque/duplicidade → decisões ativas (para desfazer)
// POST { acao: "mesclar", empresa, principal, secundario }  (admin) → transfere o saldo por ajustes "mesclagem"
// POST { acao: "nao_e", empresa, a, b }                     (qualquer usuário do ERP) → par sai da lista
// POST { acao: "desfazer", id }                              (admin) → reverte a mesclagem / devolve o par

import { NextResponse } from "next/server";
import { msgErro, orders, platform, quemEstoque } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const { data, error } = await platform().from("estoque_duplicidade_decisao").select("*").eq("ativo", true).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decisoes: data ?? [], admin: q.admin });
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; empresa?: string; principal?: number; secundario?: number; a?: number; b?: number; id?: number };
  const quem = { p_user: q.id || null, p_email: q.email };
  const db = orders();
  let res;
  if (b.acao === "mesclar") {
    if (!q.admin) return NextResponse.json({ error: "Só o administrador (Benny) pode mesclar" }, { status: 403 });
    res = await db.rpc("estoque_mesclar", { p_empresa: b.empresa, p_principal: Number(b.principal), p_secundario: Number(b.secundario), ...quem });
  } else if (b.acao === "nao_e") {
    res = await db.rpc("estoque_nao_duplicidade", { p_empresa: b.empresa, p_a: Number(b.a), p_b: Number(b.b), ...quem });
  } else if (b.acao === "desfazer") {
    if (!q.admin) return NextResponse.json({ error: "Só o administrador (Benny) pode desfazer" }, { status: 403 });
    res = await db.rpc("estoque_desfazer_decisao", { p_id: Number(b.id), ...quem });
  } else return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (res.error) return NextResponse.json({ error: msgErro(res.error) }, { status: 409 });
  return NextResponse.json({ ok: true, resultado: res.data });
}
