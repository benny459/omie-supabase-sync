#!/usr/bin/env node
// Gera um vídeo-tutorial narrado a partir de um roteiro JSON.
// Uso (em web/): node --env-file=.env.local scripts/tutorial/gravar.mjs --roteiro tutoriais/<slug>/roteiro.json [--dry] [--so-audio] [--todos]
// Requisitos: @playwright/test (já no projeto) ; pip3 install edge-tts ; ffmpeg no PATH (brew install ffmpeg).
// Ajustes 08/10/26: playwright do projeto; legenda desenhada na página (o ffmpeg do brew vem sem libass);
// o trecho do login é cortado e a narração alinhada ao vídeo; espera de rede com limite (o painel faz polling).
// Env: TUTORIAL_BASE_URL, TUTORIAL_LOGIN_EMAIL, TUTORIAL_LOGIN_SENHA, (opcional) ELEVENLABS_API_KEY, TUTORIAL_VOZ

import { chromium } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = process.env.TUTORIAL_BASE_URL || "http://localhost:3000";
const VOZ = process.env.TUTORIAL_VOZ || "pt-BR-AntonioNeural";

const roteiros = flag("--todos")
  ? readdirSync("tutoriais").map((d) => join("tutoriais", d, "roteiro.json")).filter(existsSync)
  : [opt("--roteiro")];

for (const r of roteiros) await gerar(r);

async function gerar(caminho) {
  const dir = dirname(caminho);
  const slug = basename(dir);
  const roteiro = JSON.parse(readFileSync(caminho, "utf8"));
  const passos = roteiro.passos;
  mkdirSync(join(dir, "audio"), { recursive: true });

  // 1) narração por passo → mp3 + duração
  if (!flag("--dry")) {
    for (const [i, p] of passos.entries()) {
      const mp3 = join(dir, "audio", `${String(i).padStart(2, "0")}.mp3`);
      if (!existsSync(mp3) || flag("--so-audio")) await sintetizar(p.fala, mp3);
      p._dur = duracao(mp3);
      p._mp3 = mp3;
    }
  }
  if (flag("--so-audio")) return montar(dir, slug, passos);

  // 2) navegação gravada
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: flag("--dry") ? undefined : { dir: join(dir, "video"), size: { width: 1440, height: 900 } },
    locale: "pt-BR",
  });
  const page = await ctx.newPage();
  const t0 = Date.now(); // o vídeo começa aqui (o login é cortado na montagem)
  await page.addInitScript(CURSOR_CSS_JS);
  await login(page);

  const marcas = []; // {inicio, fim} em ms de cada passo desde o início do vídeo, para alinhar o áudio
  for (const [i, p] of passos.entries()) {
    if (p.url) { await page.goto(BASE + p.url, { waitUntil: "domcontentloaded" }); await quieto(page); }
    if (p.esperar) await page.locator(p.esperar).first().waitFor({ timeout: 30000 }).catch(() => console.error(`⚠ passo ${i + 1}: não apareceu ${p.esperar}`));
    const el = p.seletor ? page.locator(p.seletor).first() : null;
    if (el) {
      const n = await el.count();
      if (!n && p.opcional) { console.log(`· passo ${i + 1}: opcional, não está na tela — pulado`); marcas.push(null); continue; }
      if (!n) { console.error(`✗ passo ${i + 1}: seletor não encontrado: ${p.seletor}`); process.exitCode = 1; if (flag("--dry")) continue; }
      await el.scrollIntoViewIfNeeded();
      await page.evaluate(([sel, leg, fala]) => window.__tut.destacar(sel, leg, fala), [p.seletor, p.legenda || "", p.fala || ""]);
    } else {
      await page.evaluate(([leg, fala]) => { window.__tut.legenda(leg); window.__tut.fala(fala); }, [p.legenda || "", p.fala || ""]);
    }
    const inicio = Date.now() - t0;
    if (flag("--dry")) { console.log(`✓ passo ${i + 1}: ${p.legenda || p.fala.slice(0, 50)}`); continue; }
    // fala começa, ação acontece 40% da fala depois (dá tempo de o olho achar o destaque)
    const dur = p._dur * 1000;
    await page.waitForTimeout(Math.min(dur * 0.4, 2500));
    if (el && p.acao === "click") { await el.click(); await quieto(page, 4000); }
    if (el && p.acao === "fill") await el.fill(p.valor || "");
    if (el && p.acao === "hover") await el.hover();
    await page.waitForTimeout(Math.max(dur * 0.6, 800) + 400);
    await page.evaluate(() => window.__tut.limpar());
    marcas.push({ inicio, fim: Date.now() - t0 });
  }
  await ctx.close(); await browser.close();
  if (flag("--dry")) return console.log("dry run ok:", slug);

  const webm = readdirSync(join(dir, "video")).map((f) => join(dir, "video", f)).sort().pop();
  writeFileSync(join(dir, "marcas.json"), JSON.stringify(marcas, null, 2));
  montar(dir, slug, passos, webm, marcas);
}

