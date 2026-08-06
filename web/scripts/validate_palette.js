#!/usr/bin/env node
/**
 * Validador de paleta categórica — os seis checks da skill dataviz.
 *
 *   node scripts/validate_palette.js "<hex,hex,…>" --mode dark --surface "#152744"
 *
 * Por que este arquivo existe no repo: os comentários de lib/viz/palette.ts
 * mandam revalidar com este comando depois de QUALQUER mudança de hexe. O script
 * vinha junto com a skill, que vive em /tmp e é apagada entre sessões — a
 * instrução virava uma referência quebrada justo quando alguém fosse mexer nas
 * cores. Aqui ele acompanha o código que manda rodá-lo.
 *
 * Os checks (falhar em qualquer um = não sobe):
 *   1. banda de luminosidade — slots dentro de uma faixa, senão uns "somem" no fundo
 *   2. piso de croma        — abaixo disso a cor lê como cinza
 *   3. CVD par-adjacente    — ΔE OKLab×100 ≥ 8 sob protanopia e deuteranopia
 *   4. piso de visão normal — ΔE ≥ 15 entre adjacentes; abaixo é FAIL duro,
 *                             codificação secundária NÃO desculpa este
 *   5. contraste            — ≥ 3:1 contra a superfície do gráfico
 *   6. distância à superfície — nenhum slot pode encostar no fundo
 *
 * Matemática: OKLab (Björn Ottosson) para diferença perceptual e a simulação de
 * dicromacia de Viénot, Brettel & Mollon (1999) via espaço LMS.
 */

// ─── conversões ──────────────────────────────────────────────────────────────

