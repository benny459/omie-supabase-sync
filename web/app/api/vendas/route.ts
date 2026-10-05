// GET  /api/vendas?emp=SF&desde=AAAA-MM-DD&status=aberto[,faturado]  → PV/OS nativos (orders.vendas_lista)
// POST /api/vendas  { ...VendaSalvar }       → cria/edita (orders.vendas_salvar)
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { erro, exigirVendas, salvarVenda } from "@/lib/vendas-server";
import type { VendaSalvar } from "@/lib/vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  try {
    let linhas = await rpc("vendas_lista", { p_empresa: sp.get("emp")?.toUpperCase() || null, p_desde: sp.get("desde") || null }) as { status?: string }[];
    // ?status=aberto (ou lista separada por vírgula) — antes era ignorado e vinham também os faturados.
    const status = (sp.get("status") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (status.length && Array.isArray(linhas)) linhas = linhas.filter((l) => status.includes(String(l.status ?? "").toLowerCase()));
    const config = await rpc("vendas_config", { p_empresa: (sp.get("emp") ?? "SF").toUpperCase() });
    return NextResponse.json({ linhas, config, admin: q.admin });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  try {
    const body = (await req.json()) as VendaSalvar;
    const p = { ...body, origem: body.id ? undefined : "painel" };
    return NextResponse.json(await salvarVenda(p as VendaSalvar, q.nome));
  } catch (e) { return erro(e); }
}
