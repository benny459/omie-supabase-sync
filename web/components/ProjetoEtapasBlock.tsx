"use client";

// Bloco de Etapas do Projeto — substituto da "Previsão de Serviços" no módulo
// /projetos (que não tem vínculo com app.waterworks).
// - Agente define etapas com data prevista (add/edit/delete inline)
// - Check ao concluir (data_conclusao)
// - Contador de alterações + histórico visual (popover)
// - Badge "-Xd" quando atrasada

import { useCallback, useEffect, useState } from "react";

type Etapa = {
  id: string;
  etapa: string;
  ordem: number;
  data_prevista: string | null;
  data_conclusao: string | null;
  alteracoes_count: number;
  historico: Array<{ data: string | null; at: string; por: string }>;
};

const fmtBR = (iso: string | null): string => {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const daysDiff = (iso: string): number | null => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.floor((today - target) / 86400000);
};

export default function ProjetoEtapasBlock({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  const [rows, setRows] = useState<Etapa[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [openHist, setOpenHist] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/projeto-etapas?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`);
    const j = await r.json();
    if (r.ok) setRows(j.rows ?? []);
    setLoading(false);
  }, [empresa, codigoProjeto]);

  // Notifica outras páginas abertas (ex: /projetos com o dot/coluna Cronograma)
  // pra invalidar cache do summary. Fire-and-forget — se o browser não tiver
  // BroadcastChannel (Safari <15), degrada silenciosamente.
  const notifyCronogramaChanged = useCallback(() => {
    try {
      const ch = new BroadcastChannel("cronograma-updated");
      ch.postMessage({ empresa, codigoProjeto, at: Date.now() });
      ch.close();
    } catch { /* unsupported */ }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    const etapa = newLabel.trim();
    if (!etapa) return;
    setAdding(true);
    const r = await fetch("/api/projeto-etapas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa, codigo_projeto: codigoProjeto,
        etapa, data_prevista: newDate || null,
        ordem: rows.length + 1,
      }),
    });
    if (r.ok) {
      setNewLabel(""); setNewDate("");
      await load();
      notifyCronogramaChanged();
    } else {
      const j = await r.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? r.statusText}`);
    }
    setAdding(false);
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/projeto-etapas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { await load(); notifyCronogramaChanged(); }
    else {
      const j = await r.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? r.statusText}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remover esta etapa?")) return;
    const r = await fetch(`/api/projeto-etapas/${id}`, { method: "DELETE" });
    if (r.ok) { await load(); notifyCronogramaChanged(); }
    else {
      const j = await r.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? r.statusText}`);
    }
  }

  return (
    <div className="border border-ww-border rounded-lg bg-ww-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-ww-border bg-ww-bg flex items-center justify-between">
        <div>
          <span className="text-[13px] font-bold text-ww-text">🗓️ Etapas do Projeto</span>
          <span className="ml-2 text-[10px] text-ww-textMuted">
            {rows.filter(r => r.data_conclusao).length} / {rows.length} concluídas
          </span>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-[12px] text-ww-textMuted italic">Carregando…</div>
      ) : (
        <div className="divide-y divide-ww-border">
          {rows.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-ww-textMuted italic">
              Nenhuma etapa definida ainda. Adicione a primeira abaixo.
            </div>
          )}
          {rows.map((r) => {
            const concluida = !!r.data_conclusao;
            const atrasoDias = !concluida && r.data_prevista ? daysDiff(r.data_prevista) : null;
            const atrasada = atrasoDias != null && atrasoDias > 0;
            return (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 relative">
                {/* Check */}
                <input type="checkbox" checked={concluida}
                  onChange={(e) => patch(r.id, { data_conclusao: e.target.checked ? new Date().toISOString().slice(0, 10) : null })}
                  className="w-4 h-4 accent-emerald-600 cursor-pointer" />

                {/* Etapa (editable) */}
                <input type="text" defaultValue={r.etapa}
                  onBlur={(e) => { if (e.target.value.trim() !== r.etapa) patch(r.id, { etapa: e.target.value.trim() }); }}
                  className={`flex-1 min-w-0 text-[13px] bg-transparent border-0 border-b border-dashed border-ww-border focus:outline-none focus:border-ww-editLine px-1 ${concluida ? "line-through text-ww-textFaint" : "text-ww-text"}`} />

                {/* Data prevista (editable) */}
                <input type="date" defaultValue={r.data_prevista ?? ""}
                  onBlur={(e) => { const v = e.target.value || null; if (v !== r.data_prevista) patch(r.id, { data_prevista: v }); }}
                  disabled={concluida}
                  className="text-[11px] w-[120px] bg-transparent border-0 border-b border-dashed border-ww-border focus:outline-none focus:border-ww-editLine px-1 disabled:opacity-50" />

                {/* Badge atraso */}
                {atrasada && (
                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800">
                    -{atrasoDias}d
                  </span>
                )}

                {/* Contador alterações + popover histórico */}
                {r.alteracoes_count > 0 && (
                  <button type="button"
                    onClick={() => setOpenHist(openHist === r.id ? null : r.id)}
                    title={`Data alterada ${r.alteracoes_count}× — clique pra ver histórico`}
                    className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-300 hover:bg-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:border-violet-800">
                    ×{r.alteracoes_count}
                  </button>
                )}

                {/* Delete */}
                <button type="button" onClick={() => remove(r.id)}
                  title="Remover etapa"
                  className="text-[13px] text-ww-textFaint hover:text-rose-600 transition">
                  🗑️
                </button>

                {/* Popover histórico */}
                {openHist === r.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenHist(null)} />
                    <div className="absolute right-16 top-full mt-1 z-50 min-w-[260px] bg-ww-panel border border-ww-border rounded-md shadow-lg p-2"
                         onClick={(e) => e.stopPropagation()}>
                      <div className="text-[10px] font-bold uppercase text-ww-textMuted mb-1.5 px-1">
                        Histórico ({r.historico.length + 1} datas)
                      </div>
                      <ol className="space-y-1 max-h-[240px] overflow-y-auto">
                        <li className="flex items-start gap-2 px-1 py-1 rounded bg-emerald-50 dark:bg-emerald-950/30">
                          <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-200 text-emerald-800">ATUAL</span>
                          <div className="text-[11px] tabular-nums flex-1">{fmtBR(r.data_prevista)}</div>
                        </li>
                        {[...r.historico].reverse().map((h, idx) => (
                          <li key={idx} className="flex items-start gap-2 px-1 py-1 rounded">
                            <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-ww-border text-ww-textMuted">v-{idx + 1}</span>
                            <div className="flex-1 text-[11px]">
                              <div className="tabular-nums">{fmtBR(h.data)}</div>
                              <div className="text-[10px] text-ww-textMuted">{new Date(h.at).toLocaleDateString("pt-BR")} · {h.por}</div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add new */}
      <div className="p-3 border-t border-ww-border bg-ww-bg flex items-center gap-2">
        <input type="text" placeholder="Nome da etapa (ex: Kick-off, Aprovação PMO, Entrega…)"
          value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          className="flex-1 text-[12.5px] px-2 py-1 border border-ww-border rounded bg-ww-panel text-ww-text focus:outline-none focus:border-ww-editLine" />
        <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
          className="text-[12px] px-2 py-1 border border-ww-border rounded bg-ww-panel text-ww-text focus:outline-none focus:border-ww-editLine" />
        <button onClick={add} disabled={adding || !newLabel.trim()}
          className="px-3 py-1 text-[12px] font-semibold rounded border border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40">
          {adding ? "…" : "+ Adicionar"}
        </button>
      </div>
    </div>
  );
}
