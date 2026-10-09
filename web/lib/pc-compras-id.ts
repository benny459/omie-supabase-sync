// Que linha de approval.* é um PC criado no Compras do painel? — regra pura (09/10/26).
//
// Nas views da Operação (v_pc_projetos/avulsos/standby/standalone) há DOIS tipos de linha com
// ncod_ped negativo:
//   · PC do Compras (sql/148-149): ncod_ped = -(9e12 + compras.pedidos.id), source = 'compras_painel'
//     → aprova/reprova pela /api/compras/acao;
//   · linha manual (PC digitado à mão, RC sem PC, rc_auto…): ncod_ped negativo pequeno
//     (≈ -1,25e10 no máximo), source 'native'/'rc_auto'/'omie_new' → /api/approvals/set-status.
// Tratar todo negativo como PC do Compras fazia a aprovação de linha manual (ex.: PC 6917, 7273)
// ir para o Compras com ids=[] — a tela mostrava o status novo e nada era gravado.
// Testada em scripts/testes/pc-compras-id.test.ts.

export const BASE_PC_COMPRAS = 9_000_000_000_000;

/** id em compras.pedidos a partir do ncod_ped da linha; null quando não é PC do Compras. */
export function comprasIdDoNcod(ncod: unknown): number | null {
  const n = Number(ncod);
  if (!Number.isFinite(n) || n > -BASE_PC_COMPRAS) return null;
  const id = -n - BASE_PC_COMPRAS;
  return id > 0 ? id : null;
}

type Linha = { ncod_ped?: unknown; source?: unknown; custom_fields?: unknown };

/** id em compras.pedidos da linha; null quando é linha do Omie ou linha manual. */
export function comprasIdDaLinha(row: Linha | null | undefined): number | null {
  if (!row) return null;
  const pelaFaixa = comprasIdDoNcod(row.ncod_ped);
  if (pelaFaixa) return pelaFaixa;
  if (row.source === "compras_painel") {
    const id = Number((row.custom_fields as { compras_id?: unknown } | null)?.compras_id ?? 0);
    return id > 0 ? id : null;
  }
  return null;
}

export const ehPcDoCompras = (row: Linha | null | undefined) =>
  row?.source === "compras_painel" || comprasIdDaLinha(row) != null;

/** Linha criada à mão na Operação (ncod_ped negativo que NÃO é PC do Compras). */
export const ehLinhaManual = (row: Linha | null | undefined) =>
  !!row && Number(row.ncod_ped) < 0 && !ehPcDoCompras(row);
