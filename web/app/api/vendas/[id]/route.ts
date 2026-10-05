// GET  /api/vendas/:id                         → documento + documento fiscal montado (para Emitir NF)
// POST /api/vendas/:id { acao: "cancelar", motivo }
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { docFat, documento, erro, exigirVendas, refrescar } from "@/lib/vendas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const id = Number((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  try {
    const d = await documento(id);
    return NextResponse.json({ documento: d, docfat: docFat(d) });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request, ctx: Ctx) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const id = Number((await ctx.params).id);
  const b = (await req.json().catch(() => ({}))) as { acao?: string; motivo?: string };
  try {
    if (b.acao === "cancelar") {
      const r = await rpc("vendas_cancelar", { p_id: id, p_motivo: b.motivo ?? "", p_por: q.nome });
      await refrescar();
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  } catch (e) { return erro(e); }
}
