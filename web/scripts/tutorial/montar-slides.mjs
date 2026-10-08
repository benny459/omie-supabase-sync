#!/usr/bin/env node
// Vídeo narrado a partir de capturas de tela (08/10/26) — para tutoriais feitos navegando no Chrome
// (sem robô/login próprio). Cada passo = uma imagem + uma fala; a imagem fica na tela pelo tempo da fala.
// Uso (em web/): node scripts/tutorial/montar-slides.mjs --roteiro tutoriais/<slug>/slides.json
//   slides.json: { "titulo": "...", "passos": [ { "img": "caminho/01.png", "fala": "..." }, ... ] }
// Requisitos: edge-tts (pip3 install edge-tts) e ffmpeg (brew install ffmpeg).
// Saída: tutoriais/<slug>/<slug>.mp4 (1440×900, legenda como faixa liga/desliga) + audio/ e partes/.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const caminho = opt("--roteiro");
if (!caminho) { console.error("uso: --roteiro tutoriais/<slug>/slides.json"); process.exit(1); }
const VOZ = process.env.TUTORIAL_VOZ || "pt-BR-AntonioNeural";
const EDGE = process.env.EDGE_TTS_BIN || (existsSync(join(homedir(), "Library/Python/3.9/bin/edge-tts")) ? join(homedir(), "Library/Python/3.9/bin/edge-tts") : "edge-tts");
const PAUSA = 0.6; // segundos de respiro depois de cada fala
const VOZ_EN = process.env.TUTORIAL_VOZ_EN || "en-US-AndrewMultilingualNeural";
// palavras ditas em inglês (voz americana encaixada na frase): "budget" soa "bâdjet", não "budjé"
const INGLES = /\b(budget)\b/gi;
const W = Number(process.env.TUTORIAL_W || 1920), H = Number(process.env.TUTORIAL_H || 1200);

const dir = dirname(caminho), slug = basename(dir);
const roteiro = JSON.parse(readFileSync(caminho, "utf8"));
mkdirSync(join(dir, "audio"), { recursive: true });
mkdirSync(join(dir, "partes"), { recursive: true });

const partes = []; const srt = []; let t = 0;
for (const [i, p] of roteiro.passos.entries()) {
  const n = String(i + 1).padStart(2, "0");
  const mp3 = join(dir, "audio", `${n}.mp3`);
  if (!existsSync(mp3) || args.includes("--refazer-voz")) falar(p.fala, mp3, join(dir, "audio", `${n}`));
  const dur = duracao(mp3) + PAUSA;
  const img = resolve(dir, p.img);
  if (!existsSync(img)) throw new Error(`passo ${i + 1}: imagem não encontrada: ${img}`);
  const mp4 = join(dir, "partes", `${n}.mp4`);
  // imagem parada pelo tempo da fala (+ respiro), ajustada a 1440×900 sem distorcer
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", img, "-i", mp3,
    "-filter_complex", `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0c1830,format=yuv420p,fps=30[v];[1:a]apad=pad_dur=${PAUSA}[a]`,
    "-map", "[v]", "-map", "[a]", "-t", dur.toFixed(3), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", mp4]);
  partes.push(mp4);
  srt.push(`${i + 1}\n${ts(t)} --> ${ts(t + dur - PAUSA)}\n${p.fala}\n`);
  t += dur;
  console.log(`✓ passo ${i + 1} (${dur.toFixed(1)}s)`);
}

const lista = join(dir, "partes", "lista.txt");
writeFileSync(lista, partes.map((f) => `file '${resolve(f)}'`).join("\n"));
const srtPath = join(dir, "legendas.srt");
writeFileSync(srtPath, srt.join("\n"));
const out = join(dir, `${slug}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista, "-i", srtPath,
  "-map", "0:v", "-map", "0:a", "-map", "1:s", "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
  "-metadata:s:s:0", "language=por", "-metadata", `title=${roteiro.titulo || slug}`, "-movflags", "+faststart", out]);
console.log(`✓ vídeo: ${out} (${t.toFixed(0)}s)`);

/** Fala em pt-BR; as palavras de INGLES saem na voz americana e são emendadas na frase. */
function falar(texto, mp3, base) {
  const tts = (voz, t, out) => {
    const r = spawnSync(EDGE, ["--voice", voz, "--rate", "+4%", "--text", t, "--write-media", out], { stdio: "inherit" });
    if (r.status) throw new Error(`edge-tts falhou: ${t.slice(0, 40)}`);
  };
  const partes = texto.split(INGLES).filter((t) => t && /[\p{L}\p{N}]/u.test(t));
  if (partes.length === 1) return tts(VOZ, texto, mp3);
  const arqs = partes.map((t, k) => {
    const out = `${base}-p${k}.mp3`;
    INGLES.lastIndex = 0;
    if (new RegExp(`^${INGLES.source}$`, "i").test(t.trim())) tts(VOZ_EN, t.trim(), out); else tts(VOZ, t.trim(), out);
    return out;
  });
  const lista = `${base}-lista.txt`;
  writeFileSync(lista, arqs.map((f) => `file '${resolve(f)}'`).join("\n"));
  // reamostra tudo igual antes de juntar (as duas vozes vêm no mesmo formato, mas por garantia)
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lista, "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "2", mp3]);
}

function duracao(f) { return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString()); }
function ts(s) { const ms = Math.round(s * 1000); return new Date(ms).toISOString().substr(11, 8) + "," + String(ms % 1000).padStart(3, "0"); }
