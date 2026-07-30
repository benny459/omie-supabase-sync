"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";

type PcLookup = { empresa: string; ncod_ped: number; cnumero: string };
type LineStatus = {
  input: string;
  found?: PcLookup;
  created?: boolean;
  error?: string;
};

/**
 * Botão "+ Adicionar PC" em /pcs.
 * Aceita 1+ números de PC (separados por vírgula, espaço, tab ou nova linha).
 * Para cada: busca em orders.pedidos_compra; se achar, cria row em approval.approvals
 * (modulo='pcs', status='PENDENTE'), o que faz o PC aparecer em v_pc_pcs com todos
 * os dados do Omie via a view enriched.
 */
export default function AddPcByNumberButton() {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [text, setText]       = useState("");
  const [empresa, setEmpresa] = useState<"SF" | "CD" | "WW">("SF");
  const [busy, setBusy]       = useState(false);
  const [results, setResults] = useState<LineStatus[] | null>(null);

  function parseNumbers(raw: string): string[] {
    return raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  }

  async function apply() {
    const nums = parseNumbers(text);
    if (!nums.length) return;
    setBusy(true);
    setResults(nums.map(n => ({ input: n })));

    const supa = supaBrowser();

    // Busca lookups em paralelo
    const lookups = await Promise.all(nums.map(async (n) => {
      const { data } = await supa.schema("orders" as never)
        .from("pedidos_compra")
        .select("empresa, ncod_ped, cnumero")
        .eq("empresa", empresa)
        .eq("cnumero", n)
        .limit(1)
        .maybeSingle();
      return { input: n, found: data as PcLookup | null };
    }));

    const next: LineStatus[] = [];
    for (const { input, found } of lookups) {
      if (!found) {
        next.push({ input, error: "Não encontrado no Omie" });
        continue;
      }
      const { error } = await supa.from("approvals").upsert({
        empresa: found.empresa,
        ncod_ped: found.ncod_ped,
        modulo: "pcs",
        source: "native",
        status: "PENDENTE",
      }, { onConflict: "empresa,ncod_ped" });
      if (error) {
        next.push({ input, found, error: error.message });
      } else {
        next.push({ input, found, created: true });
      }
    }

    setResults(next);
    setBusy(false);
    const anyCreated = next.some(r => r.created);
    if (anyCreated) {
      setTimeout(() => { router.refresh(); }, 400);
    }
  }

  function close() {
    setOpen(false);
    setText("");
    setResults(null);
  }

  const count = parseNumbers(text).length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Adicionar PC
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
          <div className="bg-ww-panel rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text">Adicionar PCs ao módulo Standalone</h3>
                <p className="text-xs text-ww-textMuted mt-0.5">
                  Insira um ou mais números de PC. Sistema busca os dados no Omie automaticamente.
                </p>
              </div>
              <button onClick={close} className="text-ww-textFaint hover:text-ww-text text-lg leading-none">×</button>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-ww-textMuted">Empresa:</label>
              <div className="flex gap-1 bg-ww-bg p-0.5 rounded-lg">
                {(["SF","CD","WW"] as const).map(e => (
                  <button
                    key={e}
                    onClick={() => setEmpresa(e)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                      empresa === e ? "bg-ww-panel shadow-sm text-ww-text" : "text-ww-textMuted hover:text-ww-text"
                    }`}
                  >{e}</button>
                ))}
              </div>
            </div>

            <div>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder={"4348\n4360\n4372"}
                disabled={busy}
                className="w-full p-3 text-sm  border border-ww-border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
              />
              <div className="flex justify-between text-[11px] text-ww-textMuted mt-1">
                <span>Separe por linha, vírgula, espaço ou tab.</span>
                <span className="tabular-nums">{count} número(s)</span>
              </div>
            </div>

            {results && (
              <div className="max-h-[200px] overflow-y-auto border border-ww-border rounded-lg bg-ww-rowHover">
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-1.5 text-xs border-b border-ww-border last:border-0 ${
                    r.created ? "bg-emerald-50" : r.error ? "bg-rose-50" : ""
                  }`}>
                    <span className=" text-ww-textMuted">{r.input}</span>
                    {r.created && (
                      <span className="text-emerald-700 font-medium">
                        ✓ Adicionado (ncod {r.found?.ncod_ped})
                      </span>
                    )}
                    {r.error && <span className="text-rose-700 font-medium">✗ {r.error}</span>}
                    {!r.created && !r.error && <span className="text-ww-textFaint">…</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={close}
                className="px-3 py-1.5 text-xs font-medium text-ww-textMuted hover:text-ww-text hover:bg-ww-bg rounded-md transition"
              >
                Fechar
              </button>
              <button
                onClick={apply}
                disabled={busy || count === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Processando…" : `Adicionar ${count > 0 ? count : ""}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
