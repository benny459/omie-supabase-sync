import { test, expect } from "@playwright/test";

// Reproduz o cenário do Eric (compras@waterworks.com.br): clica "+ Nova linha"
// em /avulsos e /projetos. Captura status do POST e console errors.
// Diferente de add-row.spec.ts, NÃO filtra por status<400 — pega qualquer resposta
// pra revelar 401/403/RLS denial.

async function runScenario(page: import("@playwright/test").Page, modulo: "avulsos" | "projetos") {
  const consoleErrors: string[] = [];
  const networkLog: { method: string; url: string; status: number; body?: string }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("/rest/v1/approvals") || url.includes("/auth/v1/")) {
      let body: string | undefined;
      try { body = (await resp.text()).slice(0, 400); } catch { body = undefined; }
      networkLog.push({ method: resp.request().method(), url, status: resp.status(), body });
    }
  });

  await page.goto(`/${modulo}`, { waitUntil: "networkidle", timeout: 45_000 });
  await expect(page.locator("[data-bucket]").first()).toBeVisible({ timeout: 25_000 });

  // Expande todos os buckets pra revelar footer com "Nova linha"
  await page.getByRole("button", { name: /Expandir todos/i }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `tests/.screens/eric-${modulo}-before-click.png`, fullPage: true });

  const novaLinhaBtn = page.locator('button:has-text("Nova linha")').first();
  await expect(novaLinhaBtn).toBeVisible({ timeout: 10_000 });
  await novaLinhaBtn.click();

  // Modal abre
  await expect(page.locator("text=/Adicionar linhas/i")).toBeVisible({ timeout: 5_000 });

  // Captura QUALQUER resposta pro INSERT (sem filtro de status)
  const insertResp = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/approvals") && r.request().method() === "POST",
    { timeout: 20_000 },
  ).catch(() => null);

  // Clica o botão de criar (texto pode variar: "Criar linha" ou "Criar 1 linhas")
  await page.locator('button:has-text("Criar")').last().click();

  const resp = await insertResp;
  await page.screenshot({ path: `tests/.screens/eric-${modulo}-after-click.png`, fullPage: true });

  if (!resp) {
    console.log(`[${modulo}] NENHUMA RESPOSTA pro POST /approvals em 20s!`);
  } else {
    console.log(`[${modulo}] POST /approvals → ${resp.status()}`);
    const body = await resp.text().catch(() => "<sem body>");
    console.log(`[${modulo}] BODY: ${body.slice(0, 500)}`);
    const reqBody = resp.request().postData() || "<sem postData>";
    console.log(`[${modulo}] REQ BODY: ${reqBody.slice(0, 500)}`);
  }

  console.log(`[${modulo}] === CONSOLE ERRORS (${consoleErrors.length}) ===`);
  consoleErrors.forEach((e) => console.log(`  ${e}`));

  console.log(`[${modulo}] === NETWORK approvals/auth (${networkLog.length}) ===`);
  networkLog.forEach((n) => console.log(`  ${n.method} ${n.status} ${n.url.slice(0, 80)}${n.body ? "\n     body: " + n.body : ""}`));

  return { resp, consoleErrors, networkLog };
}

test("eric: AVULSOS — Nova linha", async ({ page }) => {
  const { resp } = await runScenario(page, "avulsos");
  // Não falha o teste — só queremos diagnosticar
  expect(resp).not.toBeNull();
});

test("eric: PROJETOS — Nova linha", async ({ page }) => {
  const { resp } = await runScenario(page, "projetos");
  expect(resp).not.toBeNull();
});
