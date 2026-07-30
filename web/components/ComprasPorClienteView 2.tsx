"use client";

// ComprasPorClienteView — Rentabilidade por cliente, layout light estilo Fourmidia.
// Filtros com poucas opções = pills. Filtros grandes = dropdown suspenso.
// Global = 1ª opção do filtro Tipo. Sem toggle separado.

import { useEffect, useMemo, useState } from "react";

type Linha = {
  codigo_cliente: number | null;
  cliente_nome: string;
  codigo_projeto: string | null;
  projeto_nome: string | null;
  tipo_venda: string;
  periodo_mes: string;
  faturamento: number;
  total_compras: number;
  despesas: number;
  custo_mao_obra: number;
  n_tec_sem_mao_obra: number;
  n_tecnicos: number;
  qtd_pcs: number;
};
type Fornecedor = { tipo_venda: string; nome: string; valor: number; qtd: number };
type Resp = {
  periodo: { from: string; to: string };
  linhas: Linha[];
  top_fornecedores: Fornecedor[];
  totais: {
    faturamento: number; total_compras: number; despesas: number;
    custo_mao_obra: number; custo_total: number; margem_bruta: number;
    linhas: number; n_tec_sem_mao_obra: number;
  };
};

type DetalheAlvo = {
  cliente: number; cliente_nome: string;
  tipo?: string | null; from: string; to: string;
  metric: "compras" | "receita";
};

type Bucket = "Contratuais" | "Projetos" | "Avulsos";
const BUCKETS: Bucket[] = ["Contratuais", "Projetos", "Avulsos"];

function bucketOf(t: string): Bucket {
  if (t === "Contratuais" || t === "Contrato de Manutenção") return "Contratuais";
  if (t === "Projetos" || t === "Projeto") return "Projetos";
  return "Avulsos";
}

type TipoFilter = "global" | Bucket;
const TIPO_PILLS: { v: TipoFilter; l: string; color: string }[] = [
  { v: "global",      l: "Global",       color: "bg-slate-900 text-white ring-slate-900" },
  { v: "Contratuais", l: "Contratuais",  color: "bg-emerald-500 text-white ring-emerald-500" },
  { v: "Projetos",    l: "Projetos",     color: "bg-violet-500 text-white ring-violet-500" },
  { v: "Avulsos",     l: "Avulsos",      color: "bg-amber-500 text-white ring-amber-500" },
];

type MargemFaixa = "todas" | "excelente" | "boa" | "baixa" | "negativa";
const MARGEM_PILLS: { v: MargemFaixa; l: string; dot: string }[] = [
  { v: "todas",     l: "Todas",         dot: "bg-slate-400" },
  { v: "excelente", l: "≥30%",          dot: "bg-emerald-500" },
  { v: "boa",       l: "10 – 30%",      dot: "bg-amber-500" },
  { v: "baixa",     l: "0 – 10%",       dot: "bg-orange-500" },
  { v: "negativa",  l: "< 0%",          dot: "bg-rose-500" },
];
function faixaOf(pct: number | null): MargemFaixa {
  if (pct == null) return "todas";
  if (pct >= 30) return "excelente";
  if (pct >= 10) return "boa";
  if (pct >= 0)  return "baixa";
  return "negativa";
}
function margemColor(pct: number | null): string {
  if (pct == null) return "text-slate-500";
  if (pct >= 30) return "text-emerald-700 dark:text-emerald-300";
  if (pct >= 10) return "text-amber-700 dark:text-amber-300";
  if (pct >= 0)  return "text-orange-700 dark:text-orange-300";
  return "text-rose-700 dark:text-rose-300";
}

const PERIODOS = [
  { v: "mes",   l: "Mês" },   { v: "mes-1", l: "Mês -1" },
  { v: "3m",    l: "3m" },    { v: "6m",    l: "6m" },
  { v: "12m",   l: "12m" },   { v: "ytd",   l: "YTD" },
  { v: "ano-1", l: "Ano -1" },
] as const;

