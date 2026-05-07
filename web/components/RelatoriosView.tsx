"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  aprovado_em: string;
  modulo: string;
  empresa: string;
  ncod_ped: number;
  pc: string | null;
  pv_os: string | null;
  pv_os_tipo: string | null;
  fornecedor: string | null;
  projeto: string | null;
  cliente: string | null;
  valor: number;
  aprovador: string | null;
};

type Report = {
  range: { from: string; to: string };
  kpis: { totalValor: number; totalAprovacoes: number; ticketMedio: number; maiorAprovacao: number };
  byModulo: Array<{ modulo: string; valor: number; count: number }>;
  rows: Row[];
};

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const MODULO_META: Record<string, { label: string; tone: string; ring: string; bar: string }> = {
  avulsos:  { label: "Avulsos",        tone: "bg-blue-50 text-blue-900 border-blue-200",      ring: "ring-blue-300",   bar: "bg-blue-500" },
  projetos: { label: "Projetos",       tone: "bg-violet-50 text-violet-900 border-violet-200", ring: "ring-violet-300", bar: "bg-violet-500" },
  pcs:      { label: "PCs Standalone", tone: "bg-amber-50 text-amber-900 border-amber-200",   ring: "ring-amber-300",  bar: "bg-amber-500" },
};

type Preset = "hoje" | "7d" | "30d" | "mes" | "mes_passado" | "ano" | "custom";
const PRESETS: { v: Preset; label: string }[] = [
  { v: "hoje",         label: "Hoje" },
  { v: "7d",           label: "Últimos 7 dias" },
  { v: "30d",          label: "Últimos 30 dias" },
  { v: "mes",          label: "Este mês" },
  { v: "mes_passado",  label: "Mês passado" },
  { v: "ano",          label: "Este ano" },
  { v: "custom",       label: "Personalizado" },
];

function rangeForPreset(p: Preset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (p) {
    case "hoje":         return { from: fmt(today), to: fmt(today) };
    case "7d":           return { from: fmt(new Date(today.getTime() - 6 * 86_400_000)), to: fmt(today) };
    case "30d":          return { from: fmt(new Date(today.getTime() - 29 * 86_400_000)), to: fmt(today) };
    case "mes":          return { from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), to: fmt(today) };
    case "mes_passado": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case "ano":          return { from: fmt(new Date(today.getFullYear(), 0, 1)), to: fmt(today) };
    case "custom":       return { from: customFrom || fmt(today), to: customTo || fmt(today) };
  }
}

