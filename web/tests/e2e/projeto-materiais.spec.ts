// Testa o fluxo de upload em /projetos/[codigo]/materiais no projeto PJ316_HECI:
//   1. Abre a sub-página
//   2. Testa "Lista RC (Projeto)": modal + download modelo + upload real
//   3. Testa "Fluxo Financeiro": modal + upload real + preflight numérico
//
// Roda contra prod (baseURL configurado no playwright.config.ts).

import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as os from "node:os";

const MATERIAIS_XLSX = path.join(os.homedir(), "Downloads", "LISTA DE MATERIAIS_model.xlsx");
const FLUXO_XLSX = path.join(os.homedir(), "Downloads", "Fluxo financeiro.xlsx");

// PJ316_HECI real: codigo_projeto=9829491988, empresa=SF (visto no v_pc_projetos)
const CODIGO = 9829491988;
const EMPRESA = "SF";

test.describe("Projeto Materiais — PJ316_HECI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/projetos/${CODIGO}/materiais?empresa=${EMPRESA}`);
    await expect(page.getByText("Lista de Materiais")).toBeVisible({ timeout: 15_000 });
  });

  test("Fluxo Financeiro — parseia + APLICA (persiste budget e etapas)", async ({ page }) => {
    await page.getByRole("button", { name: /Fluxo Financeiro/ }).first().click();
    await expect(page.getByRole("heading", { name: "Fluxo Financeiro do Projeto" })).toBeVisible();

    // Upload do arquivo real
    await page.setInputFiles('input[type="file"]', FLUXO_XLSX);

    // Confere parse
    await expect(page.getByText(/Valor Total do Projeto/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Previsto Custos/)).toBeVisible();
    await expect(page.getByText(/Resultado Bruto Esperado/)).toBeVisible();
    await expect(page.getByText(/\d+ Etapas encontradas/)).toBeVisible();

    // Aplica de verdade
    const applyBtn = page.getByRole("button", { name: /Aplicar Budget \+ \d+ etapa/ });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // Confirma sucesso
    await expect(page.getByText(/Budget salvo/)).toBeVisible({ timeout: 20_000 });
  });

  test("Lista RC — baixa modelo, aplica upload e persiste itens", async ({ page }) => {
    await page.getByRole("button", { name: /Lista RC \(Projeto\)/ }).click();
    await expect(page.getByRole("heading", { name: "Lista RC do Projeto" })).toBeVisible();

    // Download do modelo
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Baixar modelo/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("lista-materiais-modelo.xlsx");

    // Upload do arquivo modelo
    await page.setInputFiles('input[type="file"]', MATERIAIS_XLSX);

    // Confere summary
    await expect(page.getByText(/\d+ itens em \d+ equipamento/)).toBeVisible({ timeout: 10_000 });

    // Preflight
    await expect(page.getByText(/Diff \(vs \d+ atuais\)/)).toBeVisible({ timeout: 15_000 });

    // Aplica (botão "Confirmar N+ N~ N−")
    const confirmBtn = page.getByRole("button", { name: /Confirmar \d+\+ \d+~ \d+−/ });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Confirma sucesso
    await expect(page.getByText(/itens processados/)).toBeVisible({ timeout: 30_000 });
  });
});
