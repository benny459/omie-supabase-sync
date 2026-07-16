"use client";

// Popover pra marcar/desmarcar flags de escopo do projeto — "está por nossa
// conta?". 4 checkboxes booleanas persistidas em rc_projetos_budget:
//   • Frete incluso
//   • Faturamento Direto
//   • Despesas de Estadia
//   • Despesas de Deslocamento
// Marca visual no botão: mostra badge com quantas estão marcadas.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Escopo = {
  frete_incluso: boolean;
  faturamento_direto: boolean;
  despesas_estadia: boolean;
  despesas_deslocamento: boolean;
};

const LABELS: Array<{ key: keyof Escopo; label: string; hint: string; icon: string }> = [
  { key: "frete_incluso",         label: "Frete incluso",           hint: "Se marcado, o frete corre por nossa conta", icon: "🚚" },
  { key: "faturamento_direto",    label: "Faturamento Direto",      hint: "Se marcado, o cliente é faturado direto (sem intermediário)", icon: "💸" },
  { key: "despesas_estadia",      label: "Despesas de Estadia",     hint: "Se marcado, estadia/hospedagem por nossa conta", icon: "🏨" },
  { key: "despesas_deslocamento", label: "Despesas de Deslocamento", hint: "Se marcado, deslocamento/transporte por nossa conta", icon: "✈️" },
];

const DEFAULT_ESCOPO: Escopo = {
  frete_incluso: false, faturamento_direto: false, despesas_estadia: false, despesas_deslocamento: false,
};

export default function ProjetoEscopoButton({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  const [open, setOpen] = useState(false);
  const [escopo, setEscopo] = useState<Escopo>(DEFAULT_ESCOPO);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<keyof Escopo | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Posição do popover (em viewport). Recalcula ao abrir e em resize.
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPopPos({ top: rect.bottom + 4, left: rect.left });
    const onResize = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPopPos({ top: r.bottom + 4, left: r.left });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/rc-projetos/escopo?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`);
      if (r.ok) {
        const j = await r.json();
        setEscopo({ ...DEFAULT_ESCOPO, ...(j.escopo ?? {}) });
      }
    } finally { setLoading(false); }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void load(); }, [load]);

  // Fecha ao clicar fora — precisa checar o portal também
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function toggle(key: keyof Escopo) {
    const next = { ...escopo, [key]: !escopo[key] };
    setEscopo(next); // optimistic
    setSaving(key);
    try {
      const r = await fetch("/api/rc-projetos/escopo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, [key]: next[key] }),
      });
      if (!r.ok) {
        setEscopo(escopo); // reverte
        const j = await r.json().catch(() => ({}));
        alert(`Erro: ${j.error ?? r.statusText}`);
      }
    } finally { setSaving(null); }
  }

  const marcadas = LABELS.filter((l) => escopo[l.key]).length;

  const popover = open && popPos && typeof document !== "undefined"
    ? createPortal(
        <div ref={popRef}
          style={{ top: popPos.top, left: popPos.left }}
          className="fixed z-[60] min-w-[280px] max-w-[320px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl p-2"
          onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] uppercase tracking-[0.5px] font-bold text-slate-500 dark:text-slate-400 px-1 pb-1 border-b border-slate-100 dark:border-slate-800 mb-1">
            Por nossa conta neste projeto?
          </div>
          {loading ? (
            <div className="p-2 text-[11px] text-slate-500 italic">Carregando…</div>
          ) : (
            <ul className="space-y-0.5">
              {LABELS.map((l) => {
                const on = escopo[l.key];
                const isSaving = saving === l.key;
                return (
                  <li key={l.key}>
                    <label className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 ${isSaving ? "opacity-50" : ""}`}
                      title={l.hint}>
                      <input type="checkbox" checked={on} disabled={isSaving}
                        onChange={() => toggle(l.key)}
                        className="mt-0.5 w-4 h-4 accent-sky-600 cursor-pointer" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                          <span className="text-[13px]">{l.icon}</span>
                          {l.label}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{l.hint}</div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-2 pt-1 mt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
            Salva automaticamente ao marcar.
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className="inline-block" onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} onClick={() => setOpen((v) => !v)}
        title="Escopo do projeto — o que corre por nossa conta"
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition ${
          marcadas > 0
            ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50"
            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}>
        ⚙ <span>Escopo</span>
        {marcadas > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[10px] font-bold bg-sky-600 text-white">
            {marcadas}
          </span>
        )}
      </button>
      {popover}
    </div>
  );
}
