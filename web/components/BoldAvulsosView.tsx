"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { STATUS_META, STATUS_ORDER, isApproved, groupsFor, formatCell, type Group } from "@/lib/columns";
import { useUserPerms } from "./UserPermsProvider";
import { canApprove, canEdit, type BlockKey } from "@/lib/permissions";
import EditableCell from "./EditableCell";
import EditableStatusCell from "./EditableStatusCell";
import RcExcelDropZone from "./RcExcelDropZone";
import AddRowButton from "./AddRowButton";
import GlobalSearch from "./GlobalSearch";

type AnyRow = Record<string, unknown>;
type StatusFilter = "todos" | "aprovados" | "nao_aprovados" | "pendentes" | "atrasados";
type PvEtapaGroup = "todos" | "aberto" | "fechado";
type ServicosFilter = "todos" | "concluidos" | "agendados" | "sem_os";

// Etapas que contam como "Exec./Faturado" — pré-faturamento, já faturado ou cancelado
const ETAPAS_FECHADAS = new Set(["Entrega", "Faturado", "Cancelado"]);
type FacetKey = "pv_etapa_texto" | "projeto_nome" | "tipo_omie" | "pc_etapa_texto" | "codigo_categoria" | "contato_fornecedor";
type FacetState = Partial<Record<FacetKey, Set<string>>>;

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "pv_etapa_texto",     label: "Etapa Venda" },
  { key: "projeto_nome",       label: "Projeto" },
  { key: "tipo_omie",          label: "Tipo Omie" },
  { key: "pc_etapa_texto",     label: "Etapa PC" },
  { key: "codigo_categoria",   label: "Categoria" },
  { key: "contato_fornecedor", label: "Fornecedor" },
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

