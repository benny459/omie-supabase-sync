// GET /api/bi/compras?from=&to=&empresas=
//
// Porte da aba "Compras" da Visão Geral — 14 cards.
// Compras = títulos a pagar em 2.01.% (CMV / custo direto). Os cards de
// fornecedor e "A Pagar por Projeto" são compartilhados com o domínio A Pagar e
// reusam as funções tit_*, em vez de ganhar query própria.

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

  const [mensal, projetos, fornecedores] = await Promise.all([
    adm.rpc("compras_mensal", { p_from: from, p_to: to, p_empresas: empresas }),
    adm.rpc("compras_por_projeto", { p_from: from, p_to: to, p_empresas: empresas, p_limit: 20 }),
    adm.rpc("tit_top_contraparte", { p_natureza: "P", p_from: from, p_to: to,
                                     p_empresas: empresas, p_limit: 20, p_pagos: true }),
  ]);

  for (const [n, r] of [["compras_mensal", mensal], ["compras_por_projeto", projetos],
                        ["tit_top_contraparte", fornecedores]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  type M = { mes: string; categoria: string; valor: number; qtd: number };
  const rows = (mensal.data ?? []) as M[];
  const mapa = new Map<string, Record<string, number>>();
  const cats = new Set<string>();
  for (const r of rows) {
    cats.add(r.categoria);
    const linha = mapa.get(r.mes) ?? {};
    linha[r.categoria] = (linha[r.categoria] ?? 0) + (Number(r.valor) || 0);
    mapa.set(r.mes, linha);
  }

  return NextResponse.json({
    total: rows.reduce((a, r) => a + (Number(r.valor) || 0), 0),
    qtd:   rows.reduce((a, r) => a + (Number(r.qtd) || 0), 0),
    mensal: Array.from(mapa.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ x: mes, ...v })),
    categorias: Array.from(cats).sort(),
    projetos: ((projetos.data ?? []) as Array<{ projeto: string; valor: number; qtd: number }>)
      .map((p) => ({ chave: p.projeto, valor: Number(p.valor) || 0, qtd: Number(p.qtd) || 0 })),
    fornecedores: ((fornecedores.data ?? []) as Array<{ contraparte: string; valor: number; qtd: number }>)
      .map((f) => ({ chave: f.contraparte, valor: Number(f.valor) || 0, qtd: Number(f.qtd) || 0 })),
  });
}
