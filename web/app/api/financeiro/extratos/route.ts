// GET /api/financeiro/extratos?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Lançamentos bancários de finance.v_extratos_consolidado (Omie + import da
// Conta Simples) para a Conciliação bancária Navy, mais o saldo por conta
// (bi.saldo_por_conta). A situação vem do próprio Omie — Conciliado, Não
// conciliado, Previsto —, o painel não decide o que está conciliado.
//
// Linhas com valor 0 e sem situação são as de saldo do extrato: não são
// lançamentos e ficam de fora (799 no ano, todas assim).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const COLS = "fonte, empresa, cod_conta_corrente, descricao_cc, data, natureza, situacao, " +
  "cod_categoria, des_categoria, valor, fornecedor, tipo_documento, numero, obs";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "financeiro")) {
    return NextResponse.json({ error: "Sem acesso à área Financeiro" }, { status: 403 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "from e to obrigatórios (YYYY-MM-DD)" }, { status: 400 });

  const url0 = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const fin = createClient(url0, key, { auth: { persistSession: false }, db: { schema: "finance" } });
  const bi = createClient(url0, key, { auth: { persistSession: false }, db: { schema: "bi" } });

  const PAGE = 1000, MAX = 20_000;
  const rows: Record<string, unknown>[] = [];
  for (let off = 0; off < MAX; off += PAGE) {
    const { data, error } = await fin.from("v_extratos_consolidado").select(COLS)
      .gte("data", from).lte("data", to).neq("valor", 0)
      .order("data", { ascending: false }).order("cod_conta_corrente").range(off, off + PAGE - 1);
    if (error) return NextResponse.json({ error: `v_extratos_consolidado: ${error.message}` }, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < PAGE) break;
  }
  const contas = await bi.rpc("saldo_por_conta", { p_empresas: null });
  if (contas.error) return NextResponse.json({ error: `saldo_por_conta: ${contas.error.message}` }, { status: 500 });

  return NextResponse.json({ lancamentos: rows, truncado: rows.length >= MAX, contas: contas.data ?? [] });
}
