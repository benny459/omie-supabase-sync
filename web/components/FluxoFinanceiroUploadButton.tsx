"use client";

// Botão de upload do Fluxo Financeiro do projeto.
// Parseia Planilha1 do XLSX, extrai budget breakdown + etapas (Data Evento +
// Evento), mostra preflight e aplica via /api/rc-projetos/fluxo-financeiro.

import { useRef, useState } from "react";
import * as XLSX from "xlsx";

type ParsedBudget = {
  nome_projeto_fluxo: string | null;
  valor_total: number | null;
  valor_previsto_custos: number | null;
  valor_previsto_despesas: number | null;
  valor_previsto_servicos: number | null;
  resultado_bruto_esperado: number | null;
  resultado_bruto_esperado_pct: number | null;
  condicao_recebimento: string | null;
};
type ParsedEtapa = { nome: string; data_prevista: string | null; ordem: number; pct_total: number | null };
type Parsed = { budget: ParsedBudget; etapas: ParsedEtapa[] };

const fmtBRL = (v: number | null) => v == null
  ? "—"
  : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Converte serial number do Excel (dias desde 1900-01-01) ou string BR pra
// ISO YYYY-MM-DD.
function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial: dias desde 1899-12-30 (com bug do 1900 leap)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, "0")}-${String(br[1]).padStart(2, "0")}`;
  return null;
}

// Number-ish: aceita "R$ 1.234,56" ou "0.5" ou 1234.56
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Localiza uma linha cujo A comece com um label — retorna o valor de col B
function findValueByLabel(aoa: unknown[][], labelLc: string, maxRows = 40): unknown {
  for (let i = 0; i < Math.min(aoa.length, maxRows); i++) {
    const row = aoa[i]; if (!row) continue;
    const a = String(row[0] ?? "").trim().toLowerCase();
    if (a.startsWith(labelLc)) return row[1];
  }
  return null;
}

function parseFluxo(ab: ArrayBuffer): Parsed | { error: string } {
  const wb = XLSX.read(ab, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { error: "Arquivo sem abas legíveis." };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

  // Header info (rows 1-15 aproximadamente)
  const nome_projeto_fluxo = String(aoa[5]?.[0] ?? "").trim() || null;   // R6:A6
  const valor_total = toNum(findValueByLabel(aoa, "valor total do projeto"));
  const custosRaw = toNum(findValueByLabel(aoa, "valor previsto de custos"));
  const despRaw   = toNum(findValueByLabel(aoa, "valor previsto de despesas"));
  const servRaw   = toNum(findValueByLabel(aoa, "valor previsto em serviços"))
                 ?? toNum(findValueByLabel(aoa, "valor previsto em servicos"));

  // Guarda sempre positivo (planilha marca despesas como negativas)
  const abs = (n: number | null) => n == null ? null : Math.abs(n);

  // Resultado bruto esperado (linha "Resultado Bruto Esperado")
  // Aparece 2x na planilha (R12 valor, R13 %). Vamos localizar as duas.
  let resultado_bruto_esperado: number | null = null;
  let resultado_bruto_esperado_pct: number | null = null;
  let seenResultCount = 0;
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const row = aoa[i]; if (!row) continue;
    const a = String(row[0] ?? "").trim().toLowerCase();
    if (a.startsWith("resultado bruto esperado")) {
      const val = toNum(row[1]);
      if (seenResultCount === 0) resultado_bruto_esperado = val;
      else resultado_bruto_esperado_pct = val;
      seenResultCount++;
    }
  }
  // Fallback: se só achou 1 e valor absoluto < 1, provavelmente é o %
  if (resultado_bruto_esperado != null && resultado_bruto_esperado_pct == null && Math.abs(resultado_bruto_esperado) < 1) {
    resultado_bruto_esperado_pct = resultado_bruto_esperado;
    resultado_bruto_esperado = null;
  }

  const condicao_recebimento = (() => {
    const v = findValueByLabel(aoa, "condiç") ?? findValueByLabel(aoa, "condic");
    return v ? String(v).trim() : null;
  })();

  const budget: ParsedBudget = {
    nome_projeto_fluxo,
    valor_total,
    valor_previsto_custos: abs(custosRaw),
    valor_previsto_despesas: abs(despRaw),
    valor_previsto_servicos: abs(servRaw),
    resultado_bruto_esperado,
    resultado_bruto_esperado_pct,
    condicao_recebimento,
  };

  // Tabela de etapas — header em uma linha com "Etapa" e "Evento"
  let headerIdx = -1;
  const cols = { etapa: -1, dataEvento: -1, evento: -1, pct: -1 };
  for (let i = 10; i < Math.min(aoa.length, 50); i++) {
    const row = aoa[i]; if (!row) continue;
    const cellsLc = row.map((v) => String(v ?? "").trim().toLowerCase());
    if (!(cellsLc.includes("etapa") && cellsLc.some((c) => c.includes("evento")))) continue;
    cellsLc.forEach((s, idx) => {
      if (s === "etapa") cols.etapa = idx;
      if (s === "data evento" || s === "data do evento") cols.dataEvento = idx;
      if (s === "evento") cols.evento = idx;
      if (s === "% total" || s === "%total" || s === "%") cols.pct = idx;
    });
    headerIdx = i; break;
  }

  const etapas: ParsedEtapa[] = [];
  if (headerIdx >= 0 && cols.evento >= 0) {
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const row = aoa[i]; if (!row) break;
      const nome = String(row[cols.evento] ?? "").trim();
      const numEtapa = toNum(row[cols.etapa >= 0 ? cols.etapa : 0]);
      // Termina quando encontra linha totalmente vazia
      if (!nome && numEtapa == null) break;
      if (!nome) continue;
      const data_prevista = cols.dataEvento >= 0 ? toIsoDate(row[cols.dataEvento]) : null;
      const pct_total = cols.pct >= 0 ? toNum(row[cols.pct]) : null;
      etapas.push({ nome, data_prevista, ordem: numEtapa ?? etapas.length + 1, pct_total });
    }
  }

  return { budget, etapas };
}

export default function FluxoFinanceiroUploadButton({
  empresa,
  codigoProjeto,
  onDone,
}: {
  empresa: string;
  codigoProjeto: number;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setMsg(null); setFileName(f.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const ab = ev.target?.result as ArrayBuffer;
      const res = parseFluxo(ab);
      if ("error" in res) { setMsg({ kind: "err", text: res.error }); setParsed(null); return; }
      if (res.etapas.length === 0 && !res.budget.valor_total) {
        setMsg({ kind: "err", text: "Não achei budget nem etapas nessa planilha." });
        setParsed(null); return;
      }
      setParsed(res);
    };
    reader.readAsArrayBuffer(f);
  }

  async function apply() {
    if (!parsed) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo-financeiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, budget: parsed.budget, etapas: parsed.etapas }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error ?? "falhou" }); return; }
      setMsg({ kind: "ok", text: `✓ Budget salvo · ${j.etapas.novos} etapas novas · ${j.etapas.atualizados} atualizadas · ${j.etapas.removidos} removidas` });
      setTimeout(() => {
        setOpen(false); setParsed(null); setFileName(""); setMsg(null);
        onDone?.();
      }, 1400);
    } finally { setBusy(false); }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number | null)[][] = [
      ["Informações Comerciais - Fluxo Financeiro"],
      [], [],
      ["Previsão inicial"],
      [], // R5
      ["PROJETO -XXX - NOME DO CLIENTE"],
      ["Valor Total do Projeto", 100000],
      ["Valor Previsto de custos ", -70000],
      ["Valor Previsto de despesas", -5000],
      ["Valor Previsto em Serviços", -10000],
      [],
      ["Resultado Bruto Esperado", "=B7+B8+B9+B10"],
      ["Resultado Bruto Esperado", "=B12/B7"],
      [],
      ["Condição de recebimento:", "30 dias"],
      [], [],
      ["Etapa", "Data fluxo", "Data Evento", "Valor", "% Total", "Evento"],
      [1, null, "15/08/2026", "=B7*E19", 0.5, "No ato do fechamento"],
      [2, null, "15/09/2026", "=B7*E20", 0.25, "Contra entrega do projeto"],
      [3, null, "15/10/2026", "=E21*B7", 0.25, "Contra conclusão da montagem"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    XLSX.writeFile(wb, "fluxo-financeiro-modelo.xlsx");
  }

  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold text-blue-800 hover:text-blue-950 hover:bg-blue-100 border border-blue-300 transition">
        <span>📊</span> Fluxo Financeiro
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-slate-900 text-[15px]">Fluxo Financeiro do Projeto</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Só a <strong>Planilha1</strong> é usada. Extrai budget (Custos/Despesas/Serviços/Total)
                  e as etapas da tabela abaixo (colunas <code className="bg-slate-100 px-1 rounded">Data Evento</code>, <code className="bg-slate-100 px-1 rounded">Evento</code>).
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Re-upload atualiza budget e sincroniza etapas por NOME — preserva <strong>data_conclusao</strong> das etapas já concluídas.
                </p>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {!parsed && (
                <div className="space-y-2">
                  <button onClick={() => inputRef.current?.click()}
                    className="w-full border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-lg py-12 text-center text-slate-600 hover:text-blue-700 transition">
                    <div className="text-3xl mb-2">📊</div>
                    <div className="text-sm font-medium">Clique pra selecionar o XLSX do Fluxo</div>
                    <div className="text-[11px] text-slate-400 mt-1">Planilha1 · linhas 7-15 (budget) + tabela Etapa/Evento</div>
                  </button>
                  <div className="flex items-center justify-center gap-2 text-[11.5px]">
                    <span className="text-slate-500">Sem planilha?</span>
                    <button type="button" onClick={downloadTemplate}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100 transition">
                      📄 Baixar modelo (.xlsx)
                    </button>
                  </div>
                </div>
              )}

              {parsed && (
                <div className="space-y-3">
                  <div className="text-[11px] text-slate-500 font-mono">📄 {fileName}</div>
                  {parsed.budget.nome_projeto_fluxo && (
                    <div className="text-[12px] text-slate-700">
                      Projeto no arquivo: <strong>{parsed.budget.nome_projeto_fluxo}</strong>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                    {[
                      { l: "Valor Total do Projeto", v: parsed.budget.valor_total },
                      { l: "Previsto Custos", v: parsed.budget.valor_previsto_custos },
                      { l: "Previsto Despesas", v: parsed.budget.valor_previsto_despesas },
                      { l: "Previsto Serviços", v: parsed.budget.valor_previsto_servicos },
                      { l: "Resultado Bruto Esperado", v: parsed.budget.resultado_bruto_esperado },
                    ].map((k) => (
                      <div key={k.l} className="flex justify-between border border-slate-200 rounded px-2 py-1.5 bg-slate-50">
                        <span className="text-slate-600">{k.l}</span>
                        <span className="font-mono font-semibold tabular-nums">{fmtBRL(k.v)}</span>
                      </div>
                    ))}
                    {parsed.budget.resultado_bruto_esperado_pct != null && (
                      <div className="flex justify-between border border-slate-200 rounded px-2 py-1.5 bg-slate-50">
                        <span className="text-slate-600">Resultado Bruto (%)</span>
                        <span className="font-mono font-semibold tabular-nums">{(parsed.budget.resultado_bruto_esperado_pct * 100).toFixed(1)}%</span>
                      </div>
                    )}
                  </div>

                  <div className="border border-slate-200 rounded overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 text-[10px] uppercase font-bold text-slate-500 tracking-[0.5px]">
                      {parsed.etapas.length} Etapas encontradas
                    </div>
                    {parsed.etapas.length === 0 ? (
                      <div className="p-3 text-[11px] text-amber-700 italic">Nenhuma etapa (tabela &quot;Etapa | ... | Evento&quot; vazia?)</div>
                    ) : (
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-100 text-slate-600 text-[10px] uppercase">
                          <tr>
                            <th className="text-left px-2 py-1 w-8">#</th>
                            <th className="text-left px-2 py-1">Evento</th>
                            <th className="text-left px-2 py-1 w-24">Data</th>
                            <th className="text-right px-2 py-1 w-14">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.etapas.map((e, i) => (
                            <tr key={i} className="border-t border-slate-200">
                              <td className="px-2 py-1 text-slate-500 tabular-nums">{e.ordem}</td>
                              <td className="px-2 py-1">{e.nome}</td>
                              <td className="px-2 py-1 tabular-nums text-slate-700">{e.data_prevista ?? "—"}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-slate-500">{e.pct_total != null ? `${(e.pct_total * 100).toFixed(0)}%` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm disabled:opacity-40">
                  {busy ? "Aplicando…" : `Aplicar Budget + ${parsed.etapas.length} etapa(s)`}
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
