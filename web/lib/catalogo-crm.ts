// Catálogo NATIVO para o CRM (P7, 05/10/26) — a CP e a RC do Propostas-WW
// passam a usar o código do painel (código novo por família; o do Omie fica ao
// lado) e o custo do painel (CMC, última compra, histórico de preço).
// Reaproveita a busca do Compras (produtosComCodigoAtual = buscar_catalogo +
// item_codigo_resolver) e o histórico (compras_historico_preco); acrescenta o
// que só o Estoque sabe (orders.crm_itens_info: CMC, saldo, preço máximo).
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { casarCatalogo, produtosComCodigoAtual } from "@/lib/catalogo";
import { buscarItensEstoque } from "@/lib/estoque-vinculos";

const orders = () => supaAdmin().schema("orders");

export type HistCompra = { d: string; n: string; f: string | null; q: number; vu: number; cod: string | null };
export type ItemCrm = {
  ncod_prod: number;
  codigo: string | null;          // código de HOJE (novo por família quando existe)
  codigo_omie: string | null;     // referência — o do Omie
  via?: string;                   // "código antigo X" / "mesclado de X" quando a busca veio por outro código
  descricao: string;
  unidade: string;
  cmc: number | null;
  saldo: number | null;
  ultimo_preco: number | null;
  ultima_compra: string | null;
  fornecedor: string | null;
  qtd_compras: number | null;
  preco_maximo: number | null;
  historico?: HistCompra[];
};

type Info = { n_cod_prod: number; codigo_novo: string | null; codigo_omie: string | null; unidade: string | null;
  cmc: number | null; saldo: number | null; ult_preco: number | null; preco_maximo: number | null; ativo: boolean | null };

async function infos(empresa: string, ids: number[]): Promise<Map<number, Info>> {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n)))];
  if (!uniq.length) return new Map();
  const { data, error } = await orders().rpc("crm_itens_info", { p_empresa: empresa, p_prods: uniq });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Info[]).map((i) => [Number(i.n_cod_prod), i]));
}

async function historico(codigo: string | null, lim: number): Promise<HistCompra[]> {
  if (!codigo) return [];
  const { data } = await orders().rpc("compras_historico_preco", { p_cod: codigo, p_lim: lim });
  return ((data ?? []) as HistCompra[]).map((h) => ({ d: h.d, n: h.n, f: h.f, q: Number(h.q), vu: Number(h.vu), cod: h.cod }));
}

const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Busca por código (novo, do Omie, antigo, mesclado) ou descrição. */
export async function buscarItensCrm(q: string, lim = 10, comHistorico = 3, empresa = "SF"): Promise<ItemCrm[]> {
  const termo = q.trim();
  if (termo.length < 2) return [];
  const max = Math.max(1, Math.min(lim, 12));
  // Itens NOSSOS do estoque primeiro (05/10/26): código de compra que já foi
  // vinculado vem como o item nosso; os demais produtos de compra vêm depois.
  const [compra, est] = await Promise.all([
    produtosComCodigoAtual(termo),
    buscarItensEstoque(empresa, termo, max).catch(() => ({ nativos: [], compra: [] })),
  ]);
  type Base = (typeof compra)[number];
  const nat: Base[] = est.nativos.map((x) => ({
    ncod_prod: x.n_cod_prod, codigo: x.codigo, codigo_omie: x.codigo_omie, via: x.via ?? undefined, descricao: x.descricao,
    unidade: x.unidade ?? "UN", ultimo_preco: x.ultimo_preco, ultima_compra: null, fornecedor: null, qtd_compras: null,
  } as unknown as Base));
  const vistos = new Set(nat.map((b) => Number(b.ncod_prod)));
  // código de compra já vinculado a item nosso não aparece de novo (o item nosso já está na lista)
  const ids = compra.map((b) => Number(b.ncod_prod)).filter((x) => !vistos.has(x));
  const vinc = ids.length ? await supaAdmin().schema("platform").from("estoque_item_vinculo").select("n_cod_prod_origem")
    .eq("empresa", empresa).is("desfeito_em", null).in("n_cod_prod_origem", ids) : { data: [] };
  const jaVinc = new Set(((vinc.data ?? []) as { n_cod_prod_origem: number }[]).map((v) => Number(v.n_cod_prod_origem)));
  const doCompra = compra.filter((b) => !vistos.has(Number(b.ncod_prod)) && !jaVinc.has(Number(b.ncod_prod)));
  const base = [...nat, ...doCompra].slice(0, max);
  const info = await infos(empresa, base.map((b) => Number(b.ncod_prod)));
  // dentro do que veio do catálogo de compra, quem tem código nosso sobe
  base.sort((a, b) => Number(vistos.has(Number(b.ncod_prod)) || !!info.get(Number(b.ncod_prod))?.codigo_novo)
    - Number(vistos.has(Number(a.ncod_prod)) || !!info.get(Number(a.ncod_prod))?.codigo_novo));
  const out: ItemCrm[] = base.map((b) => {
    const i = info.get(Number(b.ncod_prod));
    return {
      ncod_prod: Number(b.ncod_prod),
      codigo: i?.codigo_novo ?? b.codigo ?? null,
      codigo_omie: i?.codigo_omie ?? (b as { codigo_omie?: string | null }).codigo_omie ?? b.codigo ?? null,
      via: (b as { via?: string }).via,
      descricao: b.descricao,
      unidade: (i?.unidade ?? b.unidade ?? "UN") || "UN",
      cmc: n(i?.cmc), saldo: n(i?.saldo),
      ultimo_preco: n(b.ultimo_preco) ?? n(i?.ult_preco),
      ultima_compra: b.ultima_compra ?? null,
      fornecedor: b.fornecedor ?? null,
      qtd_compras: n(b.qtd_compras),
      preco_maximo: n(i?.preco_maximo),
    };
  });
  if (comHistorico > 0) {
    await Promise.all(out.slice(0, 6).map(async (it) => { it.historico = await historico(it.codigo, comHistorico); }));
  }
  return out;
}

