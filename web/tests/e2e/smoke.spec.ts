import { test, expect } from "@playwright/test";

// Smoke: valida que páginas públicas renderizam sem 500.
// Rotas autenticadas precisam de sessão — criar .spec separado depois
// com storageState configurado a partir de um magic link de teste.

test.describe("smoke: rotas públicas", () => {
  test("/ redireciona pra /login quando sem sessão", async ({ page }) => {
    const res = await page.goto("/", { waitUntil: "networkidle" });
    expect(res?.ok()).toBeTruthy();
    // deveria cair em /login eventualmente
    await expect(page).toHaveURL(/\/login/);
  });

  test("/login renderiza form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type=email]").first()).toBeVisible();
  });
});
