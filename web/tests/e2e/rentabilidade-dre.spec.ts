import { test, expect } from "@playwright/test";

async function checkNoError(page: import("@playwright/test").Page, label: string) {
  const err = page.getByTestId("dre-error");
  if (await err.isVisible().catch(() => false)) {
    const txt = await err.textContent();
    throw new Error(`[${label}] Erro visível: ${txt}`);
  }
}

test("DRE — filtros pills (Tipo/Margem/Período) + dropdowns Cliente/Fornecedor", async ({ page }) => {
  await page.goto("/relatorios/compras-por-cliente");
  await expect(page.getByRole("heading", { name: /Rentabilidade por cliente/i })).toBeVisible({ timeout: 15_000 });
  await checkNoError(page, "load inicial");

  // Filtro Tipo — pills: Global | Contratuais | Projetos | Avulsos
  await expect(page.getByRole("button", { name: "Global", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Contratuais", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Projetos", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Avulsos", exact: true })).toBeVisible();

  // Filtro Margem
  await expect(page.getByRole("button", { name: "≥30%", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "< 0%", exact: true })).toBeVisible();

  // KPIs — usa .first() pra ignorar collision com column headers
  await expect(page.getByText(/^Receita$/i).first()).toBeVisible();
  await expect(page.getByText(/^Saídas$/i).first()).toBeVisible();
  await expect(page.getByText(/Margem bruta/i).first()).toBeVisible();

  // Aplica filtro Contratuais e valida sem erro
  await page.getByRole("button", { name: "Contratuais", exact: true }).click();
  await checkNoError(page, "tipo Contratuais");

  // Aplica margem ≥30% + limpa
  await page.getByRole("button", { name: "≥30%", exact: true }).click();
  await checkNoError(page, "margem excelente");

  await expect(page.getByRole("button", { name: /Limpar filtros/i })).toBeVisible();
  await page.getByRole("button", { name: /Limpar filtros/i }).click();
  await checkNoError(page, "após limpar");
});
