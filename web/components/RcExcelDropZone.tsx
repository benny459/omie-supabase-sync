"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { supaBrowser } from "@/lib/supabase";

type ParsedItem = {
  descricao: string;
  quantidade: number | null;
  custoUnit: number | null;
};

type ParseResult = {
  rcNumero: number | null;
  fileName: string;
  items: ParsedItem[];
};

/**
 * Drop zone de XLSX no footer de um bucket PV/OS.
 * Arrasta o arquivo → parseia linhas (col B desc, C qtd, D custo unit) →
 * extrai número da RC do nome (ex: "RC7777.xlsx" → 7777) → mostra prévia →
 * ao confirmar: cria N rows em approvals + uploada o arquivo no Storage
 * (bucket rc-files), linkando o path em custom_fields.rc_attachment_path.
 */
export default function RcExcelDropZone({
  empresa,
  pv_os_label,
  modulo,
}: {
  empresa: string;
  pv_os_label: string | null;
  modulo: string;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setMsg(null);
    setFile(f);
    // Extrai RC número do nome: "RC7777.xlsx" → 7777. Case-insensitive.
    const match = f.name.match(/RC\s*(\d+)/i);
    const rcNumero = match ? Number(match[1]) : null;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const ab = ev.target?.result as ArrayBuffer;
        const wb = XLSX.read(ab, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });

        // Detecta linha de cabeçalho: procura "Descrição" ou "Produto" nas primeiras 5 linhas
        let headerIdx = -1;
        for (let i = 0; i < Math.min(aoa.length, 5); i++) {
          const row = aoa[i];
          if (!row) continue;
          const joined = row.slice(0, 9).map(v => String(v ?? "").toLowerCase()).join("|");
          if (joined.includes("descrição") || joined.includes("descricao") || joined.includes("produto")) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx < 0) headerIdx = 2; // fallback: assume linha 3 (idx 2)

        // Parseia float BR ou US. Retorna null se não conseguir (ex: "Quantidade", "Preço Unitário")
        const parseNum = (v: unknown): number | null => {
          if (v == null || v === "") return null;
          if (typeof v === "number") return Number.isFinite(v) ? v : null;
          const s = String(v).trim().replace(/\./g, "").replace(",", ".");
          const n = Number(s);
          return Number.isFinite(n) ? n : null;
        };

        const items: ParsedItem[] = [];
        for (let i = headerIdx + 1; i < aoa.length; i++) {
          const row = aoa[i];
          if (!row) continue;
          const descricao = String(row[1] ?? "").trim();
          if (!descricao) continue;
          const q = parseNum(row[2]);
          const h = parseNum(row[3]);
          // Só vira item se qtd OU custo é um número válido — previne que linhas de
          // subtotal/header/texto livre entrem como RC com NaN
          if (q == null && h == null) continue;
          items.push({ descricao, quantidade: q, custoUnit: h });
        }

        setParsed({ rcNumero, fileName: f.name, items });
      } catch (e) {
        setMsg({ kind: "err", text: `Falha ao ler XLSX: ${e instanceof Error ? e.message : String(e)}` });
        setParsed(null);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function apply() {
    if (!parsed || !file || !pv_os_label) return;
    if (parsed.items.length === 0) { setMsg({ kind: "err", text: "Nenhuma linha identificada" }); return; }
    setBusy(true); setMsg(null);
    const supa = supaBrowser();

    // 1) Upload do arquivo
    const path = `${empresa}/${pv_os_label}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supa.storage.from("rc-files").upload(path, file, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) { setBusy(false); setMsg({ kind: "err", text: `Upload: ${upErr.message}` }); return; }

    // 2) Busca rows EXISTENTES em branco no mesmo PV/OS — serão preenchidas primeiro
    //    (evita desperdiçar placeholders criados antes via "Nova linha")
    const { data: blanks } = await supa
      .from("approvals")
      .select("ncod_ped")
      .eq("empresa", empresa).eq("pv_os_label", pv_os_label)
      .is("rc_numero", null).is("rc_descricao", null).is("rc_custo", null)
      .order("ncod_ped", { ascending: false });

    const blankNcods = (blanks ?? []).map((r) => Number(r.ncod_ped));
    const nBlanks = Math.min(blankNcods.length, parsed.items.length);

    // 3) UPDATE nas rows em branco
    const updateResults = await Promise.all(
      Array.from({ length: nBlanks }, async (_, i) => {
        const it = parsed.items[i];
        const res = await supa.from("approvals").update({
          rc_numero: parsed.rcNumero,
          rc_descricao: it.descricao,
          rc_custo: it.custoUnit,
          custom_fields: {
            rc_attachment_path: path,
            rc_attachment_name: file.name,
            rc_qtd: it.quantidade,
          },
        }).eq("empresa", empresa).eq("ncod_ped", blankNcods[i]);
        return res;
      })
    );
    const updErrors = updateResults.filter((r) => r.error).map((r) => r.error!.message);

    // 4) Pega min ncod_ped global pra as rows faltantes
    const remaining = parsed.items.slice(nBlanks);
    let insErr: string | null = null;
    let nInserted = 0;
    if (remaining.length > 0) {
      const { data: minRows } = await supa
        .from("approvals").select("ncod_ped").order("ncod_ped", { ascending: true }).limit(1);
      let next = Math.min(minRows?.[0]?.ncod_ped ?? 0, -1) - 1;

      const rows = remaining.map((it) => {
        const row = {
          empresa, ncod_ped: next, modulo,
          source: "native", status: "PENDENTE", pv_os_label,
          rc_numero: parsed.rcNumero,
          rc_descricao: it.descricao,
          rc_custo: it.custoUnit,
          custom_fields: {
            rc_attachment_path: path,
            rc_attachment_name: file.name,
            rc_qtd: it.quantidade,
          },
        };
        next -= 1;
        return row;
      });
      const { error } = await supa.from("approvals").insert(rows);
      if (error) insErr = error.message;
      else nInserted = rows.length;
    }

    setBusy(false);
    if (insErr || updErrors.length > 0) {
      setMsg({ kind: "err", text: insErr || updErrors[0] });
      return;
    }
    const parts: string[] = [];
    if (nBlanks > 0)    parts.push(`${nBlanks} linha${nBlanks !== 1 ? "s" : ""} preenchida${nBlanks !== 1 ? "s" : ""}`);
    if (nInserted > 0)  parts.push(`${nInserted} nova${nInserted !== 1 ? "s" : ""} criada${nInserted !== 1 ? "s" : ""}`);
    setMsg({ kind: "ok", text: `✓ ${parts.join(" + ")}. Arquivo anexado.` });
    setTimeout(() => { setParsed(null); setFile(null); setMsg(null); router.refresh(); }, 1000);
  }


  if (!pv_os_label) return null;

  return (
    <div className="inline-block">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium cursor-pointer border transition ${
          drag
            ? "bg-emerald-100 border-emerald-500 text-emerald-900"
            : "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
        }`}
        title="Arraste um XLSX (ex: RC7777.xlsx) — sistema extrai os itens"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v13"/>
        </svg>
        Anexar RC (Excel)
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {parsed && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => { if (!busy) { setParsed(null); setFile(null); } }}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Prévia — {parsed.fileName}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  RC número: <strong>{parsed.rcNumero ?? "—"}</strong>
                  {parsed.rcNumero == null && (
                    <span className="text-rose-600"> (não detectado — renomeie o arquivo como RC####.xlsx)</span>
                  )}
                  {" · "}PV/OS: <strong>{pv_os_label}</strong>
                  {" · "}{parsed.items.length} item(s)
                </p>
              </div>
              <button onClick={() => { setParsed(null); setFile(null); }}
                className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 font-semibold text-right">Qtd</th>
                    <th className="px-3 py-2 font-semibold text-right">Custo Unit.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.items.map((it, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 text-slate-700">{it.descricao}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{it.quantidade ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {it.custoUnit != null ? it.custoUnit.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {msg && (
              <div className={`text-xs px-3 py-2 rounded-md border ${
                msg.kind === "ok"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-rose-50 text-rose-800 border-rose-200"
              }`}>{msg.text}</div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setParsed(null); setFile(null); }}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={apply}
                disabled={busy || parsed.items.length === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-sm disabled:opacity-40">
                {busy ? "Salvando…" : `Criar ${parsed.items.length} linha(s) + anexar`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
