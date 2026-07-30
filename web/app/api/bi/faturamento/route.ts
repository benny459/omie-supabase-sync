// GET /api/bi/faturamento?from=&to=&empresas=&cat=
//
// Porte do domínio "Faturamento" (dashboard 3 + aba da Visão Geral) — 23 cards
// distintos, cobertos por 4 funções.
//
// NÃO confundir com /api/relatorios/faturamento, que é o faturamento DIÁRIO
// operacional. Este é o analítico: totais, prazos (DSO) e mix por categoria.

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
    return NextResponse.json({ error: "Sem acesso a Faturamento" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const dim  = url.searchParams.get("dim") === "cliente" ? "cliente" : "projeto";
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
  const [resumo, mensal, prazos, top] = await Promise.all([
    adm.rpc("fat_resumo", args),
    adm.rpc("fat_mensal_categoria", args),
    adm.rpc("fat_prazos", args),
    adm.rpc("fat_top", { ...args, p_dim: dim, p_limit: 20 }),
  ]);

  for (const [n, r] of [["fat_resumo", resumo], ["fat_mensal_categoria", mensal],
                        ["fat_prazos", prazos], ["fat_top", top]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const head = (Array.isArray(resumo.data) ? resumo.data[0] : resumo.data) as Record<string, unknown> | null;
  const num = (k: string) => Number(head?.[k]) || 0;

  // Pivota o mensal por categoria — o gráfico quer uma coluna por série.
  type M = { mes: string; categoria: string; valor: number; qtd: number };
  const porMes = new Map<string, Record<string, number>>();
  const cats = new Set<string>();
  for (const r of (mensal.data ?? []) as M[]) {
    cats.add(r.categoria);
    const linha = porMes.get(r.mes) ?? {};
    linha[r.categoria] = (linha[r.categoria] ?? 0) + (Number(r.valor) || 0);
    porMes.set(r.mes, linha);
  }

  type P = { tipo: string; faixa: string; ord: number; qtd: number; media_dias: number };
  const prazoRows = (prazos.data ?? []) as P[];
  const mediaPonderada = (tipo: string) => {
    const rows = prazoRows.filter((r) => r.tipo === tipo);
    const n = rows.reduce((a, r) => a + (Number(r.qtd) || 0), 0);
    if (!n) return null;
    return rows.reduce((a, r) => a + (Number(r.media_dias) || 0) * (Number(r.qtd) || 0), 0) / n;
  };

  return NextResponse.json({
    total_periodo: num("total_periodo"),
    total_ytd:     num("total_ytd"),
    total_mes:     num("total_mes"),
    qtd_notas:     num("qtd_notas"),
    qtd_notas_ytd: num("qtd_notas_ytd"),
    mensal: Array.from(porMes.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ x: mes, ...v })),
    categorias: Array.from(cats).sort(),
    dso: {
      media: mediaPonderada("DSO (efetivo)"),
      faixas: prazoRows.filter((r) => r.tipo === "DSO (efetivo)")
        .map((r) => ({ label: r.faixa, value: Number(r.qtd) || 0 })),
    },
    concedido: {
      media: mediaPonderada("Concedido"),
      faixas: prazoRows.filter((r) => r.tipo === "Concedido")
        .map((r) => ({ label: r.faixa, value: Number(r.qtd) || 0 })),
    },
    top: ((top.data ?? []) as Array<{ chave: string; valor: number; qtd: number }>)
      .map((t) => ({ chave: t.chave, valor: Number(t.valor) || 0, qtd: Number(t.qtd) || 0 })),
    dim,
  });
}
