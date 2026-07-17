"use client";

// Botão emergencial "Sync agora" no topo das telas com tabela. Dispara
// master_orders_diaria + master_sales_diaria em paralelo. Roda em ~5-8min.

import { useState } from "react";

export default function SyncNowButton() {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (sending) return;
    if (!window.confirm(
      "Disparar sync master AGORA?\n\n" +
      "• Roda master_orders + master_sales em paralelo\n" +
      "• ~5-8 min pra completar\n" +
      "• Uso emergencial — o cron rotineiro é mais eficiente\n\n" +
      "Continuar?",
    )) return;

    setSending(true); setMsg(null);
    try {
      const r = await fetch("/api/sync-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: j.error ?? r.statusText });
      else setMsg({ tone: "ok", text: j.message ?? "Disparado!" });
    } catch (err) {
      setMsg({ tone: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
      setTimeout(() => setMsg(null), 10_000);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={sending}
        title="Dispara master_orders + master_sales AGORA. Roda em ~5-8 min."
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition ${
          sending
            ? "bg-slate-100 text-slate-400 border-slate-200 cursor-wait dark:bg-slate-800 dark:border-slate-700"
            : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800 dark:hover:bg-violet-900/40"
        }`}>
        {sending ? "⏳" : "🔄"}
        <span>Sync agora</span>
      </button>
      {msg && (
        <span className={`text-[11px] px-2 py-0.5 rounded ${
          msg.tone === "ok"
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
            : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
        }`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
