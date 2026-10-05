// /api/cadastros/feriados — feriados da regra do dia útil (05/10/26, sql/73).
//  GET ?ano=2026            → lista (todas as abrangências)
//  POST { acao: "salvar", data, nome, abrangencia, ativo }  · { acao: "excluir", data, abrangencia }
import { NextResponse } from "next/server";
import { exigir, erroDb } from "@/lib/financeiro-baixas";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const tab = () => supaAdmin().schema("cadastros").from("feriados");

export async function GET(req: Request) {
  const a = await exigir();
  if (a instanceof NextResponse) return a;
  const ano = Number(new URL(req.url).searchParams.get("ano") ?? new Date().getFullYear());
  const { data, error } = await tab().select("*").gte("data", `${ano}-01-01`).lte("data", `${ano}-12-31`).order("data");
  return error ? erroDb(error) : NextResponse.json({ feriados: data, pode: !!a.pode["financeiro.editar_titulo"] });
}

export async function POST(req: Request) {
  let b: { acao?: string; data?: string; nome?: string; abrangencia?: string; ativo?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const a = await exigir("financeiro.editar_titulo");
  if (a instanceof NextResponse) return a;
  if (!b.data || !ISO.test(b.data)) return NextResponse.json({ error: "data inválida" }, { status: 400 });
  const abr = (b.abrangencia ?? "nacional").trim() || "nacional";
  if (b.acao === "excluir") {
    const { error } = await tab().delete().eq("data", b.data).eq("abrangencia", abr);
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }
  if (!b.nome?.trim()) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const { error } = await tab().upsert({ data: b.data, nome: b.nome.trim(), abrangencia: abr, ativo: b.ativo !== false, atualizado_por: a.email, atualizado_em: new Date().toISOString() }, { onConflict: "data,abrangencia" });
  return error ? erroDb(error) : NextResponse.json({ ok: true });
}
