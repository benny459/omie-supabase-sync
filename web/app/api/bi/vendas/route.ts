// GET /api/bi/vendas?from=&to=&empresas=&cat=
//
// Porte da aba "Vendas" da Visão Geral — 10 cards em 4 funções.
// Vendas = pedidos_venda ∪ ordens_servico na categoria 1.01.%.

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
  const list = (k: string) => {
    const raw = (url.searchParams.get(k) ?? "").trim();
    return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  };
  const empresas = list("empresas");
  const cat = list("cat");

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const args = { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat };
  const [resumo, mensal, pendentes] = await Promise.all([
    adm.rpc("vendas_resumo", args),
    adm.rpc("vendas_mensal", args),
    adm.rpc("vendas_pendentes", { p_empresas: empresas, p_cat_venda: cat, p_limit: 300 }),
  ]);

  for (const [n, r] of [["vendas_resumo", resumo], ["vendas_mensal", mensal],
                        ["vendas_pendentes", pendentes]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const head = (Array.isArray(resumo.data) ? resumo.data[0] : resumo.data) as Record<string, unknown> | null;
  const n = (k: string) => Number(head?.[k]) || 0;

  // Pivota duas vezes: por categoria e por tipo (PV vs OS). No Metabase eram
  // dois cards com queries separadas.
  type M = { mes: string; tipo: string; categoria: string; valor: number; qtd: number };
  const rows = (mensal.data ?? []) as M[];
  const pivot = (campo: "categoria" | "tipo") => {
    const mapa = new Map<string, Record<string, number>>();
    const chaves = new Set<string>();
    for (const r of rows) {
      const k = r[campo];
      chaves.add(k);
      const linha = mapa.get(r.mes) ?? {};
      linha[k] = (linha[k] ?? 0) + (Number(r.valor) || 0);
      mapa.set(r.mes, linha);
    }
    return {
      rows: Array.from(mapa.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, v]) => ({ x: mes, ...v })),
      series: Array.from(chaves).sort(),
    };
  };

  const porCategoria = pivot("categoria");
  const porTipo = pivot("tipo");

  type P = { tipo: string; numero: string; categoria: string; valor: number;
             dt_emissao: string; etapa: string; dias: number };
  const pend = (pendentes.data ?? []) as P[];
  const porEtapa = new Map<string, { qtd: number; valor: number }>();
  for (const p of pend) {
    const cur = porEtapa.get(p.etapa) ?? { qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += Number(p.valor) || 0;
    porEtapa.set(p.etapa, cur);
  }

  return NextResponse.json({
    total_periodo: n("total_periodo"), qtd_periodo: n("qtd_periodo"),
    total_ytd: n("total_ytd"),         qtd_ytd: n("qtd_ytd"),
    total_mes: n("total_mes"),         qtd_mes: n("qtd_mes"),
    total_pv: n("total_pv"),           total_os: n("total_os"),
    mensal_categoria: porCategoria.rows, categorias: porCategoria.series,
    mensal_tipo: porTipo.rows,          tipos: porTipo.series,
    pendentes: {
      qtd: pend.length,
      valor: pend.reduce((a, p) => a + (Number(p.valor) || 0), 0),
      por_etapa: Array.from(porEtapa.entries())
        .map(([label, v]) => ({ label, value: v.valor, qtd: v.qtd }))
        .sort((a, b) => b.value - a.value),
      lista: pend.slice(0, 50),
    },
  });
}
