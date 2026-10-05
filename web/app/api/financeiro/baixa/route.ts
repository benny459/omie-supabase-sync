// /api/financeiro/baixa (05/10/26) — baixa manual de título do painel.
//  GET  ?natureza=P|R&titulo=… → título (saldo) + histórico de baixas
//  POST { acao: "baixar", natureza, titulo, data, valor, cod_cc?, obs?, forcar? }
//       { acao: "estornar", baixa_id, motivo }
// Pagar = previsão de PC do painel (só em fase "liberado", salvo forçar com motivo);
// receber = conta nascida no painel. Títulos do Omie continuam a baixar no Omie.
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const natureza = u.searchParams.get("natureza") === "R" ? "R" : "P";
  const a = await exigir(natureza === "R" ? "financeiro.ver_receber" : "financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const titulo = u.searchParams.get("titulo") ?? "";
  if (!titulo) return NextResponse.json({ error: "titulo obrigatório" }, { status: 400 });
  const [{ data, error }, contas] = await Promise.all([
    fin().rpc("baixas_do_titulo", { p_natureza: natureza, p_titulo: titulo }),
    fin().from("contas_correntes").select("empresa, cod_cc, descricao, inativo").order("descricao"),
  ]);
  if (error) return erroDb(error);
  return NextResponse.json({
    ...(data as object),
    contas: ((contas.data ?? []) as { inativo: string | null }[]).filter((c) => c.inativo !== "S"),
    pode_baixar: !!a.pode["financeiro.baixar"],
  });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.baixar");
  if (a instanceof NextResponse) return a;
  let b: { acao?: string; natureza?: string; titulo?: string; data?: string; valor?: number; cod_cc?: number | null;
           obs?: string; forcar?: boolean; baixa_id?: number; motivo?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  if (b.acao === "estornar") {
    const id = Number(b.baixa_id ?? 0);
    if (!id) return NextResponse.json({ error: "baixa_id obrigatório" }, { status: 400 });
    const { data, error } = await fin().rpc("baixa_estornar", { p_baixa_id: id, p_motivo: b.motivo ?? "", p_usuario: a.email });
    if (error) return erroDb(error);
    return NextResponse.json(data);
  }
  if (b.acao !== "baixar") return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  const natureza = b.natureza === "R" ? "R" : b.natureza === "P" ? "P" : null;
  if (!natureza || !b.titulo) return NextResponse.json({ error: "natureza e titulo obrigatórios" }, { status: 400 });
  if (!b.data || !ISO.test(b.data)) return NextResponse.json({ error: "data (YYYY-MM-DD) obrigatória" }, { status: 400 });
  const valor = Math.round(Number(b.valor ?? 0) * 100) / 100;
  if (!(valor > 0)) return NextResponse.json({ error: "valor tem de ser positivo" }, { status: 400 });
  const { data, error } = await fin().rpc("baixa_registrar", {
    p_natureza: natureza, p_titulo: String(b.titulo), p_data: b.data, p_valor: valor,
    p_cod_cc: b.cod_cc ? Number(b.cod_cc) : null, p_movimento_id: null,
    p_obs: b.obs ? String(b.obs).slice(0, 500) : null, p_usuario: a.email, p_forcar: !!b.forcar,
  });
  if (error) return erroDb(error);
  return NextResponse.json(data);
}
