// PV / OS nativos do painel (P1, 05/10/26) — tipos e utilitários partilhados
// entre telas e rotas. A fonte da verdade é o schema `vendas` (sql/49); cada
// documento é espelhado em sales.* com um código >= 9.000.000.000.000, por isso
// aparece em Avulsos, ERP·Vendas, backlog de faturamento e BI como os do Omie.

export const CODIGO_NATIVO = 9_000_000_000_000;

/** O código (sales.v_erp_vendas.codigo) é de um PV/OS nascido no painel? */
export const ehNativo = (codigo: unknown) => Number(codigo) >= CODIGO_NATIVO;
/** id em vendas.documentos a partir do código espelhado. */
export const idDoCodigo = (codigo: unknown) => Number(codigo) - CODIGO_NATIVO;

export type VendaItem = {
  seq?: number;
  codigo?: string | null;
  ncod_prod?: number | null;
  descricao: string;
  unidade?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_desconto?: number | null;
  valor_total?: number;
  fiscal?: Record<string, unknown> | null;
};

export type VendaParcela = { numero: number; vencimento: string; valor: number; percentual?: number | null; dias?: number | null;
  /** nome do evento do fechamento e data prevista de faturamento (projetos, 06/10/26) */ descricao?: string | null; faturamento_previsto?: string | null;
  /** parcela já faturada (NF-e/recibo/NFS-e) e a referência da nota (fat:<id> | nfse:<id>) */ faturada_em?: string | null; emissao_ref?: string | null };

export type VendaStatus = "aberto" | "faturado" | "cancelado";

export type VendaDoc = {
  id: number; empresa: string; tipo: "PV" | "OS"; numero: string; label: string; codigo: number;
  status: VendaStatus; etapa: string; origem: "painel" | "crm";
  cliente_codigo: number | null; cliente: string | null; cliente_razao: string | null; cnpj: string | null;
  cidade: string | null; uf: string | null;
  proposta: string | null; num_pedido_cliente: string | null; contato: string | null;
  emissao: string; previsao: string | null;
  condicao_codigo: string | null; condicao: string | null; qtd_parcelas: number | null;
  projeto_codigo: string | null; projeto: string | null; categoria_codigo: string | null; categoria: string | null;
  vendedor_codigo: string | null; conta_codigo: string | null; forma_recebimento?: string | null;
  observacoes: string | null; obs_nf: string | null;
  valor_mercadorias: number; valor_desconto: number; valor_frete: number; valor_total: number;
  dt_fat: string | null; nf: string | null; chave_nfe: string | null; cancelado_motivo: string | null;
  criado_por: string | null; criado_em: string; atualizado_por: string | null; atualizado_em: string;
  itens: VendaItem[]; parcelas: VendaParcela[];
  historico: { id: number; em: string; por: string | null; acao: string; detalhe: Record<string, unknown> | null }[];
  rcs: { id: number; num: string; tipo: string }[];
  pessoa: Record<string, unknown> | null;
  emissoes: { id: number; tipo: string; ambiente: string; status: string; numero: string | null; mensagem: string | null }[];
};

export type VendaLinha = Pick<VendaDoc, "id" | "empresa" | "tipo" | "numero" | "label" | "status" | "cliente" |
  "proposta" | "emissao" | "previsao" | "valor_total" | "origem" | "nf">;

/** Corpo aceito por orders.vendas_salvar. */
export type VendaSalvar = {
  /** evento do fechamento (projeto): a trava de duplicado passa a ser por proposta+tipo+evento */ evento?: string;
  id?: number; empresa?: string; tipo?: "PV" | "OS"; cliente_codigo: number | string;
  proposta?: string | null; previsao?: string | null; condicao_codigo?: string | null; qtd_parcelas?: number | null;
  projeto_codigo?: string | null; categoria_codigo?: string | null; vendedor_codigo?: string | null;
  conta_codigo?: string | null; forma_recebimento?: string | null; condicao_descricao?: string | null;
  cenario_impostos?: string | null; consumidor_final?: string | null;
  observacoes?: string | null; obs_nf?: string | null; num_pedido_cliente?: string | null; contato?: string | null;
  valor_desconto?: number | null; valor_frete?: number | null; etapa?: string | null; origem?: "painel" | "crm";
  itens: VendaItem[]; parcelas?: VendaParcela[];
};

/** Formas de recebimento (mesmos códigos do Faturamento e do CRM). */
export const FORMAS_RECEBIMENTO: { codigo: string; nome: string }[] = [
  { codigo: "BOL", nome: "Boleto" }, { codigo: "PIX", nome: "Pix" }, { codigo: "TRA", nome: "Transferência" },
  { codigo: "TED", nome: "TED" }, { codigo: "DEP", nome: "Depósito" }, { codigo: "CRC", nome: "Cartão de crédito" },
  { codigo: "CRD", nome: "Cartão de débito" }, { codigo: "DIN", nome: "Dinheiro" }, { codigo: "CHQ", nome: "Cheque" },
];

export const STATUS_VENDA: Record<VendaStatus, { rot: string; cor: string }> = {
  aberto: { rot: "Aberto", cor: "var(--ww-accent-text)" },
  faturado: { rot: "Faturado", cor: "#3FB68B" },
  cancelado: { rot: "Cancelado", cor: "var(--ww-text-faint)" },
};
