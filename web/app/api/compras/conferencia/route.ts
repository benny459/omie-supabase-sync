// /api/compras/conferencia — conferência do pedido com o de-para de itens (sql/37).
//   GET  ?id=  itens das NF casadas, cada um com o de-para conhecido (fornecedor +
//              cProd) ou o nosso item sugerido, e os itens do pedido
//   POST {id, mapeamentos:[{chave, nf, cprod, xprod, ncm, unForn, ncodProd, cod, desc, un, fator}]}
//              grava o de-para de cada linha confirmada (compras.item_fornecedor_alias).
//              Mover para Conferido continua sendo a ação "mover" (etapa 80).
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, semPermissao } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try { return NextResponse.json(await rpc("compras_conferencia_dados", { p_id: id })); }
  catch (e) { return erro(e); }
}

type Map_ = { chave?: string; nf?: string; cprod?: string; xprod?: string; ncm?: string; unForn?: string;
  ncodProd?: number; cod?: string; desc?: string; un?: string; fator?: number };

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const negado = semPermissao(q, "compras.conferir", "Sem permissão para conferir e liberar pagamento");
  if (negado) return negado;
  const b = await req.json().catch(() => ({})) as { id?: number; mapeamentos?: Map_[] };
  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try {
    const d = await rpc<{ pedido: { cnpj: string; fornCod: number | null; forn: string; emp: string } }>("compras_conferencia_dados", { p_id: id });
    let gravados = 0;
    for (const m of b.mapeamentos ?? []) {
      if (!m.ncodProd) continue;
      await rpc("compras_alias_salvar", { p: { ...m, pedidoId: id, cnpj: d.pedido.cnpj, fornCod: d.pedido.fornCod, forn: d.pedido.forn, emp: d.pedido.emp }, p_por: q.email });
      gravados += 1;
    }
    return NextResponse.json({ ok: true, gravados });
  } catch (e) { return erro(e); }
}
