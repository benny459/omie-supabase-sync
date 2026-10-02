// Resolvedor de códigos (histórico de códigos, 02/10/26) — para todos os módulos.
// GET  /api/estoque/resolver?codes=SAF0010,3014120,H0012[&empresa=SF]
// POST /api/estoque/resolver { codes: string[], empresa? }      (lotes grandes; até 2.000 códigos)
// Resposta: { resolvido: { [codigo_pedido]: Linha[] }, nao_achados: string[] }
//   Linha = { codigo_usado, n_cod_prod_usado, origem: "omie"|"mesclado"|"recodificado"|"fornecedor",
//             n_cod_prod_atual, codigo_atual, codigo_omie_atual, codigo_novo_atual, descricao_atual,
//             desde, por, fornecedor, mudou_de_item }
// Aceita código (sem diferença de maiúsculas) ou id (n_cod_prod). Nada histórico é reescrito: quem chama mostra
// o código do documento E o item de hoje (codigo_atual / descricao_atual).

import { NextResponse } from "next/server";
import { orders, quemEstoque } from "@/lib/estoque-server";

export const runtime = "nodejs";

type Linha = Record<string, unknown> & { codigo_usado: string; n_cod_prod_usado: number };

async function resolver(empresa: string, codes: string[]) {
  const pedidos = [...new Set(codes.map((c) => String(c ?? "").trim()).filter(Boolean))].slice(0, 2000);
  if (!pedidos.length) return { resolvido: {}, nao_achados: [] };
  const r = await orders().rpc("item_codigo_resolver", { p_empresa: empresa, p_codigos: pedidos });
  if (r.error) throw new Error(r.error.message);
  const linhas = (r.data ?? []) as Linha[];
  const resolvido: Record<string, Linha[]> = {};
  for (const c of pedidos) {
    const u = c.toUpperCase();
    const m = linhas.filter((l) => String(l.codigo_usado ?? "").toUpperCase() === u || String(l.n_cod_prod_usado) === c);
    if (m.length) resolvido[c] = m;
  }
  return { resolvido, nao_achados: pedidos.filter((c) => !resolvido[c]) };
}

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  try { return NextResponse.json(await resolver(u.searchParams.get("empresa") || "SF", (u.searchParams.get("codes") ?? "").split(","))); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { codes?: string[]; empresa?: string };
  try { return NextResponse.json(await resolver(b.empresa || "SF", Array.isArray(b.codes) ? b.codes : [])); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
