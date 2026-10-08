// Cancelamentos e devoluções de PC (sql/146) — o que tira valor da conta do projeto.
//
//   • Cancelado: o PC entra em platform.excluded_pc (tipo 'cancelado'); quem já esconde
//     PC excluído (lista de Projetos, comprometido, budget, fluxo, regra de aprovação)
//     passa a ignorá-lo sem mudar nada.
//   • Devolução: o PC continua ativo, mas o valor devolvido sai do comprometido, do
//     budget, da margem e do fluxo. Aqui fica a leitura (orders.compras_pcs_ajustes) e a
//     conta pura do desconto, usada por /api/list/rows, lib/lista-pc-completar e
//     lib/fluxo-comparado.
// Falhar a leitura (migração ainda não aplicada, timeout) nunca derruba a tela: sem
// ajustes, tudo continua como antes.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";

import type { DevolucaoBase } from "@/lib/pc-ajustes-conta";
export type DevolucaoItem = { pc_item_id: number; cod: string | null; desc: string | null; un: string | null; qtd: number; vu: number; valor: number };
export type Devolucao = DevolucaoBase & {
  id: number; empresa: string; numero: string; pedido_id: number; tipo: "total" | "parcial"; valor: number; motivo: string;
  nf_numero: string | null; nf_data: string | null; por: string | null; em: string; codigo_projeto: number | null; linhas: number;
  fornecedor: string | null; valor_pc: number | null; origem: "painel" | "omie"; nf_entrada: string | null; chave_entrada: string | null;
  desfeito_por?: string | null; desfeito_em?: string | null; itens: DevolucaoItem[];
};
export type Cancelamento = {
  empresa: string; numero: string; origem: "painel" | "omie" | "sem_cadastro"; pedido_id: number | null; fornecedor: string | null;
  valor: number | null; motivo: string; por: string | null; em: string; codigo_projeto: number | null; linhas: number;
  desfeito_por?: string | null; desfeito_em?: string | null;
};
export type Ajustes = { cancelados: Cancelamento[]; devolucoes: Devolucao[] };

export async function lerAjustes(args: { empresa?: string | null; numeros?: string[] | null; projeto?: number | null; historico?: boolean }): Promise<Ajustes> {
  try {
    const { data, error } = await supaAdmin().schema("orders").rpc("compras_pcs_ajustes", {
      p_empresa: args.empresa ?? null, p_numeros: args.numeros?.length ? args.numeros : null,
      p_projeto: args.projeto ?? null, p_historico: !!args.historico,
    });
    if (error || !data) return { cancelados: [], devolucoes: [] };
    const d = data as Partial<Ajustes>;
    return { cancelados: d.cancelados ?? [], devolucoes: d.devolucoes ?? [] };
  } catch { return { cancelados: [], devolucoes: [] }; }
}

export { devolvidoPorPc, valorLiquido, fatorDevolucao, type ResumoDev } from "@/lib/pc-ajustes-conta";
