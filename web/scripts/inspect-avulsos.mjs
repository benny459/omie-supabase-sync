// Diagnóstico viewport-largo + filtros Aberto+Pendentes pra reproduzir o bug.
import { chromium } from "playwright";
import path from "node:path";

const URL = "https://painel.waterworks.com.br/avulsos";

const browser = await chromium.launchPersistentContext(
  path.resolve(".playwright-profile"),
  { headless: false, viewport: { width: 2440, height: 1500 }, deviceScaleFactor: 1 }
);
const page = browser.pages()[0] ?? await browser.newPage();
await page.setViewportSize({ width: 2440, height: 1500 });

console.log("→ Abrindo /avulsos em 2440×1500...");
await page.goto(URL, { waitUntil: "domcontentloaded" });

await page.waitForSelector("aside", { timeout: 180_000 });
await page.waitForFunction(() => document.querySelectorAll('[class*="border-ww-borderStrong"][class*="rounded-[12px]"]').length >= 3, { timeout: 30_000 });
await page.waitForTimeout(1500);

console.log("→ Aplicando filtros: Aberto (PV-Status) + Pendentes (PC-Aprovação)...");
// Tenta clicar no card "Aberto"
const abertoBtn = await page.locator('button:has-text("Aberto")').first();
if (await abertoBtn.count()) { await abertoBtn.click(); await page.waitForTimeout(300); }
const pendBtn = await page.locator('button:has-text("Pendentes")').first();
if (await pendBtn.count()) { await pendBtn.click(); await page.waitForTimeout(800); }

// Dá tempo do React re-renderizar a lista filtrada
await page.waitForTimeout(1200);

const dump = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[class*="border-ww-borderStrong"][class*="rounded-[12px]"]'));
  const main = document.querySelector("main");
  const list = document.querySelector(".space-y-5");
  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const rect = card.getBoundingClientRect();
    const csCard = getComputedStyle(card);
    const header = card.querySelector("button");
    const cs = header ? getComputedStyle(header) : null;
    const headerRect = header ? header.getBoundingClientRect() : null;
    const lblSpan = header?.querySelector(".min-w-0 span");
    const label = (lblSpan?.textContent || "").trim().slice(0, 30);
    const open = card.querySelector(".overflow-x-auto") !== null; // body com tabela = card aberto
    out.push({
      i, label, open,
      cardW: Math.round(rect.width),
      cardH: Math.round(rect.height),
      cardX: Math.round(rect.x),
      cardOverflow: csCard.overflow,
      headerDisplay: cs?.display,
      headerGrid: cs?.gridTemplateColumns,
    });
  }
  const mainRect = main?.getBoundingClientRect();
  const listRect = list?.getBoundingClientRect();
  return {
    cards: out,
    mainW: Math.round(mainRect?.width ?? 0),
    mainOverflow: main ? getComputedStyle(main).overflowX : null,
    listW: Math.round(listRect?.width ?? 0),
    docScrollW: document.documentElement.scrollWidth,
    docScrollH: document.documentElement.scrollHeight,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
  };
});

console.log("\n=== LAYOUT DUMP (Aberto+Pendentes) ===");
console.log(`Viewport: ${dump.viewportW}×${dump.viewportH} | Doc scroll: ${dump.docScrollW}×${dump.docScrollH}`);
console.log(`<main> width: ${dump.mainW}px | overflowX: ${dump.mainOverflow}`);
console.log(`Cards list width: ${dump.listW}px | total cards: ${dump.cards.length}`);
console.log("\nidx | label                          | open | W×H        | x    | grid");
console.log("----|--------------------------------|------|------------|------|---------------------------------");
for (const c of dump.cards) {
  console.log(`${String(c.i).padStart(3)} | ${c.label.padEnd(30)} | ${c.open ? "YES " : "no  "} | ${String(c.cardW).padStart(5)}×${String(c.cardH).padStart(4)} | ${String(c.cardX).padStart(4)} | ${c.headerGrid}`);
}

// Anomalias: largura DIFERENTE da mediana (cards normais = 1 width)
const widths = dump.cards.map((c) => c.cardW);
const sorted = [...widths].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const anom = dump.cards.filter((c) => Math.abs(c.cardW - median) > 50);
console.log(`\nMediana cardW: ${median}px`);
if (anom.length) {
  console.log(`⚠ ${anom.length} cards anômalos:`);
  for (const c of anom) console.log(`  [${c.i}] ${c.label}: w=${c.cardW} h=${c.cardH} grid="${c.headerGrid}"`);
} else {
  console.log("✓ NENHUM card anômalo detectado.");
}

// Anomalias por altura (cards muito mais altos que mediana = body aberto ou layout vertical)
const heights = dump.cards.map((c) => c.cardH);
const hSorted = [...heights].sort((a, b) => a - b);
const hMed = hSorted[Math.floor(hSorted.length / 2)];
const hAnom = dump.cards.filter((c) => c.cardH > hMed * 1.6 && !c.open);
if (hAnom.length) {
  console.log(`\n⚠ Cards FECHADOS muito altos (≥1.6× mediana ${hMed}px):`);
  for (const c of hAnom) console.log(`  [${c.i}] ${c.label}: h=${c.cardH}px (open=${c.open})`);
}

// Screenshot pra eu ver visualmente
await page.screenshot({ path: "/tmp/avulsos-aberto-pendentes.png", fullPage: false });
console.log("\n📸 Screenshot salvo: /tmp/avulsos-aberto-pendentes.png");

console.log("\n→ Mantendo browser aberto. Ctrl+C pra fechar.");
await new Promise(() => {});
