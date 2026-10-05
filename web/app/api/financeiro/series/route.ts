// /api/financeiro/series — contas recorrentes lançadas à mão (05/10/26, sql/73).
//  GET  ?id=<serie_id>                                  → série + ocorrências (vencimento, previsão, valor, pago?)
//  POST { acao: "editar", serie_id, id, escopo: "esta"|"proximas"|"todas", campos }
//       campos: valor, vencimento (só "esta"), categoria_cod, conta_cod, projeto_cod, obs, documento
//  POST { acao: "excluir" | "encerrar", serie_id }      → excluir só sem pagamentos; encerrar cancela as em aberto
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const { data, error } = await fin().rpc("serie_ocorrencias", { p_serie: id });
  return error ? erroDb(error) : NextResponse.json(data);
}

export async function POST(req: Request) {
  let b: { acao?: string; serie_id?: string; id?: string | number; escopo?: string; campos?: Record<string, unknown> };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const a = await exigir("financeiro.editar_titulo");
  if (a instanceof NextResponse) return a;
  if (!b.serie_id || !UUID.test(b.serie_id)) return NextResponse.json({ error: "serie_id inválido" }, { status: 400 });
  if (b.acao === "editar") {
    const permitidos = ["valor", "vencimento", "categoria_cod", "conta_cod", "projeto_cod", "obs", "documento"];
    const campos = Object.fromEntries(Object.entries(b.campos ?? {}).filter(([k]) => permitidos.includes(k)));
    if (!Object.keys(campos).length) return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
    const { data, error } = await fin().rpc("serie_editar", { p_serie: b.serie_id, p_id: String(b.id ?? ""), p_escopo: b.escopo ?? "esta", p_campos: campos, p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }
  if (b.acao === "excluir" || b.acao === "encerrar") {
    const { data, error } = await fin().rpc("serie_excluir", { p_serie: b.serie_id, p_modo: b.acao, p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }
  return NextResponse.json({ error: "acao inválida" }, { status: 400 });
}
