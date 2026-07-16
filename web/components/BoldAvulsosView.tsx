"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";
import { STATUS_META, STATUS_ORDER, isApproved, groupsFor, formatCell, type Group, type ColumnFormat } from "@/lib/columns";
import { useUserPerms } from "./UserPermsProvider";
import { canApprove, canEdit, canViewValues, canViewMargin, type BlockKey } from "@/lib/permissions";
import EditableCell from "./EditableCell";
import EditableStatusCell from "./EditableStatusCell";
import RcExcelDropZone from "./RcExcelDropZone";
// RcProjetoUploadButton, RcProjetoItensBlock e ProjetoEtapasBlock vivem na
// sub-página /projetos/:codigo/materiais. Aqui só o Fluxo Financeiro (upload
// + download modelo) entra no header do bucket pra ficar à mão sem entrar
// na sub-página. O dot Cronograma reflete o estado agregado das etapas.
import FluxoFinanceiroUploadButton from "./FluxoFinanceiroUploadButton";
import ProjetoEscopoButton from "./ProjetoEscopoButton";
import PvOsComentarios from "./PvOsComentarios";
import AddRowButton from "./AddRowButton";
import GlobalSearch from "./GlobalSearch";

type AnyRow = Record<string, unknown>;
type StatusFilter = "todos" | "aprovados" | "nao_aprovados" | "pendentes" | "atrasados";
// "sem_nf" isola PVs sem pv_num_nfe E sem pv_dt_fat — usado pra análise das
// Entregas históricas que nunca foram faturadas de fato (2026-07-16).
type PvEtapaGroup = "todos" | "aberto" | "fechado" | "sem_nf";
type ServicosFilter = "todos" | "concluidos" | "agendados" | "sem_os";

// Etapas que contam como "Exec./Faturado" — pré-faturamento, já faturado ou cancelado
const ETAPAS_FECHADAS = new Set(["Entrega", "Faturado", "Cancelado"]);
type FacetKey = "pv_etapa_texto" | "projeto_nome" | "tipo_omie" | "pc_etapa_texto" | "codigo_categoria" | "contato_fornecedor" | "mt_status_fornecimento";
type FacetState = Partial<Record<FacetKey, Set<string>>>;

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "pv_etapa_texto",         label: "Etapa Venda" },
  { key: "projeto_nome",           label: "Projeto" },
  { key: "tipo_omie",              label: "Tipo Omie" },
  { key: "pc_etapa_texto",         label: "Etapa PC" },
  { key: "codigo_categoria",       label: "Categoria" },
  { key: "contato_fornecedor",     label: "Fornecedor" },
  { key: "mt_status_fornecimento", label: "Entrega" },
];

const STATUS_SHORT: Record<string, string> = {
  APROVADO: "Aprov.",
  APROVADO_FAT_DIRETO: "Fat. Direto",
  PRE_SELECAO: "Pré sel.",
  PENDENTE: "Pendente",
  NAO_APROVADO: "Não aprov.",
  REJEITADO_VALIDADE: "Validade",
  CANCELAR_PEDIDO: "Cancelar",
  N_A: "N/A",
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR");
// String usada quando o usuário não tem can_view_values. Segue o padrão R$
// pra não quebrar alinhamento tabular — só troca dígitos por bolinhas.
const MASKED_BRL = "R$ •••••";
// Helper: retorna fmtBRL(v) se canView, senão MASKED_BRL. Também mantém "—"
// pra valores nulos mesmo com permissão (nada a mostrar).
const gateBRL = (v: number | null | undefined, canView: boolean) =>
  canView ? fmtBRL(v) : v == null ? "—" : MASKED_BRL;

// ─────────────────────────────────────────────────────────────────────────
// Tipos do bucket agrupado
// ─────────────────────────────────────────────────────────────────────────

type GroupBy = "pvos" | "project" | "etapa" | "pc";

// Filtro de período aplicado a _dt_inclusao_d (PC criado no Omie) ou pv_emissao
// (avulsos/projetos). "off" = todos os pedidos; presets ou range custom.
type DateRangeKind = "off" | "today" | "3d" | "7d" | "30d" | "custom";
type DateRange = { kind: DateRangeKind; from?: string; to?: string };

const DATE_RANGE_LABELS: Record<DateRangeKind, string> = {
  off: "Todos os períodos",
  today: "Hoje",
  "3d": "Últimos 3 dias",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  custom: "Personalizado",
};

function computeDateWindow(range: DateRange): { from: number; to: number } | null {
  if (range.kind === "off") return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 86_400_000;
  switch (range.kind) {
    case "today": return { from: todayStart, to: tomorrowStart };
    case "3d":    return { from: todayStart - 2 * 86_400_000, to: tomorrowStart };
    case "7d":    return { from: todayStart - 6 * 86_400_000, to: tomorrowStart };
    case "30d":   return { from: todayStart - 29 * 86_400_000, to: tomorrowStart };
    case "custom": {
      const f = range.from ? Date.parse(range.from) : 0;
      const t = range.to   ? Date.parse(range.to) + 86_400_000 : Number.MAX_SAFE_INTEGER;
      return { from: isNaN(f) ? 0 : f, to: isNaN(t) ? Number.MAX_SAFE_INTEGER : t };
    }
  }
}

// Cronograma summary — resumo por projeto (só usado em modulo=projetos).
// Alimenta o dot "Cronograma" no lugar de "Prev. Serv." e o card lateral.
type CronogramaSummary = {
  total: number;
  concluidas: number;
  atrasadas: number;
  proxima_data: string | null;
  proxima_nome: string | null;
};

// Budget summary por projeto — só /projetos. Fonte: rc_projetos_budget (Fluxo
// Financeiro). Total lançado + aprovado são derivados dos rows (não dos totais
// do budget) porque essa comparação é o quanto do orçamento já virou compromisso.
type BudgetSummary = {
  budget_custos: number | null;
  valor_total_projeto: number | null;
  resultado_bruto_esperado: number | null;
  resultado_bruto_esperado_pct: number | null;
};

type Bucket = {
  groupKind: GroupBy;
  // pv_os_label guarda a chave do bucket: PV/OS label (modo "pvos") OU nome do
  // projeto (modo "project"). Mantido com este nome pra reaproveitar todo o
  // resto do código (RcExcel, AddRow, scroll por bucket, etc).
  pv_os_label: string;
  pv_os_tipo: "PV" | "OS" | null;
  cliente: string | null;
  projeto: string | null;
  pv_emissao: string | null;
  pv_data_previsao: string | null;
  pv_valor_total: number | null;
  pv_etapa_texto: string | null;
  // Modo "project": # de PV/OS distintos dentro do projeto
  pvOsCount?: number;
  // Modo "pc": número original do PC pra navegação via #bucket=PC%20<num>
  pc_numero?: string | null;
  rows: AnyRow[];
};

// Sort numérico estável: extrai dígitos do valor pra comparar como número.
// Strings sem dígitos vão pro fim. Útil pra rc_numero, pc_numero etc.
function numericSortKey(v: unknown): number {
  if (v == null) return Number.POSITIVE_INFINITY;
  const s = String(v).match(/\d+/);
  return s ? parseInt(s[0], 10) : Number.POSITIVE_INFINITY;
}

// Alinhamento padrão por tipo de coluna:
//   - Numéricos / datas / códigos mono → centralizado
//   - Texto / status / outros → esquerda
function alignClassFor(col: import("@/lib/columns").Column): string {
  const f = col.format;
  if (f === "number" || f === "money" || f === "pct" || f === "days" || f === "date" || f === "datetime" || f === "mono") {
    return "text-center";
  }
  return "text-left";
}
function isNumericFmt(col: import("@/lib/columns").Column): boolean {
  const f = col.format;
  return f === "number" || f === "money" || f === "pct" || f === "days";
}

function buildBuckets(rows: AnyRow[], groupBy: GroupBy): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    let key: string;
    if (groupBy === "project") key = String((r.projeto_nome as string) || "(Sem Projeto)");
    else if (groupBy === "etapa") key = String((r.pc_etapa_texto as string) || "(Sem Etapa)");
    else if (groupBy === "pc") {
      // 1 bucket por PC. Identidade composta empresa+ncod_ped p/ unicidade.
      // Display label: pc_numero (Omie) ou pc_numero_manual (fallback).
      const empresa = String(r.empresa ?? "");
      const ncodPed = String(r.ncod_ped ?? "");
      key = `${empresa}|${ncodPed}`;
    }
    else key = String(r.pv_os_label ?? "—");
    if (!map.has(key)) {
      map.set(key, {
        groupKind: groupBy,
        pv_os_label: key,
        pv_os_tipo: groupBy === "pvos" ? ((r.pv_os_tipo as "PV" | "OS" | null) ?? null) : null,
        cliente: (r.pv_cliente_fantasia as string) ?? (r.pv_cliente_nome as string) ?? null,
        projeto: (r.projeto_nome as string) ?? null,
        pv_emissao: (r.pv_emissao as string) ?? null,
        pv_data_previsao: (r.pv_data_previsao as string) ?? null,
        pv_valor_total: 0,
        pv_etapa_texto: (r.pv_etapa_texto as string) ?? null,
        pvOsCount: 0,
        pc_numero: groupBy === "pc"
          ? String((r.pc_numero ?? r.pc_numero_manual) ?? "")
          : null,
        rows: [],
      });
    }
    map.get(key)!.rows.push(r);
  }

  // Agrega valor + conta PV/OS distintos por bucket e ordena rows
  for (const b of map.values()) {
    if (groupBy === "project") {
      const pvSeen = new Map<string, number>(); // pv_os_label -> pv_valor_total
      for (const r of b.rows) {
        const lbl = String(r.pv_os_label ?? "—");
        if (!pvSeen.has(lbl)) pvSeen.set(lbl, Number(r.pv_valor_total ?? 0));
      }
      b.pvOsCount = pvSeen.size;
      b.pv_valor_total = [...pvSeen.values()].reduce((a, c) => a + c, 0);
      // Ordena: pv_os_label primeiro (pra runs de PV adjacentes nos merged cells), RC#, PC#
      b.rows.sort((a, c) => {
        const pvA = numericSortKey(a.pv_os_label);
        const pvB = numericSortKey(c.pv_os_label);
        if (pvA !== pvB) return pvA - pvB;
        const rcA = numericSortKey(a.rc_numero);
        const rcB = numericSortKey(c.rc_numero);
        if (rcA !== rcB) return rcA - rcB;
        const pcA = numericSortKey(a.pc_numero_manual ?? a.pc_numero);
        const pcB = numericSortKey(c.pc_numero_manual ?? c.pc_numero);
        if (pcA !== pcB) return pcA - pcB;
        return Number(a.ncod_ped ?? 0) - Number(c.ncod_ped ?? 0);
      });
    } else if (groupBy === "etapa") {
      // Etapa do PC: cada bucket = uma etapa (Cotação, Aprovação, Confirmado…).
      // pv_valor_total do bucket = soma do valor_total das linhas (cada linha = 1 PC).
      b.pv_valor_total = b.rows.reduce((acc, r) => acc + Number(r.valor_total ?? 0), 0);
      b.rows.sort((a, c) => {
        const pcA = numericSortKey(a.pc_numero);
        const pcB = numericSortKey(c.pc_numero);
        if (pcA !== pcB) return pcA - pcB;
        return Number(a.ncod_ped ?? 0) - Number(c.ncod_ped ?? 0);
      });
    } else if (groupBy === "pc") {
      // 1 bucket = 1 PC. Header puxa dados do próprio PC.
      const r = b.rows[0];
      const lbl = String(r.pc_numero ?? r.pc_numero_manual ?? "(Sem PC)");
      b.pv_os_label = lbl;
      b.pv_valor_total = Number(r.valor_total ?? 0);
      b.cliente = (r.nome_fornecedor as string) ?? (r.contato_fornecedor as string) ?? null;
      b.projeto = (r.pc_etapa_texto as string) ?? null;
      b.pv_data_previsao = (r.dt_previsao as string) ?? null;
    } else {
      b.pv_valor_total = (b.rows[0]?.pv_valor_total as number) ?? null;
      b.rows.sort((a, c) => {
        const rcA = numericSortKey(a.rc_numero);
        const rcB = numericSortKey(c.rc_numero);
        if (rcA !== rcB) return rcA - rcB;
        const pcA = numericSortKey(a.pc_numero_manual ?? a.pc_numero);
        const pcB = numericSortKey(c.pc_numero_manual ?? c.pc_numero);
        if (pcA !== pcB) return pcA - pcB;
        return Number(a.ncod_ped ?? 0) - Number(c.ncod_ped ?? 0);
      });
    }
  }

  if (groupBy === "project") {
    // Projetos: alfabético, "(Sem Projeto)" no fim
    return [...map.values()].sort((a, b) => {
      const aSem = a.pv_os_label === "(Sem Projeto)";
      const bSem = b.pv_os_label === "(Sem Projeto)";
      if (aSem !== bSem) return aSem ? 1 : -1;
      return a.pv_os_label.localeCompare(b.pv_os_label, "pt-BR");
    });
  }
  if (groupBy === "etapa") {
    // Etapas seguem ordem natural do código (10/20/30…) — extraímos prefixo numérico
    return [...map.values()].sort((a, b) => {
      const aSem = a.pv_os_label === "(Sem Etapa)";
      const bSem = b.pv_os_label === "(Sem Etapa)";
      if (aSem !== bSem) return aSem ? 1 : -1;
      const na = numericSortKey(a.pv_os_label);
      const nb = numericSortKey(b.pv_os_label);
      if (na !== nb) return na - nb;
      return a.pv_os_label.localeCompare(b.pv_os_label, "pt-BR");
    });
  }
  if (groupBy === "pc") {
    // Cada bucket = 1 PC. Ordena por número do PC ASC.
    return [...map.values()].sort((a, b) =>
      numericSortKey(a.pv_os_label) - numericSortKey(b.pv_os_label)
    );
  }
  // PV/OS: ordena por número
  return [...map.values()].sort((a, b) =>
    numericSortKey(a.pv_os_label) - numericSortKey(b.pv_os_label)
  );
}

// Verifica se row está dentro de [fromMs, toMs) considerando _dt_inclusao_d
// (data ISO) ou pv_emissao (BR DD/MM/YYYY). Qualquer um servir já basta.
function isRowInWindow(r: AnyRow, fromMs: number, toMs: number): boolean {
  const dtInc = r._dt_inclusao_d as string | null | undefined;
  if (dtInc) {
    const t = Date.parse(String(dtInc));
    if (!isNaN(t) && t >= fromMs && t < toMs) return true;
  }
  const pvE = r.pv_emissao as string | null | undefined;
  if (pvE) {
    const m = String(pvE).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
      if (!isNaN(t) && t >= fromMs && t < toMs) return true;
    }
  }
  return false;
}

// AlarmKind — filtros de "alarme" da barra inferior direita. Cada alarme é
// uma condição irregular que precisa de atenção (todos os "reportes" do daily
// Webex + oportunidades). Multi-select por união (row entra se match ≥ 1 alarme
// ativo). Todos avaliam a row atual + hoje (todayStartMs).
type AlarmKind =
  | "pvos_incompl" | "sem_projeto" | "venda" | "compra"
  | "sem_rc"
  | "sem_pc"
  | "aprov_bloq" | "aprov_pend" | "defas_omie"
  | "sem_vinculo" | "agend_vazio" | "agend_venc"
  | "pode_faturar";
const ALARM_KINDS: AlarmKind[] = [
  "pvos_incompl", "sem_projeto", "venda", "compra",
  "sem_rc",
  "sem_pc",
  "aprov_bloq", "aprov_pend", "defas_omie",
  "sem_vinculo", "agend_vazio", "agend_venc",
  "pode_faturar",
];

// Atraso (Venda): em aberto (sem NF de saída) E previsão passou.
// Atraso (Compra): em aberto (sem recebimento de NF entrada) E previsão PC passou.
// "Atraso" aqui é sempre coisa que ainda precisa de ação — não faz sentido flagar
// venda já faturada nem PC já recebido, mesmo que tenha ocorrido com atraso.
function isAtrasoVenda(r: AnyRow, todayStartMs: number): boolean {
  if (String(r.pv_dt_fat ?? "").trim() !== "") return false;
  const s = String(r.pv_data_previsao ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
  return !isNaN(t) && t < todayStartMs;
}
function isSemProjeto(r: AnyRow): boolean {
  // "Sem Projeto" — venda avulsa que não tem projeto marcado ou tem código
  // incoerente com os padrões (^40_VS venda serviços, ^41_VP venda produtos,
  // ^PJ projeto formal). Vendedor esqueceu de marcar o projeto no Omie.
  // PJ* nem aparece aqui (view roteia pra /projetos), mas checa por defesa.
  const proj = String(r.projeto_nome ?? "").trim();
  if (!proj) return true;
  return !/^(40_VS|41_VP|PJ)/.test(proj);
}
function isPvosIncompleto(r: AnyRow): boolean {
  // "PV/OS incompleta" — cadastro do PV/OS falta dado essencial. Espelha a
  // regra do dot PV/OS que fica vermelho: sem tipo, sem cliente ou sem
  // data limite (V.Previsão Limite_Omie). Evita "prende" venda no cadastro.
  const tipoOk    = !!String(r.tipo_omie ?? "").trim();
  const clienteOk = !!String(r.pv_cliente_fantasia ?? "").trim();
  const dtLimOk   = !!String(r.pv_data_previsao ?? "").trim();
  return !tipoOk || !clienteOk || !dtLimOk;
}
function isAtrasoCompra(r: AnyRow, todayStartMs: number): boolean {
  // "Previsão atrasada" — data EFETIVA da previsão vencida (nova_prev_materiais
  // se existir, senão dt_previsao original) E material ainda não recebido.
  // Unifica os antigos "compra" e "prev_mat_atr" — a Nova Prev. herda a data
  // original por padrão, então qualquer atraso na previsão dispara este único
  // alarme.
  if (r.mt_data_recebimento_nf) return false;
  const novaS = String(r.nova_prev_materiais ?? "").trim();
  const origS = String(r.dt_previsao ?? "").trim();
  const efetivaStr = novaS || origS;
  if (!efetivaStr) return false;
  const t = parseFlexDate(efetivaStr);
  return t != null && t < todayStartMs;
}
// Retorna o "bucket" humano-friendly do status de serviços do row, baseado em
// custom_fields.ww_os_status + ww_pode_faturar. Usado no card "Status Serviços"
// e no filtro correspondente. Mercantil não tem serviço → retorna null (skip).
function bucketServicosStatus(r: AnyRow): string | null {
  const tipo = String(r.tipo_omie ?? "");
  // Mercantil não tem OS/serviço envolvido → fica de fora do card.
  if (tipo === "Mercantil") return null;
  const cf = (r.custom_fields as Record<string, unknown> | null) || {};
  const osStatus = String(cf.ww_os_status ?? "");
  const podeFat  = cf.ww_pode_faturar === true;
  const osRaw    = String(r.servicos_os_numero ?? "").trim();
  if (osStatus === "Cancelada") return "Cancelada";
  if (osStatus === "Concluída") return podeFat ? "Pode Faturar" : "OS Pendente";
  if (osStatus === "Em Execução") return "Em Execução";
  if (osStatus === "Aberta") return "Aberta";
  if (osStatus === "Parcial") return "Parcial";
  // Mix/Serviços sem OS vinculado → deveria ter sido linkado no app de serviços
  return osRaw ? "Aguardando" : "Sem Vínculo";
}
function isDefasagemOmie(r: AnyRow): boolean {
  // "Defasagem Omie (Aprovado)" — PC aprovado no painel mas etapa do PC no
  // Omie NÃO está em "Aprovação" (deveria ter movido pra lá após aprovarmos).
  // Indica falha de propagação Painel→Omie.
  // Requer etapa não-vazia (evita falso-positivo em row com sync pendente).
  const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
  if (!hasPc) return false;
  const s = String(r.status ?? "");
  if (!isApproved(s)) return false;
  const etapa = String(r.pc_etapa_texto ?? "").trim();
  return etapa !== "" && etapa !== "Aprovação";
}
// Normaliza tipo_omie da view em 3 buckets canônicos: Mix / Serviço / Mercantil.
// A view mistura variantes raw ("ordem_servico", "pedido_venda") com os rótulos
// human-friendly ("Mix", "Serviços", "Mercantil"). Colapsar em 3 alinha com o
// vocabulário do usuário no Omie: pedido_venda → Mercantil, ordem_servico → Serviço.
function normalizeTipoOmie(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === "mix") return "Mix";
  if (s === "serviço" || s === "servico" || s === "serviços" || s === "servicos" || s === "ordem_servico") return "Serviço";
  if (s === "mercantil" || s === "pedido_venda") return "Mercantil";
  return "";  // valores inesperados ficam de fora
}

// Parse de data flexível: aceita ISO YYYY-MM-DD ou BR DD/MM/YYYY (as duas
// convenções que a view `v_pc_avulsos` mistura entre `nova_prev_*` e demais).
function parseFlexDate(s: string): number | null {
  // IMPORTANTE: sempre retorna meia-noite LOCAL, não UTC. Date.parse('2026-07-10')
  // interpreta ISO como UTC midnight → em fuso GMT-3 (BR) fica 21h do dia anterior,
  // e a diff com todayStartMs (setHours 0) fica ~0.9 dias a menos → floor errado.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br)  return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  return null;
}
// Agrega alarmes do BUCKET (PV/OS inteiro, N rows). Substitui a lógica row-level
// pra alarmes que dependem de estado agregado (ex: "Sem PC" só se NENHUMA row tem
// PC; "Aprov. pendente" só olha rows COM PC — RC-only não gera falso-positivo).
// Retorna o conjunto de AlarmKind ativos pro bucket.
function computeBucketAlarms(rows: AnyRow[], todayStartMs: number): Set<AlarmKind> {
  const set = new Set<AlarmKind>();
  if (rows.length === 0) return set;

  const head = rows[0]; // window functions repetem valor de PV em todas rows

  // PV faturado → NENHUM alarme dispara. Se a venda foi concluída, qualquer
  // pendência histórica (previsão vencida, material atrasado, cadastro
  // incompleto etc) deixa de importar — não há mais o que agir. Regra global
  // por pedido explícito do usuário. Redundância intencional (dt_fat OR num_nfe
  // OR etapa) pra imunizar contra sync lag do Omie.
  const pvDtFatHead  = String(head.pv_dt_fat ?? "").trim();
  const pvNumNfeHead = String(head.pv_num_nfe ?? "").trim();
  const pvEtapaHead  = String(head.pv_etapa_texto ?? "").trim();
  if (pvDtFatHead !== "" || pvNumNfeHead !== "" || pvEtapaHead === "Faturado") {
    return set;
  }

  const anyRc = rows.some((r) => !!r.rc_numero);
  const anyPc = rows.some((r) => !!r.pc_numero || !!r.pc_numero_manual);
  // Tipo Serviços puro NÃO tem compra envolvida → alarmes de RC/PC/logística
  // não fazem sentido e viram ruído. Só Mercantil e Mix precisam desses alarmes.
  const tipoBucket = String(head.tipo_omie ?? "");
  const hasPurchases = tipoBucket !== "Serviços";

  // Vendas: PV/OS incompleta (cadastro faltando) + sem projeto + atraso.
  if (isPvosIncompleto(head)) set.add("pvos_incompl");
  if (isSemProjeto(head))     set.add("sem_projeto");
  if (isAtrasoVenda(head, todayStartMs)) set.add("venda");

  if (hasPurchases) {
    // Compras — "Previsão atrasada" (unificado): PC não recebido E previsão
    // efetiva (nova_prev ou dt_previsao) passou.
    for (const r of rows) {
      if (isAtrasoCompra(r, todayStartMs)) { set.add("compra"); break; }
    }

    // Compras — Sem RC ou RC incompleto: unificado. Dispara se nenhum RC no
    // bucket OU se alguma row tem RC com apenas 1 dos 2 campos (número/custo).
    if (!anyRc) {
      set.add("sem_rc");
    } else {
      for (const r of rows) {
        const hasNum  = !!r.rc_numero;
        const hasCost = r.rc_custo != null && Number(r.rc_custo) !== 0;
        if (hasNum !== hasCost) { set.add("sem_rc"); break; }
      }
    }

    // Compras — Sem PC ou PC incompleto: unificado. Dispara se nenhum PC no
    // bucket OU se algum PC tem metadata faltando (fornecedor/valor/categoria).
    if (!anyPc) {
      set.add("sem_pc");
    } else {
      for (const r of rows) {
        const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
        if (!hasPc) continue;
        const hasForn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
        const hasVal  = r.valor_total != null && Number(r.valor_total) !== 0;
        const hasCat  = !!r.codigo_categoria;
        if (!(hasForn && hasVal && hasCat)) { set.add("sem_pc"); break; }
      }
    }

    // Aprovação bloqueada: algum PC (row COM PC) rejeitado
    for (const r of rows) {
      const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
      if (!hasPc) continue;
      const s = String(r.status ?? "");
      if (s === "NAO_APROVADO" || s === "REJEITADO_VALIDADE") { set.add("aprov_bloq"); break; }
    }

    // Aprovação pendente: algum PC (row COM PC) em PENDENTE/PRE_SELECAO.
    // RC-only sem PC costuma vir com status default PENDENTE — ignora.
    for (const r of rows) {
      const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
      if (!hasPc) continue;
      const s = String(r.status ?? "");
      if (s === "PENDENTE" || s === "PRE_SELECAO") { set.add("aprov_pend"); break; }
    }

    // Defasagem Omie: PC aprovado no painel mas etapa Omie ainda "Aprovação"
    for (const r of rows) {
      if (isDefasagemOmie(r)) { set.add("defas_omie"); break; }
    }
  }

  // Serviços: só Mix/Serviços
  const tipo = String(head.tipo_omie ?? "");
  const isServ = tipo === "Mix" || tipo === "Serviços";
  if (isServ) {
    // Sem Vínculo: bucket Mix/Serviços sem OS vinculada nem status do app
    const anyOsRaw = rows.some((r) => !!String(r.servicos_os_numero ?? "").trim());
    const anyOsStatus = rows.some((r) => {
      const cf = (r.custom_fields as Record<string, unknown> | null) || {};
      return !!cf["ww_os_status"];
    });
    if (!anyOsRaw && !anyOsStatus) set.add("sem_vinculo");
    const anyAgend = rows.some((r) => !!String(r.nova_prev_servicos ?? "").trim());
    if (!anyAgend) set.add("agend_vazio");
    // Vencido: em aberto (pv_dt_fat vazio) e alguma prev < hoje
    if (String(head.pv_dt_fat ?? "").trim() === "") {
      for (const r of rows) {
        const s = String(r.nova_prev_servicos ?? "").trim();
        if (!s) continue;
        const t = parseFlexDate(s);
        if (t != null && t < todayStartMs) { set.add("agend_venc"); break; }
      }
    }
  }

  // Faturamento: precondições dependem do tipo do PV/OS —
  //   • Mercantil → basta logística (todos PCs recebidos)
  //   • Mix → logística + sinal do app de Serviços (ww_pode_faturar)
  //   • Serviços → só o sinal do app de Serviços (sem PC/logística envolvidos)
  // E o PV não pode estar faturado ainda (pv_dt_fat vazio).
  const pvNotFaturado = String(head.pv_dt_fat ?? "").trim() === "";
  if (pvNotFaturado) {
    const needsServiceRelease = tipoBucket === "Mix" || tipoBucket === "Serviços";
    const serviceReleased = !needsServiceRelease || rows.some((r) => {
      const cf = (r.custom_fields as Record<string, unknown> | null) || {};
      return cf["ww_pode_faturar"] === true;
    });
    const needsLogistics = tipoBucket !== "Serviços";
    if (needsLogistics) {
      if (anyPc) {
        const pcRows = rows.filter((r) => !!r.pc_numero || !!r.pc_numero_manual);
        const allReceived = pcRows.length > 0 && pcRows.every((r) => !!r.mt_data_recebimento_nf);
        if (allReceived && serviceReleased) set.add("pode_faturar");
      }
    } else {
      // Serviços puro: sem materiais → faturável assim que o app libera.
      if (serviceReleased) set.add("pode_faturar");
    }
  }

  return set;
}

