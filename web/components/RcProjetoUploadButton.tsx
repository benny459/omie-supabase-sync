"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

/**
 * Upload de Lista RC pra Projetos. Cada aba do XLSX = 1 equipamento.
 * Cada linha (col B item, C qtd, D modelo) = 1 item.
 *
 * Diferenças vs RcExcelDropZone:
 *   - Sem custo unitário (controle só por quantidade + status)
 *   - Hierárquico (equipamento → itens) — aba vira agrupador
 *   - Vinculo a PC é feito DEPOIS no painel, item-por-item (não vem na planilha)
 */
type ParsedItem = {
  equipamento: string;
  item: string;
  qtd: number | null;
  modelo: string | null;
};

export default function RcProjetoUploadButton({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedItem[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function parseNum(v: unknown): number | null {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function handleFile(f: File) {
    setMsg(null);
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const ab = ev.target?.result as ArrayBuffer;
        const wb = XLSX.read(ab, { type: "array" });
        const all: ParsedItem[] = [];

        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });

          // Detecta linha de cabeçalho: procura "Item" + "Qtd" nas primeiras 12 linhas
          let headerIdx = -1;
          for (let i = 0; i < Math.min(aoa.length, 12); i++) {
            const row = aoa[i];
            if (!row) continue;
            const joined = row.slice(0, 8).map(v => String(v ?? "").toLowerCase()).join("|");
            if (joined.includes("item") && (joined.includes("qtd") || joined.includes("quantidade"))) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx < 0) continue; // aba sem header reconhecível — pula

          for (let i = headerIdx + 1; i < aoa.length; i++) {
            const row = aoa[i];
            if (!row) continue;
            // Col B (idx 1) = Item, C (idx 2) = Qtd, D (idx 3) = Modelo
            const item = String(row[1] ?? "").trim();
            if (!item) continue;
            const qtd = parseNum(row[2]);
            const modelo = row[3] != null ? String(row[3]).trim() || null : null;
            // Filtra linhas sem qtd E sem modelo — provável total/subtotal/texto solto
            if (qtd == null && !modelo) continue;
            all.push({ equipamento: sheetName.trim(), item, qtd, modelo });
          }
        }

        if (all.length === 0) {
          setMsg({ kind: "err", text: "Nenhum item válido encontrado. Verifique se cada aba tem cabeçalho 'Item / Qtd / Modelo'." });
          setParsed(null);
        } else {
          setParsed(all);
        }
      } catch (e) {
        setMsg({ kind: "err", text: `Falha ao ler XLSX: ${e instanceof Error ? e.message : String(e)}` });
        setParsed(null);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function apply() {
    if (!parsed || parsed.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/rc-projetos/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa,
          codigo_projeto: codigoProjeto,
          items: parsed,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg({ kind: "err", text: j.error ?? "Falha no upload" });
        return;
      }
      setMsg({ kind: "ok", text: `✓ ${j.total_processados} itens processados (de ${j.total_recebidos} recebidos)` });
      setTimeout(() => {
        setOpen(false); setParsed(null); setFileName(""); setMsg(null);
        router.refresh();
      }, 1200);
    } finally {
      setBusy(false);
    }
  }

  const grupos = parsed ? new Map<string, number>() : null;
  if (parsed && grupos) {
    for (const p of parsed) grupos.set(p.equipamento, (grupos.get(p.equipamento) ?? 0) + 1);
  }

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-violet-800 hover:text-violet-950 hover:bg-violet-100 border border-violet-300 transition">
        <span className="text-[13px] leading-none">📋</span>
        Lista RC (Projeto)
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => !busy && setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900 text-[15px]">Lista RC do Projeto</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cada <strong>aba</strong> = 1 equipamento. Colunas: <code className="bg-slate-100 px-1 rounded">B=Item</code>, <code className="bg-slate-100 px-1 rounded">C=Qtd</code>, <code className="bg-slate-100 px-1 rounded">D=Modelo</code>.
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Re-upload faz merge: itens novos entram, existentes atualizam, vínculo a PC é preservado.
                </p>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {!parsed && (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-300 hover:border-violet-400 rounded-lg py-12 text-center text-slate-600 hover:text-violet-700 transition">
                  <div className="text-3xl mb-2">📥</div>
                  <div className="text-sm font-medium">Clique pra selecionar o XLSX</div>
                  <div className="text-[11px] text-slate-400 mt-1">Lista SW_Proj319_REV0.xlsx, etc.</div>
                </button>
              )}

              {parsed && grupos && (
                <div className="space-y-3">
                  <div className="text-[11px] text-slate-500 font-mono">📄 {fileName}</div>
                  <div className="text-sm text-slate-700">
                    <strong>{parsed.length}</strong> itens em <strong>{grupos.size}</strong> equipamento{grupos.size !== 1 ? "s" : ""}:
                  </div>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto border border-slate-200 rounded-md p-2 bg-slate-50">
                    {[...grupos.entries()].map(([eq, n]) => (
                      <div key={eq} className="flex justify-between text-xs px-2 py-1">
                        <span className="font-medium text-slate-800">{eq}</span>
                        <span className="text-slate-500 font-mono">{n} {n === 1 ? "item" : "itens"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {msg && (
                <div className={`mt-3 text-xs rounded-md px-3 py-2 ${
                  msg.kind === "ok" ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                                    : "text-rose-700 bg-rose-50 border border-rose-200"
                }`}>{msg.text}</div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => !busy && setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md">Cancelar</button>
              {parsed && (
                <button onClick={apply} disabled={busy}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md shadow-sm disabled:opacity-40">
                  {busy ? "Enviando…" : `Subir ${parsed.length} itens`}
                </button>
              )}
            </div>
          </div>

          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>
      )}
    </>
  );
}
