// GET /api/estoque/busca?q=          → PCs (nº começando por q) e clientes (nome contém q) para o ⌘K.
// GET /api/estoque/busca?cliente=NOME → ids dos produtos que saíram para esse cliente (últimos 12 meses).
// Itens (código/descrição) a tela busca na lista que já tem em memória — fica instantâneo.
// PCs: orders.estoque_busca_pcs (compras.*) · clientes: orders.estoque_busca_clientes (filtra as saídas antes do join).

import { NextResponse } from "next/server";
import { exigirEstoque, orders } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const negado = await exigirEstoque();
  if (negado) return negado;
  const url = new URL(req.url);
  const cliente = url.searchParams.get("cliente");
  const q = (url.searchParams.get("q") ?? "").trim();
  const db = orders();
  try {
    if (cliente) {
      const { data, error } = await db.rpc("estoque_busca_clientes", { p_q: null, p_cliente: cliente });
      if (error) throw new Error(error.message);
      return NextResponse.json({ cliente, ids: ((data ?? []) as number[]).map(Number) });
    }
    if (q.length < 3) return NextResponse.json({ pcs: [], clientes: [] });

    const [pcsRes, cliRes] = await Promise.all([
      /^\d+$/.test(q) ? db.rpc("estoque_busca_pcs", { p_q: q }) : Promise.resolve({ data: [], error: null }),
      db.rpc("estoque_busca_clientes", { p_q: q, p_cliente: null }),
    ]);
    if (pcsRes.error) throw new Error(pcsRes.error.message);
    if (cliRes.error) throw new Error(cliRes.error.message);
    const pcs = ((pcsRes.data ?? []) as { itens: unknown[] }[]).filter((p) => p.itens.length > 0).slice(0, 4);
    return NextResponse.json({ pcs, clientes: cliRes.data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
