"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";

/**
 * Botão "+ Nova linha" no footer de um bucket (PV/OS ou Projeto).
 * Ao clicar, abre modal pra escolher:
 *   - Quantidade (1–50)
 *   - PV/OS (se o bucket tem múltiplos — caso de /projetos)
 * Cada row é criada em approval.approvals com ncod_ped negativo. A view
 * v_pc_completo captura esses placeholders via CTE manual_rc_rows.
 */
export default function AddRowButton({
  empresa,
  pv_os_label,
  modulo,
  pvOsOptions,
}: {
  empresa: string;
  /** Quando bucket é por PV/OS (avulsos), já vem o label certo. Null pra "Sem PV/OS". */
  pv_os_label: string | null;
  modulo: string;
  /** Lista de PV/OSs do bucket — usado em /projetos (bucket = projeto → vários PV/OS). */
  pvOsOptions?: string[];
  existingNcodPeds?: number[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [selectedPv, setSelectedPv] = useState<string>(pv_os_label ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Opções únicas de PV/OS do bucket (pra /projetos)
  const pvChoices = Array.from(new Set((pvOsOptions ?? []).filter(Boolean))).sort();
  const needsPvSelect = pvChoices.length > 1;

  useEffect(() => {
    if (open) {
      setSelectedPv(pv_os_label ?? (needsPvSelect ? "" : (pvChoices[0] ?? "")));
      setMsg(null); setErr(null);
    }
  }, [open, pv_os_label, needsPvSelect, pvChoices]);

  async function addRows() {
    const target = needsPvSelect ? selectedPv : (pv_os_label ?? pvChoices[0] ?? "");
    if (!target) { setErr("Escolha um PV/OS"); return; }
    const n = Math.max(1, Math.min(50, Math.floor(qty)));
    setBusy(true); setErr(null); setMsg(null);

    const supa = supaBrowser();
    // .schema("approval") explicito porque @supabase/ssr nao respeita db.schema
    // global de forma consistente — sem isso, .from("approvals") cai em
    // public.approvals (PGRST205) ou INSERT vai pra tabela errada silenciosamente.
    const approval = supa.schema("approval" as never);
    // Global min pra evitar colisão
    const { data: minRows, error: mErr } = await approval
      .from("approvals")
      .select("ncod_ped").order("ncod_ped", { ascending: true }).limit(1);
    if (mErr) { setErr(mErr.message); setBusy(false); return; }
    const minObj = minRows?.[0] as { ncod_ped: number } | undefined;
    const globalMin = minObj?.ncod_ped ?? 0;
    let next = Math.min(globalMin, -1) - 1;

    const rows = Array.from({ length: n }, () => {
      const row = {
        empresa, ncod_ped: next, modulo,
        source: "native", status: "PENDENTE", pv_os_label: target,
      };
      next -= 1;
      return row;
    });

    const { error } = await approval.from("approvals").insert(rows);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setMsg(`✓ ${n} linha${n !== 1 ? "s" : ""} adicionada${n !== 1 ? "s" : ""} em ${target}`);
    setTimeout(() => { setOpen(false); router.refresh(); }, 700);
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-amber-800 hover:text-amber-950 hover:bg-amber-100 border border-amber-300 transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Nova linha
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Adicionar linhas</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cria {qty > 1 ? `${qty} linhas` : "1 linha"} de RC em branco
                  {!needsPvSelect && pv_os_label && ` no ${pv_os_label}`}.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
            </div>

            {needsPvSelect && (
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">PV/OS</label>
                <select
                  value={selectedPv} onChange={(e) => setSelectedPv(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">— Escolha —</option>
                  {pvChoices.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">Quantidade</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={50}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  onKeyDown={(e) => { if (e.key === "Enter") addRows(); if (e.key === "Escape") setOpen(false); }}
                  className="w-20 px-3 py-2 border border-slate-300 rounded-md text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <div className="flex gap-1">
                  {[1, 3, 5, 10].map(n => (
                    <button key={n} type="button" onClick={() => setQty(n)}
                      className="px-2 py-1 text-[11px] font-medium border border-slate-200 rounded-md hover:bg-slate-50 text-slate-700">
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
            {msg && <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">{msg}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition">Cancelar</button>
              <button onClick={addRows} disabled={busy || (needsPvSelect && !selectedPv)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md shadow-sm transition disabled:opacity-40">
                {busy ? "Criando…" : `Criar ${qty > 1 ? `${qty} linhas` : "linha"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