const hexToRgb = (hex) => {
  const h = hex.trim().replace(/^#/, "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
};

/** sRGB gama → linear. */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** RGB linear → OKLab. */
function rgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

const oklab = (hex) => rgbToOklab(hexToRgb(hex).map(toLinear));

/** ΔE perceptual, em OKLab ×100 (a escala que a skill usa nos limiares). */
const deltaE = (a, b) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;

/** Croma OKLab ×100. */
const chroma = (lab) => Math.hypot(lab[1], lab[2]) * 100;

/** Luminância relativa WCAG. */
function luminancia(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contraste = (a, b) => {
  const la = luminancia(a), lb = luminancia(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

// ─── simulação de dicromacia (Viénot, Brettel & Mollon 1999) ─────────────────

const RGB_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_RGB = [
  [0.0809444479, -0.130504409, 0.116721066],
  [-0.0102485335, 0.0540193266, -0.113614708],
  [-0.000365296938, -0.00412161469, 0.693511405],
];

const mul = (M, v) => M.map((row) => row.reduce((s, k, i) => s + k * v[i], 0));

function simular(hex, tipo) {
  const lin = hexToRgb(hex).map(toLinear);
  const [L, M, S] = mul(RGB_LMS, lin);
  let lms;
  if (tipo === "protan")      lms = [2.02344 * M - 2.52581 * S, M, S];
  else if (tipo === "deutan") lms = [L, 0.494207 * L + 1.24827 * S, S];
  else                        lms = [L, M, -0.395913 * L + 0.801109 * M];
  const rgb = mul(LMS_RGB, lms).map((c) => Math.min(1, Math.max(0, c)));
  return rgbToOklab(rgb.map((c) => toLinear(toGamma(c))));
}

// ─── checks ──────────────────────────────────────────────────────────────────

const LIMIARES = {
  cvd: 8,            // ΔE mínimo sob dicromacia entre adjacentes
  normal: 15,        // ΔE mínimo em visão normal entre adjacentes — FAIL duro
  croma: 8,          // abaixo disso a cor lê como cinza
  contraste: 3,      // contra a superfície
  bandaL: [0.35, 0.85], // luminosidade OKLab aceitável
};

function validar(hexes, surface, pares = "adjacentes") {
  const labs = hexes.map(oklab);
  const linhas = [];
  let falhas = 0, avisos = 0;

  hexes.forEach((h, i) => {
    const L = labs[i][0];
    const C = chroma(labs[i]);
    const ct = contraste(h, surface);
    const dSurf = deltaE(labs[i], oklab(surface));

    const probs = [];
    if (L < LIMIARES.bandaL[0] || L > LIMIARES.bandaL[1]) probs.push(`L=${L.toFixed(2)} fora da banda`);
    if (C < LIMIARES.croma) probs.push(`croma ${C.toFixed(1)} < ${LIMIARES.croma} (lê como cinza)`);
    if (ct < LIMIARES.contraste) probs.push(`contraste ${ct.toFixed(2)}:1 < ${LIMIARES.contraste}:1`);
    if (dSurf < 20) probs.push(`ΔE ${dSurf.toFixed(1)} da superfície`);

    if (probs.length) falhas++;
    linhas.push({
      slot: i + 1, hex: h,
      L: L.toFixed(3), croma: C.toFixed(1),
      contraste: `${ct.toFixed(2)}:1`,
      status: probs.length ? "FAIL" : "ok",
      nota: probs.join(" · ") || "",
    });
  });

  console.log(`\nSuperfície: ${surface}   Slots: ${hexes.length}   Pares: ${pares}\n`);
  console.table(linhas);

  // Pares
  const combinacoes = [];
  if (pares === "all") {
    for (let i = 0; i < hexes.length; i++)
      for (let j = i + 1; j < hexes.length; j++) combinacoes.push([i, j]);
  } else {
    for (let i = 0; i + 1 < hexes.length; i++) combinacoes.push([i, i + 1]);
  }

  const parLinhas = [];
  let piorCvd = Infinity, piorNormal = Infinity;

  for (const [i, j] of combinacoes) {
    const dNormal = deltaE(labs[i], labs[j]);
    const dProtan = deltaE(simular(hexes[i], "protan"), simular(hexes[j], "protan"));
    const dDeutan = deltaE(simular(hexes[i], "deutan"), simular(hexes[j], "deutan"));
    const dCvd = Math.min(dProtan, dDeutan);
    piorCvd = Math.min(piorCvd, dCvd);
    piorNormal = Math.min(piorNormal, dNormal);

    let status = "ok";
    if (dNormal < LIMIARES.normal) { status = "FAIL"; falhas++; }
    else if (dCvd < LIMIARES.cvd) { status = "WARN"; avisos++; }

    parLinhas.push({
      par: `${i + 1}↔${j + 1}`,
      normal: dNormal.toFixed(1),
      protan: dProtan.toFixed(1),
      deutan: dDeutan.toFixed(1),
      status,
    });
  }

  console.table(parLinhas);

  console.log(`\nPior CVD:          ΔE ${piorCvd.toFixed(1)}  (alvo ≥ ${LIMIARES.cvd})`);
  console.log(`Pior visão normal: ΔE ${piorNormal.toFixed(1)}  (piso ${LIMIARES.normal} — FAIL duro)`);
  console.log(
    falhas === 0 && avisos === 0 ? "\n✅ PASSA — sem falhas e sem avisos."
    : falhas === 0 ? `\n⚠️  PASSA COM ${avisos} AVISO(S) — legal só com codificação secundária (legenda + tabela).`
    : `\n❌ FALHA — ${falhas} problema(s). Não subir sem corrigir.\n`,
  );

  return falhas === 0;
}

// ─── cli ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hexes = (args[0] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const flag = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

if (!hexes.length) {
  console.error('uso: node scripts/validate_palette.js "#aabbcc,#ddeeff" --mode dark --surface "#152744"');
  process.exit(2);
}

const mode = flag("mode", "dark");
const surface = flag("surface", mode === "dark" ? "#152744" : "#ffffff");
const ok = validar(hexes, surface, flag("pairs", "adjacentes"));
process.exit(ok ? 0 : 1);
