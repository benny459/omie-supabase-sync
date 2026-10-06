// node --test --experimental-strip-types scripts/testes/compras-email-destinos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarDestinatarios, assuntoTeste, faixaTeste, type Destinos } from "../../web/lib/compras-email-destinos.ts";

const SO = ["benny@waterworks.com.br"], FIXO = ["compras@waterworks.com.br"];
const ok = (r: ReturnType<typeof montarDestinatarios>) => { assert.ok(!("erro" in r)); return r as Destinos; };
const todos = (d: Destinos) => [...d.para, ...d.cc, ...d.cco].map((e) => e.toLowerCase());

test("modo teste redireciona Para/Cc externos para a lista de teste", () => {
  const d = ok(montarDestinatarios(["luis.rocha@fluidbrasil.com.br"], ["balcalay2@gmail.com"], [], "benny@waterworks.com.br", SO, FIXO));
  assert.deepEqual(d.para, ["benny@waterworks.com.br"]);
  assert.deepEqual(d.cc, []);
  assert.deepEqual(d.cco, ["compras@waterworks.com.br"]);
  assert.deepEqual(d.teste?.originais, { para: ["luis.rocha@fluidbrasil.com.br"], cc: ["balcalay2@gmail.com"], cco: [] });
});

test("nenhum externo recebe em modo teste (Para, Cc, Cco e quem enviou)", () => {
  const d = ok(montarDestinatarios(["a@fornecedor.com"], ["b@x.com"], ["c@y.com"], "fulano@waterworks.com.br", SO, FIXO));
  for (const e of todos(d)) assert.ok(SO.includes(e) || FIXO.includes(e), `vazou: ${e}`);
  assert.deepEqual(d.teste?.originais.cco, ["c@y.com"]);
});

test("Cco externo sozinho também é trocado e o Para nunca fica vazio", () => {
  const d = ok(montarDestinatarios([], [], ["c@y.com"], "", SO, FIXO));
  assert.deepEqual(d.para, SO);
  assert.ok(!todos(d).includes("c@y.com"));
});

test("endereços da lista de teste passam sem duplicar", () => {
  const d = ok(montarDestinatarios(["benny@waterworks.com.br"], [], [], "benny@waterworks.com.br", SO, FIXO));
  assert.deepEqual(d.para, ["benny@waterworks.com.br"]);
  assert.deepEqual(d.cco, ["compras@waterworks.com.br"]);
  assert.equal(assuntoTeste("PC 1", d), "[TESTE] PC 1");
});

test("sem modo teste nada muda e não há marca de teste", () => {
  const d = ok(montarDestinatarios(["a@fornecedor.com"], ["b@x.com"], [], "fulano@waterworks.com.br", [], FIXO));
  assert.deepEqual(d.para, ["a@fornecedor.com"]);
  assert.deepEqual(d.cc, ["b@x.com"]);
  assert.deepEqual(d.cco, ["compras@waterworks.com.br", "fulano@waterworks.com.br"]);
  assert.equal(d.teste, null);
  assert.equal(assuntoTeste("PC 1", d), "PC 1");
  assert.equal(faixaTeste(d), "");
});

test("assunto e faixa de teste listam os originais", () => {
  const d = ok(montarDestinatarios(["luis.rocha@fluidbrasil.com.br"], ["balcalay2@gmail.com"], [], "", SO, FIXO));
  assert.equal(assuntoTeste("SAFE - Pedido 7349", d), "[TESTE → era para: luis.rocha@fluidbrasil.com.br; cc: balcalay2@gmail.com] SAFE - Pedido 7349");
  assert.match(faixaTeste(d), /luis\.rocha@fluidbrasil\.com\.br/);
  assert.match(faixaTeste(d), /balcalay2@gmail\.com/);
});

test("e-mail inválido continua dando erro", () => {
  const r = montarDestinatarios(["sem-arroba"], [], [], "", SO, FIXO);
  assert.ok("erro" in r);
});
