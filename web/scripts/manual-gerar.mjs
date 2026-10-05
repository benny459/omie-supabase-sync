#!/usr/bin/env node
// Gera web/lib/manual-dados.json a partir de web/content/manual/*.md (05/10/26).
//
// - Cada .md é uma página do manual (cabeçalho entre --- com titulo, resumo,
//   icone, area, rotas, caminhos, atualizado).
// - "O que mudou recentemente" vem do git: commits dos últimos 30 dias que
//   mexeram nos `caminhos` da página. Sem git (build na Vercel), mantém a lista
//   que já estava no JSON — por isso o publicar-painel.sh roda este script
//   antes de enviar.
// Roda sozinho no `prebuild` e em `npm run manual`.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(WEB, "content", "manual");
const SAIDA = join(WEB, "lib", "manual-dados.json");
const RAIZ = join(WEB, "..");

function cabecalho(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, corpo: txt };
  const meta = {};
  for (const linha of m[1].split("\n")) {
    const i = linha.indexOf(":");
    if (i > 0) meta[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return { meta, corpo: txt.slice(m[0].length) };
}
const lista = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

let anterior = {};
if (existsSync(SAIDA)) {
  try { for (const p of JSON.parse(readFileSync(SAIDA, "utf8")).paginas) anterior[p.slug] = p.mudancas; } catch { /* ignora */ }
}

function mudancas(caminhos) {
  if (!caminhos.length) return [];
  try {
    const out = execFileSync("git", ["log", "--since=30.days", "--date=short", "--pretty=format:%h\t%ad\t%s", "--", ...caminhos],
      { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean).map((l) => {
      const [hash, data, ...r] = l.split("\t");
      return { hash, data, texto: r.join("\t") };
    })
      .filter((c) => !/^v?\d+\.\d+\.\d+\s*$/.test(c.texto) && !/^merge /i.test(c.texto))
      .map((c) => ({ ...c, texto: c.texto.replace(/^(feat|fix|chore|refactor|docs)(\([^)]*\))?:\s*/i, "").replace(/^v\d+\.\d+\.\d+\s*[—-]\s*/, "") }))
      .slice(0, 12);
  } catch {
    return null; // sem git → mantém o anterior
  }
}

const paginas = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort().map((arq) => {
  const { meta, corpo } = cabecalho(readFileSync(join(DIR, arq), "utf8"));
  const slug = arq.replace(/^\d+-/, "").replace(/\.md$/, "");
  const caminhos = lista(meta.caminhos);
  const m = mudancas(caminhos);
  return {
    slug,
    titulo: meta.titulo ?? slug,
    resumo: meta.resumo ?? "",
    icone: meta.icone ?? "📄",
    area: meta.area || null,
    rotas: lista(meta.rotas),
    atualizado: meta.atualizado ?? null,
    corpo,
    mudancas: m ?? anterior[slug] ?? [],
  };
});

writeFileSync(SAIDA, JSON.stringify({ geradoEm: new Date().toISOString(), paginas }, null, 1) + "\n");
// Versão leve (só rotas → página) para o botão "?" da barra, que roda no navegador.
writeFileSync(join(WEB, "lib", "manual-rotas.json"), JSON.stringify(paginas.map((p) => ({ slug: p.slug, rotas: p.rotas }))) + "\n");
console.log(`manual: ${paginas.length} páginas → lib/manual-dados.json`);
