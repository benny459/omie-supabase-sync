// Cadastro de item do Estoque.
// GET  ?n_cod_prod=  → dados para o formulário (item + cadastro do painel + famílias + próximo código)
// GET  ?parecidos=descrição[&excluir=id] → aviso de duplicidade antes de salvar
// POST { ...campos, enviar_omie?: boolean } → cria (sem n_cod_prod/cadastro_id) ou edita.
//      Criar: gera o código novo (sequência da família; admin pode digitar outro) e, se pedido,
//      cria o produto no Omie (IncluirProduto) e guarda o id devolvido.
//      Editar: se mudou campo fiscal (descrição, unidade, NCM, EAN) e o item existe no Omie,
//      AlterarProduto. Nunca cria família no Omie (só usa a família mapeada).
// POST { acao: "omie", cadastro_id } → reenvia ao Omie (botão "tentar de novo").

import { NextResponse } from "next/server";
import { msgErro, orders, platform, quemEstoque } from "@/lib/estoque-server";
import { credsOmie, enviarProdutoOmie, escritaOmieLigada } from "@/lib/estoque-omie";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  const par = u.searchParams.get("parecidos");
  if (par != null) {
    const r = await orders().rpc("estoque_parecidos", { p_empresa: "SF", p_descricao: par, p_excluir: u.searchParams.get("excluir") ? Number(u.searchParams.get("excluir")) : null });
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    return NextResponse.json({ parecidos: r.data ?? [] });
  }
  const id = u.searchParams.get("n_cod_prod");
  const [fr, ir] = await Promise.all([
    platform().from("estoque_familia").select("id, nome, prefixo, proximo, ativo, sistema, omie_codigo_familia").eq("empresa", "SF").order("nome"),
    id ? orders().from("v_estoque_item").select("*").eq("n_cod_prod", Number(id)).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (fr.error || ir.error) return NextResponse.json({ error: (fr.error ?? ir.error)!.message }, { status: 500 });
  return NextResponse.json({
    familias: fr.data, item: ir.data, admin: q.admin,
    omie: { ligado: escritaOmieLigada(), empresas: ["SF", "CD", "WW"].filter((e) => !!credsOmie(e)) },
  });
}

type Cad = { id: number; empresa: string; n_cod_prod: number | null; origem: "painel" | "omie"; descricao: string; unidade: string | null; ncm: string | null;
  ean: string | null; preco_ref: number | null; obs: string | null; ativo: boolean; omie_status: string; omie_codigo: string | null };

/** Envia/atualiza no Omie e grava o resultado no cadastro. */
async function sincronizarOmie(cadId: number, prodAtual: number, codigo: string, criar: boolean) {
  const c = await platform().from("estoque_item_cadastro").select("*").eq("id", cadId).single();
  if (c.error) return { ok: false, erro: c.error.message };
  const cad = c.data as Cad;
  const fam = await orders().from("v_estoque_item").select("codigo_familia, unidade, ncm, descricao").eq("n_cod_prod", prodAtual).maybeSingle();
  const r = await enviarProdutoOmie(cad.empresa, criar ? "IncluirProduto" : "AlterarProduto", {
    codigo, descricao: cad.descricao ?? fam.data?.descricao ?? "", unidade: cad.unidade ?? fam.data?.unidade ?? "UN",
    ncm: cad.ncm ?? fam.data?.ncm ?? "", ean: cad.ean, valor_unitario: cad.preco_ref, obs: cad.obs, ativo: cad.ativo,
    codigo_familia: (fam.data?.codigo_familia as number | null) ?? null, codigo_produto: criar ? null : (cad.n_cod_prod ?? prodAtual),
  });
  if (r.ok && criar && r.codigo_produto) {
    const ok = await orders().rpc("estoque_cadastro_omie_ok", { p_cadastro: cadId, p_prod: r.codigo_produto, p_codigo: codigo, p_resposta: r.corpo });
    if (ok.error) return { ok: false, erro: `Criado no Omie (id ${r.codigo_produto}), mas não consegui gravar o id: ${ok.error.message}` };
    return { ok: true, n_cod_prod: r.codigo_produto };
  }
  await orders().rpc("estoque_cadastro_omie_status", { p_cadastro: cadId, p_status: r.ok ? "ok" : "erro", p_erro: r.ok ? null : r.erro ?? "erro", p_resposta: r.corpo ?? null });
  return r.ok ? { ok: true } : { ok: false, erro: r.erro };
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (b.acao === "omie") {
    const cadId = Number(b.cadastro_id);
    const c = await platform().from("estoque_item_cadastro").select("id, n_cod_prod, origem, omie_status").eq("id", cadId).single();
    if (c.error) return NextResponse.json({ error: c.error.message }, { status: 404 });
    const cod = await platform().from("estoque_item_codigo").select("codigo").eq("n_cod_prod", c.data.n_cod_prod ?? -cadId).eq("atual", true).maybeSingle();
    const criar = c.data.origem === "painel" && !c.data.n_cod_prod;
    const r = await sincronizarOmie(cadId, c.data.n_cod_prod ?? -cadId, cod.data?.codigo ?? "", criar);
    return NextResponse.json({ omie: r }, { status: r.ok ? 200 : 502 });
  }

  // Família / código digitado: só admin muda o código; família qualquer usuário do ERP escolhe.
  const antes = b.n_cod_prod ? await orders().from("v_estoque_item").select("descricao, unidade, ncm, ean, n_cod_prod, codigo_omie").eq("n_cod_prod", Number(b.n_cod_prod)).maybeSingle() : null;
  const r = await orders().rpc("estoque_cadastrar", { p: b, p_admin: q.admin, p_email: q.email });
  if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
  const res = r.data as { cadastro: Cad; n_cod_prod: number; codigo: string };
  const novo = !b.n_cod_prod && !b.cadastro_id;

  let omie: { ok: boolean; erro?: string; n_cod_prod?: number } | null = null;
  const temId = res.n_cod_prod > 0;
  if (b.enviar_omie !== false) {
    // criar no Omie: item novo, ou item do painel que ainda não chegou ao Omie (salvar de novo = tentar de novo)
    if (novo || (!temId && res.cadastro.origem === "painel")) omie = await sincronizarOmie(res.cadastro.id, res.n_cod_prod, res.codigo, true);
    else if (temId && antes?.data) {
      const a = antes.data as Record<string, unknown>, nc = res.cadastro;
      const mudou = (x: unknown, y: unknown) => String(x ?? "").trim().toUpperCase() !== String(y ?? "").trim().toUpperCase();
      const fiscal = mudou(a.descricao, nc.descricao) || mudou(a.unidade, nc.unidade) || mudou(String(a.ncm ?? "").replace(/\D/g, ""), nc.ncm) || mudou(a.ean, nc.ean);
      if (fiscal) omie = await sincronizarOmie(nc.id, res.n_cod_prod, String(a.codigo_omie ?? nc.omie_codigo ?? res.codigo), false);
    }
  }
  return NextResponse.json({ ok: true, cadastro_id: res.cadastro.id, n_cod_prod: omie?.n_cod_prod ?? res.n_cod_prod, codigo: res.codigo, omie });
}
