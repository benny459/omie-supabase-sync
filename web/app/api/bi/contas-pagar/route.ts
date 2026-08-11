// GET /api/bi/contas-pagar?from=&to=&empresas=&horizonte=90&base=previsao
//
// Porte do domínio "A Pagar" (dashboard 5 + aba da Visão Geral) — 25 cards.
// Usa as funções genéricas tit_* com natureza='P': a lógica é a mesma do A
// Receber e vive num lugar só.

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
    return NextResponse.json({ error: "Sem acesso a Contas a Pagar" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const base = url.searchParams.get("base") === "vencimento" ? "vencimento" : "previsao";
  const horizonte = Math.min(Math.max(Number(url.searchParams.get("horizonte") ?? 90) || 90, 1), 730);
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [resumo, horiz, aging, mensal, grupos, top, agenda, faixas, horizMes] = await Promise.all([
    adm.rpc("tit_resumo", { p_natureza: "P", p_empresas: empresas, p_cat_venda: null,
                            p_so_carteira: false, p_base_data: base }),
    adm.rpc("tit_horizonte", { p_natureza: "P", p_empresas: empresas,
                               p_horizonte: horizonte, p_base_data: base }),
    adm.rpc("tit_aging", { p_natureza: "P", p_empresas: empresas, p_cat_venda: null,
                           p_so_carteira: false, p_base_data: base }),
    adm.rpc("tit_mensal", { p_natureza: "P", p_from: from, p_to: to, p_empresas: empresas,
                            p_cat_venda: null, p_so_carteira: false }),
    adm.rpc("ap_por_grupo", { p_from: from, p_to: to, p_empresas: empresas }),
    adm.rpc("tit_top_contraparte", { p_natureza: "P", p_from: from, p_to: to,
                                     p_empresas: empresas, p_limit: 20, p_pagos: true }),
    // Agenda compra→venda→pagamento (card 56). Usa o mesmo horizonte já
    // escolhido na tela — um segundo seletor de janela só confundiria.
    // Agenda ÚNICA: absorve o antigo "detalhe de títulos" e inclui os vencidos.
    adm.rpc("ap_agenda", { p_dias: horizonte, p_empresas: empresas,
                           p_base_data: base, p_limit: 1200 }),
    // Faixas e horizonte de calendário NÃO recebem período: dívida vencida não
    // some porque o usuário escolheu "ano até hoje" no filtro de cima.
    // Cortes: atraso até 120 dias, futuro até 12 meses. O que passa disso volta
    // no lado "Além do corte" — a tela informa, não esconde.
    adm.rpc("ap_faixas", { p_natureza: "P", p_empresas: empresas, p_base_data: base,
                           p_atraso_max: 120, p_futuro_max: 365 }),
    adm.rpc("ap_horizonte_mes", { p_empresas: empresas, p_base_data: base }),
  ]);

  for (const [n, r] of [["ap_agenda", agenda], ["ap_faixas", faixas], ["ap_horizonte_mes", horizMes], ["tit_resumo", resumo], ["tit_horizonte", horiz], ["tit_aging", aging],
                        ["tit_mensal", mensal], ["ap_por_grupo", grupos],
                        ["tit_top_contraparte", top]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const one = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
  const R = one(resumo.data), H = one(horiz.data);
  const n = (o: Record<string, unknown> | null, k: string) => Number(o?.[k]) || 0;

  return NextResponse.json({
    saldo_aberto: n(R, "saldo_aberto"),
    qtd_titulos:  n(R, "qtd_titulos"),
    total_pago_ano: n(R, "total_pago_periodo"),
    horizonte: {
      dias: horizonte,
      vencido: n(H, "vencido"),
      no_horizonte: n(H, "vence_no_horizonte"),
      futuro: n(H, "futuro_contratado"),
      sem_data: n(H, "sem_data"),
      qtd_vencido: n(H, "qtd_vencido"),
      qtd_no_horizonte: n(H, "qtd_no_horizonte"),
      qtd_futuro: n(H, "qtd_futuro"),
    },
    aging: ((aging.data ?? []) as Array<{ faixa: string; ord: number; qtd: number; valor: number }>)
      .map((a) => ({ faixa: a.faixa, ord: Number(a.ord), qtd: Number(a.qtd) || 0, valor: Number(a.valor) || 0 })),
    mensal: ((mensal.data ?? []) as Array<{ mes: string; emitido: number; pago: number }>)
      .map((m) => ({ x: m.mes, emitido: Number(m.emitido) || 0, pago: Number(m.pago) || 0 })),
    grupos: ((grupos.data ?? []) as Array<{ grupo: string; macro: string; qtd: number; valor: number }>)
      .map((g) => ({ label: g.grupo, value: Number(g.valor) || 0, macro: g.macro })),
    agenda: agenda.data ?? [],
    faixas: faixas.data ?? [],
    horizonte_mes: (horizMes.data ?? [])[0] ?? null,
    top: ((top.data ?? []) as Array<{ contraparte: string; valor: number; qtd: number }>)
      .map((t) => ({ chave: t.contraparte, valor: Number(t.valor) || 0, qtd: Number(t.qtd) || 0 })),
  });
}
