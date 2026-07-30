"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  modulo: string;
  empresa: string | null;
  kind: "sales" | "orders" | "finance" | "aux" | "outro";
  last_sync_at: string | null;
  ultima_execucao_status: string | null;
  ultima_execucao_msg: string | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_before: number | null;
  total_registros: number | null;
  duracao_segundos: number | null;
  modo: string | null;
};

type Summary = {
  total: number; ok: number; erro: number;
  last_24h: number; last_24h_erro: number;
  by_kind: Record<string, number>;
};

const KIND_LABEL: Record<string, string> = {
  sales: "Sales", orders: "Orders", finance: "Finance", aux: "Aux", outro: "Outro",
};
const KIND_COLOR: Record<string, string> = {
  sales:   "bg-sky-100 text-sky-800 border-sky-200",
  orders:  "bg-violet-100 text-violet-800 border-violet-200",
  finance: "bg-amber-100 text-amber-800 border-amber-200",
  aux:     "bg-ww-bg text-ww-textMuted border-ww-border",
  outro:   "bg-rose-100 text-rose-800 border-rose-200",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function fmtDuracao(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR");
}

export default function RunDetailsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterKind, setFilterKind] = useState<string>("todos");
  const [filterStatus, setFilterStatus] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/run-details", { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `HTTP ${r.status}`);
        setLoading(false);
        return;
      }
      const j = await r.json();
      setRows(j.rows ?? []);
      setSummary(j.summary ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterKind !== "todos" && r.kind !== filterKind) return false;
      if (filterStatus === "ok"   && r.ultima_execucao_status !== "SUCESSO") return false;
      if (filterStatus === "erro" && r.ultima_execucao_status !== "ERRO")    return false;
      if (q) {
        const blob = `${r.modulo} ${r.empresa ?? ""} ${r.ultima_execucao_msg ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filterKind, filterStatus, search]);

  function toggleRow(key: string) {
    setExpanded((p) => {
      const next = new Set(p);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <div className="rounded-xl border border-ww-border bg-ww-panel p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted">Módulos rastreados</div>
            <div className="text-[20px] font-semibold text-ww-text mt-1">{summary.total}</div>
          </div>
          <div className={`rounded-xl border p-3 ${summary.last_24h_erro > 0 ? "border-rose-300 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className={`text-[10px] uppercase tracking-wider font-semibold ${summary.last_24h_erro > 0 ? "text-rose-700" : "text-emerald-700"}`}>Erros 24h</div>
            <div className={`text-[20px] font-semibold mt-1 ${summary.last_24h_erro > 0 ? "text-rose-900" : "text-emerald-900"}`}>{summary.last_24h_erro}</div>
            <div className="text-[10px] opacity-70">de {summary.last_24h} runs</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">SUCESSO total</div>
            <div className="text-[20px] font-semibold text-emerald-900 mt-1">{summary.ok}</div>
          </div>
          <div className={`rounded-xl border p-3 ${summary.erro > 0 ? "border-rose-300 bg-rose-50" : "border-ww-border bg-ww-panel"}`}>
            <div className={`text-[10px] uppercase tracking-wider font-semibold ${summary.erro > 0 ? "text-rose-700" : "text-ww-textMuted"}`}>ERRO total</div>
            <div className={`text-[20px] font-semibold mt-1 ${summary.erro > 0 ? "text-rose-900" : "text-ww-textMuted"}`}>{summary.erro}</div>
          </div>
          <div className="rounded-xl border border-ww-border bg-ww-panel p-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted">Por workflow</div>
            <div className="text-[11px] mt-1 space-y-0.5 font-mono">
              <div>S {summary.by_kind.sales} · O {summary.by_kind.orders} · F {summary.by_kind.finance}</div>
              <div className="text-ww-textMuted">A {summary.by_kind.aux} · ? {summary.by_kind.outro}</div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="filtrar módulo, empresa ou mensagem…"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-ww-border rounded-md bg-ww-panel focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <div className="flex items-center gap-1">
          {["todos","sales","orders","finance","aux"].map((k) => (
            <button key={k} onClick={() => setFilterKind(k)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition ${
                filterKind === k
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-ww-panel text-ww-textMuted border-ww-border hover:border-ww-borderStrong"
              }`}>{k === "todos" ? "Todos" : KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {["todos","ok","erro"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border transition ${
                filterStatus === s
                  ? s === "erro" ? "bg-rose-600 text-white border-rose-600"
                    : s === "ok" ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-slate-900 text-white border-slate-900"
                  : "bg-ww-panel text-ww-textMuted border-ww-border hover:border-ww-borderStrong"
              }`}>{s === "todos" ? "Todos" : s === "ok" ? "✓ OK" : "✗ Erro"}</button>
          ))}
        </div>
        <button onClick={load}
          className="px-3 py-1.5 text-[11px] font-semibold text-ww-textMuted bg-ww-panel border border-ww-border hover:bg-ww-rowHover rounded-md transition">
          {loading ? "..." : "↻ Atualizar"}
        </button>
      </div>

      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          ❌ {err}
        </div>
      )}

      {/* Tabela */}
      <div className="border border-ww-border rounded-lg overflow-hidden bg-ww-panel">
        <table className="w-full text-[11.5px] tabular-nums">
          <thead className="bg-ww-rowHover text-ww-textMuted border-b border-ww-border">
            <tr>
              <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider">Módulo · Empresa</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">Workflow</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">Quando</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">Status</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">Inseridas</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">Atualizadas</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">Total</th>
              <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">Duração</th>
              <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">Modo</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ww-textMuted text-xs">Nenhum módulo bate o filtro.</td></tr>
            )}
            {filtered.map((r) => {
              const key = `${r.modulo}|${r.empresa}`;
              const isErr = r.ultima_execucao_status === "ERRO";
              const isExp = expanded.has(key);
              return (
                <>
                  <tr key={key}
                    onClick={() => toggleRow(key)}
                    className={`border-b border-ww-border cursor-pointer hover:bg-ww-rowHover transition ${isErr ? "bg-rose-50/40" : ""}`}>
                    <td className="px-3 py-2 font-mono">
                      <div className="font-semibold text-ww-text">{r.modulo}</div>
                      {r.empresa && <div className="text-[10px] text-ww-textMuted">{r.empresa}</div>}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${KIND_COLOR[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                    </td>
                    <td className="px-2 py-2 text-ww-textMuted" title={r.last_sync_at ?? ""}>{relTime(r.last_sync_at)}</td>
                    <td className="px-2 py-2">
                      {isErr ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border bg-rose-100 text-rose-800 border-rose-200">✗ Erro</span>
                      ) : r.ultima_execucao_status === "SUCESSO" ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border bg-emerald-100 text-emerald-800 border-emerald-200">✓ OK</span>
                      ) : (
                        <span className="text-[10px] text-ww-textFaint">{r.ultima_execucao_status ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-emerald-700">{fmtNum(r.rows_inserted)}</td>
                    <td className="px-2 py-2 text-right text-sky-700">{fmtNum(r.rows_updated)}</td>
                    <td className="px-2 py-2 text-right font-semibold">{fmtNum(r.total_registros)}</td>
                    <td className="px-2 py-2 text-right text-ww-textMuted">{fmtDuracao(r.duracao_segundos)}</td>
                    <td className="px-2 py-2 text-[10px] text-ww-textMuted font-mono">{r.modo ?? "—"}</td>
                  </tr>
                  {isExp && (
                    <tr key={`${key}-exp`} className="border-b border-ww-border bg-ww-rowHover">
                      <td colSpan={9} className="px-3 py-2 text-[11px] text-ww-textMuted space-y-1">
                        <div><strong>Mensagem:</strong> <span className="font-mono">{r.ultima_execucao_msg ?? "—"}</span></div>
                        <div className="text-ww-textMuted">
                          Antes: <span className="font-mono">{fmtNum(r.rows_before)}</span> ·
                          Inseridas: <span className="font-mono text-emerald-700">{fmtNum(r.rows_inserted)}</span> ·
                          Atualizadas: <span className="font-mono text-sky-700">{fmtNum(r.rows_updated)}</span> ·
                          Total agora: <span className="font-mono font-semibold">{fmtNum(r.total_registros)}</span>
                        </div>
                        <div className="text-[10px] text-ww-textFaint">last_sync_at: {r.last_sync_at ?? "—"}</div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-ww-textFaint">
        Fonte: <code>sales.sync_state</code> — atualizado pelos importers Python a cada execução.
        Click numa linha pra ver mensagem + contagens completas.
      </p>
    </div>
  );
}
