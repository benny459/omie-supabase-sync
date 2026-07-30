// FONTE ÚNICA das regras de alarme dos Avulsos.
//
// Antes deste módulo, as mesmas regras existiam duplicadas em dois lugares:
// lib/avulsos-report.ts (report diário do Webex, server) e
// components/BoldAvulsosView.tsx (painel, client). As duas cópias divergiram —
// os números do Webex e do painel não batiam. Divergências encontradas e
// resolvidas aqui (2026-07-29):
//
//   1. isSemProjeto  — o painel usava regex `!/^(40_VS|41_VP|PJ)/`, que marcava
//      todo projeto CT* como "sem projeto": 98 falsos positivos em 1776 linhas.
//      O report já tinha corrigido isso em 2026-07-16; o painel não. Vale a
//      regra do report: só projeto VAZIO é "sem projeto".
//   2. isAtrasoVenda — o painel parseava com Date.parse("YYYY-MM-DD"), que é
//      UTC. Em GMT-3 vira 21h do dia anterior, então previsão de HOJE contava
//      como vencida. Vale parseFlexDate, que devolve meia-noite LOCAL.
//   3. isEncerrada   — o report trata pv_etapa_texto='Cancelado' como PV
//      encerrada (nenhum alarme); o painel não tratava. Vale a regra do report.
//   4. aprov_bloq    — só existia no painel. Agora é calculado aqui pros dois;
//      cabe ao report decidir se exibe (ver REPORT_SECTIONS).
//   5. isApproved    — o report tinha um set local com valores mortos
//      (APROVADO_ATE, APROVADO_ATRASADO) e não reconhecia APROVADO_FAT_DIRETO.
//      Vale o isApproved de lib/columns.ts, que segue o vocabulário real.
//
// REGRA: mudou alarme? Muda AQUI. Nunca reintroduza cópia local.

import { isApproved } from "./columns";

export type AlarmKind =
  | "pvos_incompl"
  | "sem_projeto"
  | "aguarda_liberacao"
  | "venda"
  | "compra"
  | "sem_rc"
  | "sem_pc"
  | "aprov_bloq"
  | "aprov_pend"
  | "defas_omie"
  | "sem_vinculo"
  | "agend_vazio"
  | "agend_venc"
  | "pode_faturar"
  | "retido_cliente";

export const ALARM_KINDS: AlarmKind[] = [
  "pvos_incompl", "sem_projeto", "aguarda_liberacao", "venda", "compra",
  "sem_rc", "sem_pc",
  "aprov_bloq", "aprov_pend", "defas_omie",
  "sem_vinculo", "agend_vazio", "agend_venc",
  "pode_faturar", "retido_cliente",
];

export type AlarmRow = Record<string, unknown>;

// Status de OS gravados pelo app de serviços (app.waterworks.com.br) em
// custom_fields.ww_os_status. Aceita "Concluida" sem acento por defesa — o valor
// real hoje é "Concluída".
const OS_STATUS_CONCLUIDO = new Set(["Concluída", "Concluida"]);

export function osStatus(r: AlarmRow): string {
  const cf = (r.custom_fields as Record<string, unknown> | null) || {};
  return String(cf["ww_os_status"] ?? "").trim();
}

// Serviço concluído. Consulta ww_os_status ALÉM da coluna servicos_concluidos,
// porque essa coluna está `false` em 100% das linhas da base (e
// servicos_concluidos_em é null em todas): o app de serviços nunca a alimenta,
// só grava ww_os_status. Depender apenas dela fazia todo serviço parecer
// pendente — pipeline "0/9 concluído", bolinha amarela e OS rotulada
// "Agendado" mesmo com a OS Concluída e liberada pra faturar. (2026-07-30)
export function isServicoConcluido(r: AlarmRow): boolean {
  return r.servicos_concluidos === true || OS_STATUS_CONCLUIDO.has(osStatus(r));
}

export function isServicoCancelado(r: AlarmRow): boolean {
  return osStatus(r) === "Cancelada";
}

// Não há mais execução pendente — concluído OU cancelado. É o equivalente, no
// lado de serviços, do mt_data_recebimento_nf das compras.
export function isServicoResolvido(r: AlarmRow): boolean {
  return isServicoConcluido(r) || isServicoCancelado(r);
}

// Parse flexível de data: aceita ISO YYYY-MM-DD ou BR DD/MM/YYYY (a view mistura
// as duas convenções entre nova_prev_* e o resto).
// IMPORTANTE: sempre devolve meia-noite LOCAL, nunca UTC. Date.parse('2026-07-10')
// lê ISO como UTC midnight → em GMT-3 vira 21h do dia anterior, e a comparação
// com todayMs (setHours(0)) marca como vencido o que vence hoje.
export function parseFlexDate(s: string): number | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br)  return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  return null;
}

