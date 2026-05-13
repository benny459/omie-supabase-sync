"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";
import { useUserPerms } from "./UserPermsProvider";
import { canEdit } from "@/lib/permissions";

type PendingRow = {
  id: string;           // uuid local
  pc_numero: string;
  status: "idle" | "searching" | "found" | "not-found" | "saving" | "done" | "error";
  foundPc?: { ncod_ped: number; cnumero: string };
  errorMsg?: string;
};

function uid() { return Math.random().toString(36).slice(2, 10); }

/**
 * Bloco no topo de /pcs: botão "+ Adicionar PC" abre uma área com linhas em
 * branco. Usuário digita o número do PC, sistema busca em orders.pedidos_compra
 * e cria uma row em approval.approvals com modulo='pcs'. A tabela principal
 * recarrega e mostra os dados completos do Omie para aquele PC.
 */
export default function PcInlineAdd({ empresa = "SF" }: { empresa?: "SF" | "CD" | "WW" }) {
  const router = useRouter();
  const user = useUserPerms();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [selEmpresa, setSelEmpresa] = useState<"SF" | "CD" | "WW">(empresa);

  // Só mostra pra quem pode editar PC no módulo /pcs
  if (!canEdit(user, "pcs", "pc")) return null;

  function addBlank() {
    setRows((rs) => [...rs, { id: uid(), pc_numero: "", status: "idle" }]);
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function setPcNumero(id: string, v: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, pc_numero: v, status: "idle", errorMsg: undefined } : r));
  }

  async function commit(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const num = row.pc_numero.trim();
    if (!num) return;

    // Etapa 1: busca via API route server-side (orders schema não é exposto ao browser)
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "searching" } : r));
    const lookupRes = await fetch("/api/admin/pc-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa: selEmpresa, cnumero: num }),
    });
    const lookupJson = await lookupRes.json().catch(() => ({} as Record<string, unknown>));
    if (!lookupRes.ok) {
      const msg = typeof lookupJson.error === "string" ? lookupJson.error : `HTTP ${lookupRes.status}`;
      setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "error", errorMsg: msg } : r));
      return;
    }
    if (!lookupJson.found) {
      setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "not-found", errorMsg: "PC não encontrado no Omie" } : r));
      return;
    }

    const pc = { empresa: String(lookupJson.empresa), ncod_ped: Number(lookupJson.ncod_ped), cnumero: num };

    // Etapa 2: upsert em approvals (essa ainda usa client — RLS já autoriza admin)
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "saving", foundPc: { ncod_ped: pc.ncod_ped, cnumero: pc.cnumero } } : r));
    const supa = supaBrowser();
    const { error: uErr } = await supa.schema("approval" as never).from("approvals").upsert({
      empresa: pc.empresa,
      ncod_ped: pc.ncod_ped,
      modulo: "pcs",
      source: "native",
      status: "PENDENTE",
    }, { onConflict: "empresa,ncod_ped" });

    if (uErr) {
      setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "error", errorMsg: uErr.message } : r));
      return;
    }

    setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "done" } : r));
    // Remove do estado e refresh
    setTimeout(() => {
      setRows((rs) => rs.filter((r) => r.id !== id));
      router.refresh();
    }, 700);
  }

  const hasRows = rows.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={addBlank}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Adicionar PC
          </button>
          {hasRows && (
            <span className="text-[11px] text-slate-500">Digite o número e pressione <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] ">Enter</kbd> — o sistema busca no Omie.</span>
          )}
        </div>
        {hasRows && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-slate-500">Empresa:</label>
            <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-md">
              {(["SF","CD","WW"] as const).map(e => (
                <button
                  key={e}
                  onClick={() => setSelEmpresa(e)}
                  className={`px-2 py-0.5 text-[11px] font-semibold rounded-sm transition ${
                    selEmpresa === e ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"
                  }`}
                >{e}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasRows && (
        <div className="bg-white border border-amber-200 rounded-lg shadow-sm overflow-hidden">
          {rows.map((r) => (
            <PendingInputRow
              key={r.id}
              row={r}
              onChange={(v) => setPcNumero(r.id, v)}
              onCommit={() => commit(r.id)}
              onRemove={() => removeRow(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingInputRow({
  row, onChange, onCommit, onRemove,
}: {
  row: PendingRow;
  onChange: (v: string) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const statusColor = {
    idle:        "text-slate-400",
    searching:   "text-sky-600",
    saving:      "text-sky-600",
    found:       "text-emerald-600",
    done:        "text-emerald-700",
    "not-found": "text-rose-600",
    error:       "text-rose-700",
  }[row.status];

  const statusLabel = {
    idle:        "Aguardando…",
    searching:   "Buscando no Omie…",
    saving:      "Adicionando…",
    found:       "Encontrado",
    done:        "✓ Adicionado",
    "not-found": "Não encontrado",
    error:       row.errorMsg ?? "Erro",
  }[row.status];

  const isBusy = row.status === "searching" || row.status === "saving";
  const isDone = row.status === "done";

  return (
    <div className={`flex items-center gap-3 px-3 py-2 border-b border-amber-100 last:border-b-0 transition ${
      isDone ? "bg-emerald-50" : "hover:bg-amber-50/30"
    }`}>
      <div className="w-[200px]">
        <input
          autoFocus
          disabled={isBusy || isDone}
          value={row.pc_numero}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onRemove();
          }}
          onBlur={() => { if (row.pc_numero.trim() && row.status === "idle") onCommit(); }}
          placeholder="Número do PC (ex: 4348)"
          className="w-full px-3 py-1.5 text-sm  border border-amber-300 rounded-md bg-yellow-50 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
        />
      </div>
      <div className={`flex-1 text-xs font-medium ${statusColor}`}>
        {isBusy && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 inline-block animate-spin mr-1" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.2-8.55"/>
          </svg>
        )}
        {statusLabel}
      </div>
      <button
        onClick={onRemove}
        disabled={isBusy}
        className="text-slate-400 hover:text-rose-600 transition p-1 disabled:opacity-30"
        title="Remover linha"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  );
}
