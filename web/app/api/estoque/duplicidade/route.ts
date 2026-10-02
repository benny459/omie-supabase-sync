// Duplicidades — tudo só no painel, nada vai ao Omie.
// GET  /api/estoque/duplicidade              → decisões ativas, grupos de mesclagem ativos e lotes ativos
// GET  /api/estoque/duplicidade?previa=exatas|todos → prévia do "Mesclar todos" (grupos + principal sugerido + totais)
// POST { acao: "mesclar", empresa, principal, secundario }  (admin) → par avulso: transfere o saldo por ajustes "mesclagem"
// POST { acao: "mesclar_grupo", principal, membros, tipo }   (admin) → um grupo (2+ códigos) sob o principal
// POST { acao: "mesclar_lote", escopo, grupos: [{principal, membros, tipo}] } (admin) → "Mesclar todos": um lote,
//      cada grupo é uma mesclagem própria (o que falhar volta em `erros`, os outros ficam)
// POST { acao: "trocar_principal", id, principal }          (admin) → desfaz o grupo e mescla sob outro código
// POST { acao: "desfazer_grupo", id } / { acao: "desfazer_lote", id } (admin)
// POST { acao: "nao_e", empresa, a, b }                     (qualquer usuário do ERP) → par sai da lista
// POST { acao: "desfazer", id }                              (admin) → reverte a mesclagem avulsa / devolve o par

import { NextResponse } from "next/server";
import { msgErro, orders, platform, quemEstoque } from "@/lib/estoque-server";
import { previaMescla, type EscopoMescla } from "@/lib/estoque-mescla";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const previa = new URL(req.url).searchParams.get("previa");
  if (previa) {
    try {
      return NextResponse.json({ ...(await previaMescla("SF", previa === "todos" ? "todos" : "exatas")), admin: q.admin });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }
  const [d, g, l] = await Promise.all([
    platform().from("estoque_duplicidade_decisao").select("*").eq("ativo", true).order("created_at", { ascending: false }),
    platform().from("estoque_mescla_grupo").select("*").eq("ativo", true).order("id", { ascending: false }),
    platform().from("estoque_mescla_lote").select("*").eq("ativo", true).order("id", { ascending: false }),
  ]);
  const erro = d.error ?? g.error ?? l.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 500 });
  return NextResponse.json({ decisoes: d.data ?? [], grupos: g.data ?? [], lotes: l.data ?? [], admin: q.admin });
}

type Corpo = {
  acao?: string; empresa?: string; principal?: number; secundario?: number; a?: number; b?: number; id?: number;
  membros?: number[]; tipo?: string; escopo?: EscopoMescla; grupos?: { principal: number; membros: number[]; tipo?: string }[];
};

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Corpo;
  const quem = { p_user: q.id || null, p_email: q.email };
  const db = orders();
  const soAdmin = () => NextResponse.json({ error: "Só o administrador (Benny) pode mesclar ou desfazer" }, { status: 403 });
  const tipo = (t?: string) => (t === "parecido" ? "parecido" : "exata");
  let res;
  if (b.acao === "mesclar") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_mesclar", { p_empresa: b.empresa, p_principal: Number(b.principal), p_secundario: Number(b.secundario), ...quem });
  } else if (b.acao === "mesclar_grupo") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_mesclar_grupo", { p_empresa: "SF", p_principal: Number(b.principal), p_membros: (b.membros ?? []).map(Number),
      p_tipo: tipo(b.tipo), p_lote: null, ...quem });
  } else if (b.acao === "mesclar_lote") {
    if (!q.admin) return soAdmin();
    const grupos = (b.grupos ?? []).filter((g) => g && Number(g.principal) && (g.membros ?? []).length >= 2)
      .map((g) => ({ principal: Number(g.principal), membros: g.membros.map(Number), tipo: tipo(g.tipo) }));
    if (!grupos.length) return NextResponse.json({ error: "Nenhum grupo selecionado" }, { status: 400 });
    res = await db.rpc("estoque_mesclar_lote", { p_empresa: "SF", p_escopo: b.escopo === "todos" ? "todos" : "exatas", p_grupos: grupos, ...quem });
  } else if (b.acao === "trocar_principal") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_trocar_principal", { p_grupo: Number(b.id), p_principal: Number(b.principal), ...quem });
  } else if (b.acao === "desfazer_grupo") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_desfazer_grupo", { p_grupo: Number(b.id), ...quem });
  } else if (b.acao === "desfazer_lote") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_desfazer_lote", { p_lote: Number(b.id), ...quem });
  } else if (b.acao === "nao_e") {
    res = await db.rpc("estoque_nao_duplicidade", { p_empresa: b.empresa, p_a: Number(b.a), p_b: Number(b.b), ...quem });
  } else if (b.acao === "desfazer") {
    if (!q.admin) return soAdmin();
    res = await db.rpc("estoque_desfazer_decisao", { p_id: Number(b.id), ...quem });
  } else return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (res.error) return NextResponse.json({ error: msgErro(res.error) }, { status: 409 });
  return NextResponse.json({ ok: true, resultado: res.data });
}
