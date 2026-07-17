// Helper compartilhado do report Avulsos.
// - Calcula counts/vals por AlarmKind idêntico ao painel (BoldAvulsosView)
// - Define mapeamento AlarmKind → responsável (nome exibido no report)
// - Constrói URLs de deep-link pra painel filtrado

import { supaAdmin } from "./supabase-admin";

export type AlarmKind =
  | "pvos_incompl"
  | "sem_projeto"
  | "venda"
  | "compra"
  | "sem_rc"
  | "sem_pc"
  | "aprov_pend"
  | "defas_omie"
  | "sem_vinculo"
  | "agend_vazio"
  | "agend_venc"
  | "pode_faturar";

// Ordem de exibição no report + label humano
export const REPORT_SECTIONS: {
  title: string;
  emoji: string;
  items: { kind: AlarmKind; label: string }[];
}[] = [
  {
    title: "VENDAS", emoji: "🛍️",
    items: [
      { kind: "pvos_incompl", label: "PV/OS incompletas (cadastro faltando)" },
      { kind: "sem_projeto",  label: "Sem Projeto (vendedor não marcou)" },
      { kind: "venda",        label: "Vendas em atraso" },
    ],
  },
  {
    title: "COMPRAS", emoji: "📦",
    items: [
      { kind: "sem_rc",     label: "Faltam RCs ou incompletos" },
      { kind: "aprov_pend", label: "Aprovações pendentes" },
      { kind: "sem_pc",     label: "Faltam PCs ou incompletos" },
      { kind: "compra",     label: "Previsão atrasada" },
      { kind: "defas_omie", label: "Defasagem de Aprovação Omie" },
    ],
  },
  {
    title: "SERVIÇOS", emoji: "🛠️",
    items: [
      { kind: "sem_vinculo", label: "Sem Vínculo (OS não linkada)" },
      { kind: "agend_vazio", label: "Sem Previsão" },
      { kind: "agend_venc",  label: "Previsão Vencida" },
    ],
  },
  {
    title: "FATURAMENTO", emoji: "💵",
    items: [
      { kind: "pode_faturar", label: "Pronto para faturar" },
    ],
  },
];

// Responsáveis por alarme — nome como aparece no Webex. Alterar aqui basta.
// (Users do painel; ao adicionar novos alarms, mapeia aqui.)
export const ALARM_OWNERS: Record<AlarmKind, string> = {
  pvos_incompl: "Fernanda",
  sem_projeto:  "Fernanda",
  venda:        "Fernanda",
  sem_rc:       "Fernanda",
  aprov_pend:   "Fernanda",
  sem_pc:       "Erick",
  compra:       "Erick",
  defas_omie:   "Erick",
  sem_vinculo:  "Cristina",
  agend_vazio:  "Cristina",
  agend_venc:   "Cristina",
  pode_faturar: "Fernanda",
};

// Base do painel (produção). Report usa deep-link com ?alarme=X&pv=aberto
// pra abrir direto na vista filtrada.
export const PANEL_BASE = "https://painel.waterworks.com.br/avulsos";
export function buildAlarmeLink(kind: AlarmKind): string {
  const params = new URLSearchParams({ alarme: kind, pv: "aberto" });
  return `${PANEL_BASE}?${params.toString()}`;
}

// ── Cálculo de contadores ───────────────────────────────────────────────

// Parse flexível de data (aceita ISO YYYY-MM-DD ou BR DD/MM/YYYY).
// IMPORTANTE: retorna meia-noite LOCAL (não UTC) pra bater com Date.setHours(0).
function parseFlexDate(s: string): number | null {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br)  return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])).getTime();
  return null;
}

const APPROVED = new Set(["APROVADO", "APROVADO_ATE", "APROVADO_ATRASADO"]);
const isApproved = (s: string) => APPROVED.has(s);

type Row = Record<string, unknown>;

