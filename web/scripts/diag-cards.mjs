// Aplica filtros Aberto+Pendentes e dumpa parent chain do primeiro card quebrado.
import { chromium } from "playwright";
import path from "node:path";

const browser = await chromium.launchPersistentContext(
  path.resolve(".playwright-profile"),
  { headless: false, viewport: { width: 2440, height: 1500 } }
);
const page = browser.pages()[0] ?? await browser.newPage();
await page.setViewportSize({ width: 2440, height: 1500 });

await page.goto("https://painel.waterworks.com.br/avulsos", { waitUntil: "domcontentloaded" });
await page.waitForSelector("aside", { timeout: 60_000 });
await page.waitForFunction(() => document.querySelectorAll('[class*="border-ww-borderStrong"]').length >= 20);
await page.waitForTimeout(1500);

console.log("→ Clicando em Aberto + Pendentes...");
const aberto = page.locator('button:has-text("Aberto")').first();
if (await aberto.count()) { await aberto.click(); await page.waitForTimeout(400); }
const pend = page.locator('button:has-text("Pendentes")').first();
if (await pend.count()) { await pend.click(); await page.waitForTimeout(800); }
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[class*="border-ww-borderStrong"][class*="rounded-[12px]"]'));
  const widths = cards.map((c) => c.getBoundingClientRect().width);
  // Encontra o primeiro card cuja largura difere significativamente do anterior
  let breakIdx = -1;
  for (let i = 1; i < cards.length; i++) {
    if (Math.abs(widths[i] - widths[i - 1]) > 50) { breakIdx = i; break; }
  }
  function dumpParents(el, depth = 8) {
    const chain = [];
    let n = el, d = 0;
    while (n && d < depth) {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      chain.push({
        tag: n.tagName,
        cls: ((typeof n.className === "string") ? n.className : String(n.className)).slice(0, 150),
        w: Math.round(r.width), x: Math.round(r.x), h: Math.round(r.height),
        display: cs.display,
        position: cs.position,
        overflow: cs.overflow,
        marginLeft: cs.marginLeft,
        paddingLeft: cs.paddingLeft,
        width: cs.width,
        minWidth: cs.minWidth,
        maxWidth: cs.maxWidth,
      });
      n = n.parentElement; d++;
    }
    return chain;
  }
  return {
    total: cards.length,
    breakIdx,
    widths: widths.slice(0, Math.min(20, cards.length)),
    cardBefore: breakIdx > 0 ? {
      idx: breakIdx - 1,
      label: (cards[breakIdx - 1].querySelector(".min-w-0 span")?.textContent || "").trim().slice(0, 30),
      chain: dumpParents(cards[breakIdx - 1]),
    } : null,
    cardAt: breakIdx >= 0 ? {
      idx: breakIdx,
      label: (cards[breakIdx].querySelector(".min-w-0 span")?.textContent || "").trim().slice(0, 30),
      chain: dumpParents(cards[breakIdx]),
      // Comparar parents diretos
      sameParent: cards[breakIdx].parentElement === cards[breakIdx - 1]?.parentElement,
    } : null,
    cardAtHTML: breakIdx >= 0 ? cards[breakIdx].outerHTML.slice(0, 1500) : null,
    // Screenshot dimensões
    docScrollW: document.documentElement.scrollWidth,
  };
});

console.log("Total cards:", result.total);
console.log("Break idx:", result.breakIdx);
console.log("First 20 widths:", result.widths.map((w) => Math.round(w)).join(", "));
console.log("Doc scroll W:", result.docScrollW);

if (result.breakIdx < 0) {
  console.log("✓ Nenhuma transição abrupta — todos os cards têm largura coerente!");
  await page.screenshot({ path: "/tmp/diag-no-break.png" });
} else {
  console.log(`\n=== CARD ${result.cardBefore.idx} antes (correto) — ${result.cardBefore.label} ===`);
  for (const p of result.cardBefore.chain) console.log(`  <${p.tag}> w=${p.w} x=${p.x} h=${p.h} disp=${p.display} pos=${p.position} ml=${p.marginLeft} cls="${p.cls}"`);
  console.log(`\n=== CARD ${result.cardAt.idx} BREAK (anômalo) — ${result.cardAt.label} ===`);
  for (const p of result.cardAt.chain) console.log(`  <${p.tag}> w=${p.w} x=${p.x} h=${p.h} disp=${p.display} pos=${p.position} ml=${p.marginLeft} cls="${p.cls}"`);
  console.log(`\nMesmo parent direto? ${result.cardAt.sameParent}`);
  console.log(`\n=== HTML do CARD QUEBRADO (1500 chars) ===`);
  console.log(result.cardAtHTML);
  await page.screenshot({ path: "/tmp/diag-with-break.png", fullPage: false });
  console.log("\n📸 Screenshot: /tmp/diag-with-break.png");
}

console.log("\n→ Browser permanece aberto.");
await new Promise(() => {});
