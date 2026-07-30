"use client";

// AtribuirClienteView — pra Fernanda/Erick marcarem cliente(s) em PCs
// standalone. Multi-cliente com rateio percentual (default 100/N, editável).
// Substitui atribuição anterior no salvar.

import { useEffect, useMemo, useState } from "react";

type PcRow = {
  empresa: string; pc_numero: string;
  valor_total: string; projeto_nome: string | null;
  codigo_projeto: number | null; _dt_inclusao_d: string;
  qtd_clientes?: number;
  clientes?: { codigo_cliente_omie: number; nome?: string; percentual: number }[];
  soma_pct?: number;
};
type OmieCli = { codigo_cliente_omie: number; razao_social: string; nome_fantasia: string | null; cnpj_cpf: string | null };
type Resp = {
  resumo: { total_standalone: number; backlog: number; atribuidos: number; valor_backlog: number };
  backlog: PcRow[];
  atribuidos: PcRow[];
};

const brl = (v: number | string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(v) || 0);
const brlCompact = (v: number | string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v) || 0);
const fmtBR = (iso: string) => { if (!iso) return "?"; const [y,m,d] = iso.split("-"); return `${d}/${m}/${y}`; };

// ─── Helpers de data ────────────────────────────────────────────────
type DatePreset = "off" | "7d" | "30d" | "mes" | "mes-1" | "3m" | "6m" | "12m" | "ytd" | "ano-1" | "custom";
const DATE_LABEL: Record<DatePreset, string> = {
  "off": "Todas as datas", "7d": "Últ 7d", "30d": "Últ 30d",
  "mes": "Mês atual", "mes-1": "Mês anterior",
  "3m": "Últ 3m", "6m": "Últ 6m", "12m": "Últ 12m",
  "ytd": "YTD", "ano-1": "Ano anterior", "custom": "Custom",
};
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addMonths(d: Date, delta: number) { return new Date(d.getFullYear(), d.getMonth()+delta, 1); }
function computeDateWindow(preset: DatePreset, from: string, to: string): { fromIso: string; toIso: string } | null {
  const today = new Date();
  if (preset === "off") return null;
  if (preset === "custom") {
    if (!from && !to) return null;
    return { fromIso: from || "1900-01-01", toIso: to || "2999-12-31" };
  }
  if (preset === "7d")   return { fromIso: ymd(new Date(today.getTime() - 7 * 86400000)), toIso: ymd(today) };
  if (preset === "30d")  return { fromIso: ymd(new Date(today.getTime() - 30 * 86400000)), toIso: ymd(today) };
  if (preset === "mes")  return { fromIso: ymd(firstOfMonth(today)), toIso: ymd(lastOfMonth(today)) };
  if (preset === "mes-1"){ const d = addMonths(today, -1); return { fromIso: ymd(firstOfMonth(d)), toIso: ymd(lastOfMonth(d)) }; }
  if (preset === "3m")   return { fromIso: ymd(firstOfMonth(addMonths(today, -2))), toIso: ymd(lastOfMonth(today)) };
  if (preset === "6m")   return { fromIso: ymd(firstOfMonth(addMonths(today, -5))), toIso: ymd(lastOfMonth(today)) };
  if (preset === "12m")  return { fromIso: ymd(firstOfMonth(addMonths(today, -11))), toIso: ymd(lastOfMonth(today)) };
  if (preset === "ytd")  return { fromIso: `${today.getFullYear()}-01-01`, toIso: ymd(today) };
  if (preset === "ano-1"){ const y = today.getFullYear()-1; return { fromIso: `${y}-01-01`, toIso: `${y}-12-31` }; }
  return null;
}