function matchesAlarme(r: AnyRow, kind: AlarmKind, todayStartMs: number): boolean {
  switch (kind) {
    case "pvos_incompl": return isPvosIncompleto(r);
    case "sem_projeto":  return isSemProjeto(r);
    case "venda":  return isAtrasoVenda(r, todayStartMs);
    case "compra": return isAtrasoCompra(r, todayStartMs);
    case "sem_rc": {
      // Sem RC OU RC incompleto (XOR entre número e custo)
      if (!r.rc_numero) return true;
      const hasCost = r.rc_custo != null && Number(r.rc_custo) !== 0;
      return !hasCost;
    }
    case "sem_pc": {
      // Sem PC OU PC incompleto (falta fornecedor/valor/categoria)
      if (!r.pc_numero && !r.pc_numero_manual) return true;
      const hasForn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
      const hasVal = r.valor_total != null && Number(r.valor_total) !== 0;
      const hasCat = !!r.codigo_categoria;
      return !(hasForn && hasVal && hasCat);
    }
    case "aprov_bloq": {
      const s = String(r.status ?? "");
      return s === "NAO_APROVADO" || s === "REJEITADO_VALIDADE";
    }
    case "aprov_pend": {
      const s = String(r.status ?? "");
      return s === "PENDENTE" || s === "PRE_SELECAO";
    }
    case "defas_omie": return isDefasagemOmie(r);
    case "sem_vinculo": {
      const tipo = String(r.tipo_omie ?? "");
      if (tipo !== "Mix" && tipo !== "Serviços") return false;
      const cf = (r.custom_fields as Record<string, unknown> | null) || {};
      return !String(r.servicos_os_numero ?? "").trim() && !cf["ww_os_status"];
    }
    case "agend_vazio": {
      const tipo = String(r.tipo_omie ?? "");
      if (tipo !== "Mix" && tipo !== "Serviços") return false;
      return !String(r.nova_prev_servicos ?? "").trim();
    }
    case "agend_venc": {
      const tipo = String(r.tipo_omie ?? "");
      if (tipo !== "Mix" && tipo !== "Serviços") return false;
      if (String(r.pv_dt_fat ?? "").trim() !== "") return false;
      const s = String(r.nova_prev_servicos ?? "").trim();
      const t = s ? parseFlexDate(s) : null;
      return t != null && t < todayStartMs;
    }
    case "pode_faturar":
      return !!r.mt_data_recebimento_nf && String(r.pv_dt_fat ?? "").trim() === "";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Componente raiz
// ─────────────────────────────────────────────────────────────────────────

export default function BoldAvulsosView({
  rows: initialRows,
  totalCount,
  modulo,
  title,
}: {
  rows: AnyRow[];
  totalCount: number | null;
  modulo: "avulsos" | "projetos" | "pcs";
  title: string;
}) {
  const router = useRouter();
  const user = useUserPerms();
  const userCanApprove = canApprove(user, modulo);
  const userCanEdit = canEdit(user, modulo, "rc") || canEdit(user, modulo, "pc");
  const isAdmin = user?.is_admin === true || user?.role === "admin";
  // Gates de visualização — quando false, R$ vira "R$ •••••" e M.B. some.
  const userCanViewValues = canViewValues(user, modulo);
  const userCanViewMargin = canViewMargin(user, modulo);

  // PostgREST corta resultset em 1000 rows. SSR pega só primeira página rápido;
  // cliente busca páginas extras em background pra completar (até 5000 rows).
  const [rows, setRows] = useState<AnyRow[]>(initialRows);
  const [loadingMore, setLoadingMore] = useState(false);

  // Cronograma summary por projeto — só em /projetos. Fecha "empresa|codigo"
  // → { total, concluidas, atrasadas, proxima_data, proxima_nome }.
  const [cronogramaMap, setCronogramaMap] = useState<Map<string, CronogramaSummary>>(new Map());
  // Tick incrementado por eventos externos (BroadcastChannel, focus, visibility)
  // pra forçar refetch do summary sem depender de rows/deps.
  const [cronogramaTick, setCronogramaTick] = useState(0);

  useEffect(() => {
    if (modulo !== "projetos") return;
    const keys = new Set<string>();
    for (const r of rows) {
      const emp = String(r.empresa ?? "").trim();
      const cod = Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0);
      if (emp && cod > 0) keys.add(`${emp}|${cod}`);
    }
    if (keys.size === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const qs = Array.from(keys).join(",");
        const r = await fetch(`/api/projeto-etapas/summary?keys=${encodeURIComponent(qs)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        const j = await r.json() as { rows: Array<{ key: string; total: number; concluidas: number; atrasadas: number; proxima_data: string | null; proxima_nome: string | null }> };
        const next = new Map<string, CronogramaSummary>();
        for (const row of (j.rows ?? [])) {
          next.set(row.key, { total: row.total, concluidas: row.concluidas, atrasadas: row.atrasadas, proxima_data: row.proxima_data, proxima_nome: row.proxima_nome });
        }
        setCronogramaMap(next);
      } catch { /* aborted / offline */ }
    })();
    return () => ctrl.abort();
  }, [modulo, rows, cronogramaTick]);

  // Invalidação: quando a sub-página de materiais grava etapas/fluxo, um
  // BroadcastChannel avisa. Também refetcha ao voltar pra aba (visibility)
  // — cobre casos onde BroadcastChannel não estava aberto no momento.
  useEffect(() => {
    if (modulo !== "projetos") return;
    const bump = () => { setCronogramaTick((n) => n + 1); setBudgetTick((n) => n + 1); };
    const onVis = () => { if (document.visibilityState === "visible") bump(); };
    let chCron: BroadcastChannel | null = null;
    let chBud: BroadcastChannel | null = null;
    try { chCron = new BroadcastChannel("cronograma-updated"); chCron.addEventListener("message", bump); } catch { /* unsupported */ }
    try { chBud = new BroadcastChannel("budget-updated"); chBud.addEventListener("message", bump); } catch { /* unsupported */ }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", bump);
    return () => {
      try { chCron?.removeEventListener("message", bump); chCron?.close(); } catch { /* ignore */ }
      try { chBud?.removeEventListener("message", bump); chBud?.close(); } catch { /* ignore */ }
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", bump);
    };
  }, [modulo]);

  // Budget summary — mesmo padrão do cronograma. Chave "empresa|codigo".
  const [budgetMap, setBudgetMap] = useState<Map<string, BudgetSummary>>(new Map());
  const [budgetTick, setBudgetTick] = useState(0);
  useEffect(() => {
    if (modulo !== "projetos") return;
    const keys = new Set<string>();
    for (const r of rows) {
      const emp = String(r.empresa ?? "").trim();
      const cod = Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0);
      if (emp && cod > 0) keys.add(`${emp}|${cod}`);
    }
    if (keys.size === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const qs = Array.from(keys).join(",");
        const r = await fetch(`/api/rc-projetos/budget/summary?keys=${encodeURIComponent(qs)}`, { signal: ctrl.signal });
        if (!r.ok) return;
        const j = await r.json() as { rows: Array<{ key: string; budget_custos: number | null; valor_total_projeto: number | null; resultado_bruto_esperado: number | null; resultado_bruto_esperado_pct: number | null }> };
        const next = new Map<string, BudgetSummary>();
        for (const row of (j.rows ?? [])) {
          next.set(row.key, {
            budget_custos: row.budget_custos,
            valor_total_projeto: row.valor_total_projeto,
            resultado_bruto_esperado: row.resultado_bruto_esperado,
            resultado_bruto_esperado_pct: row.resultado_bruto_esperado_pct,
          });
        }
        setBudgetMap(next);
      } catch { /* aborted */ }
    })();
    return () => ctrl.abort();
  }, [modulo, rows, budgetTick]);
  useEffect(() => {
    // Se já recebemos < 1000 rows, não há mais nada
    if (initialRows.length < 1000) return;
    if (totalCount != null && initialRows.length >= totalCount) return;
    const view = modulo === "pcs" ? "v_pc_pcs" : modulo === "projetos" ? "v_pc_projetos" : "v_pc_avulsos";
    const ctrl = new AbortController();
    setLoadingMore(true);
    (async () => {
      try {
        // Paraleliza as 4 páginas (1000-1999, 2000-2999, 3000-3999, 4000-4999).
        // Se totalCount conhecido, corta pra evitar requests vazios. Ordem é
        // preservada ao mergear pra manter sort estável.
        const pages: [number, number][] = [];
        for (let from = 1000; from < 5000; from += 1000) {
          if (totalCount != null && from >= totalCount) break;
          pages.push([from, from + 999]);
        }
        const results = await Promise.allSettled(pages.map(([from, to]) =>
          fetch(`/api/rows?view=${view}&from=${from}&to=${to}`, { signal: ctrl.signal })
            .then((r) => r.ok ? r.json() : { rows: [] })
            .then((j) => (j.rows ?? []) as AnyRow[])
        ));
        const extra: AnyRow[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") extra.push(...r.value);
        }
        if (extra.length) setRows((prev) => [...prev, ...extra]);
      } catch { /* aborted ou network — ignora */ }
      finally { setLoadingMore(false); }
    })();
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo]);

  // Realtime: escuta mudanças em approval.approvals (WW app grava aqui:
  // ww_os_status, ww_pode_faturar, s242fb18ba/nova_prev_servicos, etc). Agrega
  // labels afetados numa janela de 800ms e refetcha só os buckets tocados
  // via /api/rows?label=X — evita router.refresh() que perderia extras >1000.
  useEffect(() => {
    const supa = supaBrowser();
    const view = modulo === "pcs" ? "v_pc_pcs" : modulo === "projetos" ? "v_pc_projetos" : "v_pc_avulsos";
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
      timer = null;
      const labels = Array.from(pending);
      pending.clear();
      if (labels.length === 0) return;
      try {
        const results = await Promise.all(labels.map(async (label) => {
          const r = await fetch(`/api/rows?view=${view}&label=${encodeURIComponent(label)}`);
          if (!r.ok) return { label, rows: [] as AnyRow[] };
          const j = await r.json();
          return { label, rows: (j.rows ?? []) as AnyRow[] };
        }));
        const affected = new Set<string>();
        const fresh: AnyRow[] = [];
        for (const { label, rows: got } of results) {
          affected.add(label);
          fresh.push(...got);
        }
        setRows((prev) => {
          const kept = prev.filter((r) => !affected.has(String(r.pv_os_label ?? "")));
          return [...kept, ...fresh];
        });
      } catch { /* offline / abortado — próxima mudança tentará de novo */ }
    };

    const channel = supa
      .channel(`avulsos-approvals-${modulo}`)
      .on("postgres_changes",
          { event: "*", schema: "approval", table: "approvals", filter: `modulo=eq.${modulo}` },
          (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            const label = (payload.new?.pv_os_label ?? payload.old?.pv_os_label) as string | undefined;
            if (!label) return;
            pending.add(label);
            if (timer) clearTimeout(timer);
            timer = setTimeout(flush, 800);
          })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supa.removeChannel(channel);
    };
  }, [modulo]);

  // Bootstrap a partir da URL — permite deep-link tipo:
  //   /avulsos?q=PV1732                         → seed do search box
  //   /avulsos?alarme=venda,compra              → seleciona alarmes iniciais
  //   /avulsos?pv=aberto|fechado|todos          → sobrescreve default aberto
  // Só roda no cliente (window). Se param ausente/inválido, cai no default.
  const [query, setQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  // Sync query → URL. replaceState (não pushState) pra não poluir back button
  // a cada tecla. Quando query vazia, remove o param.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const cur = url.searchParams.get("q") ?? "";
    if (cur === query) return;
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  // PV Status default depende do módulo:
  //   • /avulsos  → "aberto": operador quer ver vendas em andamento (não fatur).
  //   • /projetos → "todos":  projeto agrega VÁRIOS PVs. Se filtrar aberto,
  //     buckets ficam incompletos — 30 PCs de um PV faturado somem enquanto
  //     ainda são relevantes pro projeto (custo real, materiais recebidos etc).
  //   • /pcs      → "aberto": mesma lógica de /avulsos.
  const defaultPvEtapa: PvEtapaGroup = modulo === "projetos" ? "todos" : "aberto";
  const [pvEtapaGroup, setPvEtapaGroup] = useState<PvEtapaGroup>(() => {
    if (typeof window === "undefined") return defaultPvEtapa;
    const raw = new URLSearchParams(window.location.search).get("pv");
    return raw === "todos" || raw === "fechado" || raw === "aberto" ? raw : defaultPvEtapa;
  });
  const [servicosFilter, setServicosFilter] = useState<ServicosFilter>("todos");
  // Filtro "Status Serviços" (do WW): multi-select por valor humano-friendly
  // ("Pode Faturar", "OS Pendente", "Em Execução", "Aberta", "Parcial",
  // "Cancelada", "Sem OS"). Deriva de custom_fields.ww_os_status + ww_pode_faturar.
  const [servicosStatusFilter, setServicosStatusFilter] = useState<Set<string>>(new Set());
  const [kpisOpen, setKpisOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ kind: "off" });
  // Alarmes: multi-select (union). Cada AlarmKind é uma condição irregular.
  const [alarmes, setAlarmes] = useState<Set<AlarmKind>>(() => {
    if (typeof window === "undefined") return new Set();
    const raw = new URLSearchParams(window.location.search).get("alarme");
    if (!raw) return new Set();
    const valid = new Set<AlarmKind>(ALARM_KINDS);
    const out = new Set<AlarmKind>();
    for (const p of raw.split(",")) {
      const t = p.trim() as AlarmKind;
      if (valid.has(t)) out.add(t);
    }
    return out;
  });
  const toggleAlarme = useCallback((k: AlarmKind) => {
    setAlarmes((prev) => {
      const s = new Set(prev);
      s.has(k) ? s.delete(k) : s.add(k);
      return s;
    });
  }, []);
  const clearAlarmes = useCallback(() => setAlarmes(new Set()), []);
  const [facets, setFacets] = useState<FacetState>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openBuckets, setOpenBuckets] = useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = useState<(AnyRow & { _bucket?: Bucket }) | null>(null);
  const [statusPopover, setStatusPopover] = useState<{ rowKey: string; row: AnyRow; anchor: DOMRect } | null>(null);
  // Optimistic status updates: muda na UI imediato, antes do server confirmar
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({});

  // Limpa o override quando o data novo (após router.refresh()) já reflete o status novo
  useEffect(() => {
    setOptimisticStatus((prev) => {
      const next: Record<string, string> = {};
      for (const r of rows) {
        const key = `${r.empresa}|${r.ncod_ped}`;
        const optimistic = prev[key];
        if (optimistic && String(r.status ?? "PENDENTE") !== optimistic) {
          // server ainda não atualizou esse → mantém o override
          next[key] = optimistic;
        }
      }
      return next;
    });
  }, [rows]);

  function applyOptimisticStatus(empresa: string, ncod_ped: number, status: string) {
    setOptimisticStatus((prev) => ({ ...prev, [`${empresa}|${ncod_ped}`]: status }));
  }
  function clearOptimisticStatus(empresa: string, ncod_ped: number) {
    setOptimisticStatus((prev) => {
      const k = `${empresa}|${ncod_ped}`;
      if (!(k in prev)) return prev;
      const next = { ...prev }; delete next[k]; return next;
    });
  }

  // Grupos de colunas: TODOS sempre visíveis. Click na bolinha do pipeline
  // faz scroll horizontal pro bloco escolhido (componente BucketCard cuida).
  const allGroups = useMemo(() => groupsFor(modulo), [modulo]);

  // Status efetivo:
  // - Row com PC → status real do row
  // - Row sem PC (RC orphan dentro do bucket): se TODOS os PCs do bucket
  //   estão aprovados → herda APROVADO. Senão → "AGUARDANDO_PC" (não conta
  //   em pendentes/aprovados/não-aprov).
  // Map keya por pv_os_label.
  const bucketAllApprovedMap = useMemo(() => {
    const byPv = new Map<string, AnyRow[]>();
    for (const r of rows) {
      const lbl = String(r.pv_os_label ?? "—");
      if (!byPv.has(lbl)) byPv.set(lbl, []);
      byPv.get(lbl)!.push(r);
    }
    const result = new Map<string, boolean>();
    for (const [lbl, group] of byPv) {
      const pcRows = group.filter((r) => r.pc_numero || r.pc_numero_manual);
      const allApproved = pcRows.length > 0 && pcRows.every((r) => isApproved(String(r.status ?? "")));
      result.set(lbl, allApproved);
    }
    return result;
  }, [rows]);

  function effectiveStatus(r: AnyRow): string {
    const hasPc = !!(r.pc_numero || r.pc_numero_manual);
    const realStatus = String(r.status ?? "PENDENTE");
    if (hasPc) return realStatus;
    // RC sem PC: herda se bucket todo aprovado
    const lbl = String(r.pv_os_label ?? "—");
    if (bucketAllApprovedMap.get(lbl)) return "APROVADO";
    return "AGUARDANDO_PC";  // estado neutro — não vai pra nenhum card
  }

  function toggleBucket(label: string) {
    setOpenBuckets((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }
  function expandBucketAndScroll(label: string) {
    // Garante que o bucket está aberto antes do scroll horizontal acontecer
    setOpenBuckets((prev) => new Set([...prev, label]));
  }

  // Auto-expand bucket via hash da URL (#bucket=PV1705) — usado pela busca global.
  // ABORDAGEM DEFINITIVA: se o bucket alvo não está nos rows atuais, busca DIRETO
  // só ele via /api/rows?label=X (~200ms, vai pelo índice). Insere imediatamente
  // nos rows → bucket aparece sem esperar o client-fetch de background.
  useEffect(() => {
    if (typeof window === "undefined") return;

    async function applyHash() {
      const m = window.location.hash.match(/#bucket=([^&]+)/);
      if (!m) return;
      const label = decodeURIComponent(m[1]);
      setOpenBuckets((prev) => new Set([...prev, label]));

      // Já existe nos rows atuais? Pula direto pro scroll
      const existsLocal = rows.some((r) => String(r.pv_os_label ?? "") === label);
      if (!existsLocal) {
        // Targeted fetch: trazer SÓ esse bucket. Filtro por pv_os_label OU
        // por pc_numero se label começar com "PC " (PC standalone)
        const view = modulo === "pcs" ? "v_pc_pcs" : modulo === "projetos" ? "v_pc_projetos" : "v_pc_avulsos";
        const isPcLabel = label.startsWith("PC ");
        const param = isPcLabel
          ? `pc=${encodeURIComponent(label.slice(3).trim())}`
          : `label=${encodeURIComponent(label)}`;
        try {
          const r = await fetch(`/api/rows?view=${view}&${param}`);
          if (r.ok) {
            const j = await r.json();
            const newRows = (j.rows ?? []) as AnyRow[];
            if (newRows.length) setRows((prev) => [...prev, ...newRows]);
          }
        } catch { /* ignora — fallback é o client-fetch de background */ }
      }

      // Tenta scroll. Em /pcs o data-bucket é chave composta empresa|ncod_ped,
      // não "PC <num>". Por isso, quando label começa com "PC ", usamos o
      // atributo auxiliar data-pc pra achar.
      let tries = 0;
      const isPc = label.startsWith("PC ");
      const pcNum = isPc ? label.slice(3).trim() : "";
      function tryScroll() {
        let el: Element | null = null;
        if (isPc) {
          el = document.querySelector(`[data-pc="${CSS.escape(pcNum)}"]`);
        }
        if (!el) {
          el = document.querySelector(`[data-bucket="${CSS.escape(label)}"]`);
        }
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          // Pra /pcs precisamos abrir pelo bucket key real (composto), que é
          // o data-bucket attr do mesmo elemento
          const bucketKey = (el as HTMLElement).getAttribute("data-bucket") ?? label;
          setOpenBuckets((prev) => new Set([...prev, bucketKey]));
          return;
        }
        if (tries++ < 30) setTimeout(tryScroll, 200);  // até 6s
      }
      requestAnimationFrame(tryScroll);
    }

    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // Filtragem
  const dateWindow = useMemo(() => computeDateWindow(dateRange), [dateRange]);
  const todayStartMs = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }, []);
  // alarmsByBucket: agrupa rows por pv_os_label e calcula alarmes do PV inteiro.
  // Usado tanto no filtro (passesFilters) quanto nos contadores do popup — assim
  // "Sem PC" filtra PVs que REALMENTE não têm PC, não rows individuais RC-only.
  const alarmsByBucket = useMemo(() => {
    const groups = new Map<string, AnyRow[]>();
    for (const r of rows) {
      const k = String(r.pv_os_label ?? "");
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(r); else groups.set(k, [r]);
    }
    const out = new Map<string, Set<AlarmKind>>();
    for (const [k, rs] of groups) out.set(k, computeBucketAlarms(rs, todayStartMs));
    return out;
  }, [rows, todayStartMs]);

  // Predicado central de filtros — aceita opções pra pular filtros específicos.
  // skipFacet: usado por facetValues (dropdown mostra opções sem se auto-filtrar).
  // skipAtraso: usado pelas contagens dos botões Atraso pra refletir "quantos PV/OS
  // seriam mostrados se eu ativar esse filtro AGORA, considerando os demais filtros".
  const passesFilters = useCallback((r: AnyRow, opts: { skipFacet?: FacetKey; skipAlarmes?: boolean; skipServicos?: boolean; skipServicosStatus?: boolean; skipPvEtapa?: boolean; skipStatus?: boolean } = {}) => {
    const q = query.trim().toLowerCase();
    if (dateWindow && !isRowInWindow(r, dateWindow.from, dateWindow.to)) return false;
    if (!opts.skipAlarmes && alarmes.size > 0) {
      // "Alarmes Ativos" — só se aplicam a PV/OS em ABERTO. PV faturado/cancelado
      // não pode ter alarme ativo, mesmo que houvesse um problema histórico.
      const etapa = String(r.pv_etapa_texto ?? "");
      if (ETAPAS_FECHADAS.has(etapa)) return false;
      // Semântica: OR dentro do grupo, AND entre grupos. Ex: seleciona todo o
      // grupo Compras + "Aprov. pend." (grupo Aprovações) → mostra PVs que têm
      // (qualquer alarme de Compras) E (Aprov. pend.). Assim "grupo inteiro"
      // vira "qualquer problema desse grupo", não "todos os problemas do grupo".
      const bucketSet = alarmsByBucket.get(String(r.pv_os_label ?? ""));
      if (!bucketSet) return false;
      for (const g of ALARM_GROUPS) {
        const sel = g.kinds.filter((k) => alarmes.has(k));
        if (sel.length === 0) continue;
        const anyInGroup = sel.some((k) => bucketSet.has(k));
        if (!anyInGroup) return false;
      }
    }
    if (modulo !== "pcs" && !opts.skipPvEtapa) {
      const etapa = String(r.pv_etapa_texto ?? "");
      if (pvEtapaGroup === "aberto" && ETAPAS_FECHADAS.has(etapa)) return false;
      if (pvEtapaGroup === "fechado" && !ETAPAS_FECHADAS.has(etapa)) return false;
      if (pvEtapaGroup === "sem_nf") {
        const hasFat = String(r.pv_dt_fat ?? "").trim() !== ""
                    || String(r.pv_num_nfe ?? "").trim() !== "";
        if (hasFat) return false;
      }
    }
    if (!opts.skipStatus) {
      const s = effectiveStatus(r);
      if (statusFilter === "aprovados" && !isApproved(s)) return false;
      if (statusFilter === "nao_aprovados" && (isApproved(s) || s === "PENDENTE")) return false;
      if (statusFilter === "pendentes" && s !== "PENDENTE") return false;
      if (statusFilter === "atrasados") {
        const d = r.aprovar_ate_calc as string | null;
        if (!d || isApproved(s)) return false;
        const dt = new Date(d);
        if (Number.isNaN(dt.getTime()) || dt >= new Date()) return false;
      }
    }
    if (modulo === "avulsos" && !opts.skipServicos) {
      const temOs = !!String(r.servicos_os_numero ?? "").trim();
      const concluido = !!r.servicos_concluidos;
      if (servicosFilter === "concluidos" && !concluido) return false;
      if (servicosFilter === "agendados" && !(temOs && !concluido)) return false;
      if (servicosFilter === "sem_os" && temOs) return false;
    }
    // Filtro por Status Serviços (ww_os_status + ww_pode_faturar). Multi-select
    // por bucket humano-friendly.
    if (modulo === "avulsos" && !opts.skipServicosStatus && servicosStatusFilter.size > 0) {
      const b = bucketServicosStatus(r);
      // Mercantil (b=null) nunca aparece nesse card → nunca casa filtro daqui
      if (b == null || !servicosStatusFilter.has(b)) return false;
    }
    for (const [key, set] of Object.entries(facets)) {
      if (opts.skipFacet === key) continue;  // ignora o próprio facet ao calcular suas opções
      if (!set || set.size === 0) continue;
      const rawVal = r[key as FacetKey];
      const isEmpty = rawVal == null || rawVal === "";
      // tipo_omie compara valor normalizado (3 buckets: Mix / Serviço / Mercantil).
      // mt_status_fornecimento vazio mapeia pro bucket "Aguardando fornecedor"
      // MAS só pra rows que já têm PC — sem PC não há "status do fornecedor".
      let val: string;
      if (key === "tipo_omie") val = normalizeTipoOmie(rawVal);
      else if (key === "mt_status_fornecimento" && isEmpty) {
        const hasPc = !!(r.pc_numero || r.pc_numero_manual);
        if (!hasPc) return false;
        val = "Aguardando fornecedor";
      }
      else val = String(rawVal ?? "");
      if (!set.has(val)) return false;
    }
    if (!q) return true;
    const hay = [r.pc_numero, r.pv_os_label, r.projeto_nome, r.pv_cliente_fantasia, r.contato_fornecedor, r.rc_numero, r.rc_descricao]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }, [query, dateWindow, alarmes, alarmsByBucket, modulo, pvEtapaGroup, statusFilter, servicosFilter, servicosStatusFilter, facets, effectiveStatus]);

  const filtered = useMemo(() => rows.filter((r) => passesFilters(r)), [rows, passesFilters]);

  // Contagens dos 7 alarmes: PV/OS únicos que atendem cada condição, respeitando
  // os demais filtros ativos EXCETO os próprios alarmes (skipAlarmes=true). Isso
  // dá a semântica "se eu clicar esse alarme AGORA, quantos PV/OS vão aparecer".
  const filteredExceptAlarmes = useMemo(
    () => rows.filter((r) => passesFilters(r, { skipAlarmes: true })),
    [rows, passesFilters]
  );
  const alarmeCounts = useMemo(() => {
    // Bucket-level: 1 PV/OS conta 1 vez por alarme. Valor = pv_valor_total do PV
    // (dedupado). Antes contava row-level e superestimava PVs com N linhas.
    // "Alarmes Ativos" — só conta PV/OS em ABERTO (ignora faturado/cancelado).
    const acc = {} as Record<AlarmKind, { count: number; val: number }>;
    const seen = {} as Record<AlarmKind, Set<string>>;
    for (const k of ALARM_KINDS) { acc[k] = { count: 0, val: 0 }; seen[k] = new Set(); }
    for (const r of filteredExceptAlarmes) {
      const pvos = String(r.pv_os_label ?? "");
      if (!pvos) continue;
      const etapa = String(r.pv_etapa_texto ?? "");
      if (ETAPAS_FECHADAS.has(etapa)) continue; // fecha → sem alarme ativo
      const bucketSet = alarmsByBucket.get(pvos);
      if (!bucketSet) continue;
      for (const k of bucketSet) {
        if (seen[k].has(pvos)) continue;
        seen[k].add(pvos);
        acc[k].count += 1;
        acc[k].val += Number(r.pv_valor_total) || 0;
      }
    }
    return acc;
  }, [filteredExceptAlarmes, alarmsByBucket]);

  // Contagens de Serviços: PV/OS únicos por categoria, respeitando os demais
  // filtros ativos (exceto o próprio filtro de serviços). Só faz sentido em /avulsos.
  const filteredExceptServicos = useMemo(
    () => rows.filter((r) => passesFilters(r, { skipServicos: true })),
    [rows, passesFilters]
  );
  const servicosCounts = useMemo(() => {
    const todos       = new Set<string>();
    const concluidos  = new Set<string>();
    const agendados   = new Set<string>();
    const semOs       = new Set<string>();
    // Valores acumulam pv_valor_total UMA vez por PV/OS único em cada bucket.
    let todosVal = 0, concluidosVal = 0, agendadosVal = 0, semOsVal = 0;
    for (const r of filteredExceptServicos) {
      const k = String(r.pv_os_label ?? "");
      if (!k) continue;
      const val = Number(r.pv_valor_total) || 0;
      const temOs = !!String(r.servicos_os_numero ?? "").trim();
      const concluido = !!r.servicos_concluidos;
      if (!todos.has(k)) { todos.add(k); todosVal += val; }
      if (concluido) {
        if (!concluidos.has(k)) { concluidos.add(k); concluidosVal += val; }
      } else if (temOs) {
        if (!agendados.has(k)) { agendados.add(k); agendadosVal += val; }
      } else {
        if (!semOs.has(k)) { semOs.add(k); semOsVal += val; }
      }
    }
    return {
      todos: todos.size,           todosVal,
      concluidos: concluidos.size, concluidosVal,
      agendados: agendados.size,   agendadosVal,
      sem_os: semOs.size,          semOsVal,
    };
  }, [filteredExceptServicos]);

  // Grand total da seleção atual (todos os rows filtrados).
  // Estratégia coerente com BucketTotals: soma RC/PC/PV únicos por PV/OS.
  const grandTotal = useMemo(() => {
    let rc = 0, pc = 0, pv = 0;
    if (modulo === "pcs") {
      // PCs Standalone: 1 row = 1 PC. Sem RC nem PV próprios.
      for (const r of filtered) pc += Number(r.valor_total ?? 0);
    } else {
      const seen = new Set<string>();
      for (const r of filtered) {
        const k = String(r.pv_os_label ?? "—");
        if (seen.has(k)) continue;
        seen.add(k);
        rc += Number(r.rc_custo_total_calc ?? 0);
        pc += Number(r.pc_custo_total_calc ?? 0);
        pv += Number(r.pv_valor_total ?? 0);
      }
    }
    return { rc, pc, pv };
  }, [filtered, modulo]);

  // Contagem de PV/OS únicos + valor R$ por grupo de etapa. Antes contava rows
  // (1 PV × N PCs virava N no counter); agora dedupe por pv_os_label e soma
  // pv_valor_total UMA vez por PV/OS pra bater com a leitura de valor de venda.
  const pvEtapaCounts = useMemo(() => {
    const seenAberto = new Set<string>();
    const seenFechado = new Set<string>();
    const seenAll = new Set<string>();
    let abertoVal = 0, fechadoVal = 0, todosVal = 0;
    for (const r of rows) {
      const k = String(r.pv_os_label ?? "");
      if (!k) continue;
      const etapa = String(r.pv_etapa_texto ?? "");
      const val = Number(r.pv_valor_total) || 0;
      if (!seenAll.has(k)) { seenAll.add(k); todosVal += val; }
      if (ETAPAS_FECHADAS.has(etapa)) {
        if (!seenFechado.has(k)) { seenFechado.add(k); fechadoVal += val; }
      } else {
        if (!seenAberto.has(k)) { seenAberto.add(k); abertoVal += val; }
      }
    }
    return {
      todos: seenAll.size, aberto: seenAberto.size, fechado: seenFechado.size,
      todosVal, abertoVal, fechadoVal,
    };
  }, [rows]);


  // Valores únicos por facet — calcula PRA CADA facet ignorando o filtro do
  // próprio facet, pra que selecionar "Entrega" não some as opções "Faturado"
  // etc do mesmo dropdown (multi-select continua viável depois do 1º click).
  const facetValues = useMemo(() => {
    const acc: Record<FacetKey, Map<string, number>> = {
      pv_etapa_texto: new Map(),
      projeto_nome: new Map(), tipo_omie: new Map(), pc_etapa_texto: new Map(),
      codigo_categoria: new Map(), contato_fornecedor: new Map(),
      mt_status_fornecimento: new Map(),
    };
    for (const { key } of FACETS) {
      for (const r of rows) {
        if (!passesFilters(r, { skipFacet: key })) continue;
        const v = r[key];
        if (v == null || v === "") continue;
        acc[key].set(String(v), (acc[key].get(String(v)) ?? 0) + 1);
      }
    }
    return acc;
  }, [rows, passesFilters]);

  // Distribuições visuais por facet — cada bucket vira {count PV/OS únicos, val R$}.
  // Facets do lado VENDA (pv_etapa_texto/projeto_nome/tipo_omie) usam pv_valor_total
  // dedupado por PV/OS. Facets do lado COMPRA (pc_etapa_texto/codigo_categoria/
  // contato_fornecedor) usam valor_total do PC (1 row = 1 PC). Cada facet aplica
  // os demais filtros (skipFacet=próprio), preservando semântica multi-select.
  type FacetBucket = { value: string; count: number; val: number };
  const facetDistributions = useMemo(() => {
    // Facets do lado VENDA (dedupe por PV/OS único, valor = pv_valor_total)
    const PV_SIDE: FacetKey[] = ["pv_etapa_texto", "projeto_nome", "tipo_omie"];
    // mt_status_fornecimento é COMPRA (1 row = 1 PC): contagem = PCs por estado,
    // valor = valor_total do PC. Se agregasse por PV/OS, 1 PV com 1 PC "Recebido"
    // + 1 PC pendente contaria pv_valor_total INTEIRO em AMBOS os buckets, inflando
    // "Aguardando" com dinheiro já entregue.
    const acc: Record<FacetKey, FacetBucket[]> = {
      pv_etapa_texto: [], projeto_nome: [], tipo_omie: [],
      pc_etapa_texto: [], codigo_categoria: [], contato_fornecedor: [],
      mt_status_fornecimento: [],
    };
    for (const { key } of FACETS) {
      const isPvSide = PV_SIDE.includes(key);
      type Agg = { count: number; val: number; seenPvos: Set<string> };
      const map = new Map<string, Agg>();
      for (const r of rows) {
        if (!passesFilters(r, { skipFacet: key })) continue;
        // Lado COMPRA (pc_etapa_texto, codigo_categoria, contato_fornecedor,
        // mt_status_fornecimento): só rows com PC de verdade — os totais precisam
        // bater com Aprovação PC, que também exclui rows sem PC.
        if (!isPvSide) {
          const hasPc = !!(r.pc_numero || r.pc_numero_manual);
          if (!hasPc) continue;
        }
        const v = r[key];
        const isEmpty = v == null || v === "";
        // mt_status_fornecimento: null/vazio vira bucket "Aguardando fornecedor"
        // pra deixar claro que o PC existe mas o fornecedor ainda não emitiu NF/
        // enviou material.
        if (isEmpty && key !== "mt_status_fornecimento") continue;
        // tipo_omie usa 3 buckets normalizados (Mix / Serviço / Mercantil)
        const label = key === "tipo_omie"
          ? normalizeTipoOmie(v)
          : isEmpty ? "Aguardando fornecedor" : String(v);
        if (!label) continue;
        let bucket = map.get(label);
        if (!bucket) { bucket = { count: 0, val: 0, seenPvos: new Set() }; map.set(label, bucket); }
        if (isPvSide) {
          // dedupe por PV/OS (1 PV vive em N linhas)
          const k = String(r.pv_os_label ?? "");
          if (k && !bucket.seenPvos.has(k)) {
            bucket.seenPvos.add(k);
            bucket.count += 1;
            bucket.val += Number(r.pv_valor_total) || 0;
          }
        } else {
          // lado COMPRA: 1 row = 1 PC
          bucket.count += 1;
          bucket.val += Number(r.valor_total) || 0;
        }
      }
      acc[key] = [...map.entries()]
        .map(([value, b]) => ({ value, count: b.count, val: b.val }))
        .sort((a, b) => b.val - a.val || b.count - a.count);
    }
    return acc;
  }, [rows, passesFilters]);

  function toggleFacet(key: FacetKey, value: string) {
    setFacets((prev) => {
      const cur = new Set(prev[key] ?? []);
      cur.has(value) ? cur.delete(value) : cur.add(value);
      return { ...prev, [key]: cur };
    });
  }
  function clearFacet(key: FacetKey) {
    setFacets((prev) => ({ ...prev, [key]: new Set() }));
  }

  const groupBy: GroupBy =
    modulo === "projetos" ? "project" :
    modulo === "pcs"      ? "pc"      : "pvos";
  const buckets = useMemo(() => buildBuckets(filtered, groupBy), [filtered, groupBy]);

  // Rows base = rows após aplicar Date Range + Alarmes (que afetam TUDO incluindo
  // os contadores dos cards de PV-Status / PC-Aprovação acima). É a primeira
  // camada de filtragem visível pro usuário.
  const rowsAfterDateAtraso = useMemo(() => {
    return rows.filter((r) => {
      if (dateWindow && !isRowInWindow(r, dateWindow.from, dateWindow.to)) return false;
      if (alarmes.size > 0) {
        // OR-dentro-do-grupo, AND-entre-grupos (mesma regra do passesFilters).
        const bucketSet = alarmsByBucket.get(String(r.pv_os_label ?? ""));
        if (!bucketSet) return false;
        for (const g of ALARM_GROUPS) {
          const sel = g.kinds.filter((k) => alarmes.has(k));
          if (sel.length === 0) continue;
          const anyInGroup = sel.some((k) => bucketSet.has(k));
          if (!anyInGroup) return false;
        }
      }
      return true;
    });
  }, [rows, dateWindow, alarmes, alarmsByBucket]);

  // Rows após aplicar (Date+Alarmes+pvEtapaGroup), sem statusFilter/facets/query.
  // Usado pra calcular contagens dos KPIs de status com o filtro primário ativo.
  const rowsAfterPvEtapa = useMemo(() => {
    if (pvEtapaGroup === "todos") return rowsAfterDateAtraso;
    return rowsAfterDateAtraso.filter((r) => {
      if (pvEtapaGroup === "sem_nf") {
        return String(r.pv_dt_fat ?? "").trim() === ""
            && String(r.pv_num_nfe ?? "").trim() === "";
      }
      const etapa = String(r.pv_etapa_texto ?? "");
      return pvEtapaGroup === "aberto" ? !ETAPAS_FECHADAS.has(etapa) : ETAPAS_FECHADAS.has(etapa);
    });
  }, [rowsAfterDateAtraso, pvEtapaGroup]);

  // KPIs agregados (refletem o filtro primário PV - Status)
  const kpis = useMemo(() => {
    const items = rowsAfterPvEtapa;
    const total = items.length;
    const pvUnicos = new Set(items.map((r) => String(r.pv_os_label ?? "—"))).size;
    let totalValor = 0, aprovValor = 0, aprovados = 0, semFornecedor = 0;
    for (const r of items) {
      totalValor += Number(r.valor_total) || 0;
      const s = String(r.status ?? "PENDENTE");
      if (isApproved(s)) {
        aprovados++;
        aprovValor += Number(r.valor_aprovado) || Number(r.valor_total) || 0;
      }
      if (!r.codigo_fornecedor || r.codigo_fornecedor === 0) semFornecedor++;
    }
    const ticketMedio = pvUnicos > 0 ? totalValor / pvUnicos : 0;
    const conversao = total > 0 ? (aprovados / total) * 100 : 0;
    return { total, pvUnicos, totalValor, ticketMedio, aprovValor, aprovados, conversao, semFornecedor };
  }, [rowsAfterPvEtapa]);

  // Sumário — conta LINHAS e PV/OS (ou PCs em /pcs) por categoria, respeitando
  // filtro primário. Em /pcs cada row = 1 PC, então usamos empresa|ncod_ped
  // como chave de unicidade pra "1 PC == 1 unidade no contador" — em vez do
  // pv_os_label (que é nulo/repetido pra PCs Standalone).
  const summary = useMemo(() => {
    let aprov = 0, pend = 0, naoAprov = 0, atras = 0, semProj = 0, total = 0;
    // Valores acumulam sobre o VALOR DO PC (valor_total) — cada linha da view
    // corresponde a um PC associado a um PV/OS, então somar PC dá a leitura de
    // "compra pendente / aprovada" que o operador espera nesta caixa.
    let totalVal = 0, aprovVal = 0, pendVal = 0, naoAprovVal = 0;
    const aprovPv = new Set<string>(), pendPv = new Set<string>(),
          naoAprovPv = new Set<string>(), atrasPv = new Set<string>(),
          allPv = new Set<string>();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const r of rowsAfterPvEtapa) {
      const s = effectiveStatus(r);   // ← efetivo: RC sem PC herda quando bucket aprovado, senão fica AGUARDANDO_PC
      const lbl = modulo === "pcs"
        ? `${r.empresa ?? ""}|${r.ncod_ped ?? ""}`
        : String(r.pv_os_label ?? "—");
      // AGUARDANDO_PC = não conta em total nem em nenhum card
      if (s === "AGUARDANDO_PC") continue;
      total++;
      const val = Number(r.valor_total) || 0;
      totalVal += val;
      allPv.add(lbl);
      if (isApproved(s)) { aprov++; aprovPv.add(lbl); aprovVal += val; }
      else if (s === "PENDENTE") { pend++; pendPv.add(lbl); pendVal += val; }
      else { naoAprov++; naoAprovPv.add(lbl); naoAprovVal += val; }
      const d = r.aprovar_ate_calc as string | null;
      if (d && !isApproved(s)) {
        const dt = new Date(d);
        if (!Number.isNaN(dt.getTime()) && dt < today) { atras++; atrasPv.add(lbl); }
      }
      if (r.sem_projeto === true) semProj++;
    }
    return {
      total, totalPv: allPv.size, totalVal,
      aprov, aprovPv: aprovPv.size, aprovVal,
      pend, pendPv: pendPv.size, pendVal,
      naoAprov, naoAprovPv: naoAprovPv.size, naoAprovVal,
      atras, atrasPv: atrasPv.size,
      semProj,
    };
  }, [rowsAfterPvEtapa, modulo]);

  // Pseudo-facets: PV Status / PC Aprovação / Atrasos / Serviços renderizados
  // como FacetDistribution (mesmo formato dos facets reais) pra tudo caber
  // num único cabeçalho de filtros. Single-select via toggle no callback.
  //
  // Semântica dos totais (todos os cards seguem a mesma regra: aplica TODOS os
  // filtros ativos EXCETO o próprio, pra que as contas fechem entre painéis):
  //   - Lado VENDA (Status PV, Tipo Omie, Etapa Venda): dedupe por pv_os_label,
  //     valor = pv_valor_total (uma vez por PV único).
  //   - Lado COMPRA (Aprovação PC, Etapa PC, Entrega): 1 row = 1 PC, valor =
  //     valor_total do PC. Rows sem PC (só PV) são excluídos.
  const pseudoPvStatusBuckets = useMemo(() => {
    const abertoPv   = new Set<string>();
    const fechadoPv  = new Set<string>();
    const semNfPv    = new Set<string>();
    let abertoVal = 0, fechadoVal = 0, semNfVal = 0;
    for (const r of rows) {
      if (!passesFilters(r, { skipPvEtapa: true })) continue;
      const k = String(r.pv_os_label ?? "");
      if (!k) continue;
      const etapa = String(r.pv_etapa_texto ?? "");
      const val = Number(r.pv_valor_total) || 0;
      const hasFat = String(r.pv_dt_fat ?? "").trim() !== ""
                  || String(r.pv_num_nfe ?? "").trim() !== "";
      if (!hasFat) {
        if (!semNfPv.has(k)) { semNfPv.add(k); semNfVal += val; }
      }
      if (ETAPAS_FECHADAS.has(etapa)) {
        if (!fechadoPv.has(k)) { fechadoPv.add(k); fechadoVal += val; }
      } else {
        if (!abertoPv.has(k)) { abertoPv.add(k); abertoVal += val; }
      }
    }
    return [
      { value: "Aberto",   count: abertoPv.size,  val: abertoVal },
      { value: "Faturado", count: fechadoPv.size, val: fechadoVal },
      { value: "Sem NF",   count: semNfPv.size,   val: semNfVal },
    ];
  }, [rows, passesFilters]);
  const pseudoPvStatusSelected = useMemo(() => {
    const s = new Set<string>();
    if (pvEtapaGroup === "aberto")  s.add("Aberto");
    if (pvEtapaGroup === "fechado") s.add("Faturado");
    if (pvEtapaGroup === "sem_nf")  s.add("Sem NF");
    return s;
  }, [pvEtapaGroup]);
  const pseudoPvStatusToggle = useCallback((v: string) => {
    const target: PvEtapaGroup = v === "Aberto" ? "aberto"
                               : v === "Faturado" ? "fechado"
                               : "sem_nf";
    setPvEtapaGroup((cur) => cur === target ? "todos" : target);
  }, []);

  const pseudoPcAprovBuckets = useMemo(() => {
    let aprov = 0, pend = 0, naoAprov = 0;
    let aprovVal = 0, pendVal = 0, naoAprovVal = 0;
    for (const r of rows) {
      if (!passesFilters(r, { skipStatus: true })) continue;
      const hasPc = !!(r.pc_numero || r.pc_numero_manual);
      if (!hasPc) continue;
      const s = effectiveStatus(r);
      if (s === "AGUARDANDO_PC") continue;
      const val = Number(r.valor_total) || 0;
      if (isApproved(s))         { aprov++;    aprovVal    += val; }
      else if (s === "PENDENTE") { pend++;     pendVal     += val; }
      else                       { naoAprov++; naoAprovVal += val; }
    }
    return [
      { value: "Aprovado",   count: aprov,    val: aprovVal },
      { value: "Pendente",   count: pend,     val: pendVal },
      { value: "Não Aprov.", count: naoAprov, val: naoAprovVal },
    ];
  }, [rows, passesFilters, effectiveStatus]);
  const pseudoPcAprovSelected = useMemo(() => {
    const s = new Set<string>();
    if (statusFilter === "aprovados")     s.add("Aprovado");
    if (statusFilter === "pendentes")     s.add("Pendente");
    if (statusFilter === "nao_aprovados") s.add("Não Aprov.");
    return s;
  }, [statusFilter]);
  const pseudoPcAprovToggle = useCallback((v: string) => {
    const target: StatusFilter =
      v === "Aprovado" ? "aprovados"
      : v === "Pendente" ? "pendentes"
      : "nao_aprovados";
    setStatusFilter((cur) => cur === target ? "todos" : target);
  }, []);

  const pseudoServicoBuckets = useMemo(() => [
    { value: "Executados", count: servicosCounts.concluidos, val: servicosCounts.concluidosVal },
    { value: "Agendados",  count: servicosCounts.agendados,  val: servicosCounts.agendadosVal },
    { value: "Sem OS",     count: servicosCounts.sem_os,     val: servicosCounts.semOsVal },
  ], [servicosCounts]);

  // Card "Status Serviços" — deriva de custom_fields.ww_os_status + ww_pode_faturar.
  // Valores acumulam pv_valor_total UMA vez por PV/OS único (side="V"), como o card
  // de "Status PV". Bucket é determinado pela 1ª row de cada pv_os_label (WW propaga
  // o mesmo status pra todas as rows do bucket).
  const pseudoServicosStatusBuckets = useMemo(() => {
    // Sem Vínculo primeiro (deve concentrar a maioria enquanto o processo de
    // vincular OS não amadurece), depois estados ativos, depois terminais.
    const ORDER = ["Sem Vínculo", "Pode Faturar", "OS Pendente", "Em Execução", "Aberta", "Parcial", "Aguardando", "Cancelada"] as const;
    const counts: Record<string, number> = Object.fromEntries(ORDER.map((k) => [k, 0]));
    const vals:   Record<string, number> = Object.fromEntries(ORDER.map((k) => [k, 0]));
    const seen = new Set<string>();
    for (const r of rows) {
      if (!passesFilters(r, { skipServicosStatus: true })) continue;
      const k = String(r.pv_os_label ?? "");
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const b = bucketServicosStatus(r);
      if (b == null) continue; // Mercantil: fora do card
      const val = Number(r.pv_valor_total) || 0;
      counts[b] = (counts[b] ?? 0) + 1;
      vals[b]   = (vals[b] ?? 0)   + val;
    }
    return ORDER.map((v) => ({ value: v, count: counts[v] ?? 0, val: vals[v] ?? 0 }));
  }, [rows, passesFilters]);
  const pseudoServicosStatusToggle = useCallback((v: string) => {
    setServicosStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }, []);
  const pseudoServicosStatusClear = useCallback(() => setServicosStatusFilter(new Set()), []);
  const pseudoServicoSelected = useMemo(() => {
    const s = new Set<string>();
    if (servicosFilter === "concluidos") s.add("Executados");
    if (servicosFilter === "agendados")  s.add("Agendados");
    if (servicosFilter === "sem_os")     s.add("Sem OS");
    return s;
  }, [servicosFilter]);
  const pseudoServicoToggle = useCallback((v: string) => {
    const target: ServicosFilter =
      v === "Executados" ? "concluidos"
      : v === "Agendados" ? "agendados"
      : "sem_os";
    setServicosFilter((cur) => cur === target ? "todos" : target);
  }, []);

  function toggleSel(key: string) {
    setSelected((prev) => {
      const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s;
    });
  }

  async function batchApprove(status: string) {
    if (selected.size === 0) return;
    const rowsBatch = [...selected].map((k) => {
      const [empresa, ncodStr, valorStr] = k.split("|");
      return { empresa, ncod_ped: Number(ncodStr), modulo, valorPc: valorStr ? Number(valorStr) : null };
    });
    const res = await fetch("/api/approvals/batch-approve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rowsBatch, status }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(`Erro: ${j.error ?? res.statusText}`); return; }
    setSelected(new Set());
    if (typeof window !== "undefined") window.location.reload();
  }

  async function batchDelete() {
    if (selected.size === 0) return;
    const rowsBatch = [...selected].map((k) => {
      const [empresa, ncodStr] = k.split("|");
      return { empresa, ncod_ped: Number(ncodStr) };
    });
    // Linhas reais do Omie (ncod_ped > 0) só admin pode apagar; o backend já
    // valida — alertamos antes pra evitar surpresa.
    const realRows = rowsBatch.filter((r) => r.ncod_ped > 0);
    const orphanRows = rowsBatch.filter((r) => r.ncod_ped < 0);
    let msg = `Apagar ${selected.size} linha(s) selecionada(s)?`;
    if (realRows.length > 0 && !isAdmin) {
      msg = `${realRows.length} linha(s) vêm direto do Omie e só admin pode apagar. ${orphanRows.length > 0 ? `${orphanRows.length} linha(s) extras (RC manual) podem ser apagadas.` : "Nada a fazer."}`;
      if (orphanRows.length === 0) { alert(msg); return; }
    }
    if (!confirm(msg)) return;
    const res = await fetch("/api/approvals/batch-delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rowsBatch }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(`Erro: ${j.error ?? res.statusText}`); return; }
    setSelected(new Set());
    if (typeof window !== "undefined") window.location.reload();
  }

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-[20px] font-bold tracking-tight text-ww-text">{title}</h1>
        <span className="text-[12px] text-ww-textMuted font-mono font-medium">
          {filtered.length.toLocaleString("pt-BR")} itens · {buckets.length} {modulo === "projetos" ? "projeto(s)" : modulo === "pcs" ? "PC(s)" : "PV/OS"}
          {loadingMore && <span className="ml-2 text-amber-700 animate-pulse">· carregando mais…</span>}
        </span>
        <div className="self-center"><GlobalSearch /></div>
        <div className="flex-1" />
        <span className="text-[11.5px] text-ww-textMuted font-mono uppercase tracking-wider font-semibold">
          {user?.role ?? "viewer"}
          {userCanEdit && " · edita PV/OS · RC · PC · Log"}
          {userCanApprove && " · aprova"}
        </span>
      </div>

      {/* KPIs agregados — colapsáveis */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] uppercase tracking-[0.6px] font-bold text-ww-textMuted">Métricas</span>
          <button onClick={() => setKpisOpen((o) => !o)}
            className="text-[11px] font-semibold text-ww-textMuted hover:text-ww-text transition flex items-center gap-1">
            <span>{kpisOpen ? "Ocultar" : "Mostrar"}</span>
            <span className="text-[8px] opacity-70">{kpisOpen ? "▲" : "▼"}</span>
          </button>
        </div>
        {kpisOpen && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {/* Total Valor */}
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-indigo-900 dark:text-indigo-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Volume Total</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{gateBRL(kpis.totalValor, userCanViewValues)}</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">{kpis.total} itens · {kpis.pvUnicos} PV/OS</div>
            </div>
            {/* Ticket Médio */}
            <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50/60 dark:bg-cyan-950/30 p-3 text-cyan-900 dark:text-cyan-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Ticket Médio (PV/OS)</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{gateBRL(kpis.ticketMedio, userCanViewValues)}</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">média por PV/OS</div>
            </div>
            {/* Total Aprovado */}
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Volume Aprovado</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{gateBRL(kpis.aprovValor, userCanViewValues)}</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">{kpis.aprovados} itens aprovados</div>
            </div>
            {/* % Conversão */}
            <div className="rounded-xl border border-fuchsia-200 dark:border-fuchsia-800 bg-fuchsia-50/60 dark:bg-fuchsia-950/30 p-3 text-fuchsia-900 dark:text-fuchsia-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Taxa de Aprovação</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{kpis.conversao.toFixed(1).replace(".", ",")}%</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">{kpis.aprovados} de {kpis.total}</div>
            </div>
            {/* Sem Fornecedor */}
            <div className={`rounded-xl border p-3 ${kpis.semFornecedor > 0
              ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100"
              : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400"}`}>
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Sem Fornecedor</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1 flex items-center gap-1">
                {kpis.semFornecedor > 0 && <span>⚠</span>}
                {fmtNum(kpis.semFornecedor)}
              </div>
              <div className="text-[10px] opacity-65 mt-0.5">{kpis.semFornecedor > 0 ? "PCs incompletos no Omie" : "tudo OK no Omie"}</div>
            </div>
          </div>
        )}
      </div>

      {/* CABEÇALHO DE FILTROS UNIFICADO — 6 painéis (grid 6-col). Cada um com
          hue distinto pra facilitar leitura visual. Alarmes ficam separados
          na filter bar embaixo. */}
      {modulo !== "pcs" && (
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <FacetDistribution facetKey="pv_etapa_texto"         label="Status PV"       accent="blue"     side="V" canViewValues={userCanViewValues}
          buckets={pseudoPvStatusBuckets} selected={pseudoPvStatusSelected} onToggle={pseudoPvStatusToggle} onClear={() => setPvEtapaGroup("todos")} />
        <FacetDistribution facetKey="pc_etapa_texto"         label="Aprovação PC"    accent="emerald"  side="C" canViewValues={userCanViewValues}
          buckets={pseudoPcAprovBuckets}  selected={pseudoPcAprovSelected}  onToggle={pseudoPcAprovToggle}  onClear={() => setStatusFilter("todos")} />
        <FacetDistribution facetKey="tipo_omie"              label="Tipo Omie"       accent="violet"   side="V" single canViewValues={userCanViewValues}
          buckets={facetDistributions.tipo_omie}
          selected={facets.tipo_omie ?? new Set()}                 onToggle={(v) => toggleFacet("tipo_omie", v)}              onClear={() => clearFacet("tipo_omie")} />
        <FacetDistribution facetKey="pv_etapa_texto"         label="Status Serviços" accent="teal"     side="V" canViewValues={userCanViewValues}
          buckets={pseudoServicosStatusBuckets} selected={servicosStatusFilter} onToggle={pseudoServicosStatusToggle} onClear={pseudoServicosStatusClear} />
        <FacetDistribution facetKey="pv_etapa_texto"         label="Etapa Venda"     accent="amber"    side="V" single canViewValues={userCanViewValues}
          buckets={facetDistributions.pv_etapa_texto}
          selected={facets.pv_etapa_texto ?? new Set()}            onToggle={(v) => toggleFacet("pv_etapa_texto", v)}         onClear={() => clearFacet("pv_etapa_texto")} />
        <FacetDistribution facetKey="mt_status_fornecimento" label="Entrega"         accent="fuchsia"  side="C" single canViewValues={userCanViewValues}
          buckets={facetDistributions.mt_status_fornecimento}
          selected={facets.mt_status_fornecimento ?? new Set()}    onToggle={(v) => toggleFacet("mt_status_fornecimento", v)} onClear={() => clearFacet("mt_status_fornecimento")} />
      </div>
      )}

      {/* ═══ FILTROS SECUNDÁRIOS — 2 linhas ═══
          Linha 1: MOLDURA "ALARMES" — os 5 dropdowns coloridos por grupo.
                    Fonte um pouco maior que os cards Kanban acima.
          Linha 2: Search (lupa delimitada) + Data + Fornecedor/Projeto/Categoria
                    + Relatório + Limpar filtros à direita. */}
      <div className="flex items-center gap-2 flex-wrap">
        {modulo !== "pcs" && (
          <AlarmesPanel
            alarmes={alarmes} counts={alarmeCounts}
            onToggle={toggleAlarme}
            onClearAll={clearAlarmes}
            onToggleGroup={(kinds) => {
              // Toggle inteligente: se algum do grupo ativo, desliga todos.
              // Senão, liga todos (mais rápido pra explorar).
              const anyActive = kinds.some((k) => alarmes.has(k));
              for (const k of kinds) {
                const on = alarmes.has(k);
                if (anyActive && on) toggleAlarme(k);
                else if (!anyActive && !on) toggleAlarme(k);
              }
            }}
            canViewValues={userCanViewValues}
          />
        )}
        <div className="flex-1 min-w-[260px] flex items-center gap-2 px-3 py-1.5 bg-ww-panel border border-ww-borderStrong rounded-[10px] shadow-sm focus-within:border-ww-accent focus-within:ring-2 focus-within:ring-ww-accent/20 transition">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-ww-textMuted shrink-0">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar nesta página: PC, fornecedor, projeto, RC…"
            className="flex-1 min-w-[180px] bg-transparent outline-none text-[13.5px] font-medium text-ww-text placeholder:text-ww-textMuted placeholder:font-medium"
          />
        </div>
        <DateRangeButton range={dateRange} onChange={setDateRange} />
        {modulo !== "pcs" && (
          <>
            <FacetDropdown label="Fornecedor" values={facetValues.contato_fornecedor}
              selected={facets.contato_fornecedor ?? new Set()}
              onToggle={(v) => toggleFacet("contato_fornecedor", v)}
              onClear={() => clearFacet("contato_fornecedor")} />
            <FacetDropdown label="Projeto" values={facetValues.projeto_nome}
              selected={facets.projeto_nome ?? new Set()}
              onToggle={(v) => toggleFacet("projeto_nome", v)}
              onClear={() => clearFacet("projeto_nome")} />
            <FacetDropdown label="Categoria" values={facetValues.codigo_categoria}
              selected={facets.codigo_categoria ?? new Set()}
              onToggle={(v) => toggleFacet("codigo_categoria", v)}
              onClear={() => clearFacet("codigo_categoria")} />
            <RelatorioMenu />
          </>
        )}
        {(() => {
          // Status PV default varia por módulo (ver defaultPvEtapa) — clear
          // volta pra esse default, não sempre "aberto". Assim /projetos limpa
          // pra "todos" e /avulsos limpa pra "aberto".
          const hasFacets   = Object.values(facets).some((s) => s && s.size > 0);
          const hasStatus   = statusFilter !== "todos";
          const hasPvEtapa  = pvEtapaGroup !== defaultPvEtapa;
          const hasServicos = servicosFilter !== "todos";
          const hasServStat = servicosStatusFilter.size > 0;
          const hasAtraso   = alarmes.size > 0;
          const hasDate     = dateRange.kind !== "off";
          const hasQuery    = query.trim() !== "";
          const anyFilter   = hasFacets || hasStatus || hasPvEtapa || hasServicos || hasServStat || hasAtraso || hasDate || hasQuery;
          return (
            <button
              onClick={() => {
                if (!anyFilter) return;
                setFacets({});
                setStatusFilter("todos");
                setPvEtapaGroup(defaultPvEtapa);
                setServicosFilter("todos");
                setServicosStatusFilter(new Set());
                clearAlarmes();
                setDateRange({ kind: "off" });
                setQuery("");
              }}
              disabled={!anyFilter}
              className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md border transition shadow-sm ${
                anyFilter
                  ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/50"
                  : "bg-ww-bg text-ww-textFaint border-ww-border opacity-60 cursor-not-allowed"
              }`}>
              <span className="text-[14px] leading-none">✕</span>
              Limpar todos os filtros
            </button>
          );
        })()}
      </div>

      {/* Toolbar minimal: só expandir/contrair todos os cards */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpenBuckets(new Set(buckets.map((b) => b.pv_os_label)))}
          className="px-2.5 py-1 text-[12px] font-semibold rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-text transition flex items-center gap-1">
          <span className="text-[14px] leading-none">+</span> Expandir todos
        </button>
        <button
          onClick={() => setOpenBuckets(new Set())}
          className="px-2.5 py-1 text-[12px] font-semibold rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-text transition flex items-center gap-1">
          <span className="text-[14px] leading-none">−</span> Contrair todos
        </button>
        <span className="text-[11.5px] font-medium text-ww-textMuted ml-2">Click numa bolinha do pipeline pra navegar entre os blocos.</span>
      </div>

      {/* Banner de filtros de alarme ativos — agrupa por grupo (OR interno)
          e separa por "E" entre grupos, refletindo a semântica do filtro. */}
      {alarmes.size > 0 && (() => {
        const groupsWithSel = ALARM_GROUPS
          .map((g) => ({ group: g, kinds: g.kinds.filter((k) => alarmes.has(k)) }))
          .filter((x) => x.kinds.length > 0);
        return (
          <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 dark:bg-rose-950/30 border-2 border-rose-300 dark:border-rose-800 rounded-[10px] flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.6px] font-black text-rose-800 dark:text-rose-200 shrink-0 flex items-center gap-1">
              <IconAlert /> Filtrando por
            </span>
            {groupsWithSel.map(({ group: g, kinds }, gi) => {
              const cfg = ACCENT_MAP[g.accent];
              return (
                <span key={g.key} className="inline-flex items-center gap-1">
                  {gi > 0 && (
                    <span className="text-[10px] uppercase tracking-[0.5px] font-black text-rose-700 dark:text-rose-300 px-1">E</span>
                  )}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${cfg.border} ${cfg.selectedBg} ${cfg.selectedText}`}>
                    {kinds.map((k, ki) => (
                      <span key={k} className="inline-flex items-center gap-1 text-[11px] font-bold">
                        {ki > 0 && <span className="text-[9.5px] opacity-70 font-black uppercase">ou</span>}
                        {ALARM_CFG[k].label}
                        <button onClick={() => toggleAlarme(k)}
                          title="Remover este filtro"
                          className="opacity-70 hover:opacity-100 text-[13px] leading-none">
                          ×
                        </button>
                      </span>
                    ))}
                  </span>
                </span>
              );
            })}
            <span className="text-[11px] text-rose-800 dark:text-rose-200 tabular-nums font-semibold ml-1">
              → {buckets.length} PV/OS
            </span>
            <button onClick={clearAlarmes}
              className="ml-auto text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 uppercase tracking-wider">
              Limpar alarmes
            </button>
          </div>
        );
      })()}

      {/* Total visível — painel com soma RC/PC/PV reagindo ao filtro atual */}
      <GrandTotalBar grand={grandTotal} modulo={modulo} count={filtered.length} canViewValues={userCanViewValues} />

      {/* Lista de cards */}
      <div className="space-y-5 pb-20 min-w-0">
        {buckets.length === 0 && (
          <div className="text-center py-16 text-ww-textFaint text-sm">
            Nenhum {modulo === "projetos" ? "projeto" : modulo === "pcs" ? "PC" : "PV/OS"} encontrado.
          </div>
        )}
        {buckets.map((b) => (
          <div key={b.pv_os_label} data-bucket={b.pv_os_label} data-pc={b.pc_numero ?? undefined}>
            <BucketCard
              bucket={b}
              modulo={modulo}
              isAdmin={isAdmin}
              userCanApprove={userCanApprove}
              userCanEdit={userCanEdit}
              open={openBuckets.has(b.pv_os_label)}
              onToggle={() => toggleBucket(b.pv_os_label)}
              onRowClick={(row) => setDrawerItem({ ...row, _bucket: b })}
              onStatusClick={(rowKey, row, anchor) => setStatusPopover({ rowKey, row, anchor })}
              selected={selected}
              toggleSel={toggleSel}
              visibleGroups={allGroups}
              onEnsureOpen={() => expandBucketAndScroll(b.pv_os_label)}
              optimisticStatus={optimisticStatus}
              canViewValues={userCanViewValues}
              canViewMargin={userCanViewMargin}
              todayStartMs={todayStartMs}
              alarmesActive={alarmes}
              onToggleAlarme={toggleAlarme}
              cronogramaMap={cronogramaMap}
              budgetMap={budgetMap}
            />
          </div>
        ))}
      </div>

      {/* Batch toolbar (flutuante) */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 bg-[#0e0e0c] dark:bg-[#f1f1ea] text-[#f1f1ea] dark:text-[#0a0a08] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.25)]">
          <span className="font-mono text-[11px] opacity-70">{selected.size} selecionados</span>
          <div className="w-px h-3.5 bg-[#3a3a35] dark:bg-[#c8c8be]" />
          {userCanApprove && (
            <>
              <button onClick={() => batchApprove("APROVADO")} className="px-2.5 py-1 text-[12px] font-semibold bg-[#0e6e57] dark:bg-[#3eba9a] text-white dark:text-[#0a1812] rounded-md transition hover:opacity-90">✓ Aprovar</button>
              <button onClick={() => batchApprove("APROVADO_FAT_DIRETO")} className="px-2.5 py-1 text-[12px] font-semibold border border-[#3a3a35] dark:border-[#c8c8be] rounded-md transition hover:bg-white/10">Fat. Direto</button>
              <button onClick={() => batchApprove("NAO_APROVADO")} className="px-2.5 py-1 text-[12px] font-semibold border border-[#3a3a35] dark:border-[#c8c8be] rounded-md transition hover:bg-white/10">✗ Rejeitar</button>
            </>
          )}
          {(isAdmin || userCanEdit || userCanApprove) && (
            <button onClick={batchDelete} className="px-2.5 py-1 text-[12px] font-semibold border border-rose-400/60 text-rose-300 hover:bg-rose-600 hover:text-white rounded-md transition" title="Apagar linha(s) selecionada(s) — só RC manual sem ser admin">🗑 Apagar</button>
          )}
          <button onClick={() => setSelected(new Set())} className="text-base px-1 opacity-60 hover:opacity-100 transition" title="Limpar seleção">×</button>
        </div>
      )}

      {/* Detail drawer */}
      {drawerItem && <BoldDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />}

      {/* Status popover */}
      {statusPopover && (
        <BoldStatusPopover
          anchor={statusPopover.anchor}
          rowKey={statusPopover.rowKey}
          row={statusPopover.row}
          modulo={modulo}
          isAdmin={isAdmin}
          onClose={() => setStatusPopover(null)}
          onOptimisticApply={(status) => applyOptimisticStatus(
            String(statusPopover.row.empresa),
            Number(statusPopover.row.ncod_ped),
            status
          )}
          onError={() => clearOptimisticStatus(
            String(statusPopover.row.empresa),
            Number(statusPopover.row.ncod_ped)
          )}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: readonly number[] }) {
  const w = 56, h = 16;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bucket card com pipeline
// ─────────────────────────────────────────────────────────────────────────

function BucketCard({
  bucket, modulo, isAdmin, userCanApprove, userCanEdit, open, onToggle, onRowClick, onStatusClick, selected, toggleSel, visibleGroups, onEnsureOpen, optimisticStatus, canViewValues = true, canViewMargin = true, todayStartMs, alarmesActive, onToggleAlarme, cronogramaMap, budgetMap,
}: {
  bucket: Bucket;
  modulo: "avulsos" | "projetos" | "pcs";
  isAdmin: boolean;
  userCanApprove: boolean;
  userCanEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onRowClick: (row: AnyRow) => void;
  onStatusClick: (rowKey: string, row: AnyRow, anchor: DOMRect) => void;
  selected: Set<string>;
  toggleSel: (key: string) => void;
  visibleGroups: Group[];
  onEnsureOpen: () => void;
  optimisticStatus: Record<string, string>;
  canViewValues?: boolean;
  canViewMargin?: boolean;
  todayStartMs: number;
  alarmesActive: Set<AlarmKind>;
  onToggleAlarme: (k: AlarmKind) => void;
  cronogramaMap?: Map<string, CronogramaSummary>;
  budgetMap?: Map<string, BudgetSummary>;
}) {
  // Alarmes deste bucket — semântica bucket-level (não row): "Sem PC" só flaga
  // se o PV inteiro não tem NENHUM PC, "Aprov. pendente" ignora rows RC-only, etc.
  // Ordena pela ordem canônica dos grupos pra tags saírem consistentes visualmente.
  const bucketAlarms = useMemo(() => {
    const active = computeBucketAlarms(bucket.rows, todayStartMs);
    const ordered: AlarmKind[] = [];
    for (const g of ALARM_GROUPS) for (const k of g.kinds) if (active.has(k)) ordered.push(k);
    return ordered;
  }, [bucket.rows, todayStartMs]);
  // Mapa AlarmKind → grupo (pra pintar cada tag na cor certa)
  const kindGroup = useMemo(() => {
    const m: Record<string, typeof ALARM_GROUPS[number]> = {};
    for (const g of ALARM_GROUPS) for (const k of g.kinds) m[k] = g;
    return m;
  }, []);
  const items = bucket.rows;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // groupKey alvo do scroll quando o card abre; reseta após executar
  const pendingScroll = useRef<string | null>(null);
  // Stage ativo — última bolinha clicada no Pipeline. Destaca bolinha + grupo
  // correspondente da tabela pra dar continuidade visual "cliquei aqui, estou aqui".
  const [activeStageKey, setActiveStageKey] = useState<string | null>(null);

  // Faz scroll horizontal pro <th> com data-group={groupKey} dentro do container
  function scrollToGroup(groupKey: string) {
    const container = tableContainerRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-group="${groupKey}"]`) as HTMLElement | null;
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scrollLeft = container.scrollLeft + (targetRect.left - containerRect.left) - 8;
    container.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }

  function handleStageClick(groupKey: string) {
    setActiveStageKey(groupKey);
    if (open) {
      scrollToGroup(groupKey);
    } else {
      // Card fechado: abre e marca pra rolar quando montar
      pendingScroll.current = groupKey;
      onEnsureOpen();
    }
  }

  // Após renderizar o body do card aberto, executa scroll pendente (se houver)
  useEffect(() => {
    if (open && pendingScroll.current) {
      const k = pendingScroll.current;
      pendingScroll.current = null;
      // RAF + small timeout pra garantir que table renderizou
      requestAnimationFrame(() => setTimeout(() => scrollToGroup(k), 50));
    }
  }, [open]);

  // Aprovação considera SÓ PCs reais (rows com pc_numero/manual) — RC sem PC
  // não conta nem como aprovado nem como pendente (é um "aguardando PC").
  // Quando TODOS os PCs do bucket estão aprovados, RCs sem PC herdam APROVADO.
  const pcRowsForApproval = useMemo(
    () => items.filter((r) => r.pc_numero || r.pc_numero_manual),
    [items]
  );
  const aprovCountInBucket = useMemo(
    () => pcRowsForApproval.filter((r) => isApproved(String(r.status ?? ""))).length,
    [pcRowsForApproval]
  );
  const allPcsApproved =
    pcRowsForApproval.length > 0 && aprovCountInBucket === pcRowsForApproval.length;

  // Pipeline stages — ternário (green/yellow/red) baseado nas regras confirmadas
  // com o usuário. Cada stage tem groupKey clicável. Regras:
  //  PV/OS: sempre 🟢 (bucket só existe se tem PV/OS)
  //  Previsão: 🟢 previsão ≥ hoje · 🔴 < hoje · 🟡 sem previsão
  //  RC: 🟢 alguma linha com rc_numero E rc_custo · 🟡 tem rc_numero mas incompleto · 🔴 nenhum rc_numero
  //  PC: 🟢 algum PC com número + fornecedor + valor · 🟡 tem PC mas incompleto · 🔴 nenhum
  //  Aprovação: 🟢 todos aprovados · 🟡 alguns PENDENTE/PRE_SELECAO · 🔴 algum NAO_APROVADO/REJEITADO
  //  Logística: 🟢 todos PCs com NF entrada recebida · 🟡 parcial · 🔴 nenhum recebido
  //  Saída: 🟢 pv_dt_fat E pv_num_nfe · 🟡 etapa=Faturar sem pv_dt_fat · 🔴 nenhum
  const stages = useMemo(() => {
    type StageState = "green" | "yellow" | "red" | "off";
    const todayStartMs = new Date().setHours(0, 0, 0, 0);
    // Previsão (do PV/OS) — combina data original (pv_data_previsao) com a
    // nova previsão remarcada. tipo Mix/Serviço usa nova_prev_servicos (fonte:
    // app de serviços); Mercantil usa nova_prev_materiais.
    // Estados:
    //   🟢 verde:    original ≥ hoje (no prazo)
    //   🟡 amarelo:  original passou MAS nova prev futura (foi remarcada)
    //   🔴 vermelho: original passou E sem nova prev (ou nova prev também venceu),
    //                OU nunca teve previsão (sem prev — pega o alarme "Sem prev.")
    const previsaoRaw = String(items[0]?.pv_data_previsao ?? "").trim();
    const previsaoMs = previsaoRaw ? parseFlexDate(previsaoRaw) : null;
    const tipoHead = String(items[0]?.tipo_omie ?? "");
    const isServMix = tipoHead === "Mix" || tipoHead === "Serviços";
    // Pega a nova prev do PV — usa a MAIOR data disponível (mais representativa
    // do estado atual). Fallback: se serviço não tiver, cai em materiais e vice-versa.
    const novasServ = items.map((r) => String(r.nova_prev_servicos ?? "").trim()).filter(Boolean);
    const novasMat  = items.map((r) => String(r.nova_prev_materiais ?? "").trim()).filter(Boolean);
    const novasPrio = isServMix ? [...novasServ, ...novasMat] : [...novasMat, ...novasServ];
    let novaPrevRaw = "", novaPrevMs: number | null = null;
    for (const s of novasPrio) {
      const t = parseFlexDate(s);
      if (t == null) continue;
      if (novaPrevMs == null || t > novaPrevMs) { novaPrevMs = t; novaPrevRaw = s; }
    }
    // Formata pra BR (view mistura ISO e BR)
    const fmtBR = (s: string) => {
      const t = parseFlexDate(s);
      if (t == null) return s;
      const d = new Date(t);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };
    // previsaoMs / novaPrevMs / novaPrevRaw calculados acima são insumo pros
    // dots PV/OS (data limite ultrapassada) e SERVIÇOS (idem). O antigo dot
    // "Prev. Serv." foi removido; sua função virou o dot SERVIÇOS, cuja cor
    // deriva de servicos_concluidos, não da data limite. fmtBR/novaPrevRaw
    // permanecem definidos pra caso outros trechos venham a usá-los.
    void fmtBR; void novaPrevRaw;
    // RC — BINÁRIO (não usa amarelo). RED = sem RC OU dados faltando.
    // GREEN = todos completos.
    let rcTotal = 0, rcCompleto = 0;
    const rcVistos = new Set<string>();
    for (const r of items) {
      const num = r.rc_numero;
      if (num == null) continue;
      const key = String(num);
      if (rcVistos.has(key)) continue;
      rcVistos.add(key);
      rcTotal += 1;
      if (r.rc_custo != null && Number(r.rc_custo) !== 0) rcCompleto += 1;
    }
    const rcState: StageState =
      rcTotal === 0 ? "red"
      : rcCompleto === rcTotal ? "green"
      : "red"; // parcial = cadastro incompleto = red (binário)
    // PC — BINÁRIO. RED = sem PC OU dados faltando. GREEN = todos completos.
    let pcTotal = 0, pcCompleto = 0;
    for (const r of items) {
      const num = r.pc_numero || r.pc_numero_manual;
      if (!num) continue;
      pcTotal += 1;
      const hasForn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
      const hasVal = r.valor_total != null && Number(r.valor_total) !== 0;
      const hasCat = !!r.codigo_categoria;
      if (hasForn && hasVal && hasCat) pcCompleto += 1;
    }
    const pcState: StageState =
      pcTotal === 0 ? "red"
      : pcCompleto === pcTotal ? "green"
      : "red"; // parcial = cadastro incompleto = red (binário)
    // Aprovação — RED sem workflow, YELLOW qualquer pendência, GREEN todos aprovados
    const aprovState: StageState =
      pcRowsForApproval.length === 0 ? "red"
      : allPcsApproved ? "green"
      : "yellow"; // qualquer pendência (inclui rejeitado, pendente, pre_selecao)
    // MATERIAIS (ex-Logística, absorve Prev. Mat.) — RED sem PC, YELLOW enquanto
    // material não chegou, GREEN quando todos recebidos. Nova previsão vencida
    // fica no chip via alarme, não muda a cor do dot.
    const pcsComPc = items.filter((r) => r.pc_numero || r.pc_numero_manual);
    const nRecebidos = pcsComPc.filter((r) => !!r.mt_data_recebimento_nf).length;
    const materiaisState: StageState =
      pcsComPc.length === 0 ? "red"
      : nRecebidos === pcsComPc.length ? "green"
      : "yellow";
    // Materiais — computa métricas por PC pra alimentar o detalhe/dev do dot
    // MATERIAIS (o estado da cor vem de materiaisState, acima). Nova prev.
    // vencida serve pra badge "Nx" ou "-Xd" no dot, mas não muda a cor.
    let pcAtrasado = 0, pcRemarcado = 0, pcOnTime = 0, pcRecebido = 0;
    let piorAtrasoDias = 0;
    for (const r of items) {
      const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
      if (!hasPc) continue;
      if (r.mt_data_recebimento_nf) { pcRecebido++; continue; }
      const origS = String(r.dt_previsao ?? "").trim();
      const origMs = origS ? parseFlexDate(origS) : null;
      const novaS = String(r.nova_prev_materiais ?? "").trim();
      const novaMs = novaS ? parseFlexDate(novaS) : null;
      const efetivaMs = novaMs ?? origMs;
      if (efetivaMs == null) { pcOnTime++; continue; }
      if (efetivaMs >= todayStartMs) {
        if (novaMs != null && origMs != null && origMs < todayStartMs) pcRemarcado++;
        else pcOnTime++;
      } else {
        pcAtrasado++;
        const dias = Math.floor((todayStartMs - efetivaMs) / 86400000);
        if (dias > piorAtrasoDias) piorAtrasoDias = dias;
      }
    }
    const totalPcMat = pcAtrasado + pcRemarcado + pcOnTime + pcRecebido;
    const materiaisDetail =
      totalPcMat === 0 ? "sem PC"
      : nRecebidos === pcsComPc.length ? "todos recebidos"
      : pcAtrasado > 0 ? `${pcAtrasado} atrasado(s) · pior ${piorAtrasoDias}d · ${nRecebidos}/${pcsComPc.length} rec.`
      : pcRemarcado > 0 ? `${pcRemarcado} remarcado(s) · ${nRecebidos}/${pcsComPc.length} rec.`
      : `${nRecebidos}/${pcsComPc.length} recebidos`;

    // Saída — BINÁRIO. GREEN = pv_dt_fat + pv_num_nfe preenchidos. RED = falta
    // qualquer um dos dois. Não usa amarelo (usuário confirmou).
    const pvDtFat = String(items[0]?.pv_dt_fat ?? "").trim();
    const pvNumNfe = String(items[0]?.pv_num_nfe ?? "").trim();
    const pvEtapa  = String(items[0]?.pv_etapa_texto ?? "").trim();
    const tipoBucket = String(items[0]?.tipo_omie ?? "");
    const saidaState: StageState =
      (pvDtFat && pvNumNfe) ? "green" : "red";

    // PV/OS — RED se cadastro incompleto (sem tipo/cliente/data limite).
    // YELLOW se completo mas data limite ultrapassada. GREEN caso contrário.
    const pvItem = items[0];
    const hasTipoPv     = !!String(pvItem?.tipo_omie ?? "").trim();
    const hasClientePv  = !!String(pvItem?.pv_cliente_fantasia ?? "").trim();
    const hasDataLimite = previsaoMs != null;
    const pvosState: StageState =
      !hasTipoPv || !hasClientePv || !hasDataLimite ? "red"
      : previsaoMs < todayStartMs ? "yellow"
      : "green";

    // SERVIÇOS (só avulsos) — off pra Mercantil (fora do processo). Pra
    // Mix/Serviços: RED sem previsão, YELLOW enquanto serviço não concluído,
    // GREEN quando todos concluídos.
    let servicosState: StageState = "off";
    let servicosDetail = "n/a";
    let servicosDev: { value: number; suffix: string; tone: "red" | "amber" | "green" } | null = null;
    if (tipoBucket === "Serviços" || tipoBucket === "Mix") {
      const totalOs = items.length;
      const concluidosCount = items.filter((r) => r.servicos_concluidos === true).length;
      if (previsaoMs == null) {
        servicosState = "red";
        servicosDetail = "sem previsão";
      } else if (concluidosCount >= totalOs) {
        servicosState = "green";
        servicosDetail = "concluído";
      } else {
        servicosState = "yellow";
        servicosDetail = `${concluidosCount}/${totalOs} concluído(s)`;
        if (previsaoMs < todayStartMs) {
          const dias = Math.floor((todayStartMs - previsaoMs) / 86400000);
          servicosDev = { value: -dias, suffix: "d", tone: "red" };
        }
      }
    }

    // Desvios em dias — número pequeno colorido acima do dot. Negativo = atraso.
    // PV/OS: data limite ultrapassada (pv_data_previsao vs hoje).
    const pvAtrasoDias = previsaoMs != null && previsaoMs < todayStartMs
      ? Math.floor((todayStartMs - previsaoMs) / 86400000) : null;
    // Materiais: pior atraso de PC (nova prev vencida) OU contador de remarcações.
    const materiaisAtrasoDias = pcAtrasado > 0 ? piorAtrasoDias : null;

    const pvosDetail =
      bucket.groupKind === "project" ? `${bucket.pvOsCount ?? 0} PV/OS` :
      bucket.groupKind === "etapa"   ? `${items.length} PC(s)` :
      bucket.groupKind === "pc"      ? (String(items[0]?.pv_os_label ?? "—")) :
      bucket.pv_os_label;

    type Dev = { value: number; suffix: string; tone: "red" | "amber" | "green" } | null;
    const pvosDev: Dev       = pvAtrasoDias != null      ? { value: -pvAtrasoDias,      suffix: "d", tone: "red" } : null;
    const materiaisDev: Dev  = materiaisAtrasoDias != null ? { value: -materiaisAtrasoDias, suffix: "d", tone: "red" }
                              : (pcRemarcado > 0 ? { value: pcRemarcado, suffix: "×", tone: "amber" } : null);

    // Tipos que envolvem materiais → RC/PC/Materiais/Aprovação fazem sentido.
    // Regra por módulo:
    //   • /projetos: se PJ* tem PCs vinculados, mostra o pipeline mesmo com
    //     tipo=Serviços (ex: PJ351_ITAMED é Serviços mas comprou 31 materiais).
    //   • /avulsos e /pcs: tipo Serviços puro → pipeline de compra fica "off"
    //     independente de ter PC ou não (semântica avulsa: Serviços = sem material).
    const anyPcInBucket = items.some((r) => !!r.pc_numero || !!r.pc_numero_manual);
    const isServicoOnly = modulo === "projetos"
      ? (tipoBucket === "Serviços" && !anyPcInBucket)
      : (tipoBucket === "Serviços");
    const purchaseState = (s: StageState): StageState => isServicoOnly ? "off" : s;
    const purchaseDev   = (d: Dev): Dev              => isServicoOnly ? null : d;
    const purchaseDetail = (d: string): string       => isServicoOnly ? "n/a" : d;

    // Cronograma (só /projetos): estado deriva de projeto_etapas via cronogramaMap.
    // Regra:
    //   • off    = sem etapas cadastradas
    //   • red    = alguma pendente e vencida (data_prevista < hoje sem data_conclusao)
    //   • green  = todas concluídas
    //   • yellow = tem etapa mas sem atraso
    // Dev = -Xd com o pior atraso (aproximado pela próxima em atraso).
    let cronogramaState: StageState = "off";
    let cronogramaDetail = "sem etapas";
    let cronogramaDev: Dev = null;
    if (modulo === "projetos" && cronogramaMap) {
      const empProj = String(items[0]?.empresa ?? "").trim();
      const codProj = Number(
        items.find((r) => r.codigo_projeto)?.codigo_projeto
        ?? items.find((r) => r.pv_codigo_projeto)?.pv_codigo_projeto
        ?? 0
      );
      const key = codProj > 0 ? `${empProj}|${codProj}` : "";
      const s = key ? cronogramaMap.get(key) : undefined;
      if (s && s.total > 0) {
        if (s.concluidas >= s.total) {
          cronogramaState = "green";
          cronogramaDetail = `${s.total}/${s.total} concluídas`;
        } else if (s.atrasadas > 0) {
          cronogramaState = "red";
          cronogramaDetail = `${s.atrasadas} atrasada(s) · ${s.concluidas}/${s.total} ok`;
          if (s.proxima_data) {
            const [y, m, d] = s.proxima_data.split("-").map(Number);
            const dt = new Date(y, m - 1, d).getTime();
            if (dt < todayStartMs) {
              const dias = Math.floor((todayStartMs - dt) / 86400000);
              cronogramaDev = { value: -dias, suffix: "d", tone: "red" };
            }
          }
        } else {
          cronogramaState = "yellow";
          cronogramaDetail = s.proxima_nome
            ? `próxima: ${s.proxima_nome}${s.proxima_data ? ` · ${s.proxima_data}` : ""}`
            : `${s.concluidas}/${s.total} concluídas`;
        }
      }
    }

    // Nova ordem (2026-07):
    //   PV/OS → [Cronograma (projetos) | -] → RC → PC → Aprovação → Materiais →
    //   [Serviços (avulsos) | -] → Saída
    // Prev. Mat. foi fundido no dot MATERIAIS (nova prev. só influencia badge,
    // não cor). Prev. Serv. renomeado pra SERVIÇOS e movido pra depois de
    // Materiais. Logística renomeada pra Materiais.
    const stages: { label: string; state: StageState; detail: string; groupKey: string; dev: Dev }[] = [];
    stages.push({ label: "PV/OS", state: pvosState, detail: pvosDetail, groupKey: "pvos", dev: pvosDev });
    if (modulo === "projetos") {
      stages.push({ label: "Cronograma", state: cronogramaState, detail: cronogramaDetail, groupKey: "cronograma", dev: cronogramaDev });
    }
    stages.push({ label: "RC",         state: purchaseState(rcState),        detail: purchaseDetail(`${rcCompleto}/${rcTotal} completos`),                       groupKey: "rc",        dev: null });
    stages.push({ label: "PC",         state: purchaseState(pcState),        detail: purchaseDetail(`${pcCompleto}/${pcTotal} completos`),                       groupKey: "pc",        dev: null });
    stages.push({ label: "Aprovação",  state: purchaseState(aprovState),     detail: purchaseDetail(`${aprovCountInBucket}/${pcRowsForApproval.length} PCs ok`), groupKey: "aprovacao", dev: null });
    stages.push({ label: "Materiais",  state: purchaseState(materiaisState), detail: purchaseDetail(materiaisDetail),                                            groupKey: "log",       dev: purchaseDev(materiaisDev) });
    if (modulo !== "projetos") {
      stages.push({ label: "Serviços", state: servicosState, detail: servicosDetail, groupKey: "previsao", dev: servicosDev });
    }
    stages.push({ label: "Saída",      state: saidaState,                    detail: (pvDtFat && pvNumNfe) ? "faturado" : "aguardando",                          groupKey: "saida",     dev: null });
    return modulo === "pcs" ? stages.filter((s) => s.groupKey !== "rc") : stages;
  }, [items, bucket.pv_os_label, bucket.groupKind, bucket.pvOsCount, modulo,
      allPcsApproved, aprovCountInBucket, pcRowsForApproval, cronogramaMap, todayStartMs]);

  // Pré-computa runs de pv_os_label dentro do bucket: pra cada índice, quantas
  // linhas seguidas compartilham o mesmo pv_os_label (e qual o índice de início).
  // Usado pra aplicar rowspan dos merged cells (totais/diff por PV/OS) por run,
  // não pelo bucket inteiro — crítico no modo projeto (bucket = vários PV/OS).
  const pvosRuns = useMemo(() => {
    const startIdx: number[] = new Array(items.length);
    const runSize: number[] = new Array(items.length);
    let i = 0;
    while (i < items.length) {
      const lbl = String(items[i].pv_os_label ?? "—");
      let j = i;
      while (j < items.length && String(items[j].pv_os_label ?? "—") === lbl) j++;
      const size = j - i;
      for (let k = i; k < j; k++) { startIdx[k] = i; runSize[k] = size; }
      i = j;
    }
    return { startIdx, runSize };
  }, [items]);

  // Achata todas as colunas visíveis junto com seu grupo (pra header em 2 camadas)
  const flatCols = useMemo(() => {
    const out: { col: import("@/lib/columns").Column; group: Group }[] = [];
    for (const g of visibleGroups) for (const c of g.columns) out.push({ col: c, group: g });
    return out;
  }, [visibleGroups]);

  // Ações do projeto (só /projetos com codigo_projeto): faixa horizontal no
  // topo do card, separada do bloco de metadata + alarmes pra não conflitar
  // visualmente. codigo_projeto pode vir de qualquer row do bucket.
  const projetoActions = useMemo(() => {
    if (modulo !== "projetos" || bucket.groupKind !== "project") return null;
    const codProj = Number(
      bucket.rows.find(r => r.codigo_projeto)?.codigo_projeto
      ?? bucket.rows.find(r => r.pv_codigo_projeto)?.pv_codigo_projeto
      ?? 0
    );
    if (!codProj) return null;
    const empresaProj = String(bucket.rows[0]?.empresa ?? "SF");
    return { codProj, empresaProj };
  }, [modulo, bucket.groupKind, bucket.rows]);

  return (
    <div className="group/bucket bg-ww-panel border-2 border-ww-borderStrong rounded-[12px] overflow-hidden shadow-md min-w-0 max-w-full">
      {/* Action bar (só /projetos) — separada do header pra ações não
          conflitarem visualmente com os alarmes na coluna da esquerda. */}
      {projetoActions && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-2 border-b border-ww-border bg-ww-bg/60"
             onClick={(e) => e.stopPropagation()}>
          <a href={`/projetos/${projetoActions.codProj}/materiais?empresa=${encodeURIComponent(projetoActions.empresaProj)}`}
            title="Abre a lista de materiais deste projeto (upload + status por item)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition">
            🧱 <span>Lista de Materiais</span> <span className="opacity-60">→</span>
          </a>
          <FluxoFinanceiroUploadButton empresa={projetoActions.empresaProj} codigoProjeto={projetoActions.codProj} />
          <ProjetoEscopoButton empresa={projetoActions.empresaProj} codigoProjeto={projetoActions.codProj} />
        </div>
      )}
      {/* Header card — usamos <div role="button"> em vez de <button> porque o
          Pipeline interno renderiza <button> pra cada stage (clicáveis) e HTML
          não permite buttons aninhados — o parser do browser hoista os filhos
          pra fora, quebrando layout (cards viram filhos diretos de <body>). */}
      <div onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        aria-expanded={open}
        className={`w-full px-5 py-4 grid gap-4 items-center text-left transition cursor-pointer ${
          open ? "bg-ww-bg border-b-2 border-ww-borderStrong" : "hover:bg-ww-rowHover"
        }`}
        style={{ gridTemplateColumns: modulo === "pcs" ? "200px 1fr 160px 32px" : "200px 1fr 460px 32px" }}>
        <div className="min-w-0">
          {/* Empresa é uniforme dentro do bucket (mesmo PV/OS). Fallback SF. */}
          {(() => {
            const empBucket = String(items[0]?.empresa ?? "SF");
            const cmt = <PvOsComentarios empresa={empBucket} pvOsLabel={bucket.pv_os_label} />;
            return (
              <>
                {bucket.groupKind === "project" ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold tracking-[-0.2px] text-ww-text truncate">{bucket.pv_os_label}</span>
                      <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} item(s)</span>
                      {cmt}
                    </div>
                    <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.pvOsCount ?? 0} PV/OS no projeto</div>
                    <div className="text-[11.5px] text-ww-textFaint mt-0.5 truncate">{bucket.cliente ?? "—"}</div>
                  </>
                ) : bucket.groupKind === "etapa" ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold tracking-[-0.2px] text-ww-text truncate">{bucket.pv_os_label}</span>
                      <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} PC(s)</span>
                      {cmt}
                    </div>
                    <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate uppercase tracking-[0.4px] font-semibold">Etapa do PC</div>
                  </>
                ) : bucket.groupKind === "pc" ? (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[13px] font-semibold tracking-[-0.2px] text-ww-text">PC {bucket.pv_os_label}</span>
                      <span className="text-[10px] font-mono text-ww-textFaint">· {String(items[0]?.empresa ?? "—")}</span>
                      {cmt}
                    </div>
                    <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.cliente ?? "— sem fornecedor —"}</div>
                    <div className="text-[11.5px] text-ww-textFaint mt-0.5 truncate">{bucket.projeto ?? "—"}</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[13px] font-semibold tracking-[-0.2px] text-ww-text">{bucket.pv_os_label}</span>
                      {bucket.pv_os_tipo && (
                        <span className="text-[11px] font-mono text-ww-textFaint px-1.5 py-px border border-ww-border rounded uppercase tracking-[0.5px]">{bucket.pv_os_tipo}</span>
                      )}
                      <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} item(s)</span>
                      {cmt}
                    </div>
                    <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.cliente ?? "—"}</div>
                    <div className="text-[11.5px] text-ww-textFaint mt-0.5 font-mono truncate">{bucket.projeto ?? "—"}</div>
                  </>
                )}
              </>
            );
          })()}
          {/* Minitags nomeadas: uma tag por alarme específico, cor do grupo.
              Click filtra a página por aquele alarme (toggle no filtro global).
              Se o filtro já está ativo, tag ganha ring destacado. */}
          {bucketAlarms.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {bucketAlarms.map((kind) => {
                const g = kindGroup[kind];
                if (!g) return null;
                const cfg = ACCENT_MAP[g.accent];
                const label = ALARM_SHORT_LABEL[kind];
                const isActive = alarmesActive.has(kind);
                return (
                  <button key={kind}
                    onClick={(e) => { e.stopPropagation(); onToggleAlarme(kind); }}
                    title={`${ALARM_CFG[kind].label} — ${ALARM_CFG[kind].hint}\n\nClick pra ${isActive ? "remover o filtro" : "filtrar por este alarme"}.`}
                    className={`inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-[0.3px] border transition ${cfg.border} ${cfg.selectedBg} ${cfg.selectedText} hover:opacity-80 ${
                      isActive ? "ring-2 ring-offset-1 ring-slate-800 dark:ring-white" : ""
                    }`}>
                    <IconAlert />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Pipeline stages={stages} onStageClick={handleStageClick} activeGroupKey={activeStageKey} />

        <BucketTotals bucket={bucket} items={items} modulo={modulo} canViewValues={canViewValues} canViewMargin={canViewMargin} budgetMap={budgetMap} />

        <div className="flex items-center justify-end gap-0.5">
          {/* Lixeira só aparece no hover do card (opacity 0 default) — ação
              admin, não deve competir visualmente com os totais ao lado. */}
          {isAdmin && bucket.groupKind === "pvos" && (
            <button onClick={async (e) => {
              e.stopPropagation();
              const lbl = bucket.pv_os_label;
              const empresa = (items[0]?.empresa as string) ?? "";
              if (!confirm(`Excluir ${lbl} do painel?\n\nO PV/OS some daqui imediatamente. Para voltar, é só remover da lista de exclusão (admin).`)) return;
              const motivo = prompt("Motivo (opcional):") ?? undefined;
              const r = await fetch("/api/admin/exclude-pv-os", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "exclude", empresa, pv_os_label: lbl, motivo }),
              });
              if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Erro: ${j.error ?? r.statusText}`); return; }
              window.location.reload();
            }}
              title="Excluir este PV/OS do painel (admin)"
              className="opacity-0 group-hover/bucket:opacity-40 hover:!opacity-100 hover:text-rose-600 text-ww-textFaint transition p-0.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
          <span className="text-ww-textFaint text-center text-[12px]">{open ? "▾" : "▸"}</span>
        </div>
      </div>

      {/* Body — tabela densa com todas as colunas dos grupos visíveis */}
      {open && (
        <div className="border-t border-ww-border">
          {/* Cronograma editável mora só na sub-página /projetos/:codigo/materiais
              (ProjetoEtapasBlock). Aqui no /projetos principal ele fica de fora
              pra evitar redundância e problemas de permissão em bulk quando
              muitos buckets abrem ao mesmo tempo. O dot Cronograma do pipeline
              continua refletindo o estado agregado via cronogramaMap. */}
          {visibleGroups.length === 0 ? null : (
            <div ref={tableContainerRef} className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                {/* Header em 2 camadas: grupos com tint + colunas */}
                <thead>
                  <tr>
                    {(userCanApprove || userCanEdit) && (
                      <th className="bg-ww-bg w-8" rowSpan={2}></th>
                    )}
                    {visibleGroups.map((g) => {
                      const isActive = g.key === activeStageKey;
                      return (
                        <th key={g.key} colSpan={g.columns.length} data-group={g.key}
                          className={`px-3 py-2 text-[13px] font-semibold text-left text-ww-text ${g.tint} border-b-2 border-r-2 border-ww-borderStrong last:border-r-0 ${
                            isActive ? "ring-2 ring-inset ring-sky-500 dark:ring-sky-400 shadow-md" : ""
                          }`}>
                          {g.label}
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    {flatCols.map(({ col, group }, i) => {
                      const nextGroup = flatCols[i + 1]?.group;
                      const isLastOfGroup = !nextGroup || nextGroup.key !== group.key;
                      const isActive = group.key === activeStageKey;
                      return (
                        <th key={`${col.key}-${i}`}
                          className={`px-2.5 py-1.5 text-[12px] font-semibold border-b whitespace-nowrap ${
                            isLastOfGroup ? "border-r-2 border-ww-borderStrong" : "border-r border-ww-border/60"
                          } last:border-r-0 ${
                            col.editable
                              ? `${group.tint}/40 text-ww-text`
                              : "text-ww-textMuted"
                          } ${isActive ? `${group.tint}/80` : ""} ${alignClassFor(col)}`}>
                          {col.editable && <span className="text-amber-600 dark:text-amber-400 mr-0.5" title="Editável">✎</span>}
                          {col.label.replace(/^\*/, "")}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => {
                    const valor = r.valor_total != null ? Number(r.valor_total) : null;
                    const selKey = `${r.empresa}|${r.ncod_ped}|${valor ?? ""}`;
                    const checked = selected.has(selKey);
                    return (
                      <tr key={i}
                        onClick={() => onRowClick(r)}
                        className={`cursor-pointer transition ${
                          checked ? "bg-[#f4faf7] dark:bg-[#15302a]/30" : "hover:bg-ww-rowHover"
                        } ${i > 0 ? "border-t border-ww-border" : ""}`}>
                        {(userCanApprove || userCanEdit) && (
                          <td className="px-2 py-1 align-middle" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleSel(selKey)}
                              className="accent-ww-accent cursor-pointer" />
                          </td>
                        )}
                        {flatCols.map(({ col, group }, j) => {
                          // Totais e diff % são iguais por PV/OS → rowspan ao longo
                          // do run de linhas com mesmo pv_os_label. Em modo PV/OS o
                          // bucket = 1 PV/OS, então span = items.length. Em modo
                          // projeto, span = tamanho do run dentro do bucket.
                          const MERGED_KEYS = new Set([
                            "rc_custo_total_calc", "pc_custo_total_calc",
                            "dif_pct_pc_rc", "rc_pc_vs_rc",
                            "servicos_concluidos",  // 1 ✅ por bucket OS (trigger garante mesmo valor em todas rows)
                          ]);
                          const isMerged = MERGED_KEYS.has(col.key);
                          const runStart = pvosRuns.startIdx[i];
                          const runSize  = pvosRuns.runSize[i];
                          if (isMerged && i !== runStart) return null;
                          const nextGroup = flatCols[j + 1]?.group;
                          const isLastOfGroup = !nextGroup || nextGroup.key !== group.key;
                          const isActiveGroup = group.key === activeStageKey;
                          return (
                            <td key={`${col.key}-${j}`}
                              rowSpan={isMerged && runSize > 1 ? runSize : undefined}
                              onClick={(e) => { if (col.editable) e.stopPropagation(); }}
                              className={`px-2 py-1 align-middle whitespace-nowrap ${
                                isLastOfGroup ? "border-r-2 border-ww-borderStrong" : "border-r border-ww-border/60"
                              } last:border-r-0 ${
                                col.editable
                                  ? isActiveGroup ? `${group.tint}` : `${group.tint}/70`
                                  : isActiveGroup ? `${group.tint}/40` : `${group.tint}/15`
                              } ${alignClassFor(col)} ${isNumericFmt(col) ? "tabular-nums font-mono" : ""} ${isMerged ? "font-semibold" : ""}`}>
                              <Cell
                                row={
                                  // RC sem PC herda APROVADO quando bucket inteiro aprovado
                                  (!r.pc_numero && !r.pc_numero_manual && allPcsApproved)
                                    ? { ...r, status: "APROVADO", status_label: STATUS_META.APROVADO?.label ?? "Aprovado" }
                                    : r
                                }
                                col={col} modulo={modulo}
                                optimisticStatus={optimisticStatus}
                                canViewValues={canViewValues}
                                cronogramaMap={cronogramaMap}
                                todayStartMs={todayStartMs}
                                onStatusClick={(anchor) => onStatusClick(selKey, r, anchor)} />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer: AddRowButton sempre visível (com seletor de PV/OS quando bucket
              é projeto); RcExcelDropZone só em modo PV/OS pois precisa de destino único.
              Lista RC (Projeto): só em /projetos com codigo_projeto identificado. */}
          {userCanEdit && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-ww-border bg-ww-bg flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {bucket.groupKind === "pvos" && (
                  <RcExcelDropZone empresa={bucket.rows[0]?.empresa as string ?? "SF"}
                    pv_os_label={bucket.pv_os_label} modulo={modulo} />
                )}
                <AddRowButton empresa={bucket.rows[0]?.empresa as string ?? "SF"}
                  pv_os_label={bucket.groupKind === "pvos" ? bucket.pv_os_label : null}
                  modulo={modulo}
                  pvOsOptions={bucket.groupKind === "pvos" ? undefined : [...new Set(bucket.rows.map(r => String(r.pv_os_label ?? "")).filter(Boolean))]} />
                {/* Botão da lista de materiais foi movido pro header do bucket
                    (mais visível). Upload é feito na sub-página /projetos/:id/materiais. */}
              </div>
              <span className="text-[10px] text-ww-textFaint font-mono">
                {items.length} item(s){bucket.groupKind === "pvos" ? " · upload XLSX preenche linhas em branco primeiro" : ""}
              </span>
            </div>
          )}
          {/* Bloco inline "Itens RC" removido — acesso via sub-página
              /projetos/:codigo/materiais (link no header do bucket). */}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cell — render dinâmico por coluna
// ─────────────────────────────────────────────────────────────────────────

// Colunas que SÓ fazem sentido se a linha tem PC (vinculado natural ou manual).
// Sem PC, não há o que aprovar/calcular — ficam em dash.
const PC_DEPENDENT_KEYS = new Set([
  "status_label",         // Status pill
  "aprovador_email",
  "aprovado_em",
  "valor_aprovado",
  "aprovar_ate_calc",
  "dias_para_aprovar",
  "dif_rc_pc",
  "dif_pct_pc_rc",
  "rc_pc_vs_rc",
  // Logística depende de PC
  "mt_status_fornecimento",
  "mt_data_emissao_nf",
  "mt_data_recebimento_nf",
  "mt_nf_fornecedor",
]);

// v3.11.295: cell da col nova_prev_servicos. Alem da data + link ↗,
// mostra badge "Nx alt" quando ha alteracoes (contador em custom_fields
// ww_nova_prev_alteracoes) e popover com o historico completo (array
// ww_nova_prev_historico) ao clicar no badge.
function NovaPrevServicosCell({
  row, value, format,
}: {
  row: AnyRow;
  value: unknown;
  format?: ColumnFormat;
}) {
  const [open, setOpen] = useState(false);
  const osRaw = String(row.servicos_os_numero ?? "").trim();
  const dateStr = formatCell(value, format);
  const cf = (row.custom_fields as Record<string, unknown> | null) || {};
  const alteracoesRaw = cf["ww_nova_prev_alteracoes"];
  const alteracoes = typeof alteracoesRaw === "number" ? alteracoesRaw : Number(alteracoesRaw) || 0;
  const historicoRaw = cf["ww_nova_prev_historico"];
  const historico: Array<{ data: string | null; em: string; por: string }> =
    Array.isArray(historicoRaw) ? historicoRaw : [];

  // Popover via portal + fixed position — evita clipping por overflow do card.
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPopPos({ top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const popover = open && historico.length > 0 && popPos && typeof document !== "undefined"
    ? createPortal(
        <div ref={popRef}
             style={{ top: popPos.top, left: popPos.left }}
             className="fixed z-[60] min-w-[280px] max-w-[380px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl p-2"
             onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5 px-1">
            Histórico ({historico.length} {historico.length === 1 ? "entrada" : "entradas"})
          </div>
          <ol className="space-y-1 max-h-[280px] overflow-y-auto">
            {[...historico].reverse().map((h, idx, arr) => {
              const posicao = arr.length - idx;
              const isReserva = posicao === 1;
              const dataBR = h.data ? h.data.split("-").reverse().join("/") : "—";
              const emDate = new Date(h.em);
              const emBR = isNaN(emDate.getTime())
                ? "—"
                : `${String(emDate.getDate()).padStart(2, "0")}/${String(emDate.getMonth() + 1).padStart(2, "0")} ${String(emDate.getHours()).padStart(2, "0")}:${String(emDate.getMinutes()).padStart(2, "0")}`;
              return (
                <li key={`${h.em}-${idx}`} className="flex items-start gap-2 px-1 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isReserva ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : h.data == null ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                  }`}>
                    {posicao}
                  </span>
                  <div className="flex-1 min-w-0 text-[11px]">
                    <div className="font-semibold">
                      {isReserva ? "Reserva · " : h.data == null ? "Desvinc. · " : "Alterada · "}
                      <span className="tabular-nums">{dataBR}</span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[10px] truncate" title={`${h.em} · ${h.por}`}>
                      {emBR} · {h.por}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>,
        document.body,
      )
    : null;

  return (
    <span className="inline-flex items-center gap-1.5 relative">
      <span className="text-[12px] text-ww-text">{dateStr}</span>
      {alteracoes > 0 && (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title={`Data prevista alterada ${alteracoes}× — clique pra ver histórico`}
          className="text-[9.5px] font-bold px-1 py-px rounded leading-none whitespace-nowrap bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800"
        >
          {alteracoes}× alt
        </button>
      )}
      {osRaw && (
        <a href={`https://app.waterworks.com.br/ordens-de-servico/${encodeURIComponent(osRaw)}`}
           target="_blank" rel="noopener noreferrer"
           onClick={(e) => e.stopPropagation()}
           title={`Editar agendamento da ${osRaw} no app de serviços`}
           className="text-[10px] text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 font-bold inline-flex items-center border border-blue-300 dark:border-blue-800 rounded px-1 py-px hover:bg-blue-50 dark:hover:bg-blue-950/30 transition">
          ↗
        </a>
      )}
      {popover}
    </span>
  );
}

// Célula editável de nova_prev_materiais com histórico + popover clicável.
// - EditableCell inline (input date, edição direta)
// - Badge "início" (sky) quando não houve renovação — mostra dt_previsao base
// - Badge "×N" (laranja) quando comprador remarcou N vezes
// - Click no badge abre popover com lista cronológica (mais recente em cima)
function NovaPrevMateriaisCell({
  empresa, ncod_ped, modulo, row, field, value,
}: {
  empresa: string;
  ncod_ped: number;
  modulo: "avulsos" | "projetos" | "pcs" | "standby";
  row: AnyRow;
  field: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(false);
  const cf = (row.custom_fields ?? {}) as Record<string, unknown>;
  const histRaw = cf.s4b87bk9_hist;
  const hist: Array<{ v: unknown; at: string }> = Array.isArray(histRaw)
    ? (histRaw as Array<{ v: unknown; at: string }>)
    : [];
  const dtPrev = row.dt_previsao;
  const inicioStr = dtPrev != null && String(dtPrev).trim() !== "" ? formatCell(dtPrev, "date") : null;
  const isRenewed = value != null && String(value).trim() !== "" && String(value) !== String(dtPrev ?? "");
  const renovacoes = hist.length > 0 ? hist.length : (isRenewed ? 1 : 0);

  // Constrói entradas cronológicas pro popover — sempre inclui "início" (do PC).
  // Backfill: rows pré-tracking (hist vazio + isRenewed) ganham 1 entrada
  // sintética com a data atual sem timestamp.
  const entradas: Array<{ tag: string; data: string; em: string | null; tone: "sky" | "orange" | "rose" }> = [];
  if (inicioStr) entradas.push({ tag: "início", data: inicioStr, em: null, tone: "sky" });
  if (hist.length > 0) {
    hist.forEach((h, i) => {
      const d = formatCell(h.v, "date");
      const em = h.at ? new Date(h.at) : null;
      const emStr = em && !isNaN(em.getTime())
        ? `${String(em.getDate()).padStart(2, "0")}/${String(em.getMonth() + 1).padStart(2, "0")}/${em.getFullYear()} ${String(em.getHours()).padStart(2, "0")}:${String(em.getMinutes()).padStart(2, "0")}`
        : null;
      // Tone: se data já venceu, rose; se futura, orange
      const t = h.v ? parseFlexDate(String(h.v)) : null;
      const todayMs = new Date().setHours(0, 0, 0, 0);
      const tone: "orange" | "rose" = t != null && t < todayMs ? "rose" : "orange";
      entradas.push({ tag: `renov. ${i + 1}`, data: d, em: emStr, tone });
    });
  } else if (isRenewed) {
    entradas.push({ tag: "renov. 1", data: formatCell(value, "date"), em: "backfill (sem timestamp)", tone: "orange" });
  }

  let badge: { label: string; tone: string } | null = null;
  if (renovacoes === 0 && inicioStr) {
    badge = { label: "início", tone: "bg-sky-100 text-sky-800 border border-sky-300 hover:bg-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800" };
  } else if (renovacoes > 0) {
    badge = { label: `×${renovacoes}`, tone: "bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-200 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-800" };
  }

  // Quando não há nova prev. registrada, mostra a data original do PC
  // (dt_previsao) no próprio input — assim o comprador vê qual é a data
  // efetiva atual e o badge "início" clarifica que não houve remarcação.
  // Se editar, o save persiste normalmente (DB estava null; vira o novo valor).
  const valueForDisplay = (value != null && String(value).trim() !== "") ? value : (dtPrev ?? null);

  // Popover via portal + posição fixed. Sem isso o card com overflow-hidden
  // (border-radius) recorta a lista de histórico. Reposiciona em resize/scroll.
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPopPos({ top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const popover = open && entradas.length > 0 && popPos && typeof document !== "undefined"
    ? createPortal(
        <div ref={popRef}
             style={{ top: popPos.top, left: popPos.left }}
             className="fixed z-[60] min-w-[260px] max-w-[360px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl p-2"
             onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
              Histórico Prev. Materiais
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
              {renovacoes} renov.
            </div>
          </div>
          <ol className="space-y-1 max-h-[280px] overflow-y-auto">
            {[...entradas].reverse().map((e, idx) => {
              const toneCls =
                e.tone === "sky"    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" :
                e.tone === "orange" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" :
                                      "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
              return (
                <li key={idx} className="flex items-start gap-2 px-1 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tabular-nums ${toneCls}`}>
                    {e.tag}
                  </span>
                  <div className="flex-1 min-w-0 text-[11px]">
                    <div className="font-semibold tabular-nums">{e.data}</div>
                    {e.em && (
                      <div className="text-slate-500 dark:text-slate-400 text-[10px] truncate">
                        alterada em {e.em}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>,
        document.body,
      )
    : null;

  return (
    <span className="inline-flex items-center gap-1.5 relative">
      <EditableCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo}
        field={field} kind="date" initialValue={valueForDisplay} trackHistory />
      {badge && (
        <button type="button" ref={btnRef}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title={renovacoes === 0 ? "Sem renovação — clique pra detalhes" : `Renovada ${renovacoes}× — clique pra histórico`}
          className={`text-[9.5px] font-bold px-1 py-px rounded tabular-nums leading-none whitespace-nowrap cursor-pointer transition ${badge.tone}`}>
          {badge.label}
        </button>
      )}
      {popover}
    </span>
  );
}

function Cell({
  row, col, modulo, onStatusClick, optimisticStatus, canViewValues = true, cronogramaMap, todayStartMs,
}: {
  row: AnyRow;
  col: import("@/lib/columns").Column;
  modulo: "avulsos" | "projetos" | "pcs";
  onStatusClick: (anchor: DOMRect) => void;
  optimisticStatus?: Record<string, string>;
  canViewValues?: boolean;
  cronogramaMap?: Map<string, CronogramaSummary>;
  todayStartMs?: number;
}) {
  const empresa = String(row.empresa ?? "SF");
  const ncod_ped = Number(row.ncod_ped ?? 0);
  const valorPc = row.valor_total != null ? Number(row.valor_total) : null;

  // Colunas virtuais do grupo Cronograma (só /projetos). Dado vem de
  // cronogramaMap (fetch batch em BoldAvulsosView), não do row do view.
  if (col.key === "_cron_status" || col.key === "_cron_next_nome" || col.key === "_cron_next_data") {
    const codProj = Number(row.codigo_projeto ?? row.pv_codigo_projeto ?? 0);
    const key = codProj > 0 ? `${empresa}|${codProj}` : "";
    const s = key && cronogramaMap ? cronogramaMap.get(key) : undefined;
    if (!s || s.total === 0) return <span className="text-ww-textFaint text-[11.5px]">—</span>;
    if (col.key === "_cron_next_nome") {
      return <span className="text-[11.5px] text-ww-text">{s.proxima_nome ?? "—"}</span>;
    }
    if (col.key === "_cron_next_data") {
      if (!s.proxima_data) return <span className="text-ww-textFaint text-[11.5px]">—</span>;
      const [y, m, d] = s.proxima_data.split("-").map(Number);
      const iso = new Date(y, m - 1, d);
      const label = iso.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const isLate = todayStartMs != null && iso.getTime() < todayStartMs;
      return <span className={`text-[11.5px] tabular-nums ${isLate ? "text-rose-700 font-semibold" : "text-ww-text"}`}>{label}</span>;
    }
    // _cron_status: badge com tom (verde/amarelo/vermelho)
    const done = s.concluidas >= s.total;
    const late = s.atrasadas > 0;
    const tone = done ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                : late ? "bg-rose-100 text-rose-800 border-rose-300"
                : "bg-amber-100 text-amber-800 border-amber-300";
    const label = done ? `✓ ${s.total}/${s.total}` : late ? `⚠ ${s.atrasadas} atrasada${s.atrasadas > 1 ? "s" : ""}` : `${s.concluidas}/${s.total}`;
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
  }
  // Aplica optimistic update no status (antes do server confirmar)
  const optimisticKey = `${empresa}|${ncod_ped}`;
  const overrideStatus = optimisticStatus?.[optimisticKey];
  const effectiveRow = overrideStatus
    ? { ...row, status: overrideStatus, status_label: STATUS_META[overrideStatus]?.label ?? overrideStatus }
    : row;
  const value = effectiveRow[col.key];

  // Sem PC vinculado → bloqueia colunas que dependem de PC
  const hasPC = Boolean(row.pc_numero || row.pc_numero_manual);
  if (!hasPC && PC_DEPENDENT_KEYS.has(col.key)) {
    return <span className="text-ww-textFaint text-[11.5px]">—</span>;
  }

  // Status pill clicável (popover)
  if (col.format === "status") {
    return (
      <BoldStatusButton row={effectiveRow}
        onClick={(e) => { e.stopPropagation(); onStatusClick(e.currentTarget.getBoundingClientRect()); }} />
    );
  }

  // Editável: usa EditableCell ou EditableStatusCell
  if (col.editable && col.editableField) {
    if (col.editable === "status") {
      return (
        <EditableStatusCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo}
          current={String(overrideStatus ?? value ?? "PENDENTE")} valorPc={valorPc} />
      );
    }
    // V.Nova Prev. Serviços: prefixo 🔗 quando a data veio do app de serviços
    // (heurística: existe servicos_os_numero → o waterworks-app gravou via attach-os
    // ou patch service-orders. Sem servicos_os_numero, presume edição manual no painel).
    if (col.key === "nova_prev_servicos" && row.servicos_os_numero) {
      return (
        <span className="inline-flex items-center gap-1" title="Data sincronizada do app de serviços (vinculada à OS)">
          <span className="text-blue-600 text-[12px]">🔗</span>
          <EditableCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo}
            field={col.editableField} kind={col.editable as "date" | "text" | "number" | "money" | "textarea"}
            initialValue={value} />
        </span>
      );
    }
    // Sinalização de PC incompleto no Omie: ⚠ ao lado do PC# editável
    if (col.key === "pc_numero" && value) {
      const valorTot = (row.valor_total as number | null) ?? null;
      const codFor = (row.codigo_fornecedor as number | null) ?? null;
      const incompleto = (valorTot == null || valorTot === 0) || (codFor == null || codFor === 0);
      return (
        <div className="inline-flex items-center gap-1">
          <EditableCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo}
            field={col.editableField} kind={col.editable as "date" | "text" | "number" | "money" | "textarea"}
            initialValue={value} />
          {incompleto && (
            <span title="Dados incompletos no Omie (sem valor ou fornecedor) — corrija no Omie e aguarde próximo sync"
              className="text-amber-600 dark:text-amber-400 text-[14px] cursor-help">⚠</span>
          )}
        </div>
      );
    }
    // Nova Prev. Materiais — coluna com histórico. Renderização isolada em
    // componente próprio pra manter estado do popover local à célula.
    // Sem PC = nada pra receber → não faz sentido editar prev. de material.
    if (col.key === "nova_prev_materiais") {
      const hasPc = !!(row.pc_numero || row.pc_numero_manual);
      if (!hasPc) return <span className="text-ww-textFaint">—</span>;
      return (
        <NovaPrevMateriaisCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo} row={row}
          field={col.editableField as string} value={value} />
      );
    }
    return (
      <EditableCell empresa={empresa} ncod_ped={ncod_ped} modulo={modulo}
        field={col.editableField} kind={col.editable as "date" | "text" | "number" | "money" | "textarea"}
        initialValue={value} />
    );
  }

  // Read-only: formatCell. Sinaliza valor=null/0 ou fornecedor=null/0 quando há PC#
  if ((col.key === "valor_total" || col.key === "nome_fornecedor" || col.key === "contato_fornecedor")
      && (row.pc_numero || row.pc_numero_manual)) {
    const isMissingValor = col.key === "valor_total" && (value == null || value === 0);
    const isMissingForn = (col.key === "nome_fornecedor" || col.key === "contato_fornecedor")
      && (value == null || value === "" || row.codigo_fornecedor === 0 || row.codigo_fornecedor == null);
    if (isMissingValor || isMissingForn) {
      return (
        <span title="Não preenchido no Omie — corrija no ERP" className="text-amber-700 dark:text-amber-400 text-[12px] inline-flex items-center gap-1">
          ⚠ <span className="opacity-70">faltando</span>
        </span>
      );
    }
  }

  // 🔗 Link Serviços — 3 estados:
  //   • sem OS                                                  → —
  //   • OS populada + servicos_concluidos=FALSE → 🕓 OS-N "Agendado"
  //   • OS populada + servicos_concluidos=TRUE  → ✅ OS-N + data abaixo
  // (rowspan via MERGED_KEYS no caller; trigger no DB garante todas rows do bucket terem mesmo valor)
  if (col.key === "servicos_concluidos") {
    const osRaw = String(row.servicos_os_numero ?? "").trim();
    if (!osRaw) return <span className="text-ww-textFaint">—</span>;
    const osNum = osRaw.replace(/-/g, "");                  // "OS-1058" → "OS1058"
    // service_id no waterworks-app preserva o prefixo "OS" (a rota
    // /ordens-de-servico/[id] aceita UUID ou service_id text exato).
    const osPath = encodeURIComponent(osRaw);
    const concluido = !!row.servicos_concluidos;
    const dtRaw = row.servicos_concluidos_em as string | null;
    const dtCurta = dtRaw ? new Date(dtRaw).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    }) : "";
    const dtLonga = dtRaw ? new Date(dtRaw).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) : "";
    const por = row.servicos_concluidos_por ? ` por ${row.servicos_concluidos_por}` : "";
    const tooltip = concluido
      ? `Concluído em ${dtLonga}${por}`
      : "Agendado (ainda não foi executado)";
    return (
      <span className="inline-flex flex-col items-start gap-0.5 text-[12px] leading-tight" title={tooltip}>
        <span className="inline-flex items-center gap-1">
          <span className={concluido ? "text-emerald-600" : "text-amber-600"}>
            {concluido ? "✅" : "🕓"}
          </span>
          <a href={`https://app.waterworks.com.br/ordens-de-servico/${osPath}`}
             target="_blank" rel="noopener noreferrer"
             onClick={(e) => e.stopPropagation()}
             className="font-mono text-[11px] text-blue-700 hover:underline">{osNum}</a>
        </span>
        {concluido
          ? dtCurta && <span className="text-[10px] text-ww-textMuted font-mono">{dtCurta}</span>
          : <span className="text-[10px] text-amber-700 dark:text-amber-400 italic">Agendado</span>
        }
      </span>
    );
  }

  // Previsão PC (dt_previsao): mostra data + badge de status agregando
  // material recebido / no prazo / remarcado / atrasado. Ignora rows sem PC.
  if (col.key === "dt_previsao" && (row.pc_numero || row.pc_numero_manual)) {
    const dateStr = formatCell(value, col.format);
    const today = new Date().setHours(0, 0, 0, 0);
    const origS = String(value ?? "").trim();
    const origMs = origS ? parseFlexDate(origS) : null;
    const novaS = String(row.nova_prev_materiais ?? "").trim();
    const novaMs = novaS ? parseFlexDate(novaS) : null;
    let badge: { label: string; tone: string } | null = null;
    if (row.mt_data_recebimento_nf) {
      badge = { label: "✓ recebido", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200" };
    } else if (origMs != null) {
      const efetivaMs = novaMs ?? origMs;
      if (efetivaMs < today) {
        const dias = Math.floor((today - efetivaMs) / 86400000);
        badge = { label: `${dias}d atraso`, tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200 border border-rose-300 dark:border-rose-800" };
      } else if (novaMs != null && origMs < today) {
        badge = { label: "remarcado", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 border border-amber-300 dark:border-amber-800" };
      } else if (origMs >= today) {
        badge = { label: "no prazo", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800" };
      }
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[12px] text-ww-text">{dateStr}</span>
        {badge && (
          <span className={`text-[9.5px] font-bold px-1 py-px rounded tabular-nums leading-none whitespace-nowrap ${badge.tone}`}>
            {badge.label}
          </span>
        )}
      </span>
    );
  }

  // v3.11.304 (waterworks-app): coluna Status OS — badge lendo
  // ww_os_status + ww_pode_faturar dos custom_fields. WW sincroniza toda vez
  // que status muda (reservar-parcial, PATCH OS, pode-faturar, desvincular).
  if (col.key === "os_status_bucket") {
    const cf = (row.custom_fields as Record<string, unknown> | null) || {};
    const osStatus = (cf["ww_os_status"] as string | null) || null;
    const podeFaturar = cf["ww_pode_faturar"] === true;
    const osRaw = String(row.servicos_os_numero ?? "").trim();
    if (!osStatus && !osRaw) return <span className="text-ww-textFaint text-[11px]">—</span>;
    let label = osStatus || "Sem OS";
    let cls = "bg-slate-100 text-slate-700 border-slate-200";
    if (osStatus === "Cancelada") {
      cls = "bg-red-100 text-red-700 border-red-200";
    } else if (osStatus === "Concluída") {
      label = podeFaturar ? "Pode Faturar" : "OS Pendente";
      cls = podeFaturar
        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
        : "bg-amber-100 text-amber-800 border-amber-300";
    } else if (osStatus === "Em Execução") {
      cls = "bg-blue-100 text-blue-700 border-blue-200";
    } else if (osStatus === "Aberta") {
      cls = "bg-sky-100 text-sky-700 border-sky-200";
    } else if (osStatus === "Parcial") {
      cls = "bg-yellow-100 text-yellow-800 border-yellow-300";
    }
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold border ${cls}`}>
        {label}
      </span>
    );
  }

  // V.Nova Prev. Serviços: read-only + ícone ↗ pra abrir a OS no waterworks.
  // Edição acontece lá (fonte da verdade); painel só mostra + link direto.
  // v3.11.295: badge violeta "Nx alt" com popover de historico completo.
  if (col.key === "nova_prev_servicos") {
    return <NovaPrevServicosCell row={row} value={value} format={col.format} />;
  }

  return <span className={col.format === "mono" ? "font-mono text-[12px]" : "text-[12px] text-ww-text"}>
    {formatCell(value, col.format, { canViewValues })}
  </span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────

// Pipeline ternário — cada stage tem 3 estados possíveis:
//   🟢 green: tudo ok, condição terminal atendida
//   🟡 yellow: parcial, incompleto ou pendente de ação
//   🔴 red: bloqueado, atraso ou sem dado
// Cor + shadow refletem o estado. Linha conectora usa cor do próximo stage.
const STAGE_STATE_STYLE = {
  green:  { dot: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]",  label: "text-ww-text",       line: "bg-emerald-400" },
  yellow: { dot: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]",     label: "text-ww-text",       line: "bg-amber-400" },
  red:    { dot: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.25)]",       label: "text-ww-textMuted", line: "bg-rose-400" },
  // "off" — stage não se aplica ao tipo (ex: RC/PC em PV/OS 100% Serviços).
  // Bolinha cinza pequena + linha cinza. Sem badge de desvio.
  off:    { dot: "bg-slate-300 dark:bg-slate-600 opacity-70",                 label: "text-ww-textFaint",  line: "bg-slate-300 dark:bg-slate-700" },
} as const;

type StageDev = { value: number; suffix: string; tone: "red" | "amber" | "green" } | null;

const DEV_TONE = {
  red:   "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 border border-rose-300 dark:border-rose-800",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-800",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800",
} as const;

function Pipeline({
  stages, onStageClick, activeGroupKey,
}: {
  stages: { label: string; state: "green" | "yellow" | "red" | "off"; detail: string; groupKey: string; dev?: StageDev }[];
  onStageClick?: (groupKey: string) => void;
  activeGroupKey?: string | null;
}) {
  return (
    <div className="flex items-start">
      {stages.map((s, i) => {
        const cur = STAGE_STATE_STYLE[s.state];
        const isActive = activeGroupKey === s.groupKey;
        const dev = s.dev;
        return (
          <div key={s.label} className="flex items-start contents">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStageClick?.(s.groupKey); }}
              title={`${s.label} — ${s.detail}`}
              aria-pressed={isActive}
              className={`flex-1 flex flex-col items-center gap-0.5 min-w-0 group cursor-pointer rounded-md px-1 py-0.5 transition ${
                isActive ? "bg-sky-100 dark:bg-sky-950/40 ring-1 ring-sky-400 dark:ring-sky-600" : ""
              }`}>
              {/* Badge de desvio — reservado slot fixo (altura 12px) pra alinhar
                  dots no mesmo eixo. Sem dev = espaço invisível. */}
              <span className="h-[13px] flex items-center justify-center">
                {dev && (
                  <span className={`text-[9px] font-bold px-1 py-px rounded tabular-nums leading-none whitespace-nowrap ${DEV_TONE[dev.tone]}`}>
                    {dev.value > 0 ? "+" : ""}{dev.value}{dev.suffix}
                  </span>
                )}
              </span>
              <span className={`w-2.5 h-2.5 rounded-full inline-block z-10 transition-all group-hover:scale-125 ${cur.dot} ${
                isActive ? "scale-150 ring-2 ring-offset-1 ring-sky-500 dark:ring-sky-400" : ""
              }`} />
              <span className={`text-[10px] font-semibold uppercase tracking-[0.5px] mt-1.5 transition ${
                isActive ? "text-sky-800 dark:text-sky-200" : cur.label
              } group-hover:text-sky-700 dark:group-hover:text-sky-400`}>{s.label}</span>
              <span className="text-[10px] text-ww-textFaint text-center truncate max-w-full px-0.5">{s.detail}</span>
            </button>
            {i < stages.length - 1 && (
              <div className={`w-6 ${STAGE_STATE_STYLE[stages[i + 1].state].line}`} style={{ height: 1.5, marginTop: 19 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RelatorioMenu — dropdown com atalhos pras 4 ações do daily report Avulsos
// direto de /avulsos: Preview, PDF, Snapshot e Enviar ao Webex.
// ─────────────────────────────────────────────────────────────────────────

function RelatorioMenu() {
  const [busy, setBusy] = useState<null | "webex">(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  async function enviarWebex() {
    setBusy("webex");
    try {
      const r = await fetch("/api/relatorios/avulsos-daily", { cache: "no-store" });
      if (!r.ok) throw new Error("falha ao ler report");
      const data = await r.json();
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
      const lines: string[] = [`### 📊 Report Avulsos — ${dd}/${mm}`, ""];
      type Sec = { title: string; emoji: string; items: { label: string; count: number; val: number; owner: string; link: string; delta_count: number | null }[] };
      for (const sec of data.sections as Sec[]) {
        lines.push(`**${sec.emoji} ${sec.title}**`);
        for (const it of sec.items) {
          const delta = it.delta_count == null ? "" : it.delta_count > 0 ? ` (📈 +${it.delta_count})` : it.delta_count < 0 ? ` (📉 ${it.delta_count})` : ` (=)`;
          const val = it.val > 0 ? ` · ${fmt(it.val)}` : "";
          lines.push(`- ${it.label}: **${it.count}**${val}${delta} · [ver](${it.link}) — ${it.owner}`);
        }
        lines.push("");
      }
      lines.push(`_Total PVs abertos: ${data.total_pvs}_`);
      const markdown = lines.join("\n");
      const send = await fetch("/api/relatorios/avulsos-daily/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const sj = await send.json();
      if (!send.ok) throw new Error(sj.error ?? send.statusText);
      setFlash({ tone: "ok", msg: "Enviado ao Webex" });
    } catch (e) {
      setFlash({ tone: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  return (
    <div className="ml-auto inline-flex items-center gap-2 pl-3 border-l border-ww-border relative">
      <span className="text-[10px] uppercase tracking-[0.5px] font-bold text-ww-textFaint">Report</span>
      <a href="/api/relatorios/avulsos-daily/pdf" download
         title="Baixar PDF completo do report (gráfico + todas as seções + listas de PVs)"
         className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition">
        📄 <span>PDF</span>
      </a>
      <a href="/relatorios/avulsos-daily" target="_blank" rel="noopener"
         title="Abre a página do report (chart + tabelas por alarme)"
         className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition">
        📊 <span>Report</span>
      </a>
      <button type="button" onClick={enviarWebex} disabled={busy != null}
         title="Enviar report atualizado ao Webex agora (canal configurado)"
         className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 transition">
        📤 <span>{busy === "webex" ? "Enviando…" : "Webex"}</span>
      </button>
      {flash && (
        <div className={`absolute right-0 top-full mt-1 z-50 px-2 py-1 rounded-md text-[11px] font-semibold shadow-md whitespace-nowrap ${
          flash.tone === "ok"
            ? "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800"
            : "bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800"
        }`}>
          {flash.tone === "ok" ? "✓ " : "✗ "}{flash.msg}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DateRangeButton — dropdown com presets (Hoje / 3d / 7d / 30d) + custom
// ─────────────────────────────────────────────────────────────────────────

function DateRangeButton({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.from ?? "");
  const [customTo, setCustomTo]     = useState(range.to ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = range.kind !== "off";
  const label = range.kind === "custom"
    ? (range.from && range.to ? `${range.from} → ${range.to}` : "Personalizado")
    : DATE_RANGE_LABELS[range.kind];

  function pick(kind: DateRangeKind) {
    if (kind === "custom") {
      const r: DateRange = { kind: "custom", from: customFrom || undefined, to: customTo || undefined };
      onChange(r);
    } else {
      onChange({ kind });
    }
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Filtrar por período de criação no Omie"
        className={`flex items-center gap-1.5 text-[11.5px] font-semibold rounded-md border px-2 py-1 transition ${
          active
            ? "bg-amber-500 dark:bg-amber-400 border-amber-700 dark:border-amber-200 text-white dark:text-amber-950 shadow-sm"
            : "bg-ww-bg border-ww-border text-ww-textMuted hover:text-ww-text hover:border-ww-borderStrong"
        }`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        <span>{label}</span>
        <span className="text-[8px] opacity-70">▼</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 right-0 w-[260px] bg-ww-panel border border-ww-border rounded-lg shadow-xl overflow-hidden">
          <div className="py-1">
            {(["off", "today", "3d", "7d", "30d"] as DateRangeKind[]).map((k) => (
              <button key={k} onClick={() => pick(k)}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between transition ${
                  range.kind === k ? "bg-ww-accentSoft text-ww-accent font-semibold" : "text-ww-text hover:bg-ww-rowHover"
                }`}>
                <span>{DATE_RANGE_LABELS[k]}</span>
                {range.kind === k && <span className="text-[10px]">✓</span>}
              </button>
            ))}
          </div>
          <div className="border-t border-ww-border px-3 py-2 space-y-1.5 bg-ww-bg">
            <div className="text-[10px] uppercase tracking-wider font-bold text-ww-textMuted">Personalizado</div>
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="flex-1 text-[11.5px] bg-ww-panel border border-ww-border rounded px-1.5 py-1 text-ww-text" />
              <span className="text-[10px] text-ww-textFaint">→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="flex-1 text-[11.5px] bg-ww-panel border border-ww-border rounded px-1.5 py-1 text-ww-text" />
            </div>
            <button onClick={() => pick("custom")}
              className="w-full text-[11px] font-semibold py-1 mt-1 bg-ww-accent text-white dark:text-[#0a1812] rounded hover:opacity-90 transition">
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AtrasoButton — toggle pra Atraso Venda ou Atraso Compra
// ─────────────────────────────────────────────────────────────────────────

// AlarmesPanel — botão único "Alarmes N" que abre popup com as 5 tags coloridas
// (Vendas/Compras/Aprovações/Serviços/Faturamento). Cada tag mostra contagem +
// pode ser expandida pra revelar os alarmes individuais com checkbox. Substituiu
// os 5 pills separados em v1.4.25 — muito menos click pro operador achar o que
// quer. Click no ▸ da tag: expande accordion. Click no corpo da tag: toggle-all
// (liga/desliga todos os alarmes daquele grupo de uma vez).
function AlarmesPanel({
  alarmes, counts, onToggle, onToggleGroup, onClearAll, canViewValues = true,
}: {
  alarmes: Set<AlarmKind>;
  counts: Record<AlarmKind, { count: number; val: number }>;
  onToggle: (k: AlarmKind) => void;
  onToggleGroup: (kinds: AlarmKind[]) => void;
  onClearAll: () => void;
  canViewValues?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const totalActive = alarmes.size;
  const totalPending = ALARM_GROUPS.reduce(
    (acc, g) => acc + g.kinds.reduce((s, k) => s + counts[k].count, 0),
    0,
  );

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  }

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button onClick={() => setOpen((v) => !v)}
        title={`Alarmes Ativos — ${totalPending} PV/OS aberto(s) com pendência${totalActive > 0 ? ` · ${totalActive} filtro(s) ativo(s)` : ""}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold border transition ${
          totalActive > 0 || open
            ? "bg-rose-600 dark:bg-rose-500 border-rose-800 dark:border-rose-300 text-white shadow-sm"
            : "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 hover:border-rose-400"
        }`}>
        <IconAlert />
        <span>Alarmes Ativos</span>
        {totalPending > 0 && (
          <span className={`tabular-nums text-[10.5px] font-bold px-1 rounded ${
            totalActive > 0 || open ? "bg-white/25 text-white" : "bg-rose-200/70 dark:bg-rose-800/40 text-rose-900 dark:text-rose-100"
          }`}>{totalPending}</span>
        )}
        {totalActive > 0 && (
          <span className="bg-white/90 text-rose-800 rounded-full px-1.5 text-[9.5px] font-black tabular-nums">
            {totalActive} sel
          </span>
        )}
        <span className="text-[9px] opacity-80">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-40 top-full left-0 mt-1 w-[420px] max-h-[600px] overflow-auto bg-ww-panel border border-ww-border rounded-lg shadow-xl">
          <div className="flex items-center justify-between p-3 border-b border-ww-border sticky top-0 bg-ww-panel z-10">
            <div className="text-[12px] uppercase tracking-[0.6px] font-bold text-ww-textMuted flex items-center gap-1.5">
              <IconAlert /> Alarmes Ativos
              <span className="text-ww-text normal-case tracking-normal">
                · <span className="tabular-nums">{totalPending}</span> PV abertos
              </span>
              {totalActive > 0 && (
                <span className="text-rose-700 dark:text-rose-300 normal-case tracking-normal">
                  · <span className="tabular-nums">{totalActive}</span> sel.
                </span>
              )}
            </div>
            {totalActive > 0 && (
              <button onClick={onClearAll}
                className="text-[10.5px] font-semibold text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 uppercase tracking-wider">
                limpar
              </button>
            )}
          </div>
          <div className="p-2 space-y-1.5">
            {ALARM_GROUPS.map((g) => {
              const cfg     = ACCENT_MAP[g.accent];
              const total   = g.kinds.reduce((acc, k) => acc + counts[k].count, 0);
              const totalV  = g.kinds.reduce((acc, k) => acc + counts[k].val, 0);
              const active  = g.kinds.filter((k) => alarmes.has(k)).length;
              const isOpen  = expanded.has(g.key);
              const anyOn   = active > 0;
              const someOn  = anyOn && active < g.kinds.length;
              const allOn   = active === g.kinds.length;
              return (
                <div key={g.key} className={`rounded-md border ${cfg.border} overflow-hidden`}>
                  {/* Header da tag — click no corpo TOGGLE ALL do grupo; ▸ à direita expande accordion */}
                  <div className={`flex items-center gap-2 px-2.5 py-2 ${anyOn ? cfg.selectedBg : cfg.panelBg}`}>
                    <button onClick={() => onToggleGroup(g.kinds)}
                      title={allOn ? "Desligar todos deste grupo" : "Ligar todos deste grupo"}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <span className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0 ${
                        allOn ? `${cfg.bar} border-transparent text-white` :
                        someOn ? `${cfg.bar} border-transparent text-white` :
                                 "border-ww-borderStrong bg-ww-bg"
                      }`}>
                        {allOn && <span className="text-[11px] font-bold leading-none">✓</span>}
                        {someOn && <span className="text-[10px] font-bold leading-none">−</span>}
                      </span>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <IconAlert />
                      <span className={`text-[13px] font-bold ${cfg.selectedText}`}>{g.label}</span>
                    </button>
                    <span className={`text-[11px] tabular-nums font-semibold shrink-0 ${cfg.selectedText}`}>
                      {total}
                    </span>
                    <span className={`text-[12px] tabular-nums font-bold shrink-0 min-w-[80px] text-right ${cfg.selectedText}`}>
                      {gateBRL(totalV, canViewValues)}
                    </span>
                    <button onClick={() => toggleExpand(g.key)}
                      title={isOpen ? "Recolher" : "Ver alarmes deste grupo"}
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${cfg.selectedText} opacity-70 hover:opacity-100`}>
                      {isOpen ? "▲" : "▸"}
                    </button>
                  </div>
                  {/* Accordion: alarmes individuais do grupo com checkbox */}
                  {isOpen && (
                    <div className={`${cfg.panelBg} border-t ${cfg.border}`}>
                      {g.kinds.map((kind) => {
                        const acfg = ALARM_CFG[kind];
                        const c    = counts[kind];
                        const kOn  = alarmes.has(kind);
                        const dim  = c.count === 0;
                        return (
                          <button key={kind} onClick={() => onToggle(kind)}
                            title={acfg.hint}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition ${
                              kOn ? `${cfg.selectedBg}` : cfg.hover
                            } ${dim ? "opacity-60" : ""}`}>
                            <span className={`w-3.5 h-3.5 rounded-sm border-2 flex items-center justify-center shrink-0 ${
                              kOn ? `${cfg.bar} border-transparent text-white` : "border-ww-borderStrong bg-ww-bg"
                            }`}>
                              {kOn && <span className="text-[10px] font-bold leading-none">✓</span>}
                            </span>
                            <span className={`text-[12px] flex-1 min-w-0 truncate ${kOn ? `font-bold ${cfg.selectedText}` : "font-medium text-ww-text"}`}>
                              {acfg.label}
                            </span>
                            <span className="text-[10.5px] tabular-nums text-ww-textMuted font-medium shrink-0">{fmtNum(c.count)}</span>
                            <span className={`text-[11.5px] tabular-nums font-semibold shrink-0 min-w-[75px] text-right ${kOn ? cfg.selectedText : "text-ww-text"}`}>{gateBRL(c.val, canViewValues)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[10.5px] italic px-3 py-2 border-t border-ww-border bg-ww-panel text-ww-textFaint">
            Click no corpo da tag pra ligar/desligar tudo do grupo. Click no ▸ pra ver os alarmes um a um.
          </div>
        </div>
      )}
    </div>
  );
}

// AlarmGroupDropdown — botão compacto por GRUPO de alarme (Vendas/Compras/etc).
// Cada grupo tem sua cor (ACCENT_MAP) e abre popup com só os alarmes desse grupo.
// União global entre grupos: selecionar Compra+Aprovação = mostra rows que match
// qualquer um. Substituiu o AlarmesDropdown único em v1.4.19.
function AlarmGroupDropdown({
  group, alarmes, counts, activeCount, groupCount, groupVal, onToggle, onClearGroup, canViewValues = true,
}: {
  group: { key: string; label: string; accent: AccentKey; kinds: AlarmKind[] };
  alarmes: Set<AlarmKind>;
  counts: Record<AlarmKind, { count: number; val: number }>;
  activeCount: number;
  groupCount: number;
  groupVal: number;
  onToggle: (k: AlarmKind) => void;
  onClearGroup: () => void;
  canViewValues?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const cfg = ACCENT_MAP[group.accent];
  const on = activeCount > 0;
  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button onClick={() => setOpen((v) => !v)}
        title={`Alarmes de ${group.label}${groupCount > 0 ? ` — ${groupCount} PV/OS pendentes` : ""}`}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border transition ${
          on || open
            ? `${cfg.selectedBg} ${cfg.border} ${cfg.selectedText} shadow-sm`
            : `${cfg.panelBg} ${cfg.border} ${cfg.selectedText} hover:opacity-90`
        }`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        <IconAlert />
        <span>{group.label}</span>
        {groupCount > 0 && (
          <span className="tabular-nums text-[10px] font-bold opacity-80">{groupCount}</span>
        )}
        {activeCount > 0 && (
          <span className={`ml-0.5 bg-white/90 text-slate-900 dark:bg-black/40 dark:text-white rounded-full px-1.5 text-[9px] font-bold tabular-nums`}>
            {activeCount}
          </span>
        )}
        <span className="text-[8px] opacity-70">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`absolute z-40 top-full right-0 mt-1 w-[340px] max-h-[520px] overflow-auto rounded-lg shadow-xl border ${cfg.border}`}>
          <div className={`flex items-center justify-between px-3 py-2 border-b border-ww-border/60 ${cfg.headerBg}`}>
            <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-[0.6px] font-bold ${cfg.selectedText}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              <IconAlert /> {group.label}
              <span className="opacity-70 normal-case tracking-normal font-medium">({activeCount} sel.)</span>
            </div>
            {activeCount > 0 && (
              <button onClick={onClearGroup}
                className={`text-[10px] font-semibold ${cfg.selectedText} opacity-70 hover:opacity-100 uppercase tracking-wider`}>
                limpar
              </button>
            )}
          </div>
          <div className={cfg.panelBg}>
            {group.kinds.map((kind) => {
              const acfg = ALARM_CFG[kind];
              const c    = counts[kind];
              const kOn  = alarmes.has(kind);
              const dim  = c.count === 0;
              return (
                <button key={kind} onClick={() => onToggle(kind)}
                  title={acfg.hint}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition ${
                    kOn ? `${cfg.selectedBg} ring-1 ${cfg.border} ring-inset` : cfg.hover
                  } ${dim ? "opacity-60" : ""}`}>
                  <span className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0 ${
                    kOn ? `${cfg.bar} border-transparent text-white` : "border-ww-borderStrong bg-ww-bg"
                  }`}>
                    {kOn && <span className="text-[11px] font-bold leading-none">✓</span>}
                  </span>
                  <span className="text-[14px] shrink-0">{acfg.icon}</span>
                  <span className={`text-[13px] flex-1 min-w-0 truncate ${kOn ? `font-bold ${cfg.selectedText}` : "font-medium text-ww-text"}`}>
                    {acfg.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-ww-textMuted font-medium shrink-0">{fmtNum(c.count)}</span>
                  <span className={`text-[12px] tabular-nums font-semibold shrink-0 min-w-[85px] text-right ${kOn ? cfg.selectedText : "text-ww-text"}`}>{gateBRL(c.val, canViewValues)}</span>
                </button>
              );
            })}
          </div>
          {groupVal > 0 && (
            <div className={`text-[10.5px] italic px-3 py-1.5 border-t border-ww-border ${cfg.panelBg} ${cfg.selectedText} opacity-80`}>
              Total do grupo: {gateBRL(groupVal, canViewValues)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// AlarmesDropdown — botão compacto que abre popup multi-select com os alarmes.
// Substitui os 11 pills expandidos: economiza espaço na filter bar e escala
// bem se adicionar mais alarmes depois. Também inclui shortcut pro relatório.
// LEGADO — substituído por 5 AlarmGroupDropdown em v1.4.19. Mantido pra rollback.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AlarmesDropdown({
  alarmes, counts, onToggle, onClearAll, reportHref,
}: {
  alarmes: Set<AlarmKind>;
  counts: Record<AlarmKind, { count: number; val: number }>;
  onToggle: (k: AlarmKind) => void;
  onClearAll: () => void;
  reportHref: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const activeCount = alarmes.size;
  return (
    <div ref={ref} className="relative inline-flex items-center gap-1.5">
      <button onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition ${
          activeCount > 0 || open
            ? "bg-rose-600 dark:bg-rose-500 border-rose-800 dark:border-rose-300 text-white shadow-sm"
            : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 hover:border-rose-400"
        }`}>
        <IconAlert />
        <span>Alarmes Ativos</span>
        {activeCount > 0 && (
          <span className="bg-white/25 text-white rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            {activeCount}
          </span>
        )}
        <span className="text-[9px] opacity-80">{open ? "▲" : "▼"}</span>
      </button>
      <a href={reportHref} target="_blank" rel="noopener"
        title="Ver relatório diário (Webex + PDF)"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted hover:text-ww-text transition">
        📄 <span>Relatório</span>
      </a>
      {open && (
        <div className="absolute z-40 top-full right-0 mt-1 w-[440px] max-h-[560px] overflow-auto bg-ww-panel border border-ww-border rounded-lg shadow-xl">
          <div className="flex items-center justify-between p-3 border-b border-ww-border sticky top-0 bg-ww-panel z-10">
            <div className="text-[11.5px] uppercase tracking-[0.6px] font-bold text-ww-textMuted flex items-center gap-1.5">
              <IconAlert /> Alarmes <span className="text-ww-text">({activeCount} sel.)</span>
            </div>
            {activeCount > 0 && (
              <button onClick={onClearAll}
                className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-100 uppercase tracking-wider">
                limpar
              </button>
            )}
          </div>
          {ALARM_GROUPS.map((g) => {
            const cfg = ACCENT_MAP[g.accent];
            return (
              <div key={g.key} className={`${cfg.panelBg} border-b border-ww-border/50 last:border-b-0`}>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className={`text-[10.5px] uppercase tracking-[0.6px] font-bold ${cfg.selectedText}`}>{g.label}</span>
                </div>
                <div className="pb-1.5">
                  {g.kinds.map((kind) => {
                    const acfg = ALARM_CFG[kind];
                    const c    = counts[kind];
                    const on   = alarmes.has(kind);
                    const dim  = c.count === 0;
                    return (
                      <button key={kind} onClick={() => onToggle(kind)}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition ${
                          on ? `${cfg.selectedBg} ring-1 ${cfg.border} ring-inset` : cfg.hover
                        } ${dim ? "opacity-60" : ""}`}>
                        <span className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0 ${
                          on ? `${cfg.bar} border-transparent text-white` : "border-ww-borderStrong bg-ww-bg"
                        }`}>
                          {on && <span className="text-[11px] font-bold leading-none">✓</span>}
                        </span>
                        <span className="text-[14px] shrink-0">{acfg.icon}</span>
                        <span className={`text-[13.5px] flex-1 min-w-0 truncate ${on ? `font-bold ${cfg.selectedText}` : "font-medium text-ww-text"}`}>
                          {acfg.label}
                        </span>
                        <span className="text-[11.5px] tabular-nums text-ww-textMuted font-medium shrink-0">{fmtNum(c.count)}</span>
                        <span className={`text-[12.5px] tabular-nums font-semibold shrink-0 min-w-[85px] text-right ${on ? cfg.selectedText : "text-ww-text"}`}>{fmtBRL(c.val)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="text-[10.5px] text-ww-textFaint italic px-3 py-2 border-t border-ww-border bg-ww-panel">
            Multi-select: PV/OS entra na tabela se match ≥ 1 alarme selecionado (união entre grupos).
          </div>
        </div>
      )}
    </div>
  );
}

// AlarmePill — chip rose ("alarme") pra 1 dos 7 tipos de alarme na filter bar.
// Ícone + label + count + valor R$. Estado ativo preenche o pill (bg mais forte).
// Legado — mantido pra referência, não mais renderizado após v1.4.15.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// Todos os alarmes usam o mesmo ícone (triângulo com exclamação — vocabulário
// visual de "alarme"). Distinção entre alarmes vem da cor do grupo, não do
// ícone. Usuário pediu explicitamente: nada de nota fiscal, calendário,
// ampulheta, dinheiro etc — mistura visual quebra a leitura como alarme.
const ALARM_ICON = "⚠";
// Labels curtos usados nos minitags de cada bucket — precisam caber num pill
// pequeno mas deixar claro o problema (não o grupo). "Aprov. pendente" > "Aprovações".
const ALARM_SHORT_LABEL: Record<AlarmKind, string> = {
  pvos_incompl: "PV/OS incompleta",
  sem_projeto:  "Sem Projeto",
  venda:        "Venda atrasada",
  compra:       "Previsão atrasada",
  sem_rc:       "RC ausente/incompl.",
  sem_pc:       "PC ausente/incompl.",
  aprov_bloq:   "Bloqueado",
  aprov_pend:   "Aprov. pend.",
  defas_omie:   "Defas. Omie",
  sem_vinculo:  "Sem Vínculo",
  agend_vazio:  "Sem Previsão",
  agend_venc:   "Prev. vencida",
  pode_faturar: "Faturável",
};
const ALARM_CFG: Record<AlarmKind, { label: string; icon: string; hint: string }> = {
  pvos_incompl: { label: "PV/OS incompleta",      icon: ALARM_ICON, hint: "Cadastro do PV/OS falta dado essencial (tipo, cliente ou V.Previsão Limite_Omie). Reflete o dot PV/OS em vermelho — bloqueia o pipeline até corrigir no Omie." },
  sem_projeto:  { label: "Sem Projeto",           icon: ALARM_ICON, hint: "V.Projeto_Omie não marcado ou fora do padrão. Espera-se projeto começando com 40_VS (Venda de Serviços) ou 41_VP (Venda de Produtos). Vendedor precisa corrigir no Omie." },
  venda:        { label: "Venda em atraso",       icon: ALARM_ICON, hint: "PV/OS em atraso: sem NF de saída e V.Previsão Limite_Omie no passado" },
  compra:       { label: "Previsão atrasada",     icon: ALARM_ICON, hint: "Material ainda não recebido E previsão efetiva vencida (Nova Prev. Materiais, ou dt_previsao original se não remarcado). Reflete qualquer atraso na chegada do material." },
  sem_rc:       { label: "Sem RC ou incompleto",  icon: ALARM_ICON, hint: "Nenhum RC no bucket OU RC com apenas 1 dos 2 campos (número/custo) preenchido" },
  sem_pc:       { label: "Sem PC ou incompleto",  icon: ALARM_ICON, hint: "Nenhum PC no bucket OU PC sem fornecedor, valor ou categoria" },
  aprov_bloq:   { label: "Aprovação bloqueada",   icon: ALARM_ICON, hint: "PC com Não Aprovado ou Rejeitado por validade" },
  aprov_pend:   { label: "Aprovação pendente",    icon: ALARM_ICON, hint: "PC em Pendente ou Pré-seleção — aguardando decisão" },
  defas_omie:   { label: "Defasagem Omie (Aprovado)", icon: ALARM_ICON, hint: "PC aprovado no painel mas etapa Omie NÃO está em 'Aprovação' — o Omie deveria ter movido o PC pra essa etapa após aprovarmos" },
  sem_vinculo:  { label: "Sem Vínculo",           icon: ALARM_ICON, hint: "Mix/Serviços sem OS vinculada no app de serviços — deveria ter sido linkado e não foi" },
  agend_vazio:  { label: "Sem Previsão",          icon: ALARM_ICON, hint: "Mix/Serviços sem V.Nova Prev. Serviços" },
  agend_venc:   { label: "Previsão vencida",      icon: ALARM_ICON, hint: "Mix/Serviços com V.Nova Prev. Serviços no passado (em aberto)" },
  pode_faturar: { label: "Pode faturar",          icon: ALARM_ICON, hint: "Material recebido (Recebto NF preenchido) sem NF de saída" },
};

// Grupos temáticos dos alarmes — cada grupo pinta seu bloco de cor distinta
// no dropdown. Ordem no dropdown segue a ordem aqui. Múltiplo select
// (união entre alarmes ativos) continua igual.
const ALARM_GROUPS: { key: string; label: string; accent: AccentKey; kinds: AlarmKind[] }[] = [
  { key: "vendas",       label: "Vendas",       accent: "rose",    kinds: ["pvos_incompl", "sem_projeto", "venda"] },
  { key: "compras",      label: "Compras",      accent: "violet",  kinds: ["compra", "sem_rc", "sem_pc", "defas_omie"] },
  { key: "aprovacoes",   label: "Aprovações",   accent: "amber",   kinds: ["aprov_bloq", "aprov_pend"] },
  { key: "servicos",     label: "Serviços",     accent: "cyan",    kinds: ["sem_vinculo", "agend_vazio", "agend_venc"] },
  { key: "faturamento",  label: "Faturamento",  accent: "emerald", kinds: ["pode_faturar"] },
];

function AlarmePill({
  kind, active, count, val, onToggle,
}: {
  kind: AlarmKind; active: boolean; count: number; val: number; onToggle: () => void;
}) {
  const cfg = ALARM_CFG[kind];
  return (
    <button onClick={onToggle} title={cfg.hint}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold border transition ${
        active
          ? "bg-rose-600 dark:bg-rose-500 border-rose-800 dark:border-rose-300 text-white shadow-sm"
          : "bg-white dark:bg-ww-panel border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 hover:border-rose-400"
      }`}>
      <span className="text-[10.5px]">{cfg.icon}</span>
      <span>{cfg.label}</span>
      <span className={`tabular-nums text-[10px] font-bold ${active ? "opacity-90" : "opacity-70"}`}>{fmtNum(count)}</span>
      <span className={`tabular-nums text-[10.5px] font-bold ${active ? "" : "text-rose-900 dark:text-rose-100"}`}>{fmtBRL(val)}</span>
    </button>
  );
}

function AtrasoButton({
  kind, active, count, val, onToggle,
}: {
  kind: "venda" | "compra"; active: boolean; count: number; val: number; onToggle: () => void;
}) {
  const cfg = kind === "venda"
    ? {
        label: "Atraso Venda",
        hint: "PV/OS em atraso: sem NF de saída e V.Previsão Limite_Omie no passado",
        bg: "bg-rose-50 dark:bg-rose-950/40",
        bgActive: "bg-rose-600 dark:bg-rose-500",
        border: "border-rose-200 dark:border-rose-800",
        borderActive: "border-rose-800 dark:border-rose-300",
        text: "text-rose-900 dark:text-rose-100",
        textActive: "text-white",
        iconBg: "bg-rose-200 dark:bg-rose-800 text-rose-800 dark:text-rose-100",
        iconBgActive: "bg-white/25 text-white",
      }
    : {
        label: "Atraso Compra",
        hint: "PCs em atraso: sem NF entrada recebida e Previsão PC no passado",
        bg: "bg-violet-50 dark:bg-violet-950/40",
        bgActive: "bg-violet-600 dark:bg-violet-500",
        border: "border-violet-200 dark:border-violet-800",
        borderActive: "border-violet-800 dark:border-violet-300",
        text: "text-violet-900 dark:text-violet-100",
        textActive: "text-white",
        iconBg: "bg-violet-200 dark:bg-violet-800 text-violet-800 dark:text-violet-100",
        iconBgActive: "bg-white/25 text-white",
      };
  return (
    <button onClick={onToggle} title={cfg.hint}
      className={`relative rounded-lg border-2 text-left p-2.5 transition-all hover:-translate-y-0.5 ${
        active
          ? `${cfg.bgActive} ${cfg.borderActive} shadow-md ${cfg.textActive}`
          : `${cfg.bg} ${cfg.border} hover:shadow-sm hover:border-current ${cfg.text}`
      }`}>
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? cfg.iconBgActive : cfg.iconBg}`}>
          <IconAlert />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-[20px] font-bold tracking-[-0.4px] tabular-nums leading-none">{fmtNum(count)}</span>
            <span className="text-[10px] font-semibold opacity-80">PV/OS</span>
          </div>
          <div className="text-[10.5px] mt-0.5 font-bold tracking-[0.4px] uppercase truncate">{cfg.label}</div>
          <div className="text-[11px] mt-0.5 tabular-nums font-semibold opacity-90 truncate">{fmtBRL(val)}</div>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ServicoButton — filtro por estado do fluxo de OS de campo (avulsos)
// ─────────────────────────────────────────────────────────────────────────

function ServicoButton({
  kind, active, count, val, onToggle,
}: {
  kind: "todos" | "concluidos" | "agendados" | "sem_os";
  active: boolean; count: number; val: number; onToggle: () => void;
}) {
  const cfg = kind === "todos"
    ? { label: "Todos", hint: "Todos os PV/OS", icon: <IconAll />,
        bg: "bg-slate-100 dark:bg-slate-800/60", bgActive: "bg-slate-800 dark:bg-slate-200",
        border: "border-slate-300 dark:border-slate-700", borderActive: "border-slate-900 dark:border-slate-50",
        text: "text-slate-900 dark:text-slate-100", textActive: "text-white dark:text-slate-900",
        iconBg: "bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200",
        iconBgActive: "bg-white/25 text-white dark:bg-slate-900/30 dark:text-slate-900" }
    : kind === "concluidos"
    ? { label: "Executados", hint: "Serviço concluído (flag app)", icon: <IconCheck />,
        bg: "bg-emerald-50 dark:bg-emerald-950/40", bgActive: "bg-emerald-600 dark:bg-emerald-500",
        border: "border-emerald-200 dark:border-emerald-800", borderActive: "border-emerald-800 dark:border-emerald-300",
        text: "text-emerald-900 dark:text-emerald-100", textActive: "text-white",
        iconBg: "bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-100",
        iconBgActive: "bg-white/25 text-white" }
    : kind === "agendados"
    ? { label: "Agendados", hint: "Tem OS aberta, ainda não concluída", icon: <IconClock />,
        bg: "bg-amber-50 dark:bg-amber-950/40", bgActive: "bg-amber-500 dark:bg-amber-400",
        border: "border-amber-200 dark:border-amber-800", borderActive: "border-amber-700 dark:border-amber-200",
        text: "text-amber-900 dark:text-amber-100", textActive: "text-white dark:text-amber-950",
        iconBg: "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-100",
        iconBgActive: "bg-white/25 text-white dark:bg-amber-950/30 dark:text-amber-950" }
    : { label: "Sem OS", hint: "Não tem OS criada ainda", icon: <IconOpenBox />,
        bg: "bg-blue-50 dark:bg-blue-950/40", bgActive: "bg-blue-600 dark:bg-blue-500",
        border: "border-blue-200 dark:border-blue-800", borderActive: "border-blue-800 dark:border-blue-300",
        text: "text-blue-900 dark:text-blue-100", textActive: "text-white",
        iconBg: "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-100",
        iconBgActive: "bg-white/25 text-white" };
  return (
    <button onClick={onToggle} title={cfg.hint}
      className={`relative rounded-lg border-2 text-left p-2.5 transition-all hover:-translate-y-0.5 ${
        active
          ? `${cfg.bgActive} ${cfg.borderActive} shadow-md ${cfg.textActive}`
          : `${cfg.bg} ${cfg.border} hover:shadow-sm hover:border-current ${cfg.text}`
      }`}>
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? cfg.iconBgActive : cfg.iconBg}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-[20px] font-bold tracking-[-0.4px] tabular-nums leading-none">{fmtNum(count)}</span>
            <span className="text-[10px] font-semibold opacity-80">PV/OS</span>
          </div>
          <div className="text-[10.5px] mt-0.5 font-bold tracking-[0.4px] uppercase truncate">{cfg.label}</div>
          <div className="text-[11px] mt-0.5 tabular-nums font-semibold opacity-90 truncate">{fmtBRL(val)}</div>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GrandTotalBar — soma RC/PC/PV de tudo que está visível (após filtros)
// ─────────────────────────────────────────────────────────────────────────

function GrandTotalBar({
  grand, modulo, count, canViewValues = true,
}: {
  grand: { rc: number; pc: number; pv: number };
  modulo: "avulsos" | "projetos" | "pcs";
  count: number;
  canViewValues?: boolean;
}) {
  const showRcPv = modulo !== "pcs";
  return (
    <div className="bg-ww-panel border-2 border-ww-borderStrong rounded-[12px] px-5 py-3 shadow-md">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textMuted">Total visível</span>
          <span className="text-[12px] font-semibold tabular-nums text-ww-text mt-0.5">
            {count.toLocaleString("pt-BR")} {modulo === "pcs" ? "PC(s)" : "linha(s)"}
          </span>
        </div>
        <div className="h-9 w-px bg-ww-border" />
        <div className="flex items-baseline gap-6 flex-1 flex-wrap">
          {showRcPv && <GrandTotalCell label="RC" value={grand.rc} canView={canViewValues} />}
          {showRcPv && <span className="h-6 w-px bg-ww-border" />}
          <GrandTotalCell label="PC" value={grand.pc} highlight={!showRcPv} canView={canViewValues} />
          {showRcPv && <span className="h-6 w-px bg-ww-border" />}
          {showRcPv && <GrandTotalCell label="PV" value={grand.pv} canView={canViewValues} />}
        </div>
      </div>
    </div>
  );
}

function GrandTotalCell({ label, value, highlight, canView = true }: { label: string; value: number; highlight?: boolean; canView?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textMuted">{label}</span>
      <span className={`text-[18px] font-semibold tabular-nums tracking-[-0.3px] ${highlight ? "text-ww-accent" : "text-ww-text"}`}>
        {value > 0 ? gateBRL(value, canView) : "—"}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BucketTotals — 3 totais (RC / PC c/ badge / PV) + M.B. (margem bruta)
// PC ganha badge de cor comparando com RC: 🔴 PC>RC (estourou o estimado),
// 🟢 PC=RC (bateu), 🔵 PC<RC (compra abaixo do estimado — bom sinal).
// M.B. substitui o indicador RC/PC anterior: (PV - PC) / PV — quanto sobrou
// da venda depois de pagar a compra. Verde >0, vermelho <0, cinza sem dado.
// ─────────────────────────────────────────────────────────────────────────

function BucketTotals({
  bucket, items, modulo, canViewValues = true, canViewMargin = true, budgetMap,
}: {
  bucket: Bucket; items: AnyRow[]; modulo: "avulsos" | "projetos" | "pcs";
  canViewValues?: boolean; canViewMargin?: boolean;
  budgetMap?: Map<string, BudgetSummary>;
}) {
  // pvos: window functions já trazem os totais por PV/OS, todos rows do bucket
  // têm o mesmo valor. Usamos rows[0].
  // project: agregamos por PV/OS distinto e somamos.
  // pc: 1 bucket = 1 PC; PCs Standalone não têm RC nem PV próprios.
  let rcTotal = 0, pcTotal = 0, pvTotal = 0;

  if (bucket.groupKind === "pvos") {
    const r = items[0] ?? {};
    rcTotal = Number(r.rc_custo_total_calc ?? 0);
    pcTotal = Number(r.pc_custo_total_calc ?? 0);
    pvTotal = Number(r.pv_valor_total ?? 0);
  } else if (bucket.groupKind === "project") {
    const seen = new Map<string, { rc: number; pc: number; pv: number }>();
    for (const r of items) {
      const k = String(r.pv_os_label ?? "—");
      if (!seen.has(k)) seen.set(k, {
        rc: Number(r.rc_custo_total_calc ?? 0),
        pc: Number(r.pc_custo_total_calc ?? 0),
        pv: Number(r.pv_valor_total ?? 0),
      });
    }
    for (const v of seen.values()) { rcTotal += v.rc; pcTotal += v.pc; pvTotal += v.pv; }
  } else if (bucket.groupKind === "pc") {
    // PC Standalone: só PC; SEM RC, SEM PV
    const r = items[0] ?? {};
    pcTotal = Number(r.valor_total ?? 0);
  }

  // Badge do PC comparando com RC. Threshold pequeno (1%) trata arredondamentos
  // como "igual". Sem RC ou sem PC → sem badge (neutro).
  const pcBadge = (() => {
    if (rcTotal <= 0 || pcTotal <= 0) return null;
    const diff = (pcTotal - rcTotal) / rcTotal;
    if (Math.abs(diff) < 0.01) return { kind: "eq" as const, tone: "emerald", label: `= RC`, title: "PC bate com o RC estimado" };
    if (diff > 0)               return { kind: "gt" as const, tone: "rose",    label: `+${(diff * 100).toFixed(1)}% vs RC`, title: `PC ${(diff * 100).toFixed(1)}% acima do RC estimado` };
    return                             { kind: "lt" as const, tone: "blue",    label: `${(diff * 100).toFixed(1)}% vs RC`, title: `PC ${(Math.abs(diff) * 100).toFixed(1)}% abaixo do RC estimado (economia)` };
  })();

  // Margem Bruta = (PV - PC) / PV. Só faz sentido quando PV > 0.
  const mb = pvTotal > 0 ? (pvTotal - pcTotal) / pvTotal : null;
  const mbTone = mb == null ? "neutral" : mb > 0.001 ? "positive" : mb < -0.001 ? "negative" : "zero";

  // /pcs: layout enxuto — só PC (sem RC, sem PV, sem M.B.).
  const isPcs = modulo === "pcs";

  // Sem badge quando o usuário não vê margem (é comparativo PC vs RC — mesma família).
  const showBadge = canViewMargin ? pcBadge : null;

  // /projetos com groupKind=project → BudgetTotals (substitui RC/PC/PV).
  // Precisa de budgetMap + código do projeto do bucket.
  if (modulo === "projetos" && bucket.groupKind === "project") {
    const empProj = String(items[0]?.empresa ?? "").trim();
    const codProj = Number(
      items.find((r) => r.codigo_projeto)?.codigo_projeto
      ?? items.find((r) => r.pv_codigo_projeto)?.pv_codigo_projeto
      ?? 0
    );
    const key = codProj > 0 ? `${empProj}|${codProj}` : "";
    const b = key && budgetMap ? budgetMap.get(key) : undefined;
    return <BudgetTotals budget={b} items={items} pcTotal={pcTotal} pvTotal={pvTotal}
      canViewValues={canViewValues} canViewMargin={canViewMargin} mb={mb} mbTone={mbTone} />;
  }

  // Moldura visual demarcando a totalização — box com borda leve + fundo levemente
  // destacado, pra separar dos metadados do bucket ao redor sem quebrar a densidade.
  // Layout: flex + w-full pra ocupar toda a coluna (460px) reservada no header.
  // RC/PC/PV compartem 3fr equal, M.B. tem largura fixa à direita — assim tudo
  // fica dentro da borda mesmo com números longos como "R$ 14.037,10".
  return (
    <div className="flex items-stretch w-full border border-ww-borderStrong rounded-lg bg-ww-bg/60 dark:bg-ww-panel/40 shadow-inner px-2.5 py-1.5">
      <div className={`grid ${isPcs ? "grid-cols-1" : "grid-cols-3"} flex-1 gap-2 min-w-0`}>
        {isPcs ? (
          <TotalCol label="PC" value={pcTotal} canView={canViewValues} />
        ) : (
          <>
            <TotalCol label="RC" value={rcTotal} canView={canViewValues} />
            <TotalCol label="PC" value={pcTotal} canView={canViewValues} withDivider badge={showBadge} />
            <TotalCol label="PV" value={pvTotal} canView={canViewValues} withDivider />
          </>
        )}
      </div>
      {!isPcs && canViewMargin && (
        <div title={mb == null ? "Sem PV registrado — impossível calcular margem bruta" : `Margem bruta = (PV − PC) / PV = ${(mb * 100).toFixed(1)}%`}
             className="text-center flex flex-col justify-center w-[64px] shrink-0 ml-2 pl-2 relative">
          <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 border-l border-dashed border-ww-border" />
          <div className="text-[10px] uppercase tracking-[0.6px] text-ww-textMuted font-bold mb-1">M.B.</div>
          <div className={`text-[15px] font-bold tabular-nums leading-none ${
            mbTone === "positive" ? "text-emerald-700 dark:text-emerald-300" :
            mbTone === "negative" ? "text-rose-700 dark:text-rose-300" :
            mbTone === "zero"     ? "text-slate-700 dark:text-slate-300" :
                                    "text-ww-textFaint"
          }`}>
            {mb == null ? "—" : `${(mb * 100).toFixed(1)}%`}
          </div>
        </div>
      )}
    </div>
  );
}

// BudgetTotals — versão do card lateral pra /projetos (groupKind=project).
// Substitui RC/PC/PV pelo breakdown do Fluxo Financeiro:
//   • Budget (Fluxo)  = valor_previsto_custos (o teto de gasto)
//   • Total lançado   = SUM(pc_valor_total) de todos os PCs do projeto
//   • Aprovado        = SUM(pc_valor_total) dos PCs com status APROVADO*
//   • Falta aprovar   = lançado − aprovado
//   • Barra %         = lançado / budget (compromisso do orçamento)
//   • Venda / M.B. esperada — canto direito, análogo ao M.B. do card padrão.
function BudgetTotals({
  budget, items, pcTotal, pvTotal, canViewValues, canViewMargin, mb, mbTone,
}: {
  budget: BudgetSummary | undefined;
  items: AnyRow[];
  pcTotal: number;
  pvTotal: number;
  canViewValues: boolean;
  canViewMargin: boolean;
  mb: number | null;
  mbTone: "positive" | "negative" | "zero" | "neutral";
}) {
  // Aprovado: soma pc_valor_total dos PCs cujo status é APROVADO ou APROVADO_FAT_DIRETO.
  // Dedup por (empresa, ncod_ped) — o view lista uma row por item RC, então PCs
  // com vários itens aparecem repetidos.
  let aprovado = 0;
  const seenApr = new Set<string>();
  for (const r of items) {
    const status = String(r.status ?? "");
    if (status !== "APROVADO" && status !== "APROVADO_FAT_DIRETO") continue;
    const key = `${r.empresa ?? ""}|${r.ncod_ped ?? ""}`;
    if (seenApr.has(key)) continue;
    seenApr.add(key);
    aprovado += Number(r.pc_valor_total ?? r.valor_total ?? 0);
  }
  const lancado = pcTotal;
  const falta = Math.max(0, lancado - aprovado);
  const pctAprov = lancado > 0 ? aprovado / lancado : null;
  const pctFalta = lancado > 0 ? falta / lancado : null;

  const budgetVal = budget?.budget_custos != null ? Math.abs(Number(budget.budget_custos)) : null;
  const consumidoPct = budgetVal && budgetVal > 0 ? Math.min(2, lancado / budgetVal) : null;
  const barTone = consumidoPct == null ? "bg-ww-border"
    : consumidoPct > 1 ? "bg-rose-500"
    : consumidoPct > 0.85 ? "bg-amber-500"
    : "bg-emerald-500";
  const consumidoLabel = consumidoPct == null ? "—" : `${(consumidoPct * 100).toFixed(0)}%`;

  const vendaBudget = budget?.valor_total_projeto ?? pvTotal;
  const mbEsperadaPct = budget?.resultado_bruto_esperado_pct != null ? Number(budget.resultado_bruto_esperado_pct) : null;

  return (
    <div className="flex items-stretch w-full border border-ww-borderStrong rounded-lg bg-ww-bg/60 dark:bg-ww-panel/40 shadow-inner px-2.5 py-1.5 gap-3">
      {/* Col esquerda — Budget + barra consumido */}
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.5px] text-ww-textMuted font-bold">Budget</span>
          <span className="text-[13px] font-semibold tabular-nums text-ww-text whitespace-nowrap">
            {budgetVal != null ? gateBRL(budgetVal, canViewValues) : <span className="text-ww-textFaint italic text-[11px]">definir</span>}
          </span>
        </div>
        {/* Barra: lançado vs budget */}
        <div className="w-full h-1.5 rounded-full bg-ww-border/60 overflow-hidden" title={budgetVal ? `Lançado: ${gateBRL(lancado, canViewValues)} de ${gateBRL(budgetVal, canViewValues)}` : "Sem budget cadastrado"}>
          {consumidoPct != null && (
            <div className={`h-full ${barTone} transition-all`} style={{ width: `${Math.min(100, (consumidoPct / (consumidoPct > 1 ? consumidoPct : 1)) * 100)}%` }} />
          )}
        </div>
        <div className="flex items-baseline justify-between text-[10px]">
          <span className="text-ww-textMuted">Lançado</span>
          <span className="tabular-nums font-semibold text-ww-text">{gateBRL(lancado, canViewValues)} <span className="text-ww-textFaint">· {consumidoLabel}</span></span>
        </div>
      </div>

      {/* Col meio — Aprovado / Falta */}
      <div className="flex flex-col min-w-0 w-[120px] gap-1 pl-2.5 border-l border-dashed border-ww-border">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-[10px] uppercase tracking-[0.5px] text-emerald-700 dark:text-emerald-400 font-bold">Aprov.</span>
          <span className="text-[11.5px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
            {gateBRL(aprovado, canViewValues)}
          </span>
        </div>
        <div className="text-[9.5px] text-emerald-700/70 dark:text-emerald-400/70 text-right tabular-nums">
          {pctAprov != null ? `${(pctAprov * 100).toFixed(0)}% do lançado` : "—"}
        </div>
        <div className="flex items-baseline justify-between gap-1 mt-0.5">
          <span className="text-[10px] uppercase tracking-[0.5px] text-amber-700 dark:text-amber-400 font-bold">Falta</span>
          <span className="text-[11.5px] font-semibold tabular-nums text-amber-700 dark:text-amber-300 whitespace-nowrap">
            {gateBRL(falta, canViewValues)}
          </span>
        </div>
        <div className="text-[9.5px] text-amber-700/70 dark:text-amber-400/70 text-right tabular-nums">
          {pctFalta != null ? `${(pctFalta * 100).toFixed(0)}% do lançado` : "—"}
        </div>
      </div>

      {/* Col direita — Venda + M.B. esperada */}
      {canViewMargin && (
        <div className="flex flex-col justify-center w-[86px] shrink-0 pl-2 relative gap-1">
          <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 border-l border-dashed border-ww-border" />
          <div className="text-center">
            <div className="text-[9.5px] uppercase tracking-[0.5px] text-ww-textMuted font-bold">Venda</div>
            <div className="text-[11px] font-semibold tabular-nums text-ww-text whitespace-nowrap">
              {vendaBudget && vendaBudget > 0 ? gateBRL(Number(vendaBudget), canViewValues) : "—"}
            </div>
          </div>
          <div className="text-center border-t border-ww-border/50 pt-0.5"
               title={mbEsperadaPct != null ? `M.B. esperada (Fluxo Financeiro): ${(mbEsperadaPct * 100).toFixed(1)}%` : mb == null ? "Sem PV — impossível calcular M.B." : `M.B. realizada = (PV − PC) / PV = ${(mb * 100).toFixed(1)}%`}>
            <div className="text-[9.5px] uppercase tracking-[0.5px] text-ww-textMuted font-bold">M.B. {mbEsperadaPct != null ? "esp." : ""}</div>
            <div className={`text-[13px] font-bold tabular-nums ${
              mbEsperadaPct != null
                ? (mbEsperadaPct > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")
                : mbTone === "positive" ? "text-emerald-700 dark:text-emerald-300"
                : mbTone === "negative" ? "text-rose-700 dark:text-rose-300"
                : mbTone === "zero"     ? "text-slate-700 dark:text-slate-300"
                :                         "text-ww-textFaint"
            }`}>
              {mbEsperadaPct != null ? `${(mbEsperadaPct * 100).toFixed(1)}%` : mb == null ? "—" : `${(mb * 100).toFixed(1)}%`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type PcBadge = { kind: "gt" | "eq" | "lt"; tone: string; label: string; title: string } | null;

function TotalCol({ label, value, withDivider, badge, canView = true }: { label: string; value: number; withDivider?: boolean; badge?: PcBadge; canView?: boolean }) {
  const badgeStyle = !badge ? "" :
    badge.tone === "rose"    ? "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800" :
    badge.tone === "emerald" ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800" :
                               "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800";
  return (
    <div className={`text-center relative min-w-0 ${withDivider ? "pl-2" : ""}`}>
      {withDivider && (
        <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-px bg-ww-border" />
      )}
      <div className="text-[10px] uppercase tracking-[0.6px] text-ww-textMuted font-bold mb-1">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums text-ww-text leading-tight whitespace-nowrap">
        {value > 0 ? gateBRL(value, canView) : "—"}
      </div>
      {badge && (
        <div title={badge.title}
             className={`inline-block mt-1 px-1.5 py-px text-[9.5px] font-bold rounded border tabular-nums leading-none whitespace-nowrap ${badgeStyle}`}>
          {badge.label}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// InkUnderline (cell visual editável light)
// ─────────────────────────────────────────────────────────────────────────

function InkUnderline({ value, placeholder }: { value: string; placeholder?: string }) {
  if (!value) return <span className="text-ww-textFaint border-b border-dashed border-ww-border px-0.5">{placeholder ?? "—"}</span>;
  return <span className="border-b border-dashed border-ww-border px-0.5">{value}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Status pill (clicável)
// ─────────────────────────────────────────────────────────────────────────

function BoldStatusButton({ row, onClick }: { row: AnyRow; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const status = String(row.status ?? "PENDENTE");
  const meta = STATUS_META[status] ?? STATUS_META.PENDENTE;
  const short = STATUS_SHORT[status] ?? meta.label;
  return (
    <button onClick={onClick} type="button"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11.5px] font-semibold uppercase tracking-[0.4px] justify-self-start ${meta.tone} hover:brightness-110 transition`}>
      {short}
      <span className="opacity-50 text-[9px]">▾</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Status popover (portal)
// ─────────────────────────────────────────────────────────────────────────

const ADMIN_ONLY_STATUS = new Set(["CANCELAR_PEDIDO"]);

function BoldStatusPopover({
  anchor, row, modulo, isAdmin, onClose, onOptimisticApply, onError, onSuccess,
}: {
  anchor: DOMRect;
  rowKey: string;
  row: AnyRow;
  modulo: string;
  isAdmin: boolean;
  onClose: () => void;
  onOptimisticApply?: (status: string) => void;
  onError?: () => void;
  onSuccess?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [onClose]);

  const top = Math.min(anchor.bottom + 4, window.innerHeight - 360);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 240));

  async function apply(next: string) {
    if (busy) return;
    setBusy(true);
    // 1. Optimistic update — UI reflete imediato
    onOptimisticApply?.(next);
    onClose();  // fecha popover na hora
    // 2. Fetch em background
    const res = await fetch("/api/approvals/set-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa: row.empresa, ncod_ped: row.ncod_ped,
        status: next, modulo,
        valorPc: row.valor_total != null ? Number(row.valor_total) : null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      onError?.();   // reverte optimistic
      const j = await res.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? res.statusText}`);
      return;
    }
    onSuccess?.();   // dispara router.refresh() pra trazer dados frescos
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref}
      className="fixed bg-ww-panel border border-ww-borderStrong rounded-[10px] shadow-[0_14px_40px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] p-1.5 z-[9999]"
      style={{ top, left, width: 230 }}>
      <div className="text-[10px] text-ww-textFaint px-2 pt-1 pb-1.5 uppercase tracking-[0.6px] font-semibold">Alterar status</div>
      {STATUS_ORDER.map((code) => {
        if (ADMIN_ONLY_STATUS.has(code) && !isAdmin) return null;
        const meta = STATUS_META[code]; if (!meta) return null;
        const short = STATUS_SHORT[code] ?? meta.label;
        return (
          <button key={code} onClick={() => apply(code)} disabled={busy}
            className="w-full flex items-center px-1.5 py-1 rounded-md text-left mb-px text-ww-text text-[12.5px] hover:bg-ww-rowHover transition">
            <span className={`inline-flex px-2 py-px rounded font-mono text-[10px] font-semibold uppercase tracking-[0.4px] ${meta.tone}`}>{short}</span>
            <span className="flex-1 ml-2 text-[12px]">{meta.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Detail drawer
// ─────────────────────────────────────────────────────────────────────────

function BoldDrawer({ item, onClose }: { item: AnyRow & { _bucket?: Bucket }; onClose: () => void }) {
  const status = String(item.status ?? "PENDENTE");
  const meta = STATUS_META[status] ?? STATUS_META.PENDENTE;
  const qtd = (item.rc_qtd as number) ?? 1;
  const custo = (item.rc_custo as number) ?? 0;
  const totalRc = qtd * custo;
  const valorPc = (item.valor_total as number) ?? null;

  return (
    <div className="fixed top-0 right-0 h-screen w-[380px] bg-ww-drawer border-l border-ww-border shadow-[-12px_0_40px_-20px_rgba(0,0,0,0.15)] flex flex-col z-40 overflow-y-auto"
      style={{ animation: "slideInRight 250ms cubic-bezier(.2,.7,.3,1)" }}>
      <style>{`@keyframes slideInRight{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>

      <div className="px-4 py-3 border-b border-ww-border bg-ww-drawerHead flex items-center gap-2.5 sticky top-0 z-10">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] text-ww-textFaint uppercase tracking-[0.4px]">
            {item._bucket?.pv_os_label ?? "—"} · {(item.rc_numero as string) ?? "—"}
          </div>
          <div className="text-[14px] font-semibold mt-0.5 truncate text-ww-text">{(item.rc_descricao as string) ?? "(sem descrição)"}</div>
        </div>
        <button onClick={onClose} className="text-ww-textMuted text-lg px-1 hover:text-ww-text transition" title="Fechar">×</button>
      </div>

      <div className="px-4 py-3 border-b border-ww-border space-y-2.5">
        <span className={`inline-flex self-start px-2.5 py-1 rounded font-mono text-[11.5px] font-semibold uppercase tracking-[0.4px] ${meta.tone}`}>
          {meta.label}
        </span>
        <Field label="Cliente"    value={(item._bucket?.cliente as string) ?? "—"} />
        <Field label="Projeto"    value={(item._bucket?.projeto as string) ?? "—"} />
        <Field label="Fornecedor" value={(item.nome_fornecedor as string) ?? (item.contato_fornecedor as string) ?? "— a definir —"} />
        <Field label="Etapa PC"   value={(item.pc_etapa_texto as string) ?? "—"} />
      </div>

      <div className="px-4 py-3 border-b border-ww-border grid grid-cols-2 gap-2.5">
        <Field label="Qtd"         value={fmtNum(qtd)} mono />
        <Field label="Custo unit"  value={fmtBRL(custo)} mono />
        <Field label="Total RC"    value={fmtBRL(totalRc)} mono highlight />
        <Field label="Valor PC"    value={fmtBRL(valorPc)} mono />
      </div>

      <div className="px-4 py-3 border-b border-ww-border">
        <div className="text-[11.5px] font-semibold text-ww-textFaint uppercase tracking-[0.5px] mb-2">Atividade</div>
        <div className="space-y-2 text-[12px]">
          <ActivityRow who="sistema" when={fmtDate(item.imported_at)} what="row sincronizado do Omie" />
          {item.aprovador_email ? (
            <ActivityRow who={String(item.aprovador_email).split("@")[0]} when={fmtDate(item.aprovado_em)} what={`alterou status para ${meta.label}`} />
          ) : null}
        </div>
      </div>

      <div className="mt-auto px-4 py-3 flex gap-1.5">
        <button className="flex-1 px-3 py-2 bg-ww-accent text-white dark:text-[#0a1812] rounded-[7px] text-[12.5px] font-semibold transition hover:opacity-90">✓ Aprovar</button>
        <button onClick={onClose} className="flex-1 px-3 py-2 bg-transparent text-ww-text border border-ww-borderStrong rounded-[7px] text-[12.5px] font-medium transition hover:bg-ww-rowHover">Fechar</button>
      </div>
    </div>
  );
}

function Field({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-ww-textFaint uppercase tracking-[0.5px] font-semibold mb-0.5">{label}</div>
      <div className={`text-[12.5px] tabular-nums ${mono ? "font-mono" : ""} ${highlight ? "text-ww-accent font-semibold" : "text-ww-text"}`}>{value}</div>
    </div>
  );
}

function ActivityRow({ who, when, what }: { who: string; when: string; what: string }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-ww-border last:border-0">
      <div className="w-[22px] h-[22px] rounded-full bg-ww-accentSoft text-ww-accent text-[10px] font-bold grid place-items-center shrink-0 font-mono">
        {who.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-ww-text"><span className="font-medium">{who}</span> {what}</div>
        <div className="text-[11.5px] text-ww-textFaint font-mono">{when}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// KpiGroup — container com border sutil pra agrupar N items KPI horizontais.
// Estilo do "APROVAÇÃO" no print de referência: header com bullet + label
// uppercase pequena, container com border colorido/neutro, e items inline.
// ─────────────────────────────────────────────────────────────────────────

function KpiGroup({
  label, accent = "slate", children, prominent = false,
}: {
  label: string; accent?: AccentKey; children: React.ReactNode; prominent?: boolean;
}) {
  const cfg = ACCENT_MAP[accent];
  return (
    <div className={`rounded-lg border px-3 py-2 bg-ww-panel ${prominent ? cfg.border : "border-ww-border"}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textMuted">{label}</span>
      </div>
      <div className="flex items-stretch gap-2">
        {children}
      </div>
    </div>
  );
}

// KpiItem — sub-card usado dentro de um KpiGroup. Bullet + label + valor R$
// grande + count PV/OS pequeno. Click alterna filtro (single-select). Ativo
// mostra border colorida e fundo levemente destacado.
function KpiItem({
  label, count, val, accent, active, onClick,
}: {
  label: string; count: number; val: number; accent: AccentKey; active: boolean; onClick: () => void;
}) {
  const cfg = ACCENT_MAP[accent];
  return (
    <button onClick={onClick}
      className={`flex-1 min-w-[110px] rounded-md border px-2.5 py-1.5 text-left transition ${
        active ? `${cfg.border} bg-ww-accentSoft/30` : "border-ww-border/50 hover:border-ww-border"
      }`}>
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span className="text-[9.5px] uppercase tracking-[0.5px] font-bold text-ww-textMuted truncate">{label}</span>
      </div>
      <div className="text-[15px] font-bold tabular-nums text-ww-text mt-0.5 tracking-[-0.3px]">{fmtBRL(val)}</div>
      <div className="text-[10px] tabular-nums text-ww-textFaint">{fmtNum(count)} PV/OS</div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FacetDistribution — painel visual (topo dos valores + count + R$ + barra
// de magnitude). Substitui os dropdowns em /avulsos. Cada barra é um botão
// toggle (multi-select), e a largura da barra é proporcional ao valor R$.
// ─────────────────────────────────────────────────────────────────────────

// ACCENT_MAP — 6 hues distintos pros panels de filtro. panelBg é intencionalmente
// mais forte (100/50) do que era antes, pra cada painel ficar visualmente
// distinto no cabeçalho (usuário reclamou que estavam parecidos demais).
const ACCENT_MAP = {
  violet:  { dot: "bg-violet-500",  bar: "bg-violet-500",  hover: "hover:bg-violet-200/70 dark:hover:bg-violet-950/50",   border: "border-violet-400 dark:border-violet-600",   panelBg: "bg-violet-50/70 dark:bg-violet-950/20",    headerBg: "bg-violet-200/80 dark:bg-violet-900/50",   selectedBg: "bg-violet-300/80 dark:bg-violet-800/60",   selectedText: "text-violet-950 dark:text-violet-50" },
  emerald: { dot: "bg-emerald-500", bar: "bg-emerald-500", hover: "hover:bg-emerald-200/70 dark:hover:bg-emerald-950/50", border: "border-emerald-400 dark:border-emerald-600", panelBg: "bg-emerald-50/70 dark:bg-emerald-950/20",  headerBg: "bg-emerald-200/80 dark:bg-emerald-900/50", selectedBg: "bg-emerald-300/80 dark:bg-emerald-800/60", selectedText: "text-emerald-950 dark:text-emerald-50" },
  blue:    { dot: "bg-blue-500",    bar: "bg-blue-500",    hover: "hover:bg-blue-200/70 dark:hover:bg-blue-950/50",       border: "border-blue-400 dark:border-blue-600",       panelBg: "bg-blue-50/70 dark:bg-blue-950/20",        headerBg: "bg-blue-200/80 dark:bg-blue-900/50",       selectedBg: "bg-blue-300/80 dark:bg-blue-800/60",       selectedText: "text-blue-950 dark:text-blue-50" },
  amber:   { dot: "bg-amber-500",   bar: "bg-amber-500",   hover: "hover:bg-amber-200/70 dark:hover:bg-amber-950/50",     border: "border-amber-400 dark:border-amber-600",     panelBg: "bg-amber-50/70 dark:bg-amber-950/20",      headerBg: "bg-amber-200/80 dark:bg-amber-900/50",     selectedBg: "bg-amber-300/80 dark:bg-amber-800/60",     selectedText: "text-amber-950 dark:text-amber-50" },
  cyan:    { dot: "bg-cyan-500",    bar: "bg-cyan-500",    hover: "hover:bg-cyan-200/70 dark:hover:bg-cyan-950/50",       border: "border-cyan-400 dark:border-cyan-600",       panelBg: "bg-cyan-50/70 dark:bg-cyan-950/20",        headerBg: "bg-cyan-200/80 dark:bg-cyan-900/50",       selectedBg: "bg-cyan-300/80 dark:bg-cyan-800/60",       selectedText: "text-cyan-950 dark:text-cyan-50" },
  rose:    { dot: "bg-rose-500",    bar: "bg-rose-500",    hover: "hover:bg-rose-200/70 dark:hover:bg-rose-950/50",       border: "border-rose-400 dark:border-rose-600",       panelBg: "bg-rose-50/70 dark:bg-rose-950/20",        headerBg: "bg-rose-200/80 dark:bg-rose-900/50",       selectedBg: "bg-rose-300/80 dark:bg-rose-800/60",       selectedText: "text-rose-950 dark:text-rose-50" },
  fuchsia: { dot: "bg-fuchsia-500", bar: "bg-fuchsia-500", hover: "hover:bg-fuchsia-200/70 dark:hover:bg-fuchsia-950/50", border: "border-fuchsia-400 dark:border-fuchsia-600", panelBg: "bg-fuchsia-50/70 dark:bg-fuchsia-950/20",  headerBg: "bg-fuchsia-200/80 dark:bg-fuchsia-900/50", selectedBg: "bg-fuchsia-300/80 dark:bg-fuchsia-800/60", selectedText: "text-fuchsia-950 dark:text-fuchsia-50" },
  teal:    { dot: "bg-teal-500",    bar: "bg-teal-500",    hover: "hover:bg-teal-200/70 dark:hover:bg-teal-950/50",       border: "border-teal-400 dark:border-teal-600",       panelBg: "bg-teal-50/70 dark:bg-teal-950/20",        headerBg: "bg-teal-200/80 dark:bg-teal-900/50",       selectedBg: "bg-teal-300/80 dark:bg-teal-800/60",       selectedText: "text-teal-950 dark:text-teal-50" },
  slate:   { dot: "bg-slate-500",   bar: "bg-slate-500",   hover: "hover:bg-slate-200/70 dark:hover:bg-slate-800/50",     border: "border-slate-400 dark:border-slate-600",     panelBg: "bg-slate-50/70 dark:bg-slate-900/30",      headerBg: "bg-slate-200/80 dark:bg-slate-800/60",     selectedBg: "bg-slate-300/80 dark:bg-slate-700/60",     selectedText: "text-slate-950 dark:text-slate-50" },
} as const;
type AccentKey = keyof typeof ACCENT_MAP;

function FacetDistribution({
  facetKey: _facetKey, label, accent, buckets, selected, onToggle, onClear, single = false, side, canViewValues = true,
}: {
  facetKey: FacetKey; label: string; accent: AccentKey;
  buckets: { value: string; count: number; val: number }[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  /** Se true, click num item limpa outros (comportamento single-select).
      Se false (default), toggle multi-select. */
  single?: boolean;
  /** "V" = valores de VENDA (pv_valor_total, dedupe por PV). "C" = valores de
      COMPRA (valor_total do PC, 1 row = 1 PC). Renderiza badge no cabeçalho. */
  side?: "V" | "C";
  /** Se false, R$ vira "R$ •••••" (permissão de visualização negada). */
  canViewValues?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const cfg = ACCENT_MAP[accent];
  const TOP_N = 6;
  const visible = showAll ? buckets : buckets.slice(0, TOP_N);
  const maxVal = buckets.reduce((m, b) => Math.max(m, b.val), 0) || 1;
  const hasMore = buckets.length > TOP_N;

  // Click de item: em single-select, click num item já selecionado desativa;
  // click em outro limpa e ativa apenas ele. Em multi (default): toggle
  // membership no set (add/remove).
  const handleClick = (value: string) => {
    if (!single) { onToggle(value); return; }
    const onlyThis = selected.size === 1 && selected.has(value);
    if (onlyThis) onClear();
    else { onClear(); onToggle(value); }
  };

  // Estilo Kanban: header em faixa colorida (headerBg mais forte) separado do
  // conteúdo (panelBg mais suave). Título fica em destaque no topo.
  return (
    <div className={`border border-ww-border rounded-lg shadow-sm overflow-hidden flex flex-col`}>
      <div className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 border-b border-ww-border/60 ${cfg.headerBg}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
          <span className={`text-[10px] uppercase tracking-[0.6px] font-bold ${cfg.selectedText} truncate`}>Por {label}</span>
          {side && (
            <span title={side === "V" ? "Valor de VENDA (PV)" : "Valor de COMPRA (PC)"}
              className={`text-[9px] font-black px-1 py-px rounded shrink-0 ${
                side === "V"
                  ? "bg-slate-800/80 text-white dark:bg-white/90 dark:text-slate-900"
                  : "bg-white/90 text-slate-900 ring-1 ring-slate-800/40 dark:bg-slate-900/80 dark:text-white dark:ring-white/30"
              }`}>
              {side}
            </span>
          )}
          {selected.size > 0 && (
            <span className={`ml-0.5 text-[9px] font-bold px-1 py-px rounded uppercase tracking-wider shrink-0 bg-white/70 dark:bg-black/40 ${cfg.selectedText}`}>
              {selected.size}
            </span>
          )}
        </div>
        {selected.size > 0 && (
          <button onClick={onClear}
            className={`text-[9.5px] font-semibold ${cfg.selectedText} opacity-70 hover:opacity-100 uppercase tracking-wider shrink-0`}>
            limpar
          </button>
        )}
      </div>
      <div className={`flex-1 px-2.5 py-2 ${cfg.panelBg}`}>
        {visible.length === 0 && (
          <div className="text-[11px] text-ww-textFaint italic py-1">Nenhum dado</div>
        )}
        <div className="divide-y divide-ww-border/40">
          {visible.map((b) => {
            const on = selected.has(b.value);
            const pct = Math.max(2, (b.val / maxVal) * 100);
            return (
              <button key={b.value} onClick={() => handleClick(b.value)}
                className={`w-full text-left py-1.5 px-1.5 rounded-md group transition ${cfg.hover} ${
                  on ? `${cfg.selectedBg} ring-1 ${cfg.border} ring-inset` : ""
                }`}>
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className={`text-[13px] tracking-[-0.1px] flex-1 min-w-0 truncate ${on ? `font-bold ${cfg.selectedText}` : "font-medium text-ww-text"}`}>
                    {b.value}
                  </span>
                  <span className="text-[10.5px] tabular-nums text-ww-textMuted font-medium shrink-0">{fmtNum(b.count)}</span>
                  <span className={`text-[12px] tabular-nums font-semibold shrink-0 min-w-[85px] text-right ${on ? cfg.selectedText : "text-ww-text"}`}>{gateBRL(b.val, canViewValues)}</span>
                </div>
                <div className="h-[2px] mt-1 w-full overflow-hidden">
                  <div className={`h-full ${cfg.bar} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
        {hasMore && (
          <button onClick={() => setShowAll((v) => !v)}
            className="mt-1 text-[10px] font-bold text-ww-textMuted hover:text-ww-text uppercase tracking-[0.6px] w-full text-center py-0.5">
            {showAll ? "ver menos" : `ver todos (${buckets.length})`}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FacetDropdown — multi-select com busca e contagem
// ─────────────────────────────────────────────────────────────────────────

function FacetDropdown({
  label, values, selected, onToggle, onClear,
}: {
  label: string;
  values: Map<string, number>;
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const entries = useMemo(() => {
    const arr = [...values.entries()];
    const q = search.trim().toLowerCase();
    const filtered = q ? arr.filter(([v]) => v.toLowerCase().includes(q)) : arr;
    return filtered.sort((a, b) => b[1] - a[1]);
  }, [values, search]);

  const count = selected.size;
  const active = count > 0;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition ${
          active
            ? "bg-ww-accentSoft border-ww-accent text-ww-accent"
            : "bg-ww-panel border-ww-border text-ww-textMuted hover:bg-ww-rowHover"
        }`}>
        <span>+ {label}</span>
        {active && (
          <span className="bg-ww-accent text-white dark:text-[#0a1812] rounded-full px-1.5 text-[10px] font-semibold tabular-nums">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-40 mt-1 left-0 w-[320px] bg-ww-panel border border-ww-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-ww-border space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-ww-textFaint font-semibold">
              Marque uma ou mais opções
            </div>
            <input autoFocus value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${label.toLowerCase()}…`}
              className="w-full px-2 py-1.5 text-xs bg-ww-bg border border-ww-border rounded-md text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {entries.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-ww-textFaint italic text-center">
                Nenhum valor encontrado
              </div>
            )}
            {entries.map(([val, cnt]) => {
              const on = selected.has(val);
              return (
                <button key={val} onClick={() => onToggle(val)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-ww-rowHover transition text-left">
                  <span className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                    on ? "bg-ww-accent border-ww-accent" : "border-ww-border bg-ww-panel"
                  }`}>
                    {on && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 text-[11px] truncate text-ww-text">{val}</span>
                  <span className="text-[10px] font-semibold text-ww-textFaint tabular-nums font-mono">{cnt}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-ww-border p-1 flex items-center gap-1">
            <button
              onClick={() => { if (count > 0) { onClear(); setOpen(false); } }}
              disabled={count === 0}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium rounded-md transition text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              {count > 0 ? `Limpar todos (${count})` : "Limpar todos"}
            </button>
            <button onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-[11px] font-semibold text-white bg-ww-accent hover:opacity-90 rounded-md transition">
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────

function IconAll() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7v5l3 2"/>
    </svg>
  );
}
function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}
function IconOpenBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l-9 4.5v9L12 21l9-4.5v-9L12 3z"/>
      <path d="M3 7.5L12 12l9-4.5"/>
      <path d="M12 12v9"/>
    </svg>
  );
}
function IconClosedBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <path d="M12 22.08V12"/>
      <path d="M9 11l6 0"/>
    </svg>
  );
}
function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86l-8.3 14.14A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.71-2.99l-8.3-14.14a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function fmtDate(d: unknown): string {
  if (!d) return "—";
  try {
    return new Date(String(d)).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}
