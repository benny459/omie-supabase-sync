"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supaBrowser } from "@/lib/supabase";

type ParsedRow = {
  _row: number;
  pc_num?: string;
  rc_numero?: number;
  rc_descricao?: string;
  rc_custo?: number;
  rc_custo_total?: number;
};

// Sinônimos pra auto-detectar colunas
const ALIASES: Record<keyof Omit<ParsedRow, "_row">, string[]> = {
  pc_num:         ["pc", "pc.numero", "pc numero", "pc #", "numero do pc"],
  rc_numero:      ["rc", "rc.numero", "rc numero", "rc #", "numero da rc", "rc.número"],
  rc_descricao:   ["rc.descrição", "rc descricao", "descrição", "descricao", "descrição do produto"],
  rc_custo:       ["rc.custo", "custo unitário", "preço unitário de venda", "preço unitário", "custo"],
  rc_custo_total: ["rc.custo total", "custo total", "valor total", "valor total do item"],
};

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/^-?[\d.]+,\d+$/.test(s))       return Number(s.replace(/\./g, "").replace(",", ".")) || null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function RcExcelImport({ empresa = "SF" }: { empresa?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]         = useState(false);
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [detected, setDetected] = useState<Record<string, string>>({});
  const [status, setStatus]     = useState<string>("");
  const [busy, setBusy]         = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setStatus("Lendo arquivo…");

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    // Detecta a linha header (aquela com mais matches de alias)
    let bestIdx = 0, bestHits = 0, bestMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(10, raw.length); i++) {
      const row = raw[i] ?? [];
      const map: Record<string, number> = {};
      for (let c = 0; c < row.length; c++) {
        const label = norm(row[c]);
        if (!label) continue;
        for (const [key, aliases] of Object.entries(ALIASES)) {
          if (aliases.some(a => label === a || label.includes(a))) {
            if (!(key in map)) map[key] = c;
            break;
          }
        }
      }
      const hits = Object.keys(map).length;
      if (hits > bestHits) { bestIdx = i; bestHits = hits; bestMap = map; }
    }

    if (bestHits < 2) {
      setStatus(`❌ Não reconheci o header. Encontrei ${bestHits} colunas, preciso de pelo menos 2.`);
      setRows([]); setDetected({});
      setBusy(false); return;
    }

    const detectedView: Record<string, string> = {};
    for (const [k, v] of Object.entries(bestMap)) detectedView[k] = `col${v}`;
    setDetected(detectedView);

    const parsed: ParsedRow[] = [];
    for (let i = bestIdx + 1; i < raw.length; i++) {
      const row = raw[i] ?? [];
      const rec: ParsedRow = { _row: i + 1 };
      for (const [key, col] of Object.entries(bestMap)) {
        const v = row[col];
        if (key === "pc_num")         rec.pc_num = v != null ? String(v).trim() : undefined;
        else if (key === "rc_descricao") rec.rc_descricao = v != null ? String(v) : undefined;
        else (rec as Record<string, unknown>)[key] = parseNum(v) ?? undefined;
      }
      if (Object.keys(rec).length > 1) parsed.push(rec);
    }
    setRows(parsed);
    setStatus(`Linha header: r${bestIdx + 1} · ${bestHits} colunas reconhecidas · ${parsed.length} linhas de dados`);
    setBusy(false);
  }

  async function applyImport() {
    if (!rows.length) return;
    if (!rows.some(r => r.pc_num)) {
      setStatus("❌ A planilha precisa de coluna PC.Numero pra casar com aprovações.");
      return;
    }
    setBusy(true); setStatus("Buscando ncod_ped dos PCs…");
    const supa = supaBrowser();

    // Pega ncod_ped dos PCs pelo cnumero
    const pcNums = [...new Set(rows.map(r => String(r.pc_num || "").trim()).filter(Boolean))];
    const map: Record<string, number> = {};
    for (let i = 0; i < pcNums.length; i += 200) {
      const batch = pcNums.slice(i, i + 200);
      const { data } = await supa
        .schema("orders" as never)   // ⚠️ requer GRANT no schema orders (já fizemos p/ service_role; p/ anon só quem está logado ok)
        .from("pedidos_compra")
        .select("cnumero,ncod_ped")
        .eq("empresa", empresa)
        .in("cnumero", batch)
        .returns<{ cnumero: string; ncod_ped: number }[]>();
      (data ?? []).forEach(r => {
        if (!(r.cnumero in map) || r.ncod_ped < map[r.cnumero]) map[r.cnumero] = r.ncod_ped;
      });
    }

    let ok = 0, skip = 0, fail = 0;
    for (const r of rows) {
      const pc = String(r.pc_num || "").trim();
      const ncod = map[pc];
      if (!ncod) { skip++; continue; }
      const patch: Record<string, unknown> = { empresa, ncod_ped: ncod, modulo: "avulsos" };
      if (r.rc_numero      != null) patch.rc_numero      = r.rc_numero;
      if (r.rc_descricao   != null) patch.rc_descricao   = r.rc_descricao;
      if (r.rc_custo       != null) patch.rc_custo       = r.rc_custo;
      if (r.rc_custo_total != null) patch.rc_custo_total = r.rc_custo_total;
      const { error } = await supa.schema("approval" as never).from("approvals").upsert(patch, { onConflict: "empresa,ncod_ped" });
      if (error) fail++; else ok++;
    }

    setStatus(`✅ ${ok} aplicados · ⏭ ${skip} sem match em Omie · ${fail ? "❌ "+fail+" falhas" : ""}`);
    setBusy(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white transition"
      >
        📥 Import RC (Excel)
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-slate-900">Importar RC via Excel</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-800">×</button>
            </div>

            <p className="text-sm text-slate-500">
              A planilha precisa ter uma coluna <b>PC.Numero</b> e pelo menos uma das:
              RC.Numero · Descrição · Custo unit. · Custo total. Outras colunas são ignoradas.
            </p>

            <div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls"
                onChange={onFile}
                className="block w-full text-sm border border-slate-200 rounded p-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-amber-500 file:text-white file:cursor-pointer hover:file:bg-amber-600" />
            </div>

            {Object.keys(detected).length > 0 && (
              <div className="text-xs bg-slate-50 rounded p-3 space-y-1">
                <div className="font-medium text-slate-700">Colunas detectadas:</div>
                {Object.entries(detected).map(([k, v]) => (
                  <div key={k} className=" text-slate-600">{k} → {v}</div>
                ))}
              </div>
            )}

            {rows.length > 0 && (
              <div className="text-xs text-slate-500 bg-emerald-50 border border-emerald-200 rounded p-3">
                {rows.length} linhas prontas. Exemplo primeiro:{" "}
                <code className="">{JSON.stringify(rows[0])}</code>
              </div>
            )}

            {status && <div className="text-xs text-slate-700 whitespace-pre-wrap">{status}</div>}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setRows([]); setDetected({}); setStatus(""); if (inputRef.current) inputRef.current.value=""; }}
                className="px-3 py-1.5 text-sm rounded-md bg-slate-200 hover:bg-slate-300 text-slate-700">Limpar</button>
              <button onClick={applyImport} disabled={busy || !rows.length}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40">
                {busy ? "Processando…" : "Aplicar Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
