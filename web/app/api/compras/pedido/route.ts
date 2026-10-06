// GET  /api/compras/pedido?id=  — pedido completo (folha)
// POST /api/compras/pedido      — incluir/alterar (só o que nasceu no painel)
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, posGravar, valoresSePuder } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  let id = Number(sp.get("id"));
  try {
    // ?num=7346&tipo=RC&emp=SF — abre pelo número (link vindo de Operação, 06/10/26).
    if (!id && sp.get("num")) {
      id = Number(await rpc<number | null>("compras_id_por_numero", {
        p_empresa: (sp.get("emp") ?? "SF").toUpperCase(), p_numero: String(sp.get("num")), p_tipo: sp.get("tipo") || null,
      })) || 0;
      if (!id) return NextResponse.json({ error: `${sp.get("tipo") || "Pedido"} ${sp.get("num")} não encontrado em Compras` }, { status: 404 });
    }
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    const p = await rpc("compras_pedido", { p_id: id });
    if (!p) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    // contas a pagar do pedido no financeiro (fase do ciclo: previsto → … → liberado)
    const ehRc = (p as { tipo?: string }).tipo === "RC";
    const [pagar, vinculo, estoque, pcsPorItem] = await Promise.all([
      rpc("compras_pagar_do_pedido", { p_id: id }).catch(() => []),
      // marcações "sem RC"/"compra avulsa" e a entrada de estoque ao conferir (sql/51)
      rpc<Record<string, unknown> | null>("compras_vinculo", { p_id: id }).catch(() => null),
      rpc("compras_estoque_do_pedido", { p_id: id }).catch(() => []),
      // RC: que PCs já atendem cada item (06/10/26) — nº + link na folha.
      ehRc ? rpc<Record<string, { id: number; num: string }[]>>("compras_rc_itens_pcs", { p_rc_id: id }).catch(() => ({})) : Promise.resolve({}),
    ]);
    return NextResponse.json({ ...valoresSePuder(q, { ...(p as object), ...(vinculo ?? {}), pagar, estoque, pcsPorItem }), pode: q.pode });
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
  // ?simular=1 (06/10/26): passa pelas mesmas travas e devolve o que seria
  // gravado, sem gravar nem consumir número — usado para testar atalhos.
  if (new URL(req.url).searchParams.get("simular") === "1") {
    return NextResponse.json({ ok: true, simulado: true, tipo: body.tipo, itens: itens.length, body });
  }
  try {
    const r = await rpc<{ id: number; num: string }>("compras_salvar", { p: body, p_por: q.email, p_uid: q.uid });
    await posGravar(r.id, String(body.tipo));
    return NextResponse.json(r);
  } catch (e) { return erro(e); }
}

