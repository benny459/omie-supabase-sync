"use client";

// FaturamentoView — período selecionável (mês corrente / anteriores / custom),
// stacked bar chart dia-a-dia por (tipo × categoria), tabela por dia.

import { useEffect, useMemo, useState } from "react";

type Categoria = "Contratuais" | "Projetos" | "Revenda" | "Avulsos" | "BOT/SW" | "Outras";
type Tipo = "PV" | "OS";

type FatRow = { date: string; tipo: Tipo; categoria: Categoria; empresa: string; qtd: number; valor: number };
type FatResp = {
  from: string; to: string;
  rows: FatRow[];
  totals: { qtd: number; valor: number };
  by_tipo: Record<Tipo, { qtd: number; valor: number }>;
  by_categoria: Record<Categoria, { qtd: number; valor: number }>;
};

// Ordem visual do stack (bottom → top) e cores. Mesma taxonomia do Metabase
// (mapeamento em public.cat_venda). PV = tons frios, OS = tons quentes.
const SEGMENTS: { tipo: Tipo; cat: Categoria; label: string; color: string }[] = [
  { tipo: "PV", cat: "Contratuais", label: "PV · Contratuais", color: "#0284c7" }, // sky-600
  { tipo: "PV", cat: "Projetos",    label: "PV · Projetos",    color: "#4f46e5" }, // indigo-600
  { tipo: "PV", cat: "Revenda",     label: "PV · Revenda",     color: "#7c3aed" }, // violet-600
  { tipo: "PV", cat: "Avulsos",     label: "PV · Avulsos",     color: "#c026d3" }, // fuchsia-600
  { tipo: "PV", cat: "BOT/SW",      label: "PV · BOT/SW",      color: "#0891b2" }, // cyan-600
  { tipo: "PV", cat: "Outras",      label: "PV · Outras",      color: "#a78bfa" }, // violet-400
  { tipo: "OS", cat: "Contratuais", label: "OS · Contratuais", color: "#059669" }, // emerald-600
  { tipo: "OS", cat: "Projetos",    label: "OS · Projetos",    color: "#0d9488" }, // teal-600
  { tipo: "OS", cat: "Revenda",     label: "OS · Revenda",     color: "#65a30d" }, // lime-600
  { tipo: "OS", cat: "Avulsos",     label: "OS · Avulsos",     color: "#d97706" }, // amber-600
  { tipo: "OS", cat: "BOT/SW",      label: "OS · BOT/SW",      color: "#0369a1" }, // sky-700
  { tipo: "OS", cat: "Outras",      label: "OS · Outras",      color: "#eab308" }, // yellow-500
];

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);
const fmtBRLFull = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v || 0);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function firstDayOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addMonths(d: Date, delta: number): Date { return new Date(d.getFullYear(), d.getMonth()+delta, 1); }

