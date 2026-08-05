// GET /api/bi/fluxo-caixa?dias=60&receber=SF&pagar=SF,CD,WW&atrasoMax=60
//
// Porte dos cards 100, 151 e 98, com escopo separado por natureza e simulação
// de datas.
//
// O escopo PADRÃO não é simetria — é como o caixa funciona:
//
//   ENTRADAS: só Safe. É quem fatura, e a conta Omie.CASH que ancora a projeção
//   é dela. Entrada de CDG/Water cai em outro caixa. Todos os atrasos entram.
//
//   SAÍDAS: as três empresas. O grupo paga tudo do mesmo bolso, então a conta da
//   CDG e da Water pesa aqui mesmo não sendo faturamento da Safe.
//
// O corte de 60 dias de atraso vale só pras saídas, e separa atraso de passivo
// morto: R$ 441k com até 60 dias entram; R$ 4,43M com até 2.676 dias ficam fora.
// Os de baixo não são previsão de pagamento — são passivo antigo que não vai
// liquidar nesta janela, e afundariam a curva num patamar que nunca acontece.
//
// A rota devolve SALDO DE PARTIDA e TÍTULOS, não a curva pronta: a curva é
// montada no navegador, então base e simulação saem do mesmo código.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMPRESAS_VALIDAS = new Set(["SF", "CD", "WW"]);

const lista = (raw: string | null, padrao: string[]) => {
  const v = (raw ?? "").split(",").map((s) => s.trim()).filter((s) => EMPRESAS_VALIDAS.has(s));
  return v.length ? v : padrao;
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
  const empReceber = lista(url.searchParams.get("receber"), ["SF"]);
  const empPagar   = lista(url.searchParams.get("pagar"),   ["SF", "CD", "WW"]);
  const atrasoRaw = Number(url.searchParams.get("atrasoMax") ?? 60);
  const atrasoMax = Number.isFinite(atrasoRaw) ? Math.min(Math.max(Math.trunc(atrasoRaw), 0), 3650) : 60;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const escopo = {
    p_emp_receber: empReceber,
    p_emp_pagar: empPagar,
    p_atraso_max_pagar: atrasoMax,
  };

  const [saldo, titulos, atrasados, contas] = await Promise.all([
    // O saldo ancora na conta da Safe — é dela a Omie.CASH da projeção.
    adm.rpc("saldo_conta", { p_empresas: ["SF"] }),
    adm.rpc("fluxo_caixa_titulos", { p_dias: dias, ...escopo, p_so_atrasados: false }),
    // A simulação só lida com atrasado: título a vencer tem data contratada,
    // não hipótese a testar.
    adm.rpc("fluxo_caixa_titulos", { p_dias: dias, ...escopo, p_so_atrasados: true }),
    adm.rpc("saldo_por_conta", { p_empresas: null }),
  ]);

  for (const [nome, r] of [
    ["saldo_conta", saldo], ["fluxo_caixa_titulos", titulos],
    ["fluxo_caixa_titulos (atrasados)", atrasados], ["saldo_por_conta", contas],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    dias,
    emp_receber: empReceber,
    emp_pagar: empPagar,
    atraso_max: atrasoMax,
    saldo_atual: (saldo.data ?? [])[0] ?? null,
    titulos: titulos.data ?? [],
    atrasados: atrasados.data ?? [],
    contas: contas.data ?? [],
  });
}
