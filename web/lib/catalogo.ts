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
