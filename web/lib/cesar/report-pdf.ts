/**
 * PDF profissional dos reports do Cesar — tabelas, KPIs e barras, desenhados à
 * mão com jsPDF. Adaptado do builder da Aria (FourMidia), que já resolveu o
 * problema difícil: fluxo estritamente vertical com quebra de página — nada se
 * sobrepõe por construção, porque cada bloco mede antes de desenhar e pula de
 * página quando não cabe.
 *
 * O payload vem montado pelo Cesar SÓ com números que ele consultou (regra
 * "números sagrados" do prompt). Este módulo não calcula nada: apresenta.
 *
 * Roda no NAVEGADOR (jsPDF + doc.save) — o CesarProvider importa dinamicamente
 * quando chega a ação "report_pdf" pelo SSE.
 */
import { jsPDF } from "jspdf";

export interface ReportKpi { rotulo: string; valor: string }
export interface ReportTabela { titulo?: string; colunas: string[]; linhas: string[][] }
export interface ReportBarras { titulo: string; itens: { rotulo: string; valor: number; texto?: string }[] }
export interface ReportPayload {
  titulo: string;
  subtitulo?: string;
  kpis?: ReportKpi[];
  tabelas?: ReportTabela[];
  barras?: ReportBarras[];
  rodape?: string;
}

// Paleta sóbria — tinta escura, apoio cinza, um azul institucional só.
const INK: [number, number, number] = [28, 36, 48];
const MUTED: [number, number, number] = [110, 120, 132];
const LINE: [number, number, number] = [225, 229, 234];
const ZEBRA: [number, number, number] = [246, 248, 250];
const ACCENT: [number, number, number] = [29, 78, 216];
const ACCENT_SOFT: [number, number, number] = [231, 238, 252];

const PAGE_W = 595.28; // A4 pt
const PAGE_H = 841.89;
const M = 48;
const CONTENT_W = PAGE_W - M * 2;

const pareceNumero = (s: string) => /^[\sR$\-+]?[\d.,%\s]+$/.test(String(s || "").trim()) && /\d/.test(s);