// Atraso (Venda): hoje > pv_data_previsao (BR DD/MM/YYYY).
// Atraso (Compra): hoje > dt_previsao do PC (BR DD/MM/YYYY).
function isAtrasoVenda(r: AnyRow, todayStartMs: number): boolean {
  const s = String(r.pv_data_previsao ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
  return !isNaN(t) && t < todayStartMs;
}
function isAtrasoCompra(r: AnyRow, todayStartMs: number): boolean {
  const s = String(r.dt_previsao ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}`);
  return !isNaN(t) && t < todayStartMs;
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

  // PostgREST corta resultset em 1000 rows. SSR pega só primeira página rápido;
  // cliente busca páginas extras em background pra completar (até 5000 rows).
  const [rows, setRows] = useState<AnyRow[]>(initialRows);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    // Se já recebemos < 1000 rows, não há mais nada
    if (initialRows.length < 1000) return;
    if (totalCount != null && initialRows.length >= totalCount) return;
    const view = modulo === "pcs" ? "v_pc_pcs" : modulo === "projetos" ? "v_pc_projetos" : "v_pc_avulsos";
    const ctrl = new AbortController();
    setLoadingMore(true);
    (async () => {
      try {
        const extra: AnyRow[] = [];
        for (let from = 1000; from < 5000; from += 1000) {
          const r = await fetch(`/api/rows?view=${view}&from=${from}&to=${from + 999}`, { signal: ctrl.signal });
          if (!r.ok) break;
          const j = await r.json();
          const got = (j.rows ?? []) as AnyRow[];
          extra.push(...got);
          if (got.length < 1000) break;
        }
        if (extra.length) setRows((prev) => [...prev, ...extra]);
      } catch { /* aborted ou network — ignora */ }
      finally { setLoadingMore(false); }
    })();
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [pvEtapaGroup, setPvEtapaGroup] = useState<PvEtapaGroup>("todos");
  const [servicosFilter, setServicosFilter] = useState<ServicosFilter>("todos");
  const [kpisOpen, setKpisOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ kind: "off" });
  type AtrasoKind = "off" | "venda" | "compra";
  const [atraso, setAtraso] = useState<AtrasoKind>("off");
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
  // Predicado central de filtros — aceita opção pra pular um facet específico,
  // permitindo calcular facetValues sem o filtro do próprio facet (assim cada
  // dropdown segue mostrando todas as opções possíveis dado o resto do estado).
  const passesFilters = useCallback((r: AnyRow, opts: { skipFacet?: FacetKey } = {}) => {
    const q = query.trim().toLowerCase();
    if (dateWindow && !isRowInWindow(r, dateWindow.from, dateWindow.to)) return false;
    if (atraso === "venda"  && !isAtrasoVenda(r, todayStartMs))  return false;
    if (atraso === "compra" && !isAtrasoCompra(r, todayStartMs)) return false;
    if (modulo !== "pcs") {
      const etapa = String(r.pv_etapa_texto ?? "");
      if (pvEtapaGroup === "aberto" && ETAPAS_FECHADAS.has(etapa)) return false;
      if (pvEtapaGroup === "fechado" && !ETAPAS_FECHADAS.has(etapa)) return false;
    }
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
    if (modulo === "avulsos") {
      const temOs = !!String(r.servicos_os_numero ?? "").trim();
      const concluido = !!r.servicos_concluidos;
      if (servicosFilter === "concluidos" && !concluido) return false;
      if (servicosFilter === "agendados" && !(temOs && !concluido)) return false;
      if (servicosFilter === "sem_os" && temOs) return false;
    }
    for (const [key, set] of Object.entries(facets)) {
      if (opts.skipFacet === key) continue;  // ignora o próprio facet ao calcular suas opções
      if (!set || set.size === 0) continue;
      if (!set.has(String(r[key as FacetKey] ?? ""))) return false;
    }
    if (!q) return true;
    const hay = [r.pc_numero, r.pv_os_label, r.projeto_nome, r.pv_cliente_fantasia, r.contato_fornecedor, r.rc_numero, r.rc_descricao]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }, [query, dateWindow, atraso, todayStartMs, modulo, pvEtapaGroup, statusFilter, servicosFilter, facets, effectiveStatus]);

  const filtered = useMemo(() => rows.filter((r) => passesFilters(r)), [rows, passesFilters]);

  // Contagens absolutas (sobre rows totais) pra exibir no botão de cada filtro
  const atrasoVendaCount = useMemo(() =>
    rows.reduce((acc, r) => acc + (isAtrasoVenda(r, todayStartMs)  ? 1 : 0), 0),
    [rows, todayStartMs]
  );
  const atrasoCompraCount = useMemo(() =>
    rows.reduce((acc, r) => acc + (isAtrasoCompra(r, todayStartMs) ? 1 : 0), 0),
    [rows, todayStartMs]
  );

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

  // Contagem de rows por grupo de etapa
  const pvEtapaCounts = useMemo(() => {
    let aberto = 0, fechado = 0;
    for (const r of rows) {
      const etapa = String(r.pv_etapa_texto ?? "");
      if (ETAPAS_FECHADAS.has(etapa)) fechado++;
      else aberto++;
    }
    return { todos: rows.length, aberto, fechado };
  }, [rows]);


  // Valores únicos por facet — calcula PRA CADA facet ignorando o filtro do
  // próprio facet, pra que selecionar "Entrega" não some as opções "Faturado"
  // etc do mesmo dropdown (multi-select continua viável depois do 1º click).
  const facetValues = useMemo(() => {
    const acc: Record<FacetKey, Map<string, number>> = {
      pv_etapa_texto: new Map(),
      projeto_nome: new Map(), tipo_omie: new Map(), pc_etapa_texto: new Map(),
      codigo_categoria: new Map(), contato_fornecedor: new Map(),
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

  // Rows base = rows após aplicar Date Range + Atraso (que afetam TUDO incluindo
  // os contadores dos cards de PV-Status / PC-Aprovação acima). É a primeira
  // camada de filtragem visível pro usuário.
  const rowsAfterDateAtraso = useMemo(() => {
    return rows.filter((r) => {
      if (dateWindow && !isRowInWindow(r, dateWindow.from, dateWindow.to)) return false;
      if (atraso === "venda"  && !isAtrasoVenda(r, todayStartMs))  return false;
      if (atraso === "compra" && !isAtrasoCompra(r, todayStartMs)) return false;
      return true;
    });
  }, [rows, dateWindow, atraso, todayStartMs]);

  // Rows após aplicar (Date+Atraso+pvEtapaGroup), sem statusFilter/facets/query.
  // Usado pra calcular contagens dos KPIs de status com o filtro primário ativo.
  const rowsAfterPvEtapa = useMemo(() => {
    if (pvEtapaGroup === "todos") return rowsAfterDateAtraso;
    return rowsAfterDateAtraso.filter((r) => {
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
      allPv.add(lbl);
      if (isApproved(s)) { aprov++; aprovPv.add(lbl); }
      else if (s === "PENDENTE") { pend++; pendPv.add(lbl); }
      else { naoAprov++; naoAprovPv.add(lbl); }
      const d = r.aprovar_ate_calc as string | null;
      if (d && !isApproved(s)) {
        const dt = new Date(d);
        if (!Number.isNaN(dt.getTime()) && dt < today) { atras++; atrasPv.add(lbl); }
      }
      if (r.sem_projeto === true) semProj++;
    }
    return {
      total, totalPv: allPv.size,
      aprov, aprovPv: aprovPv.size,
      pend, pendPv: pendPv.size,
      naoAprov, naoAprovPv: naoAprovPv.size,
      atras, atrasPv: atrasPv.size,
      semProj,
    };
  }, [rowsAfterPvEtapa, modulo]);

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
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{fmtBRL(kpis.totalValor)}</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">{kpis.total} itens · {kpis.pvUnicos} PV/OS</div>
            </div>
            {/* Ticket Médio */}
            <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50/60 dark:bg-cyan-950/30 p-3 text-cyan-900 dark:text-cyan-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Ticket Médio (PV/OS)</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{fmtBRL(kpis.ticketMedio)}</div>
              <div className="text-[10px] opacity-65 mt-0.5 tabular-nums">média por PV/OS</div>
            </div>
            {/* Total Aprovado */}
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 text-emerald-900 dark:text-emerald-100">
              <div className="text-[9px] uppercase tracking-[0.5px] font-semibold opacity-70">Volume Aprovado</div>
              <div className="text-[18px] font-semibold tabular-nums tracking-[-0.4px] mt-1">{fmtBRL(kpis.aprovValor)}</div>
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

      {/* Duas caixas: PV - Status (esquerda) | PC - Aprovação (direita).
          Em /pcs (PC Standalone) não há PV → ocultamos a CAIXA 1 e a CAIXA 2
          ocupa toda a linha. */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-stretch">
        {/* CAIXA 1 — PV - Status (Aberto / Exec./Faturado) — só avulsos/projetos */}
        {modulo !== "pcs" && (
        <div className="md:col-span-2 bg-ww-panel border border-ww-border rounded-xl p-3 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.6px] font-bold text-ww-textMuted mb-2 px-0.5">PV — Status</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: "aberto",  label: "Aberto",         value: pvEtapaCounts.aberto,
                bg: "bg-blue-50 dark:bg-blue-950/40",       bgActive: "bg-blue-600 dark:bg-blue-500",
                border: "border-blue-200 dark:border-blue-800", borderActive: "border-blue-800 dark:border-blue-300",
                text: "text-blue-900 dark:text-blue-100", textActive: "text-white",
                iconBg: "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-100",
                iconBgActive: "bg-white/25 text-white", icon: <IconOpenBox /> },
              { key: "fechado", label: "Exec./Faturado", value: pvEtapaCounts.fechado,
                bg: "bg-emerald-50 dark:bg-emerald-950/40", bgActive: "bg-emerald-600 dark:bg-emerald-500",
                border: "border-emerald-200 dark:border-emerald-800", borderActive: "border-emerald-800 dark:border-emerald-300",
                text: "text-emerald-900 dark:text-emerald-100", textActive: "text-white",
                iconBg: "bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-100",
                iconBgActive: "bg-white/25 text-white", icon: <IconClosedBox /> },
            ] as const).map((k) => {
              const active = pvEtapaGroup === k.key;
              return (
                <button key={k.key}
                  onClick={() => setPvEtapaGroup(active ? "todos" : (k.key as PvEtapaGroup))}
                  className={`relative rounded-lg border-2 text-left p-2.5 transition-all hover:-translate-y-0.5 ${
                    active
                      ? `${k.bgActive} ${k.borderActive} shadow-md ${k.textActive}`
                      : `${k.bg} ${k.border} hover:shadow-sm hover:border-current ${k.text}`
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? k.iconBgActive : k.iconBg}`}>
                      {k.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[20px] font-bold tracking-[-0.4px] tabular-nums leading-none">{fmtNum(k.value)}</span>
                        <span className="text-[10px] font-semibold opacity-80">itens</span>
                      </div>
                      <div className="text-[10.5px] mt-0.5 font-bold tracking-[0.4px] uppercase truncate">{k.label}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {modulo === "avulsos" && (
            <div className="mt-2 pt-2 border-t border-ww-border flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.5px] font-bold text-ww-textMuted mr-1">Serviços:</span>
              {([
                { key: "todos",      label: "Todos" },
                { key: "concluidos", label: "✅ Executados" },
                { key: "agendados",  label: "🕓 Agendados" },
                { key: "sem_os",     label: "Sem OS" },
              ] as const).map((k) => {
                const active = servicosFilter === k.key;
                return (
                  <button key={k.key}
                    onClick={() => setServicosFilter(k.key as ServicosFilter)}
                    className={`px-2 py-0.5 rounded-md text-[10.5px] font-medium border transition ${
                      active
                        ? "bg-ww-accent text-white border-ww-accent"
                        : "bg-ww-bg text-ww-textMuted border-ww-border hover:border-ww-accent hover:text-ww-text"
                    }`}>
                    {k.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* CAIXA 2 — PC - Aprovação (Todos / Aprovados / Pendentes / Não aprov.) — reflete PV - Status */}
        <div className={`${modulo === "pcs" ? "md:col-span-6" : "md:col-span-4"} bg-ww-panel border border-ww-border rounded-xl p-3 shadow-sm`}>
          <div className="text-[11px] uppercase tracking-[0.6px] font-bold text-ww-textMuted mb-2 px-0.5 flex items-center gap-1.5">
            <span>PC — Aprovação</span>
            {modulo !== "pcs" && pvEtapaGroup !== "todos" && <span className="text-ww-accent normal-case font-semibold">· filtrado pelo PV</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              { key: "todos",         label: "Todos",         value: summary.total,    pvCount: summary.totalPv,
                bg: "bg-slate-100 dark:bg-slate-800/60", bgActive: "bg-slate-800 dark:bg-slate-200",
                border: "border-slate-300 dark:border-slate-700", borderActive: "border-slate-900 dark:border-slate-50",
                text: "text-slate-900 dark:text-slate-100", textActive: "text-white dark:text-slate-900",
                iconBg: "bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200",
                iconBgActive: "bg-white/25 text-white dark:bg-slate-900/30 dark:text-slate-900", icon: <IconAll /> },
              { key: "aprovados",     label: "Aprovados",     value: summary.aprov,    pvCount: summary.aprovPv,
                bg: "bg-emerald-50 dark:bg-emerald-950/40", bgActive: "bg-emerald-600 dark:bg-emerald-500",
                border: "border-emerald-200 dark:border-emerald-800", borderActive: "border-emerald-800 dark:border-emerald-300",
                text: "text-emerald-900 dark:text-emerald-100", textActive: "text-white",
                iconBg: "bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-100",
                iconBgActive: "bg-white/25 text-white", icon: <IconCheck /> },
              { key: "pendentes",     label: "Pendentes",     value: summary.pend,     pvCount: summary.pendPv,
                bg: "bg-amber-50 dark:bg-amber-950/40", bgActive: "bg-amber-500 dark:bg-amber-400",
                border: "border-amber-200 dark:border-amber-800", borderActive: "border-amber-700 dark:border-amber-200",
                text: "text-amber-900 dark:text-amber-100", textActive: "text-white dark:text-amber-950",
                iconBg: "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-100",
                iconBgActive: "bg-white/25 text-white dark:bg-amber-950/30 dark:text-amber-950", icon: <IconClock /> },
              { key: "nao_aprovados", label: "Não aprov.",    value: summary.naoAprov, pvCount: summary.naoAprovPv,
                bg: "bg-rose-50 dark:bg-rose-950/40", bgActive: "bg-rose-600 dark:bg-rose-500",
                border: "border-rose-200 dark:border-rose-800", borderActive: "border-rose-800 dark:border-rose-300",
                text: "text-rose-900 dark:text-rose-100", textActive: "text-white",
                iconBg: "bg-rose-200 dark:bg-rose-800 text-rose-800 dark:text-rose-100",
                iconBgActive: "bg-white/25 text-white", icon: <IconX /> },
            ] as const).map((k) => {
              const active = statusFilter === k.key;
              return (
                <button key={k.key}
                  onClick={() => setStatusFilter(k.key as StatusFilter)}
                  className={`relative rounded-lg border-2 text-left p-2.5 transition-all hover:-translate-y-0.5 ${
                    active
                      ? `${k.bgActive} ${k.borderActive} shadow-md ${k.textActive}`
                      : `${k.bg} ${k.border} hover:shadow-sm hover:border-current ${k.text}`
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${active ? k.iconBgActive : k.iconBg}`}>
                      {k.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[20px] font-bold tracking-[-0.4px] tabular-nums leading-none">{fmtNum(k.value)}</span>
                        <span className="text-[10px] font-semibold opacity-80">itens</span>
                      </div>
                      <div className="text-[10.5px] mt-0.5 flex items-center gap-1 truncate">
                        <span className="font-bold tracking-[0.4px] uppercase truncate">{k.label}</span>
                        <span className="opacity-60">·</span>
                        <span className="tabular-nums font-semibold">{fmtNum(k.pvCount)} {modulo === "pcs" ? "PC" : "PV"}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hero command bar — abaixo dos cards: usuário primeiro escolhe contexto
          (PV-Status / PC-Aprovação) e depois busca/filtra dentro dele */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-ww-panel border border-ww-border rounded-[10px] shadow-[0_1px_0_rgba(0,0,0,0.03),0_6px_20px_-14px_rgba(0,0,0,0.1)] dark:shadow-none">
        <span className="font-mono text-[10px] text-ww-textMuted uppercase tracking-wider font-bold px-1.5 py-0.5 bg-ww-bg rounded">Filtro</span>
        <div className="w-px h-3.5 bg-ww-border" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filtrar nesta página: PC, fornecedor, projeto, RC…"
          className="flex-1 bg-transparent outline-none text-[14px] font-medium text-ww-text placeholder:text-ww-textMuted placeholder:font-medium"
        />
        <DateRangeButton range={dateRange} onChange={setDateRange} />
        <span className="font-mono text-[10px] text-ww-textMuted font-semibold">tab pra ações</span>
      </div>

      {/* Atrasos: pode ser ativado independente, filtra rows com pv_data_previsao
          ou dt_previsao no passado. Combina com Date Range / Status / Etapa. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-ww-textMuted font-mono font-bold mr-1">Atrasos:</span>
        <AtrasoButton kind="venda"  active={atraso === "venda"}  count={atrasoVendaCount}
          onToggle={() => setAtraso((v) => v === "venda"  ? "off" : "venda")} />
        <AtrasoButton kind="compra" active={atraso === "compra"} count={atrasoCompraCount}
          onToggle={() => setAtraso((v) => v === "compra" ? "off" : "compra")} />
      </div>

      {/* Facets — filtros multi-select que existiam antes */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-ww-textMuted font-mono font-bold mr-1">Filtrar:</span>
        {FACETS.map(({ key, label }) => (
          <FacetDropdown key={key} label={label}
            values={facetValues[key]} selected={facets[key] ?? new Set()}
            onToggle={(v) => toggleFacet(key, v)} onClear={() => clearFacet(key)} />
        ))}
        {(() => {
          const hasFacets   = Object.values(facets).some((s) => s && s.size > 0);
          const hasStatus   = statusFilter !== "todos";
          const hasPvEtapa  = pvEtapaGroup !== "todos";
          const hasServicos = servicosFilter !== "todos";
          const hasAtraso   = atraso !== "off";
          const hasDate     = dateRange.kind !== "off";
          const hasQuery    = query.trim() !== "";
          const anyFilter   = hasFacets || hasStatus || hasPvEtapa || hasServicos || hasAtraso || hasDate || hasQuery;
          return (
            <button
              onClick={() => {
                if (!anyFilter) return;
                setFacets({});
                setStatusFilter("todos");
                setPvEtapaGroup("todos");
                setServicosFilter("todos");
                setAtraso("off");
                setDateRange({ kind: "off" });
                setQuery("");
              }}
              disabled={!anyFilter}
              className={`ml-2 inline-flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold rounded-md border transition shadow-sm ${
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

      {/* Total visível — painel com soma RC/PC/PV reagindo ao filtro atual */}
      <GrandTotalBar grand={grandTotal} modulo={modulo} count={filtered.length} />

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
  bucket, modulo, isAdmin, userCanApprove, userCanEdit, open, onToggle, onRowClick, onStatusClick, selected, toggleSel, visibleGroups, onEnsureOpen, optimisticStatus,
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
}) {
  const items = bucket.rows;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // groupKey alvo do scroll quando o card abre; reseta após executar
  const pendingScroll = useRef<string | null>(null);

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

  // Pipeline stages — cada um mapeia pra um groupKey (block) clicável
  const stages = useMemo(() => {
    const hasRC = items.some((r) => r.rc_numero);
    const hasPC = items.some((r) => r.pc_numero || r.pc_numero_manual);
    const pcsCount = items.filter((r) => r.pc_numero || r.pc_numero_manual).length;
    const aprovCount = aprovCountInBucket;
    const hasLog = items.some((r) => r.mt_status_fornecimento);
    const pvosDetail =
      bucket.groupKind === "project" ? `${bucket.pvOsCount ?? 0} PV/OS` :
      bucket.groupKind === "etapa"   ? `${items.length} PC(s)` :
      bucket.groupKind === "pc"      ? (String(items[0]?.pv_os_label ?? "—")) :
      bucket.pv_os_label;
    // /pcs Standalone NÃO tem RC associado → omitimos esse stage do Pipeline
    const allStages = [
      { label: "PV/OS",     done: true,             detail: pvosDetail,                              groupKey: "pvos" },
      { label: "RC",        done: hasRC,            detail: `${items.length} itens`,                 groupKey: "rc" },
      { label: "PC",        done: hasPC,            detail: `${pcsCount}/${items.length} emitidos`, groupKey: "pc" },
      { label: "Aprovação", done: allPcsApproved,   detail: `${aprovCount}/${pcRowsForApproval.length} PCs ok`, groupKey: "aprovacao" },
      { label: "Logística", done: hasLog,           detail: hasLog ? "andamento" : "aguardando",     groupKey: "log" },
    ];
    return modulo === "pcs" ? allStages.filter((s) => s.groupKey !== "rc") : allStages;
  }, [items, bucket.pv_os_label, bucket.groupKind, bucket.pvOsCount, modulo,
      allPcsApproved, aprovCountInBucket, pcRowsForApproval.length]);

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

  return (
    <div className="bg-ww-panel border-2 border-ww-borderStrong rounded-[12px] overflow-hidden shadow-md min-w-0 max-w-full">
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
        style={{ gridTemplateColumns: modulo === "pcs" ? "200px 1fr 160px 32px" : "200px 1fr 380px 32px" }}>
        <div className="min-w-0">
          {bucket.groupKind === "project" ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold tracking-[-0.2px] text-ww-text truncate">{bucket.pv_os_label}</span>
                <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} item(s)</span>
              </div>
              <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.pvOsCount ?? 0} PV/OS no projeto</div>
              <div className="text-[11.5px] text-ww-textFaint mt-0.5 truncate">{bucket.cliente ?? "—"}</div>
            </>
          ) : bucket.groupKind === "etapa" ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold tracking-[-0.2px] text-ww-text truncate">{bucket.pv_os_label}</span>
                <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} PC(s)</span>
              </div>
              <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate uppercase tracking-[0.4px] font-semibold">Etapa do PC</div>
            </>
          ) : bucket.groupKind === "pc" ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[13px] font-semibold tracking-[-0.2px] text-ww-text">PC {bucket.pv_os_label}</span>
                <span className="text-[10px] font-mono text-ww-textFaint">· {String(items[0]?.empresa ?? "—")}</span>
              </div>
              <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.cliente ?? "— sem fornecedor —"}</div>
              <div className="text-[11.5px] text-ww-textFaint mt-0.5 truncate">{bucket.projeto ?? "—"}</div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[13px] font-semibold tracking-[-0.2px] text-ww-text">{bucket.pv_os_label}</span>
                {bucket.pv_os_tipo && (
                  <span className="text-[11px] font-mono text-ww-textFaint px-1.5 py-px border border-ww-border rounded uppercase tracking-[0.5px]">{bucket.pv_os_tipo}</span>
                )}
                <span className="text-[10px] font-mono text-ww-textFaint">· {items.length} item(s)</span>
              </div>
              <div className="text-[11.5px] text-ww-textMuted mt-0.5 truncate">{bucket.cliente ?? "—"}</div>
              <div className="text-[11.5px] text-ww-textFaint mt-0.5 font-mono truncate">{bucket.projeto ?? "—"}</div>
            </>
          )}
        </div>

        <Pipeline stages={stages} onStageClick={handleStageClick} />

        <BucketTotals bucket={bucket} items={items} modulo={modulo} />

        <div className="flex items-center justify-end gap-1">
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
              className="text-ww-textFaint hover:text-rose-600 transition p-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
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
          {visibleGroups.length === 0 ? null : (
            <div ref={tableContainerRef} className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                {/* Header em 2 camadas: grupos com tint + colunas */}
                <thead>
                  <tr>
                    {(userCanApprove || userCanEdit) && (
                      <th className="bg-ww-bg w-8" rowSpan={2}></th>
                    )}
                    {visibleGroups.map((g) => (
                      <th key={g.key} colSpan={g.columns.length} data-group={g.key}
                        className={`px-3 py-2 text-[13px] font-semibold text-left text-ww-text ${g.tint} border-b-2 border-r border-ww-borderStrong last:border-r-0`}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {flatCols.map(({ col, group }, i) => (
                      <th key={`${col.key}-${i}`}
                        className={`px-2.5 py-1.5 text-[12px] font-semibold border-b border-r border-ww-border/60 last:border-r-0 whitespace-nowrap ${
                          col.editable
                            ? `${group.tint}/40 text-ww-text`
                            : "text-ww-textMuted"
                        } ${alignClassFor(col)}`}>
                        {col.editable && <span className="text-amber-600 dark:text-amber-400 mr-0.5" title="Editável">✎</span>}
                        {col.label.replace(/^\*/, "")}
                      </th>
                    ))}
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
                          return (
                            <td key={`${col.key}-${j}`}
                              rowSpan={isMerged && runSize > 1 ? runSize : undefined}
                              onClick={(e) => { if (col.editable) e.stopPropagation(); }}
                              className={`px-2 py-1 align-middle whitespace-nowrap border-r border-ww-border/60 last:border-r-0 ${
                                col.editable
                                  ? `${group.tint}/70`
                                  : `${group.tint}/15`
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
              é projeto); RcExcelDropZone só em modo PV/OS pois precisa de destino único. */}
          {userCanEdit && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-ww-border bg-ww-bg flex-wrap">
              <div className="flex items-center gap-2">
                {bucket.groupKind === "pvos" && (
                  <RcExcelDropZone empresa={bucket.rows[0]?.empresa as string ?? "SF"}
                    pv_os_label={bucket.pv_os_label} modulo={modulo} />
                )}
                <AddRowButton empresa={bucket.rows[0]?.empresa as string ?? "SF"}
                  pv_os_label={bucket.groupKind === "pvos" ? bucket.pv_os_label : null}
                  modulo={modulo}
                  pvOsOptions={bucket.groupKind === "pvos" ? undefined : [...new Set(bucket.rows.map(r => String(r.pv_os_label ?? "")).filter(Boolean))]} />
              </div>
              <span className="text-[10px] text-ww-textFaint font-mono">
                {items.length} item(s){bucket.groupKind === "pvos" ? " · upload XLSX preenche linhas em branco primeiro" : ""}
              </span>
            </div>
          )}
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

function Cell({
  row, col, modulo, onStatusClick, optimisticStatus,
}: {
  row: AnyRow;
  col: import("@/lib/columns").Column;
  modulo: "avulsos" | "projetos" | "pcs";
  onStatusClick: (anchor: DOMRect) => void;
  optimisticStatus?: Record<string, string>;
}) {
  const empresa = String(row.empresa ?? "SF");
  const ncod_ped = Number(row.ncod_ped ?? 0);
  const valorPc = row.valor_total != null ? Number(row.valor_total) : null;
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
          <EditableCell empresa={empresa} ncod_ped={ncod_ped}
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
          <EditableCell empresa={empresa} ncod_ped={ncod_ped}
            field={col.editableField} kind={col.editable as "date" | "text" | "number" | "money" | "textarea"}
            initialValue={value} />
          {incompleto && (
            <span title="Dados incompletos no Omie (sem valor ou fornecedor) — corrija no Omie e aguarde próximo sync"
              className="text-amber-600 dark:text-amber-400 text-[14px] cursor-help">⚠</span>
          )}
        </div>
      );
    }
    return (
      <EditableCell empresa={empresa} ncod_ped={ncod_ped}
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

  return <span className={col.format === "mono" ? "font-mono text-[12px]" : "text-[12px] text-ww-text"}>
    {formatCell(value, col.format)}
  </span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────

function Pipeline({
  stages, onStageClick,
}: {
  stages: { label: string; done: boolean; detail: string; groupKey: string }[];
  onStageClick?: (groupKey: string) => void;
}) {
  return (
    <div className="flex items-start">
      {stages.map((s, i) => {
        const dotCls = s.done
          ? "bg-ww-accent shadow-[0_0_0_3px_rgb(var(--color-ww-accentSoft))] group-hover:scale-125 group-hover:shadow-[0_0_0_5px_rgb(var(--color-ww-accentSoft))]"
          : "bg-ww-panel border-[1.5px] border-ww-borderStrong group-hover:border-sky-500 group-hover:scale-110";
        const labelCls = s.done ? "text-ww-text" : "text-ww-textFaint";
        return (
          <div key={s.label} className="flex items-start contents">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStageClick?.(s.groupKey); }}
              title={`Ir para o bloco ${s.label}`}
              className="flex-1 flex flex-col items-center gap-0.5 min-w-0 group cursor-pointer">
              <span className={`w-2.5 h-2.5 rounded-full inline-block z-10 transition-all ${dotCls}`} />
              <span className={`text-[10px] font-semibold uppercase tracking-[0.5px] mt-1.5 transition ${labelCls} group-hover:text-sky-700 dark:group-hover:text-sky-400`}>{s.label}</span>
              <span className="text-[10px] text-ww-textFaint text-center truncate max-w-full px-0.5">{s.detail}</span>
            </button>
            {i < stages.length - 1 && (
              <div className={`w-6 mt-1.5 ${stages[i + 1].done ? "bg-ww-accent" : "bg-ww-border"}`} style={{ height: 1.5 }} />
            )}
          </div>
        );
      })}
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

function AtrasoButton({
  kind, active, count, onToggle,
}: {
  kind: "venda" | "compra"; active: boolean; count: number; onToggle: () => void;
}) {
  const cfg = kind === "venda"
    ? { label: "Atraso Venda",  hint: "Hoje > V.Previsão Limite_Omie",
        cls: "bg-rose-600 dark:bg-rose-500 border-rose-800 dark:border-rose-300 text-white shadow-sm",
        countCls: "bg-white/20 text-white" }
    : { label: "Atraso Compra", hint: "Hoje > Previsão PC",
        cls: "bg-violet-600 dark:bg-violet-500 border-violet-800 dark:border-violet-300 text-white shadow-sm",
        countCls: "bg-white/20 text-white" };
  return (
    <button onClick={onToggle} title={cfg.hint}
      className={`flex items-center gap-1.5 text-[11.5px] font-semibold rounded-md border px-2 py-1 transition ${
        active ? cfg.cls : "bg-ww-bg border-ww-border text-ww-textMuted hover:text-ww-text hover:border-ww-borderStrong"
      }`}>
      <span>⚠</span>
      <span>{cfg.label}</span>
      {count > 0 && (
        <span className={`text-[10px] font-bold tabular-nums px-1 rounded ${active ? cfg.countCls : "bg-ww-rowHover"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GrandTotalBar — soma RC/PC/PV de tudo que está visível (após filtros)
// ─────────────────────────────────────────────────────────────────────────

function GrandTotalBar({
  grand, modulo, count,
}: {
  grand: { rc: number; pc: number; pv: number };
  modulo: "avulsos" | "projetos" | "pcs";
  count: number;
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
          {showRcPv && <GrandTotalCell label="RC" value={grand.rc} />}
          {showRcPv && <span className="h-6 w-px bg-ww-border" />}
          <GrandTotalCell label="PC" value={grand.pc} highlight={!showRcPv} />
          {showRcPv && <span className="h-6 w-px bg-ww-border" />}
          {showRcPv && <GrandTotalCell label="PV" value={grand.pv} />}
        </div>
      </div>
    </div>
  );
}

function GrandTotalCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textMuted">{label}</span>
      <span className={`text-[18px] font-semibold tabular-nums tracking-[-0.3px] ${highlight ? "text-ww-accent" : "text-ww-text"}`}>
        {value > 0 ? fmtBRL(value) : "—"}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BucketTotals — 3 totais (RC / PC / PV) + indicador de qualidade (RC/PC)
// ─────────────────────────────────────────────────────────────────────────

function BucketTotals({
  bucket, items, modulo,
}: {
  bucket: Bucket; items: AnyRow[]; modulo: "avulsos" | "projetos" | "pcs";
}) {
  // pvos: window functions já trazem os totais por PV/OS, todos rows do bucket
  // têm o mesmo valor. Usamos rows[0].
  // project: agregamos por PV/OS distinto e somamos.
  // pc: 1 bucket = 1 PC; PCs Standalone não têm RC nem PV próprios.
  let rcTotal = 0, pcTotal = 0, pvTotal = 0;
  let indicatorSymbol = "—";

  if (bucket.groupKind === "pvos") {
    const r = items[0] ?? {};
    rcTotal = Number(r.rc_custo_total_calc ?? 0);
    pcTotal = Number(r.pc_custo_total_calc ?? 0);
    pvTotal = Number(r.pv_valor_total ?? 0);
    const ind = String(r.rc_pc_vs_rc ?? "").trim();
    indicatorSymbol = ind ? ind.split(" ")[0] : "—";
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
    if (rcTotal > 0 && pcTotal > 0) {
      const pct = ((pcTotal / rcTotal) - 1) * 100;
      indicatorSymbol = pct < 0 ? "💎" : pct === 0 ? "🟢" : "🚫";
    }
  } else if (bucket.groupKind === "pc") {
    // PC Standalone: só PC; SEM RC, SEM PV
    const r = items[0] ?? {};
    pcTotal = Number(r.valor_total ?? 0);
  }

  // /pcs: layout enxuto — só PC + indicador placeholder (sem RC/PC).
  // avulsos/projetos: 3 totais (RC/PC/PV) + indicador RC/PC.
  const isPcs = modulo === "pcs";

  return (
    <div className="flex items-stretch">
      <div className={`grid ${isPcs ? "grid-cols-1" : "grid-cols-3"} flex-1`}>
        {isPcs ? (
          <TotalCol label="PC" value={pcTotal} />
        ) : (
          <>
            <TotalCol label="RC" value={rcTotal} />
            <TotalCol label="PC" value={pcTotal} withDivider />
            <TotalCol label="PV" value={pvTotal} withDivider />
          </>
        )}
      </div>
      {!isPcs && (
        <>
          {/* Divisor tracejado discreto entre os totais e o indicador */}
          <div className="self-stretch border-l border-dashed border-ww-border mx-3" />
          <div className="text-center flex flex-col justify-center min-w-[48px]">
            <div className="text-[10px] uppercase tracking-[0.6px] text-ww-textMuted font-bold mb-1">RC/PC</div>
            <div className="text-[22px] leading-none">{indicatorSymbol}</div>
          </div>
        </>
      )}
    </div>
  );
}

function TotalCol({ label, value, withDivider }: { label: string; value: number; withDivider?: boolean }) {
  return (
    <div className={`text-center relative ${withDivider ? "pl-3" : ""}`}>
      {withDivider && (
        <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-px bg-ww-border" />
      )}
      <div className="text-[10px] uppercase tracking-[0.6px] text-ww-textMuted font-bold mb-1">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums text-ww-text leading-tight">
        {value > 0 ? fmtBRL(value) : "—"}
      </div>
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
