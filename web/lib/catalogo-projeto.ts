// Catálogo da lista de materiais do projeto (07/10/26) — itens NOSSOS primeiro.
//
// Antes a lista (autocompletar, "Casar com o catálogo", aba Itens da CP) olhava
// só os nomes de produto do Omie (orders.mv_catalogo_compra): a linha ficava com
// o código do Omie (3014120, E3353…) e o que existe no estoque nosso com outro
// nome nem aparecia. Agora é a mesma fonte do Faturamento:
//   • busca  = orders.fat_itens_buscar (nativo por código novo/Omie/descrição,
//              código antigo/mesclado e código de compra vinculado → "cód. compra X");
//   • casar  = casarTopCrm (catalogo-casar: nome + preço + unidade, de-para gravado
//              primeiro), com o casamento antigo do Omie só como reserva quando o
//              produto do Omie já resolve para um item nosso;
//   • último preço, fornecedor e prazos continuam vindo das compras — do próprio
//     item e de todos os códigos de compra vinculados a ele.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { casarCatalogo } from "@/lib/catalogo";
import { casarTopCrm } from "@/lib/catalogo-crm";
import { buscarItensEstoque } from "@/lib/estoque-vinculos";
import { statusCasamento } from "@/lib/catalogo-casar";
import { deHtml } from "@/lib/match-pc";

const orders = () => supaAdmin().schema("orders");
const platform = () => supaAdmin().schema("platform");

/** Item como a lista de materiais mostra (mesmo formato do catálogo antigo, com `nativo`). */
export type ItemLista = {
  ncod_prod: number; codigo: string | null; codigo_omie?: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; ultima_compra: string | null; fornecedor: string | null;
  qtd_compras: number | null; entrega_dias: number | null; entrega_fonte: string | null; fat_dias: number | null;
  nativo: boolean; via?: string | null; score?: number; motivo?: string; medidas_ok?: boolean;
};
export type CasamentoLista = {
  idx: number; status: "ok" | "conferir" | "sem"; manual: boolean;
  melhor: ItemLista | null; alternativas: ItemLista[];
  /** produtos só do Omie (sem item nosso) parecidos — base para "Criar item nosso" */
  compra: ItemLista[];
};

type Mv = { ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  ultima_compra: string | null; fornecedor: string | null; qtd_compras: number | null; entrega_dias: number | null;
  entrega_fonte: string | null; fat_dias: number | null };
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Compras do item nosso: as do próprio n_cod_prod e as dos códigos de compra vinculados a ele. */
export async function comprasDosNativos(empresa: string, ids: number[]): Promise<Map<number, Partial<ItemLista>>> {
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x) && x > 0))];
  const out = new Map<number, Partial<ItemLista>>();
  if (!uniq.length) return out;
  const vinc = await platform().from("estoque_item_vinculo").select("n_cod_prod_origem, n_cod_prod_destino")
    .eq("empresa", empresa).is("desfeito_em", null).in("n_cod_prod_destino", uniq);
  const dono = new Map<number, number>(uniq.map((i) => [i, i]));
  for (const v of (vinc.data ?? []) as { n_cod_prod_origem: number; n_cod_prod_destino: number }[]) {
    dono.set(Number(v.n_cod_prod_origem), Number(v.n_cod_prod_destino));
  }
  const todos = [...dono.keys()];
  const linhas: Mv[] = [];
  for (let i = 0; i < todos.length; i += 300) {
    const { data, error } = await orders().from("mv_catalogo_compra")
      .select("ncod_prod, codigo, descricao, unidade, ultimo_preco, ultima_compra, fornecedor, qtd_compras, entrega_dias, entrega_fonte, fat_dias")
      .eq("empresa", empresa).in("ncod_prod", todos.slice(i, i + 300));
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as Mv[]));
  }
  for (const m of linhas) {
    const id = dono.get(Number(m.ncod_prod));
    if (!id) continue;
    const atual = out.get(id);
    const qtd = (atual?.qtd_compras ?? 0) + (n(m.qtd_compras) ?? 0);
    // a compra mais recente manda no preço, fornecedor e prazos
    if (!atual || String(m.ultima_compra ?? "") > String(atual.ultima_compra ?? "")) {
      out.set(id, { ultimo_preco: n(m.ultimo_preco), ultima_compra: m.ultima_compra, fornecedor: m.fornecedor ? deHtml(m.fornecedor) : null,
        entrega_dias: n(m.entrega_dias), entrega_fonte: m.entrega_fonte, fat_dias: n(m.fat_dias), qtd_compras: qtd });
    } else out.set(id, { ...atual, qtd_compras: qtd });
  }
  return out;
}