export function gerarReportPDF(p: ReportPayload) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 0;
  let pagina = 1;

  const rodapePagina = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    doc.text(`${p.rodape || "Gerado pelo Cesar · Painel WaterWorks"} · ${quando}`, M, PAGE_H - 24);
    doc.text(`pág. ${pagina}`, PAGE_W - M, PAGE_H - 24, { align: "right" });
  };

  const novaPagina = () => {
    rodapePagina();
    doc.addPage();
    pagina++;
    y = M;
  };

  const garante = (altura: number) => {
    if (y + altura > PAGE_H - 48) novaPagina();
  };

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  doc.setFillColor(...INK);
  doc.rect(0, 0, PAGE_W, 86, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(0, 86, PAGE_W, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(doc.splitTextToSize(p.titulo, CONTENT_W - 110), M, 40);
  if (p.subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(190, 198, 208);
    doc.text(doc.splitTextToSize(p.subtitulo, CONTENT_W - 110), M, 62);
  }
  doc.setFontSize(9);
  doc.setTextColor(190, 198, 208);
  doc.text(new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), PAGE_W - M, 40, { align: "right" });
  y = 86 + 3 + 26;

  // ── KPIs ───────────────────────────────────────────────────────────────
  const kpis = (p.kpis || []).slice(0, 8);
  if (kpis.length) {
    const porLinha = Math.min(kpis.length, 4);
    const gap = 10;
    const w = (CONTENT_W - gap * (porLinha - 1)) / porLinha;
    const h = 52;
    for (let i = 0; i < kpis.length; i += porLinha) {
      garante(h + 14);
      const linha = kpis.slice(i, i + porLinha);
      linha.forEach((k, j) => {
        const x = M + j * (w + gap);
        doc.setFillColor(...ACCENT_SOFT);
        doc.roundedRect(x, y, w, h, 6, 6, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(String(k.rotulo || "").toUpperCase().slice(0, 40), x + 10, y + 16);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...INK);
        doc.text(doc.splitTextToSize(String(k.valor || ""), w - 20)[0] || "", x + 10, y + 37);
      });
      y += h + 12;
    }
    y += 6;
  }

  // ── Tabelas ────────────────────────────────────────────────────────────
  for (const t of p.tabelas || []) {
    const nCols = Math.max(1, (t.colunas || []).length);
    // Primeira coluna mais larga (é onde vive o nome); as demais dividem o resto.
    const wPrimeira = nCols > 1 ? Math.min(CONTENT_W * 0.34, CONTENT_W / nCols * 1.6) : CONTENT_W;
    const wOutras = nCols > 1 ? (CONTENT_W - wPrimeira) / (nCols - 1) : 0;
    const colX = (i: number) => M + (i === 0 ? 0 : wPrimeira + wOutras * (i - 1));
    const colW = (i: number) => (i === 0 ? wPrimeira : wOutras);
    const rowH = 20;

    const cabecalho = () => {
      doc.setFillColor(...INK);
      doc.rect(M, y, CONTENT_W, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      t.colunas.forEach((c, i) => {
        const alinhaDir = i > 0;
        doc.text(String(c).slice(0, 40), alinhaDir ? colX(i) + colW(i) - 8 : colX(i) + 8, y + 13.5, { align: alinhaDir ? "right" : "left" });
      });
      y += rowH;
    };

    garante(rowH * 3 + 24);
    if (t.titulo) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      doc.text(t.titulo, M, y + 4);
      y += 16;
    }
    cabecalho();

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    (t.linhas || []).forEach((linha, r) => {
      if (y + rowH > PAGE_H - 48) { novaPagina(); cabecalho(); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); }
      if (r % 2 === 1) {
        doc.setFillColor(...ZEBRA);
        doc.rect(M, y, CONTENT_W, rowH, "F");
      }
      doc.setTextColor(...INK);
      linha.slice(0, nCols).forEach((cel, i) => {
        const texto = String(cel ?? "");
        const alinhaDir = i > 0 && pareceNumero(texto);
        const cabe = doc.splitTextToSize(texto, colW(i) - 16)[0] || "";
        doc.text(cabe, alinhaDir ? colX(i) + colW(i) - 8 : colX(i) + 8, y + 13.5, { align: alinhaDir ? "right" : "left" });
      });
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(M, y + rowH, M + CONTENT_W, y + rowH);
      y += rowH;
    });
    y += 18;
  }

  // ── Barras horizontais ─────────────────────────────────────────────────
  for (const g of p.barras || []) {
    const itens = (g.itens || []).slice(0, 14);
    if (!itens.length) continue;
    const rowH = 22;
    garante(24 + itens.length * rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(g.titulo, M, y + 4);
    y += 16;

    const max = Math.max(...itens.map((i) => Math.abs(Number(i.valor) || 0)), 1);
    const wRotulo = CONTENT_W * 0.32;
    const wBarraMax = CONTENT_W - wRotulo - 90;
    itens.forEach((it) => {
      if (y + rowH > PAGE_H - 48) novaPagina();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(String(it.rotulo), wRotulo - 10)[0] || "", M, y + 12);
      const w = Math.max(2, (Math.abs(Number(it.valor) || 0) / max) * wBarraMax);
      doc.setFillColor(...ACCENT);
      doc.roundedRect(M + wRotulo, y + 3, w, 12, 3, 3, "F");
      doc.setTextColor(...MUTED);
      doc.text(it.texto ?? String(it.valor), M + wRotulo + w + 6, y + 12);
      y += rowH;
    });
    y += 14;
  }

  rodapePagina();
  const nome = p.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  doc.save(`${nome || "report-cesar"}.pdf`);
}
