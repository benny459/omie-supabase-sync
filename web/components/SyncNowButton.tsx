"use client";

// Botão emergencial "Sync agora" no topo das telas com tabela. Dispara
// sync_quick.yml (PV incremental + PC 5pgs + etapas 5pgs) — ~1-2 min.
// Mostra barra de progresso animada (ETA 120s); 100% ao terminar.

import { useEffect, useRef, useState } from "react";

const ETA_SECONDS = 120; // ~2min típico do sync_quick

export default function SyncNowButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (state === "running") return;
    if (!window.confirm(
      "Sync leve AGORA?\n\n" +
      "• Puxa novidades recentes (PVs incrementais + últimas PCs + etapas)\n" +
      "• ~1-2 min pra completar\n" +
      "• Emergencial — o cron rotineiro já cobre normalmente\n\n" +
      "Continuar?",
    )) return;

    setState("running"); setPct(0); setMsg("Disparando…");

    // Anima a barra até 90% ao longo de ETA. O último 10% completa quando
    // o polling confirma que o workflow terminou.
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const target = Math.min(90, (elapsed / ETA_SECONDS) * 90);
      setPct((cur) => Math.max(cur, target));
    }, 500);

    try {
      const r = await fetch("/api/sync-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) {
        if (timerRef.current) clearInterval(timerRef.current);
        setState("error"); setPct(0);
        setMsg(j.error ?? r.statusText);
        setTimeout(() => { setState("idle"); setMsg(null); }, 8000);
        return;
      }
      setMsg("Rodando no GitHub Actions…");

      // Polling do último run do workflow. Quando concluir (~1-2min), fecha em 100%.
      const stopAt = Date.now() + 240_000; // safety cap 4min
      let concluded = false;
      while (Date.now() < stopAt) {
        await new Promise((res) => setTimeout(res, 6000));
        try {
          const s = await fetch("/api/sync-now/status", { cache: "no-store" });
          if (s.ok) {
            const sj = await s.json();
            if (sj.status === "completed") {
              concluded = true;
              break;
            }
          }
        } catch { /* network blip */ }
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setPct(100);
      setState(concluded ? "done" : "done"); // marca como done mesmo em timeout — não bloqueia UI
      setMsg(concluded ? "Concluído! Recarregue a página." : "Deve ter concluído — recarregue.");
      setTimeout(() => { setState("idle"); setPct(0); setMsg(null); }, 12_000);
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      setState("error"); setPct(0);
      setMsg(err instanceof Error ? err.message : String(err));
      setTimeout(() => { setState("idle"); setMsg(null); }, 8000);
    }
  }

  const running = state === "running";
  const done    = state === "done";
  const error   = state === "error";

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <button type="button" onClick={onClick} disabled={running}
        title="Dispara sync leve (~1-2 min): PVs incrementais + últimas PCs + etapas."
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition ${
          running
            ? "bg-ww-bg text-ww-textMuted border-ww-border cursor-wait "
            : done
              ? "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
              : error
                ? "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
                : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800 dark:hover:bg-violet-900/40"
        }`}>
        {running ? "⏳" : done ? "✓" : error ? "❌" : "🔄"}
        <span>{running ? "Sincronizando" : done ? "Sync ok" : "Sync agora"}</span>
      </button>
      {(running || done || error) && (
        <div className="inline-flex items-center gap-1.5 min-w-[180px]">
          <div className="h-2 flex-1 min-w-[120px] rounded-full bg-ww-border overflow-hidden">
            <div className={`h-full transition-all duration-500 ${
              done ? "bg-emerald-500" : error ? "bg-rose-500" : "bg-violet-500"
            }`} style={{ width: `${pct.toFixed(0)}%` }} />
          </div>
          <span className={`text-[10.5px] font-mono tabular-nums w-8 text-right ${
            done ? "text-emerald-700 dark:text-emerald-300"
              : error ? "text-rose-700 dark:text-rose-300"
              : "text-violet-700 dark:text-violet-300"
          }`}>{Math.round(pct)}%</span>
        </div>
      )}
      {msg && (
        <span className={`text-[10.5px] px-1.5 py-0.5 rounded whitespace-nowrap ${
          error
            ? "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
            : done
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : "bg-ww-rowHover text-ww-textMuted border border-ww-border "
        }`}>
          {msg}
        </span>
      )}
    </span>
  );
}
