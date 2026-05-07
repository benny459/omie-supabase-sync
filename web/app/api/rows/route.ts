// Endpoint pra client buscar páginas extras das views (>1000 rows). Usado pelo
// BoldAvulsosView em background depois do SSR inicial pra carregar resto.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_VIEWS = new Set(["v_pc_avulsos", "v_pc_pcs", "v_pc_projetos"]);

const ORDER_BY: Record<string, Array<{ col: string; asc: boolean; nullsFirst?: boolean }>> = {
  v_pc_avulsos:  [{ col: "pv_os_label", asc: true, nullsFirst: false }, { col: "ncod_ped", asc: true }],
  v_pc_projetos: [{ col: "pv_os_label", asc: true, nullsFirst: false }, { col: "ncod_ped", asc: true }],
  v_pc_pcs:      [{ col: "pc_etapa_code", asc: true, nullsFirst: false }, { col: "pc_numero", asc: true, nullsFirst: false }, { col: "ncod_ped", asc: true }],
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";
  const label = url.searchParams.get("label");  // OPCIONAL: filtra por pv_os_label exato
  const pc = url.searchParams.get("pc");        // OPCIONAL: filtra por pc_numero
  const from = Number(url.searchParams.get("from") ?? "0");
  const to = Number(url.searchParams.get("to") ?? "999");

  if (!ALLOWED_VIEWS.has(view)) {
    return NextResponse.json({ error: "view inválida" }, { status: 400 });
  }

  let q = supa.from(view).select("*");
  for (const o of ORDER_BY[view] ?? []) {
    q = q.order(o.col, { ascending: o.asc, nullsFirst: o.nullsFirst });
  }

  // Modo "targeted": busca rows de UM bucket específico (rápido)
  if (label) {
    const { data, error } = await q.eq("pv_os_label", label).limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [], view, label });
  }
  if (pc) {
    const { data, error } = await q.eq("pc_numero", pc).limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data ?? [], view, pc });
  }

  // Modo "página": range numérico
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || to - from > 1000) {
    return NextResponse.json({ error: "range inválido (max 1000 rows)" }, { status: 400 });
  }
  const { data, error } = await q.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], from, to, view });
}