type Resolvido = { codigo_usado: string; n_cod_prod_usado: number; origem: string; n_cod_prod_atual: number;
  codigo_atual: string | null; codigo_omie_atual: string | null; descricao_atual: string | null };

/** Resolve códigos (ou ids do Omie) guardados em propostas antigas para o item de hoje. */
export async function resolverCodigosCrm(codigos: string[], empresa = "SF", comHistorico = 0): Promise<Record<string, ItemCrm>> {
  const pedidos = [...new Set(codigos.map((c) => String(c ?? "").trim()).filter(Boolean))].slice(0, 500);
  if (!pedidos.length) return {};
  const { data, error } = await orders().rpc("item_codigo_resolver", { p_empresa: empresa, p_codigos: pedidos });
  if (error) throw new Error(error.message);
  const linhas = ((data ?? []) as Resolvido[]);
  const info = await infos(empresa, linhas.map((l) => Number(l.n_cod_prod_atual)));
  const out: Record<string, ItemCrm> = {};
  for (const c of pedidos) {
    const u = c.toUpperCase();
    const ls = linhas.filter((l) => String(l.codigo_usado ?? "").toUpperCase() === u || String(l.n_cod_prod_usado) === c);
    // código de fornecedor só vale se não houver resolução "nossa"
    const l = ls.find((x) => x.origem !== "fornecedor") ?? ls[0];
    if (!l) continue;
    const i = info.get(Number(l.n_cod_prod_atual));
    out[c] = {
      ncod_prod: Number(l.n_cod_prod_atual),
      codigo: i?.codigo_novo ?? l.codigo_atual ?? null,
      codigo_omie: i?.codigo_omie ?? l.codigo_omie_atual ?? null,
      via: String(l.codigo_atual ?? "").toUpperCase() !== u && String(i?.codigo_novo ?? "").toUpperCase() !== u ? `${l.origem} · era ${c}` : undefined,
      descricao: l.descricao_atual ?? c,
      unidade: (i?.unidade ?? "UN") || "UN",
      cmc: n(i?.cmc), saldo: n(i?.saldo), ultimo_preco: n(i?.ult_preco), ultima_compra: null, fornecedor: null,
      qtd_compras: null, preco_maximo: n(i?.preco_maximo),
    };
  }
  // Com histórico, a última compra diz o fornecedor e a data — a RC do CRM
  // sugere o fornecedor que praticou o custo (05/10/26).
  if (comHistorico > 0) {
    await Promise.all(Object.values(out).map(async (it) => {
      const h = await historico(it.codigo, comHistorico);
      it.historico = h;
      if (h[0]) { it.fornecedor = h[0].f; it.ultima_compra = h[0].d; it.ultimo_preco = it.ultimo_preco ?? h[0].vu; }
    }));
  }
  return out;
}

/** Casa linhas de texto livre (CP sem código) com o catálogo: só devolve as
 *  que casam com segurança (texto muito parecido E medidas batendo). */
export async function casarItensCrm(textos: string[], empresa = "SF", comHistorico = 0): Promise<(ItemCrm | null)[]> {
  const cas = await casarCatalogo(textos.slice(0, 400));
  const ok = cas.map((c) => (c.status === "ok" && c.melhor ? String(c.melhor.ncod_prod) : null));
  const res = await resolverCodigosCrm(ok.filter((x): x is string => !!x), empresa, comHistorico);
  return ok.map((id, k) => {
    if (!id) return null;
    const r = res[id];
    const m = cas[k].melhor!;
    if (r) return { ...r, via: undefined, ultimo_preco: n(m.ultimo_preco) ?? r.ultimo_preco,
      ultima_compra: m.ultima_compra ?? r.ultima_compra, fornecedor: m.fornecedor ?? r.fornecedor };
    return { ncod_prod: Number(m.ncod_prod), codigo: m.codigo, codigo_omie: m.codigo, descricao: m.descricao, unidade: m.unidade ?? "UN",
      cmc: null, saldo: null, ultimo_preco: n(m.ultimo_preco), ultima_compra: m.ultima_compra, fornecedor: m.fornecedor,
      qtd_compras: n(m.qtd_compras), preco_maximo: null };
  });
}

/** Limites de preço de vários itens (para o PC/RC avisar). */
export async function precosMaximos(ids: number[], empresa = "SF"): Promise<Record<number, number>> {
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x) && x !== 0))];
  if (!uniq.length) return {};
  const { data, error } = await orders().rpc("estoque_preco_max_ler", { p_empresa: empresa, p_prods: uniq });
  if (error) throw new Error(error.message);
  const out: Record<number, number> = {};
  for (const r of (data ?? []) as { n_cod_prod: number; preco_maximo: number }[]) out[Number(r.n_cod_prod)] = Number(r.preco_maximo);
  return out;
}