// ── Detectores row-level ────────────────────────────────────────────────

// "PV/OS incompleta" — cadastro do PV/OS sem dado essencial (tipo, cliente ou
// data limite). Espelha o dot vermelho de PV/OS no painel.
export function isPvosIncompleto(r: AlarmRow): boolean {
  const tipoOk    = !!String(r.tipo_omie ?? "").trim();
  const clienteOk = !!String(r.pv_cliente_fantasia ?? "").trim();
  const dtLimOk   = !!String(r.pv_data_previsao ?? "").trim();
  return !tipoOk || !clienteOk || !dtLimOk;
}

// "Sem Projeto" — vendedor não marcou projeto. SÓ vazio conta. Projetos
// contratuais (CT*), avulsos (40_VS/41_VP) e formais (PJ*) são todos válidos.
// Ver divergência #1 no topo: a regex antiga inflava isso 9x.
export function isSemProjeto(r: AlarmRow): boolean {
  return String(r.projeto_nome ?? "").trim() === "";
}

// "Venda em atraso" — PV em aberto (sem NF de saída) e previsão já passou.
export function isAtrasoVenda(r: AlarmRow, todayMs: number): boolean {
  if (String(r.pv_dt_fat ?? "").trim() !== "") return false;
  const s = String(r.pv_data_previsao ?? "").trim();
  if (!s) return false;
  const t = parseFlexDate(s);
  return t != null && t < todayMs;
}

// "Previsão atrasada" (compras) — data efetiva (nova_prev_materiais se existir,
// senão dt_previsao) vencida E material ainda não recebido.
export function isAtrasoCompra(r: AlarmRow, todayMs: number): boolean {
  if (r.mt_data_recebimento_nf) return false;
  const novaS = String(r.nova_prev_materiais ?? "").trim();
  const origS = String(r.dt_previsao ?? "").trim();
  const efetivaStr = novaS || origS;
  if (!efetivaStr) return false;
  const t = parseFlexDate(efetivaStr);
  return t != null && t < todayMs;
}

// "Defasagem Omie" — PC aprovado no painel mas etapa no Omie não é "Aprovação",
// indicando falha de propagação Painel→Omie. Etapa vazia = sync pendente, ignora.
export function isDefasagemOmie(r: AlarmRow): boolean {
  const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
  if (!hasPc) return false;
  if (!isApproved(String(r.status ?? ""))) return false;
  const etapa = String(r.pc_etapa_texto ?? "").trim();
  return etapa !== "" && etapa !== "Aprovação";
}

const hasPcRow = (r: AlarmRow) => !!r.pc_numero || !!r.pc_numero_manual;

// ── Agregador bucket-level ──────────────────────────────────────────────

