// "Importar planilha (.xlsx/.csv)" (08/10/26): o arquivo vira o mesmo texto que o colar do
// Excel lê (TAB entre colunas) — e daí passa pelo MESMO leitor (lib/colar-grade).
// Aba "Lista" (a do modelo) se existir; senão a primeira. Células com fórmula entram pelo
// RESULTADO gravado (o Excel grava o valor ao salvar); data que vem como número de série
// é convertida pelo leitor do colar.
import * as XLSX from "xlsx";

export function planilhaParaTexto(wb: XLSX.WorkBook): string {
  const nome = wb.SheetNames.find((n) => /^lista/i.test(n.trim())) ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, blankrows: false, defval: "" });
  return rows
    .map((r) => r.map((v) => (v == null ? "" : String(v).replace(/[\t\r\n]+/g, " "))).join("\t"))
    .filter((l) => l.replace(/\t/g, "").trim() !== "")
    .join("\n");
}

/** Bytes do arquivo (xlsx/xls/csv/txt) → texto TAB. */
export function arquivoParaTexto(nomeArquivo: string, buf: ArrayBuffer | Uint8Array): string {
  if (/\.(csv|txt)$/i.test(nomeArquivo)) {
    const t = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
    const l1 = t.split(/\r?\n/)[0] ?? "";
    if (l1.includes("\t") || l1.includes(";")) return t;
    return planilhaParaTexto(XLSX.read(t, { type: "string", raw: true }));
  }
  return planilhaParaTexto(XLSX.read(buf, { type: "array" }));
}
