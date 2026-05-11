"use client";

import { useState } from "react";

const DAILY = ["master_orders_diaria.yml", "master_finance_diaria.yml", "master_sales_diaria.yml"];
const WEEKLY = ["master_orders_semanal.yml", "master_finance_semanal.yml", "master_sales_semanal.yml"];

async function dispatchAll(files: string[]): Promise<{ ok: number; err: number; msgs: string[] }> {
  let ok = 0, err = 0; const msgs: string[] = [];
  for (const f of files) {
    try {
      const r = await fetch("/api/admin/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dispatch", file: f }),
      });
      if (r.ok) { ok++; msgs.push(`✓ ${f}`); }
      else { err++; const j = await r.json().catch(() => ({})); msgs.push(`✗ ${f}: ${j.error ?? r.statusText}`); }
    } catch (e) { err++; msgs.push(`✗ ${f}: ${(e as Error).message}`); }
  }
  return { ok, err, msgs };
}

export default function QuickRunButtons() {
  const [busy, setBusy] = useState<"daily" | "weekly" | null>(null);

  async function run(kind: "daily" | "weekly") {
    const files = kind === "daily" ? DAILY : WEEKLY;
    const label = kind === "daily" ? "diária" : "semanal";
    if (!confirm(`Disparar os 3 workflows ${label}s (orders + finance + sales)?`)) return;
    setBusy(kind);
    const { ok, err, msgs } = await dispatchAll(files);
    setBusy(null);
    if (err === 0) alert(`✓ ${ok} workflow(s) ${label}s disparados.\n\n${msgs.join("\n")}\n\nAcompanhe no painel "Status detalhado".`);
    else alert(`Disparou ${ok}, falhou ${err}.\n\n${msgs.join("\n")}`);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => run("daily")} disabled={busy !== null}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition disabled:opacity-50"
        title="Dispara orders + finance + sales diárias agora"
      >
        {busy === "daily" ? "..." : "▶ Rodar diária"}
      </button>
      <button
        onClick={() => run("weekly")} disabled={busy !== null}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md shadow-sm transition disabled:opacity-50"
        title="Dispara orders + finance + sales semanais agora"
      >
        {busy === "weekly" ? "..." : "▶ Rodar semanal"}
      </button>
    </div>
  );
}
