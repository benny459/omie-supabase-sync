// GET /api/bi/custo-cliente/memorial?customer_id=...&from=&to=
//
// Memória de cálculo de UM cliente: como o custo dele foi montado, item a item.
//
// Existe porque um total agregado não se audita. Quando alguém pergunta "por que
// este cliente custou R$ 28 mil?", a resposta tem que ser a lista de OS com
// horas × valor/hora, as despesas aprovadas uma a uma, e o rateio de combustível
// com o km e o custo por km que o produziram. Sem isso o número é para acreditar,
// não para conferir.
//
// As três views vêm do app de serviços, onde o cálculo acontece:
//   v_custo_os_detalhe            → o tempo (horas × valor/hora, por OS)
//   v_despesas_detalhe            → a despesa (valor, desconto, valor coberto)
//   v_combustivel_alocado_detalhe → o rateio (km × custo/km)

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { wwClient } from "@/lib/owner-clients";
import { selectPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const url = new URL(req.url);
  // Aceita lista: um código Omie pode agrupar vários clientes do app, e o
  // memorial tem que cobrir todos pra fechar com o total da linha.
  const ids = (url.searchParams.get("customer_id") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const from = url.searchParams.get("from") || "2020-01-01";
  const to   = url.searchParams.get("to")   || "2099-12-31";

  if (!ids.length) {
    return NextResponse.json({ error: "customer_id obrigatório" }, { status: 400 });
  }

  const ww = wwClient();
  if (!ww) return NextResponse.json({ error: "App de serviços não configurado" }, { status: 503 });
  const bi = ww.schema("bi" as never);

  // O mês do rateio de combustível é o primeiro dia do mês; alinhar o filtro
  // evita perder o mês da ponta.
  const mesDe = from.slice(0, 8) + "01";

  const [oss, despesas, combustivel] = await Promise.all([
    selectPaginado(() => bi.from("v_custo_os_detalhe")
      .select("service_order_id, service_id, tipo_venda, technician_nome, dia, checkin_datetime, checkout_datetime, horas, valor_hora, status")
      .in("customer_id", ids)
      .gte("dia", from).lte("dia", to)
      .order("dia", { ascending: false }) as never, 5000),
    selectPaginado(() => bi.from("v_despesas_detalhe")
      .select("expense_id, data_despesa, tipo_despesa, categoria, descricao, estabelecimento, employee_nome, valor, valor_a_descontar, valor_coberto, aprovado")
      .in("customer_id", ids)
      .gte("data_despesa", from).lte("data_despesa", to)
      .order("data_despesa", { ascending: false }) as never, 5000),
    selectPaginado(() => bi.from("v_combustivel_alocado_detalhe")
      .select("periodo_mes, technician_nome, km_total, km_real, km_teorico, qtd_viagens, preco_litro, consumo_km_l, custo_por_km, combustivel_alocado")
      .in("customer_id", ids)
      .gte("periodo_mes", mesDe).lte("periodo_mes", to)
      .order("periodo_mes", { ascending: false }) as never, 5000),
  ]);

  for (const [nome, r] of [["OS", oss], ["despesas", despesas], ["combustível", combustivel]] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 502 });
  }

  const num = (v: unknown) => Number(v) || 0;
  type OS = { horas?: unknown; valor_hora?: unknown; technician_nome?: string | null };
  type Desp = { valor_coberto?: unknown; tipo_despesa?: string | null; aprovado?: unknown };

  const listaOs = (oss.data ?? []) as OS[];
  const listaDesp = (despesas.data ?? []) as Desp[];
  const listaComb = (combustivel.data ?? []) as Array<{ combustivel_alocado?: unknown }>;

  // Despesa por tipo: é onde se vê se o custo é de material, alimentação,
  // hospedagem… O nome do tipo vem da origem, não traduzo.
  const porTipoDespesa = new Map<string, number>();
  for (const d of listaDesp) {
    const t = d.tipo_despesa ?? "(sem tipo)";
    porTipoDespesa.set(t, (porTipoDespesa.get(t) ?? 0) + num(d.valor_coberto));
  }

  return NextResponse.json({
    resumo: {
      qtd_os: listaOs.length,
      horas: listaOs.reduce((a, o) => a + num(o.horas), 0),
      custo_mao_obra: listaOs.reduce((a, o) => a + num(o.horas) * num(o.valor_hora), 0),
      qtd_despesas: listaDesp.length,
      // valor_coberto = valor menos o que o funcionário devolve. É o que a
      // empresa realmente pagou; usar `valor` superestimaria o custo.
      despesas: listaDesp.reduce((a, d) => a + num(d.valor_coberto), 0),
      combustivel: listaComb.reduce((a, c) => a + num(c.combustivel_alocado), 0),
      tecnicos: new Set(listaOs.map((o) => o.technician_nome).filter(Boolean)).size,
    },
    por_tipo_despesa: Array.from(porTipoDespesa.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    oss: listaOs,
    despesas: listaDesp,
    combustivel: listaComb,
  });
}