type Nat = { n_cod_prod: number; codigo: string; codigo_omie: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; via?: string | null };
async function completar(empresa: string, nat: Nat[]): Promise<ItemLista[]> {
  const info = await comprasDosNativos(empresa, nat.map((x) => Number(x.n_cod_prod)));
  return nat.map((x) => {
    const i = info.get(Number(x.n_cod_prod));
    return {
      ncod_prod: Number(x.n_cod_prod), codigo: x.codigo, codigo_omie: x.codigo_omie, descricao: deHtml(x.descricao), unidade: x.unidade,
      ultimo_preco: i?.ultimo_preco ?? n(x.ultimo_preco), ultima_compra: i?.ultima_compra ?? null, fornecedor: i?.fornecedor ?? null,
      qtd_compras: i?.qtd_compras ?? null, entrega_dias: i?.entrega_dias ?? null, entrega_fonte: i?.entrega_fonte ?? null,
      fat_dias: i?.fat_dias ?? null, nativo: true, via: x.via ?? null,
    };
  });
}

/** Autocompletar: itens nossos (com o código novo) primeiro; produtos só do Omie à parte. */
export async function buscarItensProjeto(empresa: string, q: string, lim = 12): Promise<{ itens: ItemLista[]; compra: ItemLista[] }> {
  const termo = q.trim();
  if (termo.length < 2) return { itens: [], compra: [] };
  const r = await buscarItensEstoque(empresa, termo, Math.max(1, Math.min(lim, 20)));
  const itens = await completar(empresa, r.nativos);
  const compra: ItemLista[] = r.compra.map((c) => ({
    ncod_prod: Number(c.n_cod_prod), codigo: c.codigo, descricao: deHtml(c.descricao), unidade: c.unidade,
    ultimo_preco: n(c.ultimo_preco), ultima_compra: c.ultima_compra, fornecedor: c.fornecedor ? deHtml(c.fornecedor) : null,
    qtd_compras: null, entrega_dias: null, entrega_fonte: null, fat_dias: null, nativo: false,
  }));
  return { itens, compra };
}

/** Itens nossos por n_cod_prod — e qualquer produto do Omie resolvido para o item nosso dele. */
export async function resolverItensProjeto(empresa: string, ids: number[]): Promise<Record<string, ItemLista>> {
  const uniq = [...new Set(ids.filter((x) => Number.isFinite(x) && x > 0))].slice(0, 500);
  if (!uniq.length) return {};
  const destino = new Map<number, number>();
  await Promise.all(uniq.map(async (id) => {
    const { data } = await orders().rpc("estoque_item_nativo", { p_empresa: empresa, p_prod: id });
    if (data != null) destino.set(id, Number(data));
  }));
  const nativos = [...new Set(destino.values())];
  if (!nativos.length) return {};
  const { data, error } = await orders().from("v_estoque_item")
    .select("n_cod_prod, codigo_novo, codigo_omie, descricao, unidade, ult_preco")
    .eq("empresa", empresa).in("n_cod_prod", nativos).not("codigo_novo", "is", null);
  if (error) throw new Error(error.message);
  const nat = ((data ?? []) as { n_cod_prod: number; codigo_novo: string; codigo_omie: string | null; descricao: string; unidade: string | null; ult_preco: number | null }[])
    .map((x) => ({ n_cod_prod: Number(x.n_cod_prod), codigo: x.codigo_novo, codigo_omie: x.codigo_omie, descricao: x.descricao, unidade: x.unidade, ultimo_preco: x.ult_preco }));
  const porId = new Map((await completar(empresa, nat)).map((x) => [x.ncod_prod, x]));
  const out: Record<string, ItemLista> = {};
  for (const [origem, dest] of destino) {
    const it = porId.get(dest);
    if (it) out[String(origem)] = origem === dest ? it : { ...it, via: `era ${origem}` };
  }
  return out;
}

/** Casa linhas de texto livre (CP do CRM, lista colada) com os itens NOSSOS.
 *  "ok" só com de-para gravado ou nome muito parecido com folga para o 2º;
 *  nada é criado aqui — o que não casa fica para o seletor da linha. */
