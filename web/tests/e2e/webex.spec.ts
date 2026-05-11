import { test, expect } from "@playwright/test";

// Valida integração Webex: chama API /api/approvals/set-status com status=APROVADO
// e verifica que a resposta indica sucesso (tanto no banco quanto no Webex).
// Depois reverte pra PENDENTE pra não deixar estado poluído.
//
// Usa um PC real standalone (ncod_ped=9799852026, pc_numero=3910 em SF) que estava
// PENDENTE no momento do teste.

const TEST_EMPRESA = "SF";
const TEST_NCOD_PED = 9799852026;

test("webex: aprovar dispara notificação", async ({ request }) => {
  // 1. Aprova
  const resp = await request.post("/api/approvals/set-status", {
    data: {
      empresa: TEST_EMPRESA,
      ncod_ped: TEST_NCOD_PED,
      status: "APROVADO",
      modulo: "pcs",
      valorPc: 100,
    },
  });
  expect(resp.status()).toBeLessThan(400);
  const body = await resp.json();
  expect(body.ok).toBe(true);
  // Webex deve ter sido invocado (pode ter sucesso ou falha; mas deve ter tentado)
  expect(body.webex).toBeTruthy();
  if (body.webex?.ok !== true) {
    console.log("⚠️ Webex response:", JSON.stringify(body.webex, null, 2));
  }
  expect(body.webex?.ok).toBe(true);

  // 2. Revert pra PENDENTE (cleanup)
  const revert = await request.post("/api/approvals/set-status", {
    data: {
      empresa: TEST_EMPRESA,
      ncod_ped: TEST_NCOD_PED,
      status: "PENDENTE",
      modulo: "pcs",
      valorPc: null,
    },
  });
  expect(revert.status()).toBeLessThan(400);
});
