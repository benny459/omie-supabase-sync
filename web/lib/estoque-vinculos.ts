// Itens que movimentam estoque só com código NATIVO (05/10/26).
// Código de compra (produto do Omie que nunca entrou no estoque nativo) não
// vai para a nota: ou vira o item nosso pelo vínculo, ou é cadastrado no
// estoque na hora. Ver sql/77_itens_nativos_vinculo.sql.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";

const orders = () => supaAdmin().schema("orders");

export type ItemNativo = {
  n_cod_prod: number; codigo: string; codigo_omie: string | null; descricao: string; unidade: string | null;
  ncm: string | null; saldo: number | null; cmc: number | null; ultimo_preco: number | null; via: string | null; familia_id: number | null;
};
export type CodigoCompra = {
  n_cod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  ultima_compra: string | null; fornecedor: string | null; fornecedor_cod: number | null; ncm: string | null;
};

/** Busca para notas que movem estoque: nativos (com o código de compra resolvido) + códigos de compra sem item nosso. */
export async function buscarItensEstoque(empresa: string, q: string, lim = 10): Promise<{ nativos: ItemNativo[]; compra: CodigoCompra[] }> {
  const { data, error } = await orders().rpc("fat_itens_buscar", { p_empresa: empresa, p_q: q, p_lim: lim });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { nativos?: ItemNativo[]; compra?: CodigoCompra[] };
  return { nativos: d.nativos ?? [], compra: d.compra ?? [] };
}

/** Códigos da nota que não são de item nativo (bloqueiam a emissão). */
export async function codigosSemEstoque(empresa: string, codigos: string[]): Promise<string[]> {
  const cods = [...new Set(codigos.map((c) => (c ?? "").trim()).filter(Boolean))];
  if (!cods.length) return [];
  const { data, error } = await orders().rpc("fat_itens_validar", { p_empresa: empresa, p_codigos: cods });
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}

/** Troca, nas linhas, o código antigo (Omie / de compra vinculado) pelo código do NOSSO estoque (07/10/26).
 *  A nota nunca sai com código que não é do estoque: o que tem item nosso troca aqui, o resto bloqueia
 *  em codigosSemEstoque. */
export async function trocarParaCodigoNosso<T extends { codigo?: string | null }>(empresa: string, itens: T[]): Promise<T[]> {
  const cods = [...new Set(itens.map((i) => (i.codigo ?? "").trim()).filter(Boolean))];
  if (!cods.length) return itens;
  const { data, error } = await orders().rpc("fat_itens_resolver", { p_empresa: empresa, p_codigos: cods });
  if (error) throw new Error(error.message);
  const mapa = new Map(((data ?? []) as { codigo: string; codigo_nativo: string }[]).map((r) => [r.codigo.trim().toUpperCase(), r.codigo_nativo]));
  if (!mapa.size) return itens;
  return itens.map((i) => {
    const novo = mapa.get((i.codigo ?? "").trim().toUpperCase());
    return novo ? { ...i, codigo: novo } : i;
  });
}

export const MSG_SEM_ESTOQUE = (cods: string[]) =>
  `Item sem código do estoque (${cods.join(", ")}) — vincule a um item nosso ou cadastre no estoque antes de emitir.`;
