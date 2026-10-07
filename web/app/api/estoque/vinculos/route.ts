// Códigos de compra → item NOSSO do estoque (05/10/26).
// GET  ?op=pendentes[&dias=365]           → códigos comprados sem item nativo, com até 3 sugestões
// GET  ?op=feitos                          → vínculos ativos (para desfazer)
// GET  ?op=preparar&origem=<ncod>&descricao=… → família sugerida, famílias e parecidos (trava de duplicados)
// POST { acao: "vincular", origem, destino }          → grava o vínculo (+ de-para do fornecedor quando há CNPJ)
// POST { acao: "cadastrar", origem, familia_id, descricao, unidade, ncm, preco, forcar? }
//        → cria o item no estoque (próximo código da família) e vincula; parecido demais → 409 com candidatos
// POST { acao: "desfazer", id }
import { NextResponse } from "next/server";
import { orders, platform, quemEstoque } from "@/lib/estoque-server";
import { exigirFaturamento } from "@/lib/faturamento/auth";
import { prepararCadastroItem } from "@/lib/catalogo-projeto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Quem = { email: string; admin: boolean };
/** Estoque ou faturamento (quem emite a nota precisa conseguir acertar o item na hora). */
async function quem(): Promise<Quem | NextResponse> {
  const e = await quemEstoque();
  if (!(e instanceof NextResponse)) return { email: e.email, admin: e.admin };
  const f = await exigirFaturamento();
  if (!(f instanceof NextResponse)) return { email: f.email, admin: f.admin };
  return e;
}
const erro = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET(req: Request) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  const op = u.searchParams.get("op") ?? "pendentes";
  const emp = (u.searchParams.get("emp") ?? "SF").toUpperCase();
  if (op === "pendentes") {
    const r = await orders().rpc("estoque_vinculo_pendentes", { p_empresa: emp, p_dias: Number(u.searchParams.get("dias") ?? 365), p_lim: 1000 });
    if (r.error) return erro(r.error.message, 500);
    return NextResponse.json({ pendentes: r.data ?? [] });
  }
  if (op === "feitos") {
    const r = await platform().from("estoque_item_vinculo").select("*").eq("empresa", emp).is("desfeito_em", null).order("criado_em", { ascending: false }).limit(500);
    if (r.error) return erro(r.error.message, 500);
    return NextResponse.json({ vinculos: r.data ?? [] });
  }
  if (op === "preparar") {
    // lógica em lib/catalogo-projeto (07/10/26): a lista de materiais do projeto usa a mesma
    try {
      return NextResponse.json(await prepararCadastroItem(emp, u.searchParams.get("descricao") ?? "", Number(u.searchParams.get("origem") ?? 0)));
    } catch (e) { return erro(e instanceof Error ? e.message : String(e), 500); }
  }
  return erro("op inválida");
}

export async function POST(req: Request) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const emp = String(b.emp ?? "SF").toUpperCase();
  const por = q.email || "painel";

  if (b.acao === "vincular") {
    const r = await orders().rpc("estoque_vinculo_salvar", { p_empresa: emp, p_origem: Number(b.origem), p_destino: Number(b.destino), p_por: por, p_tipo: "manual", p_confianca: null, p_lote: null });
    if (r.error) return erro(r.error.message);
    return NextResponse.json({ ok: true, ...(r.data as object) });
  }

  if (b.acao === "cadastrar") {
    const descricao = String(b.descricao ?? "").trim();
    if (!descricao) return erro("Informe a descrição");
    if (!b.familia_id) return erro("Escolha a família do item");
    // trava de duplicados: descrição igual ou muito parecida a um item nosso → usar o existente
    if (!b.forcar) {
      const par = await orders().rpc("estoque_parecidos", { p_empresa: emp, p_descricao: descricao, p_excluir: null });
      const cands = ((par.data ?? []) as { n_cod_prod: number; codigo_novo: string | null; descricao: string; saldo: number | null; sim: number; igual: boolean }[])
        .filter((p) => p.codigo_novo && (p.igual || Number(p.sim) >= 0.85));
      if (cands.length) return NextResponse.json({ error: "Já existe item parecido no estoque — use o existente", candidatos: cands }, { status: 409 });
    } else if (!q.admin) {
      return erro("Só administrador cadastra mesmo havendo item parecido", 403);
    }
    // O produto de compra já tem posição no estoque do Omie? Então é o MESMO item: só ganha o código novo
    // (saldo e CMC continuam). Senão, nasce um item nosso e o código de compra fica vinculado a ele.
    const inf = b.origem ? await orders().rpc("estoque_vinculo_info", { p_empresa: emp, p_origem: Number(b.origem) }) : null;
    const mesmo = !!(inf?.data as { em_estoque?: boolean } | null)?.em_estoque;
    const r = await orders().rpc("estoque_cadastrar", {
      p: { empresa: emp, ...(mesmo ? { n_cod_prod: Number(b.origem) } : {}), descricao, unidade: String(b.unidade ?? "UN").toUpperCase(), ncm: b.ncm ?? null,
           preco_ref: b.preco ?? null, familia_id: Number(b.familia_id), ativo: true,
           obs: b.contexto === "lista" ? `Criado na lista de materiais do projeto${b.origem ? ` a partir do código de compra ${b.codigo_origem ?? b.origem}` : ""}`
             : `Cadastrado na emissão a partir do código de compra ${b.codigo_origem ?? b.origem}` },
      p_admin: false, p_email: por,
    });
    if (r.error) return erro(r.error.message);
    const novo = r.data as { n_cod_prod: number; codigo: string };
    if (b.origem && !mesmo) {
      const v = await orders().rpc("estoque_vinculo_salvar", { p_empresa: emp, p_origem: Number(b.origem), p_destino: novo.n_cod_prod, p_por: por, p_tipo: "cadastro", p_confianca: null, p_lote: null });
      if (v.error) return NextResponse.json({ ok: true, ...novo, aviso: `Item criado (${novo.codigo}), mas o vínculo falhou: ${v.error.message}` });
    }
    return NextResponse.json({ ok: true, ...novo, mesmo_item: mesmo });
  }

  if (b.acao === "desfazer") {
    const r = await orders().rpc("estoque_vinculo_desfazer", { p_id: Number(b.id), p_por: por });
    if (r.error) return erro(r.error.message);
    return NextResponse.json({ ok: true });
  }
  return erro("ação inválida");
}
