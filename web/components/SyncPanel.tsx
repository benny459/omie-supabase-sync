"use client";

import { useCallback, useEffect, useState } from "react";

type Slot = { cron: string; time: string; day: string };
type WorkflowStatus = "ativo" | "desativado" | "sem_schedule";
type NextRun = { relative: string; absolute: string; iso: string } | null;
type Workflow = {
  file: string;
  name: string;
  kind: "sales" | "orders" | "finance";
  description: string;
  status: WorkflowStatus;
  slots: Slot[];
  sha: string;
  nextRun: NextRun;
};
type Run = {
  id: number;
  workflow_name: string;
  title: string;
  status: string;       // queued | in_progress | completed
  conclusion: string | null;
  run_number: number;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  file: string;
};

const KIND_TONE: Record<Workflow["kind"], { bar: string; icon: string; emoji: string }> = {
  sales:   { bar: "bg-sky-500",    icon: "text-sky-700",    emoji: "📊" },
  orders:  { bar: "bg-violet-500", icon: "text-violet-700", emoji: "🛒" },
  finance: { bar: "bg-amber-500",  icon: "text-amber-700",  emoji: "💰" },
};

export default function SyncPanel() {
  const [tab, setTab] = useState<"workflows" | "runs">("workflows");
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [actionsUrl, setActionsUrl] = useState<string>("");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [flash, setFlash] = useState<{ name: string; intervalHours: number; windowMode: string; nextRun: NextRun } | null>(null);

  const loadWorkflows = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/admin/sync", { cache: "no-store" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `HTTP ${r.status}`); setLoading(false); return; }
    const j = await r.json();
    setWorkflows(j.workflows ?? []);
    setActionsUrl(j.actionsUrl ?? "");
    setLoading(false);
  }, []);

  const loadRuns = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/admin/sync?view=runs", { cache: "no-store" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `HTTP ${r.status}`); return; }
    const j = await r.json();
    setRuns(j.runs ?? []);
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  async function action(file: string, kind: "dispatch" | "toggle") {
    setPending((p) => ({ ...p, [file]: kind }));
    const r = await fetch("/api/admin/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: kind === "dispatch" ? "dispatch" : "toggle-schedule", file }),
    });
    setPending((p) => ({ ...p, [file]: null }));
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Erro: ${j.error ?? r.statusText}`); return; }
    if (kind === "toggle") await loadWorkflows();
    if (kind === "dispatch") setTimeout(() => tab === "runs" && loadRuns(), 1500);
  }

  async function saveSchedule(file: string, intervalHours: number, windowMode: string) {
    setPending((p) => ({ ...p, [file]: "set" }));
    const r = await fetch("/api/admin/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-schedule", file, intervalHours, windowMode }),
    });
    setPending((p) => ({ ...p, [file]: null }));
    if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Erro: ${j.error ?? r.statusText}`); return; }
    const j = await r.json();
    const wfName = editing?.name ?? file;
    setEditing(null);
    setFlash({ name: wfName, intervalHours, windowMode, nextRun: j.nextRun ?? null });
    await loadWorkflows();
  }

  if (loading) return <div className="p-6 text-center text-slate-400 text-sm">Carregando painel de sync…</div>;

  if (err && !workflows) {
    return (
      <div className="p-6 text-sm">
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-800">
          <div className="font-semibold mb-1">Não foi possível carregar o painel.</div>
          <div className=" text-[11px] mb-2">{err}</div>
          <div className="text-[11px] text-rose-700">
            Verifique se <code>GITHUB_TOKEN</code> está configurado e tem escopos <code>repo</code> + <code>actions:write</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-end flex-wrap gap-3 border-b border-slate-200 pb-2">
        {actionsUrl && (
          <a href={actionsUrl} target="_blank" rel="noreferrer"
             className="text-[11px] text-sky-700 hover:text-sky-900 hover:underline underline-offset-2">
            Abrir GitHub Actions ↗
          </a>
        )}
      </div>

      {false && tab === "workflows" && workflows?.map((wf) => {
        const t = KIND_TONE[wf.kind];
        const p = pending[wf.file];
        return (
          <div key={wf.file} className="bg-white border border-slate-200 rounded-xl overflow-hidden flex">
            <div className={`w-1 ${t.bar}`} />
            <div className="flex-1 p-4 flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`${t.icon} text-sm`}>{t.emoji}</span>
                  <h3 className="font-semibold text-slate-900 text-sm">{wf.name}</h3>
                  <StatusBadge status={wf.status} />
                </div>
                <p className="text-xs text-slate-500">{wf.description}</p>
                <p className="text-[10px] text-slate-400  mt-1">{wf.file}</p>
              </div>

              <div className="flex flex-col gap-1 min-w-[180px]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Agenda (BRT)</div>
                {wf.slots.length === 0 ? (
                  <div className="text-xs text-slate-400 italic">Manual apenas</div>
                ) : wf.slots.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className=" font-bold text-slate-900 tabular-nums">{s.time}</span>
                    <span className="text-slate-500">· {s.day}</span>
                  </div>
                ))}
                {wf.nextRun && (
                  <div className="mt-1 pt-1 border-t border-slate-100 text-[10px]">
                    <div className="text-slate-500 font-semibold uppercase tracking-wider">Próximo disparo</div>
                    <div className="text-slate-900 font-medium">{wf.nextRun.absolute}</div>
                    <div className="text-emerald-700 font-semibold">{wf.nextRun.relative}</div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => action(wf.file, "dispatch")} disabled={!!p}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-50">
                  {p === "dispatch" ? "…" : "▶ Rodar agora"}
                </button>
                <button onClick={() => setEditing(wf)} disabled={!!p}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 transition disabled:opacity-50">
                  ⏱ Editar agenda
                </button>
                {wf.status !== "sem_schedule" && (
                  <button onClick={() => action(wf.file, "toggle")} disabled={!!p}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold border transition disabled:opacity-50 ${
                      wf.status === "ativo"
                        ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}>
                    {p === "toggle" ? "…" : wf.status === "ativo" ? "🔕 Desativar" : "🔔 Ativar"}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <RunsTable runs={runs} err={err} onReload={loadRuns} />

      {editing && (
        <EditScheduleModal
          wf={editing}
          onClose={() => setEditing(null)}
          onSave={(intervalHours, windowMode) => saveSchedule(editing.file, intervalHours, windowMode)}
        />
      )}

      {flash && (
        <SaveConfirmModal flash={flash} onClose={() => setFlash(null)} />
      )}
    </div>
  );
}

function SaveConfirmModal({
  flash, onClose,
}: {
  flash: { name: string; intervalHours: number; windowMode: string; nextRun: NextRun };
  onClose: () => void;
}) {
  const windowLabel: Record<string, string> = {
    "24/7":             "24/7 — todos os dias",
    "weekdays-6-20":    "Seg–Sex, 06:00–20:00",
    "weekdays-6-18":    "Seg–Sex, 06:00–18:00",
    "weekdays-7-19":    "Seg–Sex, 07:00–19:00",
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-6 h-6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Agenda salva</h3>
            <p className="text-xs text-slate-500">Workflow <strong>{flash.name}</strong> atualizado no GitHub.</p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
          <Row label="Frequência" value={`A cada ${flash.intervalHours} hora${flash.intervalHours !== 1 ? "s" : ""}`} />
          <Row label="Janela" value={windowLabel[flash.windowMode] ?? flash.windowMode} />
          {flash.nextRun && (
            <>
              <div className="border-t border-slate-200 my-2" />
              <Row label="Próximo disparo" value={flash.nextRun.absolute} strong />
              <div className="text-[11px] text-emerald-700 font-semibold pl-[96px]">{flash.nextRun.relative}</div>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-500 font-medium w-[88px] shrink-0">{label}:</span>
      <span className={strong ? "text-slate-900 font-semibold" : "text-slate-700"}>{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
        active ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"
      }`}>{children}</button>
  );
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  if (status === "ativo") return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">AGENDADO</span>;
  if (status === "desativado") return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800">DESATIVADO</span>;
  return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600">SEM AGENDA</span>;
}

// ─── RUNS TAB ─────────────────────────────────────────────────────────────
function RunsTable({ runs, err, onReload }: { runs: Run[] | null; err: string | null; onReload: () => void }) {
  if (err) return <div className="text-xs text-rose-700 p-3 bg-rose-50 rounded-md">{err}</div>;
  if (!runs) return <div className="p-4 text-center text-slate-400 text-sm">Carregando runs…</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50/60">
        <div className="text-xs font-semibold text-slate-700">Últimos 25 runs</div>
        <button onClick={onReload} className="text-[11px] text-sky-700 hover:underline">🔄 Atualizar</button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50/40">
            <th className="px-4 py-2 font-semibold">Workflow</th>
            <th className="px-3 py-2 font-semibold">Evento</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Iniciado</th>
            <th className="px-3 py-2 font-semibold text-right pr-4">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {runs.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">Nenhum run.</td></tr>
          )}
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-2 font-medium text-slate-900">
                {r.workflow_name}
                <div className="text-[10px] text-slate-400 ">#{r.run_number}</div>
              </td>
              <td className="px-3 py-2 text-slate-600 ">{r.event}</td>
              <td className="px-3 py-2"><RunStatus r={r} /></td>
              <td className="px-3 py-2 text-slate-500 text-[11px] tabular-nums">
                {new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="px-3 py-2 text-right pr-4">
                <a href={r.html_url} target="_blank" rel="noreferrer"
                   className="text-[11px] text-sky-700 hover:text-sky-900 hover:underline">abrir ↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunStatus({ r }: { r: Run }) {
  if (r.status === "completed") {
    if (r.conclusion === "success") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">✓ sucesso</span>;
    if (r.conclusion === "failure") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-800">✗ falhou</span>;
    if (r.conclusion === "cancelled") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700">cancelado</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700">{r.conclusion ?? "—"}</span>;
  }
  if (r.status === "in_progress") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />rodando</span>;
  if (r.status === "queued") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">na fila</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700">{r.status}</span>;
}

// ─── EDIT SCHEDULE MODAL ──────────────────────────────────────────────────
function EditScheduleModal({
  wf, onClose, onSave,
}: {
  wf: Workflow;
  onClose: () => void;
  onSave: (intervalHours: number, windowMode: string) => void;
}) {
  const [intervalHours, setIntervalHours] = useState<number>(3);
  const [windowMode, setWindowMode] = useState<string>("24/7");

  // Preview dos horários
  const preview = (() => {
    const hours: number[] = [];
    let start = 0, end = 23;
    if (windowMode === "weekdays-6-20") { start = 6; end = 20; }
    else if (windowMode === "weekdays-6-18") { start = 6; end = 18; }
    else if (windowMode === "weekdays-7-19") { start = 7; end = 19; }
    for (let h = start; h <= end; h += intervalHours) hours.push(h);
    return hours.map(h => String(h).padStart(2, "0") + ":00");
  })();

  const windowLabel: Record<string, string> = {
    "24/7":             "24/7 — todos os dias, a toda hora",
    "weekdays-6-20":    "Seg–Sex, 06:00–20:00 (horário comercial)",
    "weekdays-6-18":    "Seg–Sex, 06:00–18:00",
    "weekdays-7-19":    "Seg–Sex, 07:00–19:00",
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Editar agenda — {wf.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">O sistema reescreve o bloco <code>schedule:</code> do workflow no GitHub.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">A cada quantas horas?</label>
          <div className="flex flex-wrap gap-1">
            {[1,2,3,4,6,8,12].map(h => (
              <button key={h} type="button" onClick={() => setIntervalHours(h)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  intervalHours === h ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}>{h}h</button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Janela</label>
          <div className="space-y-1">
            {Object.entries(windowLabel).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setWindowMode(k)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition border ${
                  windowMode === k ? "bg-sky-50 border-sky-300 text-sky-900" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Preview dos horários (BRT)</div>
          <div className="flex flex-wrap gap-1">
            {preview.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px]  font-bold text-slate-900 tabular-nums">{t}</span>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 mt-2">{preview.length} disparo(s) por dia em dias válidos.</div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition">Cancelar</button>
          <button onClick={() => onSave(intervalHours, windowMode)}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md shadow-sm transition">
            Salvar agenda
          </button>
        </div>
      </div>
    </div>
  );
}
