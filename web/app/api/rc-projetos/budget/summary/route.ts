// GET /api/rc-projetos/budget/summary?keys=SF|9829491988,SF|1234...
// Retorna resumo do budget do fluxo por projeto (usado no card lateral em /projetos).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { fetchBudgetsDoCrm } from "@/lib/crm-fechamento";

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
      origem: "fluxo" as string,
    }));

  /* Fechamento do CRM manda quando existe: é o que foi efetivamente vendido,
     com a CP da proposta ganha. Sem ele o card ficava "definir" até alguém
     importar o Fluxo Financeiro à mão — e comparava os PCs contra nada.
     Falar com o CRM é best-effort: se cair, o card volta ao que já mostrava. */
  try {
    const doCrm = await fetchBudgetsDoCrm(Array.from(codigos));
    if (doCrm.size) {
      const porKey = new Map(rows.map((r) => [r.key, r]));
      for (const k of keys) {
        const [emp, cod] = k.split("|");
        const b = doCrm.get(Number(cod));
        if (!b) continue;
        const linha = {
          key: `${emp}|${Number(cod)}`,
          budget_custos: b.budgetCustos,
          valor_total_projeto: b.valorTotalProjeto,
          resultado_bruto_esperado: b.resultadoEsperado,
          resultado_bruto_esperado_pct: b.resultadoEsperadoPct,
          origem: "crm",
        };
        const atual = porKey.get(linha.key);
        if (atual) Object.assign(atual, linha);
        else { rows.push(linha); porKey.set(linha.key, linha); }
      }
    }
  } catch { /* CRM fora do ar não derruba o card */ }

  /* 07/10/26 — o mesmo resumo da Lista de materiais: o budget editado no painel
     (rc_projetos_budget.valor_budget) manda sobre o do CRM/Fluxo, e o "projetado"
     soma ao lançado o estimado das linhas da lista que ainda não têm RC/PC. */
  try {
    const [bud, its] = await Promise.all([
      supa.schema("approval" as never).from("rc_projetos_budget").select("empresa, codigo_projeto, valor_budget")
        .in("empresa", Array.from(empresas)).in("codigo_projeto", Array.from(codigos)),
      supa.schema("approval" as never).from("rc_projetos_itens").select("empresa, codigo_projeto, qtd, cat_valor_unit, pc_numero, rc_item_id, pc_item_id")
        .in("empresa", Array.from(empresas)).in("codigo_projeto", Array.from(codigos)).is("rc_item_id", null).is("pc_item_id", null).limit(20000),
    ]);
    const porKey = new Map(rows.map((r) => [r.key, r as typeof r & { estimado_sem_pc?: number; budget_painel?: boolean }]));
    for (const b of ((bud.data ?? []) as { empresa: string; codigo_projeto: number; valor_budget: number | null }[])) {
      const k = `${b.empresa}|${b.codigo_projeto}`;
      if (b.valor_budget == null || !keys.includes(k)) continue;
      const r = porKey.get(k);
      if (r) { r.budget_custos = Number(b.valor_budget); r.origem = "painel"; }
      else { const n = { key: k, budget_custos: Number(b.valor_budget), valor_total_projeto: null, resultado_bruto_esperado: null, resultado_bruto_esperado_pct: null, origem: "painel" }; rows.push(n); porKey.set(k, n); }
    }
    const est = new Map<string, number>();
    for (const i of ((its.data ?? []) as { empresa: string; codigo_projeto: number; qtd: number | null; cat_valor_unit: number | null; pc_numero: string | null }[])) {
      if (String(i.pc_numero ?? "").trim()) continue;
      const k = `${i.empresa}|${i.codigo_projeto}`;
      est.set(k, (est.get(k) ?? 0) + (Number(i.qtd) || 0) * (Number(i.cat_valor_unit) || 0));
    }
    for (const [k, v] of est) { const r = porKey.get(k); if (r) r.estimado_sem_pc = Math.round(v * 100) / 100; }
  } catch { /* sem o resumo da lista, o card segue como antes */ }

  return NextResponse.json({ rows });
}