export default function FaturamentoView() {
  // Período: por default mês corrente. Dropdown quick-select + inputs custom.
  const now = new Date();
  const [monthOffset, setMonthOffset] = useState(0); // 0 = mês corrente
  const [from, setFrom] = useState(ymd(firstDayOfMonth(now)));
  const [to,   setTo]   = useState(ymd(lastDayOfMonth(now)));
  const [data, setData] = useState<FatResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const base = addMonths(now, monthOffset);
    setFrom(ymd(firstDayOfMonth(base)));
    setTo(ymd(lastDayOfMonth(base)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOffset]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setErr(null);
      try {
        const r = await fetch(`/api/relatorios/faturamento?from=${from}&to=${to}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setErr(j.error ?? r.statusText); setData(null); }
        else setData(j as FatResp);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [from, to]);

  // Agrega rows por dia+segmento pra chart
  type DayBucket = { date: string; segments: Map<string, number>; total: number; qtd: number };
  const perDay: DayBucket[] = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, DayBucket>();
    // Enche o range completo com zeros pra dias sem faturamento
    const start = new Date(from + "T00:00:00");
    const end   = new Date(to   + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      const key = ymd(d);
      map.set(key, { date: key, segments: new Map(), total: 0, qtd: 0 });
    }
    for (const r of data.rows) {
      const b = map.get(r.date);
      if (!b) continue;
      const k = `${r.tipo}|${r.categoria}`;
      b.segments.set(k, (b.segments.get(k) ?? 0) + r.valor);
      b.total += r.valor;
      b.qtd += r.qtd;
    }
    return Array.from(map.values());
  }, [data, from, to]);

  const maxTotal = useMemo(() => perDay.reduce((m, d) => Math.max(m, d.total), 0) || 1, [perDay]);

  // Legend toggle (esconder segmentos clicáveis)
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  function toggle(seg: string) {
    setHidden((s) => { const n = new Set(s); n.has(seg) ? n.delete(seg) : n.add(seg); return n; });
  }
  const visibleSegments = SEGMENTS.filter((s) => !hidden.has(`${s.tipo}|${s.cat}`));

  return (
    <div className="space-y-4">
      {/* Controles período */}
      <div className="flex items-center gap-2 flex-wrap p-3 bg-ww-panel rounded-lg border border-ww-border">
        <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-ww-textMuted mr-1">Período</span>
        {[
          { label: "Mês corrente", off: 0 },
          { label: "-1 mês",       off: -1 },
          { label: "-2 meses",     off: -2 },
          { label: "-3 meses",     off: -3 },
        ].map((o) => (
          <button key={o.off} type="button" onClick={() => setMonthOffset(o.off)}
            className={`px-2.5 py-1 text-[11.5px] font-semibold rounded border transition ${
              monthOffset === o.off
                ? "bg-violet-600 text-white border-violet-700"
                : "bg-ww-bg text-ww-text border-ww-border hover:bg-ww-rowHover"
            }`}>{o.label}</button>
        ))}
        <span className="mx-2 text-ww-textFaint">·</span>
        <label className="text-[11.5px] text-ww-textMuted">De</label>
        <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonthOffset(-999); }}
          className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
        <label className="text-[11.5px] text-ww-textMuted">até</label>
        <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonthOffset(-999); }}
          className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
        <div className="ml-auto text-[11px] text-ww-textMuted">
          {loading ? "Carregando…" : data ? `${data.totals.qtd} NFs · Total ${fmtBRLFull(data.totals.valor)}` : "—"}
        </div>
      </div>

      {err && <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[12px]">{err}</div>}

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <KpiCard label="Contratuais" qtd={data.by_categoria.Contratuais.qtd} valor={data.by_categoria.Contratuais.valor} tone="emerald" />
          <KpiCard label="Projetos"    qtd={data.by_categoria.Projetos.qtd}    valor={data.by_categoria.Projetos.valor}    tone="teal" />
          <KpiCard label="Revenda"     qtd={data.by_categoria.Revenda.qtd}     valor={data.by_categoria.Revenda.valor}     tone="violet" />
          <KpiCard label="Avulsos"     qtd={data.by_categoria.Avulsos.qtd}     valor={data.by_categoria.Avulsos.valor}     tone="amber" />
          <KpiCard label="BOT/SW"      qtd={data.by_categoria["BOT/SW"].qtd}   valor={data.by_categoria["BOT/SW"].valor}   tone="cyan" />
          <KpiCard label="Outras"      qtd={data.by_categoria.Outras.qtd}      valor={data.by_categoria.Outras.valor}      tone="slate" />
        </div>
      )}

      {/* Chart stacked */}
      {data && perDay.length > 0 && (
        <div className="bg-ww-panel rounded-lg border border-ww-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-ww-text">Faturamento por dia</h2>
            <span className="text-[10.5px] font-mono text-ww-textMuted">Máx dia: {fmtBRL(maxTotal)}</span>
          </div>
          {/* Legenda toggle */}
          <div className="flex flex-wrap gap-2">
            {SEGMENTS.map((s) => {
              const key = `${s.tipo}|${s.cat}`;
              const isHidden = hidden.has(key);
              return (
                <button key={key} type="button" onClick={() => toggle(key)}
                  className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border transition ${
                    isHidden ? "opacity-40 border-ww-border" : "border-ww-borderStrong"
                  }`}>
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>
          <StackedBarChart perDay={perDay} segments={visibleSegments} maxTotal={maxTotal} />
        </div>
      )}

      {/* Tabela por dia */}
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
                  <td className="px-3 py-1.5 font-mono text-ww-text">{d.date.slice(8, 10)}/{d.date.slice(5, 7)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-ww-text">{d.qtd}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-ww-text tabular-nums">{fmtBRL(d.total)}</td>
                  {SEGMENTS.map((s) => {
                    const v = d.segments.get(`${s.tipo}|${s.cat}`) ?? 0;
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
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, qtd, valor, tone }: { label: string; qtd: number; valor: number; tone: "sky"|"emerald"|"indigo"|"violet"|"teal"|"amber"|"cyan"|"slate" }) {
  const toneCls: Record<string, string> = {
    sky:     "border-sky-200 bg-sky-50/60 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100",
    indigo:  "border-indigo-200 bg-indigo-50/60 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-100",
    violet:  "border-violet-200 bg-violet-50/60 text-violet-900 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-100",
    teal:    "border-teal-200 bg-teal-50/60 text-teal-900 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-100",
    amber:   "border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
    cyan:    "border-cyan-200 bg-cyan-50/60 text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-100",
    slate:   "border-slate-200 bg-slate-50/60 text-slate-900 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-100",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneCls[tone]}`}>
      <div className="text-[9.5px] uppercase tracking-[0.5px] font-semibold opacity-70">{label}</div>
      <div className="text-[17px] font-semibold tabular-nums mt-1">{fmtBRLFull(valor)}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{qtd} NF{qtd !== 1 ? "s" : ""}</div>
    </div>
  );
}

function StackedBarChart({
  perDay, segments, maxTotal,
}: {
  perDay: { date: string; segments: Map<string, number>; total: number; qtd: number }[];
  segments: typeof SEGMENTS;
  maxTotal: number;
}) {
  const CHART_H = 260;
  const BAR_MIN_W = 18;
  const barCount = perDay.length;
  const chartW = Math.max(600, barCount * (BAR_MIN_W + 6));
  const barW = (chartW - 20) / barCount - 4;
  const yScale = (v: number) => (v / maxTotal) * CHART_H;

  return (
    <div className="overflow-x-auto">
      <svg width={chartW} height={CHART_H + 40} className="min-w-full">
        {/* baseline */}
        <line x1={10} y1={CHART_H} x2={chartW - 10} y2={CHART_H} stroke="currentColor" strokeOpacity={0.15} />
        {/* bars */}
        {perDay.map((d, i) => {
          const x = 10 + i * (barW + 4);
          let cumBottom = CHART_H;
          const parts = segments.map((s) => {
            const v = d.segments.get(`${s.tipo}|${s.cat}`) ?? 0;
            if (v <= 0) return null;
            const h = yScale(v);
            const y = cumBottom - h;
            cumBottom = y;
            return (
              <rect key={s.label} x={x} y={y} width={barW} height={h} fill={s.color} rx={1}>
                <title>{`${d.date.slice(8,10)}/${d.date.slice(5,7)} · ${s.label}: R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}</title>
              </rect>
            );
          });
          const dayLabel = d.date.slice(8, 10);
          const showLabel = i % Math.max(1, Math.round(barCount / 15)) === 0;
          return (
            <g key={d.date}>
              {parts}
              {showLabel && (
                <text x={x + barW/2} y={CHART_H + 14} textAnchor="middle"
                  className="text-[10px] fill-current opacity-60">{dayLabel}</text>
              )}
              {d.total > 0 && (
                <text x={x + barW/2} y={CHART_H - yScale(d.total) - 4} textAnchor="middle"
                  className="text-[9px] fill-current opacity-70 font-mono">
                  {d.total >= 1000 ? `${Math.round(d.total/1000)}k` : d.total}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
