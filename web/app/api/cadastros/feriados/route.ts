// /api/cadastros/feriados — feriados da regra do dia útil (05/10/26, sql/73).
//  GET ?ano=2026            → lista (todas as abrangências)
//  POST { acao: "salvar", data, nome, abrangencia, ativo }  · { acao: "excluir", data, abrangencia }
import { NextResponse } from "next/server";
import { exigir, erroDb, fin } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const a = await exigir();
  if (a instanceof NextResponse) return a;
  const ano = Number(new URL(req.url).searchParams.get("ano") ?? new Date().getFullYear());
  const { data, error } = await fin().rpc("feriados_listar", { p_de: `${ano}-01-01`, p_ate: `${ano}-12-31` });
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
    const { error } = await fin().rpc("feriado_excluir", { p_data: b.data, p_abrangencia: abr });
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }
  if (!b.nome?.trim()) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const { error } = await fin().rpc("feriado_salvar", { p_data: b.data, p_nome: b.nome.trim(), p_abrangencia: abr, p_ativo: b.ativo !== false, p_usuario: a.email });
  return error ? erroDb(error) : NextResponse.json({ ok: true });
}
