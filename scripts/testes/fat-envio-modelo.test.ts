// cd web && npx tsx --test ../scripts/testes/fat-envio-modelo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assuntoEnvio, copiaOculta, corpoEnvio, destinatariosCliente, linhasPagamento, nomesAnexos, type ModeloEnvio,
} from "../../web/lib/faturamento/envio-modelo";

// Cadastro real (DIAVERUM, recibo 4659): o Omie pôs o contasareceber@ no meio dos e-mails do cliente.
const CAD = "sofia.brito@diaverum.com,financeiro.cirurgia@diaverum.com,marcio.franca@diaverum.com,contasareceber@waterworks.com.br,financeiro.siqueiracampos@diaverum.com";

test("Para: um por endereço, só válidos, sem os nossos (contasareceber@ vai em cópia oculta)", () => {
  const p = destinatariosCliente([null, CAD, "Sofia.Brito@diaverum.com; lixo@; "], ["contasareceber@waterworks.com.br"]);
  assert.deepEqual(p, ["sofia.brito@diaverum.com", "financeiro.cirurgia@diaverum.com", "marcio.franca@diaverum.com", "financeiro.siqueiracampos@diaverum.com"]);
});
test("Para: e-mail de NF-e do cadastro vem primeiro; listas e textos misturados", () => {
  assert.deepEqual(destinatariosCliente([["nfe@cli.com.br"], "a@cli.com.br nfe@cli.com.br"]), ["nfe@cli.com.br", "a@cli.com.br"]);
});
test("Para: cliente intercompany só com endereços nossos mantém (menos os excluídos)", () => {
  assert.deepEqual(destinatariosCliente(["fin@waterworks.com.br,contasareceber@waterworks.com.br"], ["contasareceber@waterworks.com.br"]), ["fin@waterworks.com.br"]);
  assert.deepEqual(destinatariosCliente([""], []), []);
});
test("Cco: caixa fixa + quem enviou, sem repetir, minúsculas", () => {
  assert.deepEqual(copiaOculta(["contasareceber@waterworks.com.br"], "Benny@waterworks.com.br", ["x@y.com", "contasareceber@waterworks.com.br"]),
    ["x@y.com", "contasareceber@waterworks.com.br", "benny@waterworks.com.br"]);
  assert.deepEqual(copiaOculta(["contasareceber@waterworks.com.br"], "painel"), ["contasareceber@waterworks.com.br"]);
});

const REC: ModeloEnvio = {
  doc: "Recibo", numero: "4659", cliente: "DIAVERUM ASSISTENCIA MEDICA E NEFROLOGICA LTDA.", emitente: "WATER WORKS", origem: "OS4880",
  oc: "4500123", valor: 2364.4, vencimentos: [{ vencimento: "2026-10-23", valor: 2364.4 }], forma: "DEP",
  instrucao: "Transferência/depósito: Bradesco (237) Ag 0368 CC 0266910-2",
};

test("assunto com tipo, nº, origem e OC", () => {
  assert.equal(assuntoEnvio(REC), "WATER WORKS - Recibo de Prestação de Serviço nº 4659 (OS4880) - OC 4500123");
  assert.equal(assuntoEnvio({ ...REC, doc: "NF-e", numero: "112", oc: null, origem: null, emitente: null }), "WaterWorks - Nota Fiscal Eletrônica (NF-e) nº 112");
});
test("pagamento: forma por extenso + cada linha da instrução (o bloco do recibo)", () => {
  assert.deepEqual(linhasPagamento({ forma: "PIX", instrucao: "Pagamento via PIX: chave CNPJ 123 | Transferência/depósito: Itaú (341) Ag 1 CC 2" }),
    ["Forma de pagamento: PIX", "Pagamento via PIX: chave CNPJ 123", "Transferência/depósito: Itaú (341) Ag 1 CC 2"]);
  assert.deepEqual(linhasPagamento({ forma: "BOL", instrucao: null, boleto: true }), ["Forma de pagamento: Boleto (boleto em anexo)"]);
  assert.deepEqual(linhasPagamento({}), []);
});
test("corpo: nº, valor, OC, vencimento, dados de pagamento, texto complementar escapado", () => {
  const h = corpoEnvio(REC, "Ref. <contrato> 12");
  assert.match(h, /o recibo nº <b>4659<\/b>, referente ao pedido OS4880, no valor de <b>R\$\s?2\.364,40<\/b>/);
  assert.match(h, /ordem de compra: <b>4500123<\/b>/);
  assert.equal((h.match(/>Vencimento</g) ?? []).length, 1);
  assert.match(h, /23\/10\/2026/);
  assert.match(h, /Forma de pagamento: Depósito<br>Transferência\/depósito: Bradesco \(237\) Ag 0368 CC 0266910-2/);
  assert.match(h, /Ref\. &lt;contrato&gt; 12/);
  assert.doesNotMatch(h, /Chave de acesso/);
});
test("corpo NF-e: chave; NFS-e: líquido a pagar e prefeitura; vários vencimentos", () => {
  const nfe = corpoEnvio({ ...REC, doc: "NF-e", chave: "3526", oc: null, vencimentos: [{ vencimento: "2026-11-01", valor: 50 }, { vencimento: "2026-12-01", valor: 50 }] });
  assert.match(nfe, /a NF-e nº/);
  assert.match(nfe, /Chave de acesso: <span[^>]*>3526<\/span>/);
  assert.match(nfe, /01\/12\/2026/);
  assert.doesNotMatch(nfe, /ordem de compra/);
  const nfse = corpoEnvio({ ...REC, doc: "NFS-e", valor: 1000, liquido: 940, municipio: "São Paulo" });
  assert.match(nfse, /a NFS-e nº <b>4659<\/b> \(prefeitura de São Paulo\)/);
  assert.match(nfse, /valor líquido a pagar: <b>R\$\s?940,00<\/b>/);
  assert.doesNotMatch(corpoEnvio({ ...REC, liquido: 2364.4 }), /líquido/);
});
test("anexos por tipo: NF-e = DANFE + XML; recibo = PDF; NFS-e = PDF/XML; boletos numerados", () => {
  assert.deepEqual(nomesAnexos("NF-e", "112", { pdf: true, xml: true }), ["DANFE NF-e 112.pdf", "NF-e 112.xml"]);
  assert.deepEqual(nomesAnexos("Recibo", "4659", { pdf: true }), ["Recibo 4659.pdf"]);
  assert.deepEqual(nomesAnexos("NFS-e", "77", { pdf: true, xml: false, boletos: 2 }), ["NFS-e 77.pdf", "Boleto 77-1.pdf", "Boleto 77-2.pdf"]);
  assert.deepEqual(nomesAnexos("NFS-e", "77", { boletos: 1 }), ["Boleto 77.pdf"]);
});
