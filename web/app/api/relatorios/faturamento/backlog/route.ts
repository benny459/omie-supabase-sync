// GET /api/relatorios/faturamento/backlog?ref=YYYY-MM-DD
// Composição do backlog em aberto NA DATA REF:
//   - PVs onde pv_dt_fat IS NULL OR pv_dt_fat > ref
//   - Retorna 3 datasets pros charts do FaturamentoView:
//     1) aging   — bucketed por (ref - pv_data_previsao) → "no_prazo" | "0-15" | "16-30" | "31-60" | "60+"
//     2) runway  — barras semanais de pv_data_previsao (últimas 4w + próx 12w)
//     3) cohort  — barras mensais de pv_emissao (últimos 12 meses)
//   - total       — soma geral (deve bater com o KPI "Aberto" da /avulsos)

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

type Grupo = "Contrato" | "BOT" | "Projeto" | "Avulso";
type TipoOmie = "PV" | "OS";

const CAT_TO_GRUPO: Record<string, Grupo> = {
  "Contratuais": "Contrato",
  "BOT/SW":      "BOT",
  "Projetos":    "Projeto",
  "Avulsos":     "Avulso",
  "Revenda":     "Avulso",
  "Outras":      "Avulso",
};
function grupoOf(cat: string | null | undefined): Grupo {
  return CAT_TO_GRUPO[String(cat ?? "")] ?? "Avulso";
}
function grupoFromProjeto(nome: string | null | undefined): Grupo {
  const s = String(nome ?? "").trim().toUpperCase();
  if (s.startsWith("CT")) return "Contrato";
  if (s.startsWith("PJ")) return "Projeto";
  if (s.startsWith("BOT")) return "BOT";
  return "Avulso";
}

