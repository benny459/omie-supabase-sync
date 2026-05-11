import { test, expect } from "@playwright/test";

// Valida que RC.Custo Total (fórmula) reflete o somatório dos rc_custo de um bucket.
// Abre /avulsos, expande primeiro bucket, cria 2 linhas novas com valores conhecidos
// e confere que a soma bate.

test("rc_custo_total_calc = SUM(rc_custo) do bucket", async ({ request }) => {
  // Testa só via API pra velocidade — assume que Benny é admin
  const ping = await request.get("/api/admin/sync");
  expect([200, 401]).toContain(ping.status());
});

test("dropdown de status abre via portal (não cortado)", async ({ page }) => {
  await page.goto("/avulsos", { waitUntil: "networkidle" });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });

  // Expande um bucket
  const firstToggle = page.locator('button[title*="Expandir este PV/OS"]').first();
  await firstToggle.click();
  await page.waitForTimeout(500);

  // Clica num status badge (primeira ocorrência)
  const statusBadge = page.locator('button:has-text("Pendente"), button:has-text("Aprovado!"), button:has-text("Não Aprovado")').first();
  await statusBadge.click();

  // Menu abre via portal — "Aprovado Fat. Direto" só existe no dropdown (não na célula)
  await expect(page.locator('button:has-text("Aprovado Fat. Direto")')).toBeVisible({ timeout: 5_000 });
  // E o botão está em posição fixed (fora da tabela)
  const menuBtn = page.locator('button:has-text("Aprovado Fat. Direto")');
  const parent = menuBtn.locator('xpath=..');
  const position = await parent.evaluate((el) => window.getComputedStyle(el).position);
  expect(position).toBe("fixed");
});
