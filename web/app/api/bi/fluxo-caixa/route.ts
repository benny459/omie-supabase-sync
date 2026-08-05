// GET /api/bi/fluxo-caixa?dias=60&empresas=SF&atraso=1
//
// Porte dos cards 100 (projeção 60 dias), 151 (saldo Omie.CASH) e 98 (saldo por
// conta), com simulação de novas datas de previsão.
//
// A rota devolve o SALDO DE PARTIDA e os TÍTULOS, não a curva pronta. A curva é
// montada no navegador — assim a projeção de base e a simulação saem do mesmo
// código, e mexer numa data não faz a curva pular por diferença de
// arredondamento entre dois cálculos diferentes.
//
// Empresa: a conta Omie.CASH da projeção é da SF. CDG e Water têm as suas
// próprias. Por isso o padrão é SF — sem o filtro, a curva descontava do caixa
// da Safe os títulos a pagar das outras duas (R$ 105,2k em 60 dias) sem contar
// nenhuma entrada delas, o que só empurrava a curva pra baixo sem significado.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const incluirAtraso = url.searchParams.get("atraso") === "1";
  const empRaw = (url.searchParams.get("empresas") ?? "SF").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [saldo, titulos, contas] = await Promise.all([
    adm.rpc("saldo_conta", { p_empresas: empresas }),
    adm.rpc("fluxo_caixa_titulos", {
      p_dias: dias, p_empresas: empresas, p_incluir_atraso: incluirAtraso,
    }),
    adm.rpc("saldo_por_conta", { p_empresas: empresas }),
  ]);

  for (const [nome, r] of [
    ["saldo_conta", saldo], ["fluxo_caixa_titulos", titulos], ["saldo_por_conta", contas],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    dias,
    empresas,
    incluir_atraso: incluirAtraso,
    saldo_atual: (saldo.data ?? [])[0] ?? null,
    titulos: titulos.data ?? [],
    contas: contas.data ?? [],
  });
}
