// GET /api/estoque/item/[codigo] → ficha do item num JSON só:
//   item     — orders.v_estoque_item (posição por local = Omie + ajustes do painel, consumo, sinais)
//   movs     — Kardex do produto com cliente/projeto (orders.v_estoque_mov_cli), cronológico.
//              Se o item é o principal de uma mesclagem, inclui o Kardex dos códigos mesclados nele.
//   pcs      — pedidos de compra do item (e dos mesclados) via orders.estoque_item_pcs
//   dups     — pares de possível duplicidade ainda não decididos, com o outro item
//   ajustes  — ajustes do painel (inventário e mesclagem) deste item e dos mesclados
//   mesclas  — decisões de mesclagem ativas em que o item é principal ou secundário
//   aliases  — "como os fornecedores chamam este item" (de-para do Compras, orders.compras_aliases)
//   admin    — se quem vê pode mesclar/desfazer
// [codigo] aceita o código do Omie (/estoque/3026006), o código novo do painel (/estoque/H0012),
// um código antigo (apelido) ou o id (negativo para item criado no painel ainda sem id do Omie).

import { NextResponse } from "next/server";
import { custosSePuder, orders, platform, quemEstoque, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const { codigo } = await params;
  const cod = decodeURIComponent(codigo);
  try {
    const db = orders();
    let { data: item, error } = await db.from("v_estoque_item").select("*").eq("codigo", cod).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) {
      // código novo do painel (F0001) ou um código antigo (apelido depois de recodificar)
      const c = await platform().from("estoque_item_codigo").select("n_cod_prod").eq("codigo", cod.toUpperCase()).limit(1).maybeSingle();
      if (c.data) ({ data: item, error } = await db.from("v_estoque_item").select("*").eq("n_cod_prod", c.data.n_cod_prod).limit(1).maybeSingle());
      if (error) throw new Error(error.message);
    }
    if (!item && /^-?\d+$/.test(cod)) {
      ({ data: item, error } = await db.from("v_estoque_item").select("*").eq("n_cod_prod", cod).limit(1).maybeSingle());
      if (error) throw new Error(error.message);
    }
    if (!item) return NextResponse.json({ error: `Item ${cod} não encontrado na posição de estoque` }, { status: 404 });
    const { empresa, n_cod_prod } = item as { empresa: string; n_cod_prod: number };
    const id = Number(n_cod_prod);

    const mr = await platform().from("estoque_duplicidade_decisao").select("*").eq("empresa", empresa).eq("ativo", true)
      .eq("decisao", "mesclado").or(`principal.eq.${id},secundario.eq.${id}`);
    if (mr.error) throw new Error(mr.error.message);
    const mesclas = (mr.data ?? []) as { id: number; principal: number; secundario: number; grupo_id: number | null }[];
    // todos os códigos que respondem neste (inclusive em cadeia: A→B e depois B→este)
    const dr = await db.from("v_estoque_mescla_dono").select("secundario").eq("empresa", empresa).eq("dono", id);
    if (dr.error) throw new Error(dr.error.message);
    const secundarios = [...new Set([...mesclas.filter((m) => Number(m.principal) === id).map((m) => Number(m.secundario)),
      ...((dr.data ?? []) as { secundario: number }[]).map((r) => Number(r.secundario))])];
    const prods = [id, ...secundarios];

    const [movs, pcsRes, dupsRes, ajRes, secRes, aliRes, codRes] = await Promise.all([
      todas((de, ate) => db.from("v_estoque_mov_cli").select("*").eq("empresa", empresa).in("id_prod", prods)
        .order("dt_mov").order("id_mov").range(de, ate)),
      Promise.all(prods.map((p) => db.rpc("estoque_item_pcs", { p_empresa: empresa, p_prod: p }))),
      db.from("v_estoque_duplicidade").select("*").eq("empresa", empresa).or(`prod_a.eq.${id},prod_b.eq.${id}`),
      platform().from("estoque_ajuste").select("*").eq("empresa", empresa).in("n_cod_prod", prods).order("created_at", { ascending: false }).limit(300),
      secundarios.length ? db.from("v_estoque_item").select("n_cod_prod, codigo, descricao").eq("empresa", empresa).in("n_cod_prod", secundarios)
        : Promise.resolve({ data: [], error: null }),
      Promise.all(prods.map((pid) => db.rpc("compras_aliases", { p_ncod_prod: pid, p_cod: null, p_cnpj: null }))),
      db.rpc("item_codigos_do_item", { p_empresa: empresa, p_prod: id }),
    ]);
    // De-para é complemento: se a função do Compras falhar, a ficha abre sem ele.
    const aliases = aliRes.flatMap((r) => (r.error ? [] : ((r.data ?? []) as Record<string, unknown>[])));
    for (const r of pcsRes) if (r.error) throw new Error(r.error.message);
    if (dupsRes.error) throw new Error(dupsRes.error.message);
    if (ajRes.error) throw new Error(ajRes.error.message);
    if (secRes.error) throw new Error(secRes.error.message);

    const pares = (dupsRes.data ?? []) as { prod_a: number; prod_b: number; tipo: string; sim: number }[];
    const outros = [...new Set(pares.map((d) => (Number(d.prod_a) === id ? d.prod_b : d.prod_a)))];
    let outrosItens: Record<string, unknown>[] = [];
    if (outros.length) {
      const r = await db.from("v_estoque_item").select("*").eq("empresa", empresa).in("n_cod_prod", outros);
      if (r.error) throw new Error(r.error.message);
      outrosItens = r.data ?? [];
    }
    const dups = pares.map((d) => {
      const outro = Number(d.prod_a) === id ? d.prod_b : d.prod_a;
      return { tipo: d.tipo, sim: Number(d.sim), item: outrosItens.find((o) => Number(o.n_cod_prod) === Number(outro)) ?? null };
    });
    const nomes = new Map(((secRes.data ?? []) as { n_cod_prod: number; codigo: string; descricao: string }[]).map((s) => [Number(s.n_cod_prod), s]));
    const pcs = pcsRes.flatMap((r, i) => ((r.data ?? []) as Record<string, unknown>[])
      .map((x): Record<string, unknown> => ({ ...x, de_codigo: i ? nomes.get(prods[i])?.codigo ?? String(prods[i]) : null })))
      .sort((a, b) => String(b.emissao ?? "").localeCompare(String(a.emissao ?? "")));

    return NextResponse.json({
      ...custosSePuder(q, { item, movs, pcs, ajustes: ajRes.data ?? [] }), dups, admin: q.admin, pode: q.pode, aliases, mesclados: secRes.data ?? [],
      codigos: codRes.error ? [] : codRes.data ?? [],
      mesclas: mesclas.map((m) => ({ ...m, secundario_item: nomes.get(Number(m.secundario)) ?? null })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
