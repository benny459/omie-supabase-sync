// GET /api/bi/financeiro?from=&to=
//
// Alimenta as abas ANÁLISE e RECEBÍVEIS da tela Financeiro consolidada.
//
// ── Por que uma rota só ──────────────────────────────────────────────────────
// As funções tit_* já são simétricas: todas recebem p_natureza. Era isso que
// permitia a mesma pergunta ser respondida em duas telas com dois códigos
// diferentes — e é isso que permite unificar. Buscando os dois lados aqui, a
// tela troca de lado sem ir ao servidor de novo, e o total "ambos" é somável
// porque veio da mesma consulta.
//
// A aba FLUXO não passa por aqui: ela continua usando /api/bi/fluxo-caixa sem
// nenhuma mudança, para não perder nada do que já funciona lá (as duas curvas,
// o recebimento de atrasos simulado, o envio ao Omie, o rateio, a renegociação).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { rpcPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Escopo fixo, o mesmo do fluxo: recebe Safe, paga o grupo. Deixar explícito
 *  evita a pergunta "esses números são de qual empresa?" a cada leitura. */
const EMP_RECEBER = ["SF"];
const EMP_PAGAR   = ["SF", "CD", "WW"];

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ano = new Date().getFullYear();
  const from = url.searchParams.get("from") || `${ano}-01-01`;
  const to   = url.searchParams.get("to")   || `${ano}-12-31`;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [
    agingP, agingR, horizP, horizR, mensalP, mensalR,
    resumoP, resumoR, coorte, coorteCat, topForn, topCli,
  ] = await Promise.all([
    adm.rpc("tit_aging",     { p_natureza: "P", p_empresas: EMP_PAGAR }),
    adm.rpc("tit_aging",     { p_natureza: "R", p_empresas: EMP_RECEBER }),
    adm.rpc("tit_horizonte", { p_natureza: "P", p_empresas: EMP_PAGAR }),
    adm.rpc("tit_horizonte", { p_natureza: "R", p_empresas: EMP_RECEBER }),
    adm.rpc("tit_mensal",    { p_natureza: "P", p_from: from, p_to: to, p_empresas: EMP_PAGAR }),
    adm.rpc("tit_mensal",    { p_natureza: "R", p_from: from, p_to: to, p_empresas: EMP_RECEBER }),
    adm.rpc("tit_resumo",    { p_natureza: "P", p_empresas: EMP_PAGAR }),
    adm.rpc("tit_resumo",    { p_natureza: "R", p_empresas: EMP_RECEBER }),
    adm.rpc("fat_coorte",           { p_from: from, p_to: to }),
    adm.rpc("fat_coorte_categoria", { p_from: from, p_to: to }),
    adm.rpc("tit_top_contraparte", { p_natureza: "P", p_from: from, p_to: to, p_empresas: EMP_PAGAR, p_limit: 12 }),
    adm.rpc("tit_top_contraparte", { p_natureza: "R", p_from: from, p_to: to, p_empresas: EMP_RECEBER, p_limit: 12 }),
  ]);

  // Erro de QUALQUER uma derruba a resposta inteira, com o nome da função. Uma
  // tela que carrega pela metade e não diz qual pedaço faltou é pior que uma que
  // não carrega — foi assim que já publicamos KPI com um terço dos dados.
  const falha = ([
    ["tit_aging(P)", agingP], ["tit_aging(R)", agingR],
    ["tit_horizonte(P)", horizP], ["tit_horizonte(R)", horizR],
    ["tit_mensal(P)", mensalP], ["tit_mensal(R)", mensalR],
    ["tit_resumo(P)", resumoP], ["tit_resumo(R)", resumoR],
    ["fat_coorte", coorte], ["fat_coorte_categoria", coorteCat],
    ["tit_top_contraparte(P)", topForn], ["tit_top_contraparte(R)", topCli],
  ] as const).find(([, r]) => r.error);
  if (falha) {
    return NextResponse.json(
      { error: `${falha[0]}: ${falha[1].error!.message}` }, { status: 500 });
  }

  return NextResponse.json({
    periodo: { from, to },
    escopo: { recebe: EMP_RECEBER, paga: EMP_PAGAR },
    aging:     { sai: agingP.data ?? [],  entra: agingR.data ?? [] },
    horizonte: { sai: horizP.data ?? [],  entra: horizR.data ?? [] },
    mensal:    { sai: mensalP.data ?? [], entra: mensalR.data ?? [] },
    resumo:    { sai: (resumoP.data ?? [])[0] ?? null, entra: (resumoR.data ?? [])[0] ?? null },
    coorte:    coorte.data ?? [],
    coorte_categoria: coorteCat.data ?? [],
    top:       { sai: topForn.data ?? [], entra: topCli.data ?? [] },
  });
}
