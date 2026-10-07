"use client";

import { useEffect, useRef, useState } from "react";
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
/** Minúsculas, sem acento, sem espaço nas pontas. Cabeçalho de planilha do mundo
 *  real vem com acento, plural e barra — comparar a string crua é o que fazia
 *  "Descrição" e "Qtde" não casarem. */
const norm = (v: unknown) =>
  String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

type ParsedItem = {
  equipamento: string;
  item: string;
  qtd: number | null;
  modelo: string | null;
  pc_numero: string | null;
  /** 06/10/26 — colunas opcionais do modelo novo. Ausentes = o import não mexe
   *  no que já estava gravado nessas colunas. */
  cat_codigo?: string | null;
  un?: string | null;
  cat_valor_unit?: number | null;
  cat_fornecedor?: string | null;
  data_necessaria?: string | null;
  observacao?: string | null;
};

/** Data da planilha → AAAA-MM-DD: número de série do Excel, dd/mm/aaaa ou ISO. */
function dataPlanilha(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}

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
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [diff, setDiff] = useState<{ novos: number; atualizados: number; removidos: number; total_atual: number } | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* A prévia mostra a lista inteira, mas só grava no "Confirmar". Fechar no ×,
     clicar fora ou recarregar a página com a prévia aberta descartava tudo em
     silêncio — e quem viu a lista na tela achava que ela estava no sistema. */
  const fechar = () => {
    if (busy) return;
    if (parsed && parsed.length > 0 && !window.confirm(
      `A lista de "${fileName}" (${parsed.length} itens) ainda NÃO foi gravada.\n\nFechar e descartar?`)) return;
    setOpen(false);
  };
  useEffect(() => {
    if (!open || !parsed?.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [open, parsed]);

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

        // Abas que existem pra consulta, não pra importar. Sem isto, "Base WW"
        // (2.688 linhas de catálogo) entraria como se fosse um equipamento.
        const IGNORAR = /^(base ww|base|como usar|instrucoes|instrucao|leia-me|modelo)$/;
        const puladas: string[] = [];

        for (const sheetName of wb.SheetNames) {
          if (IGNORAR.test(norm(sheetName))) continue;
          const sheet = wb.Sheets[sheetName];
          const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });

          // Detecta header + mapa de colunas por NOME, não por posição.
          //
          // O modelo do painel não é o único que chega aqui: planilhas de compra
          // trazem "Nível | Qtde | Descrição | Marca | Modelo / Referência | ...".
          // A versão anterior exigia a palavra "item" na linha e comparava
          // "qtd"/"modelo" por igualdade exata, então "Qtde", "Descrição" e
          // "Modelo / Referência" não casavam e a aba inteira era pulada em
          // silêncio — o erro final dizia "nenhum item válido" sem dizer qual aba
          // nem qual coluna faltou.
          const cols: { item: number; qtd: number; modelo: number; pc: number;
                        cod: number; un: number; custo: number; forn: number; data: number; obs: number } =
            { item: -1, qtd: -1, modelo: -1, pc: -1, cod: -1, un: -1, custo: -1, forn: -1, data: -1, obs: -1 };
          let headerIdx = -1;
          for (let i = 0; i < Math.min(aoa.length, 12); i++) {
            const row = aoa[i];
            if (!row) continue;
            const cels = row.map((v) => norm(v));

            cols.item = cols.qtd = cols.modelo = cols.pc = cols.cod = cols.un = cols.custo = cols.forn = cols.data = cols.obs = -1;
            cels.forEach((s, idx) => {
              if (!s) return;
              // Nome do material. "itens" (plural) tem prioridade sobre "item",
              // que em algumas planilhas é o NÚMERO da linha, não o nome.
              if (cols.item === -1 && (s === "itens" || s.startsWith("descricao") || s.startsWith("descrizione"))) cols.item = idx;
              // Aceita qtd, qtde, qtd., quant., quantidade
              if (cols.qtd === -1 && /^(qtd|qtde|quant)/.test(s)) cols.qtd = idx;
              // "modelo", "modelo / referencia", "modelo/ref"
              if (cols.modelo === -1 && s.startsWith("modelo")) cols.modelo = idx;
              if (cols.pc === -1 && (s === "pc" || s.startsWith("pc associado") || s.startsWith("pedido de compra"))) cols.pc = idx;
              // Colunas do modelo novo (06/10/26) — todas opcionais.
              if (cols.cod === -1 && (s === "codigo" || s === "cod" || s === "cod." || s.startsWith("codigo do item"))) cols.cod = idx;
              if (cols.un === -1 && (s === "un" || s === "unid" || s === "unid." || s === "unidade")) cols.un = idx;
              if (cols.custo === -1 && (s.startsWith("custo") || s.startsWith("valor unit") || s.startsWith("preco"))) cols.custo = idx;
              if (cols.forn === -1 && s.startsWith("fornecedor")) cols.forn = idx;
              if (cols.obs === -1 && (s.startsWith("observ") || s.startsWith("informacoes adicionais"))) cols.obs = idx;
              if (cols.data === -1 && (s.startsWith("data necessaria") || s.startsWith("necessario") || s.startsWith("data de necessidade"))) cols.data = idx;
            });
            // Só então "item" singular, pra não roubar a coluna de "itens".
            if (cols.item === -1) {
              cels.forEach((s, idx) => {
                if (cols.item === -1 && s === "item") cols.item = idx;
              });
            }
            if (cols.item !== -1 && cols.qtd !== -1) { headerIdx = i; break; }
          }
          if (headerIdx < 0) {
            // Guarda o motivo por ABA: "nenhum item válido" sozinho não diz onde
            // olhar numa planilha de várias abas.
            puladas.push(sheetName.trim());
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
            const extra: Partial<ParsedItem> = {};
            if (cols.cod >= 0) extra.cat_codigo = row[cols.cod] != null ? String(row[cols.cod]).trim() || null : null;
            if (cols.un >= 0) extra.un = row[cols.un] != null ? String(row[cols.un]).trim() || null : null;
            if (cols.custo >= 0) extra.cat_valor_unit = parseNum(row[cols.custo]);
            if (cols.forn >= 0) extra.cat_fornecedor = row[cols.forn] != null ? String(row[cols.forn]).trim() || null : null;
            if (cols.data >= 0) extra.data_necessaria = dataPlanilha(row[cols.data]);
            if (cols.obs >= 0) extra.observacao = row[cols.obs] != null ? String(row[cols.obs]).trim() || null : null;
            all.push({ equipamento: sheetName.trim(), item, qtd, modelo, pc_numero, ...extra });
          }
        }

        if (all.length === 0) {
          setMsg({ kind: "err", text: puladas.length
            ? `Cabeçalho não reconhecido em: ${puladas.join(", ")}. `
              + "Cada aba precisa de uma coluna de NOME (Itens, Item ou Descrição) e uma de "
              + "QUANTIDADE (Qtd, Qtde ou Quantidade). Modelo e PC são opcionais."
            : "Nenhum item válido encontrado — as abas têm cabeçalho, mas nenhuma linha com nome preenchido." });
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
      ["    - Código              (opcional — código do item no nosso cadastro)"],
      ["    - Descrição           (OBRIGATÓRIA — nome do material)"],
      ["    - Un                  (opcional — UN, M, KG…)"],
      ["    - Qtd                 (OBRIGATÓRIA)"],
      ["    - Custo estimado      (opcional — valor unitário; vazio = último preço pago)"],
      ["    - Fornecedor sugerido (opcional)"],
      ["    - Data necessária     (opcional — dd/mm/aaaa; entra no fluxo de caixa do projeto)"],
      ["    - Modelo              (opcional)"],
      ["    - Observação          (opcional)"],
      ["    - PC Associado        (opcional — se já sabe o nº do PC)"],
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

    // Abas de exemplo — uma por equipamento, com as colunas do modelo.
    const cab = ["Código", "Descrição", "Un", "Qtd", "Custo estimado", "Fornecedor sugerido", "Data necessária", "Modelo", "Observação", "PC Associado"];
    const larg = [{ wch: 12 }, { wch: 44 }, { wch: 6 }, { wch: 7 }, { wch: 14 }, { wch: 28 }, { wch: 15 }, { wch: 14 }, { wch: 24 }, { wch: 12 }];
    const painel = [
      cab,
      [null, "CHAVE NÍVEL BOIA AZ 5M", "UN", 3, 45.9, null, "20/11/2026", null, null, null],
      [null, "BLOCO CONTATO AUXILIAR 1NA+1NF", "UN", 14, null, "Schneider", "20/11/2026", "LA1", null, null],
      [null, "CONTATOR TRIPOLAR 18A 220V", "UN", 4, 189, null, "05/12/2026", null, "confirmar tensão", null],
    ];
    const wsPainel = XLSX.utils.aoa_to_sheet(painel);
    wsPainel["!cols"] = larg;
    XLSX.utils.book_append_sheet(wb, wsPainel, "Painel Elétrico");
    const tubos = [
      cab,
      [null, "TUBO PVC SOLDÁVEL 32MM", "M", 30, 12.5, null, "15/11/2026", null, null, null],
      [null, "CURVA 90 SOLDÁVEL 32MM", "UN", 12, 3.2, null, "15/11/2026", null, null, null],
    ];
    const wsTubos = XLSX.utils.aoa_to_sheet(tubos);
    wsTubos["!cols"] = larg;
    XLSX.utils.book_append_sheet(wb, wsTubos, "Hidráulica");

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
      // Remoção não é detalhe do sucesso. "✓ 36 processados · 412 removidos"
      // lê como vitória — e foi assim que o PJ358 perdeu equipamentos
      // inteiros sem ninguém notar. Quando sai um EQUIPAMENTO inteiro, a
      // mensagem deixa de ser verde e nomeia o que sumiu: a aba que faltou no
      // arquivo é a causa, e o nome dela é o que faz a ficha cair.
      const removidos = Number(j.total_deletados ?? 0);
      const equips: string[] = Array.isArray(j.equipamentos_removidos) ? j.equipamentos_removidos : [];
      if (equips.length > 0) {
        setMsg({ kind: "warn", text:
          `⚠ ${j.total_processados} itens processados, mas ${removidos} foram removidos — `
          + `sumiu ${equips.length === 1 ? "o equipamento" : "os equipamentos"} `
          + `“${equips.join("”, “")}”. A planilha nova não trouxe essa${equips.length === 1 ? "" : "s"} aba${equips.length === 1 ? "" : "s"}. `
          + `Dá para desfazer em “Itens removidos”.` });
      } else if (removidos > 0) {
        setMsg({ kind: "warn", text:
          `✓ ${j.total_processados} itens processados · ${removidos} removidos por não estarem `
          + `na planilha nova. Dá para desfazer em “Itens removidos”.` });
      } else {
        setMsg({ kind: "ok", text: `✓ ${j.total_processados} itens processados` });
      }
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
        Subir planilha
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={(e) => {
               // Só fecha se o click for no backdrop (não em elementos internos).
               // Evita que o click sintético do file input (que borbulha) feche
               // o modal antes do file picker abrir.
               if (e.target === e.currentTarget) fechar();
             }}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-ww-panel rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-ww-border flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text text-[15px]">Lista de materiais — subir planilha (.xlsx)</h3>
                <p className="text-xs text-ww-textMuted mt-0.5">
                  Cada <strong>aba</strong> = 1 equipamento. As colunas são achadas pelo <strong>nome no cabeçalho</strong>, em qualquer posição:{" "}
                  <code className="bg-ww-bg px-1 rounded">Itens</code>/<code className="bg-ww-bg px-1 rounded">Item</code>/<code className="bg-ww-bg px-1 rounded">Descrição</code>,{" "}
                  <code className="bg-ww-bg px-1 rounded">Qtd</code>/<code className="bg-ww-bg px-1 rounded">Qtde</code>/<code className="bg-ww-bg px-1 rounded">Quantidade</code>, e opcionalmente{" "}
                  <code className="bg-ww-bg px-1 rounded">Código</code>, <code className="bg-ww-bg px-1 rounded">Un</code>, <code className="bg-ww-bg px-1 rounded">Custo estimado</code>, <code className="bg-ww-bg px-1 rounded">Fornecedor sugerido</code>, <code className="bg-ww-bg px-1 rounded">Data necessária</code>, <code className="bg-ww-bg px-1 rounded">Modelo</code>, <code className="bg-ww-bg px-1 rounded">Observação</code> e <code className="bg-ww-bg px-1 rounded">PC</code>. Abas de catálogo (Base WW, Como usar) são ignoradas.
                </p>
                <p className="text-[11px] text-ww-textMuted mt-1">
                  Novo upload <strong>substitui</strong> a lista: itens novos entram, existentes atualizam,
                  <strong> itens que sumiram da planilha são removidos</strong>. Vínculo a PC é preservado se a planilha
                  nova não trouxer PC; se trouxer coluna "PC Associado", o valor é aplicado.
                </p>
              </div>
              <button onClick={fechar} className="text-ww-textFaint hover:text-ww-text text-lg leading-none">×</button>
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {!parsed && (
                <div className="space-y-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="w-full border-2 border-dashed border-ww-border hover:border-violet-400 rounded-lg py-12 text-center text-ww-textMuted hover:text-violet-700 transition">
                    <div className="text-3xl mb-2">📥</div>
                    <div className="text-sm font-medium">Clique pra selecionar o XLSX</div>
                    <div className="text-[11px] text-ww-textFaint mt-1">Cada aba = 1 equipamento. Cabeçalho com nome e quantidade; modelo e PC opcionais.</div>
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
                  msg.kind === "ok"   ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                  // Âmbar: gravou, mas apagou coisa. Verde diria "deu certo" e
                  // foi assim que uma perda de equipamentos inteiros passou
                  // batida; vermelho diria que falhou, e não falhou.
                  : msg.kind === "warn" ? "text-amber-900 bg-amber-50 border border-amber-300"
                                        : "text-rose-700 bg-rose-50 border border-rose-200"
                }`}>{msg.text}</div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-ww-border flex justify-end gap-2">
              <button onClick={fechar}
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
