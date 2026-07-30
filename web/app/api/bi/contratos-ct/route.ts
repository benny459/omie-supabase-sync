// GET /api/bi/contratos-ct?from=&to=&empresas=SF,CD&media=1
//
// Porte do dashboard "Contratos CT — SafeWater" (Metabase id 6), 6 cards:
// Faturamento Lifetime, Contratos Ativos, Faturado no Período (scalars),
// Top Contratos (row), CT Mensal Criado vs Faturado (line) e Última Atualização.
//
// O card "Última Atualização" é compartilhado por 3 dashboards — resolvido aqui
// com uma leitura direta em sales.sync_state, sem precisar de função.

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
  const media = url.searchParams.get("media") === "1";
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );
  // sync_state vive em sales, não em bi — cliente separado.
  const admSales = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  const [resumo, top, mensal, sync] = await Promise.all([
    adm.rpc("ct_resumo", { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: null, p_media_mensal: media }),
    adm.rpc("ct_top_contratos", { p_empresas: empresas, p_cat_venda: null, p_limit: 30 }),
    adm.rpc("ct_mensal", { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: null }),
    admSales.from("sync_state").select("last_sync_at")
      .eq("ultima_execucao_status", "SUCESSO")
      .order("last_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  for (const [nome, r] of [["ct_resumo", resumo], ["ct_top_contratos", top], ["ct_mensal", mensal]] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  // ct_resumo é uma função de tabela com uma linha só.
  const head = (Array.isArray(resumo.data) ? resumo.data[0] : resumo.data) as
    { faturado_lifetime: number; faturado_periodo: number; contratos_ativos: number } | null;

  return NextResponse.json({
    faturado_lifetime: Number(head?.faturado_lifetime) || 0,
    faturado_periodo:  Number(head?.faturado_periodo)  || 0,
    contratos_ativos:  Number(head?.contratos_ativos)  || 0,
    media_mensal: media,
    top: ((top.data ?? []) as Array<{ contrato: string; receita_lifetime: number }>).map((r) => ({
      contrato: r.contrato,
      receita: Number(r.receita_lifetime) || 0,
    })),
    mensal: ((mensal.data ?? []) as Array<{ mes: string; valor_criado: number; valor_faturado: number; qtd_criada: number }>)
      .map((r) => ({
        mes: r.mes,
        criado: Number(r.valor_criado) || 0,
        faturado: Number(r.valor_faturado) || 0,
        qtd: Number(r.qtd_criada) || 0,
      })),
    ultima_sync: (sync.data as { last_sync_at?: string } | null)?.last_sync_at ?? null,
  });
}
