// cd web && npx tsx --test ../scripts/testes/historico-cliente.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { historicoDoCliente, herancaRecebimento, soDigitos } from "../../web/lib/faturamento/historico";

const BETA = "55931914000168";

test("só o MESMO CNPJ completo — nunca a raiz (outra filial) nem entrada sem documento", () => {
  const hs = [
    { cliente_doc: BETA, documento: "REC 3792" },
    { cliente_doc: "55931914000249", documento: "filial, mesma raiz" },
    { cliente_doc: "50567288000744", documento: "outro cliente" },
    { cliente_doc: null, documento: "sem documento" },
    { documento: "versão antiga do SQL, sem cliente_doc" },
  ];
  assert.deepEqual(historicoDoCliente(hs, "55.931.914/0001-68").map((h) => h.documento), ["REC 3792"]);
  assert.deepEqual(historicoDoCliente(hs, BETA).length, 1);
});
test("documento curto/vazio não casa nada (nada de código 0 ou vazio pegando tudo)", () => {
  const hs = [{ cliente_doc: "" }, { cliente_doc: "0" }, { cliente_doc: BETA }];
  assert.deepEqual(historicoDoCliente(hs, ""), []);
  assert.deepEqual(historicoDoCliente(hs, "0"), []);
  assert.deepEqual(historicoDoCliente(hs, "5593191"), []);
  assert.deepEqual(historicoDoCliente(null, BETA), []);
});
test("CPF também é comparado pelos 11 dígitos", () => {
  const hs = [{ cliente_doc: "52998224725" }, { cliente_doc: "52998224700" }];
  assert.equal(historicoDoCliente(hs, "529.982.247-25").length, 1);
  assert.equal(soDigitos("529.982.247-25"), "52998224725");
});
test("herança: forma tem de ser de recebimento (NFE/REC do Omie não servem)", () => {
  const r = herancaRecebimento([
    { forma: "REC", conta_codigo: 2252238644, parcelas: [{ forma: "REC" }] },
    { forma: "NFE", parcelas: [{ forma: "NFE" }] },
    { forma: "bol", conta_codigo: 9854117787 },
  ]);
  assert.deepEqual(r, { forma: "BOL", conta: 2252238644, de: 0 });
});
test("herança: condição do painel tem prioridade; sem nada válido → nulos", () => {
  assert.deepEqual(herancaRecebimento([{ condicao: { forma_recebimento: "PIX", conta_corrente: "123" }, forma: "BOL" }]),
    { forma: "PIX", conta: 123, de: 0 });
  assert.deepEqual(herancaRecebimento([{ forma: "NFE" }, { forma: "REC" }]), { forma: null, conta: null, de: null });
  assert.deepEqual(herancaRecebimento([]), { forma: null, conta: null, de: null });
});
test("herança respeita o limite de entradas", () => {
  const hs = [{ forma: "NFE" }, { forma: "PIX", conta_codigo: 7 }];
  assert.deepEqual(herancaRecebimento(hs, 1), { forma: null, conta: null, de: null });
  assert.deepEqual(herancaRecebimento(hs, 2), { forma: "PIX", conta: 7, de: 1 });
});
