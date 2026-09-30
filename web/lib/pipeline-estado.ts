/**
 * Estado do pipeline de um bucket (PV/OS ou projeto) — uma leitura só.
 *
 * Isto é a extração das regras que viviam dentro do `stages` do
 * `BoldAvulsosView`. Ficavam lá presas ao render, e quando escrevi a tela Navy
 * reescrevi-as de raiz por aproximação — resultado: o trilho lia quase tudo a
 * azul, porque a minha versão era muito mais grosseira que a verdadeira.
 *
 * As regras abaixo são as confirmadas com o utilizador, na íntegra:
 *
 *   PV/OS     🔴 sem tipo, cliente ou data limite · 🟡 limite ultrapassado · 🟢 resto
 *   RC        binário — 🟢 todas as RC com custo · 🔴 nenhuma RC ou alguma sem custo
 *   PC        binário — 🟢 todos os PC com fornecedor + valor + categoria · 🔴 resto
 *   Aprovação 🔴 sem workflow · 🟢 todos aprovados · 🟡 qualquer pendência
 *   Materiais 🔴 sem PC · 🟢 todos com NF de entrada · 🟡 parcial
 *   Serviços  off em Mercantil · 🔴 sem previsão · 🟢 todos concluídos · 🟡 resto
 *   Saída     binário — 🟢 pv_dt_fat E pv_num_nfe · 🔴 falta qualquer um
 *
 * Tipo "Serviços" puro apaga o ramo de compra (RC/PC/Aprovação/Materiais) —
 * em /projetos só quando o projeto também não tem PC nenhum, porque lá há
 * projetos marcados como Serviços que compraram material à mesma.
 *
 * TODO: `BoldAvulsosView` ainda tem a sua própria cópia destas regras. Quando
 * a tela Navy substituir a antiga, apagar a cópia de lá e deixar só esta.
 */

import { isServicoConcluido, parseFlexDate, type AlarmRow } from "./alarmes";
import { STATUS_META } from "./columns";

export type EstadoEtapa = "green" | "yellow" | "red" | "off";

export type EtapaPipeline =
  | "pvos" | "rc" | "pc" | "aprovacao" | "materiais" | "servicos" | "saida";

export type PipelineBucket = Record<EtapaPipeline, EstadoEtapa>;

type Linha = Record<string, unknown>;

const s = (v: unknown) => String(v ?? "").trim();

export function estadoDoPipeline(
  items: Linha[],
  opts: { modulo?: string } = {},
): PipelineBucket {
  const vazio: PipelineBucket = {
    pvos: "off", rc: "off", pc: "off", aprovacao: "off",
    materiais: "off", servicos: "off", saida: "off",
  };
  if (items.length === 0) return vazio;

  const hoje = new Date().setHours(0, 0, 0, 0);
  const head = items[0];
  const tipo = s(head.tipo_omie);

  /* ── PV/OS ── */
  const previsaoRaw = s(head.pv_data_previsao);
  const previsaoMs = previsaoRaw ? parseFlexDate(previsaoRaw) : null;
  const pvos: EstadoEtapa =
    !tipo || !s(head.pv_cliente_fantasia) || previsaoMs == null ? "red"
    : previsaoMs < hoje ? "yellow"
    : "green";

  /* ── RC ── binário por número distinto; parcial conta como incompleto. */
  let rcTotal = 0, rcCompleto = 0;
  const rcVistos = new Set<string>();
  for (const r of items) {
    if (r.rc_numero == null) continue;
    const k = String(r.rc_numero);
    if (rcVistos.has(k)) continue;
    rcVistos.add(k);
    rcTotal += 1;
    if (r.rc_custo != null && Number(r.rc_custo) !== 0) rcCompleto += 1;
  }
  const rc: EstadoEtapa = rcTotal === 0 ? "red" : rcCompleto === rcTotal ? "green" : "red";

  /* ── PC ── também binário: cadastro incompleto é tão mau como não existir. */
  let pcTotal = 0, pcCompleto = 0;
  for (const r of items) {
    if (!(r.pc_numero || r.pc_numero_manual)) continue;
    pcTotal += 1;
    const forn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
    const val = r.valor_total != null && Number(r.valor_total) !== 0;
    if (forn && val && !!r.codigo_categoria) pcCompleto += 1;
  }
  const pc: EstadoEtapa = pcTotal === 0 ? "red" : pcCompleto === pcTotal ? "green" : "red";

  /* ── Aprovação ── só as linhas que entram no workflow. */
  const paraAprovar = items.filter((r) => r.pc_numero || r.pc_numero_manual);
  const aprovados = paraAprovar.filter((r) => STATUS_META[s(r.status)]?.isApproved).length;
  const aprovacao: EstadoEtapa =
    paraAprovar.length === 0 ? "red"
    : aprovados === paraAprovar.length ? "green"
    : "yellow";

  /* ── Materiais ── NF de entrada recebida por PC. */
  const recebidos = paraAprovar.filter((r) => !!r.mt_data_recebimento_nf).length;
  const materiais: EstadoEtapa =
    paraAprovar.length === 0 ? "red"
    : recebidos === paraAprovar.length ? "green"
    : "yellow";

  /* ── Serviços ── fora do processo em Mercantil. */
  let servicos: EstadoEtapa = "off";
  if (tipo === "Serviços" || tipo === "Mix") {
    const concluidos = items.filter((r) => isServicoConcluido(r as AlarmRow)).length;
    servicos = previsaoMs == null ? "red"
      : concluidos >= items.length ? "green"
      : "yellow";
  }

  /* ── Saída ── */
  const saida: EstadoEtapa = s(head.pv_dt_fat) && s(head.pv_num_nfe) ? "green" : "red";

  /* Serviço puro não tem ramo de compra. */
  const temPc = items.some((r) => !!r.pc_numero || !!r.pc_numero_manual);
  const soServico = opts.modulo === "projetos"
    ? (tipo === "Serviços" && !temPc)
    : (tipo === "Serviços");
  const compra = (e: EstadoEtapa): EstadoEtapa => (soServico ? "off" : e);

  return {
    pvos,
    rc: compra(rc),
    pc: compra(pc),
    aprovacao: compra(aprovacao),
    materiais: compra(materiais),
    servicos,
    saida,
  };
}

/** Ordem do trilho na tela Navy. Serviços fica entre Materiais e Saída porque
 *  é onde cai no tempo: material chega, serviço executa, depois fatura. */
export const ORDEM_TRILHO: EtapaPipeline[] =
  ["pvos", "rc", "pc", "aprovacao", "materiais", "servicos", "saida"];

export const ROTULO_ETAPA: Record<EtapaPipeline, string> = {
  pvos: "PV/OS", rc: "RC", pc: "PC", aprovacao: "Aprov.",
  materiais: "Mat.", servicos: "Serv.", saida: "Saída",
};
