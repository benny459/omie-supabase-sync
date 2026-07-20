"use client";

// ComprasPorClienteView — prévia painel-side da contribuição pra rentabilidade.
// Mostra receita (Omie) + compras (PCs aprovados) por cliente/tipo_venda/mês.
// O consolidado (com custo do WW-app) vive no Metabase dashboard 9.

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

export default function ComprasPorClienteView() {
  const now = new Date();
  const [from, setFrom] = useState(ymd(firstDayMonth(now)));
  const [to,   setTo]   = useState(ymd(lastDayMonth(now)));
  const [tipoFilter, setTipoFilter] = useState<string>("");
  const [textFilter, setTextFilter] = useState<string>("");
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

  // Agrega por cliente
  const porCliente = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, {
      codigo_cliente: number | null; cliente_nome: string;
      tipos: Set<string>; receita: number; compras: number;
      is_shared: boolean;
    }>();
    for (const l of data.linhas) {
      if (tipoFilter && l.tipo_venda !== tipoFilter) continue;
      const key = String(l.codigo_cliente ?? l.cliente_nome);
      const cur = map.get(key) ?? {
        codigo_cliente: l.codigo_cliente, cliente_nome: l.cliente_nome,
        tipos: new Set<string>(), receita: 0, compras: 0,
        is_shared: (l.codigo_cliente ?? 0) < 0,
      };
      cur.tipos.add(l.tipo_venda);
      cur.receita += l.faturamento;
      cur.compras += l.total_compras;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a,b) => (b.receita + b.compras) - (a.receita + a.compras));
  }, [data, tipoFilter]);

  const tiposDistintos = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.linhas.map(l => l.tipo_venda))).sort();
  }, [data]);

  const totaisFiltrados = useMemo(() => {
    let receita = 0, compras = 0;
    for (const c of porCliente) { receita += c.receita; compras += c.compras; }
    return { receita, compras };
  }, [porCliente]);

  const visiveis = porCliente.filter(c =>
    !textFilter || c.cliente_nome.toLowerCase().includes(textFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex items-end gap-2 flex-wrap p-3 bg-ww-panel rounded-lg border border-ww-border">
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
          <div className="text-[10px] uppercase text-ww-textMuted">Tipo</div>
          <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value)}
                  className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text">
            <option value="">Todos</option>
            {tiposDistintos.map(t => <option key={t} value={t}>{t}</option>)}
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
            <div className="text-[9.5px] uppercase tracking-[0.5px] font-semibold text-emerald-900 dark:text-emerald-100 opacity-70">Diferença (receita − compras)</div>
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
          Evolução: fazer PC via PV pra atribuição fluir.
        </div>
      )}

      {/* Tabela */}
      {data && visiveis.length > 0 && (
        <div className="bg-ww-panel rounded-lg border border-ww-border overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-ww-bg border-b border-ww-border">
              <tr className="text-left uppercase tracking-[0.4px] text-[10px] text-ww-textMuted">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Código Omie</th>
                <th className="px-3 py-2">Tipos venda</th>
                <th className="px-3 py-2 text-right">Receita</th>
                <th className="px-3 py-2 text-right">Compras</th>
                <th className="px-3 py-2 text-right">Δ Receita − Compras</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c, i) => {
                const delta = c.receita - c.compras;
                return (
                  <tr key={i} className="border-t border-ww-border hover:bg-ww-rowHover">
                    <td className="px-3 py-1.5 font-semibold text-ww-text">
                      {c.cliente_nome}
                      {c.is_shared && <span className="ml-2 text-[9px] px-1 py-px rounded bg-amber-200 text-amber-900">SENTINEL</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ww-textMuted">
                      {c.codigo_cliente && c.codigo_cliente > 0 ? `#${c.codigo_cliente}` : c.codigo_cliente ? c.codigo_cliente : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-ww-textMuted">
                      {Array.from(c.tipos).join(", ")}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ww-text">{brlCompact(c.receita)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ww-text">{c.compras > 0 ? brlCompact(c.compras) : "—"}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-semibold ${
                      delta >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                    }`}>
                      {brlCompact(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
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
