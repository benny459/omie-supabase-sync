"use client";

import { useState } from "react";

type Resp = {
  ok?: boolean;
  cached?: boolean;
  message?: string;
  pc_numero?: string;
  fornecedor?: string;
  valor_total?: number;
  etapa?: string;
  cnum_pedido?: string;
  error?: string;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function FetchOmieButton() {
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState("SF");
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!numero.trim()) return;
    setBusy(true); setResp(null);
    const r = await fetch("/api/admin/fetch-omie", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "pc", numero: numero.trim(), empresa }),
    });
    const j: Resp = await r.json().catch(() => ({ error: "Resposta inválida" }));
    setBusy(false);
    setResp(r.ok ? j : { error: j.error ?? r.statusText });
  }

  function close() {
    setOpen(false);
    setNumero("");
    setResp(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Busca um PC específico direto do Omie sem esperar o sync diário"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <path d="M21 21l-5-5"/>
        </svg>
        Buscar PC do Omie
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-ww-panel rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-ww-border"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text">Buscar PC específico do Omie</h3>
                <p className="text-xs text-ww-textMuted mt-0.5">
                  Pra usar quando o sync diário ainda não trouxe o PC e você precisa aprovar urgente.
                </p>
              </div>
              <button type="button" onClick={close} className="text-ww-textMuted hover:text-ww-text text-lg">×</button>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-ww-textMuted">Empresa</label>
              <div className="grid grid-cols-3 gap-2">
                {["SF", "CD", "WW"].map((e) => (
                  <button key={e} type="button" onClick={() => setEmpresa(e)}
                    className={`px-3 py-2 rounded-md text-[12px] font-bold border-2 transition ${
                      empresa === e
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-ww-textMuted">Número do PC</label>
              <input
                type="text" required autoFocus
                value={numero} onChange={(e) => setNumero(e.target.value)}
                placeholder="ex: 6620"
                className="w-full px-3 py-2 border border-ww-border bg-ww-bg rounded-md text-sm text-ww-text font-mono focus:outline-none focus:ring-2 focus:ring-ww-accent/40"
              />
              <p className="text-[10px] text-ww-textFaint">Sem prefixo. Só o número do PC do Omie.</p>
            </div>

            {resp?.error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                ❌ {resp.error}
              </div>
            )}

            {resp?.ok && (
              <div className={`text-xs ${resp.cached ? "text-amber-800 bg-amber-50 border-amber-200" : "text-emerald-800 bg-emerald-50 border-emerald-200"} border rounded-md px-3 py-2 space-y-1`}>
                <div className="font-semibold">{resp.cached ? "ℹ" : "✓"} {resp.message}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                  <span className="text-slate-500">PC #</span><span className="font-mono">{resp.pc_numero}</span>
                  <span className="text-slate-500">Fornecedor</span><span>{resp.fornecedor ?? "—"}</span>
                  <span className="text-slate-500">Valor</span><span className="font-mono">{fmtBRL(resp.valor_total)}</span>
                  <span className="text-slate-500">Etapa</span><span>{resp.etapa ?? "—"}</span>
                  {resp.cnum_pedido && (<><span className="text-slate-500">PV/OS</span><span className="font-mono">{resp.cnum_pedido}</span></>)}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={close} className="px-3 py-1.5 text-xs font-medium text-ww-textMuted hover:bg-ww-rowHover rounded-md transition">Fechar</button>
              <button type="submit" disabled={busy || !numero.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition disabled:opacity-40">
                {busy ? "Buscando…" : "Buscar"}
              </button>
            </div>

            <div className="border-t border-ww-border pt-2 text-[10px] text-ww-textFaint leading-relaxed">
              <strong className="text-ww-textMuted">Limites:</strong> 10 buscas/h por usuário ·
              cache de 5 min (se já foi buscado recentemente, retorna sem chamar Omie de novo) ·
              cada busca fica logada em <code>platform.fetch_omie_log</code> pra auditoria.
            </div>
          </form>
        </div>
      )}
    </>
  );
}
