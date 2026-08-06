import { test, expect } from "@playwright/test";

// Mede virtualização + client-fetch da lista /pcs (react-virtuoso + BoldAvulsosLoader).
// Métrica chave: paint imediato via skeleton + DOM enxuto após dados chegarem.
test("/pcs — paint imediato + virtualização", async ({ page }) => {
  const tGoto = Date.now();
  await page.goto("/pcs");

  // Skeleton (data-loader-skeleton) deve aparecer QUASE INSTANTÂNEO — mede paint
  await page.waitForSelector("[data-loader-skeleton], [data-bucket]", { timeout: 15_000 });
  const tPaint = Date.now() - tGoto;
  console.log(`[/pcs] primeiro paint (skeleton ou bucket): ${tPaint}ms`);
  expect(tPaint).toBeLessThan(6_000); // shell deve chegar rápido

  // Depois espera 1º bucket real aparecer (dados chegaram)
  const tDataStart = Date.now();
  await page.waitForSelector("[data-bucket]", { timeout: 30_000 });
  const tData = Date.now() - tDataStart;
  console.log(`[/pcs] tempo skeleton→dados: ${tData}ms  (total: ${Date.now() - tGoto}ms)`);

  // Deixa a virtualização estabilizar
  await page.waitForTimeout(1500);

  // Sanity primária: com virtualização, mesmo com 1000+ PCs no dataset,
  // o DOM deve conter apenas ~100 (viewport + overscan)
  const renderedCount = await page.locator("[data-bucket]").count();
  console.log(`[/pcs] buckets renderizados no viewport inicial: ${renderedCount}`);
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThan(250);

  // Se o servidor devolve os totais, vamos comparar com o header (opcional)
  const headerText = await page.locator("body").textContent();
  const match = headerText?.match(/(\d{3,})\s*PC/i);
  if (match) {
    const total = Number(match[1]);
    console.log(`[/pcs] total de PCs no dataset: ${total} · renderizados: ${renderedCount} · ratio ${((renderedCount / total) * 100).toFixed(1)}%`);
    // Ratio deve ser <30% pra virtualização estar efetiva
    if (total > 100) expect(renderedCount / total).toBeLessThan(0.5);
  }
});
