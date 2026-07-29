// GET /api/list/rows?view=v_pc_pcs
// Retorna { rows, count, truncated } — usado pelo BoldAvulsosLoader pra fazer
// client-fetch da lista em vez de bloquear o SSR. Autenticação obrigatória.
//
// Views permitidas: v_pc_avulsos, v_pc_pcs, v_pc_projetos.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Views lógicas → materialized views no schema sales (refreshadas a cada 10min via pg_cron).
// A MV lê em <1s vs 10-15s da view crua.
const VIEW_MAP: Record<string, string> = {
  v_pc_avulsos:  "mv_pc_avulsos",
  v_pc_pcs:      "mv_pc_pcs",
  v_pc_projetos: "mv_pc_projetos",
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";
  const mvName = VIEW_MAP[view];
  if (!mvName) return NextResponse.json({ error: "view inválida" }, { status: 400 });
  // PAGE = 1000 é o cap default do PostgREST/Supabase: pedir .limit(2000) volta
  // 1000 silenciosamente. Era esse o bug — /avulsos (1776 rows) recebia só 1000
  // e os alarmes, calculados client-side, subestimavam. Paginamos com .range()
  // até acabar. MAX_ROWS é só safety net contra loop infinito.
  const PAGE = 1000;
  const MAX_ROWS = 20_000;
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(url.searchParams.get("limit") ?? MAX_ROWS)));
  const countMode = url.searchParams.get("count") === "exact" ? "exact" : "estimated";

  // MVs vivem em sales.* — cliente service com schema sales
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  // Ordenação é a mesma em toda página — as chaves são únicas por MV
  // (pv_os_label+ncod_ped em avulsos/projetos, ncod_ped em pcs), então o
  // .range() não pula nem duplica linhas entre páginas.
  const buildPage = (from: number, to: number, withCount: boolean) => {
    let q = withCount
      ? adm.from(mvName).select("*", { count: countMode as "exact" | "estimated" })
      : adm.from(mvName).select("*");
    if (view === "v_pc_pcs") {
      q = q.order("pc_etapa_code", { ascending: true, nullsFirst: false })
           .order("pc_numero",     { ascending: true, nullsFirst: false })
           .order("ncod_ped",      { ascending: true });
    } else {
      q = q.order("pv_os_label", { ascending: true, nullsFirst: false })
           .order("ncod_ped",    { ascending: true });
    }
    return q.range(from, to);
  };

  const rows: Record<string, unknown>[] = [];
  let headerCount: number | null = null;
  let truncated = false;

  for (let offset = 0; ; offset += PAGE) {
    if (offset >= limit) { truncated = true; break; }
    const size = Math.min(PAGE, limit - offset);
    const { data, error, count } = await buildPage(offset, offset + size - 1, offset === 0);
    if (error) return NextResponse.json({ error: `${mvName}: ${error.message}` }, { status: 500 });
    if (offset === 0) headerCount = count ?? null;
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < size) break;   // última página
  }

  // Buscamos a MV inteira, então rows.length É o total — mais confiável que o
  // count "estimated" do planner. Só caímos no header count se batemos MAX_ROWS.
  return NextResponse.json({
    rows,
    count: truncated ? (headerCount ?? rows.length) : rows.length,
    truncated,
  });
}
