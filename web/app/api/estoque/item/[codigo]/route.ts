// GET /api/estoque/item/[codigo] → ficha do item num JSON só:
//   item  — orders.v_estoque_item (posição por local, consumo, sinais)
//   movs  — Kardex inteiro do produto com cliente/projeto (orders.v_estoque_mov_cli), em ordem cronológica
//   pcs   — pedidos de compra do item (compras.* via orders.estoque_item_pcs)
//   dups  — pares de possível duplicidade, com o outro item
// [codigo] aceita o código do produto (deep link /estoque/3026006) ou o id do Omie.

import { NextResponse } from "next/server";
import { exigirEstoque, orders, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const negado = await exigirEstoque();
  if (negado) return negado;
  const { codigo } = await params;
  const cod = decodeURIComponent(codigo);
  try {
    const db = orders();
    let { data: item, error } = await db.from("v_estoque_item").select("*").eq("codigo", cod).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!item && /^\d+$/.test(cod)) {
      ({ data: item, error } = await db.from("v_estoque_item").select("*").eq("n_cod_prod", cod).limit(1).maybeSingle());
      if (error) throw new Error(error.message);
    }
    if (!item) return NextResponse.json({ error: `Item ${cod} não encontrado na posição de estoque` }, { status: 404 });
    const { empresa, n_cod_prod } = item as { empresa: string; n_cod_prod: number };

    const [movs, pcsRes, dupsRes] = await Promise.all([
      todas((de, ate) => db.from("v_estoque_mov_cli").select("*").eq("empresa", empresa).eq("id_prod", n_cod_prod)
        .order("dt_mov").order("id_mov").range(de, ate)),
      db.rpc("estoque_item_pcs", { p_empresa: empresa, p_prod: n_cod_prod }),
      db.from("v_estoque_duplicidade").select("*").eq("empresa", empresa).or(`prod_a.eq.${n_cod_prod},prod_b.eq.${n_cod_prod}`),
    ]);
    if (pcsRes.error) throw new Error(pcsRes.error.message);
    if (dupsRes.error) throw new Error(dupsRes.error.message);

    const pares = (dupsRes.data ?? []) as { prod_a: number; prod_b: number; tipo: string; sim: number }[];
    const outros = [...new Set(pares.map((d) => (Number(d.prod_a) === Number(n_cod_prod) ? d.prod_b : d.prod_a)))];
    let outrosItens: Record<string, unknown>[] = [];
    if (outros.length) {
      const r = await db.from("v_estoque_item").select("*").eq("empresa", empresa).in("n_cod_prod", outros);
      if (r.error) throw new Error(r.error.message);
      outrosItens = r.data ?? [];
    }
    const dups = pares.map((d) => {
      const outro = Number(d.prod_a) === Number(n_cod_prod) ? d.prod_b : d.prod_a;
      return { tipo: d.tipo, sim: Number(d.sim), item: outrosItens.find((o) => Number(o.n_cod_prod) === Number(outro)) ?? null };
    });

    return NextResponse.json({ item, movs, pcs: pcsRes.data ?? [], dups });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
