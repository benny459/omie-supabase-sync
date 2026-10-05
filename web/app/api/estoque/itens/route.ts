// GET /api/estoque/itens → uma linha por produto (orders.v_estoque_item): saldo agregado
// (saldo = espelho do Omie + ajustes do painel, calculado só em v_estoque_saldo_local),
// família, consumo de 90 dias, última movimentação e sinais de auditoria para a lista,
// mais os pares de possível duplicidade ainda não decididos (orders.v_estoque_duplicidade).

import { NextResponse } from "next/server";
import { custosSePuder, orders, platform, quemEstoque, todas, todasParalelo } from "@/lib/estoque-server";
import { urlsAssinadas } from "@/lib/estoque-fotos";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  try {
    const [rows, dups, fotos, reservas] = await Promise.all([
      todasParalelo((de, ate) => orders().from("v_estoque_item").select("*").order("descricao").order("n_cod_prod").range(de, ate)),
      todas((de, ate) => orders().from("v_estoque_duplicidade").select("*").range(de, ate)),
      todas((de, ate) => platform().from("estoque_foto").select("empresa, n_cod_prod, path").range(de, ate)),
      // separação p/ projeto (sql/63): reservado por item; disponível = saldo − reservado_proj
      todas((de, ate) => orders().from("v_estoque_reserva_item").select("empresa, n_cod_prod, reservado_proj, n_projetos").range(de, ate)).catch(() => []),
    ]);
    const res = new Map((reservas as { empresa: string; n_cod_prod: number; reservado_proj: number; n_projetos: number }[])
      .map((x) => [`${x.empresa}:${x.n_cod_prod}`, x]));
    for (const r of rows as Record<string, unknown>[]) {
      const x = res.get(`${r.empresa}:${r.n_cod_prod}`);
      if (x) { r.reservado_proj = Number(x.reservado_proj) || 0; r.n_projetos = Number(x.n_projetos) || 0; }
    }
    // fotos: URL assinada do bucket privado (nunca o link externo)
    const fs = fotos as { empresa: string; n_cod_prod: number; path: string }[];
    const urls = await urlsAssinadas(fs.map((f) => f.path)).catch(() => new Map<string, string>());
    const porItem = new Map(fs.map((f) => [`${f.empresa}:${f.n_cod_prod}`, urls.get(f.path) ?? null]));
    for (const r of rows as Record<string, unknown>[]) r.foto = porItem.get(`${r.empresa}:${r.n_cod_prod}`) ?? null;
    return NextResponse.json({ rows: custosSePuder(q, rows), dups, count: rows.length, admin: q.admin, pode: q.pode });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