export default function RelatoriosView() {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo]     = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduloFilter, setModuloFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const range = useMemo(() => rangeForPreset(preset, customFrom, customTo), [preset, customFrom, customTo]);

  async function load() {
    setLoading(true); setError(null);
    const r = await fetch(`/api/relatorios?from=${range.from}&to=${range.to}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? r.statusText); setLoading(false); return; }
    setReport(j);
    setLoading(false);
  }
  useEffect(() => { load(); }, [range.from, range.to]);

  const filteredRows = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.rows.filter((r) => {
      if (moduloFilter && r.modulo !== moduloFilter) return false;
      if (!q) return true;
      const hay = [r.pc, r.pv_os, r.fornecedor, r.projeto, r.cliente, r.aprovador].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [report, moduloFilter, query]);

  const filteredTotalValor = useMemo(() =>
    filteredRows.reduce((acc, r) => acc + r.valor, 0),
    [filteredRows]);

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-slate-900">Relatório de aprovações</h1>
          <p className="text-sm text-slate-500 mt-1">Resumo das compras aprovadas no período. Filtra por data de aprovação.</p>
        </div>
        {report && (
          <div className="text-[11px] text-slate-500 font-mono">
            {report.range.from} → {report.range.to}
          </div>
        )}
      </div>

      {/* Filtros de período */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mr-1">Período:</span>
          {PRESETS.map((p) => (
            <button key={p.v} onClick={() => setPreset(p.v)}
              className={`px-3 py-1 rounded-md text-[11.5px] font-semibold border-2 transition ${
                preset === p.v
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500">de</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded-md text-sm" />
            <span className="text-[11px] text-slate-500">até</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded-md text-sm" />
          </div>
        )}
      </div>

      {error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{error}</div>}
      {loading && <div className="py-12 text-center text-sm text-slate-400">Carregando…</div>}

      {!loading && report && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total aprovado" value={fmtBRL(report.kpis.totalValor)} accent="text-emerald-600" />
            <Kpi label="Aprovações" value={report.kpis.totalAprovacoes.toLocaleString("pt-BR")} accent="text-slate-900" />
            <Kpi label="Ticket médio" value={fmtBRL(report.kpis.ticketMedio)} accent="text-blue-600" />
            <Kpi label="Maior aprovação" value={fmtBRL(report.kpis.maiorAprovacao)} accent="text-amber-600" />
          </div>

          {/* Cards por módulo (clicáveis = filtra a tabela) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {report.byModulo.map((m) => {
              const meta = MODULO_META[m.modulo] ?? MODULO_META.avulsos;
              const active = moduloFilter === m.modulo;
              const pct = report.kpis.totalValor > 0 ? (m.valor / report.kpis.totalValor) * 100 : 0;
              return (
                <button key={m.modulo}
                  onClick={() => setModuloFilter(active ? null : m.modulo)}
                  className={`text-left rounded-xl border-2 p-4 transition ${meta.tone} ${active ? `ring-2 ${meta.ring} shadow-md` : "border-transparent hover:shadow-sm"}`}
                  style={{ borderColor: active ? "currentColor" : undefined }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] uppercase tracking-wider font-bold opacity-80">{meta.label}</span>
                    <span className="text-[10px] tabular-nums font-mono opacity-60">{m.count} aprov.</span>
                  </div>
                  <div className="text-[22px] font-bold tabular-nums tracking-[-0.5px]">{fmtBRL(m.valor)}</div>
                  <div className="mt-2 h-1.5 bg-white/50 rounded overflow-hidden">
                    <div className={`h-full ${meta.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] mt-1 opacity-70 tabular-nums">{pct.toFixed(1).replace(".", ",")}% do total</div>
                </button>
              );
            })}
          </div>

          {/* Filtros da tabela */}
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar PC, PV/OS, fornecedor, projeto, aprovador…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              className="flex-1 min-w-[280px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40" />
            {moduloFilter && (
              <button onClick={() => setModuloFilter(null)}
                className="text-[11.5px] font-semibold text-slate-600 underline-offset-2 hover:underline">
                Limpar filtro de módulo ({MODULO_META[moduloFilter]?.label})
              </button>
            )}
            <span className="text-[11.5px] text-slate-500 font-mono ml-auto">
              {filteredRows.length} {filteredRows.length === 1 ? "linha" : "linhas"} · <strong className="text-slate-900">{fmtBRL(filteredTotalValor)}</strong>
            </span>
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50/60">
                    <th className="px-4 py-2 font-semibold">Aprovado em</th>
                    <th className="px-3 py-2 font-semibold">Módulo</th>
                    <th className="px-3 py-2 font-semibold">PV/OS</th>
                    <th className="px-3 py-2 font-semibold">PC</th>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 font-semibold">Fornecedor</th>
                    <th className="px-3 py-2 font-semibold">Projeto</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor</th>
                    <th className="px-3 py-2 font-semibold">Aprovador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.length === 0 && (
                    <tr><td colSpan={9} className="px-5 py-12 text-center text-slate-400 italic text-sm">Nenhuma aprovação no período.</td></tr>
                  )}
                  {filteredRows.map((r, i) => {
                    const meta = MODULO_META[r.modulo] ?? MODULO_META.avulsos;
                    return (
                      <tr key={`${r.empresa}-${r.ncod_ped}-${i}`} className="hover:bg-slate-50/40 transition">
                        <td className="px-4 py-2 text-slate-700 text-[11.5px] tabular-nums whitespace-nowrap">{fmtDateTime(r.aprovado_em)}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${meta.tone}`}>{meta.label}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-900 font-mono text-[11.5px]">
                          {r.pv_os ?? "—"}
                          {r.pv_os_tipo && <span className="ml-1 text-[9px] text-slate-400">{r.pv_os_tipo}</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-700 font-mono text-[11.5px]">{r.pc ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-700 text-[12px] truncate max-w-[180px]" title={r.cliente ?? ""}>{r.cliente ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-700 text-[12px] truncate max-w-[180px]" title={r.fornecedor ?? ""}>{r.fornecedor ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500 font-mono text-[11px] truncate max-w-[120px]" title={r.projeto ?? ""}>{r.projeto ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">{fmtBRL(r.valor)}</td>
                        <td className="px-3 py-2 text-slate-600 text-[11px] truncate max-w-[160px]" title={r.aprovador ?? ""}>{(r.aprovador ?? "—").split("@")[0]}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {filteredRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={7} className="px-4 py-2 text-right text-[11px] uppercase tracking-wider font-bold text-slate-600">Total filtrado</td>
                      <td className="px-3 py-2 text-right text-slate-900 font-bold tabular-nums">{fmtBRL(filteredTotalValor)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-[10px] uppercase tracking-[0.6px] font-bold text-slate-500 mb-1">{label}</div>
      <div className={`text-[22px] font-bold tabular-nums tracking-[-0.5px] ${accent}`}>{value}</div>
    </div>
  );
}
