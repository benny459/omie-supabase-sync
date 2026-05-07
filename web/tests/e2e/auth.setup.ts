import { test as setup, expect } from "@playwright/test";

const authFile = "tests/.auth/user.json";

setup("autentica com credenciais", async ({ page }) => {
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;
  if (!email || !password) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");

  await page.goto("/login");
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(password);
  // Clica em qualquer botão submit do form
  await page.locator("button[type=submit], form button").first().click();

  // Espera redirect pra rota autenticada (/, /avulsos, etc)
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 });
  // Grava state pra reusar em outros specs
  await page.context().storageState({ path: authFile });
});
