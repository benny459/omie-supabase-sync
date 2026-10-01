// GET  /api/estoque/janela/[id] (admin) → relatório: janela + ajustes (com item) + totais
// POST /api/estoque/janela/[id] (admin) { acao: "revogar" } → para de aceitar ajustes na hora

import { NextResponse } from "next/server";
import { exigirAdminEstoque, orders, platform } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirAdminEstoque();
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  const db = platform();
  const [jr, ar] = await Promise.all([
    db.from("estoque_janela").select("id, nome, escopo, valida_ate, revogada_em, revogada_por_email, created_by_email, created_at").eq("id", id).maybeSingle(),
    db.from("estoque_ajuste").select("*").eq("janela_id", id).order("created_at"),
  ]);
  if (jr.error || ar.error) return NextResponse.json({ error: (jr.error ?? ar.error)!.message }, { status: 500 });
  if (!jr.data) return NextResponse.json({ error: "Janela não encontrada" }, { status: 404 });
  const ajustes = (ar.data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(ajustes.map((a) => Number(a.n_cod_prod)))];
  let itens: Record<string, unknown>[] = [];
  if (ids.length) {
    const r = await orders().from("v_estoque_item").select("empresa, n_cod_prod, codigo, descricao, unidade").in("n_cod_prod", ids);
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    itens = r.data ?? [];
  }
  const porId = new Map(itens.map((i) => [`${i.empresa}:${i.n_cod_prod}`, i]));
  return NextResponse.json({
    janela: jr.data,
    ajustes: ajustes.map((a) => ({ ...a, item: porId.get(`${a.empresa}:${a.n_cod_prod}`) ?? null })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirAdminEstoque();
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  const { acao } = (await req.json().catch(() => ({}))) as { acao?: string };
  if (acao !== "revogar") return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  const { data, error } = await platform().from("estoque_janela")
    .update({ revogada_em: new Date().toISOString(), revogada_por: q.id || null, revogada_por_email: q.email })
    .eq("id", id).is("revogada_em", null).select("id, revogada_em").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Janela não encontrada ou já revogada" }, { status: 404 });
  return NextResponse.json({ ok: true, janela: data });
}
