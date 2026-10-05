/**
 * Rentabilidade — a cadeia inteira de cada PV/OS (sql/54, sales.mv_rentab_pvos).
 *
 *   receita  PV/OS (e a NF, depois de faturado)
 *   custo    PCs ligados ao PV/OS — o mesmo vínculo e a mesma regra da Avulsos
 *   pago     previsões nativas (baixas do painel) + títulos do Omie
 *   recebido contas a receber (Omie + nativo)
 *
 * A margem é (PV − PC) / PV e só existe quando há custo lançado — igual à
 * Avulsos, à ficha do cliente e ao BI: uma régua só.
 */

export type RentabPvos = {
  empresa: string; tipo: "PV" | "OS" | string; numero: string; label: string; nativo: boolean;
  cliente: string | null; codigo_cliente: string | null; cnpj_cpf: string | null;
  projeto: string | null; codigo_projeto: string | null;
  emissao: string | null; dt_fat: string | null; nf: string | null;
  receita_pv: number; receita_nf: number | null; faturado: boolean;
  n_rc: number; custo_rc: number;
  n_pc: number; custo: number; n_nf_entrada: number; n_recebido: number; n_conferido: number; n_pago: number;
  pago: number; a_pagar: number; pcs: string[] | null;
  titulos_receber: number; recebido: number; a_receber: number;
  margem: number | null; margem_pct: number | null;
  pago_ok: boolean; recebido_ok: boolean; etapa_cadeia: EtapaCadeia;
};

export type EtapaCadeia =
  | "pedido" | "rc" | "pc" | "nf_entrada" | "recebido_material" | "conferido" | "pago" | "faturado" | "recebido";

export const ETAPA_CADEIA: Record<EtapaCadeia, string> = {
  pedido: "Pedido", rc: "Requisição", pc: "Pedido de compra", nf_entrada: "NF de entrada",
  recebido_material: "Material recebido", conferido: "Conferido", pago: "Compras pagas",
  faturado: "Faturado", recebido: "Recebido",
};

/** O que a Avulsos precisa por PV/OS (sem valores em R$): os selos Pago / Receb. */
export type RentabResumo = {
  n_pc: number; n_pago: number; pago_ok: boolean;
  faturado: boolean; recebido_ok: boolean; pct_recebido: number | null;
};

export type CadeiaPedido = {
  pedido: RentabPvos | null;
  rcs: { numero: string; itens: number; custo: number }[];
  pcs: {
    numero: string; etapa: string | null; fornecedor_nome: string | null; valor_total: number;
    nf: string | null; dt_rec: string | null; emissao: string | null; origem: string | null;
    pago_painel: number; pago_omie: number; quitado_omie: boolean | null;
  }[];
  receber: {
    num_parcela: string | null; numero_parcela: string | null; vencimento: string | null;
    valor_documento: number; recebido: number; status_titulo: string | null; nf: string | null;
  }[];
};

export const chaveRentab = (empresa: string, label: string) => `${empresa}|${label}`;