// Formato R$123,45 (sem espaço). Negativo vira −R$123,45.
const brl = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}R$${abs}`;
};
const brlCompact = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}R$${(abs / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000)     return `${sign}R$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R$${abs.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function firstDayMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayMonth(d: Date)  { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addMonths(d: Date, delta: number) { return new Date(d.getFullYear(), d.getMonth()+delta, 1); }
function rangeFromPreset(preset: string): { from: string; to: string } {
  const t = new Date();
  if (preset === "mes")   return { from: ymd(firstDayMonth(t)), to: ymd(lastDayMonth(t)) };
  if (preset === "mes-1") { const d = addMonths(t,-1); return { from: ymd(firstDayMonth(d)), to: ymd(lastDayMonth(d)) }; }
  if (preset === "3m")    return { from: ymd(firstDayMonth(addMonths(t,-2))),  to: ymd(lastDayMonth(t)) };
  if (preset === "6m")    return { from: ymd(firstDayMonth(addMonths(t,-5))),  to: ymd(lastDayMonth(t)) };
  if (preset === "12m")   return { from: ymd(firstDayMonth(addMonths(t,-11))), to: ymd(lastDayMonth(t)) };
  if (preset === "ytd")   return { from: `${t.getFullYear()}-01-01`, to: ymd(t) };
  if (preset === "ano-1") { const y = t.getFullYear()-1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  return { from: ymd(firstDayMonth(t)), to: ymd(lastDayMonth(t)) };
}

function appWwLink(from: string, to: string): string {
  return `https://app.waterworks.com.br/relatorios/custo-por-cliente?from=${from}&to=${to}`;
}

export default function ComprasPorClienteView() {
  const initial = rangeFromPreset("3m");
  const [from, setFrom] = useState(initial.from);
  const [to,   setTo]   = useState(initial.to);
  const [periodoPreset, setPeriodoPreset] = useState<string>("3m");
  const [tipoFilter,       setTipoFilter]       = useState<TipoFilter>("global");
  const [margemFilter,     setMargemFilter]     = useState<MargemFaixa>("todas");
  const [clienteFilter,    setClienteFilter]    = useState<string>("");
  const [fornecedorFilter, setFornecedorFilter] = useState<string>("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheAlvo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = await fetch(`/api/relatorios/compras-por-cliente?from=${from}&to=${to}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setErr(j.error ?? r.statusText); setData(null); return; }
        setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  function applyPreset(preset: string) {
    setPeriodoPreset(preset);
    const r = rangeFromPreset(preset);
    setFrom(r.from); setTo(r.to);
  }

  // Dropdown de clientes/fornecedores — ordenados por receita/valor
  const clientesOpts = useMemo(() => {
    if (!data) return [] as { key: string; label: string }[];
    const m = new Map<string, { codigo: number | null; nome: string; receita: number }>();
    for (const l of data.linhas) {
      const k = String(l.codigo_cliente ?? l.cliente_nome);
      const cur = m.get(k) ?? { codigo: l.codigo_cliente, nome: l.cliente_nome, receita: 0 };
      cur.receita += l.faturamento;
      m.set(k, cur);
    }
    return Array.from(m.values())
      .sort((a, b) => b.receita - a.receita)
      .map(c => ({ key: String(c.codigo ?? c.nome), label: `${c.nome} · ${brlCompact(c.receita)}` }));
  }, [data]);
  const fornecedoresOpts = useMemo(
    () => (data?.top_fornecedores ?? []).map(f => ({ key: f.nome, label: `${f.nome} · ${brlCompact(f.valor)}` })),
  [data]);

  // Agrupa por cliente × bucket
  const rows = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, {
      codigo_cliente: number | null; cliente_nome: string; bucket: Bucket;
      receita: number; compras: number; despesas: number; mao_obra: number; n_tec_sem_mao_obra: number;
    }>();
    for (const l of data.linhas) {
      const b = bucketOf(l.tipo_venda);
      const k = `${l.codigo_cliente ?? l.cliente_nome}::${b}`;
      const cur = m.get(k) ?? {
        codigo_cliente: l.codigo_cliente, cliente_nome: l.cliente_nome, bucket: b,
        receita: 0, compras: 0, despesas: 0, mao_obra: 0, n_tec_sem_mao_obra: 0,
      };
      cur.receita  += l.faturamento;
      cur.compras  += l.total_compras;
      cur.despesas += l.despesas;
      cur.mao_obra += l.custo_mao_obra;
      cur.n_tec_sem_mao_obra += l.n_tec_sem_mao_obra;
      m.set(k, cur);
    }
    return Array.from(m.values()).map(r => {
      const custo = r.compras + r.despesas + r.mao_obra;
      const margem = r.receita - custo;
      const pct = r.receita > 0 ? (margem / r.receita) * 100 : null;
      return { ...r, custo, margem, pct };
    });
  }, [data]);

  // Se modo Global, agrupa por cliente (sem separar tipos)
  const rowsExibidas = useMemo(() => {
    if (tipoFilter === "global") {
      const m = new Map<string, {
        codigo_cliente: number | null; cliente_nome: string; bucket: "Global";
        receita: number; compras: number; despesas: number; mao_obra: number; n_tec_sem_mao_obra: number;
      }>();
      for (const r of rows) {
        const k = String(r.codigo_cliente ?? r.cliente_nome);
        const cur = m.get(k) ?? {
          codigo_cliente: r.codigo_cliente, cliente_nome: r.cliente_nome, bucket: "Global" as const,
          receita: 0, compras: 0, despesas: 0, mao_obra: 0, n_tec_sem_mao_obra: 0,
        };
        cur.receita += r.receita; cur.compras += r.compras; cur.despesas += r.despesas;
        cur.mao_obra += r.mao_obra; cur.n_tec_sem_mao_obra += r.n_tec_sem_mao_obra;
        m.set(k, cur);
      }
      return Array.from(m.values()).map(r => {
        const custo = r.compras + r.despesas + r.mao_obra;
        const margem = r.receita - custo;
        const pct = r.receita > 0 ? (margem / r.receita) * 100 : null;
        return { ...r, custo, margem, pct };
      });
    }
    return rows.filter(r => r.bucket === tipoFilter);
  }, [rows, tipoFilter]);

  const rowsFiltradas = useMemo(() => rowsExibidas.filter(r => {
    if (margemFilter !== "todas" && faixaOf(r.pct) !== margemFilter) return false;
    if (clienteFilter && String(r.codigo_cliente ?? r.cliente_nome) !== clienteFilter) return false;
    if (fornecedorFilter && data) {
      // Cliente precisa ter PC desse fornecedor no bucket (ou em qualquer se global)
      const bucketAlvo = r.bucket === "Global" ? null : (r.bucket as Bucket);
      const tem = data.linhas.some(l =>
        String(l.codigo_cliente ?? l.cliente_nome) === String(r.codigo_cliente ?? r.cliente_nome)
        && l.total_compras > 0
        && (!bucketAlvo || bucketOf(l.tipo_venda) === bucketAlvo)
      );
      if (!tem) return false;
    }
    return true;
  }).sort((a, b) => b.receita - a.receita), [rowsExibidas, margemFilter, clienteFilter, fornecedorFilter, data]);

  const tot = useMemo(() => {
    let receita = 0, compras = 0, despesas = 0, mao = 0, semMao = 0;
    const clientes = new Set<string>();
    for (const r of rowsFiltradas) {
      receita += r.receita; compras += r.compras; despesas += r.despesas; mao += r.mao_obra;
      semMao += r.n_tec_sem_mao_obra;
      clientes.add(String(r.codigo_cliente ?? r.cliente_nome));
    }
    const custo = compras + despesas + mao;
    return { receita, compras, despesas, mao, custo, margem: receita - custo, semMao, nClientes: clientes.size };
  }, [rowsFiltradas]);
  const totMargemPct = tot.receita > 0 ? (tot.margem / tot.receita) * 100 : null;

  return (
    <div className="space-y-4">
      {/* ══════════════════════════════════════════════════════════
          FILTROS (light, estilo Fourmidia)
          ══════════════════════════════════════════════════════════ */}
      <div className="rounded-xl bg-ww-panel border border-ww-border p-4 space-y-3">
        <PillGroup label="Tipo de venda" value={tipoFilter} onChange={v => setTipoFilter(v as TipoFilter)}
          options={TIPO_PILLS.map(p => ({ v: p.v, l: p.l, activeColor: p.color }))} />

        <PillGroup label="Margem" value={margemFilter} onChange={v => setMargemFilter(v as MargemFaixa)}
          options={MARGEM_PILLS.map(p => ({ v: p.v, l: p.l, dot: p.dot }))} />

        <PillGroup label="Período" value={periodoPreset} onChange={applyPreset}
          options={PERIODOS.map(p => ({ v: p.v, l: p.l }))}
          suffix={
            <>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPeriodoPreset(""); }}
                     className="px-2 py-1 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text" />
              <span className="text-[10px] text-ww-textMuted">até</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPeriodoPreset(""); }}
                     className="px-2 py-1 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text" />
            </>
          } />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-ww-border/60">
          <ComboboxFilter label="Cliente" value={clienteFilter} onChange={setClienteFilter}
            options={clientesOpts} totalCount={clientesOpts.length}
            placeholder="Digite nome do cliente…" />
          <ComboboxFilter label="Fornecedor" value={fornecedorFilter} onChange={setFornecedorFilter}
            options={fornecedoresOpts} totalCount={fornecedoresOpts.length}
            placeholder="Digite nome do fornecedor…" />
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] text-ww-textMuted">
          <span>
            {loading ? "Carregando…" : data ? `${rowsFiltradas.length} de ${rowsExibidas.length} linha(s) · ${tot.nClientes} cliente(s)` : "—"}
          </span>
          {(clienteFilter || fornecedorFilter || margemFilter !== "todas" || tipoFilter !== "global") && (
            <button onClick={() => { setTipoFilter("global"); setMargemFilter("todas"); setClienteFilter(""); setFornecedorFilter(""); }}
              className="text-rose-600 hover:text-rose-800 font-semibold">Limpar filtros</button>
          )}
        </div>
      </div>

      {err && <div data-testid="dre-error" className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[12px]">{err}</div>}

      {/* ══════════════════════════════════════════════════════════
          KPIs (3 cards leves)
          ══════════════════════════════════════════════════════════ */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi tone="emerald" label="Receita" main={brl(tot.receita)}
               sub={`${tot.nClientes} cliente${tot.nClientes !== 1 ? "s" : ""}`} />
          <div className="rounded-xl border border-ww-border bg-ww-panel p-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.5px] font-semibold text-rose-700 dark:text-rose-300">Saídas</span>
              <span className="text-[20px] font-bold tabular-nums text-rose-800 dark:text-rose-200">−{brl(tot.custo)}</span>
            </div>
            {tot.custo > 0 && (
              <div className="h-1 rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-700">
                <div className="bg-amber-500"  style={{ width: `${(tot.compras / tot.custo) * 100}%` }} />
                <div className="bg-rose-500"   style={{ width: `${(tot.despesas / tot.custo) * 100}%` }} />
                <div className="bg-violet-500" style={{ width: `${(tot.mao / tot.custo) * 100}%` }} />
              </div>
            )}
            <div className="grid grid-cols-3 gap-1 text-[10.5px] text-ww-textMuted">
              <div><span className="inline-block w-1.5 h-1.5 rounded-sm bg-amber-500 mr-1"></span>Compras <span className="tabular-nums text-ww-text font-semibold">{brlCompact(tot.compras)}</span></div>
              <div><span className="inline-block w-1.5 h-1.5 rounded-sm bg-rose-500 mr-1"></span>Despesas <span className="tabular-nums text-ww-text font-semibold">{brlCompact(tot.despesas)}</span></div>
              <div><span className="inline-block w-1.5 h-1.5 rounded-sm bg-violet-500 mr-1"></span>Mão obra <span className="tabular-nums text-ww-text font-semibold">{brlCompact(tot.mao)}</span></div>
            </div>
            <a href={appWwLink(from, to)} target="_blank" rel="noopener"
               className="inline-flex items-center gap-1 mt-1 px-2 py-1 rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-[10.5px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/50 self-start"
               title="Despesas e mão de obra vêm do app.waterworks. Clique pra conferir na fonte.">
              🔗 Conferir despesas/MO no app.waterworks →
            </a>
          </div>
          <Kpi tone={tot.margem >= 0 ? "emerald" : "rose"} label="Margem bruta"
               main={`${tot.margem >= 0 ? "+" : ""}${brl(tot.margem)}`}
               sub={totMargemPct != null ? `${totMargemPct >= 0 ? "+" : ""}${totMargemPct.toFixed(1)}% margem` : "—"}
               subClass={margemColor(totMargemPct)} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TABELA (única, respondendo a todos os filtros)
          ══════════════════════════════════════════════════════════ */}
      {data && (
        <div className="bg-ww-panel border border-ww-border rounded-xl overflow-x-auto">
          <table className="w-full text-[12px] min-w-[900px]">
            <thead className="border-b border-ww-border">
              <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                <th className="px-4 py-2.5">Cliente</th>
                {tipoFilter === "global" && <th className="px-3 py-2.5 w-[100px]"></th>}
                {tipoFilter !== "global" && <th className="px-3 py-2.5 w-[110px]">Tipo</th>}
                <th className="px-3 py-2.5 w-[90px]">Omie</th>
                <th className="px-3 py-2.5 text-right w-[110px]">Receita</th>
                <th className="px-3 py-2.5 text-right w-[110px]">Compras</th>
                <th className="px-3 py-2.5 text-right w-[110px]">
                  <a href={appWwLink(from, to)} target="_blank" rel="noopener"
                     className="inline-flex items-center gap-1 hover:text-sky-700 dark:hover:text-sky-300"
                     title="Vem do app.waterworks — clique pra conferir">
                    Despesas <span className="text-[9px]">🔗</span>
                  </a>
                </th>
                <th className="px-3 py-2.5 text-right w-[110px]">
                  <a href={appWwLink(from, to)} target="_blank" rel="noopener"
                     className="inline-flex items-center gap-1 hover:text-sky-700 dark:hover:text-sky-300"
                     title="Vem do app.waterworks — clique pra conferir">
                    Mão obra <span className="text-[9px]">🔗</span>
                  </a>
                </th>
                <th className="px-3 py-2.5 text-right w-[110px]">Margem</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.length === 0 && (
                <tr><td colSpan={tipoFilter === "global" ? 8 : 8} className="text-center py-10 text-ww-textFaint text-[12px]">
                  Nenhum cliente com esses filtros.
                </td></tr>
              )}
              {rowsFiltradas.map((r, i) => (
                <tr key={i} className="border-t border-ww-border/60 hover:bg-ww-rowHover">
                  <td className="px-4 py-2 font-medium text-ww-text truncate max-w-[300px]" title={r.cliente_nome}>
                    {r.cliente_nome}
                    {r.n_tec_sem_mao_obra > 0 && (
                      <span className="ml-2 text-[9px] px-1 py-px rounded bg-violet-100 text-violet-800" title={`${r.n_tec_sem_mao_obra} tec s/ valor_hora`}>⚠️{r.n_tec_sem_mao_obra}</span>
                    )}
                  </td>
                  {tipoFilter === "global" && <td className="px-3 py-2"></td>}
                  {tipoFilter !== "global" && (
                    <td className="px-3 py-2">
                      <TipoBadge bucket={r.bucket as Bucket} />
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-ww-textMuted text-[10px]">
                    {r.codigo_cliente && r.codigo_cliente > 0 ? `#${r.codigo_cliente}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ww-text">
                    {r.receita > 0 ? (
                      <button onClick={() => setDetalhe({ cliente: r.codigo_cliente ?? 0, cliente_nome: r.cliente_nome, from, to, metric: "receita" })}
                        className="hover:underline decoration-dotted">{brlCompact(r.receita)}</button>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ww-text">
                    {r.compras > 0 ? (
                      <button onClick={() => setDetalhe({ cliente: r.codigo_cliente ?? 0, cliente_nome: r.cliente_nome, from, to, metric: "compras" })}
                        className="hover:underline decoration-dotted">{brlCompact(r.compras)}</button>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ww-textMuted">{r.despesas > 0 ? brlCompact(r.despesas) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ww-textMuted">{r.mao_obra > 0 ? brlCompact(r.mao_obra) : "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${margemColor(r.pct)}`}>
                    <div>{brlCompact(r.margem)}</div>
                    {r.pct != null && <div className="text-[10px] opacity-70">{r.pct.toFixed(1)}%</div>}
                  </td>
                </tr>
              ))}
            </tbody>
            {rowsFiltradas.length > 0 && (
              <tfoot>
                <tr className="border-t border-ww-borderStrong bg-ww-bg text-[12px] font-semibold">
                  <td className="px-4 py-2.5" colSpan={tipoFilter === "global" ? 3 : 3}>
                    Total · {rowsFiltradas.length} {tipoFilter === "global" ? "cliente(s)" : "linha(s)"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ww-text">{brlCompact(tot.receita)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ww-text">{brlCompact(tot.compras)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ww-text">{brlCompact(tot.despesas)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ww-text">{brlCompact(tot.mao)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${margemColor(totMargemPct)}`}>
                    <div>{brlCompact(tot.margem)}</div>
                    {totMargemPct != null && <div className="text-[10px] opacity-70">{totMargemPct.toFixed(1)}%</div>}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {detalhe && <DetalheModal alvo={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// Componentes de filtro
// ══════════════════════════════════════════════════════════════════

type PillOption = { v: string; l: string; activeColor?: string; dot?: string };

function PillGroup({ label, value, onChange, options, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  options: PillOption[]; suffix?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[9.5px] uppercase tracking-[0.6px] font-semibold text-ww-textMuted min-w-[80px]">{label}</span>
      <div className="flex gap-1 flex-wrap">
        {options.map(o => {
          const active = o.v === value;
          const activeCls = o.activeColor ?? "bg-slate-900 text-white ring-slate-900";
          return (
            <button key={o.v} onClick={() => onChange(o.v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-medium transition ${
                active
                  ? `${activeCls} ring-1`
                  : "bg-ww-bg text-ww-text border border-ww-border hover:bg-ww-rowHover"
              }`}>
              {o.dot && <span className={`inline-block w-1.5 h-1.5 rounded-full ${o.dot}`}></span>}
              {o.l}
            </button>
          );
        })}
      </div>
      {suffix && <div className="flex items-center gap-1.5 ml-auto">{suffix}</div>}
    </div>
  );
}

// Combobox searchable — input de texto + sugestões via <datalist> (nativo do browser).
// value é a KEY (id), mas mostramos e digitamos o LABEL. Um Map interno resolve.
function ComboboxFilter({ label, value, onChange, options, totalCount, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[]; totalCount: number; placeholder?: string;
}) {
  const listId = useMemo(() => `combo-${label.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`, [label]);
  const labelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.key, o.label);
    return m;
  }, [options]);
  const keyByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.label, o.key);
    return m;
  }, [options]);
  const [text, setText] = useState<string>(value ? (labelByKey.get(value) ?? "") : "");
  useEffect(() => { setText(value ? (labelByKey.get(value) ?? "") : ""); }, [value, labelByKey]);

  function handleChange(v: string) {
    setText(v);
    if (v === "") { onChange(""); return; }
    const k = keyByLabel.get(v);
    if (k) onChange(k);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-[9.5px] uppercase tracking-[0.6px] font-semibold text-ww-textMuted min-w-[70px]">{label}</span>
      <div className="flex-1 flex items-center gap-1">
        <input list={listId} value={text} onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder ?? `Todos (${totalCount})`}
          className="flex-1 px-2 py-1.5 text-[12px] rounded border border-ww-border bg-ww-bg text-ww-text" />
        {value && (
          <button type="button" onClick={() => { setText(""); onChange(""); }}
            className="text-[16px] text-ww-textMuted hover:text-rose-600 px-1 leading-none" title="Limpar">×</button>
        )}
        <datalist id={listId}>
          {options.map(o => <option key={o.key} value={o.label} />)}
        </datalist>
      </div>
    </label>
  );
}

