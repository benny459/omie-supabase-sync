// GET /api/bi/compras-cadeia?from=&to=&empresas=SF&base=previsao
//
// Porte dos 6 cards de cadeia de compras do Metabase (43, 83, 136, 145, 166, 172):
// o caminho do dinheiro de compra — título a pagar → PC → aprovação → PV/OS →
// NF pro cliente → recebimento.
//
// Os 6 cards repetiam a mesma espinha de CTEs. Aqui ela vive na view
// bi.v_compras_pc_aprov e as funções leem de lá. Não é só economia: foi a cópia
// que espalhou por 5 cards o join com a condição comentada (ver o comentário da
// view). Uma fonte, um lugar pra consertar.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASES = new Set(["previsao", "emissao", "pagamento"]);

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a cadeia de compras" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const baseRaw = url.searchParams.get("base") ?? "previsao";
  // Vai direto pra um CASE dentro do SQL; whitelist em vez de confiar na query.
  const base = BASES.has(baseRaw) ? baseRaw : "previsao";
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const periodo = { p_from: from, p_to: to, p_empresas: empresas };

  const [resumo, aprovacao, cadeia, rastreio, naoFaturadas, cobertura] = await Promise.all([
    adm.rpc("compras_cadeia_resumo",      { ...periodo, p_base: base }),
    adm.rpc("compras_status_aprovacao",   { ...periodo, p_base: base }),
    adm.rpc("compras_cadeia",             { ...periodo, p_base: base, p_apenas_pagos: false, p_limit: 800 }),
    // Card 145 ancorava na data de PAGAMENTO, não na previsão — é outra
    // pergunta ("o que já saiu do caixa voltou?"), então mantém o próprio eixo.
    adm.rpc("compras_cadeia",             { ...periodo, p_base: "pagamento", p_apenas_pagos: true, p_limit: 500 }),
    adm.rpc("compras_pagas_nao_faturadas",{ ...periodo, p_limit: 300 }),
    // Cobertura é vitalícia por projeto — filtrar por período faria todo projeto
    // em andamento parecer descoberto. Só o filtro de empresa se aplica.
    adm.rpc("cobertura_projeto",          { p_empresas: empresas, p_limit: 300 }),
  ]);

  for (const [nome, r] of [
    ["compras_cadeia_resumo", resumo], ["compras_status_aprovacao", aprovacao],
    ["compras_cadeia", cadeia], ["compras_cadeia (pagos)", rastreio],
    ["compras_pagas_nao_faturadas", naoFaturadas], ["cobertura_projeto", cobertura],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  const res = (resumo.data ?? [])[0] ?? null;

  return NextResponse.json({
    resumo: res,
    aprovacao: aprovacao.data ?? [],
    cadeia: cadeia.data ?? [],
    rastreio: rastreio.data ?? [],
    nao_faturadas: naoFaturadas.data ?? [],
    cobertura: cobertura.data ?? [],
  });
}
