"use client";

// FaturamentoView — stacked bar por dia (Grupo × Tipo), linha de atraso sobreposta.
// 4 grupos (Contrato, BOT, Projeto, Avulso) × 2 tipos (Mercantil-PV, Serviço-OS).
// Combinações reais: só 6 séries existem (Contrato-Serviço, BOT-Serviço,
// Projeto-Mercantil, Projeto-Serviço, Avulso-Mercantil, Avulso-Serviço).

import { useEffect, useMemo, useRef, useState } from "react";

type Grupo = "Contrato" | "BOT" | "Projeto" | "Avulso";
type Tipo = "PV" | "OS";

type FatRow = { date: string; tipo: Tipo; grupo: Grupo; empresa: string; qtd: number; valor: number };
type FatResp = {
  from: string; to: string;
  rows: FatRow[];
  totals: { qtd: number; valor: number };
  by_tipo: Record<Tipo, { qtd: number; valor: number }>;
  by_grupo: Record<Grupo, { qtd: number; valor: number }>;
};
type AtrasoResp = {
  from: string; to: string; ref: string;
  totals: { qtd: number; valor: number };
  by_tipo: Record<Tipo, { qtd: number; valor: number }>;
  by_grupo: Record<Grupo, { qtd: number; valor: number }>;
  serie: { date: string; valor: number; qtd: number; valor_pv: number; valor_os: number }[];
};

type BacklogBucket = "no_prazo" | "0-15" | "16-30" | "31-60" | "60+";
type BacklogResp = {
  ref: string;
  total: { valor: number; qtd: number };
  aging:  { bucket: BacklogBucket; label: string; valor: number; qtd: number }[];
  runway: { week_start: string; valor: number; qtd: number; past: boolean }[];
  cohort: { month: string; valor: number; qtd: number }[];
  sem_previsao: { valor: number; qtd: number };
};

const AGING_COR: Record<BacklogBucket, { fill: string; text: string; pill: string; short: string }> = {
  "no_prazo": { fill: "#10b981", text: "text-emerald-800 dark:text-emerald-200", pill: "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700", short: "No prazo" },
  "0-15":     { fill: "#fbbf24", text: "text-amber-800 dark:text-amber-200",     pill: "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700",         short: "0-15d" },
  "16-30":    { fill: "#f97316", text: "text-orange-800 dark:text-orange-200",   pill: "bg-orange-100 dark:bg-orange-900/40 border-orange-300 dark:border-orange-700",     short: "16-30d" },
  "31-60":    { fill: "#ef4444", text: "text-red-800 dark:text-red-200",         pill: "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700",                 short: "31-60d" },
  "60+":      { fill: "#991b1b", text: "text-red-900 dark:text-red-100",         pill: "bg-red-200 dark:bg-red-950/60 border-red-400 dark:border-red-800",                 short: "60+d" },
};

// 6 séries reais na base — Mercantil (PV) tom claro, Serviço (OS) tom escuro.
// Ordem visual bottom→top: Contrato → BOT → Projeto (M+S) → Avulso (M+S).
const SEGMENTS: { tipo: Tipo; grupo: Grupo; label: string; color: string }[] = [
  { tipo: "OS", grupo: "Contrato", label: "Contrato · Serviço",     color: "#0ea5e9" }, // sky-500
  { tipo: "OS", grupo: "BOT",      label: "BOT · Serviço",          color: "#0891b2" }, // cyan-600
  { tipo: "PV", grupo: "Projeto",  label: "Projeto · Mercantil",    color: "#a78bfa" }, // violet-400
  { tipo: "OS", grupo: "Projeto",  label: "Projeto · Serviço",      color: "#7c3aed" }, // violet-600
  { tipo: "PV", grupo: "Avulso",   label: "Avulso · Mercantil",     color: "#fbbf24" }, // amber-400
  { tipo: "OS", grupo: "Avulso",   label: "Avulso · Serviço",       color: "#d97706" }, // amber-600
];

const GRUPO_COR: Record<Grupo, { light: string; dark: string; text: string; border: string }> = {
  Contrato: { light: "bg-sky-50 dark:bg-sky-950/30",       dark: "bg-sky-600",    text: "text-sky-800 dark:text-sky-200",       border: "border-sky-200 dark:border-sky-800" },
  BOT:      { light: "bg-cyan-50 dark:bg-cyan-950/30",     dark: "bg-cyan-600",   text: "text-cyan-800 dark:text-cyan-200",     border: "border-cyan-200 dark:border-cyan-800" },
  Projeto:  { light: "bg-violet-50 dark:bg-violet-950/30", dark: "bg-violet-600", text: "text-violet-800 dark:text-violet-200", border: "border-violet-200 dark:border-violet-800" },
  Avulso:   { light: "bg-amber-50 dark:bg-amber-950/30",   dark: "bg-amber-600",  text: "text-amber-800 dark:text-amber-200",   border: "border-amber-200 dark:border-amber-800" },
};

const fmtBRL = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$${(abs / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000)     return `${sign}R$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R$${abs.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};
const fmtBRLFull = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}R$${abs}`;
};
const MESES_CURTOS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const fmtDia = (iso: string) => `${iso.slice(8, 10)} ${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}`;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function firstDayOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addMonths(d: Date, delta: number): Date { return new Date(d.getFullYear(), d.getMonth()+delta, 1); }
function addDays(d: Date, delta: number): Date { const n = new Date(d); n.setDate(n.getDate()+delta); return n; }