function montar(dir, slug, todos, webm, todasMarcas) {
  webm = webm || readdirSync(join(dir, "video")).map((f) => join(dir, "video", f)).sort().pop();
  todasMarcas = todasMarcas || JSON.parse(readFileSync(join(dir, "marcas.json"), "utf8"));
  // passos opcionais pulados na gravação ficam fora do áudio e da legenda
  const passos = todos.filter((_, i) => todasMarcas[i]);
  const marcas = todasMarcas.filter(Boolean);
  const corte = Math.max(0, marcas[0].inicio - 300); // tira o login do começo do vídeo
  const rel = (ms) => Math.max(0, ms - corte);
  const inputs = passos.flatMap((p) => ["-i", p._mp3]);
  const delays = passos.map((p, i) => `[${i + 1}:a]adelay=${rel(marcas[i].inicio)}|${rel(marcas[i].inicio)}[a${i}]`).join(";");
  const mix = passos.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${passos.length}:normalize=0[aout]`;
  // a fala já está desenhada na tela; o .srt vira também faixa de legenda (liga/desliga no player)
  const srtPath = join(dir, "legendas.srt");
  writeFileSync(srtPath, passos.map((p, i) => `${i + 1}\n${ts(rel(marcas[i].inicio))} --> ${ts(rel(marcas[i].fim))}\n${p.fala}\n`).join("\n"));
  const out = join(dir, `${slug}.mp4`);
  execFileSync("ffmpeg", ["-y", "-ss", (corte / 1000).toFixed(3), "-i", webm, ...inputs, "-i", srtPath,
    "-filter_complex", `${delays};${mix}`,
    "-map", "0:v", "-map", "[aout]", "-map", `${passos.length + 1}:s`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-c:s", "mov_text", "-metadata:s:s:0", "language=por", "-shortest", out], { stdio: "inherit" });
  console.log("✓ vídeo:", out, `(${duracao(out).toFixed(0)}s)`);
}

/** Espera a página acalmar (rede quieta), com limite — o painel faz polling e nunca fica 100% parado. */
async function quieto(page, ms = 8000) {
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => null);
  await page.waitForTimeout(500);
}

async function sintetizar(texto, mp3) {
  if (process.env.ELEVENLABS_API_KEY) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
      method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text: texto, model_id: "eleven_multilingual_v2" }) });
    writeFileSync(mp3, Buffer.from(await r.arrayBuffer())); return;
  }
  const r = spawnSync("edge-tts", ["--voice", VOZ, "--rate", "+5%", "--text", texto, "--write-media", mp3], { stdio: "inherit" });
  if (r.status) throw new Error("edge-tts falhou (pip install edge-tts)");
}
function duracao(f) { return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString()); }
function ts(ms) { const d = new Date(ms); return d.toISOString().substr(11, 8) + "," + String(ms % 1000).padStart(3, "0"); }

async function login(page) {
  await page.goto(BASE + "/login");
  if (await page.locator("input[type=email]").count()) {
    await page.fill("input[type=email]", process.env.TUTORIAL_LOGIN_EMAIL || "");
    await page.fill("input[type=password]", process.env.TUTORIAL_LOGIN_SENHA || "");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 })
      .catch(() => { throw new Error("Login falhou — confira TUTORIAL_LOGIN_EMAIL/SENHA no .env.local"); });
    await quieto(page);
  }
}

// Cursor grande + anel de destaque + legenda — injetado em toda página
const CURSOR_CSS_JS = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    #__tut_ring{position:fixed;z-index:999999;border:3px solid #f5b547;border-radius:10px;box-shadow:0 0 0 6px rgba(245,181,71,.25),0 0 0 9999px rgba(5,12,26,.35);pointer-events:none;transition:all .35s ease}
    #__tut_fala{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:999999;max-width:1100px;width:max-content;background:rgba(8,14,28,.88);color:#fff;border-radius:10px;padding:10px 18px;font:500 19px/1.35 -apple-system,system-ui,sans-serif;text-align:center;pointer-events:none}
    #__tut_leg{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:999999;background:#0c1830;color:#fff;border:1px solid #f5b547;border-radius:999px;padding:8px 16px;font:600 15px -apple-system,system-ui,sans-serif;pointer-events:none}
    #__tut_cur{position:fixed;z-index:999999;width:22px;height:22px;border-radius:50%;background:rgba(110,168,255,.55);border:2px solid #fff;pointer-events:none;transform:translate(-50%,-50%);transition:all .25s ease}\`;
  document.documentElement.appendChild(css);
  window.__tut = {
    fala(t){ let f=document.getElementById('__tut_fala')||Object.assign(document.createElement('div'),{id:'__tut_fala'}); document.body.appendChild(f); f.textContent=t; f.style.display=t?'block':'none'; },
    destacar(sel, leg, fala){ this.fala(fala||''); const el=document.querySelector(sel); if(!el) return; const r=el.getBoundingClientRect();
      let ring=document.getElementById('__tut_ring')||Object.assign(document.createElement('div'),{id:'__tut_ring'}); document.body.appendChild(ring);
      Object.assign(ring.style,{left:(r.left-6)+'px',top:(r.top-6)+'px',width:(r.width+12)+'px',height:(r.height+12)+'px'});
      let cur=document.getElementById('__tut_cur')||Object.assign(document.createElement('div'),{id:'__tut_cur'}); document.body.appendChild(cur);
      Object.assign(cur.style,{left:(r.left+r.width/2)+'px',top:(r.top+r.height/2)+'px'});
      this.legenda(leg); },
    legenda(t){ let l=document.getElementById('__tut_leg')||Object.assign(document.createElement('div'),{id:'__tut_leg'}); document.body.appendChild(l); l.textContent=t; l.style.display=t?'block':'none'; },
    limpar(){ ['__tut_ring','__tut_leg','__tut_fala'].forEach(id=>document.getElementById(id)?.remove()); }
  };
})();`;
