import { test, expect } from "@playwright/test";

test.describe("Painel Detalhes de execução por função", () => {
  test("API retorna rows + summary", async ({ page }) => {
    await page.goto("/configuracoes");
    await page.waitForLoadState("networkidle");

    const j = await page.evaluate(async () => {
      const r = await fetch("/api/admin/run-details");
      return { status: r.status, body: await r.json() };
    });
    expect(j.status).toBe(200);
    expect(j.body.summary.total).toBeGreaterThan(0);
    console.log("Summary:", JSON.stringify(j.body.summary));
    // Tem que haver pelo menos 1 row classificada em cada workflow conhecido
    expect(j.body.summary.by_kind.finance).toBeGreaterThan(0);
    expect(j.body.summary.by_kind.orders).toBeGreaterThan(0);
    expect(j.body.summary.by_kind.sales).toBeGreaterThan(0);
  });

  test("renderiza tabela com módulos e mostra erros visivelmente", async ({ page }) => {
    await page.goto("/configuracoes");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);  // espera load do painel

    // Tem alguma linha com Erro? (lancamentos_cc tem erro conhecido)
    const erroBadge = page.locator('text=/✗ Erro/').first();
    await expect(erroBadge).toBeVisible({ timeout: 10_000 });

    // Filtro só erros
    await page.getByRole("button", { name: /✗ Erro/ }).click();
    await page.waitForTimeout(500);
    const erroRows = page.locator('tbody tr');
    const erroCount = await erroRows.count();
    console.log(`Linhas com erro visíveis: ${erroCount}`);
    expect(erroCount).toBeGreaterThan(0);
  });
});
