// GET /api/bi/dre?from=&to=&empresas=SF&macro=&media=1
//
// Porte da aba "DRE" da Visão Geral (Metabase dashboard 2), 6 cards:
// DRE Resumida (table), Saídas Macro (pie), Saídas por Grupo (pie),
// Saídas Macro Mensal (bar), Saídas por Grupo Mensal (bar) e o detalhe.
//
// 6 cards = 2 funções. dre_saidas serve pie e bar, agregado ou mensal, porque a
// diferença entre eles era só GROUP BY — no Metabase eram 4 queries copiadas.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

type Saida = { mes: string | null; grupo: string; macro: string; qtd: number; valor: number };

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    // DRE é financeiro puro — exige uma das duas áreas.
    return NextResponse.json({ error: "Sem acesso a DRE" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const macro = url.searchParams.get("macro") || null;
  const media = url.searchParams.get("media") === "1";
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [dre, agregado, mensal, detalhe] = await Promise.all([
    adm.rpc("dre_resumida", { p_from: from, p_to: to, p_empresas: empresas }),
    adm.rpc("dre_saidas", {
      p_from: from, p_to: to, p_empresas: empresas,
      p_macro_grupo: macro, p_media_mensal: media, p_por_mes: false,
    }),
    adm.rpc("dre_saidas", {
      p_from: from, p_to: to, p_empresas: empresas,
      p_macro_grupo: macro, p_media_mensal: false, p_por_mes: true,
    }),
    adm.rpc("dre_saidas_detalhe", { p_from: from, p_to: to, p_empresas: empresas, p_limit: 300 }),
  ]);

  for (const [n, r] of [["dre_resumida", dre], ["dre_saidas", agregado], ["dre_saidas mensal", mensal],
                        ["dre_saidas_detalhe", detalhe]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const ag = ((agregado.data ?? []) as Saida[]).map((r) => ({
    grupo: r.grupo, macro: r.macro, qtd: Number(r.qtd) || 0, valor: Number(r.valor) || 0,
  }));

  // Série mensal pivotada por grupo — o gráfico precisa de uma coluna por série.
  const porMes = new Map<string, Record<string, number>>();
  const gruposSet = new Set<string>();
  for (const r of (mensal.data ?? []) as Saida[]) {
    if (!r.mes) continue;
    gruposSet.add(r.grupo);
    const linha = porMes.get(r.mes) ?? {};
    linha[r.grupo] = (linha[r.grupo] ?? 0) + (Number(r.valor) || 0);
    porMes.set(r.mes, linha);
  }
  const mensalRows = Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, vals]) => ({ x: mes, ...vals }));

  return NextResponse.json({
    dre: ((dre.data ?? []) as Array<{ ord: number; linha: string; valor: number; pct_faturamento: number | null }>)
      .map((l) => ({
        ord: Number(l.ord), linha: l.linha,
        valor: Number(l.valor) || 0,
        pct: l.pct_faturamento == null ? null : Number(l.pct_faturamento),
      })),
    // Macro: agrega os grupos. É o pie "Macro DRE".
    macro: Object.entries(
      ag.reduce<Record<string, number>>((acc, r) => {
        acc[r.macro] = (acc[r.macro] ?? 0) + r.valor;
        return acc;
      }, {}),
    ).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    grupos: ag.map((r) => ({ label: r.grupo, value: r.valor, qtd: r.qtd }))
              .sort((a, b) => b.value - a.value),
    mensal: mensalRows,
    grupos_series: Array.from(gruposSet).sort(),
    detalhe: detalhe.data ?? [],
  });
}
