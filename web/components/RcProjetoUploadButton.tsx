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
  pc_numero: string | null;
};

export default function RcProjetoUploadButton({
  empresa,
  codigoProjeto,
  onDone,
}: {
  empresa: string;
  codigoProjeto: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedItem[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [diff, setDiff] = useState<{ novos: number; atualizados: number; removidos: number; total_atual: number } | null>(null);
  const [preflighting, setPreflighting] = useState(false);
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

          // Detecta header + mapa de colunas dinâmico (aceita variações do modelo:
          // "Qtd | UNID | ITEM | Itens | Marca | Modelo | Prazo | Info" ou o novo
          // "ITEM | Qtd | UNID | Itens | Marca | Modelo | TIPO | CATEGORIA | PC Associado").
          const cols: { item: number; qtd: number; modelo: number; pc: number } =
            { item: -1, qtd: -1, modelo: -1, pc: -1 };
          let headerIdx = -1;
          for (let i = 0; i < Math.min(aoa.length, 12); i++) {
            const row = aoa[i];
            if (!row) continue;
            const cellsLc = row.map(v => String(v ?? "").trim().toLowerCase());
            const joined = cellsLc.join("|");
            if (!(joined.includes("item") && (joined.includes("qtd") || joined.includes("quantidade")))) continue;
            // Mapeia cada coluna pelo texto do header
            cellsLc.forEach((s, idx) => {
              if (!s) return;
              // "itens" (plural — nome do material) tem prioridade
              if (cols.item === -1 && s === "itens") cols.item = idx;
              // qtd
              if (cols.qtd === -1 && (s === "qtd" || s === "quantidade")) cols.qtd = idx;
              // modelo
              if (cols.modelo === -1 && s === "modelo") cols.modelo = idx;
              // PC Associado
              if (cols.pc === -1 && (s === "pc associado" || s === "pc" || s.startsWith("pc "))) cols.pc = idx;
            });
            // Fallback pra "item" (singular) caso não tenha "itens" — pode ser o nome
            if (cols.item === -1) {
              cellsLc.forEach((s, idx) => {
                if (cols.item !== -1) return;
                if (s === "item" || s === "descrição" || s === "descricao") cols.item = idx;
              });
            }
            // Se achou pelo menos item + qtd, fixa header
            if (cols.item !== -1 && cols.qtd !== -1) { headerIdx = i; break; }
            // Reset e tenta próxima linha
            cols.item = -1; cols.qtd = -1; cols.modelo = -1; cols.pc = -1;
          }
          if (headerIdx < 0) continue; // aba sem header reconhecível — pula

          for (let i = headerIdx + 1; i < aoa.length; i++) {
            const row = aoa[i];
            if (!row) continue;
            const item = String(row[cols.item] ?? "").trim();
            if (!item) continue;
            const qtd    = parseNum(row[cols.qtd]);
            const modelo = cols.modelo >= 0 && row[cols.modelo] != null ? String(row[cols.modelo]).trim() || null : null;
            const pcRaw  = cols.pc >= 0 && row[cols.pc] != null ? String(row[cols.pc]).trim() : "";
            const pc_numero = pcRaw ? pcRaw : null;
            // Filtra linhas sem qtd E sem modelo E sem PC — provável total/subtotal
            if (qtd == null && !modelo && !pc_numero) continue;
            all.push({ equipamento: sheetName.trim(), item, qtd, modelo, pc_numero });
          }
        }

        if (all.length === 0) {
          setMsg({ kind: "err", text: "Nenhum item válido encontrado. Verifique se cada aba tem cabeçalho 'Item / Qtd / Modelo'." });
          setParsed(null); setDiff(null);
        } else {
          setParsed(all);
          setDiff(null);
          // Dispara preflight logo depois do parse — user vê o diff antes de aplicar
          void runPreflight(all);
        }
      } catch (e) {
        setMsg({ kind: "err", text: `Falha ao ler XLSX: ${e instanceof Error ? e.message : String(e)}` });
        setParsed(null); setDiff(null);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  function downloadTemplate() {
    // Modelo com 2 abas de exemplo + 1 aba "Como usar" no início.
    // Colunas usadas pelo parser: Qtd, ITEM, Itens (nome), Marca, Modelo, PC Associado.
    // Cada aba = 1 equipamento. Nome da aba vira o "equipamento" no banco.
    const wb = XLSX.utils.book_new();

    // Aba explicativa
    const instrucoes = [
      ["LISTA DE MATERIAIS — MODELO"],
      [],
      ["Como preencher:"],
      ["• Cada aba deste arquivo é um EQUIPAMENTO do projeto (renomeie livremente)."],
      ["• A linha do cabeçalho deve conter as colunas abaixo (ordem livre):"],
      ["    - Qtd            (número de itens)"],
      ["    - Itens          (descrição/nome do material)"],
      ["    - Marca          (opcional)"],
      ["    - Modelo         (opcional)"],
      ["    - PC Associado   (opcional — se já sabe o # do PC, coloca aqui)"],
      [],
      ["Ao subir a mesma lista de novo, o sistema faz sync:"],
      ["    novos → entram · existentes → atualizam · sumidos → REMOVIDOS"],
      ["    (vínculo a PC é preservado quando a nova planilha não trouxer PC)"],
      [],
      ["Apague esta aba antes de subir (opcional — ela é ignorada pelo parser)."],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrucoes);
    wsInstr["!cols"] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Como usar");

    // Aba de exemplo 1 — modelo simples (equipamento genérico)
    const painel = [
      [null, null, null, "PAINEL ELÉTRICO", null, null, null, null, null],
      [],
      ["Qtd", "UNID", "ITEM", "Itens", "Marca", "Modelo", "Prazo Estimado", "Informações adicionais", "PC Associado"],
      [3, "UN", 1, "CHAVE NÍVEL BOIA AZ 5M", null, null, null, null, null],
      [14, "UN", 2, "BLOCO CONTATO AUXILIAR 1NA+1NF", "Schneider", "LA1", null, null, "PC 5567"],
      [4, "UN", 3, "CONTATOR TRIPOLAR 18A 220V", null, null, null, "aprovado", null],
      [1, "UN", 4, "BOTÃO EMERGÊNCIA D40MM 1NF", null, null, null, null, null],
      [2, "UN", 5, "SONALARME BUZZER 22MM 220V", null, null, null, null, null],
    ];
    const wsPainel = XLSX.utils.aoa_to_sheet(painel);
    wsPainel["!cols"] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsPainel, "Painel Elétrico");

    // Aba de exemplo 2 — modelo com layout novo (ITEM primeiro, TIPO/CATEGORIA)
    const tubos = [
      [null, null, null, "TUBULAÇÕES", null, null, null, null, null],
      [],
      ["ITEM", "Qtd", "UNID", "Itens", "Marca", "Modelo", "TIPO", "CATEGORIA", "PC Associado"],
      [1, 4, "UN", "TUBO MANIFOLD 1\"", null, null, "Looping", "Elétrica", null],
      [2, 2, "UN", "TUBO MANIFOLD 3/4\"", null, null, "Elétrica", "Principal", null],
      [3, 10, "M", "TUBO PVC 100mm", "Tigre", "Série R", "Interligação", "Hidráulica", "PC 5570"],
    ];
    const wsTubos = XLSX.utils.aoa_to_sheet(tubos);
    wsTubos["!cols"] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsTubos, "Tubulações");

    XLSX.writeFile(wb, "lista-materiais-modelo.xlsx");
  }

  async function runPreflight(items: ParsedItem[]) {
    setPreflighting(true);
    try {
      const r = await fetch("/api/rc-projetos/upload/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, items }),
      });
      const j = await r.json();
      if (r.ok) setDiff(j);
    } catch { /* silencia — botão aplica sem preview se preflight falhou */ }
    finally { setPreflighting(false); }
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
      setMsg({ kind: "ok", text: `✓ ${j.total_processados} itens processados${j.total_deletados > 0 ? ` · ${j.total_deletados} removidos (sumiram da nova planilha)` : ""}` });
      setTimeout(() => {
        setOpen(false); setParsed(null); setFileName(""); setMsg(null);
        router.refresh();
        onDone?.();
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
             onClick={(e) => {
               // Só fecha se o click for no backdrop (não em elementos internos).
               // Evita que o click sintético do file input (que borbulha) feche
               // o modal antes do file picker abrir.
               if (e.target === e.currentTarget && !busy) setOpen(false);
             }}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-ww-panel rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-ww-border flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text text-[15px]">Lista RC do Projeto</h3>
                <p className="text-xs text-ww-textMuted mt-0.5">
                  Cada <strong>aba</strong> = 1 equipamento. Colunas: <code className="bg-ww-bg px-1 rounded">B=Item</code>, <code className="bg-ww-bg px-1 rounded">C=Qtd</code>, <code className="bg-ww-bg px-1 rounded">D=Modelo</code>.
                </p>
                <p className="text-[11px] text-ww-textMuted mt-1">
                  Novo upload <strong>substitui</strong> a lista: itens novos entram, existentes atualizam,
                  <strong> itens que sumiram da planilha são removidos</strong>. Vínculo a PC é preservado se a planilha
                  nova não trouxer PC; se trouxer coluna "PC Associado", o valor é aplicado.
                </p>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="text-ww-textFaint hover:text-ww-text text-lg leading-none">×</button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {!parsed && (
                <div className="space-y-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="w-full border-2 border-dashed border-ww-border hover:border-violet-400 rounded-lg py-12 text-center text-ww-textMuted hover:text-violet-700 transition">
                    <div className="text-3xl mb-2">📥</div>
                    <div className="text-sm font-medium">Clique pra selecionar o XLSX</div>
                    <div className="text-[11px] text-ww-textFaint mt-1">Cada aba = 1 equipamento. Colunas: Itens, Qtd, Modelo, PC Associado.</div>
                  </button>
                  <div className="flex items-center justify-center gap-2 text-[11.5px]">
                    <span className="text-ww-textMuted">Não tem a planilha?</span>
                    <button type="button" onClick={downloadTemplate}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold hover:bg-emerald-100 transition">
                      📄 Baixar modelo (.xlsx)
                    </button>
                  </div>
                </div>
              )}

              {parsed && grupos && (
                <div className="space-y-3">
                  <div className="text-[11px] text-ww-textMuted font-mono">📄 {fileName}</div>
                  <div className="text-sm text-ww-textMuted">
                    <strong>{parsed.length}</strong> itens em <strong>{grupos.size}</strong> equipamento{grupos.size !== 1 ? "s" : ""}
                  </div>

                  {/* Preflight — diff vs o que já está no DB */}
                  {preflighting && (
                    <div className="text-[11px] text-ww-textMuted italic animate-pulse">Comparando com a lista atual…</div>
                  )}
                  {diff && (
                    <div className="border border-ww-border rounded-md p-3 bg-ww-rowHover/70">
                      <div className="text-[10px] uppercase tracking-[0.4px] font-bold text-ww-textMuted mb-2">
                        Diff (vs {diff.total_atual} atuais)
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded p-2 bg-emerald-50 border border-emerald-200 text-center">
                          <div className="text-[9px] uppercase font-bold text-emerald-700 tracking-[0.4px]">Novos</div>
                          <div className="text-lg font-bold text-emerald-800 tabular-nums">{diff.novos}</div>
                        </div>
                        <div className="rounded p-2 bg-sky-50 border border-sky-200 text-center">
                          <div className="text-[9px] uppercase font-bold text-sky-700 tracking-[0.4px]">Atualizados</div>
                          <div className="text-lg font-bold text-sky-800 tabular-nums">{diff.atualizados}</div>
                        </div>
                        <div className="rounded p-2 bg-rose-50 border border-rose-200 text-center">
                          <div className="text-[9px] uppercase font-bold text-rose-700 tracking-[0.4px]">Removidos</div>
                          <div className="text-lg font-bold text-rose-800 tabular-nums">{diff.removidos}</div>
                        </div>
                      </div>
                      {diff.removidos > 0 && (
                        <div className="mt-2 text-[10px] text-rose-700">
                          ⚠️ {diff.removidos} item{diff.removidos > 1 ? "s" : ""} do banco {diff.removidos > 1 ? "serão" : "será"} <strong>removid{diff.removidos > 1 ? "os" : "o"}</strong> (sumiu da nova planilha).
                        </div>
                      )}
                    </div>
                  )}

                  <details className="border border-ww-border rounded-md bg-ww-rowHover">
                    <summary className="text-[11px] px-2 py-1 cursor-pointer text-ww-textMuted font-semibold">
                      Ver por equipamento ({grupos.size})
                    </summary>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto p-2">
                      {[...grupos.entries()].map(([eq, n]) => (
                        <div key={eq} className="flex justify-between text-xs px-2 py-1">
                          <span className="font-medium text-ww-text">{eq}</span>
                          <span className="text-ww-textMuted font-mono">{n} {n === 1 ? "item" : "itens"}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {msg && (
                <div className={`mt-3 text-xs rounded-md px-3 py-2 ${
                  msg.kind === "ok" ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                                    : "text-rose-700 bg-rose-50 border border-rose-200"
                }`}>{msg.text}</div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-ww-border flex justify-end gap-2">
              <button onClick={() => !busy && setOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-ww-textMuted hover:bg-ww-bg rounded-md">Cancelar</button>
              {parsed && (
                <button onClick={apply} disabled={busy || preflighting}
                  className={`px-4 py-1.5 text-xs font-semibold text-white rounded-md shadow-sm disabled:opacity-40 ${
                    diff && diff.removidos > 0
                      ? "bg-rose-600 hover:bg-rose-700"
                      : "bg-violet-600 hover:bg-violet-700"
                  }`}>
                  {busy
                    ? "Aplicando…"
                    : preflighting
                      ? "Analisando…"
                      : diff
                        ? `Confirmar ${diff.novos}+ ${diff.atualizados}~ ${diff.removidos}−`
                        : `Subir ${parsed.length} itens`
                  }
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
