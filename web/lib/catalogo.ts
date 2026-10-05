// Catálogo de compras (orders.mv_catalogo_compra, sql/19) — busca do
// autocompletar e casamento em lote de texto livre (Excel, CP do CRM).

import { supaAdmin } from "@/lib/supabase-admin";

export type ItemCatalogo = {
  ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; ultima_compra: string | null; fornecedor: string | null;
  qtd_compras: number | null; entrega_dias: number | null; entrega_fonte: string | null;
  fat_dias: number | null; score?: number; medidas_ok?: boolean;
};

/** Resultado de casar uma linha: "ok" entra sozinho; "conferir" fica amarelo
 *  com as alternativas; "sem" não achou nada parecido. */
export type Casamento = {
  idx: number; status: "ok" | "conferir" | "sem";
  melhor: ItemCatalogo | null; alternativas: ItemCatalogo[];
};

/** Aceita sozinho só quando o texto é MUITO parecido E as medidas batem —
 *  "tubo 1/2" nunca vira "tubo 1" sem alguém olhar. */
const ACEITA = 0.6;

export async function buscarCatalogo(q: string, lim = 12): Promise<ItemCatalogo[]> {
  const { data, error } = await supaAdmin().schema("orders")
    .rpc("buscar_catalogo", { q, lim });
  if (error) throw new Error(error.message);
  return (data ?? []) as ItemCatalogo[];
}

export async function casarCatalogo(textos: string[]): Promise<Casamento[]> {
  const out: Casamento[] = textos.map((_, i) => ({ idx: i, status: "sem", melhor: null, alternativas: [] }));
  if (!textos.length) return out;
  // Em lotes: a função faz um lateral por linha, e 500 itens de uma vez
  // passariam do statement timeout.
  const LOTE = 60;
  for (let ini = 0; ini < textos.length; ini += LOTE) {
    const fatia = textos.slice(ini, ini + LOTE);
    const { data, error } = await supaAdmin().schema("orders")
      .rpc("casar_catalogo", { itens: fatia });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<ItemCatalogo & { idx: number; rank: number }>) {
      const c = out[ini + r.idx - 1];
      if (!c) continue;
      c.alternativas.push(r);
    }
  }
  for (const c of out) {
    c.alternativas.sort((a, b) => Number(b.medidas_ok) - Number(a.medidas_ok) || (b.score ?? 0) - (a.score ?? 0));
    c.melhor = c.alternativas[0] ?? null;
    c.status = !c.melhor ? "sem"
      : c.melhor.medidas_ok && (c.melhor.score ?? 0) >= ACEITA ? "ok" : "conferir";
  }
  return out;
}

/* Histórico de códigos (02/10/26): o item escolhido num PC/RC novo leva o código
   de HOJE (família nova / item que absorveu o mesclado), e a busca acha também
   por qualquer código antigo. Resolvedor do Estoque: orders.item_codigo_resolver. */
type Resolvido = { codigo_usado: string; origem: string; n_cod_prod_usado: number; n_cod_prod_atual: number;
  codigo_atual: string | null; codigo_omie_atual: string | null; descricao_atual: string | null };
export async function produtosComCodigoAtual(q: string) {
  const base = await buscarCatalogo(q, 12);
  const codes = [q, ...base.map((b) => b.codigo ?? "").filter(Boolean), ...base.map((b) => String(b.ncod_prod))];
  const { data } = await supaAdmin().schema("orders").rpc("item_codigo_resolver", { p_empresa: "SF", p_codigos: codes });
  const linhas = ((data ?? []) as Resolvido[]).filter((l) => l.origem !== "fornecedor");
  const porId = new Map(linhas.map((l) => [l.n_cod_prod_usado, l]));
  const out: (ItemCatalogo & { codigo_omie?: string | null; via?: string })[] = [];
  const vistos = new Set<number>();
  // quem buscou por um código antigo/mesclado: o item de hoje vem primeiro
  for (const l of linhas.filter((x) => x.codigo_usado.toUpperCase() === q.toUpperCase())) {
    if (vistos.has(l.n_cod_prod_atual)) continue;
    const b = base.find((x) => x.ncod_prod === l.n_cod_prod_atual || x.ncod_prod === l.n_cod_prod_usado);
    out.push({ ...(b ?? { ultimo_preco: null, ultima_compra: null, fornecedor: null, qtd_compras: null, entrega_dias: null, entrega_fonte: null, fat_dias: null, unidade: null }),
      ncod_prod: l.n_cod_prod_atual, codigo: l.codigo_atual, descricao: l.descricao_atual ?? b?.descricao ?? q,
      codigo_omie: l.codigo_omie_atual, via: l.codigo_usado.toUpperCase() !== String(l.codigo_atual ?? "").toUpperCase() ? `código antigo ${l.codigo_usado}` : undefined });
    vistos.add(l.n_cod_prod_atual);
  }
  for (const b of base) {
    const l = porId.get(b.ncod_prod);
    const id = l?.n_cod_prod_atual ?? b.ncod_prod;
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push(l ? { ...b, ncod_prod: id, codigo: l.codigo_atual ?? b.codigo, descricao: l.descricao_atual ?? b.descricao,
                   codigo_omie: b.codigo, via: id !== b.ncod_prod ? `mesclado de ${b.codigo}` : undefined }
               : b);
  }
  return out.slice(0, 12);
}
