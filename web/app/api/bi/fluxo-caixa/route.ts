// GET /api/bi/fluxo-caixa?dias=60&empresas=SF
//
// Porte dos cards 100 (projeção 60 dias), 151 (saldo Omie.CASH) e 98 (saldo por
// conta). Projeta dia a dia: saldo de hoje + entradas previstas − saídas
// previstas, acumulado.
//
// O card original é de eixo duplo (barras num eixo, saldo no outro). Aqui sai
// desdobrado em dois painéis com o mesmo eixo X — eixo duplo deixa a relação
// entre as duas medidas depender da escala escolhida, e a leitura vira artefato
// do desenho em vez do dado.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

type DiaRow = {
  dia: string; entradas: number; saidas: number; liquido: number; saldo_projetado: number;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a fluxo de caixa" }, { status: 403 });
  }

  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? 60);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(Math.trunc(diasRaw), 7), 180) : 60;
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [fluxo, saldo, contas] = await Promise.all([
    adm.rpc("fluxo_caixa_projetado", { p_dias: dias, p_empresas: empresas }),
    adm.rpc("saldo_conta", { p_empresas: empresas }),
    adm.rpc("saldo_por_conta", { p_empresas: empresas }),
  ]);

  for (const [nome, r] of [
    ["fluxo_caixa_projetado", fluxo], ["saldo_conta", saldo], ["saldo_por_conta", contas],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  const linhas = (fluxo.data ?? []) as DiaRow[];
  const saldos = linhas.map((l) => Number(l.saldo_projetado) || 0);
  // O dia mais apertado da janela é a informação que decide ação; achar isso
  // olhando a curva é justamente o que dá errado.
  let piorIdx = 0;
  saldos.forEach((v, i) => { if (v < saldos[piorIdx]) piorIdx = i; });

  return NextResponse.json({
    dias,
    saldo_atual: (saldo.data ?? [])[0] ?? null,
    fluxo: linhas,
    contas: contas.data ?? [],
    resumo: {
      total_entradas: linhas.reduce((s, l) => s + (Number(l.entradas) || 0), 0),
      total_saidas:   linhas.reduce((s, l) => s + (Number(l.saidas) || 0), 0),
      pior_dia:       linhas[piorIdx]?.dia ?? null,
      pior_saldo:     saldos[piorIdx] ?? 0,
      dias_negativos: saldos.filter((v) => v < 0).length,
    },
  });
}
