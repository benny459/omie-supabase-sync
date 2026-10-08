// cd web && npx tsx --test ../scripts/testes/pc-ajustes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { devolvidoPorPc, valorLiquido, fatorDevolucao } from "../../web/lib/pc-ajustes-conta";

test("soma as devoluções ativas por PC; desfeita não conta; total marca o PC", () => {
  const m = devolvidoPorPc([
    { empresa: "SF", numero: "7300", tipo: "parcial", valor: 40 },
    { empresa: "SF", numero: "7300", tipo: "total", valor: 60.1 },
    { empresa: "SF", numero: "7300", tipo: "parcial", valor: 999, desfeito_em: "2026-10-08" },
    { empresa: "CD", numero: "7300", tipo: "parcial", valor: 5 },
  ]);
  assert.deepEqual(m.get("SF|7300"), { valor: 100.1, tipo: "total", n: 2 });
  assert.equal(m.get("CD|7300")?.valor, 5);
});
test("valor líquido e fator do fluxo", () => {
  const d = { valor: 40, tipo: "parcial" as const, n: 1 };
  assert.equal(valorLiquido(160, d), 120);
  assert.equal(valorLiquido(160, null), 160);
  assert.equal(valorLiquido(30, d), 0);            // nunca negativo
  assert.equal(fatorDevolucao(160, d), 0.75);
  assert.equal(fatorDevolucao(0, d), 1);
  assert.equal(fatorDevolucao(40, d), 0);
});
