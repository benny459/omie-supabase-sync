// GET /api/bi/contas-receber?from=&to=&empresas=SF&cat=&carteira=1&base=previsao
//
// Porte do domínio "A Receber" (dashboard 4 + aba da Visão Geral) — 30 cards
// distintos, cobertos por 3 funções: ar_resumo (os 7 scalars), ar_aging e
// ar_mensal.

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
    return NextResponse.json({ error: "Sem acesso a Contas a Receber" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const carteira = url.searchParams.get("carteira") === "1";
  const base = url.searchParams.get("base") === "vencimento" ? "vencimento" : "previsao";
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

  const [resumo, aging, mensal, detalhe] = await Promise.all([
    adm.rpc("ar_resumo", { p_empresas: empresas, p_cat_venda: cat, p_so_carteira: carteira, p_base_data: base }),
    adm.rpc("ar_aging",  { p_empresas: empresas, p_cat_venda: cat, p_so_carteira: carteira, p_base_data: base }),
    adm.rpc("ar_mensal", { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat, p_so_carteira: carteira }),
    adm.rpc("titulos_detalhe", { p_natureza: "R", p_from: null, p_to: null, p_empresas: empresas,
                                 p_apenas_abertos: true, p_base_data: base, p_limit: 500 }),
  ]);

  for (const [n, r] of [["ar_resumo", resumo], ["ar_aging", aging], ["ar_mensal", mensal],
                        ["titulos_detalhe", detalhe]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const head = (Array.isArray(resumo.data) ? resumo.data[0] : resumo.data) as Record<string, unknown> | null;
  const num = (k: string) => Number(head?.[k]) || 0;

  return NextResponse.json({
    saldo_aberto: num("saldo_aberto"),
    qtd_titulos:  num("qtd_titulos"),
    a_vencer:     num("a_vencer"),
    vence_hoje:   num("vence_hoje"),
    vence_amanha: num("vence_amanha"),
    esta_semana:  num("esta_semana"),
    em_atraso:    num("em_atraso"),
    aging: ((aging.data ?? []) as Array<{ faixa: string; ord: number; qtd: number; valor: number }>)
      .map((a) => ({ faixa: a.faixa, ord: Number(a.ord), qtd: Number(a.qtd) || 0, valor: Number(a.valor) || 0 })),
    mensal: ((mensal.data ?? []) as Array<{ mes: string; emitido: number; recebido: number }>)
      .map((m) => ({ x: m.mes, emitido: Number(m.emitido) || 0, recebido: Number(m.recebido) || 0 })),
    detalhe: detalhe.data ?? [],
    recorte: { carteira, base },
  });
}