// Detectors row-level — replicam matchesAlarme + isAtraso* do BoldAvulsosView.
function isPvosIncompleto(r: Row): boolean {
  const tipoOk    = !!String(r.tipo_omie ?? "").trim();
  const clienteOk = !!String(r.pv_cliente_fantasia ?? "").trim();
  const dtLimOk   = !!String(r.pv_data_previsao ?? "").trim();
  return !tipoOk || !clienteOk || !dtLimOk;
}
// "Sem Projeto" = vendedor não marcou. Só considera nulo/vazio — projetos
// contratuais (CT*), avulsos (40_VS/41_VP), projetos (PJ*) são todos VÁLIDOS
// e não devem alarmar. Bug anterior: regex `!/^(40_VS|41_VP|PJ)/` marcava
// os 500+ CT* como sem_projeto, inflando o alarme 130x. (2026-07-16)
function isSemProjeto(r: Row): boolean {
  return String(r.projeto_nome ?? "").trim() === "";
}
function isAtrasoVenda(r: Row, todayMs: number): boolean {
  const dt = String(r.pv_dt_fat ?? "").trim();
  if (dt !== "") return false;
  const s = String(r.pv_data_previsao ?? "").trim();
  if (!s) return false;
  const t = parseFlexDate(s);
  return t != null && t < todayMs;
}
function isAtrasoCompra(r: Row, todayMs: number): boolean {
  // "Previsão atrasada" unificado — nova_prev se existir, senão dt_previsao,
  // desde que material não tenha sido recebido. Cobre os antigos "compra" +
  // "prev_mat_atr" (Nova Prev. herda dt_previsao por padrão, ambos casos convergem).
  if (r.mt_data_recebimento_nf) return false;
  const novaS = String(r.nova_prev_materiais ?? "").trim();
  const origS = String(r.dt_previsao ?? "").trim();
  const efetivaStr = novaS || origS;
  if (!efetivaStr) return false;
  const t = parseFlexDate(efetivaStr);
  return t != null && t < todayMs;
}
function isDefasagemOmie(r: Row): boolean {
  const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
  if (!hasPc) return false;
  if (!isApproved(String(r.status ?? ""))) return false;
  const etapa = String(r.pc_etapa_texto ?? "").trim();
  return etapa !== "" && etapa !== "Aprovação";
}