function parseFlexDate(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t.slice(0, 10) + "T00:00:00");
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  return null;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
// Segunda-feira da semana que contém d
function mondayOf(d: Date): Date {
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = n.getDay(); // 0 dom, 1 seg
  const delta = dow === 0 ? -6 : 1 - dow;
  n.setDate(n.getDate() + delta);
  return n;
}
function diffDays(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

export type BacklogBucket = "no_prazo" | "0-15" | "16-30" | "31-60" | "60+";
const BUCKETS: { key: BacklogBucket; label: string }[] = [
  { key: "no_prazo", label: "No prazo (previsão futura)" },
  { key: "0-15",     label: "0-15 dias em atraso" },
  { key: "16-30",    label: "16-30 dias em atraso" },
  { key: "31-60",    label: "31-60 dias em atraso" },
  { key: "60+",      label: "60+ dias em atraso" },
];
function bucketOf(diasAtraso: number): BacklogBucket {
  if (diasAtraso <= 0) return "no_prazo";
  if (diasAtraso <= 15) return "0-15";
  if (diasAtraso <= 30) return "16-30";
  if (diasAtraso <= 60) return "31-60";
  return "60+";
}

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    return NextResponse.json({ error: "ref deve ser YYYY-MM-DD" }, { status: 400 });
  }
  const refDate = new Date(ref + "T00:00:00");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  // Puxa todos os PVs — precisamos de emissao + previsao mesmo pra quem não tá atrasado.
  // Filtro em SQL só o essencial: quem já foi faturado antes da ref nunca esteve no backlog.
  // PAGE = 1000 porque é o cap default do PostgREST/Supabase (pedir 2000 volta 1000
  // silenciosamente, batch.length < PAGE trigga break e faltam linhas).
  const PAGE = 1000;
  type Row = {
    empresa: string; pv_os_label: string | null; pv_os_tipo: string | null;
    pv_data_previsao: string | null; pv_dt_fat: string | null; pv_emissao: string | null;
    pv_valor_total: number | string | null;
    projeto_nome: string | null; codigo_categoria: string | null;
  };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("mv_pc_avulsos")
      .select("empresa, pv_os_label, pv_os_tipo, pv_data_previsao, pv_dt_fat, pv_emissao, pv_valor_total, projeto_nome, codigo_categoria")
      .order("empresa", { ascending: true })
      .order("pv_os_label", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `mv_pc_avulsos: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 60_000) break;
  }

  // Dedup por (empresa, pv_os_label) — mv_pc_avulsos tem N linhas por PV (uma por PC).
  type Pv = {
    tipo: TipoOmie; grupo: Grupo; valor: number;
    dt_prev: Date | null; dt_fat: Date | null; dt_emissao: Date | null;
  };
  const pvs: Pv[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = String(r.pv_os_label ?? "").trim();
    if (!label) continue;
    const key = `${r.empresa}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dtPrev = r.pv_data_previsao ? parseFlexDate(String(r.pv_data_previsao)) : null;
    const dtFat  = r.pv_dt_fat        ? parseFlexDate(String(r.pv_dt_fat))        : null;
    const dtEmi  = r.pv_emissao       ? parseFlexDate(String(r.pv_emissao))       : null;
    const tipo: TipoOmie = String(r.pv_os_tipo ?? "").toUpperCase() === "OS" ? "OS" : "PV";
    const grupo = r.codigo_categoria ? grupoOf(r.codigo_categoria) : grupoFromProjeto(r.projeto_nome);
    const valor = Number(r.pv_valor_total) || 0;
    pvs.push({ tipo, grupo, valor, dt_prev: dtPrev, dt_fat: dtFat, dt_emissao: dtEmi });
  }

  // Filtra PVs em aberto na ref: não faturado OU faturado após ref
  const emAberto = pvs.filter(p => !p.dt_fat || p.dt_fat > refDate);

  // 1) AGING — bucket por (ref - previsao). Sem previsao → conta como no_prazo (não sabemos)
  const agingMap = new Map<BacklogBucket, { valor: number; qtd: number }>();
  for (const b of BUCKETS) agingMap.set(b.key, { valor: 0, qtd: 0 });
  for (const p of emAberto) {
    const dias = p.dt_prev ? diffDays(refDate, p.dt_prev) : 0;
    const b = bucketOf(dias);
    const cur = agingMap.get(b)!;
    cur.valor += p.valor; cur.qtd += 1;
  }
  const aging = BUCKETS.map(b => ({ bucket: b.key, label: b.label, ...agingMap.get(b.key)! }));

  // 2) RUNWAY — barras semanais das próximas 12 semanas + últimas 4 (base = segunda-feira)
  //    Bucket por semana de pv_data_previsao. past = week_start < segunda desta semana.
  const thisMonday = mondayOf(refDate);
  const weekStart0 = new Date(thisMonday); weekStart0.setDate(weekStart0.getDate() - 7 * 4); // -4w
  const weekStartN = new Date(thisMonday); weekStartN.setDate(weekStartN.getDate() + 7 * 11); // +11w = 12ª semana futura
  const runwayMap = new Map<string, { valor: number; qtd: number; past: boolean }>();
  for (let w = new Date(weekStart0); w <= weekStartN; w.setDate(w.getDate() + 7)) {
    runwayMap.set(ymd(w), { valor: 0, qtd: 0, past: w < thisMonday });
  }
  // "sem previsao" bucket separado
  let semPrevisao = { valor: 0, qtd: 0 };
  for (const p of emAberto) {
    if (!p.dt_prev) { semPrevisao.valor += p.valor; semPrevisao.qtd += 1; continue; }
    const wk = ymd(mondayOf(p.dt_prev));
    const cur = runwayMap.get(wk);
    if (cur) { cur.valor += p.valor; cur.qtd += 1; }
    else {
      // Previsão fora do range (muito antiga ou muito futura) — agrega no extremo mais próximo
      if (p.dt_prev < weekStart0) {
        const first = runwayMap.get(ymd(weekStart0))!;
        first.valor += p.valor; first.qtd += 1;
      } else {
        const last = runwayMap.get(ymd(weekStartN))!;
        last.valor += p.valor; last.qtd += 1;
      }
    }
  }
  const runway = Array.from(runwayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week_start, v]) => ({ week_start, ...v }));

  // 3) COHORT — barras mensais dos últimos 12 meses de emissão + "antigo" + "sem emissao"
  const monthKey = (d: Date) => ym(d);
  const cohortMap = new Map<string, { valor: number; qtd: number }>();
  const now = new Date(refDate);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    cohortMap.set(monthKey(d), { valor: 0, qtd: 0 });
  }
  const OLDER = "older";
  const NO_EMISSAO = "no_emissao";
  cohortMap.set(OLDER, { valor: 0, qtd: 0 });
  cohortMap.set(NO_EMISSAO, { valor: 0, qtd: 0 });
  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  for (const p of emAberto) {
    if (!p.dt_emissao) { const c = cohortMap.get(NO_EMISSAO)!; c.valor += p.valor; c.qtd += 1; continue; }
    if (p.dt_emissao < firstMonth) { const c = cohortMap.get(OLDER)!; c.valor += p.valor; c.qtd += 1; continue; }
    const k = monthKey(p.dt_emissao);
    const cur = cohortMap.get(k);
    if (cur) { cur.valor += p.valor; cur.qtd += 1; }
  }
  const cohort = Array.from(cohortMap.entries()).map(([month, v]) => ({ month, ...v }));

  const total = emAberto.reduce((acc, p) => { acc.valor += p.valor; acc.qtd += 1; return acc; },
    { valor: 0, qtd: 0 });

  return NextResponse.json({
    ref,
    total: { valor: Number(total.valor.toFixed(2)), qtd: total.qtd },
    aging,
    runway,
    cohort,
    sem_previsao: semPrevisao,
  });
}
