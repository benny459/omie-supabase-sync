import { test, expect } from "@playwright/test";

// Testa a lupa 🔍 nas células da prévia /relatorios/compras-por-cliente
// Verifica que o modal abre e carrega a lista sem timeout.

test("lupa em célula de compras abre modal com PCs", async ({ page }) => {
  await page.goto("/relatorios/compras-por-cliente", { waitUntil: "networkidle" });

  // Espera a tabela carregar
  await expect(page.locator("table")).toBeVisible({ timeout: 15_000 });

  // Encontra a primeira lupa 🔍 em qualquer célula com valor
  const primeiraLupa = page.locator("button:has-text('🔍')").first();
  await expect(primeiraLupa).toBeVisible({ timeout: 10_000 });

  const inicio = Date.now();
  await primeiraLupa.click();

  // Modal deve aparecer
  await expect(page.locator("text=Memorial ·")).toBeVisible({ timeout: 5_000 });

  // Verifica que NÃO tem erro de timeout
  const erroTimeout = page.locator("text=canceling statement due to statement timeout");
  const temErro = await erroTimeout.isVisible().catch(() => false);
  if (temErro) throw new Error("Modal deu timeout mesmo após o fix");

  // Espera lista renderizar (tabela ou "Nenhuma linha")
  const linhaTabela = page.locator("table tbody tr").first();
  const nenhuma = page.locator("text=Nenhuma linha");
  await expect(linhaTabela.or(nenhuma)).toBeVisible({ timeout: 30_000 });

  const duracao = Date.now() - inicio;
  console.log(`✓ Modal carregou em ${duracao}ms`);
  expect(duracao).toBeLessThan(20_000);
});

test("lupa em célula de receita abre modal com NFs", async ({ page }) => {
  await page.goto("/relatorios/compras-por-cliente", { waitUntil: "networkidle" });
  await expect(page.locator("table")).toBeVisible({ timeout: 15_000 });

  // Coluna Total receita: última antes de Resultado.
  // Estratégia simples: pega a lupa "Ver todas as NFs" via title
  const lupaReceita = page.locator("button[title='Ver todas as NFs']").first();
  await expect(lupaReceita).toBeVisible({ timeout: 10_000 });

  const inicio = Date.now();
  await lupaReceita.click();

  await expect(page.locator("text=NFs faturadas")).toBeVisible({ timeout: 5_000 });

  const erroTimeout = page.locator("text=canceling statement due to statement timeout");
  const temErro = await erroTimeout.isVisible().catch(() => false);
  if (temErro) throw new Error("Modal receita deu timeout");

  const linhaTabela = page.locator("table tbody tr").first();
  const nenhuma = page.locator("text=Nenhuma linha");
  await expect(linhaTabela.or(nenhuma)).toBeVisible({ timeout: 30_000 });

  console.log(`✓ Modal receita carregou em ${Date.now() - inicio}ms`);
});
