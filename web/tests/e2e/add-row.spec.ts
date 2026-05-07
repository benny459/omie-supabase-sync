import { test, expect } from "@playwright/test";

// Valida que o botão "Nova linha" em /avulsos adiciona uma linha ao bucket
// expandido e que a tabela reflete a inserção após refresh do router.

test("avulsos: AddRowButton modal cria 3 linhas", async ({ page }) => {
  await page.goto("/avulsos", { waitUntil: "networkidle" });
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });

  // Expande primeiro bucket
  const firstToggle = page.locator('button[title*="Expandir este PV/OS"]').first();
  await firstToggle.click();
  await page.waitForTimeout(500);

  await page.locator('button:has-text("Nova linha")').first().click();
  // Modal abre — escolhe 3 linhas
  await expect(page.locator('text=/Adicionar linhas/i')).toBeVisible({ timeout: 5_000 });
  await page.locator('button:has-text("3")').first().click();

  const insertPromise = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/approvals") && r.request().method() === "POST" && r.status() < 400,
    { timeout: 15_000 },
  );
  await page.locator('button:has-text("Criar 3 linhas")').click();
  const resp = await insertPromise;
  expect(resp.status()).toBeLessThan(400);
  // O INSERT inclui 3 rows no body
  const postBody = JSON.parse(resp.request().postData() || "[]");
  expect(Array.isArray(postBody) ? postBody.length : 0).toBe(3);
});

test("pcs: PcInlineAdd insere número e busca no Omie", async ({ page }) => {
  await page.goto("/pcs", { waitUntil: "networkidle" });

  const addPc = page.locator('button:has-text("Adicionar PC")').first();
  await expect(addPc).toBeVisible({ timeout: 15_000 });
  await addPc.click();

  const input = page.locator('input[placeholder*="Número do PC"]').first();
  await expect(input).toBeVisible({ timeout: 5_000 });

  // Usa um número inexistente pra não poluir o banco; validamos o feedback "não encontrado"
  await input.fill("9999999-teste");
  await input.press("Enter");

  // Espera feedback (searching → not-found)
  await expect(
    page.locator('text=/não encontrado|Não encontrado/i').first(),
  ).toBeVisible({ timeout: 15_000 });
});
