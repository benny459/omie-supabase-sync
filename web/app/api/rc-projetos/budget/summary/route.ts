// GET /api/rc-projetos/budget/summary?keys=SF|9829491988,SF|1234...
// Retorna resumo do budget do fluxo por projeto (usado no card lateral em /projetos).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { fetchBudgetsDoCrm } from "@/lib/crm-fechamento";
import { supaAdmin } from "@/lib/supabase-admin";

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
      budget_custos: null as number | null,  // budget de MATERIAIS — preenchido abaixo
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
          budget_custos: null as number | null,
          valor_total_projeto: b.valorTotalProjeto,
          resultado_bruto_esperado: b.resultadoEsperado,
          resultado_bruto_esperado_pct: b.resultadoEsperadoPct,
          origem: "crm",
        };
        const atual = porKey.get(linha.key);
        if (atual) Object.assign(atual, { ...linha, budget_custos: atual.budget_custos });
        else { rows.push(linha); porKey.set(linha.key, linha); }
      }
    }
  } catch { /* CRM fora do ar não derruba o card */ }

  /* 07/10/26 — o mesmo resumo da Lista de materiais. Budget de MATERIAIS = o definido
     para materiais no painel (valor_budget_materiais, sql/107), senão o total de
     materiais da RC (projeto_plano.custo_materiais, do fechamento do CRM). Nunca o
     valor_budget (custo total — teto do Fluxo). Mesma conta da Lista e da aprovação
     (lib/lista-pc-completar). O "projetado" soma ao lançado o estimado das linhas
     da lista que ainda não têm RC/PC. */
  try {
    const [bud, plano, its] = await Promise.all([
      supa.schema("approval" as never).from("rc_projetos_budget").select("*")
        .in("empresa", Array.from(empresas)).in("codigo_projeto", Array.from(codigos)),
      supa.schema("approval" as never).from("projeto_plano").select("empresa, codigo_projeto, custo_materiais")
        .in("empresa", Array.from(empresas)).in("codigo_projeto", Array.from(codigos)),
      supa.schema("approval" as never).from("rc_projetos_itens").select("empresa, codigo_projeto, qtd, cat_valor_unit, pc_numero, rc_item_id, pc_item_id")
        .in("empresa", Array.from(empresas)).in("codigo_projeto", Array.from(codigos)).is("rc_item_id", null).is("pc_item_id", null).limit(20000),
    ]);
    const porKey = new Map(rows.map((r) => [r.key, r as typeof r & { estimado_sem_pc?: number; budget_painel?: boolean }]));
    const garantir = (k: string) => {
      let r = porKey.get(k);
      if (!r) { r = { key: k, budget_custos: null, valor_total_projeto: null, resultado_bruto_esperado: null, resultado_bruto_esperado_pct: null, origem: "rc" }; rows.push(r); porKey.set(k, r); }
      return r;
    };
    for (const p of ((plano.data ?? []) as { empresa: string; codigo_projeto: number; custo_materiais: number | null }[])) {
      const k = `${p.empresa}|${p.codigo_projeto}`;
      if (p.custo_materiais == null || !keys.includes(k)) continue;
      const r = garantir(k); r.budget_custos = Number(p.custo_materiais); r.origem = "rc";
    }
    for (const b of ((bud.data ?? []) as { empresa: string; codigo_projeto: number; valor_budget_materiais?: number | null }[])) {
      const k = `${b.empresa}|${b.codigo_projeto}`;
      if (b.valor_budget_materiais == null || !keys.includes(k)) continue;
      const r = garantir(k); r.budget_custos = Number(b.valor_budget_materiais); r.origem = "painel";
    }
    // linha com nº de PC digitado só sai do "projetado" se esse PC existe de fato (igual à
    // Lista de materiais — sugestão que não casou com nenhum PC continua a comprar)
    const linhasIts = (its.data ?? []) as { empresa: string; codigo_projeto: number; qtd: number | null; cat_valor_unit: number | null; pc_numero: string | null }[];
    const nums = [...new Set(linhasIts.flatMap((i) => String(i.pc_numero ?? "").split(",").map((x) => `${i.empresa}|${x.trim()}`)).filter((x) => !x.endsWith("|")))].slice(0, 400);
    const existe = new Set<string>();
    await Promise.all(nums.map(async (k) => {
      const [emp, num] = k.split("|");
      const { data } = await supaAdmin().schema("orders").rpc("compras_id_por_numero", { p_empresa: emp, p_numero: num, p_tipo: "PC" });
      if (data) existe.add(k);
    }));
    const est = new Map<string, number>();
    for (const i of linhasIts) {
      const pcs = String(i.pc_numero ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (pcs.some((n) => existe.has(`${i.empresa}|${n}`))) continue;
      const k = `${i.empresa}|${i.codigo_projeto}`;
      est.set(k, (est.get(k) ?? 0) + (Number(i.qtd) || 0) * (Number(i.cat_valor_unit) || 0));
    }
    for (const [k, v] of est) { const r = porKey.get(k); if (r) r.estimado_sem_pc = Math.round(v * 100) / 100; }
  } catch { /* sem o resumo da lista, o card segue como antes */ }

  return NextResponse.json({ rows });
}
