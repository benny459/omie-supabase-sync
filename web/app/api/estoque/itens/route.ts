// GET /api/estoque/itens → uma linha por produto (orders.v_estoque_item): saldo agregado
// (saldo = espelho do Omie + ajustes do painel, calculado só em v_estoque_saldo_local),
// família, consumo de 90 dias, última movimentação e sinais de auditoria para a lista,
// mais os pares de possível duplicidade ainda não decididos (orders.v_estoque_duplicidade).

import { NextResponse } from "next/server";
import { orders, quemEstoque, todas, todasParalelo } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  try {
    const [rows, dups] = await Promise.all([
      todasParalelo((de, ate) => orders().from("v_estoque_item").select("*").order("descricao").order("n_cod_prod").range(de, ate)),
      todas((de, ate) => orders().from("v_estoque_duplicidade").select("*").range(de, ate)),
    ]);
    return NextResponse.json({ rows, dups, count: rows.length, admin: q.admin });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
