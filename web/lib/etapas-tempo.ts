/**
 * Etapas de um pedido no tempo — previsto, realizado, e o que falta.
 *
 * A linha do tempo antiga desenhava uma barra emissão→limite e pouco mais: não
 * dizia em que etapa o pedido está, há quanto tempo, nem o que falta. Isto
 * resolve a parte de cálculo; o desenho vive em `components/navy/LinhaDoTempo`.
 *
 * As etapas são exactamente as que a vista sabe datar — verificado coluna a
 * coluna em `sales.mv_pc_avulsos`:
 *
 *   venda   pv_emissao              100%   sempre existe, é a origem
 *   pc      dt_inclusao              61%   emissão do PC no Omie
 *   aprov   aprovado_em              51%   decisão do workflow
 *   nf      mt_data_recebimento_nf   30%   chegada do material
 *   fat     pv_dt_fat                89%   saída
 *
 * Previsões: `dt_previsao` (material, original) remarcada por
 * `nova_prev_materiais`, e `pv_data_previsao` como limite da venda.
 *
 * NÃO há data de criação de RC na vista. A legenda antiga prometia "RC criada"
 * e nunca desenhava marco nenhum. Enquanto a coluna não existir, a etapa não
 * entra aqui — inventar uma posição seria pior do que admitir a falta.
 */

import { parseFlexDate } from "./alarmes";
import { STATUS_META } from "./columns";

type Linha = Record<string, unknown>;

const s = (v: unknown) => String(v ?? "").trim();
const dia = (v: unknown): number | null => {
  const t = s(v);
  if (!t) return null;
  const d = parseFlexDate(t);
  return d == null || Number.isNaN(d) ? null : d;
};
const DIA_MS = 86_400_000;

export type ChaveEtapa = "venda" | "pc" | "aprov" | "nf" | "fat";

export type Etapa = {
  chave: ChaveEtapa;
  rotulo: string;
  /** Quando aconteceu. null = ainda não aconteceu. */
  em: number | null;
  /** Quando estava previsto acontecer, se a vista souber. */
  previsto: number | null;
  /** Previsão remarcada — quando existe, `previsto` é a original. */
  remarcado: number | null;
  /** Quantas compras já passaram esta etapa, de quantas deviam. */
  feitos: number;
  total: number;
};

export type ResumoTempo = {
  emissao: number | null;
  limite: number | null;
  etapas: Etapa[];
  /** Primeira etapa por concluir — onde o pedido está parado. */
  atual: Etapa | null;
  /** Dias desde que a etapa anterior fechou (ou desde a emissão). */
  diasNaAtual: number | null;
  /** Frase curta do que falta: "4 de 7 NF por chegar". */
  falta: string;
  /** Dias de atraso face ao limite do PV. Negativo = ainda há folga. */
  atrasoLimite: number | null;
  /** Duração realizada de cada etapa, em dias, para o detalhe. */
  duracoes: { rotulo: string; dias: number }[];
};

const maxData = (vs: (number | null)[]) => {
  const ok = vs.filter((v): v is number => v != null);
  return ok.length ? Math.max(...ok) : null;
};
const minData = (vs: (number | null)[]) => {
  const ok = vs.filter((v): v is number => v != null);
  return ok.length ? Math.min(...ok) : null;
};

export function resumoDoTempo(lotes: Linha[], head: Linha, hoje: number): ResumoTempo {
  const emissao = dia(head.pv_emissao);
  const limite = dia(head.pv_data_previsao);

  const comPc = lotes.filter((r) => s(r.pc_numero) || s(r.pc_numero_manual));
  const aprovados = comPc.filter((r) => STATUS_META[s(r.status)]?.isApproved);
  const recebidos = comPc.filter((r) => s(r.mt_data_recebimento_nf));

  /* Marcos agregados. O PC usa o PRIMEIRO (quando a compra arrancou); as
     etapas seguintes usam o ÚLTIMO, porque a etapa só fecha quando a última
     compra a cumpre. Misturar os dois critérios daria um pedido "aprovado"
     com metade por aprovar. */
  const pcEm = minData(comPc.map((r) => dia(r.dt_inclusao)));
  const aprovEm = aprovados.length === comPc.length && comPc.length > 0
    ? maxData(aprovados.map((r) => dia(r.aprovado_em))) : null;
  const nfEm = recebidos.length === comPc.length && comPc.length > 0
    ? maxData(recebidos.map((r) => dia(r.mt_data_recebimento_nf))) : null;
  const fatEm = dia(head.pv_dt_fat);

  const prevMatOrig = maxData(comPc.map((r) => dia(r.dt_previsao)));
  const prevMatNova = maxData(comPc.map((r) => dia(r.nova_prev_materiais)));

  const etapas: Etapa[] = [
    { chave: "venda", rotulo: "Venda", em: emissao, previsto: null, remarcado: null,
      feitos: emissao ? 1 : 0, total: 1 },
    { chave: "pc", rotulo: "PC emitido", em: pcEm, previsto: null, remarcado: null,
      feitos: comPc.length, total: lotes.length },
    { chave: "aprov", rotulo: "Aprovação", em: aprovEm, previsto: null, remarcado: null,
      feitos: aprovados.length, total: comPc.length },
    { chave: "nf", rotulo: "Material", em: nfEm, previsto: prevMatOrig, remarcado: prevMatNova,
      feitos: recebidos.length, total: comPc.length },
    { chave: "fat", rotulo: "Faturado", em: fatEm, previsto: limite, remarcado: null,
      feitos: fatEm ? 1 : 0, total: 1 },
  ];

  /* Etapa actual: a primeira que ainda não fechou. Uma etapa sem trabalho
     nenhum (total 0 — por exemplo aprovação num pedido sem PC) não conta como
     parada: não há nada ali para esperar. */
  const atual = etapas.find((e) => e.total > 0 && e.feitos < e.total) ?? null;

  /* Há quanto tempo está parada: desde que a etapa anterior fechou. */
  let diasNaAtual: number | null = null;
  if (atual) {
    const idx = etapas.indexOf(atual);
    const anterior = etapas.slice(0, idx).reverse().find((e) => e.em != null);
    const desde = anterior?.em ?? emissao;
    if (desde != null) diasNaAtual = Math.floor((hoje - desde) / DIA_MS);
  }

  const falta = !atual ? "nada — pedido fechado"
    : atual.chave === "pc"    ? `${atual.total - atual.feitos} de ${atual.total} sem PC`
    : atual.chave === "aprov" ? `${atual.total - atual.feitos} de ${atual.total} por aprovar`
    : atual.chave === "nf"    ? `${atual.total - atual.feitos} de ${atual.total} por receber`
    : atual.chave === "fat"   ? "falta faturar"
    : "—";

  const atrasoLimite = limite == null ? null : Math.floor((hoje - limite) / DIA_MS);

  /* Durações realizadas — só entre marcos que existem os dois. */
  const duracoes: { rotulo: string; dias: number }[] = [];
  const pares: [string, number | null, number | null][] = [
    ["venda → PC", emissao, pcEm],
    ["PC → aprovação", pcEm, aprovEm],
    ["aprovação → material", aprovEm, nfEm],
    ["material → faturamento", nfEm, fatEm],
  ];
  for (const [rotulo, a, b] of pares) {
    if (a == null || b == null) continue;
    duracoes.push({ rotulo, dias: Math.max(0, Math.round((b - a) / DIA_MS)) });
  }

  return { emissao, limite, etapas, atual, diasNaAtual, falta, atrasoLimite, duracoes };
}
