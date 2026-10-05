// GET  /api/compras/pedido?id=  — pedido completo (folha)
// POST /api/compras/pedido      — incluir/alterar (só o que nasceu no painel)
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, posGravar, valoresSePuder } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try {
    const p = await rpc("compras_pedido", { p_id: id });
    if (!p) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    // contas a pagar do pedido no financeiro (fase do ciclo: previsto → … → liberado)
    const [pagar, vinculo, estoque] = await Promise.all([
      rpc("compras_pagar_do_pedido", { p_id: id }).catch(() => []),
      // marcações "sem RC"/"compra avulsa" e a entrada de estoque ao conferir (sql/51)
      rpc<Record<string, unknown> | null>("compras_vinculo", { p_id: id }).catch(() => null),
      rpc("compras_estoque_do_pedido", { p_id: id }).catch(() => []),
    ]);
    return NextResponse.json({ ...valoresSePuder(q, { ...(p as object), ...(vinculo ?? {}), pagar, estoque }), pode: q.pode });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const itens = Array.isArray(body.itens) ? body.itens as Record<string, unknown>[] : [];
  // Mesmas travas da folha, no servidor (a folha pode estar desatualizada).
  if (body.tipo === "PC") {
    if (!body.fornCod && !body.forn) return NextResponse.json({ error: 'O "Fornecedor" deve ser preenchido.' }, { status: 400 });
    if (!body.cat) return NextResponse.json({ error: 'A "Categoria da Compra" deve ser preenchida.' }, { status: 400 });
  }
  if (!itens.length) return NextResponse.json({ error: "Inclua pelo menos 1 item." }, { status: 400 });
  if (itens.some((i) => !(Number(i.qtd) > 0))) return NextResponse.json({ error: "Há item com quantidade zerada." }, { status: 400 });
  try {
    const r = await rpc<{ id: number; num: string }>("compras_salvar", { p: body, p_por: q.email, p_uid: q.uid });
    await posGravar(r.id, String(body.tipo));
    return NextResponse.json(r);
  } catch (e) { return erro(e); }
}