type PresetKey = "30d" | "90d" | "mes" | "mes-1" | "mes-2" | "12m" | "ytd" | "ano-1" | "custom";
const PRESETS: { v: PresetKey; l: string }[] = [
  { v: "30d",   l: "Últ 30d" },
  { v: "90d",   l: "Últ 90d" },
  { v: "mes",   l: "Mês" },
  { v: "mes-1", l: "Mês -1" },
  { v: "mes-2", l: "Mês -2" },
  { v: "12m",   l: "12m" },
  { v: "ytd",   l: "YTD" },
  { v: "ano-1", l: "Ano anterior" },
];
function rangeFromPreset(v: PresetKey): { from: string; to: string } {
  const t = new Date();
  if (v === "30d")   return { from: ymd(addDays(t, -29)), to: ymd(t) };
  if (v === "90d")   return { from: ymd(addDays(t, -89)), to: ymd(t) };
  if (v === "mes")   return { from: ymd(firstDayOfMonth(t)),                     to: ymd(lastDayOfMonth(t)) };
  if (v === "mes-1") { const d = addMonths(t, -1); return { from: ymd(firstDayOfMonth(d)), to: ymd(lastDayOfMonth(d)) }; }
  if (v === "mes-2") { const d = addMonths(t, -2); return { from: ymd(firstDayOfMonth(d)), to: ymd(lastDayOfMonth(d)) }; }
  if (v === "12m")   return { from: ymd(firstDayOfMonth(addMonths(t, -11))),      to: ymd(lastDayOfMonth(t)) };
  if (v === "ytd")   return { from: `${t.getFullYear()}-01-01`,                   to: ymd(t) };
  if (v === "ano-1") { const y = t.getFullYear()-1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  return { from: ymd(addDays(t, -29)), to: ymd(t) };
}

export default function FaturamentoView() {
  const initial = rangeFromPreset("30d");
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [from, setFrom] = useState(initial.from);
  const [to,   setTo]   = useState(initial.to);
  const [data, setData] = useState<FatResp | null>(null);
  const [atraso, setAtraso] = useState<AtrasoResp | null>(null);
  const [backlog, setBacklog] = useState<BacklogResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showAtraso, setShowAtraso] = useState(true);

  function applyPreset(v: PresetKey) {
    setPreset(v);
    if (v !== "custom") {
      const r = rangeFromPreset(v);
      setFrom(r.from); setTo(r.to);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setErr(null);
      try {
        const [rFat, rAtr, rBk] = await Promise.all([
          fetch(`/api/relatorios/faturamento?from=${from}&to=${to}`, { cache: "no-store" }),
          fetch(`/api/relatorios/faturamento/atraso?from=${from}&to=${to}`, { cache: "no-store" }),
          fetch(`/api/relatorios/faturamento/backlog?ref=${to}`, { cache: "no-store" }),
        ]);
        const jFat = await rFat.json();
        const jAtr = await rAtr.json();
        const jBk  = await rBk.json();
        if (cancelled) return;
        if (!rFat.ok) { setErr(jFat.error ?? rFat.statusText); setData(null); return; }
        setData(jFat as FatResp);
        setAtraso(rAtr.ok ? (jAtr as AtrasoResp) : null);
        setBacklog(rBk.ok  ? (jBk  as BacklogResp) : null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [from, to]);

  type DayBucket = { date: string; segments: Map<string, number>; total: number; qtd: number };
  const perDay: DayBucket[] = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, DayBucket>();
    const start = new Date(from + "T00:00:00");
    const end   = new Date(to   + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      const key = ymd(d);
      map.set(key, { date: key, segments: new Map(), total: 0, qtd: 0 });
    }
    for (const r of data.rows) {
      const b = map.get(r.date);
      if (!b) continue;
      const k = `${r.tipo}|${r.grupo}`;
      b.segments.set(k, (b.segments.get(k) ?? 0) + r.valor);
      b.total += r.valor;
      b.qtd += r.qtd;
    }
    return Array.from(map.values());
  }, [data, from, to]);

  const maxTotal = useMemo(() => {
    const maxFat = perDay.reduce((m, d) => Math.max(m, d.total), 0);
    const maxAtr = showAtraso ? (atraso?.serie ?? []).reduce((m, p) => Math.max(m, p.valor), 0) : 0;
    return Math.max(maxFat, maxAtr, 1);
  }, [perDay, atraso, showAtraso]);

  function toggle(seg: string) {
    setHidden((s) => { const n = new Set(s); n.has(seg) ? n.delete(seg) : n.add(seg); return n; });
  }
  function showAll() {
    setHidden(new Set());
    setShowAtraso(true);
  }
  function hideAll() {
    setHidden(new Set(SEGMENTS.map(s => `${s.tipo}|${s.grupo}`)));
    setShowAtraso(false);
  }
  const visibleSegments = SEGMENTS.filter((s) => !hidden.has(`${s.tipo}|${s.grupo}`));

  const pctAtraso = data && atraso && data.totals.valor > 0
    ? (atraso.totals.valor / data.totals.valor) * 100
    : null;

  return (
    <div className="space-y-4">
      {/* Filtros — pills */}
      <div className="p-3 bg-ww-panel rounded-lg border border-ww-border space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.5px] text-ww-textMuted font-semibold mr-1">Período</span>
          {PRESETS.map(p => (
            <button key={p.v} type="button" onClick={() => applyPreset(p.v)}
              className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-full transition ${
                preset === p.v
                  ? "bg-slate-900 text-white ring-1 ring-slate-900"
                  : "bg-ww-bg text-ww-text border border-ww-border hover:bg-ww-rowHover"
              }`}>{p.l}</button>
          ))}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] uppercase text-ww-textMuted">De</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
            className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          <label className="text-[10px] uppercase text-ww-textMuted">até</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
            className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          <div className="ml-auto text-[11px] text-ww-textMuted">
            {loading ? "Carregando…" : data ? `${data.totals.qtd} NF · ${fmtBRLFull(data.totals.valor)}` : "—"}
          </div>
        </div>
      </div>

      {err && <div data-testid="fat-error" className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[12px]">{err}</div>}

      {/* 3 KPIs principais — light Fourmidia/CureDesk */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PremiumKpi
            eyebrow="Faturado no período"
            main={fmtBRLFull(data.totals.valor)}
            accent="emerald"
            sub={[
              `${data.by_tipo.PV.qtd} PV · ${fmtBRL(data.by_tipo.PV.valor)}`,
              `${data.by_tipo.OS.qtd} OS · ${fmtBRL(data.by_tipo.OS.valor)}`,
            ]}
            iconGlyph="↑"
          />
          <PremiumKpi
            eyebrow="Atrasado (backlog atual)"
            main={atraso ? fmtBRLFull(atraso.totals.valor) : "—"}
            accent="rose"
            sub={atraso ? [
              `${atraso.totals.qtd} PV${atraso.totals.qtd !== 1 ? "s" : ""}`,
              `Mercantil ${fmtBRL(atraso.by_tipo.PV.valor)}`,
              `Serviço ${fmtBRL(atraso.by_tipo.OS.valor)}`,
            ] : []}
            iconGlyph="⏱"
          />
          <PremiumKpi
            eyebrow="Atraso vs Faturado"
            main={pctAtraso != null ? `${pctAtraso.toFixed(1)}%` : "—"}
            accent={
              pctAtraso == null ? "slate"
              : pctAtraso < 10 ? "emerald"
              : pctAtraso < 30 ? "amber"
              : "rose"
            }
            sub={["Backlog ÷ faturado no período"]}
            iconGlyph={pctAtraso != null && pctAtraso < 10 ? "✓" : "!"}
          />
        </div>
      )}

      {/* 4 KPIs por grupo */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["Contrato", "BOT", "Projeto", "Avulso"] as Grupo[]).map(g => (
            <GrupoKpi key={g} grupo={g} fat={data.by_grupo[g]}
              atrValor={atraso?.by_grupo[g]?.valor ?? 0}
              atrQtd={atraso?.by_grupo[g]?.qtd ?? 0}
            />
          ))}
        </div>
      )}

      {/* Chart moderno */}
      {data && perDay.length > 0 && (
        <div className="bg-ww-panel rounded-xl border border-ww-border p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[14px] font-bold text-ww-text">Faturamento por dia</h2>
              <p className="text-[10.5px] text-ww-textMuted">Barras empilhadas · linha vermelha = evolução do backlog atrasado (fim de cada dia)</p>
            </div>
            <span className="text-[10.5px] font-mono text-ww-textMuted">Máximo diário: {fmtBRL(maxTotal)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {SEGMENTS.map((s) => {
              const key = `${s.tipo}|${s.grupo}`;
              const isHidden = hidden.has(key);
              return (
                <button key={key} type="button" onClick={() => toggle(key)}
                  className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-1 rounded-full border transition ${
                    isHidden ? "opacity-40 border-ww-border bg-ww-bg" : "border-ww-borderStrong bg-ww-bg"
                  }`}
                  title={isHidden ? "Clique pra mostrar" : "Clique pra esconder"}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span>{s.label}</span>
                </button>
              );
            })}
            {atraso && atraso.totals.valor > 0 && (
              <button type="button" onClick={() => setShowAtraso(v => !v)}
                title={showAtraso ? "Clique pra esconder" : "Clique pra mostrar"}
                className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-1 rounded-full border transition ${
                  showAtraso
                    ? "border-rose-400 text-rose-700 dark:text-rose-300 bg-rose-50/50 dark:bg-rose-950/30"
                    : "opacity-40 border-ww-border bg-ww-bg text-ww-text"
                }`}>
                <span className="inline-block w-3 h-0.5 bg-rose-600"></span>
                <span>Atraso: {fmtBRLFull(atraso.totals.valor)}</span>
              </button>
            )}
            <span className="mx-1 text-ww-textMuted opacity-40">·</span>
            <button type="button" onClick={showAll}
              className="text-[10.5px] font-semibold px-2 py-1 rounded-full border border-ww-border bg-ww-bg text-ww-text hover:bg-ww-rowHover transition">
              Mostrar tudo
            </button>
            <button type="button" onClick={hideAll}
              className="text-[10.5px] font-semibold px-2 py-1 rounded-full border border-ww-border bg-ww-bg text-ww-text hover:bg-ww-rowHover transition">
              Ocultar tudo
            </button>
          </div>
          <ModernBarChart perDay={perDay} segments={visibleSegments} maxTotal={maxTotal}
            atrasoSerie={showAtraso ? (atraso?.serie ?? []) : []} />
        </div>
      )}

      {/* Backlog em aberto — 3 sub-gráficos: aging, runway, cohort */}
      {backlog && backlog.total.valor > 0 && (
        <div className="bg-ww-panel rounded-xl border border-ww-border p-5 space-y-6">
          <div className="flex items-end justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[14px] font-bold text-ww-text">
                Backlog de faturamento
                <span className="ml-2 text-[12px] font-mono tabular-nums text-ww-textMuted">
                  {fmtBRLFull(backlog.total.valor)} · {backlog.total.qtd} PV{backlog.total.qtd !== 1 ? "s" : ""} em aberto
                </span>
              </h2>
              <p className="text-[10.5px] text-ww-textMuted">
                O que ainda está pra faturar em {backlog.ref} — decomposto por idade, previsão futura e coorte de venda.
              </p>
            </div>
          </div>

          {/* 1) Aging horizontal */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[11.5px] font-bold text-ww-text uppercase tracking-[0.4px]">Aging — há quanto tempo estão parados?</h3>
              <span className="text-[10px] text-ww-textMuted">Barra 100% = R${" "}{fmtBRLFull(backlog.total.valor)}</span>
            </div>
            <AgingBar aging={backlog.aging} total={backlog.total.valor} />
          </div>

          {/* 2) Runway — próximas semanas */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between flex-wrap gap-1">
              <h3 className="text-[11.5px] font-bold text-ww-text uppercase tracking-[0.4px]">Runway — previsão de faturamento por semana</h3>
              <span className="text-[10px] text-ww-textMuted">
                <span className="inline-block w-2 h-2 rounded-sm bg-rose-500 mr-1 align-middle" />atrasado
                <span className="inline-block w-2 h-2 rounded-sm bg-sky-500 mx-1 ml-3 align-middle" />previsto
                {backlog.sem_previsao.qtd > 0 && (
                  <>
                    <span className="inline-block w-2 h-2 rounded-sm bg-slate-400 mx-1 ml-3 align-middle" />
                    sem previsão: {fmtBRL(backlog.sem_previsao.valor)} ({backlog.sem_previsao.qtd})
                  </>
                )}
              </span>
            </div>
            <RunwayChart runway={backlog.runway} refDate={backlog.ref} />
          </div>

          {/* 3) Cohort — mês de emissão do PV */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[11.5px] font-bold text-ww-text uppercase tracking-[0.4px]">Cohort — de qual mês são estas vendas?</h3>
              <span className="text-[10px] text-ww-textMuted">Data de emissão do PV</span>
            </div>
            <CohortChart cohort={backlog.cohort} />
          </div>
        </div>
      )}

      {/* Tabela */}
      {data && perDay.length > 0 && (
        <div className="bg-ww-panel rounded-lg border border-ww-border overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-ww-bg border-b border-ww-border">
              <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                <th className="px-3 py-2">Dia</th>
                <th className="px-3 py-2 text-right">NFs</th>
                <th className="px-3 py-2 text-right">Total</th>
                {SEGMENTS.map((s) => (
                  <th key={s.label} className="px-2 py-2 text-right">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perDay.filter((d) => d.qtd > 0).map((d) => (
                <tr key={d.date} className="border-t border-ww-border hover:bg-ww-rowHover">
                  <td className="px-3 py-1.5 font-mono text-ww-text">{fmtDia(d.date)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-ww-text">{d.qtd}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-ww-text tabular-nums">{fmtBRL(d.total)}</td>
                  {SEGMENTS.map((s) => {
                    const v = d.segments.get(`${s.tipo}|${s.grupo}`) ?? 0;
                    return (
                      <td key={s.label} className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums"
                          style={{ color: v > 0 ? s.color : undefined, opacity: v > 0 ? 1 : 0.25 }}>
                        {v > 0 ? fmtBRL(v) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {data.totals.qtd > 0 && (
              <tfoot>
                <tr className="border-t-2 border-ww-borderStrong bg-ww-bg font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{data.totals.qtd}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBRL(data.totals.valor)}</td>
                  {SEGMENTS.map((s) => {
                    const v = perDay.reduce((acc, d) => acc + (d.segments.get(`${s.tipo}|${s.grupo}`) ?? 0), 0);
                    return <td key={s.label} className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: v > 0 ? s.color : undefined, opacity: v > 0 ? 1 : 0.25 }}>{v > 0 ? fmtBRL(v) : "—"}</td>;
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function PremiumKpi({ eyebrow, main, accent, sub, iconGlyph }: {
  eyebrow: string; main: string; sub: string[];
  accent: "emerald" | "rose" | "amber" | "slate";
  iconGlyph?: string;
}) {
  const A: Record<string, { border: string; bg: string; text: string; icon: string; ring: string }> = {
    emerald: { border: "border-emerald-200 dark:border-emerald-800", bg: "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-transparent", text: "text-emerald-900 dark:text-emerald-50", icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300", ring: "ring-emerald-500/10" },
    rose:    { border: "border-rose-200 dark:border-rose-800",       bg: "bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-transparent",       text: "text-rose-900 dark:text-rose-50",       icon: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300",       ring: "ring-rose-500/10" },
    amber:   { border: "border-amber-200 dark:border-amber-800",     bg: "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-transparent",     text: "text-amber-900 dark:text-amber-50",     icon: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",     ring: "ring-amber-500/10" },
    slate:   { border: "border-slate-200 dark:border-slate-700",     bg: "bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/40 dark:to-transparent",     text: "text-slate-900 dark:text-slate-50",     icon: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",     ring: "ring-slate-500/10" },
  };
  const a = A[accent];
  return (
    <div className={`rounded-2xl border ${a.border} ${a.bg} p-5 ring-1 ${a.ring} shadow-sm`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`text-[10.5px] uppercase tracking-[0.6px] font-bold ${a.text} opacity-80`}>{eyebrow}</div>
        {iconGlyph && (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold ${a.icon}`}>{iconGlyph}</div>
        )}
      </div>
      <div className={`text-[28px] font-bold tabular-nums leading-none ${a.text}`}>{main}</div>
      {sub.length > 0 && (
        <div className={`text-[11px] mt-3 flex flex-wrap gap-x-3 gap-y-1 ${a.text} opacity-80`}>
          {sub.map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}
    </div>
  );
}

