"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";

/**
 * Botão "Colar do Excel" dentro de um PV/OS.
 * Abre textarea, aceita TSV (tab-separated) ou CSV.
 * Cada linha do paste vira uma approval.approvals nova com mesmo pv_os_label.
 * Ordem esperada das colunas: RC.Numero | RC.Descrição | RC.Custo | RC.Custo total
 */
export default function PasteRcButton({
  empresa,
  pv_os_label,
  modulo,
  existingNcodPeds,
}: {
  empresa: string;
  pv_os_label: string | null;
  modulo: string;
  existingNcodPeds: number[];
}) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [text, setText]     = useState("");
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState<string | null>(null);

  function parseNum(s: string): number | null {
    const t = s.trim();
    if (!t) return null;
    if (/^-?[\d.]+,\d+$/.test(t)) return Number(t.replace(/\./g, "").replace(",", ".")) || null;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  async function apply() {
    if (!pv_os_label) { setMsg("❌ Sem PV/OS"); return; }
    const lines = text.split(/\r?\n/).map(l => l.replace(/\t/g, "\t")).filter(l => l.trim());
    if (!lines.length) { setMsg("❌ Vazio"); return; }

    setBusy(true); setMsg("Processando…");
    const supa = supaBrowser();
    // .schema("approval") explicito — @supabase/ssr nao respeita db.schema global
    const approval = supa.schema("approval" as never);
    // Busca min global pra evitar PK collision com placeholders existentes
    const { data: minRows } = await approval.from("approvals")
      .select("ncod_ped").order("ncod_ped", { ascending: true }).limit(1);
    const minObj = minRows?.[0] as { ncod_ped: number } | undefined;
    let minNcod = Math.min(minObj?.ncod_ped ?? 0, -1);

    const rows = lines.map((line) => {
      const parts = line.split(/\t|;|,(?=\s|$)/);  // TSV primeiro, depois ; ou vírgula se não TSV
      // Se só tem 1 parte, tenta splitar por ponto e vírgula OU múltiplos espaços
      const cols = parts.length > 1 ? parts : line.split(/\s{2,}|;/);
      const [rc_numero_s, rc_descricao, rc_custo_s, rc_custo_total_s] = [
        cols[0] ?? "", cols[1] ?? "", cols[2] ?? "", cols[3] ?? "",
      ];
      minNcod -= 1;
      return {
        empresa,
        ncod_ped: minNcod,
        modulo,
        source: "native",
        status: "PENDENTE",
        pv_os_label,
        rc_numero:      parseNum(rc_numero_s),
        rc_descricao:   rc_descricao?.trim() || null,
        rc_custo:       parseNum(rc_custo_s),
        rc_custo_total: parseNum(rc_custo_total_s),
      };
    });

    const { error, data } = await approval.from("approvals").insert(rows).select();
    setBusy(false);
    if (error) { setMsg(`❌ ${error.message}`); return; }
    setMsg(`✅ ${data?.length ?? rows.length} linhas criadas.`);
    setTimeout(() => { setOpen(false); setText(""); setMsg(null); router.refresh(); }, 800);
  }

  if (!pv_os_label) return null;

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="text-[11px] text-amber-800 hover:text-amber-950 hover:bg-amber-50 rounded px-2 py-0.5 font-medium border border-amber-300"
        title="Cola do Excel: cada linha vira uma nova RC no PV/OS"
      >
        📋 Colar do Excel
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Colar Excel em <span className="">{pv_os_label}</span></h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cole do Excel (Ctrl+V). Ordem esperada das colunas:<br/>
                  <code className="text-[11px]">RC.Numero · RC.Descrição · RC.Custo · RC.Custo Total</code>
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-800">×</button>
            </div>

            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={`6431\tCurva longa 32mm PVC\t303,90\t303,90\n\tTE 32mm PVC\t\t\n\tVálvula esfera\t\t`}
              className="w-full p-3 text-xs  border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-amber-400"
            />

            {msg && <div className="text-xs text-slate-700">{msg}</div>}

            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-400">
                {text.split(/\r?\n/).filter(l => l.trim()).length} linha(s) detectada(s)
              </span>
              <div className="flex gap-2">
                <button onClick={() => { setText(""); setMsg(null); }}
                        className="px-3 py-1.5 text-xs rounded bg-slate-200 hover:bg-slate-300 text-slate-700">Limpar</button>
                <button onClick={apply} disabled={busy || !text.trim()}
                        className="px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40">
                  {busy ? "…" : "Criar linhas"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
