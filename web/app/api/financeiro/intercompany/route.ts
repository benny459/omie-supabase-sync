// /api/financeiro/intercompany — contas pagas/recebidas por banco de outra empresa
// do grupo (05/10/26). O registo nasce sozinho no livro de baixas (gatilho
// finance.trg_baixa_intercompany); aqui só se consulta e se liquida.
//  GET                                   → { saldos, itens }
//  POST { acao: "liquidar", ids, obs?, movimento_id? }
//  POST { acao: "reabrir", id }
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";

export async function GET() {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const { data, error } = await fin().rpc("intercompany_painel");
  if (error) return erroDb(error);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.baixar");
  if (a instanceof NextResponse) return a;
  let b: { acao?: string; ids?: number[]; id?: number; obs?: string; movimento_id?: number | null };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (b.acao === "liquidar") {
    const ids = (b.ids ?? []).map(Number).filter((n) => n > 0);
    if (!ids.length) return NextResponse.json({ error: "Escolha ao menos um lançamento" }, { status: 400 });
    const { data, error } = await fin().rpc("intercompany_liquidar", { p_ids: ids, p_obs: b.obs ?? null, p_movimento_id: b.movimento_id ?? null, p_usuario: a.email });
    if (error) return erroDb(error);
    return NextResponse.json(data);
  }
  if (b.acao === "reabrir" && b.id) {
    const { data, error } = await fin().rpc("intercompany_reabrir", { p_id: b.id, p_usuario: a.email });
    if (error) return erroDb(error);
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "acao inválida" }, { status: 400 });
}
