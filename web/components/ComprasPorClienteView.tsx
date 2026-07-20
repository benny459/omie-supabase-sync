"use client";

// ComprasPorClienteView — prévia painel-side da contribuição pra rentabilidade.
// Colunas por tipo_venda, quick-select de datas relativas, rodapé com totais.

import { useEffect, useMemo, useState } from "react";

type Linha = {
  codigo_cliente: number | null;
  cliente_nome: string;
  codigo_projeto: string | null;
  tipo_venda: string;
  periodo_mes: string;
  faturamento: number;
  total_compras: number;
};

type Resp = {
  periodo: { from: string; to: string };
  linhas: Linha[];
  totais: { faturamento: number; total_compras: number; linhas: number };
};

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v || 0);
const brlCompact = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function firstDayMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayMonth(d: Date)  { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function addMonths(d: Date, delta: number) { return new Date(d.getFullYear(), d.getMonth()+delta, 1); }

// Buckets FIXOS pra colunas — bate com o padrão da prévia do WW-app
const TIPO_BUCKETS = ["Contratuais", "Projetos", "Avulsos", "Revenda", "BOT/SW", "Outras"] as const;
type Bucket = typeof TIPO_BUCKETS[number];

function bucketOf(t: string): Bucket {
  if (t === "Contratuais" || t === "Contrato de Manutenção") return "Contratuais";
  if (t === "Projetos" || t === "Projeto") return "Projetos";
  if (t === "Avulsos" || t === "Clientes Avulsos") return "Avulsos";
  if (t === "Revenda") return "Revenda";
  if (t === "BOT/SW") return "BOT/SW";
  return "Outras";
}

const BUCKET_BG: Record<Bucket, string> = {
  "Contratuais": "bg-emerald-50 dark:bg-emerald-950/20",
  "Projetos":    "bg-violet-50 dark:bg-violet-950/20",
  "Avulsos":     "bg-amber-50 dark:bg-amber-950/20",
  "Revenda":     "bg-cyan-50 dark:bg-cyan-950/20",
  "BOT/SW":      "bg-sky-50 dark:bg-sky-950/20",
  "Outras":      "bg-rose-50 dark:bg-rose-950/20",
};

export default function ComprasPorClienteView() {
  const now = new Date();
  const [from, setFrom] = useState(ymd(firstDayMonth(now)));
  const [to,   setTo]   = useState(ymd(lastDayMonth(now)));
  const [tipoFilter, setTipoFilter] = useState<string>("");
  const [textFilter, setTextFilter] = useState<string>("");
  const [metric, setMetric] = useState<"compras" | "receita">("compras");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  // Quick-select de datas
  function setRange(preset: string) {
    const t = new Date();
    if (preset === "mes")      { setFrom(ymd(firstDayMonth(t))); setTo(ymd(lastDayMonth(t))); }
    else if (preset === "mes-1"){ const d = addMonths(t,-1); setFrom(ymd(firstDayMonth(d))); setTo(ymd(lastDayMonth(d))); }
    else if (preset === "3m")  { setFrom(ymd(firstDayMonth(addMonths(t,-2)))); setTo(ymd(lastDayMonth(t))); }
    else if (preset === "6m")  { setFrom(ymd(firstDayMonth(addMonths(t,-5)))); setTo(ymd(lastDayMonth(t))); }
    else if (preset === "12m") { setFrom(ymd(firstDayMonth(addMonths(t,-11)))); setTo(ymd(lastDayMonth(t))); }
    else if (preset === "ytd") { setFrom(`${t.getFullYear()}-01-01`); setTo(ymd(t)); }
    else if (preset === "ano-1"){ const y = t.getFullYear()-1; setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }
  }

  // Agrega por cliente com buckets fixos
  const porCliente = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, {
      codigo_cliente: number | null; cliente_nome: string;
      tiposMostrados: Set<string>;
      byBucket: Record<Bucket, number>;
      receitaTotal: number; comprasTotal: number;
      is_shared: boolean;
    }>();
    for (const l of data.linhas) {
      if (tipoFilter && bucketOf(l.tipo_venda) !== tipoFilter) continue;
      const key = String(l.codigo_cliente ?? l.cliente_nome);
      const cur = map.get(key) ?? {
        codigo_cliente: l.codigo_cliente, cliente_nome: l.cliente_nome,
        tiposMostrados: new Set<string>(),
        byBucket: { "Contratuais":0, "Projetos":0, "Avulsos":0, "Revenda":0, "BOT/SW":0, "Outras":0 },
        receitaTotal: 0, comprasTotal: 0,
        is_shared: (l.codigo_cliente ?? 0) < 0,
      };
      const b = bucketOf(l.tipo_venda);
      const v = metric === "compras" ? l.total_compras : l.faturamento;
      cur.byBucket[b] += v;
      cur.receitaTotal += l.faturamento;
      cur.comprasTotal += l.total_compras;
      cur.tiposMostrados.add(l.tipo_venda);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a,b) => {
      const av = metric === "compras" ? a.comprasTotal : a.receitaTotal;
      const bv = metric === "compras" ? b.comprasTotal : b.receitaTotal;
      return bv - av;
    });
  }, [data, tipoFilter, metric]);

  const totaisFiltrados = useMemo(() => {
    let receita = 0, compras = 0;
    const byBucket: Record<Bucket, number> = { "Contratuais":0, "Projetos":0, "Avulsos":0, "Revenda":0, "BOT/SW":0, "Outras":0 };
    for (const c of porCliente) {
      receita += c.receitaTotal; compras += c.comprasTotal;
      (Object.keys(byBucket) as Bucket[]).forEach(b => { byBucket[b] += c.byBucket[b]; });
    }
    return { receita, compras, byBucket };
  }, [porCliente]);

  const visiveis = porCliente.filter(c =>
    !textFilter || c.cliente_nome.toLowerCase().includes(textFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Quick-select datas + inputs */}
      <div className="p-3 bg-ww-panel rounded-lg border border-ww-border space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase text-ww-textMuted mr-1">Rápido:</span>
          {[
            { l: "Mês atual", k: "mes" },
            { l: "Mês anterior", k: "mes-1" },
            { l: "Últ 3m", k: "3m" },
            { l: "Últ 6m", k: "6m" },
            { l: "Últ 12m", k: "12m" },
            { l: "YTD", k: "ytd" },
            { l: "Ano anterior", k: "ano-1" },
          ].map(p => (
            <button key={p.k} onClick={() => setRange(p.k)}
              className="px-2 py-0.5 text-[11px] font-semibold rounded border border-ww-border bg-ww-bg hover:bg-ww-rowHover text-ww-text">
              {p.l}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <div className="text-[10px] uppercase text-ww-textMuted">De</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                   className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-ww-textMuted">Até</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                   className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-ww-textMuted">Métrica das colunas</div>
            <select value={metric} onChange={(e) => setMetric(e.target.value as "compras"|"receita")}
                    className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text">
              <option value="compras">Compras</option>
              <option value="receita">Receita</option>
            </select>
          </div>
          <div>
            <div className="text-[10px] uppercase text-ww-textMuted">Buscar cliente</div>
            <input type="text" value={textFilter} onChange={(e) => setTextFilter(e.target.value)}
                   placeholder="nome…"
                   className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text" />
          </div>
          <div className="ml-auto text-[11px] text-ww-textMuted">
            {loading ? "Carregando…" : data ? `${visiveis.length} clientes · ${data.totais.linhas} linhas` : "—"}
          </div>
        </div>
        {/* Chips filtro por bucket com totais */}
        {data && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <BucketChip label="Todos" total={metric === "compras" ? data.totais.total_compras : data.totais.faturamento}
                       active={!tipoFilter} onClick={() => setTipoFilter("")} bg="bg-slate-900 text-white" />
            {TIPO_BUCKETS.map(b => (
              <BucketChip key={b} label={b} total={totaisFiltrados.byBucket[b]}
                          active={tipoFilter === b} onClick={() => setTipoFilter(tipoFilter === b ? "" : b)}
                          bg={BUCKET_BG[b].replace(/dark:[^ ]+/g, "")} />
            ))}
          </div>
        )}
      </div>

      {err && <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-800 text-[12px]">{err}</div>}

      {/* KPIs */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800 dark:bg-sky-950/30">
            <div className="text-[9.5px] uppercase tracking-[0.5px] font-semibold text-sky-900 dark:text-sky-100 opacity-70">Receita (Omie)</div>
            <div className="text-[17px] font-semibold tabular-nums mt-1 text-sky-900 dark:text-sky-100">{brl(totaisFiltrados.receita)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="text-[9.5px] uppercase tracking-[0.5px] font-semibold text-amber-900 dark:text-amber-100 opacity-70">Compras (PCs aprovados)</div>
            <div className="text-[17px] font-semibold tabular-nums mt-1 text-amber-900 dark:text-amber-100">{brl(totaisFiltrados.compras)}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
            <div className="text-[9.5px] uppercase tracking-[0.5px] font-semibold text-emerald-900 dark:text-emerald-100 opacity-70">Δ Receita − Compras</div>
            <div className="text-[17px] font-semibold tabular-nums mt-1 text-emerald-900 dark:text-emerald-100">
              {brl(totaisFiltrados.receita - totaisFiltrados.compras)}
            </div>
            <div className="text-[10px] text-emerald-800 dark:text-emerald-200 mt-0.5 opacity-70">
              Ainda falta descontar custo técnico + despesas — só no Metabase
            </div>
          </div>
        </div>
      )}

      {/* Info sobre compras compartilhadas */}
      {data && data.linhas.some(l => (l.codigo_cliente ?? 0) < 0) && (
        <div className="p-2 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded text-[11.5px] text-amber-900 dark:text-amber-100">
          ⚠️ <strong>Sentinel <code>-10 COMPRAS COMPARTILHADAS</code></strong> — PCs aprovados sem PV origem (contratual/estoque/garantia). Não atribuídos a cliente direto.
        </div>
      )}

      {/* Tabela: colunas por tipo (métrica escolhida) + rodapé */}
      {data && visiveis.length > 0 && (
        <div className="bg-ww-panel rounded-lg border border-ww-border overflow-hidden">
          <div className="px-3 py-2 border-b border-ww-border bg-ww-bg text-[10.5px] text-ww-textMuted">
            Colunas mostram <strong>{metric === "compras" ? "COMPRAS" : "RECEITA"}</strong> por tipo de venda no período. Rodapé soma cada coluna.
          </div>
          <table className="w-full text-[11.5px]">
            <thead className="bg-ww-bg border-b border-ww-border">
              <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 w-[110px]">Omie</th>
                {TIPO_BUCKETS.map(b => (
                  <th key={b} className={`px-3 py-2 text-right w-[110px] ${BUCKET_BG[b]}`}>{b}</th>
                ))}
                <th className="px-3 py-2 text-right w-[110px] border-l">Total compras</th>
                <th className="px-3 py-2 text-right w-[110px]">Total receita</th>
                <th className="px-3 py-2 text-right w-[130px]">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c, i) => {
                const delta = c.receitaTotal - c.comprasTotal;
                // margem % sobre receita (padrão contábil). Se receita = 0, sem base — não mostra %.
                const margemPct = c.receitaTotal > 0 ? (delta / c.receitaTotal) * 100 : null;
                return (
                  <tr key={i} className="border-t border-ww-border hover:bg-ww-rowHover">
                    <td className="px-3 py-1.5 font-semibold text-ww-text truncate max-w-[260px]" title={c.cliente_nome}>
                      {c.cliente_nome}
                      {c.is_shared && <span className="ml-2 text-[9px] px-1 py-px rounded bg-amber-200 text-amber-900">SENTINEL</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ww-textMuted">
                      {c.codigo_cliente && c.codigo_cliente > 0 ? `#${c.codigo_cliente}` : c.codigo_cliente ? c.codigo_cliente : "—"}
                    </td>
                    {TIPO_BUCKETS.map(b => (
                      <td key={b} className={`px-3 py-1.5 text-right font-mono tabular-nums text-ww-text ${BUCKET_BG[b]}`}>
                        {c.byBucket[b] > 0 ? brlCompact(c.byBucket[b]) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-ww-text border-l">
                      {c.comprasTotal > 0 ? brlCompact(c.comprasTotal) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ww-text">
                      {c.receitaTotal > 0 ? brlCompact(c.receitaTotal) : "—"}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-semibold ${
                      delta >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                    }`}>
                      <div>{brlCompact(delta)}</div>
                      {margemPct != null && (
                        <div className="text-[10px] opacity-70">
                          {margemPct >= 0 ? "+" : ""}{margemPct.toFixed(1)}%
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ww-borderStrong bg-ww-bg font-bold">
                <td className="px-3 py-2" colSpan={2}>TOTAL ({visiveis.length})</td>
                {TIPO_BUCKETS.map(b => (
                  <td key={b} className={`px-3 py-2 text-right font-mono tabular-nums ${BUCKET_BG[b]}`}>
                    {totaisFiltrados.byBucket[b] > 0 ? brlCompact(totaisFiltrados.byBucket[b]) : "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono tabular-nums border-l">
                  {brlCompact(totaisFiltrados.compras)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ww-text">
                  {brlCompact(totaisFiltrados.receita)}
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${
                  (totaisFiltrados.receita - totaisFiltrados.compras) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                }`}>
                  <div>{brlCompact(totaisFiltrados.receita - totaisFiltrados.compras)}</div>
                  {totaisFiltrados.receita > 0 && (
                    <div className="text-[10px] opacity-70">
                      {((totaisFiltrados.receita - totaisFiltrados.compras) / totaisFiltrados.receita * 100).toFixed(1)}%
                    </div>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="text-[10.5px] text-ww-textFaint italic">
        Rentabilidade completa (com custo técnico + despesas) →{" "}
        <a href="https://metabase.waterworks.com.br/dashboard/9" target="_blank" rel="noopener" className="underline">
          metabase.waterworks.com.br/dashboard/9
        </a>
      </div>
    </div>
  );
}

function BucketChip({ label, total, active, onClick, bg }: {
  label: string; total: number; active: boolean; onClick: () => void; bg: string;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition ${
        active ? "bg-slate-900 text-white border-slate-800" : `border-ww-border ${bg} hover:opacity-80 text-ww-text`
      }`}>
      <span>{label}</span>
      <span className="tabular-nums opacity-80">{brl(total)}</span>
    </button>
  );
}
