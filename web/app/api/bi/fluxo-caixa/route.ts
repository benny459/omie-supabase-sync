// GET /api/bi/fluxo-caixa?dias=60&ano=2026
//
// Porte dos cards 100, 151, 98, 106 e 71, com escopo fixo e simulação.
//
// O escopo PADRÃO não é simetria — é como o caixa funciona:
//   ENTRADAS  só Safe  — é quem fatura, e a conta Omie.CASH da projeção é dela.
//   SAÍDAS    as três  — o grupo paga tudo do mesmo bolso.
//
// Atraso entra no escopo por PREVISÃO dentro do ano corrente, não por dias de
// vencimento. O critério pega 142 títulos a pagar (o corte por dias pegava 80,
// perdendo os repactuados) e continua descartando R$ 4,35M de passivo sem
// previsão neste ano.
//
// A rota devolve SALDO e TÍTULOS, não a curva pronta: a curva é montada no
// navegador, então base e cenário simulado saem do mesmo código.

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
  // Só quem tem financeiro reagenda — BI é leitura.
  const podeEditar = canViewArea(perms, "financeiro");

  const url = new URL(req.url);
  const diasRaw = Number(url.searchParams.get("dias") ?? 60);
  const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(Math.trunc(diasRaw), 7), 180) : 60;
  // Quanto do passado trazer junto. 0 = só a projeção, que era o comportamento
  // antigo — o padrão não muda sozinho para quem já usa a tela.
  const atrasRaw = Number(url.searchParams.get("dias_atras") ?? 0);
  const diasAtras = Number.isFinite(atrasRaw)
    ? Math.min(Math.max(Math.trunc(atrasRaw), 0), 365) : 0;
  const anoRaw = Number(url.searchParams.get("ano"));
  const ano = Number.isSafeInteger(anoRaw) && anoRaw > 2000 && anoRaw < 2100 ? anoRaw : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [saldo, titulos, atrasados, contas, cenario, mensal, realizado] = await Promise.all([
    adm.rpc("saldo_conta", { p_empresas: ["SF"] }),
    adm.rpc("fluxo_caixa_titulos", { p_dias: dias, p_so_atrasados: false, p_ano: ano }),
    adm.rpc("fluxo_caixa_titulos", { p_dias: dias, p_so_atrasados: true,  p_ano: ano }),
    adm.rpc("saldo_por_conta", { p_empresas: null }),
    adm.rpc("resultado_acumulado_cenario", { p_ano: ano }),
    adm.rpc("fluxo_mensal_previsto_realizado", { p_ano: ano }),
    // Com 0 nem chama: uma RPC que devolve lista vazia por construção é custo
    // sem informação em toda abertura da tela.
    diasAtras > 0
      ? adm.rpc("fluxo_caixa_realizado", { p_dias_atras: diasAtras })
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const [nome, r] of [
    ["saldo_conta", saldo], ["fluxo_caixa_titulos", titulos],
    ["fluxo_caixa_titulos (atrasados)", atrasados], ["saldo_por_conta", contas],
    ["resultado_acumulado_cenario", cenario], ["fluxo_mensal_previsto_realizado", mensal],
    ["fluxo_caixa_realizado", realizado],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    dias,
    dias_atras: diasAtras,
    realizado: realizado.data ?? [],
    ano: ano ?? new Date().getFullYear(),
    pode_editar: podeEditar,
    saldo_atual: (saldo.data ?? [])[0] ?? null,
    titulos: titulos.data ?? [],
    atrasados: atrasados.data ?? [],
    contas: contas.data ?? [],
    cenario: (cenario.data ?? [])[0] ?? null,
    mensal: mensal.data ?? [],
  });
}
