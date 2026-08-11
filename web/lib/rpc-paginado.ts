/**
 * Chama uma RPC do Supabase paginando com .range().
 *
 * ── O problema que isto resolve ──────────────────────────────────────────────
 * O PostgREST corta a resposta em 1000 linhas. Em silêncio: sem erro, sem
 * cabeçalho de aviso, sem nada. O `p_limit` da própria função NÃO protege — ele
 * limita o que o Postgres devolve, e o corte acontece depois, no transporte.
 *
 * Já mordeu este projeto duas vezes:
 *
 *   1. /api/list/rows — mv_pc_avulsos tem 1776 linhas, o painel recebia 1000 e
 *      calculava os alarmes sobre um recorte incompleto, subestimando.
 *
 *   2. /api/bi/contas-pagar — a agenda ordena vencidos primeiro e havia 1008
 *      deles. Os 1000 primeiros consumiam a cota inteira, então NADA do "a
 *      vencer" chegava: o filtro "vence hoje" ficava vazio mesmo existindo 4
 *      títulos vencendo naquele dia.
 *
 * Os dois casos são do mesmo tipo — o dado existe, a query está certa, e o que
 * chega é um pedaço. Por isso a defesa vive aqui e não em cada rota.
 *
 * `teto` é uma trava contra loop infinito, não um limite de negócio: se a lista
 * for maior que isso, algo está errado no recorte da consulta.
 */

type ClientRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    range: (de: number, ate: number) => PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
};

const PAGINA = 1000;   // o cap do PostgREST

export async function rpcPaginado(
  adm: ClientRpc,
  fn: string,
  args: Record<string, unknown>,
  teto = 6000,
): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const linhas: unknown[] = [];

  for (let ini = 0; ini < teto; ini += PAGINA) {
    const { data, error } = await adm.rpc(fn, args).range(ini, ini + PAGINA - 1);
    if (error) return { data: null, error };

    const lote = (data ?? []) as unknown[];
    linhas.push(...lote);

    // Página incompleta = acabou. Sem isto, uma lista de exatamente 1000 linhas
    // pediria uma segunda página vazia — barato, mas confuso no log.
    if (lote.length < PAGINA) break;
  }

  return { data: linhas, error: null };
}
