// cd web && npx tsx --test ../scripts/testes/pc-atribuicao.test.ts
// 09/10/26 (Cris, PC 7388): atribuição de cliente "não salvava" — erros engolidos no modal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarAtribuicoes, motivoSalvarDesligado, mensagemErroAtrib, montarMapaAtrib, confereGravacao, chaveAtrib, somaPct, lerJson } from "../../web/lib/pc-atribuicao";

test("validação: lista vazia, duplicado, percentual e soma", () => {
  assert.match(validarAtribuicoes([]) ?? "", /pelo menos 1 cliente/);
  assert.match(validarAtribuicoes(undefined) ?? "", /pelo menos 1 cliente/);
  assert.match(validarAtribuicoes([{ codigo_cliente_omie: 1, percentual: 50 }, { codigo_cliente_omie: 1, percentual: 50 }]) ?? "", /duas vezes/);
  assert.match(validarAtribuicoes([{ codigo_cliente_omie: 0, percentual: 100 }]) ?? "", /inválido/);
  assert.match(validarAtribuicoes([{ codigo_cliente_omie: 5, percentual: 0 }]) ?? "", /entre 0,01% e 100%/);
  assert.match(validarAtribuicoes([{ codigo_cliente_omie: 5, percentual: 60 }]) ?? "", /está em 60,00%/);
  assert.equal(validarAtribuicoes([{ codigo_cliente_omie: 2226030302, percentual: 100 }]), null);
});

test("rateio 100/N do modal (33,33 + 33,33 + 33,34; R$ com 4 casas) passa", () => {
  assert.equal(validarAtribuicoes([{ codigo_cliente_omie: 1, percentual: 33.33 }, { codigo_cliente_omie: 2, percentual: 33.33 }, { codigo_cliente_omie: 3, percentual: 100 - 33.33 * 2 }]), null);
  assert.equal(validarAtribuicoes([{ codigo_cliente_omie: 1, percentual: 33.3333 }, { codigo_cliente_omie: 2, percentual: 33.3333 }, { codigo_cliente_omie: 3, percentual: 33.3334 }]), null);
  const dez = Array.from({ length: 10 }, (_, i) => ({ codigo_cliente_omie: i + 1, percentual: i === 9 ? 100 - 10 * 9 : 10 }));
  assert.equal(validarAtribuicoes(dez), null);
  assert.equal(somaPct([{ percentual: "50.00" }, { percentual: 50 }]), 100);
});

test("botão Salvar desligado sempre diz porquê", () => {
  assert.match(motivoSalvarDesligado([], false) ?? "", /Busque e escolha/);
  assert.match(motivoSalvarDesligado([{ percentual: 80 }], false) ?? "", /80,00%/);
  assert.equal(motivoSalvarDesligado([{ percentual: 100 }], false), null);
  assert.equal(motivoSalvarDesligado([], true), null);
});

test("erros viram frases que guiam (sessão, permissão, rede, servidor)", () => {
  assert.match(mensagemErroAtrib(401, { error: "Unauthorized" }), /sessão expirou.*F5/);
  assert.match(mensagemErroAtrib(401, {}, "buscar"), /^A busca de clientes falhou: sua sessão expirou/);
  assert.match(mensagemErroAtrib(403, {}), /permissão/);
  assert.match(mensagemErroAtrib(0, null), /sem conexão/);
  assert.match(mensagemErroAtrib(400, { error: "A soma dos percentuais precisa dar 100%" }), /^Não salvou: A soma/);
  assert.match(mensagemErroAtrib(504, { error: "<html>" }), /erro 504 no servidor.*nº do PC/);
});

test("lerJson não quebra com HTML (504 / página de login)", async () => {
  assert.deepEqual(await lerJson(new Response('{"ok":true}')), { ok: true });
  const r = await lerJson(new Response("<!doctype html><title>504</title>")) as { error: string };
  assert.match(r.error, /doctype/);
  assert.deepEqual(await lerJson(new Response("")), {});
});

test("mapa pinta PC com várias linhas; chave sempre empresa|pc", () => {
  const m = montarMapaAtrib([
    { empresa: "SF", pc_numero: "7306", codigo_cliente_omie: 2252835332, percentual: "50.00", nome: "CDR" },
    { empresa: "SF", pc_numero: "7306", codigo_cliente_omie: 2226031168, percentual: "50.00" },
    { empresa: "SF", pc_numero: "7388", codigo_cliente_omie: 2226030302, percentual: 100 },
  ], new Map([[2226031168, "CLINED"]]));
  assert.equal(m.get("SF|7306")?.qtd, 2);
  assert.equal(m.get("SF|7306")?.soma_pct, 100);
  assert.deepEqual(m.get("SF|7306")?.clientes.map((c) => c.nome), ["CDR", "CLINED"]);
  assert.equal(m.get("SF|7388")?.clientes[0].nome, "Omie #2226030302");
  assert.equal(chaveAtrib(" SF ", 7388), "SF|7388");
  assert.equal(chaveAtrib(null, "7388"), "SF|7388");
});

test("confirmação: gravado no banco precisa bater com o pedido", () => {
  const pedido = [{ codigo_cliente_omie: 1, percentual: 33.33 }, { codigo_cliente_omie: 2, percentual: 66.67 }];
  assert.ok(confereGravacao(pedido, [{ codigo_cliente_omie: "2", percentual: "66.67" }, { codigo_cliente_omie: 1, percentual: "33.33" }]));
  assert.ok(!confereGravacao(pedido, []), "nada gravado ≠ salvo");
  assert.ok(!confereGravacao(pedido, [{ codigo_cliente_omie: 1, percentual: 100 }]));
  assert.ok(!confereGravacao(pedido, [{ codigo_cliente_omie: 1, percentual: 33.33 }, { codigo_cliente_omie: 3, percentual: 66.67 }]));
});
