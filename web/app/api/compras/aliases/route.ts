// GET /api/compras/aliases?n_cod_prod= | ?cod= | ?cnpj=
// "Como os fornecedores chamam este item" — de-para gravado na conferência
// (compras.v_item_aliases, sql/37). Uma linha por (fornecedor, cód./nome na NF):
//   { ncod_prod, produto_cod, nosso_item, empresa, fornecedor_cnpj, fornecedor_cod,
//     fornecedor_nome, codigo_fornecedor, nome_na_nf, ncm, unidade_forn, fator, unidade,
//     confirmado_por, confirmado_em, pedido_numero, nf_numero, nf_chave, vezes }
// fator: 1 un. da NF = fator × a nossa unidade. Estoque sempre movimenta o NOSSO item.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const ncod = Number(sp.get("n_cod_prod")) || null, cod = sp.get("cod") || null, cnpj = sp.get("cnpj") || null;
  if (!ncod && !cod && !cnpj) return NextResponse.json({ error: "informe n_cod_prod, cod ou cnpj" }, { status: 400 });
  try { return NextResponse.json(await rpc("compras_aliases", { p_ncod_prod: ncod, p_cod: cod, p_cnpj: cnpj })); }
  catch (e) { return erro(e); }
}
