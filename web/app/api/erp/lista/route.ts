// GET /api/erp/lista?view=vendas|compras — módulos ERP · Omie do painel.
// Lê sales.v_erp_vendas / orders.v_erp_compras (espelho completo do Omie,
// nomes resolvidos e datas parsed). Área "erp".

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE = 1000;
const MAX_ROWS = 30_000;

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }

  const url = new URL(req.url);
  const pedido = url.searchParams.get("view") ?? "vendas";
  const view = ["compras", "nfentrada", "vendas"].includes(pedido) ? pedido : "vendas";
  const schema = view === "vendas" ? "sales" : "orders";
  const tabela = view === "compras" ? "v_erp_compras"
    : view === "nfentrada" ? "v_erp_nf_entrada" : "v_erp_vendas";

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema } },
  );

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = admin.from(tabela).select("*")
      .order("emissao", { ascending: false, nullsFirst: false });
    q = view === "compras" ? q.order("ncod_ped", { ascending: true })
      : view === "nfentrada" ? q.order("id_receb", { ascending: true })
      : q.order("label", { ascending: true });
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `${tabela}: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  return NextResponse.json({ rows, count: rows.length, truncated: rows.length >= MAX_ROWS });
}
