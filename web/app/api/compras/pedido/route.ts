// GET  /api/compras/pedido?id=  — pedido completo (folha)
// POST /api/compras/pedido      — incluir/alterar (só o que nasceu no painel)
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, posGravar, valoresSePuder, motivoNaoDecide } from "@/lib/compras-server";
import { aprovPainelExigeAprovador } from "@/lib/aprovacao-permissao";
import type { Pedido } from "@/lib/compras";
import { supaAdmin } from "@/lib/supabase-admin";

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
    // 07/10/26: remarcação da previsão feita na Operação (PC do Omie) — a folha mostra ao lado
    let previsaoRemarcada: string | null = null;
    const ncod = Number((p as { ncodPed?: number }).ncodPed) || 0;
    if (ncod > 0) {
      const { data: a } = await supaAdmin().schema("approval").from("approvals").select("custom_fields")
        .eq("empresa", (p as { emp?: string }).emp ?? "SF").eq("ncod_ped", ncod).maybeSingle();
      const v = (a as { custom_fields?: Record<string, unknown> } | null)?.custom_fields?.s4b87bk9;
      if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) previsaoRemarcada = String(v).slice(0, 10);
    }
    return NextResponse.json({ ...valoresSePuder(q, { ...(p as object), ...(vinculo ?? {}), pagar, estoque, pcsPorItem, previsaoRemarcada }), pode: q.pode });
  } catch (e) { return erro(e); }
}

/** Itens puxados da Lista de materiais (07/10/26): cada item do PC fica ligado à sua linha
 *  da lista — o MESMO vínculo do "Gerar pedido de compra" da lista (pc_item_id, pc_numero,
 *  vinculo_via "lista"). Os itens do PC são achados na ordem em que foram mandados (seq). */
async function ligarLista(r: { id: number; num: string }, body: Record<string, unknown>, itens: Record<string, unknown>[], email: string) {
  const alvos = itens.map((i, k) => ({ k, lista: i.listaId ? String(i.listaId) : "" })).filter((x) => x.lista);
  if (!alvos.length) return 0;
  const { data: full } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: r.id });
  const its = [...(((full ?? {}) as { itens?: { id: number; seq: number }[] }).itens ?? [])].sort((x, y) => x.seq - y.seq);
  const emp = String(body.emp ?? "SF").toUpperCase();
  const proj = Number(body.projCod ?? 0);
  let n = 0;
  for (const a of alvos) {
    const it = its[a.k];
    if (!it) continue;
    let qy = supaAdmin().schema("approval").from("rc_projetos_itens")
      .update({ pc_item_id: it.id, pc_numero: r.num, vinculo_via: "lista", vinculo_em: new Date().toISOString(), atualizado_por: email })
      .eq("id", a.lista).eq("empresa", emp);
    if (proj > 0) qy = qy.eq("codigo_projeto", proj);
    // linha já ligada a OUTRO PC não é tomada
    const { data } = await qy.or(`pc_item_id.is.null,pc_item_id.eq.${it.id}`).select("id");
    n += (data ?? []).length;
  }
  return n;
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
    // "Salvar e solicitar aprovação" num PC JÁ aprovado devolve-o para aguardando: é decisão
    // de quem aprova (08/10/26 — só pode reprovar quem aprova; lib/aprovacao-permissao).
    if (body.id && body.novaAprov === "aguardando") {
      const atual = await rpc<Pedido | null>("compras_pedido", { p_id: Number(body.id) });
      if (atual && atual.tipo === "PC" && aprovPainelExigeAprovador(atual.aprov, "aguardando")) {
        const nao = await motivoNaoDecide(q, { emp: atual.emp, num: atual.num, valor: Number(atual.valor) || 0, projCod: atual.projCod, proj: atual.proj }, "reprovar");
        if (nao) return NextResponse.json({ error: nao }, { status: 403 });
      }
    }
    const r = await rpc<{ id: number; num: string }>("compras_salvar", { p: body, p_por: q.email, p_uid: q.uid });
    const ligadas = body.tipo === "PC" ? await ligarLista(r, body, itens, q.email) : 0;
    await posGravar(r.id, String(body.tipo));
    return NextResponse.json({ ...r, ligadas });
  } catch (e) { return erro(e); }
}

