/**
 * Excel dos reports do Cesar — mesmo conteúdo do PDF (ReportPayload), com
 * layout cuidado: título em faixa escura, KPIs em cartões, tabelas com
 * cabeçalho escuro e zebra, moeda como número de verdade (dá pra somar).
 * exceljs em vez do xlsx (SheetJS community não estiliza célula nenhuma).
 */
import type { ReportPayload } from "./report-pdf";

const INK = "FF1C2430";
const ACCENT = "FF1D4ED8";
const ACCENT_SOFT = "FFEFF4FF";
const ZEBRA = "FFF6F8FA";
const MUTED = "FF6E7884";

const pareceMoeda = (s: string) => /R\$\s*-?[\d.,]+/.test(String(s || ""));
const numeroDeBRL = (s: string) => Number(String(s).replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."));

export async function gerarReportExcel(p: ReportPayload) {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cesar";
  const ws = wb.addWorksheet("Report", { views: [{ showGridLines: false }] });

  const NCOLS = Math.max(4, ...(p.tabelas || []).map((t) => t.colunas.length));
  for (let c = 1; c <= NCOLS; c++) ws.getColumn(c).width = c === 1 ? 34 : 18;

  let linha = 1;
  const merge = (r: number) => ws.mergeCells(r, 1, r, NCOLS);

  // Título em faixa escura
  merge(linha);
  const tit = ws.getCell(linha, 1);
  tit.value = p.titulo;
  tit.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  tit.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  tit.alignment = { vertical: "middle" };
  ws.getRow(linha).height = 30;
  for (let c = 2; c <= NCOLS; c++) ws.getCell(linha, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  linha++;
  if (p.subtitulo) {
    merge(linha);
    const sub = ws.getCell(linha, 1);
    sub.value = p.subtitulo;
    sub.font = { size: 10, color: { argb: MUTED } };
    linha++;
  }
  linha++;

  // KPIs — pares rótulo/valor em cartões (2 células por KPI, lado a lado)
  const kpis = (p.kpis || []).slice(0, 8);
  if (kpis.length) {
    let col = 1;
    for (const k of kpis) {
      if (col + 1 > NCOLS) { col = 1; linha += 3; }
      const cr = ws.getCell(linha, col);
      cr.value = String(k.rotulo || "").toUpperCase();
      cr.font = { size: 8, color: { argb: MUTED }, bold: true };
      cr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      const cv = ws.getCell(linha + 1, col);
      cv.value = k.valor;
      cv.font = { size: 13, bold: true, color: { argb: INK } };
      cv.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      ws.getCell(linha, col + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      ws.getCell(linha + 1, col + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_SOFT } };
      col += 2;
    }
    linha += 3;
  }

  // Tabelas
  for (const t of p.tabelas || []) {
    if (t.titulo) {
      merge(linha);
      const tt = ws.getCell(linha, 1);
      tt.value = t.titulo;
      tt.font = { bold: true, size: 11, color: { argb: INK } };
      linha++;
    }
    t.colunas.forEach((c, i) => {
      const cel = ws.getCell(linha, i + 1);
      cel.value = c;
      cel.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
      cel.alignment = { horizontal: i === 0 ? "left" : "right" };
    });
    linha++;
    (t.linhas || []).forEach((lr, r) => {
      lr.forEach((cell, i) => {
        const cel = ws.getCell(linha, i + 1);
        const texto = String(cell ?? "");
        // Moeda vira número de verdade — dá pra somar no próprio Excel.
        if (i > 0 && pareceMoeda(texto)) {
          cel.value = numeroDeBRL(texto);
          cel.numFmt = '"R$" #,##0.00';
        } else {
          cel.value = texto;
        }
        cel.font = { size: 9, color: { argb: INK } };
        cel.alignment = { horizontal: i === 0 ? "left" : "right" };
        if (r % 2 === 1) cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      });
      linha++;
    });
    linha++;
  }

  // Barras viram tabela de dados (gráfico nativo fica para o leitor montar)
  for (const g of p.barras || []) {
    merge(linha);
    const gt = ws.getCell(linha, 1);
    gt.value = g.titulo;
    gt.font = { bold: true, size: 11, color: { argb: INK } };
    linha++;
    for (const it of g.itens || []) {
      ws.getCell(linha, 1).value = it.rotulo;
      ws.getCell(linha, 1).font = { size: 9 };
      const cv = ws.getCell(linha, 2);
      cv.value = Number(it.valor) || 0;
      cv.numFmt = it.texto && pareceMoeda(it.texto) ? '"R$" #,##0.00' : "#,##0.##";
      cv.alignment = { horizontal: "right" };
      cv.font = { size: 9, color: { argb: ACCENT }, bold: true };
      linha++;
    }
    linha++;
  }

  merge(linha);
  const rod = ws.getCell(linha, 1);
  rod.value = `${p.rodape || "Gerado pelo Cesar · Painel WaterWorks"} · ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  rod.font = { size: 8, color: { argb: MUTED } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const nome = p.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nome || "report-cesar"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