export async function casarItensProjeto(empresa: string, textos: string[], custos: (number | null)[] = []): Promise<CasamentoLista[]> {
  const out: CasamentoLista[] = textos.map((_, i) => ({ idx: i, status: "sem", manual: false, melhor: null, alternativas: [], compra: [] }));
  if (!textos.length) return out;
  const tops: Awaited<ReturnType<typeof casarTopCrm>> = [];
  for (let i = 0; i < textos.length; i += 200) {
    tops.push(...await casarTopCrm(textos.slice(i, i + 200), custos.slice(i, i + 200), [], 3, empresa));
  }
  const ids = [...new Set(tops.flat().map((c) => c.id))];
  const info = await comprasDosNativos(empresa, ids);
  const comoItem = (c: (typeof tops)[number][number]): ItemLista => {
    const i = info.get(c.id);
    return { ncod_prod: c.id, codigo: c.cod, descricao: deHtml(c.desc), unidade: c.un, ultimo_preco: i?.ultimo_preco ?? c.ultimo_preco,
      ultima_compra: i?.ultima_compra ?? null, fornecedor: i?.fornecedor ?? null, qtd_compras: i?.qtd_compras ?? null,
      entrega_dias: i?.entrega_dias ?? null, entrega_fonte: i?.entrega_fonte ?? null, fat_dias: i?.fat_dias ?? null,
      nativo: true, score: c.score, motivo: c.motivo };
  };
  const semNada: number[] = [];
  tops.forEach((lista, k) => {
    const st = statusCasamento(lista, textos[k]);
    const alts = lista.map(comoItem);
    out[k] = { idx: k, status: st, manual: lista[0]?.motivo === "de-para gravado", melhor: st === "sem" ? null : alts[0] ?? null,
      alternativas: alts, compra: [] };
    if (st === "sem") semNada.push(k);
  });
  // Reserva: o casamento antigo pelo nome do Omie. Se o produto do Omie já é
  // (ou está vinculado a) um item nosso, vira sugestão para conferir; se não,
  // fica como "só no Omie" — base para criar o item nosso no seletor.
  if (semNada.length) {
    const omie = await casarCatalogo(semNada.map((k) => textos[k]));
    const resolvidos = await resolverItensProjeto(empresa, omie.flatMap((c) => c.alternativas.slice(0, 3).map((a) => Number(a.ncod_prod))));
    omie.forEach((c, j) => {
      const k = semNada[j];
      const nat = c.alternativas.slice(0, 3).map((a) => resolvidos[String(a.ncod_prod)]).filter((x): x is ItemLista => !!x);
      if (nat.length) {
        out[k] = { ...out[k], status: "conferir", melhor: { ...nat[0], motivo: "pelo nome do produto no Omie" },
          alternativas: [...new Map(nat.map((x) => [x.ncod_prod, x])).values()] };
      }
      out[k].compra = c.alternativas.slice(0, 3).filter((a) => !resolvidos[String(a.ncod_prod)])
        .map((a) => ({ ncod_prod: Number(a.ncod_prod), codigo: a.codigo, descricao: deHtml(a.descricao), unidade: a.unidade,
          ultimo_preco: n(a.ultimo_preco), ultima_compra: a.ultima_compra, fornecedor: a.fornecedor ? deHtml(a.fornecedor) : null,
          qtd_compras: n(a.qtd_compras), entrega_dias: n(a.entrega_dias), entrega_fonte: a.entrega_fonte, fat_dias: n(a.fat_dias),
          nativo: false, score: a.score, medidas_ok: a.medidas_ok }));
    });
  }
  return out;
}

// ── Preparar o cadastro de item nosso (famílias, parecidos, família sugerida) ──
// Saiu de /api/estoque/vinculos para servir também a lista de materiais.
export type Parecido = { n_cod_prod: number; codigo_novo: string | null; descricao: string; saldo: number | null; sim: number; igual: boolean; fraco?: boolean };
export async function prepararCadastroItem(emp: string, descricao: string, origem: number) {
  const [par, fam, inf] = await Promise.all([
    orders().rpc("estoque_parecidos", { p_empresa: emp, p_descricao: descricao, p_excluir: null }),
    platform().from("estoque_familia").select("id, nome, prefixo, ativo").eq("empresa", emp).eq("ativo", true).order("nome"),
    origem ? orders().rpc("estoque_vinculo_info", { p_empresa: emp, p_origem: origem }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (par.error || fam.error) throw new Error((par.error ?? fam.error)!.message);
  let parecidos = ((par.data ?? []) as Parecido[]).filter((p) => p.codigo_novo);
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
      for (const x of nat) if (x.familia_id) cont.set(x.familia_id, (cont.get(x.familia_id) ?? 0) + 1);
      familia_sugerida = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      parecidos = nat.slice(0, 5).map((x) => ({ n_cod_prod: x.n_cod_prod, codigo_novo: x.codigo, descricao: x.descricao, saldo: x.saldo, sim: 0, igual: false, fraco: true }));
    }
  }
  return { parecidos, familias: fam.data ?? [], familia_sugerida, info: inf.data ?? null };
}
