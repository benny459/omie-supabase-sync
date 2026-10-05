// Separação de material para PROJETO (05/10/26) — reserva por projeto (sql/63).
// GET ?acao=projetos&q=…            → busca de projeto (código PJ…, nome, código Omie)
// GET ?acao=candidatos&projeto=…    → itens das RC/PC do projeto + já separados (saldo, disponível, separado, necessário)
// GET ?acao=projeto&projeto=…       → materiais separados do projeto + consumo + últimos lotes
// GET ?acao=item&n_cod_prod=…       → reservas de um item por projeto (ficha do item)
// GET ?acao=lotes                   → últimos lotes (todas os projetos)
// GET ?acao=resumo                  → { [projeto]: { itens, quantidade, valor, pct } } para a lista de Projetos
// POST { acao: "lancar", tipo: separar|devolver|consumir, projeto_codigo, solicitante_nome, motivo?, obs?, linhas[] }
// POST { acao: "desfazer", lote_id, obs? }
// Lançar/desfazer exigem estoque.separar_projeto. Nada vai ao Omie.

import { NextResponse } from "next/server";
import { custosSePuder, msgErro, orders, quemEstoque } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMPRESA = "SF";

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  const acao = u.searchParams.get("acao") ?? "";
  const projeto = Number(u.searchParams.get("projeto") ?? 0);
  try {
    let r;
    if (acao === "projetos") r = await orders().rpc("estoque_projetos_buscar", { p_empresa: EMPRESA, p_q: u.searchParams.get("q") ?? "" });
    else if (acao === "candidatos") {
      if (!projeto) return NextResponse.json({ error: "Informe o projeto" }, { status: 400 });
      r = await orders().rpc("estoque_separacao_candidatos", { p_empresa: EMPRESA, p_projeto: projeto });
    } else if (acao === "projeto") {
      if (!projeto) return NextResponse.json({ error: "Informe o projeto" }, { status: 400 });
      r = await orders().rpc("estoque_separacao_projeto", { p_empresa: EMPRESA, p_projeto: projeto });
    } else if (acao === "item") r = await orders().rpc("estoque_reserva_do_item", { p_empresa: EMPRESA, p_n_cod_prod: Number(u.searchParams.get("n_cod_prod") ?? 0) });
    else if (acao === "lotes") r = await orders().rpc("estoque_separacao_lotes", { p_empresa: EMPRESA, p_lim: 50 });
    else if (acao === "resumo") r = await orders().rpc("estoque_separacao_resumo_projetos", { p_empresa: EMPRESA });
    else return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 500 });
    return NextResponse.json({ dados: custosSePuder(q, r.data), pode: !!q.pode["estoque.separar_projeto"], eu: { email: q.email } },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  if (!q.pode["estoque.separar_projeto"]) {
    return NextResponse.json({ error: "Sem permissão para separar material de projeto — peça ao administrador em Usuários e acessos" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.acao === "lancar") {
      const r = await orders().rpc("estoque_separacao", { p: { ...b, empresa: EMPRESA }, p_user: q.id || null, p_email: q.email });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, lote: r.data });
    }
    if (b.acao === "desfazer") {
      const r = await orders().rpc("estoque_separacao_desfazer", { p_lote: Number(b.lote_id), p_email: q.email, p_obs: (b.obs as string) ?? null });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, lote: r.data });
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
