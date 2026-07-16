// GET /api/rc-projetos/budget/summary?keys=SF|9829491988,SF|1234...
// Retorna resumo do budget do fluxo por projeto (usado no card lateral em /projetos).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("keys") ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 300);
  if (keys.length === 0) return NextResponse.json({ rows: [] });

  const empresas = new Set<string>();
  const codigos  = new Set<number>();
  for (const k of keys) {
    const [emp, cod] = k.split("|");
    if (!emp || !cod) continue;
    empresas.add(emp);
    const n = Number(cod);
    if (Number.isFinite(n)) codigos.add(n);
  }
  if (codigos.size === 0) return NextResponse.json({ rows: [] });

  const { data, error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_budget")
    .select("empresa, codigo_projeto, valor_total_projeto, valor_previsto_custos, valor_previsto_despesas, valor_previsto_servicos, resultado_bruto_esperado, resultado_bruto_esperado_pct")
    .in("empresa", Array.from(empresas))
    .in("codigo_projeto", Array.from(codigos));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    empresa: string; codigo_projeto: number;
    valor_total_projeto: number | null;
    valor_previsto_custos: number | null;
    valor_previsto_despesas: number | null;
    valor_previsto_servicos: number | null;
    resultado_bruto_esperado: number | null;
    resultado_bruto_esperado_pct: number | null;
  };
  const rows = ((data ?? []) as Row[])
    .filter((r) => keys.includes(`${r.empresa}|${r.codigo_projeto}`))
    .map((r) => ({
      key: `${r.empresa}|${r.codigo_projeto}`,
      budget_custos: r.valor_previsto_custos,
      valor_total_projeto: r.valor_total_projeto,
      resultado_bruto_esperado: r.resultado_bruto_esperado,
      resultado_bruto_esperado_pct: r.resultado_bruto_esperado_pct,
    }));

  return NextResponse.json({ rows });
}