function GrupoKpi({ grupo, fat, atrValor, atrQtd }: {
  grupo: Grupo; fat: { qtd: number; valor: number };
  atrValor: number; atrQtd: number;
}) {
  const c = GRUPO_COR[grupo];
  return (
    <div className={`rounded-xl border ${c.border} ${c.light} p-3`}>
      <div className={`text-[10px] uppercase tracking-[0.5px] font-bold ${c.text}`}>{grupo}</div>
      <div className={`text-[17px] font-semibold tabular-nums mt-1 ${c.text}`}>{fmtBRLFull(fat.valor)}</div>
      <div className={`text-[10px] mt-0.5 ${c.text} opacity-80`}>{fat.qtd} NF{fat.qtd !== 1 ? "s" : ""}</div>
      {atrValor > 0 && (
        <div className="text-[10.5px] mt-1 font-semibold text-rose-700 dark:text-rose-300">
          Atraso: {fmtBRL(atrValor)} <span className="opacity-70 font-normal">· {atrQtd} PV{atrQtd !== 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Gráfico moderno — mais alto, gridlines, eixo Y, hover, atraso destacado
// ═════════════════════════════════════════════════════════════════
function ModernBarChart({
  perDay, segments, maxTotal, atrasoSerie,
}: {
  perDay: { date: string; segments: Map<string, number>; total: number; qtd: number }[];
  segments: typeof SEGMENTS;
  maxTotal: number;
  atrasoSerie: { date: string; valor: number; qtd: number }[];
}) {
  const CHART_H = 440;
  const PAD_L   = 64;
  const PAD_R   = 76;         // eixo Y secundário à direita (atraso)
  const PAD_T   = 24;
  const PAD_B   = 52;
  const barCount = perDay.length;
  const [hover, setHover] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(1200);

  // Ajusta ao container — sem overflow horizontal. Barras ficam finas se período é longo.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(Math.max(700, e.contentRect.width));
    });
    ro.observe(el);
    setContainerW(Math.max(700, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const svgW = containerW;
  const plotW = svgW - PAD_L - PAD_R;
  const barW  = Math.max(2, Math.min(40, (plotW / barCount) * 0.72));
  const gap   = (plotW / barCount) - barW;

  const yScale = (v: number) => (v / maxTotal) * CHART_H;
  const y0 = PAD_T + CHART_H;

  // Eixo Y SECUNDÁRIO — escala própria pra linha de atraso (impede sumir na baseline
  // quando atraso << faturamento)
  const maxAtraso = atrasoSerie.reduce((m, p) => Math.max(m, p.valor), 0) || 1;
  const yScaleAtraso = (v: number) => (v / maxAtraso) * CHART_H;

  // Gridlines "nice" — 4 tick marks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    v: maxTotal * f,
    y: y0 - CHART_H * f,
  }));

  return (
    <div ref={containerRef} className="w-full">
      <svg width={svgW} height={CHART_H + PAD_T + PAD_B} className="block"
        onMouseLeave={() => setHover(null)}>

        {/* Gridlines horizontais + eixos Y */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={svgW - PAD_R} y1={t.y} y2={t.y}
              stroke="currentColor" strokeOpacity={0.08} strokeDasharray={i === 0 ? "0" : "2 3"} />
            {/* Eixo Y esquerda — faturamento */}
            <text x={PAD_L - 8} y={t.y + 3} textAnchor="end"
              className="text-[9.5px] fill-current opacity-45 tabular-nums font-mono">
              {fmtBRL(t.v)}
            </text>
            {/* Eixo Y direita — atraso (escala secundária) */}
            <text x={svgW - PAD_R + 8} y={t.y + 3} textAnchor="start"
              className="text-[9.5px] tabular-nums font-mono" style={{ fill: "#e11d48", opacity: 0.7 }}>
              {fmtBRL(maxAtraso * (t.v / maxTotal))}
            </text>
          </g>
        ))}
        {/* Rótulos dos eixos */}
        <text x={PAD_L - 8} y={PAD_T - 6} textAnchor="end"
          className="text-[9px] uppercase tracking-[0.5px] fill-current opacity-60 font-semibold">Faturado</text>
        <text x={svgW - PAD_R + 8} y={PAD_T - 6} textAnchor="start"
          className="text-[9px] uppercase tracking-[0.5px] font-semibold" style={{ fill: "#e11d48", opacity: 0.85 }}>Atraso</text>

        {/* Barras + hover */}
        {perDay.map((d, i) => {
          const x = PAD_L + i * (barW + gap) + gap / 2;
          let cumBottom = y0;
          const parts = segments.map((s) => {
            const v = d.segments.get(`${s.tipo}|${s.grupo}`) ?? 0;
            if (v <= 0) return null;
            const h = yScale(v);
            const y = cumBottom - h;
            cumBottom = y;
            return (
              <rect key={s.label} x={x} y={y} width={barW} height={h} fill={s.color} rx={2} />
            );
          });
          const isHover = hover === i;
          return (
            <g key={d.date}>
              {/* hover strip */}
              <rect x={x - gap/2} y={PAD_T} width={barW + gap} height={CHART_H}
                fill={isHover ? "rgba(148,163,184,0.10)" : "transparent"}
                onMouseEnter={() => setHover(i)} style={{ cursor: "pointer" }} />
              {parts}
              {/* label do total em cima da barra (quando cabe) */}
              {d.total > 0 && barW >= 22 && (
                <text x={x + barW/2} y={y0 - yScale(d.total) - 5} textAnchor="middle"
                  className="text-[9.5px] fill-current opacity-60 font-mono tabular-nums">
                  {d.total >= 10_000 ? `${(d.total/1000).toFixed(0)}k`
                   : d.total >= 1_000 ? `${(d.total/1000).toFixed(1)}k`.replace(".", ",")
                   : Math.round(d.total).toString()}
                </text>
              )}
            </g>
          );
        })}

        {/* Eixo X — datas */}
        {perDay.map((d, i) => {
          const x = PAD_L + i * (barW + gap) + gap / 2 + barW/2;
          const showEvery = Math.max(1, Math.ceil(barCount / 15));
          if (i % showEvery !== 0) return null;
          return (
            <text key={d.date} x={x} y={y0 + 16} textAnchor="middle"
              className="text-[9.5px] fill-current opacity-60 font-mono">
              {fmtDia(d.date)}
            </text>
          );
        })}

        {/* Linha de atraso — série temporal (backlog naquele dia) */}
        {atrasoSerie.length > 0 && (() => {
          // Mapeia cada ponto pra x do centro da barra do dia; alinha por data
          const dateToIndex = new Map(perDay.map((d, i) => [d.date, i]));
          // Elevação mínima visual (2% da altura) pra linha ser vista mesmo em zero
          const MIN_Y = 6;
          const pts = atrasoSerie
            .map(p => {
              const idx = dateToIndex.get(p.date);
              if (idx == null) return null;
              const x = PAD_L + idx * (barW + gap) + gap / 2 + barW / 2;
              const rawY = y0 - yScaleAtraso(p.valor);
              const y = Math.min(rawY, y0 - MIN_Y);
              return { x, y, valor: p.valor, date: p.date, qtd: p.qtd };
            })
            .filter((p): p is { x: number; y: number; valor: number; date: string; qtd: number } => p != null);
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
          // Area sombreada abaixo da linha
          const areaPath = `${path} L${pts[pts.length-1].x},${y0} L${pts[0].x},${y0} Z`;
          const last = pts[pts.length - 1];
          return (
            <g>
              <path d={areaPath} fill="#e11d48" fillOpacity={0.12} />
              <path d={path} stroke="#e11d48" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill="#e11d48" stroke="white" strokeWidth={1}>
                  <title>{`${fmtDia(p.date)} · Atraso: R$ ${p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${p.qtd} PV${p.qtd !== 1 ? "s" : ""})`}</title>
                </circle>
              ))}
              {/* Badge do último valor */}
              {last.valor > 0 && (
                <>
                  <rect x={Math.min(svgW - PAD_R - 4, last.x + 6)} y={Math.max(PAD_T + 2, last.y - 10)}
                    width={110} height={16} rx={3} fill="#e11d48" />
                  <text x={Math.min(svgW - PAD_R + 106, last.x + 6 + 105)} y={Math.max(PAD_T + 14, last.y + 2)}
                    textAnchor="end" className="text-[10px] font-semibold fill-white">
                    Atraso: {fmtBRL(last.valor)}
                  </text>
                </>
              )}
            </g>
          );
        })()}

        {/* Baseline */}
        <line x1={PAD_L} x2={svgW - PAD_R} y1={y0} y2={y0} stroke="currentColor" strokeOpacity={0.35} />

        {/* Tooltip flutuante quando hover */}
        {hover != null && perDay[hover] && perDay[hover].total > 0 && (
          <foreignObject
            x={Math.min(
              svgW - 240,
              Math.max(PAD_L, PAD_L + hover * (barW + gap) + gap/2 + barW + 8)
            )}
            y={PAD_T + 6}
            width={230}
            height={200}
          >
            <div className="rounded-lg border border-ww-border bg-ww-panel shadow-lg p-2 text-[10.5px]">
              <div className="font-semibold text-ww-text mb-1">
                {fmtDia(perDay[hover].date)} · {perDay[hover].qtd} NF
              </div>
              <div className="font-bold text-ww-text mb-1.5 tabular-nums">
                {fmtBRLFull(perDay[hover].total)}
              </div>
              <div className="space-y-0.5">
                {segments.map(s => {
                  const v = perDay[hover].segments.get(`${s.tipo}|${s.grupo}`) ?? 0;
                  if (v <= 0) return null;
                  return (
                    <div key={s.label} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-ww-textMuted">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </span>
                      <span className="tabular-nums font-mono text-ww-text">{fmtBRL(v)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// AgingBar — barra horizontal 100% empilhada por faixa etária.
// Segmentos < 3% recebem largura mínima pra ficar clicáveis; label
// escondido quando não cabe. Legenda abaixo com valor + qtd + %.
// ═════════════════════════════════════════════════════════════════
function AgingBar({ aging, total }: {
  aging: BacklogResp["aging"];
  total: number;
}) {
  const totalSafe = total > 0 ? total : 1;
  return (
    <div className="space-y-3">
      <div className="w-full h-14 rounded-lg overflow-hidden flex border border-ww-border">
        {aging.map((b) => {
          const pct = (b.valor / totalSafe) * 100;
          if (b.valor <= 0) return null;
          const c = AGING_COR[b.bucket];
          return (
            <div key={b.bucket}
              className="relative flex items-center justify-center text-white text-[10.5px] font-bold overflow-hidden group"
              style={{ width: `${pct}%`, backgroundColor: c.fill, minWidth: pct < 2 ? "4px" : undefined }}
              title={`${b.label} — ${fmtBRLFull(b.valor)} · ${b.qtd} PV${b.qtd !== 1 ? "s" : ""} · ${pct.toFixed(1)}%`}>
              {pct >= 8 && (
                <div className="flex flex-col items-center leading-tight">
                  <span className="tabular-nums">{fmtBRL(b.valor)}</span>
                  <span className="text-[9px] opacity-90">{pct.toFixed(0)}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {aging.map((b) => {
          const pct = (b.valor / totalSafe) * 100;
          const c = AGING_COR[b.bucket];
          const inactive = b.valor <= 0;
          return (
            <div key={b.bucket}
              className={`rounded-lg border px-2.5 py-2 ${c.pill} ${inactive ? "opacity-40" : ""}`}>
              <div className={`text-[9.5px] uppercase tracking-[0.4px] font-bold ${c.text} flex items-center gap-1.5`}>
                <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: c.fill }} />
                {c.short}
              </div>
              <div className={`text-[13px] font-bold tabular-nums mt-0.5 ${c.text}`}>{fmtBRL(b.valor)}</div>
              <div className={`text-[10px] ${c.text} opacity-80`}>
                {b.qtd} PV{b.qtd !== 1 ? "s" : ""} · {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// RunwayChart — barras verticais semanais (últimas 4 + próximas 12).
// Passado = rose (deveria ter faturado, atrasou). Futuro = sky.
// Linha vertical tracejada separa passado do futuro.
// ═════════════════════════════════════════════════════════════════
function RunwayChart({ runway, refDate }: {
  runway: BacklogResp["runway"];
  refDate: string;
}) {
  const CHART_H = 200;
  const PAD_L = 44, PAD_R = 12, PAD_T = 18, PAD_B = 40;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(1200);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(Math.max(600, e.contentRect.width));
    });
    ro.observe(el);
    setContainerW(Math.max(600, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const svgW = containerW;
  const plotW = svgW - PAD_L - PAD_R;
  const n = runway.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(6, Math.min(48, slot * 0.7));
  const gap = slot - barW;
  const maxV = runway.reduce((m, w) => Math.max(m, w.valor), 0) || 1;
  const y0 = PAD_T + CHART_H;
  const yScale = (v: number) => (v / maxV) * CHART_H;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxV * f, y: y0 - CHART_H * f }));

  // Índice do primeiro futuro (past === false)
  const firstFutureIdx = runway.findIndex(w => !w.past);
  const dividerX = firstFutureIdx >= 0
    ? PAD_L + firstFutureIdx * (barW + gap) + gap / 2
    : null;

  const fmtWeek = (isoMonday: string) => `${isoMonday.slice(8, 10)}/${isoMonday.slice(5, 7)}`;

  return (
    <div ref={containerRef} className="w-full">
      <svg width={svgW} height={CHART_H + PAD_T + PAD_B} className="block"
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={svgW - PAD_R} y1={t.y} y2={t.y}
              stroke="currentColor" strokeOpacity={0.08} strokeDasharray={i === 0 ? "0" : "2 3"} />
            <text x={PAD_L - 6} y={t.y + 3} textAnchor="end"
              className="text-[9px] fill-current opacity-45 tabular-nums font-mono">
              {fmtBRL(t.v)}
            </text>
          </g>
        ))}
        {/* Divisor passado/futuro */}
        {dividerX != null && (
          <g>
            <line x1={dividerX} x2={dividerX} y1={PAD_T} y2={y0}
              stroke="#64748b" strokeOpacity={0.55} strokeDasharray="3 3" />
            <text x={dividerX + 4} y={PAD_T + 10} className="text-[9px] fill-current opacity-60 font-semibold uppercase tracking-[0.4px]">
              hoje ({refDate.slice(8,10)}/{refDate.slice(5,7)})
            </text>
          </g>
        )}
        {runway.map((w, i) => {
          const x = PAD_L + i * (barW + gap) + gap / 2;
          const h = yScale(w.valor);
          const y = y0 - h;
          const fill = w.past ? "#e11d48" : "#0ea5e9";
          const isHover = hover === i;
          return (
            <g key={w.week_start}>
              <rect x={x - gap/2} y={PAD_T} width={barW + gap} height={CHART_H}
                fill={isHover ? "rgba(148,163,184,0.10)" : "transparent"}
                onMouseEnter={() => setHover(i)} style={{ cursor: "pointer" }} />
              {w.valor > 0 && (
                <rect x={x} y={y} width={barW} height={h} fill={fill} rx={2} opacity={w.past ? 0.9 : 1} />
              )}
              {w.valor > 0 && barW >= 20 && (
                <text x={x + barW/2} y={y - 4} textAnchor="middle"
                  className="text-[9px] fill-current opacity-70 font-mono tabular-nums">
                  {fmtBRL(w.valor)}
                </text>
              )}
            </g>
          );
        })}
        {runway.map((w, i) => {
          const x = PAD_L + i * (barW + gap) + gap / 2 + barW/2;
          // Rótulo em cada semana quando cabe, senão de 2 em 2
          const showEvery = barW < 24 ? 2 : 1;
          if (i % showEvery !== 0) return null;
          return (
            <text key={w.week_start} x={x} y={y0 + 14} textAnchor="middle"
              className="text-[9px] fill-current opacity-60 font-mono">
              {fmtWeek(w.week_start)}
            </text>
          );
        })}
        <line x1={PAD_L} x2={svgW - PAD_R} y1={y0} y2={y0} stroke="currentColor" strokeOpacity={0.35} />

        {hover != null && runway[hover] && (
          <foreignObject
            x={Math.min(svgW - 200, Math.max(PAD_L, PAD_L + hover * (barW + gap) + gap/2 + barW + 6))}
            y={PAD_T + 4}
            width={190} height={80}
          >
            <div className="rounded-lg border border-ww-border bg-ww-panel shadow-lg p-2 text-[10.5px]">
              <div className="font-semibold text-ww-text mb-0.5">
                Semana de {fmtWeek(runway[hover].week_start)}
              </div>
              <div className={`text-[10px] font-semibold mb-1 ${runway[hover].past ? "text-rose-600" : "text-sky-600"}`}>
                {runway[hover].past ? "Deveria ter faturado" : "Previsão futura"}
              </div>
              <div className="font-bold text-ww-text tabular-nums">
                {fmtBRLFull(runway[hover].valor)}
              </div>
              <div className="text-ww-textMuted text-[10px]">
                {runway[hover].qtd} PV{runway[hover].qtd !== 1 ? "s" : ""}
              </div>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// CohortChart — barras verticais por mês de emissão do PV. Últimos 12
// meses + "antigo" (>12m) + "sem emissão".
// Cor uniforme violeta com gradient (recente = mais escuro pra chamar
// atenção — vendas novas em aberto = normal; antigas = alerta).
// ═════════════════════════════════════════════════════════════════
function CohortChart({ cohort }: {
  cohort: BacklogResp["cohort"];
}) {
  const CHART_H = 200;
  const PAD_L = 44, PAD_R = 12, PAD_T = 18, PAD_B = 40;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(1200);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerW(Math.max(600, e.contentRect.width));
    });
    ro.observe(el);
    setContainerW(Math.max(600, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const svgW = containerW;
  const plotW = svgW - PAD_L - PAD_R;
  const n = cohort.length;
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(10, Math.min(56, slot * 0.7));
  const gap = slot - barW;
  const maxV = cohort.reduce((m, c) => Math.max(m, c.valor), 0) || 1;
  const y0 = PAD_T + CHART_H;
  const yScale = (v: number) => (v / maxV) * CHART_H;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxV * f, y: y0 - CHART_H * f }));

  const label = (k: string) => {
    if (k === "older")      return "antigo";
    if (k === "no_emissao") return "s/ data";
    // YYYY-MM
    return `${MESES_CURTOS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
  };
  const fillFor = (k: string) => {
    if (k === "older")      return "#991b1b"; // vermelho profundo — alerta
    if (k === "no_emissao") return "#94a3b8"; // slate — desconhecido
    return "#7c3aed"; // violet-600 — vendas do período
  };

  return (
    <div ref={containerRef} className="w-full">
      <svg width={svgW} height={CHART_H + PAD_T + PAD_B} className="block"
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={svgW - PAD_R} y1={t.y} y2={t.y}
              stroke="currentColor" strokeOpacity={0.08} strokeDasharray={i === 0 ? "0" : "2 3"} />
            <text x={PAD_L - 6} y={t.y + 3} textAnchor="end"
              className="text-[9px] fill-current opacity-45 tabular-nums font-mono">
              {fmtBRL(t.v)}
            </text>
          </g>
        ))}
        {cohort.map((c, i) => {
          const x = PAD_L + i * (barW + gap) + gap / 2;
          const h = yScale(c.valor);
          const y = y0 - h;
          const isHover = hover === i;
          const fill = fillFor(c.month);
          return (
            <g key={c.month}>
              <rect x={x - gap/2} y={PAD_T} width={barW + gap} height={CHART_H}
                fill={isHover ? "rgba(148,163,184,0.10)" : "transparent"}
                onMouseEnter={() => setHover(i)} style={{ cursor: "pointer" }} />
              {c.valor > 0 && <rect x={x} y={y} width={barW} height={h} fill={fill} rx={2} />}
              {c.valor > 0 && barW >= 26 && (
                <text x={x + barW/2} y={y - 4} textAnchor="middle"
                  className="text-[9px] fill-current opacity-70 font-mono tabular-nums">
                  {fmtBRL(c.valor)}
                </text>
              )}
              <text x={x + barW/2} y={y0 + 14} textAnchor="middle"
                className="text-[9px] fill-current opacity-60 font-mono">
                {label(c.month)}
              </text>
            </g>
          );
        })}
        <line x1={PAD_L} x2={svgW - PAD_R} y1={y0} y2={y0} stroke="currentColor" strokeOpacity={0.35} />

        {hover != null && cohort[hover] && (
          <foreignObject
            x={Math.min(svgW - 200, Math.max(PAD_L, PAD_L + hover * (barW + gap) + gap/2 + barW + 6))}
            y={PAD_T + 4}
            width={190} height={70}
          >
            <div className="rounded-lg border border-ww-border bg-ww-panel shadow-lg p-2 text-[10.5px]">
              <div className="font-semibold text-ww-text mb-0.5">
                Emissão: {label(cohort[hover].month)}
              </div>
              <div className="font-bold text-ww-text tabular-nums">
                {fmtBRLFull(cohort[hover].valor)}
              </div>
              <div className="text-ww-textMuted text-[10px]">
                {cohort[hover].qtd} PV{cohort[hover].qtd !== 1 ? "s" : ""}
              </div>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
