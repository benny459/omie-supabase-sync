// cd web && npx tsx --test ../scripts/testes/pc-compras-id.test.ts
// 09/10/26: linha manual (ncod_ped negativo) NÃO é PC do Compras — antes ia para a rota do
// Compras com ids=[] e a aprovação não gravava nada (PCs 6917, 7273).
import { test } from "node:test";
import assert from "node:assert/strict";
import { comprasIdDaLinha, comprasIdDoNcod, ehLinhaManual, ehPcDoCompras, BASE_PC_COMPRAS } from "../../web/lib/pc-compras-id";

test("PC do Compras: -(9e12 + id) → id", () => {
  assert.equal(comprasIdDoNcod(-9000000980821), 980821);
  assert.equal(comprasIdDaLinha({ ncod_ped: -9000000980825, source: "compras_painel" }), 980825);
  assert.equal(comprasIdDaLinha({ ncod_ped: String(-(BASE_PC_COMPRAS + 7)) }), 7);
  assert.ok(ehPcDoCompras({ ncod_ped: -9000000980821, source: "compras_painel" }));
  assert.ok(!ehLinhaManual({ ncod_ped: -9000000980821, source: "compras_painel" }));
});
test("linha manual (native / rc_auto / omie_new) não é PC do Compras", () => {
  for (const r of [{ ncod_ped: -12546052447, source: "native" }, { ncod_ped: -6, source: "native" },
                   { ncod_ped: -12546051047, source: "rc_auto" }, { ncod_ped: -1900, source: "omie_new" }]) {
    assert.equal(comprasIdDaLinha(r), null, String(r.ncod_ped));
    assert.ok(!ehPcDoCompras(r));
    assert.ok(ehLinhaManual(r));
  }
  assert.equal(comprasIdDoNcod(-12546052447), null);
});
test("linha do Omie (positiva) não é manual nem do Compras", () => {
  const r = { ncod_ped: 12345678, source: "omie" };
  assert.ok(!ehPcDoCompras(r)); assert.ok(!ehLinhaManual(r)); assert.equal(comprasIdDoNcod(12345678), null);
});
test("source compras_painel sem a faixa usa custom_fields.compras_id", () => {
  assert.equal(comprasIdDaLinha({ ncod_ped: -1, source: "compras_painel", custom_fields: { compras_id: 42 } }), 42);
  assert.ok(ehPcDoCompras({ ncod_ped: -1, source: "compras_painel" }));
});
test("lixo não vira id", () => {
  assert.equal(comprasIdDoNcod(null), null); assert.equal(comprasIdDoNcod("abc"), null);
  assert.equal(comprasIdDoNcod(-BASE_PC_COMPRAS), null);
  assert.equal(comprasIdDaLinha(null), null);
});