// Calcula os alarmes de um PV/OS inteiro (N rows do mesmo pv_os_label).
// Bucket-level porque vários alarmes dependem de estado agregado: "Sem PC" só
// dispara se NENHUMA row tem PC; "Aprovação pendente" só olha rows COM PC, pra
// RC-only (que vem com status default PENDENTE) não gerar falso-positivo.
export function computeBucketAlarms(
  rows: AlarmRow[],
  todayMs: number,
  liberacaoSet?: Set<string>,
): Set<AlarmKind> {
  const set = new Set<AlarmKind>();
  if (rows.length === 0) return set;

  const head = rows[0]; // window functions repetem os campos de PV em todas as rows

  // PV encerrada → NENHUM alarme. Venda concluída não tem mais o que agir, então
  // pendência histórica deixa de importar. Redundância (dt_fat OR num_nfe OR
  // etapa) é intencional, pra imunizar contra lag de sync do Omie.
  const pvDtFat  = String(head.pv_dt_fat ?? "").trim();
  const pvNumNfe = String(head.pv_num_nfe ?? "").trim();
  const pvEtapa  = String(head.pv_etapa_texto ?? "").trim();
  if (pvDtFat !== "" || pvNumNfe !== "" || pvEtapa === "Faturado" || pvEtapa === "Cancelado") {
    return set;
  }

  // Aguardando Liberação — cliente pediu a venda mas ainda não mandou PC formal.
  // ADITIVO: os demais alarmes seguem disparando ao lado.
  if (liberacaoSet?.has(String(head.pv_os_label ?? ""))) {
    set.add("aguarda_liberacao");
  }

  // Vendas
  if (isPvosIncompleto(head))       set.add("pvos_incompl");
  if (isSemProjeto(head))           set.add("sem_projeto");
  if (isAtrasoVenda(head, todayMs)) set.add("venda");

  // Serviços puro não tem compra envolvida — alarmes de RC/PC/logística viram ruído.
  const tipoBucket = String(head.tipo_omie ?? "");
  const hasPurchases = tipoBucket !== "Serviços";
  const anyRc = rows.some((r) => !!r.rc_numero);
  const anyPc = rows.some(hasPcRow);

  if (hasPurchases) {
    for (const r of rows) {
      if (isAtrasoCompra(r, todayMs)) { set.add("compra"); break; }
    }

    // Sem RC OU RC incompleto (XOR entre número e custo)
    if (!anyRc) {
      set.add("sem_rc");
    } else {
      for (const r of rows) {
        const hasNum  = !!r.rc_numero;
        const hasCost = r.rc_custo != null && Number(r.rc_custo) !== 0;
        if (hasNum !== hasCost) { set.add("sem_rc"); break; }
      }
    }

    // Sem PC OU PC com metadata faltando (fornecedor/valor/categoria)
    if (!anyPc) {
      set.add("sem_pc");
    } else {
      for (const r of rows) {
        if (!hasPcRow(r)) continue;
        const hasForn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
        const hasVal  = r.valor_total != null && Number(r.valor_total) !== 0;
        const hasCat  = !!r.codigo_categoria;
        if (!(hasForn && hasVal && hasCat)) { set.add("sem_pc"); break; }
      }
    }

    // Aprovação bloqueada — algum PC rejeitado
    for (const r of rows) {
      if (!hasPcRow(r)) continue;
      const s = String(r.status ?? "");
      if (s === "NAO_APROVADO" || s === "REJEITADO_VALIDADE") { set.add("aprov_bloq"); break; }
    }

    // Aprovação pendente — algum PC em PENDENTE/PRE_SELECAO
    for (const r of rows) {
      if (!hasPcRow(r)) continue;
      const s = String(r.status ?? "");
      if (s === "PENDENTE" || s === "PRE_SELECAO") { set.add("aprov_pend"); break; }
    }

    for (const r of rows) {
      if (isDefasagemOmie(r)) { set.add("defas_omie"); break; }
    }
  }

  // Serviços — só Mix/Serviços
  if (tipoBucket === "Mix" || tipoBucket === "Serviços") {
    const anyOsRaw = rows.some((r) => !!String(r.servicos_os_numero ?? "").trim());
    const anyOsStatus = rows.some((r) => {
      const cf = (r.custom_fields as Record<string, unknown> | null) || {};
      return !!cf["ww_os_status"];
    });
    if (!anyOsRaw && !anyOsStatus) set.add("sem_vinculo");

    if (!rows.some((r) => !!String(r.nova_prev_servicos ?? "").trim())) set.add("agend_vazio");

    // Previsão vencida só conta se AINDA há serviço a executar. Serviço
    // concluído com previsão no passado não é atraso — é histórico, e alarmaria
    // para sempre, porque a data nunca deixa de estar atrás. Mesma guarda que
    // isAtrasoCompra faz com mt_data_recebimento_nf. Sem isso, os 8 PV/OS que o
    // report acusava em 29/07 eram TODOS de OS já concluída. (2026-07-30)
    for (const r of rows) {
      const s = String(r.nova_prev_servicos ?? "").trim();
      if (!s) continue;
      if (isServicoResolvido(r)) continue;
      const t = parseFlexDate(s);
      if (t != null && t < todayMs) { set.add("agend_venc"); break; }
    }
  }

  // Faturamento — precondições dependem do tipo:
  //   Mercantil → basta logística (todos os PCs recebidos)
  //   Mix       → logística + sinal do app de Serviços (ww_pode_faturar)
  //   Serviços  → só o sinal do app de Serviços
  const needsServiceRelease = tipoBucket === "Mix" || tipoBucket === "Serviços";
  const serviceReleased = !needsServiceRelease || rows.some((r) => {
    const cf = (r.custom_fields as Record<string, unknown> | null) || {};
    return cf["ww_pode_faturar"] === true;
  });
  let faturavel = false;
  if (hasPurchases) {
    if (anyPc) {
      const pcRows = rows.filter(hasPcRow);
      faturavel = pcRows.length > 0
        && pcRows.every((r) => !!r.mt_data_recebimento_nf)
        && serviceReleased;
    }
  } else {
    faturavel = serviceReleased;
  }

  if (faturavel) {
    // Tudo pronto do NOSSO lado. Se o cliente ainda não liberou, a bola não é
    // nossa: vira "Retido no cliente" em vez de "Pronto para faturar", senão a
    // linha do report sugere uma ação que não podemos tomar. Em 29/07, 4 dos 5
    // "Pronto para faturar" estavam nessa situação. (2026-07-30)
    if (set.has("aguarda_liberacao")) set.add("retido_cliente");
    else set.add("pode_faturar");
  }

  return set;
}