export default function AtribuirClienteView() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"backlog" | "atribuidos">("backlog");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<PcRow | null>(null);
  // Filtros de localização
  const [projetos, setProjetos] = useState<Set<string>>(new Set());
  const [projetoOpen, setProjetoOpen] = useState(false);
  const [empresasSel, setEmpresasSel] = useState<Set<string>>(new Set());
  const [mesesSel, setMesesSel] = useState<Set<string>>(new Set());     // "YYYY-MM"
  const [faixasSel, setFaixasSel] = useState<Set<string>>(new Set());   // "0-500" etc
  const [datePreset, setDatePreset] = useState<DatePreset>("off");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Auto-abertura vinda de link /pcs (?empresa=X&pc=Y): dispara 1x quando data chega.
  const [autoOpened, setAutoOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = await fetch("/api/pcs/atribuicao", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  useEffect(() => {
    if (autoOpened || !data) return;
    const url = new URL(window.location.href);
    const empresa = url.searchParams.get("empresa");
    const pc = url.searchParams.get("pc");
    const projeto = url.searchParams.get("projeto");
    if (empresa && pc) {
      const alvo = [...data.backlog, ...data.atribuidos].find(p => p.empresa === empresa && p.pc_numero === pc);
      if (alvo) {
        setEditing(alvo);
        setTab(data.atribuidos.some(p => p.empresa === empresa && p.pc_numero === pc) ? "atribuidos" : "backlog");
      }
    } else if (projeto) {
      setFilter(projeto);
    }
    setAutoOpened(true);
  }, [data, autoOpened]);

  const dateWindow = useMemo(() => computeDateWindow(datePreset, dateFrom, dateTo), [datePreset, dateFrom, dateTo]);

  // Faixas de valor pré-definidas (bater com bucket em facets).
  const FAIXAS = [
    { key: "0-500",     label: "≤ R$500",       min: 0,     max: 500 },
    { key: "500-2k",    label: "R$500-2k",      min: 500,   max: 2000 },
    { key: "2k-10k",    label: "R$2k-10k",      min: 2000,  max: 10000 },
    { key: "10k-50k",   label: "R$10k-50k",     min: 10000, max: 50000 },
    { key: "50k+",      label: "R$50k+",        min: 50000, max: Infinity },
  ];
  function faixaOf(v: number): string {
    for (const f of FAIXAS) if (v >= f.min && v < f.max) return f.key;
    return FAIXAS[FAIXAS.length - 1].key;
  }
  function mesOf(iso: string | null): string {
    if (!iso) return "(sem data)";
    return iso.slice(0, 7); // YYYY-MM
  }

  const listVis = useMemo(() => {
    if (!data) return [];
    const list = tab === "backlog" ? data.backlog : data.atribuidos;
    const valMin = valorMin ? Number(valorMin) : null;
    const valMax = valorMax ? Number(valorMax) : null;
    return list.filter(p => {
      if (filter && !p.pc_numero.includes(filter) && !(p.projeto_nome ?? "").toLowerCase().includes(filter.toLowerCase())) return false;
      if (projetos.size > 0 && !projetos.has(p.projeto_nome ?? "(sem)")) return false;
      if (empresasSel.size > 0 && !empresasSel.has(p.empresa)) return false;
      if (mesesSel.size > 0 && !mesesSel.has(mesOf(p._dt_inclusao_d))) return false;
      const v = Number(p.valor_total) || 0;
      if (faixasSel.size > 0 && !faixasSel.has(faixaOf(v))) return false;
      if (dateWindow) {
        const d = p._dt_inclusao_d;
        if (!d || d < dateWindow.fromIso || d > dateWindow.toIso) return false;
      }
      if (valMin != null && v < valMin) return false;
      if (valMax != null && v > valMax) return false;
      return true;
    });
  }, [data, tab, filter, projetos, empresasSel, mesesSel, faixasSel, dateWindow, valorMin, valorMax]);

  // Distribuições pra facet cards — recomputadas sobre lista da tab (não filtrada
  // ainda), assim o user vê as contagens totais e escolhe.
  const facetDist = useMemo(() => {
    const list = data ? (tab === "backlog" ? data.backlog : data.atribuidos) : [];
    const projMap = new Map<string, { count: number; total: number }>();
    const empMap  = new Map<string, { count: number; total: number }>();
    const mesMap  = new Map<string, { count: number; total: number }>();
    const faixMap = new Map<string, { count: number; total: number }>();
    for (const p of list) {
      const v = Number(p.valor_total) || 0;
      const bump = (m: Map<string, { count: number; total: number }>, k: string) => {
        const cur = m.get(k) ?? { count: 0, total: 0 };
        cur.count++; cur.total += v; m.set(k, cur);
      };
      bump(projMap, p.projeto_nome ?? "(sem)");
      bump(empMap, p.empresa);
      bump(mesMap, mesOf(p._dt_inclusao_d));
      bump(faixMap, faixaOf(v));
    }
    const asArr = (m: Map<string, { count: number; total: number }>) =>
      Array.from(m.entries()).map(([k, v]) => ({ key: k, ...v }));
    return {
      projetos: asArr(projMap).sort((a, b) => b.count - a.count),
      empresas: asArr(empMap).sort((a, b) => b.count - a.count),
      meses:    asArr(mesMap).sort((a, b) => b.key.localeCompare(a.key)),  // recente primeiro
      faixas:   FAIXAS.map(f => {
        const v = faixMap.get(f.key) ?? { count: 0, total: 0 };
        return { key: f.key, label: f.label, ...v };
      }),
    };
  }, [data, tab]);

  // Opções de projeto (todos os PCs da tab atual) — com contagem
  const projetoOptions = useMemo(() => {
    if (!data) return [];
    const list = tab === "backlog" ? data.backlog : data.atribuidos;
    const map = new Map<string, { count: number; total: number }>();
    for (const p of list) {
      const k = p.projeto_nome ?? "(sem)";
      const cur = map.get(k) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(p.valor_total) || 0;
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([nome, v]) => ({ nome, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count);
  }, [data, tab]);

  // Sel bulk
  const selectedList = useMemo(() => listVis.filter(p => selected.has(`${p.empresa}|${p.pc_numero}`)), [listVis, selected]);
  const selectedTotal = selectedList.reduce((a, p) => a + (Number(p.valor_total) || 0), 0);
  const allVisSelected = listVis.length > 0 && listVis.every(p => selected.has(`${p.empresa}|${p.pc_numero}`));
  function toggleAll() {
    if (allVisSelected) { setSelected(new Set()); }
    else {
      const s = new Set<string>();
      for (const p of listVis) s.add(`${p.empresa}|${p.pc_numero}`);
      setSelected(s);
    }
  }
  function toggleOne(p: PcRow) {
    const k = `${p.empresa}|${p.pc_numero}`;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }
  function clearFilters() {
    setFilter(""); setProjetos(new Set()); setEmpresasSel(new Set()); setMesesSel(new Set()); setFaixasSel(new Set());
    setDatePreset("off"); setDateFrom(""); setDateTo(""); setValorMin(""); setValorMax("");
  }
  function toggleInSet(setter: (fn: (prev: Set<string>) => Set<string>) => void, key: string) {
    setter(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  const anyFilter = filter !== "" || projetos.size > 0 || empresasSel.size > 0 || mesesSel.size > 0 ||
    faixasSel.size > 0 || datePreset !== "off" || valorMin !== "" || valorMax !== "";

  return (
    <div className="space-y-4">
      {/* Resumo */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Kpi label="Standalone (aprov)" value={data.resumo.total_standalone.toString()} tone="slate" />
          <Kpi label="🔴 Sem atribuição (backlog)" value={data.resumo.backlog.toString()} tone="rose"
               sub={brl(data.resumo.valor_backlog)} />
          <Kpi label="🟢 Já atribuídos" value={data.resumo.atribuidos.toString()} tone="emerald" />
          <Kpi label="% coberto" value={data.resumo.total_standalone > 0
              ? `${Math.round(data.resumo.atribuidos / data.resumo.total_standalone * 100)}%` : "—"}
               tone="violet" />
        </div>
      )}

      {err && <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[12px]">{err}</div>}

      {/* Tabs + filtros */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-ww-border overflow-hidden">
            <button onClick={() => { setTab("backlog"); setSelected(new Set()); }}
              className={`px-3 py-1.5 text-[12px] font-semibold ${tab==="backlog" ? "bg-rose-600 text-white" : "bg-ww-panel text-ww-text hover:bg-ww-rowHover"}`}>
              🔴 Sem atribuição ({data?.resumo.backlog ?? 0})
            </button>
            <button onClick={() => { setTab("atribuidos"); setSelected(new Set()); }}
              className={`px-3 py-1.5 text-[12px] font-semibold ${tab==="atribuidos" ? "bg-emerald-600 text-white" : "bg-ww-panel text-ww-text hover:bg-ww-rowHover"}`}>
              🟢 Atribuídos ({data?.resumo.atribuidos ?? 0})
            </button>
          </div>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
                 placeholder="PC # ou projeto…"
                 className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text w-52" />
          <div className="ml-auto text-[11px] text-ww-textMuted tabular-nums">
            {listVis.length} de {tab === "backlog" ? data?.resumo.backlog ?? 0 : data?.resumo.atribuidos ?? 0} · R$ {listVis.reduce((a, p) => a + (Number(p.valor_total) || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* Facet cards estilo /avulsos — distribuição por Projeto / Empresa / Mês / Faixa */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            <FacetCard title="Projeto" accent="violet" items={facetDist.projetos.slice(0, 8)}
                       selected={projetos}
                       onToggle={(k) => toggleInSet(setProjetos, k)}
                       onClear={() => setProjetos(new Set())}
                       moreCount={facetDist.projetos.length > 8 ? facetDist.projetos.length - 8 : 0} />
            <FacetCard title="Empresa" accent="blue" items={facetDist.empresas}
                       selected={empresasSel}
                       onToggle={(k) => toggleInSet(setEmpresasSel, k)}
                       onClear={() => setEmpresasSel(new Set())} />
            <FacetCard title="Mês (inclusão)" accent="amber" items={facetDist.meses.slice(0, 8)}
                       formatKey={(k) => k === "(sem data)" ? "s/data" : (() => {
                         const [y, m] = k.split("-");
                         const nomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
                         return `${nomes[Number(m)-1] ?? m}/${y.slice(2)}`;
                       })()}
                       selected={mesesSel}
                       onToggle={(k) => toggleInSet(setMesesSel, k)}
                       onClear={() => setMesesSel(new Set())}
                       moreCount={facetDist.meses.length > 8 ? facetDist.meses.length - 8 : 0} />
            <FacetCard title="Faixa de valor" accent="emerald"
                       items={facetDist.faixas.map(f => ({ key: f.key, count: f.count, total: f.total, label: f.label }))}
                       selected={faixasSel}
                       onToggle={(k) => toggleInSet(setFaixasSel, k)}
                       onClear={() => setFaixasSel(new Set())} />
          </div>
        )}

        {/* Linha 2: presets data + custom + valor + projeto */}
        <div className="flex items-center gap-1.5 flex-wrap p-2 bg-ww-panel rounded-lg border border-ww-border">
          <span className="text-[10px] uppercase text-ww-textMuted mr-1 font-semibold">Data:</span>
          {(["off","7d","30d","mes","mes-1","3m","6m","12m","ytd","ano-1"] as DatePreset[]).map(p => (
            <button key={p} onClick={() => { setDatePreset(p); setDateFrom(""); setDateTo(""); }}
              className={`px-2 py-0.5 text-[11px] font-semibold rounded border transition ${
                datePreset === p ? "bg-slate-900 text-white border-slate-800" : "border-ww-border bg-ww-bg text-ww-text hover:bg-ww-rowHover"
              }`}>
              {DATE_LABEL[p]}
            </button>
          ))}
          <div className="inline-flex items-center gap-1 ml-2">
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDatePreset("custom"); }}
                   className="px-2 py-0.5 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text" title="De" />
            <span className="text-ww-textMuted text-[11px]">→</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setDatePreset("custom"); }}
                   className="px-2 py-0.5 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text" title="Até" />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap p-2 bg-ww-panel rounded-lg border border-ww-border">
          <div className="relative">
            <button onClick={() => setProjetoOpen(o => !o)}
              className={`px-2 py-1 text-[11.5px] font-semibold rounded border transition ${
                projetos.size > 0 ? "border-violet-400 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:border-violet-700 dark:text-violet-200" : "border-ww-border bg-ww-bg text-ww-text hover:bg-ww-rowHover"
              }`}>
              Projeto{projetos.size > 0 ? ` (${projetos.size})` : ""} ▾
            </button>
            {projetoOpen && (
              <div className="absolute left-0 top-[calc(100%+4px)] z-30 bg-ww-panel border border-ww-border rounded-lg shadow-lg max-h-96 overflow-y-auto min-w-[320px]">
                <div className="p-1.5 border-b border-ww-border flex items-center gap-2">
                  <button onClick={() => setProjetos(new Set())}
                          className="text-[10.5px] px-2 py-0.5 rounded hover:bg-ww-rowHover text-ww-text">Limpar</button>
                  <button onClick={() => setProjetos(new Set(projetoOptions.map(o => o.nome)))}
                          className="text-[10.5px] px-2 py-0.5 rounded hover:bg-ww-rowHover text-ww-text">Todos</button>
                  <span className="ml-auto text-[10px] text-ww-textMuted">{projetoOptions.length} projetos</span>
                </div>
                {projetoOptions.map(o => {
                  const on = projetos.has(o.nome);
                  return (
                    <button key={o.nome} onClick={() => {
                      setProjetos(prev => {
                        const next = new Set(prev);
                        next.has(o.nome) ? next.delete(o.nome) : next.add(o.nome);
                        return next;
                      });
                    }}
                    className={`w-full text-left px-2 py-1 text-[11px] flex items-center gap-2 border-b border-ww-border/50 last:border-b-0 hover:bg-ww-rowHover ${on ? "bg-violet-50 dark:bg-violet-950/30" : ""}`}>
                      <input type="checkbox" checked={on} onChange={() => {}} className="pointer-events-none" />
                      <span className="flex-1 truncate text-ww-text">{o.nome}</span>
                      <span className="text-[10px] text-ww-textMuted tabular-nums">{o.count}</span>
                      <span className="text-[10px] text-ww-textMuted tabular-nums w-24 text-right">{brlCompact(o.total)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <span className="text-[10px] uppercase text-ww-textMuted ml-2 font-semibold">Valor R$:</span>
          <input type="number" step="0.01" value={valorMin} onChange={(e) => setValorMin(e.target.value)}
                 placeholder="mín"
                 className="w-24 px-2 py-1 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text tabular-nums" />
          <span className="text-ww-textMuted text-[11px]">→</span>
          <input type="number" step="0.01" value={valorMax} onChange={(e) => setValorMax(e.target.value)}
                 placeholder="máx"
                 className="w-24 px-2 py-1 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text tabular-nums" />
          <button onClick={clearFilters}
                  className="ml-auto text-[10.5px] px-2 py-1 rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover text-ww-text">
            Limpar filtros
          </button>
        </div>

        {/* Barra bulk — só backlog, quando N selecionados */}
        {tab === "backlog" && selected.size > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700">
            <span className="text-[12px] font-semibold text-emerald-900 dark:text-emerald-100">
              {selected.size} PC(s) selecionado(s) · {brl(selectedTotal)}
            </span>
            <button onClick={() => setSelected(new Set())}
                    className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 bg-ww-panel text-emerald-800 hover:bg-emerald-100">
              Limpar sel
            </button>
            <button onClick={() => setBulkOpen(true)}
                    className="ml-auto text-[12px] font-semibold px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">
              Atribuir mesmos clientes aos {selected.size} PC(s) →
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-ww-textMuted">Carregando…</div>
      ) : listVis.length === 0 ? (
        <div className="text-center py-8 text-ww-textMuted">
          {tab === "backlog" ? "Nenhum PC pendente de atribuição. ✅" : "Nenhum PC atribuído ainda."}
        </div>
      ) : (
        <div className="bg-ww-panel rounded-lg border border-ww-border overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead className="bg-ww-bg border-b border-ww-border">
              <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                {tab === "backlog" && (
                  <th className="px-2 py-2 w-8">
                    <input type="checkbox" checked={allVisSelected} onChange={toggleAll}
                           className="accent-emerald-600 cursor-pointer" title="Selecionar todos os visíveis" />
                  </th>
                )}
                <th className="px-3 py-2">PC</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Projeto</th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2 text-right">Valor</th>
                {tab === "atribuidos" && <th className="px-3 py-2">Clientes atribuídos</th>}
                <th className="px-3 py-2 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {listVis.map((p) => {
                const selKey = `${p.empresa}|${p.pc_numero}`;
                const isSel = selected.has(selKey);
                return (
                  <tr key={`${p.empresa}-${p.pc_numero}`} className={`border-t border-ww-border transition ${isSel ? "bg-emerald-50 dark:bg-emerald-950/20" : "hover:bg-ww-rowHover"}`}>
                    {tab === "backlog" && (
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={isSel} onChange={() => toggleOne(p)}
                               className="accent-emerald-600 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-3 py-1.5 font-mono text-ww-text">#{p.pc_numero}</td>
                    <td className="px-3 py-1.5">{p.empresa}</td>
                    <td className="px-3 py-1.5 text-ww-textMuted">{p.projeto_nome ?? "—"}</td>
                    <td className="px-3 py-1.5">{fmtBR(p._dt_inclusao_d)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brl(p.valor_total)}</td>
                    {tab === "atribuidos" && (
                      <td className="px-3 py-1.5 text-[10.5px] text-ww-textMuted">
                        {p.clientes?.map(c => `#${c.codigo_cliente_omie}·${c.percentual}%`).join(" · ")}
                        {p.soma_pct != null && p.soma_pct !== 100 && (
                          <span className="ml-2 text-rose-600">⚠️ soma={p.soma_pct}%</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => setEditing(p)}
                        className="px-2 py-0.5 text-[10.5px] font-semibold rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover text-ww-text">
                        {tab === "backlog" ? "Atribuir" : "Editar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AtribuicaoModal pc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick(t => t+1); }} />
      )}
      {bulkOpen && selectedList.length > 0 && (
        <BulkAtribuicaoModal pcs={selectedList} onClose={() => setBulkOpen(false)}
          onSaved={() => { setBulkOpen(false); setSelected(new Set()); setTick(t => t+1); }} />
      )}
    </div>
  );
}

// ─── FacetCard — distribuição estilo /avulsos ─────────────────────

type FacetAccent = "violet" | "blue" | "amber" | "emerald";
const FACET_TONES: Record<FacetAccent, { border: string; bg: string; dot: string; header: string; sel: string }> = {
  violet:  { border: "border-violet-200",  bg: "bg-violet-50/40",  dot: "bg-violet-500",  header: "text-violet-900 dark:text-violet-100",  sel: "bg-violet-100 dark:bg-violet-900/40 ring-1 ring-violet-400" },
  blue:    { border: "border-blue-200",    bg: "bg-blue-50/40",    dot: "bg-blue-500",    header: "text-blue-900 dark:text-blue-100",      sel: "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400" },
  amber:   { border: "border-amber-200",   bg: "bg-amber-50/40",   dot: "bg-amber-500",   header: "text-amber-900 dark:text-amber-100",    sel: "bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400" },
  emerald: { border: "border-emerald-200", bg: "bg-emerald-50/40", dot: "bg-emerald-500", header: "text-emerald-900 dark:text-emerald-100",sel: "bg-emerald-100 dark:bg-emerald-900/40 ring-1 ring-emerald-400" },
};

function FacetCard({ title, accent, items, selected, onToggle, onClear, moreCount = 0, formatKey }: {
  title: string;
  accent: FacetAccent;
  items: Array<{ key: string; count: number; total: number; label?: string }>;
  selected: Set<string>;
  onToggle: (k: string) => void;
  onClear: () => void;
  moreCount?: number;
  formatKey?: (k: string) => string;
}) {
  const t = FACET_TONES[accent];
  const totalCount = items.reduce((a, i) => a + i.count, 0);
  const maxCount = items.reduce((a, i) => Math.max(a, i.count), 0) || 1;
  return (
    <div className={`rounded-lg border ${t.border} ${t.bg} p-2.5`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
        <span className={`text-[10px] uppercase tracking-[0.5px] font-bold ${t.header}`}>{title}</span>
        <span className="text-[10px] text-ww-textMuted tabular-nums ml-auto">{items.length}{moreCount > 0 ? `+${moreCount}` : ""}</span>
        {selected.size > 0 && (
          <button onClick={onClear} className="text-[10px] px-1 py-px rounded hover:bg-ww-panel/50 dark:hover:bg-black/20 text-ww-textMuted" title="Limpar seleção">×</button>
        )}
      </div>
      <div className="space-y-0.5 max-h-40 overflow-y-auto">
        {items.length === 0 && <div className="text-[10.5px] text-ww-textFaint italic">Vazio</div>}
        {items.map(i => {
          const on = selected.has(i.key);
          const pctBar = Math.round((i.count / maxCount) * 100);
          return (
            <button key={i.key} onClick={() => onToggle(i.key)}
              className={`w-full text-left px-1.5 py-0.5 rounded text-[10.5px] flex items-center gap-1.5 transition ${on ? t.sel : "hover:bg-ww-panel/50 dark:hover:bg-black/20"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-ww-text font-medium">{i.label ?? (formatKey ? formatKey(i.key) : i.key)}</span>
                  <span className="tabular-nums text-ww-textMuted shrink-0">{i.count}</span>
                </div>
                <div className="h-[3px] rounded bg-ww-panel/40 mt-0.5 overflow-hidden">
                  <div className={`h-full ${t.dot}`} style={{ width: `${pctBar}%`, opacity: on ? 1 : 0.5 }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {items.length > 0 && (
        <div className="mt-1.5 pt-1 border-t border-white/30 text-[9.5px] tabular-nums text-ww-textMuted flex items-center justify-between">
          <span>Σ {totalCount}</span>
          <span>{brlCompact(items.reduce((a, i) => a + i.total, 0))}</span>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: "slate"|"rose"|"emerald"|"violet"; sub?: string }) {
  const cls = {
    slate:   "border-ww-border bg-ww-panel",
    rose:    "border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 text-rose-900 dark:text-rose-100",
    emerald: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
    violet:  "border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800 text-violet-900 dark:text-violet-100",
  }[tone];
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <div className="text-[10.5px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[10.5px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Modal edit atribuição ─────────────────────────────────────────────

type Row = { codigo_cliente_omie: number; nome: string; percentual: number };

export function AtribuicaoModal({ pc, onClose, onSaved }: { pc: PcRow; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => {
    if (pc.clientes && pc.clientes.length > 0) {
      return pc.clientes.map(c => ({ codigo_cliente_omie: c.codigo_cliente_omie, nome: c.nome ?? `Omie #${c.codigo_cliente_omie}`, percentual: c.percentual }));
    }
    return [];
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OmieCli[]>([]);
  const [searching, setSearching] = useState(false);
  // Modo de entrada: percentual (default) ou valor absoluto (soma = valor_total).
  const [mode, setMode] = useState<"pct" | "valor">("pct");
  const valorTotal = Number(pc.valor_total) || 0;

  const soma = rows.reduce((a, r) => a + (Number(r.percentual) || 0), 0);
  const somaOK = Math.abs(soma - 100) < 0.01;
  // Em modo valor: valor rateado por cliente = pct * total / 100
  const somaValor = valorTotal * soma / 100;

  // Autocomplete
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults([]); return; }
      setSearching(true);
      try {
        const r = await fetch(`/api/clientes-omie?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setResults(j.items || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function addCliente(c: OmieCli) {
    if (rows.some(r => r.codigo_cliente_omie === c.codigo_cliente_omie)) return;
    const novas = [...rows, {
      codigo_cliente_omie: c.codigo_cliente_omie,
      nome: c.nome_fantasia || c.razao_social,
      percentual: 0,
    }];
    // Distribui 100/N igualmente
    const pct = Math.floor((100 / novas.length) * 100) / 100;
    const ajustadas = novas.map((r, i) => ({ ...r, percentual: i === novas.length - 1 ? 100 - pct * (novas.length - 1) : pct }));
    setRows(ajustadas);
    setQ(""); setResults([]);
  }

  function removeCliente(idx: number) {
    const novas = rows.filter((_, i) => i !== idx);
    if (novas.length === 0) { setRows([]); return; }
    const pct = Math.floor((100 / novas.length) * 100) / 100;
    setRows(novas.map((r, i) => ({ ...r, percentual: i === novas.length - 1 ? 100 - pct * (novas.length - 1) : pct })));
  }

  function updatePct(idx: number, val: number) {
    setRows(rows.map((r, i) => i === idx ? { ...r, percentual: val } : r));
  }

  function distribuirIgual() {
    const n = rows.length;
    if (n === 0) return;
    const pct = Math.floor((100 / n) * 100) / 100;
    setRows(rows.map((r, i) => ({ ...r, percentual: i === n - 1 ? 100 - pct * (n - 1) : pct })));
  }

  async function salvar() {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/pcs/atribuicao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa: pc.empresa,
          pc_numero: pc.pc_numero,
          atribuicoes: rows.map(r => ({ codigo_cliente_omie: r.codigo_cliente_omie, percentual: r.percentual })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  async function limparAtribuicao() {
    if (!confirm("Remover TODA atribuição deste PC? Ele volta pro backlog.")) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/pcs/atribuicao?empresa=${pc.empresa}&pc_numero=${pc.pc_numero}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || r.statusText); }
      onSaved();
    } catch (e) {
      alert(`Falha: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ww-panel border border-ww-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-4 space-y-3"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[14px] font-bold text-ww-text">
              PC #{pc.pc_numero} · {pc.empresa}
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Projeto: <strong>{pc.projeto_nome ?? "(sem)"}</strong> · Data: {fmtBR(pc._dt_inclusao_d)} · Valor: <strong>{brl(pc.valor_total)}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-ww-textMuted hover:text-ww-text text-lg">×</button>
        </div>

        {err && <div className="p-2 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[11px]">{err}</div>}

        {/* Lista de clientes atribuídos */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="text-[12px] font-semibold text-ww-text">Clientes atribuídos ({rows.length})</h4>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded border border-ww-border overflow-hidden text-[10.5px] font-semibold">
                <button onClick={() => setMode("pct")}
                  className={`px-2 py-0.5 ${mode==="pct" ? "bg-slate-900 text-white" : "bg-ww-bg text-ww-text hover:bg-ww-rowHover"}`}>
                  %
                </button>
                <button onClick={() => setMode("valor")}
                  className={`px-2 py-0.5 ${mode==="valor" ? "bg-slate-900 text-white" : "bg-ww-bg text-ww-text hover:bg-ww-rowHover"}`}>
                  R$
                </button>
              </div>
              {rows.length > 1 && (
                <button onClick={distribuirIgual}
                  className="text-[10.5px] px-2 py-0.5 rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover">
                  Distribuir igual (100/{rows.length})
                </button>
              )}
            </div>
          </div>
          {rows.length === 0 && <div className="text-[11.5px] text-ww-textMuted italic">Nenhum cliente atribuído. Busque abaixo pra adicionar.</div>}
          {rows.map((r, idx) => {
            const valorLinha = valorTotal * (Number(r.percentual) || 0) / 100;
            return (
              <div key={r.codigo_cliente_omie} className="flex items-center gap-2 border border-ww-border rounded p-2 bg-ww-bg">
                <div className="flex-1 text-[12px]">
                  <div className="font-medium text-ww-text">{r.nome}</div>
                  <div className="text-[10.5px] font-mono text-ww-textMuted">Omie #{r.codigo_cliente_omie}</div>
                </div>
                {mode === "pct" ? (
                  <>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0.01" max="100" step="0.01"
                        value={r.percentual}
                        onChange={(e) => updatePct(idx, Number(e.target.value))}
                        className="w-20 px-2 py-1 text-[12px] text-right rounded border border-ww-border bg-ww-panel text-ww-text tabular-nums" />
                      <span className="text-[11px] text-ww-textMuted">%</span>
                    </div>
                    <div className="w-24 text-right text-[11px] tabular-nums text-ww-textMuted">
                      {brlCompact(valorLinha)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-ww-textMuted">R$</span>
                      <input type="number" min="0.01" step="0.01"
                        value={valorLinha.toFixed(2)}
                        onChange={(e) => {
                          const novoValor = Number(e.target.value) || 0;
                          const novoPct = valorTotal > 0 ? (novoValor / valorTotal) * 100 : 0;
                          updatePct(idx, Number(novoPct.toFixed(4)));
                        }}
                        className="w-28 px-2 py-1 text-[12px] text-right rounded border border-ww-border bg-ww-panel text-ww-text tabular-nums" />
                    </div>
                    <div className="w-16 text-right text-[10.5px] tabular-nums text-ww-textMuted">
                      {(Number(r.percentual) || 0).toFixed(1)}%
                    </div>
                  </>
                )}
                <button onClick={() => removeCliente(idx)}
                  className="text-rose-600 hover:text-rose-800 text-[16px] px-1">×</button>
              </div>
            );
          })}

          {rows.length > 0 && (
            <div className={`text-[11.5px] font-semibold flex items-center justify-between p-2 rounded ${
              somaOK ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                     : "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"}`}>
              <span>
                {mode === "pct"
                  ? <>Soma: <strong className="tabular-nums">{soma.toFixed(2)}%</strong> {somaOK ? "✓ OK" : `⚠️ precisa dar 100`}</>
                  : <>Soma: <strong className="tabular-nums">{brl(somaValor)}</strong> de <strong className="tabular-nums">{brl(valorTotal)}</strong> {somaOK ? "✓ OK" : "⚠️ precisa bater o total"}</>}
              </span>
              <span className="tabular-nums text-[10.5px] opacity-80">Total PC: {brl(valorTotal)}</span>
            </div>
          )}
        </div>

        {/* Busca cliente */}
        <div className="border-t border-ww-border pt-3 space-y-2">
          <h4 className="text-[12px] font-semibold text-ww-text">Adicionar cliente</h4>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por razão / fantasia / CNPJ (ex: einstein, safewater, 2226456549…)"
            className="w-full px-2 py-1.5 text-[12px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          {q.length >= 2 && (
            <div className="max-h-48 overflow-y-auto border border-ww-border rounded bg-ww-panel">
              {searching ? (
                <div className="p-2 text-[11px] text-ww-textMuted">Buscando…</div>
              ) : results.length === 0 ? (
                <div className="p-2 text-[11px] text-ww-textMuted">Nenhum resultado</div>
              ) : (
                results.map((c) => (
                  <button key={c.codigo_cliente_omie} onClick={() => addCliente(c)}
                    disabled={rows.some(r => r.codigo_cliente_omie === c.codigo_cliente_omie)}
                    className="w-full text-left px-2 py-1.5 text-[11.5px] hover:bg-ww-rowHover border-b border-ww-border last:border-b-0 disabled:opacity-40">
                    <div className="font-medium text-ww-text">{c.razao_social}</div>
                    {c.nome_fantasia && <div className="text-[10.5px] text-ww-textMuted">{c.nome_fantasia}</div>}
                    <div className="text-[10.5px] font-mono text-ww-textMuted">Omie #{c.codigo_cliente_omie} · {c.cnpj_cpf ?? "?"}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center justify-between border-t border-ww-border pt-3">
          <button onClick={limparAtribuicao} disabled={saving || rows.length === 0}
            className="text-[11px] text-rose-600 hover:text-rose-800 disabled:opacity-40">
            Limpar atribuição
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving}
              className="px-3 py-1.5 text-[12px] rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover text-ww-text">
              Cancelar
            </button>
            <button onClick={salvar} disabled={saving || rows.length === 0 || !somaOK}
              className="px-3 py-1.5 text-[12px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
              {saving ? "Salvando…" : "Salvar atribuição"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal atribuição EM MASSA (N PCs, mesmo rateio %) ─────────────

function BulkAtribuicaoModal({ pcs, onClose, onSaved }: {
  pcs: PcRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OmieCli[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const soma = rows.reduce((a, r) => a + (Number(r.percentual) || 0), 0);
  const somaOK = Math.abs(soma - 100) < 0.01;
  const valorTotalSel = pcs.reduce((a, p) => a + (Number(p.valor_total) || 0), 0);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults([]); return; }
      setSearching(true);
      try {
        const r = await fetch(`/api/clientes-omie?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setResults(j.items || []);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function addCliente(c: OmieCli) {
    if (rows.some(r => r.codigo_cliente_omie === c.codigo_cliente_omie)) return;
    const novas = [...rows, { codigo_cliente_omie: c.codigo_cliente_omie, nome: c.nome_fantasia || c.razao_social, percentual: 0 }];
    const pct = Math.floor((100 / novas.length) * 100) / 100;
    setRows(novas.map((r, i) => ({ ...r, percentual: i === novas.length - 1 ? 100 - pct * (novas.length - 1) : pct })));
    setQ(""); setResults([]);
  }
  function removeCliente(idx: number) {
    const novas = rows.filter((_, i) => i !== idx);
    if (novas.length === 0) { setRows([]); return; }
    const pct = Math.floor((100 / novas.length) * 100) / 100;
    setRows(novas.map((r, i) => ({ ...r, percentual: i === novas.length - 1 ? 100 - pct * (novas.length - 1) : pct })));
  }
  function updatePct(idx: number, val: number) {
    setRows(rows.map((r, i) => i === idx ? { ...r, percentual: val } : r));
  }

  async function salvarBulk() {
    if (!somaOK || rows.length === 0) return;
    if (!confirm(`Aplicar mesmo rateio a ${pcs.length} PC(s)? Isso SUBSTITUI qualquer atribuição anterior de cada PC.`)) return;
    setSaving(true); setErr(null); setProgress({ done: 0, total: pcs.length, failed: 0 });
    let done = 0, failed = 0;
    for (const pc of pcs) {
      try {
        const r = await fetch("/api/pcs/atribuicao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            empresa: pc.empresa,
            pc_numero: pc.pc_numero,
            atribuicoes: rows.map(r => ({ codigo_cliente_omie: r.codigo_cliente_omie, percentual: r.percentual })),
          }),
        });
        if (!r.ok) failed++;
      } catch { failed++; }
      done++;
      setProgress({ done, total: pcs.length, failed });
    }
    setSaving(false);
    if (failed === 0) onSaved();
    else setErr(`Concluído com ${failed} falha(s) de ${pcs.length}. PCs bem-sucedidos foram salvos.`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ww-panel border-2 border-emerald-400 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-4 space-y-3"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[14px] font-bold text-ww-text">
              Atribuição em massa · {pcs.length} PC(s)
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Valor total dos PCs selecionados: <strong>{brl(valorTotalSel)}</strong>. O mesmo rateio percentual será aplicado a todos.
            </p>
          </div>
          <button onClick={onClose} className="text-ww-textMuted hover:text-ww-text text-lg">×</button>
        </div>

        {err && <div className="p-2 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[11px]">{err}</div>}

        <div className="max-h-32 overflow-y-auto border border-ww-border rounded text-[10.5px] p-2 bg-ww-bg font-mono text-ww-textMuted">
          {pcs.slice(0, 30).map(p => `#${p.pc_numero} · ${p.projeto_nome ?? "(sem)"} · ${brlCompact(p.valor_total)}`).join(" | ")}
          {pcs.length > 30 && ` | +${pcs.length - 30} mais…`}
        </div>

        <div className="space-y-2">
          <h4 className="text-[12px] font-semibold text-ww-text">Clientes a aplicar ({rows.length})</h4>
          {rows.length === 0 && <div className="text-[11.5px] text-ww-textMuted italic">Busque abaixo pra adicionar cliente(s).</div>}
          {rows.map((r, idx) => (
            <div key={r.codigo_cliente_omie} className="flex items-center gap-2 border border-ww-border rounded p-2 bg-ww-bg">
              <div className="flex-1 text-[12px]">
                <div className="font-medium text-ww-text">{r.nome}</div>
                <div className="text-[10.5px] font-mono text-ww-textMuted">Omie #{r.codigo_cliente_omie}</div>
              </div>
              <div className="flex items-center gap-1">
                <input type="number" min="0.01" max="100" step="0.01"
                  value={r.percentual}
                  onChange={(e) => updatePct(idx, Number(e.target.value))}
                  className="w-20 px-2 py-1 text-[12px] text-right rounded border border-ww-border bg-ww-panel text-ww-text tabular-nums" />
                <span className="text-[11px] text-ww-textMuted">%</span>
              </div>
              <button onClick={() => removeCliente(idx)} className="text-rose-600 hover:text-rose-800 text-[16px] px-1">×</button>
            </div>
          ))}
          {rows.length > 0 && (
            <div className={`text-[11.5px] font-semibold flex items-center justify-between p-2 rounded ${
              somaOK ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                     : "bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"}`}>
              <span>Soma: <strong className="tabular-nums">{soma.toFixed(2)}%</strong> {somaOK ? "✓ OK" : "⚠️ precisa dar 100"}</span>
            </div>
          )}
        </div>

        <div className="border-t border-ww-border pt-3 space-y-2">
          <h4 className="text-[12px] font-semibold text-ww-text">Adicionar cliente</h4>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por razão / fantasia / CNPJ…"
            className="w-full px-2 py-1.5 text-[12px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          {q.length >= 2 && (
            <div className="max-h-48 overflow-y-auto border border-ww-border rounded bg-ww-panel">
              {searching ? <div className="p-2 text-[11px] text-ww-textMuted">Buscando…</div>
                : results.length === 0 ? <div className="p-2 text-[11px] text-ww-textMuted">Nenhum resultado</div>
                : results.map((c) => (
                    <button key={c.codigo_cliente_omie} onClick={() => addCliente(c)}
                      disabled={rows.some(r => r.codigo_cliente_omie === c.codigo_cliente_omie)}
                      className="w-full text-left px-2 py-1.5 text-[11.5px] hover:bg-ww-rowHover border-b border-ww-border last:border-b-0 disabled:opacity-40">
                      <div className="font-medium text-ww-text">{c.razao_social}</div>
                      {c.nome_fantasia && <div className="text-[10.5px] text-ww-textMuted">{c.nome_fantasia}</div>}
                      <div className="text-[10.5px] font-mono text-ww-textMuted">Omie #{c.codigo_cliente_omie} · {c.cnpj_cpf ?? "?"}</div>
                    </button>
                ))}
            </div>
          )}
        </div>

        {progress && (
          <div className="p-2 border border-emerald-200 bg-emerald-50 rounded text-[11.5px] text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-100">
            Processando: <strong>{progress.done}/{progress.total}</strong> {progress.failed > 0 && <span className="text-rose-700 dark:text-rose-300 font-semibold ml-2">({progress.failed} falha{progress.failed > 1 ? "s" : ""})</span>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ww-border pt-3">
          <button onClick={onClose} disabled={saving}
            className="px-3 py-1.5 text-[12px] rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover text-ww-text">
            Cancelar
          </button>
          <button onClick={salvarBulk} disabled={saving || rows.length === 0 || !somaOK}
            className="px-3 py-1.5 text-[12px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            {saving ? `Aplicando ${progress?.done ?? 0}/${pcs.length}…` : `Aplicar a ${pcs.length} PC(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
