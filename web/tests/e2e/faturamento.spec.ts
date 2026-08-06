import { test, expect } from "@playwright/test";

test("/relatorios/faturamento — 4 grupos + gráfico moderno + screenshot", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/relatorios/faturamento");
  await expect(page.getByRole("heading", { name: /Faturamento diário/i })).toBeVisible({ timeout: 15_000 });

  const err = page.getByTestId("fat-error");
  if (await err.isVisible().catch(() => false)) {
    throw new Error(`Erro visível: ${await err.textContent()}`);
  }

  // KPIs principais
  await expect(page.getByText(/Faturado no período/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Atrasado \(backlog atual\)/i).first()).toBeVisible();

  // 4 grupos (Contrato / BOT / Projeto / Avulso)
  const main = page.getByRole("main");
  await expect(main.getByText("Contrato", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("BOT", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Projeto", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Avulso", { exact: true }).first()).toBeVisible();

  // 6 séries reais
  for (const s of [
    "Contrato · Serviço", "BOT · Serviço",
    "Projeto · Mercantil", "Projeto · Serviço",
    "Avulso · Mercantil", "Avulso · Serviço",
  ]) {
    await expect(page.getByRole("button", { name: s })).toBeVisible();
  }

  // YTD pra ter volume + screenshot
  await page.getByRole("button", { name: "YTD", exact: true }).click();
  await page.waitForTimeout(2000);

  // Backlog block — 3 sub-charts
  await expect(page.getByRole("heading", { name: /Backlog de faturamento/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Aging — há quanto tempo/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Runway — previsão de faturamento/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Cohort — de qual mês/i })).toBeVisible();

  await page.screenshot({ path: "/tmp/faturamento-ytd.png", fullPage: true });
});