// Agrega alarmes bucket-level (por pv_os_label) — replica computeBucketAlarms.
// Retorna Map<pv_os_label, { kinds: Set<AlarmKind>; pv_valor: number }>.
type BucketInfo = { kinds: Set<AlarmKind>; pv_valor: number };
function computeBuckets(rows: Row[], todayMs: number): Map<string, BucketInfo> {
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const k = String(r.pv_os_label ?? "");
    if (!k) continue;
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const result = new Map<string, BucketInfo>();
  for (const [k, items] of buckets) {
    const head = items[0];
    const tipoBucket = String(head.tipo_omie ?? "");
    const hasPurchases = tipoBucket !== "Serviços";
    const anyRc = items.some((r) => !!r.rc_numero);
    const anyPc = items.some((r) => !!r.pc_numero || !!r.pc_numero_manual);
    const kinds = new Set<AlarmKind>();

    // PV encerrada = tem dt_fat OU num_nfe OU etapa em {Faturado, Cancelado}.
    // Entrega não é encerrada por si só; se foi faturada, dt_fat/num_nfe estão
    // preenchidos (v_pc_avulsos agora puxa isso de sales.etapas_pedidos via
    // pv_etapa_atual CTE — fix estrutural em 2026-07-17).
    const pvDtFatHead  = String(head.pv_dt_fat ?? "").trim();
    const pvNumNfeHead = String(head.pv_num_nfe ?? "").trim();
    const pvEtapaHead  = String(head.pv_etapa_texto ?? "").trim();
    const isEncerrada  = pvDtFatHead !== "" || pvNumNfeHead !== ""
                      || pvEtapaHead === "Faturado" || pvEtapaHead === "Cancelado";
    if (isEncerrada) {
      result.set(k, { kinds, pv_valor: Number(head.pv_valor_total) || 0 });
      continue;
    }

    // Vendas
    if (isPvosIncompleto(head))       kinds.add("pvos_incompl");
    if (isSemProjeto(head))           kinds.add("sem_projeto");
    if (isAtrasoVenda(head, todayMs)) kinds.add("venda");

    if (hasPurchases) {
      // Previsão atrasada (unificado)
      for (const r of items) { if (isAtrasoCompra(r, todayMs))  { kinds.add("compra"); break; } }
      // sem_rc unificado (nenhum RC OU RC com XOR num/custo)
      let temRcIncomp = false;
      if (anyRc) {
        for (const r of items) {
          const hasNum  = !!r.rc_numero;
          const hasCost = r.rc_custo != null && Number(r.rc_custo) !== 0;
          if (hasNum !== hasCost) { temRcIncomp = true; break; }
        }
      }
      if (!anyRc || temRcIncomp) kinds.add("sem_rc");
      // sem_pc unificado
      let temPcIncomp = false;
      if (anyPc) {
        for (const r of items) {
          const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
          if (!hasPc) continue;
          const hasForn = !!r.nome_fornecedor || !!r.codigo_fornecedor;
          const hasVal  = r.valor_total != null && Number(r.valor_total) !== 0;
          const hasCat  = !!r.codigo_categoria;
          if (!(hasForn && hasVal && hasCat)) { temPcIncomp = true; break; }
        }
      }
      if (!anyPc || temPcIncomp) kinds.add("sem_pc");
      // Aprovação pendente
      for (const r of items) {
        const hasPc = !!r.pc_numero || !!r.pc_numero_manual;
        if (!hasPc) continue;
        const s = String(r.status ?? "");
        if (s === "PENDENTE" || s === "PRE_SELECAO") { kinds.add("aprov_pend"); break; }
      }
      // Defasagem Omie
      for (const r of items) {
        if (isDefasagemOmie(r)) { kinds.add("defas_omie"); break; }
      }
    }

    // Serviços — só Mix / Serviços
    if (tipoBucket === "Mix" || tipoBucket === "Serviços") {
      // Sem Vínculo: sem OS linkada nem status vindo do app de serviços
      const anyOsRaw = items.some((r) => !!String(r.servicos_os_numero ?? "").trim());
      const anyOsStatus = items.some((r) => {
        const cf = (r.custom_fields as Record<string, unknown> | null) || {};
        return !!cf["ww_os_status"];
      });
      if (!anyOsRaw && !anyOsStatus) kinds.add("sem_vinculo");
      const anyAgend = items.some((r) => !!String(r.nova_prev_servicos ?? "").trim());
      if (!anyAgend) kinds.add("agend_vazio");
      if (String(head.pv_dt_fat ?? "").trim() === "") {
        for (const r of items) {
          const s = String(r.nova_prev_servicos ?? "").trim();
          if (!s) continue;
          const t = parseFlexDate(s);
          if (t != null && t < todayMs) { kinds.add("agend_venc"); break; }
        }
      }
    }

    // Faturamento
    const pvNotFaturado = String(head.pv_dt_fat ?? "").trim() === "";
    if (pvNotFaturado) {
      const needsServ = tipoBucket === "Mix" || tipoBucket === "Serviços";
      const servReleased = !needsServ || items.some((r) => {
        const cf = (r.custom_fields as Record<string, unknown> | null) || {};
        return cf["ww_pode_faturar"] === true;
      });
      const needsLog = tipoBucket !== "Serviços";
      if (needsLog) {
        if (anyPc) {
          const pcRows = items.filter((r) => !!r.pc_numero || !!r.pc_numero_manual);
          const allReceived = pcRows.length > 0 && pcRows.every((r) => !!r.mt_data_recebimento_nf);
          if (allReceived && servReleased) kinds.add("pode_faturar");
        }
      } else if (servReleased) {
        kinds.add("pode_faturar");
      }
    }

    const pvValor = Number(head.pv_valor_total ?? 0) || 0;
    result.set(k, { kinds, pv_valor: pvValor });
  }
  return result;
}

// Filtra PV/OS abertos (pv_dt_fat vazio) — mirror do default "aberto" no painel
function isPvAberto(head: Row): boolean {
  return String(head.pv_dt_fat ?? "").trim() === "";
}

export type PvEntry = {
  pv_os_label: string;
  cliente: string;
  tipo: string;
  valor: number;
};

export type ReportCounts = {
  counts: Record<AlarmKind, number>;
  vals:   Record<AlarmKind, number>;
  total_pvs: number;
  /** Lista de PVs afetados por alarme (usado no PDF completo) */
  pvs_by_kind: Record<AlarmKind, PvEntry[]>;
};

// Colunas mínimas necessárias pro cálculo — evita timeout de "SELECT *" na view
// pesada (v_pc_avulsos tem 60+ colunas, várias com sub-selects).
const REPORT_COLS = [
  "pv_os_label", "pv_dt_fat", "pv_data_previsao", "pv_cliente_fantasia",
  "pv_valor_total", "tipo_omie",
  "rc_numero", "rc_custo",
  "pc_numero", "pc_numero_manual", "pc_etapa_texto",
  "valor_total", "nome_fornecedor", "codigo_fornecedor", "codigo_categoria",
  "status", "mt_data_recebimento_nf",
  "dt_previsao", "nova_prev_materiais", "nova_prev_servicos",
  "custom_fields",
].join(",");

