"use client";

import { useEffect, useRef, useState } from "react";

type Hit = {
  bucket_key: string;
  bucket_label: string;
  modulo: string;       // avulsos | pcs | projetos | standby
  empresa: string | null;
  pc_numero: string | null;
  pv_os_label: string | null;
  fornecedor: string | null;
  cliente: string | null;
  projeto: string | null;
  valor: number | null;
  etapa: string | null;
  status: string | null;
  matched_field: string;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MOD_LABEL: Record<string, string> = {
  avulsos: "Avulsos", pcs: "PCs", projetos: "Projetos", standby: "Standby",
};
const MOD_HREF: Record<string, string> = {
  avulsos: "/avulsos", pcs: "/pcs", projetos: "/projetos",
};
const MOD_COLOR: Record<string, string> = {
  avulsos:  "bg-emerald-100 text-emerald-800 border-emerald-200",
  pcs:      "bg-indigo-100 text-indigo-800 border-indigo-200",
  projetos: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  standby:  "bg-slate-100 text-slate-700 border-slate-200",
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Última query que o servidor RESPONDEU. "Nada encontrado" só aparece quando
  // resolvedQ === q E hits=[] — assim evitamos flash durante debounce.
  const [resolvedQ, setResolvedQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Atalho: ⌘K / Ctrl+K abre
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Foca input ao abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Busca debounced. busy=true desde o instante em que o user digita ≥2 chars
  // (não só durante o fetch) — assim a UI não pisca "Nada encontrado" durante
  // os 220ms de debounce.
  useEffect(() => {
    if (!open) return;
    const v = q.trim();
    if (v.length < 2) { setHits([]); setErr(null); setBusy(false); setResolvedQ(""); return; }
    setBusy(true);
    setErr(null);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(v)}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) { setErr(j.error ?? r.statusText); setHits([]); }
        else { setHits(j.hits ?? []); }
        setResolvedQ(v);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      } finally { setBusy(false); }
    }, 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  function go(h: Hit) {
    // Fallback robusto: se módulo desconhecido, manda pra /avulsos se tem PV
    // (ou /pcs se é PC standalone). Nunca cai em /configuracoes.
    const href = MOD_HREF[h.modulo] ?? (h.pv_os_label ? "/avulsos" : "/pcs");
    const hash = encodeURIComponent(h.bucket_label);
    window.location.href = `${href}#bucket=${hash}`;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Busca global (⌘K) — encontra PV, OS, PC, fornecedor ou cliente em qualquer página"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md shadow-sm transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M3 12h18"/>
          <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0 -18"/>
        </svg>
        Buscar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-ww-panel rounded-xl shadow-2xl max-w-2xl w-full border border-ww-border overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-ww-border">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-ww-textMuted" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="M3 12h18"/>
                <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0 -18"/>
              </svg>
              <input
                ref={inputRef}
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="PC, PV, OS, fornecedor, cliente, projeto…"
                className="flex-1 bg-transparent text-sm text-ww-text outline-none placeholder:text-ww-textFaint"
              />
              {busy && <span className="text-[10px] text-ww-textMuted font-mono">buscando…</span>}
              <button onClick={() => setOpen(false)} className="text-ww-textMuted hover:text-ww-text text-lg px-1">×</button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {err && (
                <div className="p-4 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">❌ {err}</div>
              )}
              {!err && q.trim().length >= 2 && hits.length === 0 && !busy && resolvedQ === q.trim() && (
                <div className="p-8 text-center text-xs text-ww-textMuted">
                  Nada encontrado para <strong className="font-mono">{q}</strong>
                </div>
              )}
              {!err && q.trim().length < 2 && (
                <div className="p-6 text-center text-xs text-ww-textMuted space-y-1">
                  <p>Digite ao menos 2 caracteres.</p>
                  <p className="text-ww-textFaint">Ex: <span className="font-mono">6620</span>, <span className="font-mono">PV1705</span>, <span className="font-mono">Acme</span>…</p>
                </div>
              )}
              {hits.map((h) => (
                <button
                  key={h.bucket_key}
                  onClick={() => go(h)}
                  className="w-full text-left px-4 py-2.5 hover:bg-ww-rowHover border-b border-ww-border last:border-0 transition flex items-center gap-3"
                >
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${MOD_COLOR[h.modulo] ?? MOD_COLOR.standby}`}>
                    {MOD_LABEL[h.modulo] ?? h.modulo}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm text-ww-text">
                      <span className="font-mono font-semibold">{h.bucket_label}</span>
                      {h.empresa && <span className="text-[10px] font-mono text-ww-textMuted px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{h.empresa}</span>}
                      {h.etapa && <span className="text-[10px] text-ww-textMuted">· {h.etapa}</span>}
                      {h.matched_field && <span className="text-[9px] text-sky-700 ml-auto">match: {h.matched_field}</span>}
                    </div>
                    <div className="text-[11px] text-ww-textMuted truncate mt-0.5">
                      {h.fornecedor && <span>{h.fornecedor}</span>}
                      {h.fornecedor && h.cliente && <span className="mx-1.5">·</span>}
                      {h.cliente && <span>{h.cliente}</span>}
                      {h.projeto && <span className="ml-1.5 text-fuchsia-700">[{h.projeto}]</span>}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-ww-textMuted whitespace-nowrap">
                    {fmtBRL(h.valor)}
                  </span>
                </button>
              ))}
            </div>

            <div className="px-4 py-2 text-[10px] text-ww-textFaint border-t border-ww-border bg-ww-bg flex items-center justify-between">
              <span>↵ abrir · esc fechar</span>
              <span>Busca em PC · PV/OS · fornecedor · cliente · projeto</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
