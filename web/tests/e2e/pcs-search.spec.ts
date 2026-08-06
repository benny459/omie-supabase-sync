import { test, expect } from "@playwright/test";

test("/pcs — busca por texto responde rápido sem travar", async ({ page }) => {
  await page.goto("/pcs");
  await page.waitForSelector("[data-bucket]", { timeout: 30_000 });
  await page.waitForTimeout(1000);

  const initialCount = await page.locator("[data-bucket]").count();
  console.log(`[/pcs] buckets iniciais: ${initialCount}`);

  // Busca box (input "Filtrar nesta página" no top do BoldAvulsosView)
  const searchInput = page.getByPlaceholder(/Filtrar nesta página/i);
  await expect(searchInput).toBeVisible({ timeout: 5_000 });

  // Digita algo aleatório que provavelmente casa com poucos → mede responsividade
  const q = "PC";
  const t0 = Date.now();
  await searchInput.fill(q);
  await page.waitForTimeout(400); // deferred value settle
  const t1 = Date.now();
  console.log(`[/pcs] busca "${q}" aplicada em ${t1 - t0}ms`);

  const afterCount = await page.locator("[data-bucket]").count();
  console.log(`[/pcs] buckets após busca: ${afterCount}`);

  // Limpa
  await searchInput.fill("");
  await page.waitForTimeout(400);

  // Digita 5 chars rápido em sequência e mede — não pode travar a UI
  const t2 = Date.now();
  await searchInput.type("HAPVI", { delay: 30 });
  const t3 = Date.now();
  console.log(`[/pcs] digitou 5 chars em ${t3 - t2}ms (delay 30ms cada = ~150ms mínimo)`);
  // A digitação total não pode passar de 3s (30ms/char * 5 chars + margem grande)
  expect(t3 - t2).toBeLessThan(3_000);

  await page.waitForTimeout(600);
  const finalCount = await page.locator("[data-bucket]").count();
  console.log(`[/pcs] buckets após "HAPVI": ${finalCount}`);
});
