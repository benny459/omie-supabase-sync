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
    const descricao = u.searchParams.get("descricao") ?? "";
    const origem = Number(u.searchParams.get("origem") ?? 0);
    const [par, fam, inf] = await Promise.all([
      orders().rpc("estoque_parecidos", { p_empresa: emp, p_descricao: descricao, p_excluir: null }),
      platform().from("estoque_familia").select("id, nome, prefixo, ativo").eq("empresa", emp).eq("ativo", true).order("nome"),
      origem ? orders().rpc("estoque_vinculo_info", { p_empresa: emp, p_origem: origem }) : Promise.resolve({ data: null, error: null }),
    ]);
    if (par.error || fam.error) return erro((par.error ?? fam.error)!.message, 500);
    let parecidos = ((par.data ?? []) as { n_cod_prod: number; codigo_novo: string | null; descricao: string; saldo: number | null; sim: number; igual: boolean; fraco?: boolean }[])
      .filter((p) => p.codigo_novo);
    // família sugerida: a do item mais parecido que já tem código novo
    let familia_sugerida: number | null = null;
    if (parecidos[0]) {
      const f = await orders().from("v_estoque_item").select("familia_id").eq("empresa", emp).eq("n_cod_prod", parecidos[0].n_cod_prod).maybeSingle();
      familia_sugerida = (f.data?.familia_id as number | null) ?? null;
    } else {
      // nada parecido o bastante: itens nossos com a mesma 1ª palavra (CABO, LUVA…) — dão a família e
      // ficam como candidatos fracos para vincular (05/10/26: "Criar item nosso" não pode parar sem família)
      const ws = descricao.trim().split(/\s+/).filter((x) => x.length >= 2);
      type N = { n_cod_prod: number; codigo: string; descricao: string; saldo: number | null; familia_id: number | null };
      let nat: N[] = [];
      for (const w of [ws.slice(0, 2).join(" "), ws[0] ?? ""]) {
        if (w.length < 3 || nat.length) continue;
        const r = await orders().rpc("fat_itens_buscar", { p_empresa: emp, p_q: w, p_lim: 20 });
        nat = ((r.data as { nativos?: N[] } | null)?.nativos ?? []);
      }
      if (nat.length) {
        const cont = new Map<number, number>();
        for (const n of nat) if (n.familia_id) cont.set(n.familia_id, (cont.get(n.familia_id) ?? 0) + 1);
        familia_sugerida = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        parecidos = nat.slice(0, 5).map((n) => ({ n_cod_prod: n.n_cod_prod, codigo_novo: n.codigo, descricao: n.descricao, saldo: n.saldo, sim: 0, igual: false, fraco: true }));
      }
    }
    return NextResponse.json({ parecidos, familias: fam.data ?? [], familia_sugerida, info: inf.data ?? null });
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
           obs: `Cadastrado na emissão a partir do código de compra ${b.codigo_origem ?? b.origem}` },
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
