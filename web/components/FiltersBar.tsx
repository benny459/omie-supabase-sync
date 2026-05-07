"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isApproved } from "@/lib/columns";

type AnyRow = Record<string, unknown>;

export type StatusFilter = "todos" | "aprovados" | "nao_aprovados" | "pendentes" | "atrasados" | "sem_projeto";
export type FacetKey = "projeto_nome" | "tipo_omie" | "pc_etapa_texto" | "codigo_categoria" | "contato_fornecedor";
export type FacetState = Partial<Record<FacetKey, Set<string>>>;

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "projeto_nome",        label: "Projeto" },
  { key: "tipo_omie",           label: "Tipo Omie" },
  { key: "pc_etapa_texto",      label: "Etapa PC" },
  { key: "codigo_categoria",    label: "Categoria" },
  { key: "contato_fornecedor",  label: "Fornecedor" },
];

export default function FiltersBar({
  rows,
  query, setQuery,
  statusFilter, setStatusFilter,
  facets, setFacets,
}: {
  rows: AnyRow[];
  query: string; setQuery: (v: string) => void;
  statusFilter: StatusFilter; setStatusFilter: (v: StatusFilter) => void;
  facets: FacetState; setFacets: (f: FacetState) => void;
}) {
  const summary = useMemo(() => {
    let apr = 0, pen = 0, nao = 0, atr = 0, semProj = 0;
    const today = new Date();
    today.setHours(0,0,0,0);
    for (const r of rows) {
      const s = String(r.status ?? "PENDENTE");
      if (isApproved(s)) apr++;
      else if (s === "PENDENTE") pen++;
      else nao++;
      const aDate = r.aprovar_ate_calc as string | null;
      if (aDate && !isApproved(s)) {
        const d = new Date(aDate);
        if (!Number.isNaN(d.getTime()) && d < today) atr++;
      }
      if (r.sem_projeto === true) semProj++;
    }
    return { total: rows.length, aprovados: apr, pendentes: pen, nao_aprovados: nao, atrasados: atr, sem_projeto: semProj };
  }, [rows]);

  // Linhas usadas pra computar valores + contagens dos facets — já filtradas
  // pelo card de status ativo. Assim, clicar em "Aprovados" faz os dropdowns
  // só mostrarem valores/contagens de linhas aprovadas.
  const rowsForFacets = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return rows.filter((r) => {
      const s = String(r.status ?? "");
      if (statusFilter === "aprovados"     && !isApproved(s)) return false;
      if (statusFilter === "nao_aprovados" && (isApproved(s) || s === "PENDENTE")) return false;
      if (statusFilter === "pendentes"     && s !== "PENDENTE") return false;
      if (statusFilter === "sem_projeto"   && r.sem_projeto !== true) return false;
      if (statusFilter === "atrasados") {
        const aDate = r.aprovar_ate_calc as string | null;
        if (!aDate || isApproved(s)) return false;
        const d = new Date(aDate);
        if (Number.isNaN(d.getTime()) || d >= today) return false;
      }
      return true;
    });
  }, [rows, statusFilter]);

  const facetValues = useMemo(() => {
    const acc: Record<FacetKey, Map<string, number>> = {
      projeto_nome: new Map(),
      tipo_omie: new Map(), pc_etapa_texto: new Map(),
      codigo_categoria: new Map(), contato_fornecedor: new Map(),
    };
    for (const r of rowsForFacets) {
      for (const { key } of FACETS) {
        const v = r[key];
        if (v == null || v === "") continue;
        const str = String(v);
        acc[key].set(str, (acc[key].get(str) ?? 0) + 1);
      }
    }
    return acc;
  }, [rowsForFacets]);

  function toggleFacet(key: FacetKey, value: string) {
    const cur = new Set(facets[key] ?? []);
    if (cur.has(value)) cur.delete(value); else cur.add(value);
    setFacets({ ...facets, [key]: cur });
  }

  function clearFacet(key: FacetKey) {
    setFacets({ ...facets, [key]: new Set() });
  }

  function clearAll() {
    setFacets({});
    setQuery("");
    setStatusFilter("todos");
  }

  const hasActiveFacets = Object.values(facets).some(s => s && s.size > 0);
  const hasActiveFilters = hasActiveFacets || query.trim().length > 0 || statusFilter !== "todos";

  return (
    <div className="space-y-3">
      {/* Summary cards — ordem: Todos, Aprovados, Não Aprovados, Pendentes, Atrasados */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          label="Todos" value={summary.total} tone="slate"
          active={statusFilter === "todos"}
          onClick={() => setStatusFilter("todos")}
          icon={<IconTicket />}
        />
        <SummaryCard
          label="Aprovados" value={summary.aprovados} tone="emerald"
          active={statusFilter === "aprovados"}
          onClick={() => setStatusFilter("aprovados")}
          icon={<IconCheck />}
        />
        <SummaryCard
          label="Não Aprovados" value={summary.nao_aprovados} tone="rose"
          active={statusFilter === "nao_aprovados"}
          onClick={() => setStatusFilter("nao_aprovados")}
          icon={<IconX />}
        />
        <SummaryCard
          label="Pendentes" value={summary.pendentes} tone="amber"
          active={statusFilter === "pendentes"}
          onClick={() => setStatusFilter("pendentes")}
          icon={<IconClock />}
        />
        <SummaryCard
          label="Atrasados" value={summary.atrasados} tone="orange"
          active={statusFilter === "atrasados"}
          onClick={() => setStatusFilter("atrasados")}
          icon={<IconAlert />}
        />
      </div>

      {summary.sem_projeto > 0 && (
        <button
          onClick={() => setStatusFilter(statusFilter === "sem_projeto" ? "todos" : "sem_projeto")}
          className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg border text-left transition ${
            statusFilter === "sem_projeto"
              ? "bg-amber-50 border-amber-400 ring-2 ring-amber-200"
              : "bg-amber-50/60 border-amber-200 hover:bg-amber-50"
          }`}
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <IconAlert />
          </div>
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-semibold text-amber-900">⚠️ {summary.sem_projeto.toLocaleString("pt-BR")} registro{summary.sem_projeto !== 1 ? "s" : ""} sem projeto atribuído.</span>
            <span className="ml-2 text-xs text-amber-800/80">Clique pra filtrar. Vão migrar pra Projetos quando o Omie atribuir o PJ.</span>
          </div>
        </button>
      )}

      {/* Barra compacta: search + facet dropdowns + clear */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por PC, PV/OS, cliente, fornecedor, RC…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/60 bg-white"
          />
        </div>
        {FACETS.map(({ key, label }) => (
          <FacetDropdown
            key={key}
            label={label}
            values={facetValues[key]}
            selected={facets[key] ?? new Set()}
            onToggle={(v) => toggleFacet(key, v)}
            onClear={() => clearFacet(key)}
          />
        ))}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition whitespace-nowrap"
          >
            Limpar tudo
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FacetDropdown — botão que abre um menu com checkboxes multi-select
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
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition ${
          active
            ? "bg-sky-50 border-sky-300 text-sky-900"
            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span>{label}</span>
        {active && (
          <span className="bg-sky-600 text-white rounded-full px-1.5 text-[10px] font-semibold tabular-nums">
            {count}
          </span>
        )}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute z-40 mt-1 right-0 w-[260px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${label.toLowerCase()}…`}
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {entries.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-slate-400 italic text-center">
                Nenhum valor encontrado
              </div>
            )}
            {entries.map(([val, count]) => {
              const on = selected.has(val);
              return (
                <button
                  key={val}
                  onClick={() => onToggle(val)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 transition text-left"
                >
                  <span className={`flex items-center justify-center w-4 h-4 rounded border shrink-0 ${
                    on ? "bg-sky-600 border-sky-600" : "border-slate-300 bg-white"
                  }`}>
                    {on && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 text-[11px] truncate text-slate-700">{val}</span>
                  <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          {count > 0 && (
            <div className="border-t border-slate-100 p-1">
              <button
                onClick={() => { onClear(); setOpen(false); }}
                className="w-full text-center px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-md transition"
              >
                Limpar {count} selecionado{count !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Filtragem ──────────────────────────────────────────────────────────────

export function applyFilters(
  rows: AnyRow[],
  { query, statusFilter, facets }: {
    query: string; statusFilter: StatusFilter; facets: FacetState;
  }
): AnyRow[] {
  const q = query.trim().toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);
  return rows.filter((r) => {
    const s = String(r.status ?? "");
    if (statusFilter === "aprovados"     && !isApproved(s)) return false;
    if (statusFilter === "nao_aprovados" && (isApproved(s) || s === "PENDENTE")) return false;
    if (statusFilter === "pendentes"     && s !== "PENDENTE") return false;
    if (statusFilter === "sem_projeto"   && r.sem_projeto !== true) return false;
    if (statusFilter === "atrasados") {
      const aDate = r.aprovar_ate_calc as string | null;
      if (!aDate || isApproved(s)) return false;
      const d = new Date(aDate);
      if (Number.isNaN(d.getTime()) || d >= today) return false;
    }
    for (const [key, set] of Object.entries(facets)) {
      if (!set || set.size === 0) continue;
      if (!set.has(String(r[key] ?? ""))) return false;
    }
    if (!q) return true;
    const hay = [
      r.pc_numero, r.pv_os_label, r.projeto_nome, r.pv_cliente_nome, r.pv_cliente_fantasia,
      r.contato_fornecedor, r.rc_numero, r.rc_descricao, r.justificativa,
      r.aprovador_email, r.status_label, r.codigo_categoria,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SummaryCard + ícones
// ─────────────────────────────────────────────────────────────────────────

const TONE_MAP: Record<string, { ring: string; text: string; iconBg: string }> = {
  slate:   { ring: "ring-slate-300",   text: "text-slate-900",   iconBg: "bg-slate-100 text-slate-600" },
  emerald: { ring: "ring-emerald-300", text: "text-emerald-900", iconBg: "bg-emerald-100 text-emerald-700" },
  rose:    { ring: "ring-rose-300",    text: "text-rose-900",    iconBg: "bg-rose-100 text-rose-700" },
  amber:   { ring: "ring-amber-300",   text: "text-amber-900",   iconBg: "bg-amber-100 text-amber-700" },
  orange:  { ring: "ring-orange-300",  text: "text-orange-900",  iconBg: "bg-orange-100 text-orange-700" },
  violet:  { ring: "ring-violet-300",  text: "text-violet-900",  iconBg: "bg-violet-100 text-violet-700" },
};

function SummaryCard({
  label, value, tone, active, onClick, icon,
}: {
  label: string; value: number; tone: keyof typeof TONE_MAP;
  active: boolean; onClick: () => void; icon: React.ReactNode;
}) {
  const t = TONE_MAP[tone];
  return (
    <button
      onClick={onClick}
      className={`relative bg-white rounded-xl border transition-all text-left p-4 hover:shadow-md hover:-translate-y-0.5 ${
        active
          ? `border-transparent ring-2 ${t.ring} shadow-md`
          : "border-slate-200 shadow-sm"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.iconBg}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-2xl font-semibold tabular-nums ${t.text}`}>
            {value.toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-slate-500 font-medium">{label}</div>
        </div>
      </div>
    </button>
  );
}

function IconTicket()  { return svg("M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7z", "M13 5v14"); }
function IconCheck()   { return svg("M20 6L9 17l-5-5"); }
function IconClock()   { return svg("M12 6v6l4 2", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"); }
function IconAlert()   { return svg("M10.3 3.86l-8.3 14.14A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.71-2.99l-8.3-14.14a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"); }
function IconX()       { return svg("M18 6L6 18", "M6 6l12 12"); }

function svg(...paths: string[]) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      {paths.map((d, i) => <path key={i} d={d}/>)}
    </svg>
  );
}