function TipoBadge({ bucket }: { bucket: Bucket }) {
  const style: Record<Bucket, string> = {
    Contratuais: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    Projetos:    "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
    Avulsos:     "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  };
  return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${style[bucket]}`}>{bucket}</span>;
}

function Kpi({ tone, label, main, sub, subClass }: {
  tone: "emerald" | "rose" | "slate"; label: string; main: string; sub?: string; subClass?: string;
}) {
  const map = {
    emerald: { border: "border-emerald-200 dark:border-emerald-800", bg: "bg-emerald-50/70 dark:bg-emerald-950/30", labelC: "text-emerald-700 dark:text-emerald-300", mainC: "text-emerald-900 dark:text-emerald-50" },
    rose:    { border: "border-rose-200 dark:border-rose-800",       bg: "bg-rose-50/70 dark:bg-rose-950/30",       labelC: "text-rose-700 dark:text-rose-300",       mainC: "text-rose-900 dark:text-rose-50" },
    slate:   { border: "border-slate-200 dark:border-slate-700",     bg: "bg-slate-50/70 dark:bg-slate-900/30",     labelC: "text-slate-700 dark:text-slate-300",     mainC: "text-slate-900 dark:text-slate-50" },
  }[tone];
  return (
    <div className={`rounded-xl border ${map.border} ${map.bg} p-4`}>
      <div className={`text-[10px] uppercase tracking-[0.5px] font-semibold ${map.labelC}`}>{label}</div>
      <div className={`text-[24px] font-bold tabular-nums mt-1 ${map.mainC}`}>{main}</div>
      {sub && <div className={`text-[11.5px] font-medium mt-0.5 ${subClass ?? map.labelC}`}>{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// DetalheModal
// ══════════════════════════════════════════════════════════════════

type LinhaCompra = {
  empresa: string; pc_numero: string; nome_fornecedor: string | null; contato_fornecedor: string | null;
  projeto_nome: string | null; valor_total: string | number;
  aprovado_em: string | null; _dt_inclusao_d: string | null;
  origem: string; pct: number; valor_rateado: number;
};
type LinhaReceita = {
  empresa: string; codigo_projeto: string | number | null; projeto_nome: string | null;
  codigo_categoria: string | null; dt_fat_d: string;
  valor_total: string | number; numero_nfse: string | null; numero_pedido: string | null; numero_contrato: string | null;
};

function DetalheModal({ alvo, onClose }: { alvo: DetalheAlvo; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ linhas: (LinhaCompra | LinhaReceita)[]; total: number; qtd: number } | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const params = new URLSearchParams({
          cliente: String(alvo.cliente), metric: alvo.metric,
          from: alvo.from, to: alvo.to,
        });
        if (alvo.tipo) params.set("tipo", alvo.tipo);
        const r = await fetch(`/api/relatorios/compras-por-cliente/detalhe?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setErr(j.error ?? r.statusText); return; }
        setPayload(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [alvo]);

  const linhas = payload?.linhas ?? [];
  const linhasFiltradas = q ? linhas.filter(l => JSON.stringify(l).toLowerCase().includes(q.toLowerCase())) : linhas;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ww-panel border border-ww-border rounded-lg max-w-[95vw] w-full max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-ww-border flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-bold text-ww-text">
              🔍 Memorial · {alvo.metric === "compras" ? "PCs aprovados" : "NFs faturadas"}
              {alvo.tipo ? <span className="ml-2 text-[11px] font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{alvo.tipo}</span> : null}
            </h3>
            <div className="text-[11.5px] text-ww-textMuted mt-0.5">
              Cliente: <strong>{alvo.cliente_nome}</strong>
              {alvo.cliente > 0 && <span className="ml-2 font-mono opacity-70">#{alvo.cliente}</span>}
              <span className="ml-3">Período: {alvo.from} → {alvo.to}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-ww-textMuted hover:text-ww-text text-2xl leading-none px-2">×</button>
        </div>

        <div className="px-4 py-2 border-b border-ww-border bg-ww-bg flex items-center gap-2 flex-wrap">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar (fornecedor, PC#, projeto, NF#…)"
            className="flex-1 min-w-[200px] px-2 py-1 text-[12px] rounded border border-ww-border bg-ww-panel text-ww-text" />
          {payload && (
            <div className="text-[11.5px] text-ww-textMuted tabular-nums">
              {linhasFiltradas.length} de {payload.qtd} linha(s) · Σ {brl(payload.total)}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-ww-textMuted">Carregando…</div>
          ) : err ? (
            <div className="p-4 text-rose-700 bg-rose-50 border border-rose-200 m-3 rounded">{err}</div>
          ) : linhasFiltradas.length === 0 ? (
            <div className="p-8 text-center text-ww-textMuted">Nenhuma linha.</div>
          ) : alvo.metric === "compras" ? (
            <table className="w-full text-[11.5px]">
              <thead className="bg-ww-bg border-b border-ww-border sticky top-0">
                <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                  <th className="px-3 py-2">Empresa</th><th className="px-3 py-2">PC #</th>
                  <th className="px-3 py-2">Fornecedor</th><th className="px-3 py-2">Projeto</th>
                  <th className="px-3 py-2">Aprovado</th><th className="px-3 py-2 text-right">Valor PC</th>
                  <th className="px-3 py-2 text-right">Rateio %</th><th className="px-3 py-2 text-right">Rateado</th>
                  <th className="px-3 py-2">Origem</th>
                </tr>
              </thead>
              <tbody>
                {(linhasFiltradas as LinhaCompra[]).map((r, i) => (
                  <tr key={i} className="border-t border-ww-border hover:bg-ww-rowHover">
                    <td className="px-3 py-1.5">{r.empresa}</td>
                    <td className="px-3 py-1.5 font-mono">#{r.pc_numero}</td>
                    <td className="px-3 py-1.5 truncate max-w-[220px]" title={r.nome_fornecedor ?? ""}>{r.nome_fornecedor ?? r.contato_fornecedor ?? "—"}</td>
                    <td className="px-3 py-1.5 text-ww-textMuted">{r.projeto_nome ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{r.aprovado_em ? r.aprovado_em.slice(0, 10) : (r._dt_inclusao_d ?? "—")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{brl(Number(r.valor_total))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(r.pct).toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brl(r.valor_rateado)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`text-[9.5px] px-1.5 py-0.5 rounded uppercase font-semibold ${
                        r.origem === "pv_origem"   ? "bg-emerald-100 text-emerald-800" :
                        r.origem === "manual"      ? "bg-violet-100 text-violet-800" :
                        r.origem === "projeto_map" ? "bg-sky-100 text-sky-800" :
                                                     "bg-amber-100 text-amber-800"
                      }`}>{r.origem}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-[11.5px]">
              <thead className="bg-ww-bg border-b border-ww-border sticky top-0">
                <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                  <th className="px-3 py-2">Empresa</th><th className="px-3 py-2">NF#</th>
                  <th className="px-3 py-2">Pedido</th><th className="px-3 py-2">Contrato</th>
                  <th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Cat</th>
                  <th className="px-3 py-2">Data</th><th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(linhasFiltradas as LinhaReceita[]).map((r, i) => (
                  <tr key={i} className="border-t border-ww-border hover:bg-ww-rowHover">
                    <td className="px-3 py-1.5">{r.empresa}</td>
                    <td className="px-3 py-1.5 font-mono">{r.numero_nfse ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-ww-textMuted">{r.numero_pedido ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-ww-textMuted">{r.numero_contrato ?? "—"}</td>
                    <td className="px-3 py-1.5 text-ww-textMuted truncate max-w-[220px]" title={r.projeto_nome ?? ""}>{r.projeto_nome ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">{r.codigo_categoria ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{r.dt_fat_d}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brl(Number(r.valor_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
