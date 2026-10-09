// cd web && npx tsx --test ../scripts/testes/contrato-valor.test.ts
// 09/10/26: CM180321 (HCor) gravado com R$ 0,00 — "2.720,64" virava "2.720.64" → NaN → null → 0 no banco;
// a OS4893 e o recibo nº 4657 saíram sem preço. Valor digitado agora é lido no formato brasileiro e zero é barrado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffContrato, itensDaOs, nomeMes, numBR, textoMudanca, validarItensContrato } from "../../web/lib/faturamento/contrato-valor";

test("numBR lê os jeitos que o faturamento digita", () => {
  assert.equal(numBR("2.720,64"), 2720.64);
  assert.equal(numBR("2720,64"), 2720.64);
  assert.equal(numBR("2720.64"), 2720.64);
  assert.equal(numBR("R$ 2.720,64"), 2720.64);
  assert.equal(numBR("2.720"), 2720);
  assert.equal(numBR("1.234.567,8"), 1234567.8);
  assert.equal(numBR(2600), 2600);
  assert.equal(numBR("12400"), 12400);
  assert.ok(Number.isNaN(numBR("2.720.64x")));
  assert.ok(Number.isNaN(numBR("")));
  assert.ok(Number.isNaN(numBR(null)));
});

test("validarItensContrato barra valor vazio, inválido e total zero — e guia", () => {
  const ok = [{ descricao: "VISITA", quantidade: 1, valor_unitario: "2.720,64" }];
  assert.equal(validarItensContrato(ok), null);
  assert.match(validarItensContrato([{ descricao: "VISITA", quantidade: 1, valor_unitario: "abc" }])!, /não entendi o valor/i);
  assert.match(validarItensContrato([{ descricao: "VISITA", quantidade: 1, valor_unitario: 0 }])!, /R\$ 0,00/);
  assert.match(validarItensContrato([{ descricao: "", quantidade: 1, valor_unitario: 10 }])!, /sem descrição/);
  assert.match(validarItensContrato([])!, /pelo menos um item/);
});

test("itensDaOs repete o texto do banco (REFERENTE AO MÊS DE …)", () => {
  const its = itensDaOs([{ seq: 1, descricao: "VISITA CONTRATUAL PERIODICA - TRATAMENTO DE ÁGUA -", servico_codigo: "2244292555", quantidade: 1, valor_unitario: 2720.64,
    lc116: "7.15", cod_serv_munic: "36.00-6/01", aliq_iss: 0, retem_iss: false }], "2026-08-01");
  assert.equal(nomeMes("2026-08-01"), "AGOSTO/2026");
  assert.equal(its[0].descricao, "VISITA CONTRATUAL PERIODICA - TRATAMENTO DE ÁGUA - || REFERENTE AO MÊS DE AGOSTO/2026");
  assert.equal(its[0].valor_unitario, 2720.64);
  assert.deepEqual(its[0].fiscal, { lc116: "7.15", mun: "36.00-6/01", aliq_iss: 0, retem_iss: false });
});

test("diffContrato mostra de → para", () => {
  const it = (v: number) => [{ seq: 1, descricao: "VISITA", quantidade: 1, valor_unitario: v }];
  const m = diffContrato({ contrato: { valor_periodo: 0, vig_fim: "2027-07-31" }, itens: it(0) }, { contrato: { valor_periodo: 2720.64, vig_fim: "2027-07-31" }, itens: it(2720.64) });
  assert.equal(m.length, 2);
  assert.equal(textoMudanca(m[0]).replace(/ /g, " "), "valor: R$ 0,00 → R$ 2.720,64");
  assert.equal(m[1].campo, "itens");
  assert.equal(diffContrato({ contrato: { valor_periodo: "2600.00" }, itens: it(2600) }, { contrato: { valor_periodo: 2600 }, itens: it(2600) }).length, 0);
});
