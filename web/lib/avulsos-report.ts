// Helper compartilhado do report Avulsos.
// - Calcula counts/vals por AlarmKind idêntico ao painel (BoldAvulsosView)
// - Define mapeamento AlarmKind → responsável (nome exibido no report)
// - Constrói URLs de deep-link pra painel filtrado

import { supaAdmin } from "./supabase-admin";
import { ALARM_KINDS, computeBucketAlarms, type AlarmKind } from "./alarmes";

// AlarmKind e as regras de cálculo moram em ./alarmes — fonte única compartilhada
// com o painel (BoldAvulsosView). Este arquivo cuida só de: buscar as linhas,
// montar seções/responsáveis e formatar o texto do Webex.
export type { AlarmKind };

// Ordem de exibição no report + label humano
export const REPORT_SECTIONS: {
  title: string;
  emoji: string;
  items: { kind: AlarmKind; label: string }[];
}[] = [
  {
    title: "VENDAS", emoji: "🛍️",
    items: [
      { kind: "pvos_incompl",      label: "PV/OS incompletas (cadastro faltando)" },
      { kind: "sem_projeto",       label: "Sem Projeto (vendedor não marcou)" },
      { kind: "aguarda_liberacao", label: "🔒 Aguardando Liberação (cliente sem PC)" },
      { kind: "venda",             label: "Vendas em atraso" },
    ],
  },
  {
    title: "COMPRAS", emoji: "📦",
    items: [
      { kind: "sem_rc",     label: "Faltam RCs ou incompletos" },
      { kind: "aprov_pend", label: "Aprovações pendentes" },
      { kind: "aprov_bloq", label: "Aprovações bloqueadas" },
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
  pvos_incompl:      "Fernanda",
  sem_projeto:       "Fernanda",
  aguarda_liberacao: "Fernanda",
  venda:             "Fernanda",
  sem_rc:            "Fernanda",
  aprov_pend:        "Fernanda",
  aprov_bloq:        "Fernanda",
  sem_pc:            "Erick",
  compra:            "Erick",
  defas_omie:        "Erick",
  sem_vinculo:       "Cristina",
  agend_vazio:       "Cristina",
  agend_venc:        "Cristina",
  pode_faturar:      "Fernanda",
};

// Base do painel (produção). Report usa deep-link com ?alarme=X&pv=aberto
// pra abrir direto na vista filtrada.
export const PANEL_BASE = "https://painel.waterworks.com.br/avulsos";
export function buildAlarmeLink(kind: AlarmKind): string {
  const params = new URLSearchParams({ alarme: kind, pv: "aberto" });
  return `${PANEL_BASE}?${params.toString()}`;
}

// ── Cálculo de contadores ───────────────────────────────────────────────
// As regras (parseFlexDate, isSemProjeto, isAtrasoVenda, …) vivem em ./alarmes.
// NÃO recrie cópias locais aqui: foi exatamente isso que fez os números do
// Webex e do painel divergirem.

type Row = Record<string, unknown>;

// Agrega alarmes bucket-level (por pv_os_label) — replica computeBucketAlarms.
// Retorna Map<pv_os_label, { kinds: Set<AlarmKind>; pv_valor: number }>.
type BucketInfo = { kinds: Set<AlarmKind>; pv_valor: number };
function computeBuckets(rows: Row[], todayMs: number, liberacaoSet: Set<string>): Map<string, BucketInfo> {
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
    // Regras vêm de ./alarmes — mesma função que o painel usa.
    const kinds = computeBucketAlarms(items, todayMs, liberacaoSet);
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
  "pv_valor_total", "tipo_omie", "projeto_nome",
  "rc_numero", "rc_custo",
  "pc_numero", "pc_numero_manual", "pc_etapa_texto",
  "valor_total", "nome_fornecedor", "codigo_fornecedor", "codigo_categoria",
  "status", "mt_data_recebimento_nf", "pv_num_nfe", "pv_etapa_texto",
  "servicos_os_numero",
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
      // ORDER BY é OBRIGATÓRIO ao paginar: sem ordem explícita o Postgres não
      // garante a mesma sequência entre as queries de cada página, então linhas
      // podem repetir numa página e sumir de outra. A chave (pv_os_label,
      // ncod_ped) é única na view, o que torna o range determinístico.
      .order("pv_os_label", { ascending: true, nullsFirst: false })
      .order("ncod_ped", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`v_pc_avulsos: ${error.message}`);
    const batch = (data ?? []) as unknown as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 50_000) throw new Error("v_pc_avulsos safety cap 50k");
  }

  // "Aguardando Liberação" overlay — puxa PVs ativos numa segunda query leve.
  const { data: libRows, error: libErr } = await admin
    .schema("platform" as never)
    .from("pv_liberacao_status")
    .select("pv_os_label")
    .eq("aguardando_liberacao", true);
  if (libErr) throw new Error(`pv_liberacao_status: ${libErr.message}`);
  const liberacaoSet = new Set<string>(
    ((libRows ?? []) as Array<{ pv_os_label: string }>).map((r) => r.pv_os_label),
  );

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const bucketMap = computeBuckets(rows, todayMs, liberacaoSet);

  // Head-by-label pra ler cliente/tipo/valor sem varrer todas as rows de novo
  const headByLabel = new Map<string, Row>();
  for (const r of rows) {
    const k = String(r.pv_os_label ?? "");
    if (!k || headByLabel.has(k)) continue;
    headByLabel.set(k, r);
  }

  // Vem de ./alarmes pra não dessincronizar quando um alarme novo for criado:
  // a lista hardcoded aqui já tinha ficado sem "aprov_bloq".
  const KINDS: AlarmKind[] = ALARM_KINDS;
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
