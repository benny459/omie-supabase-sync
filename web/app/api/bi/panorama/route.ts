// GET /api/bi/panorama?from=&to=&empresas=&aba=
//
// Fecha os domínios restantes num endpoint só, porque são telas pequenas que
// compartilham a mesma janela de filtro: Visão Geral (raiz), Atraso, Previsão de
// Recebimento, Aquisição vs Recorrente e Rentabilidade.
//
// Boa parte dos cards originais já era coberta por tit_resumo / tit_aging /
// dre_saidas — aqui só o que era pergunta nova.

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
  if (!canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso à área BI" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [saldo, ciclo, atraso, previsao, aquisicao, rentab, resumoAR, agingAR] = await Promise.all([
    adm.rpc("saldo_caixa", {}),
    adm.rpc("ciclo_financeiro", { p_from: from, p_to: to, p_empresas: empresas }),
    adm.rpc("clientes_em_atraso", { p_empresas: empresas, p_limit: 30 }),
    adm.rpc("previsao_recebimento", { p_semanas: 12, p_empresas: empresas }),
    adm.rpc("aquisicao_recorrente", { p_meses: 18, p_empresas: empresas }),
    adm.rpc("rentabilidade_cliente", { p_from: from, p_to: to, p_limit: 40 }),
    adm.rpc("tit_resumo", { p_natureza: "R", p_empresas: empresas, p_cat_venda: null,
                            p_so_carteira: false, p_base_data: "previsao" }),
    adm.rpc("tit_aging", { p_natureza: "R", p_empresas: empresas, p_cat_venda: null,
                           p_so_carteira: false, p_base_data: "previsao" }),
  ]);

  for (const [n, r] of [["saldo_caixa", saldo], ["ciclo_financeiro", ciclo],
                        ["clientes_em_atraso", atraso], ["previsao_recebimento", previsao],
                        ["aquisicao_recorrente", aquisicao], ["rentabilidade_cliente", rentab],
                        ["tit_resumo", resumoAR], ["tit_aging", agingAR]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const one = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
  const S = one(saldo.data), AR = one(resumoAR.data);
  const num = (o: Record<string, unknown> | null, k: string) => Number(o?.[k]) || 0;

  // Aquisição vs recorrente: pivota por mês, uma coluna por tipo.
  type Aq = { mes: string; tipo_venda: string; valor: number; qtd: number };
  const porMes = new Map<string, Record<string, number>>();
  const tipos = new Set<string>();
  for (const r of (aquisicao.data ?? []) as Aq[]) {
    tipos.add(r.tipo_venda);
    const l = porMes.get(r.mes) ?? {};
    l[r.tipo_venda] = (l[r.tipo_venda] ?? 0) + (Number(r.valor) || 0);
    porMes.set(r.mes, l);
  }

  return NextResponse.json({
    saldo: { valor: num(S, "saldo"), referencia: S?.referencia ?? null, origem: S?.origem ?? null },
    ciclo: ((ciclo.data ?? []) as Array<{ etapa: string; ord: number; dias: number }>)
      .map((c) => ({ etapa: c.etapa, ord: Number(c.ord), dias: Number(c.dias) || 0 })),
    ar: {
      saldo_aberto: num(AR, "saldo_aberto"),
      em_atraso: num(AR, "em_atraso"),
      a_vencer: num(AR, "a_vencer"),
      qtd: num(AR, "qtd_titulos"),
      aging: ((agingAR.data ?? []) as Array<{ faixa: string; ord: number; qtd: number; valor: number }>)
        .map((a) => ({ faixa: a.faixa, ord: Number(a.ord), qtd: Number(a.qtd) || 0, valor: Number(a.valor) || 0 })),
    },
    clientes_atraso: ((atraso.data ?? []) as Array<{ cliente: string; cnpj: string; atraso_dias: number; valor: number; titulos: number }>)
      .map((c) => ({ cliente: c.cliente, cnpj: c.cnpj, dias: Number(c.atraso_dias) || 0,
                     valor: Number(c.valor) || 0, titulos: Number(c.titulos) || 0 })),
    previsao: ((previsao.data ?? []) as Array<{ semana: string; inicio: string; valor: number; titulos: number }>)
      .map((p) => ({ x: p.semana, valor: Number(p.valor) || 0, titulos: Number(p.titulos) || 0 })),
    aquisicao: {
      rows: Array.from(porMes.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, v]) => ({ x: mes, ...v })),
      tipos: Array.from(tipos).sort(),
    },
    rentabilidade: ((rentab.data ?? []) as Array<{ cliente: string; faturamento: number; compras: number;
                     despesas: number; mao_obra: number; rentabilidade: number; margem: number | null }>)
      .map((r) => ({
        cliente: r.cliente,
        faturamento: Number(r.faturamento) || 0,
        compras: Number(r.compras) || 0,
        despesas: Number(r.despesas) || 0,
        mao_obra: Number(r.mao_obra) || 0,
        rentabilidade: Number(r.rentabilidade) || 0,
        margem: r.margem == null ? null : Number(r.margem),
      })),
  });
}
