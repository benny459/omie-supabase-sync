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
  clientes?: { codigo_cliente_omie: number; percentual: number }[];
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

export default function AtribuirClienteView() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"backlog" | "atribuidos">("backlog");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<PcRow | null>(null);
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

  const listVis = useMemo(() => {
    if (!data) return [];
    const list = tab === "backlog" ? data.backlog : data.atribuidos;
    return list.filter(p =>
      !filter || p.pc_numero.includes(filter) || (p.projeto_nome ?? "").toLowerCase().includes(filter.toLowerCase())
    );
  }, [data, tab, filter]);

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

      {/* Tabs + filtro */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-ww-border overflow-hidden">
          <button onClick={() => setTab("backlog")}
            className={`px-3 py-1.5 text-[12px] font-semibold ${tab==="backlog" ? "bg-rose-600 text-white" : "bg-ww-panel text-ww-text hover:bg-ww-rowHover"}`}>
            🔴 Sem atribuição ({data?.resumo.backlog ?? 0})
          </button>
          <button onClick={() => setTab("atribuidos")}
            className={`px-3 py-1.5 text-[12px] font-semibold ${tab==="atribuidos" ? "bg-emerald-600 text-white" : "bg-ww-panel text-ww-text hover:bg-ww-rowHover"}`}>
            🟢 Atribuídos ({data?.resumo.atribuidos ?? 0})
          </button>
        </div>
        <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)}
               placeholder="Filtrar por PC # ou projeto…"
               className="px-2 py-1 text-[11.5px] rounded border border-ww-border bg-ww-bg text-ww-text max-w-xs" />
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
              {listVis.map((p) => (
                <tr key={`${p.empresa}-${p.pc_numero}`} className="border-t border-ww-border hover:bg-ww-rowHover">
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <AtribuicaoModal pc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setTick(t => t+1); }} />
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
      return pc.clientes.map(c => ({ codigo_cliente_omie: c.codigo_cliente_omie, nome: `Omie #${c.codigo_cliente_omie}`, percentual: c.percentual }));
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
