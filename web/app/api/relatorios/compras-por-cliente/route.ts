// GET /api/relatorios/compras-por-cliente?from=YYYY-MM-DD&to=YYYY-MM-DD
// Prévia da CONTRIBUIÇÃO DO PAINEL pra rentabilidade consolidada:
// compras aprovadas (PCs) + receita cruzada por cliente.
// Fonte: sales.v_cliente_receita_compras (já pré-consolida receita+compras).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export type Linha = {
  codigo_cliente: number | null;
  cliente_nome: string;
  codigo_projeto: string | null;
  tipo_venda: string;
  periodo_mes: string;
  faturamento: number;
  total_compras: number;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to   = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to devem ser YYYY-MM-DD" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  const PAGE = 1000;
  const rows: Linha[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("v_cliente_receita_compras")
      .select("codigo_cliente, cliente_nome, codigo_projeto, tipo_venda, periodo_mes, faturamento, total_compras")
      .gte("periodo_mes", from)
      .lte("periodo_mes", to)
      .order("periodo_mes", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Array<{
      codigo_cliente: number | null; cliente_nome: string;
      codigo_projeto: string | null; tipo_venda: string;
      periodo_mes: string;
      faturamento: string | number; total_compras: string | number;
    }>;
    for (const r of batch) {
      rows.push({
        codigo_cliente: r.codigo_cliente,
        cliente_nome: r.cliente_nome,
        codigo_projeto: r.codigo_projeto,
        tipo_venda: r.tipo_venda,
        periodo_mes: r.periodo_mes,
        faturamento: Number(r.faturamento) || 0,
        total_compras: Number(r.total_compras) || 0,
      });
    }
    if (batch.length < PAGE) break;
    if (offset > 20_000) break;
  }

  let receita = 0, compras = 0;
  for (const r of rows) { receita += r.faturamento; compras += r.total_compras; }
  return NextResponse.json({
    periodo: { from, to },
    linhas: rows,
    totais: {
      faturamento: Number(receita.toFixed(2)),
      total_compras: Number(compras.toFixed(2)),
      linhas: rows.length,
    },
  });
}
