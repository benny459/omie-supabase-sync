// GET /api/bi/margem-projeto?from=YYYY-MM-DD&to=YYYY-MM-DD&empresas=SF,CD&media=1
//
// Porte do dashboard "Margem por Projeto — SafeWater" (Metabase id 7), que tinha
// 4 cards: Margem Total (scalar), Margem por Projeto Top 50 (table), Top
// Projetos com Prejuízo (table) e Última Atualização (scalar).
//
// Os dois cards de tabela viraram UMA chamada: são a mesma base, mudando só
// ordenação — o recorte de prejuízo é feito aqui, não no banco.

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

  // A guarda de área vale pra API também, não só pra página: sem isto o dado
  // financeiro sairia por fetch direto de quem não enxerga a área.
  const perms = await loadPerms();
  if (!canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso à área BI" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const media = url.searchParams.get("media") === "1";
  const empresasRaw = (url.searchParams.get("empresas") ?? "").trim();
  const empresas = empresasRaw ? empresasRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  // As funções vivem no schema bi e leem sales.* / finance.*, então usam o
  // cliente service. A autorização já foi feita acima, por área.
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [totalRes, projRes] = await Promise.all([
    adm.rpc("margem_total", {
      p_from: from, p_to: to, p_empresas: empresas, p_media_mensal: media,
    }),
    adm.rpc("margem_por_projeto", { p_from: from, p_to: to, p_empresas: empresas }),
  ]);

  if (totalRes.error) return NextResponse.json({ error: `margem_total: ${totalRes.error.message}` }, { status: 500 });
  if (projRes.error)  return NextResponse.json({ error: `margem_por_projeto: ${projRes.error.message}` }, { status: 500 });

  type Proj = { projeto: string; receita: number; custo: number; margem: number; margem_pct: number | null };
  const projetos = ((projRes.data ?? []) as Proj[]).map((p) => ({
    projeto: p.projeto,
    receita: Number(p.receita) || 0,
    custo:   Number(p.custo)   || 0,
    margem:  Number(p.margem)  || 0,
    margem_pct: p.margem_pct == null ? null : Number(p.margem_pct),
  }));

  // A função já devolve por margem desc. Top 50 e prejuízo são recortes disso.
  const top      = projetos.slice(0, 50);
  const prejuizo = projetos.filter((p) => p.margem < 0).sort((a, b) => a.margem - b.margem).slice(0, 20);

  return NextResponse.json({
    margem_total: Number(totalRes.data) || 0,
    media_mensal: media,
    projetos: top,
    prejuizo,
    total_projetos: projetos.length,
  });
}
