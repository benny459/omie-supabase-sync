// GET /api/estoque/itens → uma linha por produto (orders.v_estoque_item): saldo agregado
// (saldo = espelho do Omie + ajustes do painel, calculado só em v_estoque_saldo_local),
// consumo de 90 dias, última movimentação e sinais de auditoria para a lista,
// mais os pares de possível duplicidade (orders.v_estoque_duplicidade) para a aba Duplicidades.

import { NextResponse } from "next/server";
import { exigirEstoque, orders, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const negado = await exigirEstoque();
  if (negado) return negado;
  try {
    const [rows, dups] = await Promise.all([
      todas((de, ate) => orders().from("v_estoque_item").select("*").order("descricao").order("n_cod_prod").range(de, ate)),
      todas((de, ate) => orders().from("v_estoque_duplicidade").select("*").range(de, ate)),
    ]);
    return NextResponse.json({ rows, dups, count: rows.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
