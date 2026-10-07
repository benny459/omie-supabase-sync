// cd web && npx tsx --test ../scripts/testes/lista-pc-linha.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { acharLinhaPc, valorLinhaPc } from "../../web/lib/lista-pc-linha";

const pc = [
  { cod: "PRD02388", desc: 'ABRACADEIRA DUO PROT 3/4" (25-28MM) M8/M10 HCP', qtd: 16, vu: 9.02, valor: 149.01, rec: 16 },
  { cod: "PRD01626", desc: "ADAPTADOR LR Ø 3.4 SCH 80", qtd: 40, vu: 10, valor: 400, rec: null },
  { cod: "PRD09999", desc: "ADAPTADOR LR Ø 1 SCH 80", qtd: 10, vu: 14, valor: 140, rec: null },
];
test("código igual vence a descrição", () => {
  const a = acharLinhaPc({ codigo: "prd01626", texto: "qualquer coisa" }, pc);
  assert.equal(a?.cod, "PRD01626"); assert.equal(a?.por, "código");
});
test("sem código, a descrição com a mesma medida", () => {
  const a = acharLinhaPc({ texto: "Adaptador LR 3/4 SCH80" }, pc);
  assert.equal(a?.cod, "PRD01626"); assert.equal(a?.por, "descrição");
});
test("PC de uma linha só: é aquela linha; nada parecido em PC de várias: null", () => {
  assert.equal(acharLinhaPc({ texto: "Item sem nada a ver" }, [pc[0]])?.por, "única linha");
  assert.equal(acharLinhaPc({ texto: "Membrana 8040" }, pc), null);
});
test("valor da linha como o banco: qtd × vu − desconto + IPI + ST", () => {
  assert.equal(valorLinhaPc({ qtd: 16, vu: 9.02, desc0: 0, ipi: 4.69, st: 0 }), 149.01);
});
