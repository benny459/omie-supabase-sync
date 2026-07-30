"use client";

// Botão inline "🔄 Sync" por bucket. Dispara refetch em paralelo de:
//   - PV OU OS (via /api/pvs/force-sync ou /api/oss/force-sync)
//   - Todos os PCs vinculados ao bucket (via /api/pcs/force-sync)
// Confirmação obrigatória antes de disparar.

import { useState } from "react";

type Kind = "pv_os" | "pc_only";

export default function BucketSyncButton({
  kind,
  pvOsLabel,      // "PV1234" | "OS4567" | null (quando pc_only)
  pcNumeros,      // strings, ex: ["6875","6877"]
}: {
  kind: Kind;
  pvOsLabel: string | null;
  pcNumeros: string[];
}) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const uniquePcs = Array.from(new Set(pcNumeros.map((s) => String(s).trim()).filter(Boolean)));
  const hasPvOs = kind === "pv_os" && !!pvOsLabel;
  const nothingToSync = !hasPvOs && uniquePcs.length === 0;

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (nothingToSync || sending) return;

    // Confirmação — descreve exatamente o que vai disparar
    const parts: string[] = [];
    if (hasPvOs) parts.push(pvOsLabel!);
    if (uniquePcs.length > 0) parts.push(`${uniquePcs.length} PC(s): ${uniquePcs.slice(0, 5).join(", ")}${uniquePcs.length > 5 ? "…" : ""}`);
    const confirmMsg = `Sincronizar do Omie:\n\n${parts.join("\n")}\n\nO refetch roda em ~1 min. Continuar?`;
    if (!window.confirm(confirmMsg)) return;

    setSending(true); setMsg(null);

    // Dispara em paralelo: PV/OS + PCs. Cada endpoint responde independente.
    const jobs: Promise<{ label: string; ok: boolean; error?: string }>[] = [];

    if (hasPvOs) {
      const isOS = pvOsLabel!.toUpperCase().startsWith("OS");
      const numero = pvOsLabel!.replace(/^(PV|OS)/i, "").trim();
      const endpoint = isOS ? "/api/oss/force-sync" : "/api/pvs/force-sync";
      const bodyKey = isOS ? "os_numeros" : "pv_numeros";
      jobs.push(
        fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [bodyKey]: [numero] }),
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          return { label: pvOsLabel!, ok: r.ok, error: !r.ok ? (j.error ?? r.statusText) : undefined };
        }),
      );
    }

    if (uniquePcs.length > 0) {
      jobs.push(
        fetch("/api/pcs/force-sync", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pc_numeros: uniquePcs }),
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          return { label: `${uniquePcs.length} PC(s)`, ok: r.ok, error: !r.ok ? (j.error ?? r.statusText) : undefined };
        }),
      );
    }

    try {
      const results = await Promise.all(jobs);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setMsg({ tone: "err", text: `Falha: ${failed.map((f) => `${f.label} (${f.error})`).join(", ")}` });
      } else {
        setMsg({ tone: "ok", text: `Disparado! Recarrega em ~1 min.` });
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
      // Limpa mensagem depois de 5s
      setTimeout(() => setMsg(null), 5000);
    }
  }

  if (nothingToSync) return null;

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onClick} disabled={sending}
        title={hasPvOs && uniquePcs.length > 0
          ? `Sync ${pvOsLabel} + ${uniquePcs.length} PC(s) do Omie`
          : hasPvOs
            ? `Sync ${pvOsLabel} do Omie`
            : `Sync ${uniquePcs.length} PC(s) do Omie`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition ${
          sending
            ? "bg-ww-bg text-ww-textFaint border-ww-border cursor-wait"
            : "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800 dark:hover:bg-sky-900/40"
        }`}>
        {sending ? "⏳" : "🔄"}
        <span>Sync</span>
      </button>
      {msg && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
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
