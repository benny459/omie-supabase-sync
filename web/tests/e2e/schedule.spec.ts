import { test, expect } from "@playwright/test";

// Valida fluxo completo de editar agenda em /configuracoes:
// abrir modal → escolher 2h/24/7 → salvar → ver modal de confirmação com próximo disparo.

test("configuracoes: editar agenda mostra confirmação com próximo disparo", async ({ page }) => {
  await page.goto("/configuracoes", { waitUntil: "networkidle" });

  // Espera o painel carregar (botão "Editar agenda" aparece em cada workflow)
  const firstEdit = page.locator('button:has-text("Editar agenda")').first();
  await expect(firstEdit).toBeVisible({ timeout: 20_000 });
  await firstEdit.click();

  // Modal aberto
  await expect(page.locator('text=/Editar agenda —/').first()).toBeVisible();

  // Escolhe intervalo 2h
  await page.locator('button:has-text("2h")').first().click();

  // Escolhe janela 24/7 (já é o default, mas clica pra garantir)
  await page.locator('button:has-text("24/7")').first().click();

  // Intercepta resposta do set-schedule pra garantir sucesso
  const setPromise = page.waitForResponse(
    (r) => r.url().includes("/api/admin/sync") && r.request().method() === "POST" && r.status() < 400,
    { timeout: 30_000 },
  );
  await page.locator('button:has-text("Salvar agenda")').click();
  const resp = await setPromise;
  expect(resp.status()).toBeLessThan(400);

  // Modal de confirmação deve mostrar "Agenda salva" + "Próximo disparo"
  await expect(page.locator('text=/Agenda salva/i').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=/Próximo disparo/i').first()).toBeVisible();
  await expect(page.locator('text=/BRT/i').first()).toBeVisible();
});
