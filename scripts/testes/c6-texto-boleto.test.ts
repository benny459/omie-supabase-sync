// cd web && npx tsx --test ../scripts/testes/c6-texto-boleto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chavePixC6, limparTextoC6, telefoneC6, cpfValido } from "../../web/lib/c6/texto";
import { lerBoleto } from "../../web/lib/boleto";

test("telefone no formato do C6", () => {
  assert.equal(telefoneC6("11987726252"), "+55 11 98772-6252");
  assert.equal(telefoneC6("5511987726252"), "+55 11 98772-6252");
  assert.equal(telefoneC6("1133224455"), "+55 11 3322-4455");
  assert.equal(chavePixC6("+55 (11) 98772-6252"), "+55 11 98772-6252");
  assert.equal(chavePixC6("(11) 98772-6252"), "+55 11 98772-6252");
  assert.equal(chavePixC6("+5511987726252"), "+55 11 98772-6252");
});
test("CPF × celular: CPF com DV válido fica; o tipo do cadastro desempata", () => {
  assert.ok(cpfValido("52998224725"));
  assert.equal(chavePixC6("52998224725"), "52998224725");
  assert.equal(chavePixC6("529.982.247-25"), "529.982.247-25");
  assert.equal(chavePixC6("52998224725", "telefone"), "+55 52 99822-4725");
  assert.equal(chavePixC6("11987726252"), "+55 11 98772-6252"); // DV de CPF não confere → celular
});
test("e-mail, CNPJ e aleatória ficam como estão", () => {
  assert.equal(chavePixC6("Fin@Empresa.com.br"), "Fin@Empresa.com.br");
  assert.equal(chavePixC6("12.345.678/0001-95"), "12.345.678/0001-95");
  const evp = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(chavePixC6(evp), evp);
});
test("texto sem acento, cedilha e símbolos", () => {
  assert.equal(limparTextoC6("Pagamento NF 123 — Água & Saneamento Ação Ç!"), "Pagamento NF 123 Agua Saneamento Acao C");
  assert.equal(limparTextoC6("São José / Ribeirão-Preto, nº 5."), "Sao Jose / Ribeirao-Preto, n 5.");
  assert.equal(limparTextoC6("x".repeat(200), 140).length, 140);
});
test("boleto bancário: valida DV e lê valor/vencimento", () => {
  // monta um código de barras válido: banco 237, moeda 9, fator 1100 (02/06/2025 na regra nova), valor 1.234,56
  const semDv = "2379" + "1100" + "0000123456" + "1234567890123456789012345";
  let soma = 0, peso = 2;
  for (let i = semDv.length - 1; i >= 0; i--) { soma += Number(semDv[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  let dv = 11 - (soma % 11); if (dv === 0 || dv === 10 || dv === 11) dv = 1;
  const barra = semDv.slice(0, 4) + dv + semDv.slice(4);
  const l = lerBoleto(barra)!;
  assert.equal(l.tipo, "bancario"); assert.equal(l.valido, true);
  assert.equal(l.valor, 1234.56);
  assert.equal(l.vencimento, "2025-06-02");
  const ruim = lerBoleto(barra.slice(0, 4) + ((dv + 1) % 10) + barra.slice(5))!;
  assert.equal(ruim.valido, false);
  assert.equal(lerBoleto("123"), null);
});
test("concessionária 48 dígitos lê o valor", () => {
  const l = lerBoleto("836200000005 667800481000 180975657313 001589636081")!;
  assert.equal(l.tipo, "concessionaria");
  assert.equal(l.valor, 66.78);
});
