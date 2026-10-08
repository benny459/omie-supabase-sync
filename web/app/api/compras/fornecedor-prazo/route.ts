// Prazo de entrega por fornecedor (08/10/26, spec E — sql/128).
//   GET ?emp=SF → { fornecedores: [{ norm, nome, historico, manual, prazo, fonte }], pendente? }
//        histórico = média pedido → NF do catálogo de compras; manual = o ajustado aqui.
//   PUT { emp, fornecedor, prazo_dias | null } → grava o manual (null = volta ao histórico).
//        Exige acesso a Compras. Sem a sql/128, GET devolve só o histórico (calculado aqui).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirCompras } from "@/lib/compras-server";
import { normFornecedor } from "@/lib/planejamento-compras";
import { deHtml } from "@/lib/match-pc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Linha = { fornecedor_norm: string; nome: string | null; historico: number | null; manual: number | null; prazo_dias: number; fonte: string;
  atualizado_em?: string | null; atualizado_por?: string | null };
const falta = (e: { code?: string; message: string } | null) => !!e && /does not exist|schema cache|PGRST202|42883|42P01/i.test(`${e.code} ${e.message}`);

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const emp = (new URL(req.url).searchParams.get("emp") || "SF").toUpperCase().slice(0, 4);
  const orders = supaAdmin().schema("orders");
  const { data, error } = await orders.rpc("fornecedor_prazo_listar", { p_empresa: emp });
  if (!error) {
    return NextResponse.json({ fornecedores: ((data ?? []) as Linha[]).map((r) => ({
      norm: r.fornecedor_norm, nome: deHtml(r.nome ?? r.fornecedor_norm), historico: r.historico, manual: r.manual, prazo: r.prazo_dias, fonte: r.fonte,
      atualizado_em: r.atualizado_em ?? null, atualizado_por: r.atualizado_por ?? null })) });
  }
  if (!falta(error)) return NextResponse.json({ error: error.message }, { status: 500 });
  // sql/128 ainda não aplicada: o histórico sai do catálogo de compras, sem manual
  const soma = new Map<string, { nome: string; s: number; n: number }>();
  for (let ini = 0; ; ini += 1000) {
    const { data: mv, error: e2 } = await orders.from("mv_catalogo_compra").select("fornecedor, entrega_dias")
      .eq("empresa", emp).not("fornecedor", "is", null).not("entrega_dias", "is", null).order("ncod_prod").range(ini, ini + 999);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    for (const m of (mv ?? []) as { fornecedor: string; entrega_dias: number }[]) {
      const k = normFornecedor(m.fornecedor); if (!k) continue;
      const a = soma.get(k) ?? { nome: deHtml(m.fornecedor), s: 0, n: 0 }; a.s += Number(m.entrega_dias); a.n++; soma.set(k, a);
    }
    if ((mv ?? []).length < 1000) break;
  }
  return NextResponse.json({ pendente: true, fornecedores: [...soma.entries()].map(([norm, a]) => {
    const h = Math.round(a.s / a.n);
    return { norm, nome: a.nome, historico: h, manual: null, prazo: h, fonte: "historico" };
  }) });
}

export async function PUT(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { emp?: string; fornecedor?: string; prazo_dias?: number | null };
  const emp = String(b.emp ?? "SF").toUpperCase().slice(0, 4);
  const fornecedor = String(b.fornecedor ?? "").trim();
  if (!fornecedor || !normFornecedor(fornecedor)) return NextResponse.json({ error: "fornecedor obrigatório" }, { status: 400 });
  const prazo = b.prazo_dias == null || (b.prazo_dias as unknown) === "" ? null : Math.round(Number(b.prazo_dias));
  if (prazo != null && !(prazo >= 0 && prazo <= 365)) return NextResponse.json({ error: "prazo entre 0 e 365 dias" }, { status: 400 });
  const { data, error } = await supaAdmin().schema("orders").rpc("fornecedor_prazo_definir", { p_empresa: emp, p_fornecedor: fornecedor, p_prazo: prazo, p_por: q.email });
  if (error) {
    if (falta(error)) return NextResponse.json({ error: "Prazo por fornecedor ainda não ativado (migração sql/128 pendente)" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, fornecedor, ...(data as object) });
}
