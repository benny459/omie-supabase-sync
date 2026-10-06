// cd web && npx tsx --test ../scripts/testes/catalogo-casar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexar, pontuarLinha, normTexto } from "../../web/lib/catalogo-casar";

const base = indexar([
  { id: 1, cod: "VAL0001", desc: "VALVULA AUTOMATICA F74A3 VAZAO 10M3/H", un: "UN", cmc: 1950, ultimo_preco: 2200 },
  { id: 2, cod: "JOE0001", desc: "JOELHO 45 SOLDAVEL 1.1/2", un: "UN", cmc: 9, ultimo_preco: 10 },
  { id: 3, cod: "JOE0002", desc: "JOELHO 45 SOLDAVEL 2.1/2", un: "UN", cmc: 20, ultimo_preco: 22 },
  { id: 4, cod: "CAR0001", desc: "CARVAO ATIVADO GRANULADO", un: "KG", cmc: 12, ultimo_preco: 13 },
  { id: 5, cod: "CAR0002", desc: "CARVAO ANTRACITOSO 0,7 A 1,68", un: "KG", cmc: 7, ultimo_preco: 7.4 },
]);

test("acha a válvula e o preço próximo dá bônus", () => {
  const r = pontuarLinha("Válvula automática F74A3", 2231, "UN", base);
  assert.equal(r[0].cod, "VAL0001");
  assert.match(r[0].motivo, /preço/);
});
test("medida é barreira: 1.1/2 não casa com 2.1/2 acima do correto", () => {
  const r = pontuarLinha("Joelho 45 soldável 1.1/2", null, null, base);
  assert.equal(r[0].cod, "JOE0001");
  const errado = r.find((x) => x.cod === "JOE0002");
  assert.ok(!errado || errado.score < r[0].score * 0.5);
});
test("antracitoso prefere o certo; top respeita o limite", () => {
  const r = pontuarLinha("Carvão Antracitoso 0,7 a 1,68", 7.32, "KG", base, 2);
  assert.equal(r[0].cod, "CAR0002");
  assert.ok(r.length <= 2);
});
test("sem candidato razoável devolve vazio", () => {
  assert.deepEqual(pontuarLinha("Bomba centrífuga", null, null, base), []);
});
test("normTexto ignora acento, caixa e pontuação", () => {
  assert.equal(normTexto("Válvula  AUTOMÁTICA, F-74A3"), normTexto("valvula automatica f 74a3"));
});
test("modelo e dimensão diferentes derrubam a nota", () => {
  const b = indexar([
    { id: 9, cod: "T0026", desc: "TANQUE EM PRFV 13X54 NATURAL", un: "UN", cmc: 980, ultimo_preco: 981 },
    { id: 8, cod: "H0838", desc: "VALVULA AUTOMATICA RUNXIN F65B3", un: "UN", cmc: 1024, ultimo_preco: 1024 },
  ]);
  const t = pontuarLinha('Tanque em PRFV 30x72 4"-4"', 3022, "UN", b);
  assert.ok(!t.length || t[0].score < 0.5);
  const v = pontuarLinha("Válvula automática F74A3", 2231, "UN", b);
  assert.ok(!v.length || v[0].score < 0.5);
});
