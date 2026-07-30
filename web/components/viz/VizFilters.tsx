"use client";

// Barra de filtros dos dashboards. Uma linha, ACIMA do conteúdo, escopando tudo
// que vem abaixo — nunca dentro de um card, nunca um filtro por gráfico. Se um
// gráfico precisa de range próprio, ele é outro dashboard.
//
// Data primeiro: é o filtro que todo leitor procura antes de qualquer outro.
// Presets como LISTA de linhas (ninguém briga com um calendário pra dizer
// "últimos 30 dias"); range custom atrás de uma divisória no fim.
//
// Este é o requisito que você levantou: os gráficos nativos precisam filtrar por
// datas e dimensões diferentes, senão perdemos o que o Metabase dava.

import { useState } from "react";

export type DateRange = { from: string; to: string; preset: PresetKey };
export type PresetKey = "hoje" | "7d" | "30d" | "90d" | "mtd" | "ytd" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d",   label: "Últimos 7 dias" },
  { key: "30d",  label: "Últimos 30 dias" },
  { key: "90d",  label: "Últimos 90 dias" },
  { key: "mtd",  label: "Mês até hoje" },
  { key: "ytd",  label: "Ano até hoje" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function resolvePreset(preset: PresetKey, hoje = new Date()): { from: string; to: string } {
  const to = iso(hoje);
  const back = (n: number) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - n);
    return iso(d);
  };
  switch (preset) {
    case "hoje": return { from: to, to };
    case "7d":   return { from: back(6),  to };
    case "30d":  return { from: back(29), to };
    case "90d":  return { from: back(89), to };
    case "mtd":  return { from: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), to };
    case "ytd":  return { from: iso(new Date(hoje.getFullYear(), 0, 1)), to };
    default:     return { from: back(29), to };
  }
}

export type DimFilter = {
  key: string;
  label: string;
  options: string[];
  selected: Set<string>;
};

export default function VizFilters({
  range, onRangeChange, dims, onDimChange, right,
}: {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  dims?: DimFilter[];
  onDimChange?: (key: string, selected: Set<string>) => void;
  right?: React.ReactNode;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const label = range.preset === "custom"
    ? `${range.from.split("-").reverse().join("/")} → ${range.to.split("-").reverse().join("/")}`
    : PRESETS.find((p) => p.key === range.preset)?.label ?? "Período";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Data primeiro */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setDateOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold rounded-md border border-ww-border bg-ww-panel text-ww-text hover:bg-ww-rowHover transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          {label}
        </button>
        {dateOpen && (
          <div className="absolute z-30 mt-1 w-[200px] bg-ww-panel border border-ww-border rounded-lg shadow-xl p-1">
            {PRESETS.map((p) => {
              const active = range.preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    onRangeChange({ ...resolvePreset(p.key), preset: p.key });
                    setDateOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 text-[11.5px] rounded transition ${
                    active ? "font-bold text-ww-text" : "text-ww-textMuted hover:bg-ww-rowHover"
                  }`}
                >
                  {p.label}
                  {/* Seleção marcada por check em negrito; hover fica lavagem
                      fantasma pra nunca competir com a seleção. */}
                  {active && <span className="text-[16px] font-bold leading-none">✓</span>}
                </button>
              );
            })}
            {/* Custom atrás de uma divisória, no rodapé */}
            <div className="border-t border-ww-border mt-1 pt-1 px-2 pb-1 flex items-center gap-1">
              <input type="date" value={range.from} max={range.to}
                     onChange={(e) => onRangeChange({ ...range, from: e.target.value, preset: "custom" })}
                     className="w-full text-[10.5px] bg-transparent border border-ww-border rounded px-1 py-0.5 text-ww-text" />
              <span className="text-ww-textFaint text-[10px]">→</span>
              <input type="date" value={range.to} min={range.from}
                     onChange={(e) => onRangeChange({ ...range, to: e.target.value, preset: "custom" })}
                     className="w-full text-[10.5px] bg-transparent border border-ww-border rounded px-1 py-0.5 text-ww-text" />
            </div>
          </div>
        )}
      </div>

      {/* Dimensões — combobox padrão, multi-seleção */}
      {(dims ?? []).map((d) => (
        <details key={d.key} className="relative">
          <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold rounded-md border border-ww-border bg-ww-panel text-ww-text hover:bg-ww-rowHover transition">
            {d.label}
            {d.selected.size > 0 && (
              <span className="px-1 rounded bg-ww-accentSoft text-ww-accent text-[10px] font-bold tabular-nums">
                {d.selected.size}
              </span>
            )}
          </summary>
          <div className="absolute z-30 mt-1 w-[220px] max-h-[260px] overflow-y-auto bg-ww-panel border border-ww-border rounded-lg shadow-xl p-1">
            {d.options.map((o) => {
              const on = d.selected.has(o);
              return (
                <label key={o} className="flex items-center gap-2 px-2 py-1 text-[11.5px] text-ww-text rounded hover:bg-ww-rowHover cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(d.selected);
                      if (on) next.delete(o); else next.add(o);
                      onDimChange?.(d.key, next);
                    }}
                  />
                  <span className="truncate">{o}</span>
                </label>
              );
            })}
          </div>
        </details>
      ))}

      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
