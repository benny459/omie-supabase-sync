"use client";

// Toolbar do /standby: input pra listar PCs e disparar workflow_dispatch
// que refetcha via ConsultarPedCompra do Omie. Batch: N PCs por chamada.

import { useState } from "react";

export default function StandbyForceSync() {
  const [pcInput, setPcInput] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; runUrl?: string } | null>(null);

  async function dispatch() {
    const pcNumeros = pcInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (pcNumeros.length === 0) {
      setMsg({ tone: "err", text: "Digite ao menos 1 PC number" });
      return;
    }
    if (pcNumeros.length > 500) {
      setMsg({ tone: "err", text: "Máximo 500 PCs por batch" });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pcs/force-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pc_numeros: pcNumeros }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ tone: "err", text: j.error ?? r.statusText });
      } else {
        setMsg({
          tone: "ok",
          text: `${j.message ?? "Dispatched"} — recarrega em ~1 min pra ver os updates.`,
          runUrl: j.run_url,
        });
        setPcInput("");
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-4 p-3 rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-800">
      <div className="flex items-start gap-3">
        <span className="text-[16px] leading-none mt-1">🔄</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-orange-900 dark:text-orange-100 mb-1">
            Forçar sync de PCs específicos
          </div>
          <div className="text-[11px] text-orange-800 dark:text-orange-200 opacity-90 mb-2">
            Cole os números dos PCs (cnumero, separados por vírgula, espaço ou quebra de linha).
            Máx 500 por batch. Chama <code>ConsultarPedCompra</code> no Omie e refaz o upsert.
          </div>
          <div className="flex gap-2">
            <textarea
              value={pcInput}
              onChange={(e) => setPcInput(e.target.value)}
              placeholder="Ex: 2859, 3702, 431"
              rows={2}
              className="flex-1 text-[12px] font-mono px-2.5 py-1.5 rounded border border-orange-300 dark:border-orange-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-orange-500 resize-y"
              disabled={sending}
            />
            <button type="button" onClick={dispatch} disabled={sending || pcInput.trim() === ""}
              className={`shrink-0 px-4 py-2 rounded text-[12px] font-semibold transition ${
                sending || pcInput.trim() === ""
                  ? "bg-orange-200 text-orange-500 cursor-not-allowed dark:bg-orange-950 dark:text-orange-700"
                  : "bg-orange-600 text-white hover:bg-orange-700"
              }`}>
              {sending ? "Disparando…" : "Refetch"}
            </button>
          </div>
          {msg && (
            <div className={`mt-2 text-[11.5px] px-2 py-1.5 rounded ${
              msg.tone === "ok"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
            }`}>
              {msg.text}
              {msg.runUrl && (
                <a href={msg.runUrl} target="_blank" rel="noopener noreferrer"
                   className="ml-2 underline font-semibold">Ver execução ↗</a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
