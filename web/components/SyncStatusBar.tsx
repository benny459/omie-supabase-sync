"use client";

import { useEffect, useState } from "react";

type Sync = {
  modulo: string;
  empresa: string;
  last_sync_at: string;
  total_registros: number | null;
  ultima_execucao_status: string | null;
  duracao_segundos: number | null;
  rows_inserted?: number | null;
  rows_updated?: number | null;
};

// Mapeia prefixos de modulo → rótulo humano
function humanModule(m: string): string {
  const name = m.replace(/_[A-Z]{2}$/, ""); // tira sufixo "_SF", "_CD", "_WW"
  return name.replace(/_/g, " ");
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h${min % 60 ? ` ${min % 60}m` : ""}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d !== 1 ? "s" : ""}`;
}

export default function SyncStatusBar() {
  const [syncs, setSyncs] = useState<Sync[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/sync-state", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(j => setSyncs(j?.syncs ?? []))
      .catch(() => setSyncs([]));
    // Atualiza a cada 5 min
    const id = setInterval(() => {
      fetch("/api/sync-state", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(j => j && setSyncs(j.syncs ?? []))
        .catch(() => {});
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  if (!syncs || syncs.length === 0) return null;
  const latest = syncs[0];
  const hasErr = syncs.some(s => s.ultima_execucao_status && s.ultima_execucao_status !== "SUCESSO");

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-1 text-[11px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition"
        title="Histórico de sincronização"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${hasErr ? "bg-amber-500" : "bg-emerald-500 animate-pulse"}`} />
        <span>
          Última sync: <strong className="text-slate-900">{timeAgo(latest.last_sync_at)}</strong>
          <span className="text-slate-400 mx-1">·</span>
          <span className="text-slate-700">{humanModule(latest.modulo)}</span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-[420px] max-h-[360px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-700">Últimos {syncs.length} sync(s)</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
          </div>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-[9px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <th className="px-3 py-1.5 font-semibold">Módulo</th>
                <th className="px-2 py-1.5 font-semibold">Empresa</th>
                <th className="px-2 py-1.5 font-semibold text-right">Registros</th>
                <th className="px-2 py-1.5 font-semibold text-right">Quando</th>
                <th className="px-2 py-1.5 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {syncs.map((s, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 text-slate-900 font-medium">{humanModule(s.modulo)}</td>
                  <td className="px-2 py-1.5 text-slate-500">{s.empresa}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                    {s.total_registros != null ? s.total_registros.toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-500" title={new Date(s.last_sync_at).toLocaleString("pt-BR")}>
                    {timeAgo(s.last_sync_at)}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {s.ultima_execucao_status === "SUCESSO" ? (
                      <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-100 text-emerald-800">✓</span>
                    ) : s.ultima_execucao_status === "ERRO" ? (
                      <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-rose-100 text-rose-800">✗</span>
                    ) : (
                      <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-slate-100 text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
