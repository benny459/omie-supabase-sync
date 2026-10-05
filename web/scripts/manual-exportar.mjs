#!/usr/bin/env node
// Exporta o manual como UM arquivo HTML autocontido (05/10/26), para mandar
// por e-mail ou abrir sem login. Uso: node scripts/manual-exportar.mjs saida.html
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = process.argv[2] ?? join(WEB, "manual-allka.html");
const { paginas, geradoEm } = JSON.parse(readFileSync(join(WEB, "lib", "manual-dados.json"), "utf8"));
const css = readFileSync(join(WEB, "components", "manual", "manual.css"), "utf8");
const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "—");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const md = (corpo) => renderToStaticMarkup(h(ReactMarkdown, { remarkPlugins: [remarkGfm] }, corpo))
  .replace(/<blockquote>\s*<p><strong>(Atenção|Dica)/g, (_, t) => `<blockquote class="mn-aviso mn-${t === "Dica" ? "dica" : "atencao"}"><p><strong>${t}`)
  .replace(/<blockquote>/g, '<blockquote class="mn-aviso mn-nota">')
  .replace(/<table>/g, '<div class="mn-tabela"><table>').replace(/<\/table>/g, "</table></div>")
  .replace(/src="\/manual-img\//g, 'src="https://painel.waterworks.com.br/manual-img/');

const indice = paginas.map((p) => `<li><a href="#${p.slug}">${p.icone} ${esc(p.titulo)}</a></li>`).join("");
const corpo = paginas.map((p) => `
<section id="${p.slug}" class="mn-sec">
  <div class="mn-cab"><div class="mn-migalha">Manual › ${esc(p.titulo)}</div>
  <h1>${p.icone} ${esc(p.titulo)}</h1><p class="mn-resumo">${esc(p.resumo)}</p>
  <div class="mn-meta">Atualizado em ${dataBR(p.atualizado)}</div></div>
  <div class="mn-corpo">${md(p.corpo)}</div>
</section>`).join("\n");

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual da plataforma Allka · WaterWorks</title>
<style>
body { margin: 0; background: #f6f7fb; font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
@media (prefers-color-scheme: dark) { body { background: #0a1628; } html { color-scheme: dark; } }
${css}
@media (prefers-color-scheme: dark) { .mn {
  --mn-bg: #0a1628; --mn-card: #111d32; --mn-line: #1e3050; --mn-tx: #e8ecf1; --mn-tx2: #a0b8d0; --mn-tx3: #5a7a98;
  --mn-acc: #60a5fa; --mn-acc-s: rgba(96,165,250,.14); --mn-dica: #34d399; --mn-dica-s: rgba(52,211,153,.12); --mn-at: #fbbf24; --mn-at-s: rgba(251,191,36,.12); } }
.mn-sec { padding-bottom: 28px; margin-bottom: 28px; border-bottom: 1px solid var(--mn-line); }
.mn-capa h1 { font-size: 32px; margin: 0 0 6px; }
</style></head>
<body><div class="mn">
<nav class="mn-indice"><ul><li><a href="#topo">📘 Visão geral</a></li>${indice}</ul></nav>
<main class="mn-pagina">
<div id="topo" class="mn-cab mn-capa"><div class="mn-migalha">WaterWorks · Allka</div><h1>Manual da plataforma</h1>
<p class="mn-resumo">Como usar cada área do sistema, passo a passo. A versão sempre atualizada fica dentro do sistema, no botão <b>?</b> da barra (painel → /manual).</p>
<div class="mn-meta">Gerado em ${new Date(geradoEm).toLocaleString("pt-BR")}</div></div>
${corpo}
</main></div></body></html>`;

writeFileSync(saida, html);
console.log(`manual exportado: ${saida} (${Math.round(html.length / 1024)} KB, ${paginas.length} páginas)`);
