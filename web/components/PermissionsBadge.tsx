"use client";

import { useState } from "react";
import { ROLE_LABELS, summarize, type Modulo } from "@/lib/permissions";
import { useUserPerms } from "./UserPermsProvider";

/**
 * Badge no topo de cada módulo mostrando o role e o que o usuário pode
 * editar/aprovar naquele módulo. Expandível para detalhe bloco a bloco.
 */
export default function PermissionsBadge({ modulo }: { modulo: Modulo }) {
  const user = useUserPerms();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const role = user.role;
  const meta = ROLE_LABELS[role];
  const summary = summarize(user, modulo);
  const editable = summary.blocks.filter(b => b.edit);
  const canApprove = summary.blocks.find(b => b.key === "aprovacao")?.approve;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition rounded-lg"
      >
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.tone}`}>
          {meta.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-700">
            {editable.length === 0 ? (
              <span className="text-slate-500">Somente leitura neste módulo.</span>
            ) : (
              <>
                <span className="text-slate-500">Você pode editar: </span>
                <span className="font-medium text-slate-900">
                  {editable.map(b => b.label).join(" · ")}
                </span>
                {canApprove && <span className="ml-2 text-emerald-700 font-medium">✓ pode aprovar</span>}
                {!canApprove && <span className="ml-2 text-slate-400">sem aprovação</span>}
              </>
            )}
          </div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-3 bg-slate-50/60">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {summary.blocks.map((b) => (
              <div key={b.key} className="text-[11px]">
                <div className="font-semibold text-slate-700 mb-0.5">{b.label}</div>
                <div className="flex flex-wrap gap-1">
                  <Tag on={b.edit} label="editar" />
                  {b.key === "aprovacao" && <Tag on={b.approve} label="aprovar" />}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-3">
            Default definido pelo role <strong>{meta.label}</strong>. Admin pode customizar overrides por bloco em Configurações.
          </p>
        </div>
      )}
    </div>
  );
}

function Tag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
      on ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500"
    }`}>
      {on ? "✓" : "✗"} {label}
    </span>
  );
}
