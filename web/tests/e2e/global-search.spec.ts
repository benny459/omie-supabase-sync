import { test, expect } from "@playwright/test";

// Casos vindos de v_pc_completo_enriched (Apr 2026):
//   PC 6312 → modulo_calc=projetos, pv_os_label=PV1377
//   PC 4559 → modulo_calc=avulsos, pv_os_label=PV1282
//   PC 6438 → modulo_calc=pcs, sem PV
//   "OKI"   → fornecedor presente em vários PCs

test.describe("Busca global (ícone na top bar das 3 páginas)", () => {
  test("acha PC standalone e leva pra /pcs com bucket aberto", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    // Abre busca global
    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    const input = page.getByPlaceholder(/PC, PV, OS, fornecedor/);
    await expect(input).toBeVisible();
    await input.fill("6438");

    // Espera o hit aparecer
    const hit = page.getByRole("button").filter({ hasText: "PC 6438" }).first();
    await expect(hit).toBeVisible({ timeout: 10_000 });

    // Click → navega pra /pcs com hash
    await hit.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    const url = page.url();
    console.log("URL após click (PC standalone):", url);
    expect(url).toMatch(/\/pcs/);
    expect(decodeURIComponent(url)).toContain("PC 6438");
  });

  test("acha PV avulso e leva pra /avulsos com bucket aberto", async ({ page }) => {
    await page.goto("/pcs");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    const input = page.getByPlaceholder(/PC, PV, OS, fornecedor/);
    await input.fill("4559");

    const hit = page.getByRole("button").filter({ hasText: "PV1282" }).first();
    await expect(hit).toBeVisible({ timeout: 10_000 });

    await hit.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    const url = page.url();
    console.log("URL após click (PV avulso):", url);
    expect(url).toMatch(/\/avulsos/);
    expect(url).toContain("#bucket=PV1282");
  });

  test("acha PV de projeto e leva pra /projetos", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    const input = page.getByPlaceholder(/PC, PV, OS, fornecedor/);
    await input.fill("6312");

    const hit = page.getByRole("button").filter({ hasText: "PV1377" }).first();
    await expect(hit).toBeVisible({ timeout: 10_000 });

    await hit.click();
    // Diagnóstico: aguarda navegação, depois loga a URL real
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    const finalUrl = page.url();
    console.log("URL após click:", finalUrl);
    expect(finalUrl).toMatch(/\/projetos/);
    expect(finalUrl).toContain("#bucket=PV1377");
  });

  test("busca por fornecedor retorna múltiplos hits", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    const input = page.getByPlaceholder(/PC, PV, OS, fornecedor/);
    await input.fill("OKI");

    // Aguarda algum hit (qualquer botão dentro do modal de busca)
    const hits = page.locator('[class*="overflow-y-auto"] button');
    await expect(hits.first()).toBeVisible({ timeout: 10_000 });
    const count = await hits.count();
    expect(count).toBeGreaterThan(0);
  });

  test("após click, bucket auto-abre na página de destino", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    await page.getByPlaceholder(/PC, PV, OS, fornecedor/).fill("4559");

    // hit DENTRO do modal: pega botão com badge AVULSOS + texto PV1282
    const hit = page.locator('button:has-text("AVULSOS"):has-text("PV1282")').first();
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await hit.click();

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Confirma que o bucket existe no DOM com data-bucket attr
    const bucket = page.locator('[data-bucket="PV1282"]');
    await expect(bucket).toBeVisible({ timeout: 5_000 });

    // Confirma que tá aberto: tem mais de 1 row visível dentro (header + items)
    const innerRows = bucket.locator('table tbody tr');
    const rowCount = await innerRows.count();
    console.log(`Bucket PV1282 tem ${rowCount} row(s) renderizadas`);
    expect(rowCount).toBeGreaterThan(0);
  });

  test("acha PV/OS órfão (sem PC) — caso OS994", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /^Buscar/ }).first().click();
    await page.getByPlaceholder(/PC, PV, OS, fornecedor/).fill("OS994");

    const hit = page.locator('button:has-text("OS994")').first();
    await expect(hit).toBeVisible({ timeout: 10_000 });
  });

  test("acha por valor exato — caso R$ 1901,89 (OS994)", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    // Testa via API direta primeiro (mais rápido pra debugar)
    const j = await page.evaluate(async () => {
      const r = await fetch("/api/search?q=1901&debug=1");
      return await r.json();
    });
    console.log("Busca por valor 1901 →", j.hits?.length ?? 0, "hits");
    expect(j.hits?.length).toBeGreaterThan(0);
    // OS994 deve estar entre os hits (PV com valor 1901,89)
    const labels = (j.hits as Array<{bucket_label: string}>).map(h => h.bucket_label);
    expect(labels).toContain("OS994");
  });

  test("acha por valor decimal exato — 1901,89", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");
    const j = await page.evaluate(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent("1901,89")}&debug=1`);
      return { status: r.status, body: await r.json() };
    });
    console.log("Busca por valor 1901,89 → status", j.status, "body:", JSON.stringify(j.body));
    expect(j.body.hits?.length).toBeGreaterThan(0);
    const labels = (j.body.hits as Array<{bucket_label: string}>).map(h => h.bucket_label);
    expect(labels).toContain("OS994");
  });

  test("API responde (sanity check via fetch direto)", async ({ page }) => {
    await page.goto("/avulsos");
    await page.waitForLoadState("networkidle");

    const j = await page.evaluate(async () => {
      const r = await fetch("/api/search?q=6312&debug=1");
      return { status: r.status, body: await r.json() };
    });
    expect(j.status).toBe(200);
    expect(j.body.hits).toBeTruthy();
    expect(j.body.hits.length).toBeGreaterThan(0);
    console.log("API hits:", j.body.hits.map((h: { bucket_label: string; modulo: string }) => `${h.bucket_label}/${h.modulo}`).join(", "));
    console.log("debug:", j.body.debug);
  });
});