export async function computeReportCounts(): Promise<ReportCounts> {
  const admin = supaAdmin();
  // PostgREST tem hard-cap de 1000 rows por request (max-rows do PostgREST).
  // .limit(3000) NÃO sobrescreve. Sem paginar, o report perdia >40% da view
  // (v_pc_avulsos tem ~1700 rows), gerando contagens fantasma tipo sem_projeto=41
  // quando o real era 5. Aqui pagino explícito via .range() até esgotar. (2026-07-16)
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .schema("approval" as never)
      .from("v_pc_avulsos")
      .select(REPORT_COLS)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v_pc_avulsos: ${error.message}`);
    const batch = (data ?? []) as unknown as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 50_000) throw new Error("v_pc_avulsos safety cap 50k");
  }

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const bucketMap = computeBuckets(rows, todayMs);

  // Head-by-label pra ler cliente/tipo/valor sem varrer todas as rows de novo
  const headByLabel = new Map<string, Row>();
  for (const r of rows) {
    const k = String(r.pv_os_label ?? "");
    if (!k || headByLabel.has(k)) continue;
    headByLabel.set(k, r);
  }

  const KINDS: AlarmKind[] = ["pvos_incompl", "sem_projeto", "venda", "compra", "sem_rc", "sem_pc", "aprov_pend", "defas_omie", "sem_vinculo", "agend_vazio", "agend_venc", "pode_faturar"];
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<AlarmKind, number>;
  const vals   = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<AlarmKind, number>;
  const pvs_by_kind = Object.fromEntries(KINDS.map((k) => [k, [] as PvEntry[]])) as Record<AlarmKind, PvEntry[]>;

  let total = 0;
  for (const [label, info] of bucketMap) {
    const head = headByLabel.get(label);
    if (!head || !isPvAberto(head)) continue;
    total++;
    const entry: PvEntry = {
      pv_os_label: label,
      cliente: String(head.pv_cliente_fantasia ?? head.pv_cliente ?? "—"),
      tipo:    String(head.tipo_omie ?? ""),
      valor:   info.pv_valor,
    };
    for (const k of info.kinds) {
      counts[k] = (counts[k] ?? 0) + 1;
      vals[k]   = (vals[k]   ?? 0) + info.pv_valor;
      pvs_by_kind[k].push(entry);
    }
  }
  // Ordena cada lista por valor desc (bigger first)
  for (const k of KINDS) pvs_by_kind[k].sort((a, b) => b.valor - a.valor);
  return { counts, vals, total_pvs: total, pvs_by_kind };
}

// Persiste snapshot do dia (upsert por snapshot_date).
export async function persistSnapshot(): Promise<{ date: string; counts: Record<AlarmKind, number> }> {
  const r = await computeReportCounts();
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  const snapshotDate = `${yyyy}-${mm}-${dd}`;
  const admin = supaAdmin();
  const { error } = await admin
    .schema("platform" as never)
    .from("avulsos_daily_snapshots")
    .upsert({
      snapshot_date: snapshotDate,
      counts: r.counts,
      vals:   r.vals,
      total_pvs: r.total_pvs,
      captured_at: new Date().toISOString(),
    }, { onConflict: "snapshot_date" });
  if (error) throw new Error(`snapshot upsert: ${error.message}`);
  return { date: snapshotDate, counts: r.counts };
}

// Lê últimos N dias (default 14) — ordenado por data ascendente.
export async function readSnapshots(days = 14): Promise<Array<{ date: string; counts: Record<string, number>; vals: Record<string, number>; total_pvs: number }>> {
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  const fromStr = from.toISOString().slice(0, 10);
  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("platform" as never)
    .from("avulsos_daily_snapshots")
    .select("snapshot_date, counts, vals, total_pvs")
    .gte("snapshot_date", fromStr)
    .order("snapshot_date", { ascending: true });
  if (error) throw new Error(`snapshots read: ${error.message}`);
  type SnapRow = { snapshot_date: string; counts: Record<string, number>; vals: Record<string, number>; total_pvs: number };
  return ((data ?? []) as SnapRow[]).map((r) => ({
    date: r.snapshot_date,
    counts: r.counts ?? {},
    vals:   r.vals   ?? {},
    total_pvs: r.total_pvs ?? 0,
  }));
}
