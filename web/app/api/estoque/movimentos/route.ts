// GET /api/estoque/movimentos?de=AAAA-MM-DD&ate=AAAA-MM-DD → movimentos do período com cliente e
// projeto (orders.v_estoque_mov_cli). `valor` é o valor UNITÁRIO do movimento (como no Omie).

import { NextResponse } from "next/server";
import { exigirEstoque, orders, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const negado = await exigirEstoque();
  if (negado) return negado;
  const url = new URL(req.url);
  const de = url.searchParams.get("de") ?? "", ate = url.searchParams.get("ate") ?? "";
  if (!ISO.test(de) || !ISO.test(ate)) return NextResponse.json({ error: "de e ate (AAAA-MM-DD) são obrigatórios" }, { status: 400 });
  try {
    const rows = await todas((a, b) => orders().from("v_estoque_mov_cli").select("*")
      .gte("dt_mov", de).lte("dt_mov", ate).order("dt_mov", { ascending: false }).order("id_mov", { ascending: false }).range(a, b));
    return NextResponse.json({ rows, count: rows.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
