// @ts-nocheck — roda direto no Node (--experimental-strip-types), fora do build do Next
// Testes do leitor de extratos (lib/ofx.ts) — um caso por particularidade de banco.
// Rodar:  node --experimental-strip-types web/scripts/teste-ofx.ts
// Os arquivos são sintéticos (valores e contas inventados), montados para
// reproduzir o formato que cada banco costuma exportar.
import { acharConta, conferirSaldo, decodificarOfx, lerExtratos, lerLinhasExtrato, lerOfx, partirCsv, sugerirMapa, valorOfx, dataOfx, type ContaCorrente } from "../lib/ofx.ts";

let falhas = 0, ok = 0;
function eq(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; return; }
  falhas++; console.error(`✗ ${nome}\n   esperado ${b}\n   veio     ${a}`);
}

const SGML_CAB = (charset = "1252") => `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:${charset}\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n`;
const sgml = (banco: string, ag: string, conta: string, trns: string, extra = "", tipoCta = "CHECKING") =>
  `${SGML_CAB()}<OFX>\n<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261005<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>\n<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>\n<STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>${banco}<BRANCHID>${ag}<ACCTID>${conta}<ACCTTYPE>${tipoCta}</BANKACCTFROM>\n<BANKTRANLIST><DTSTART>20261001<DTEND>20261003\n${trns}</BANKTRANLIST>${extra}</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n`;
const t = (dt: string, v: string, memo: string, fitid?: string, extra = "") =>
  `<STMTTRN><TRNTYPE>${v.startsWith("-") ? "DEBIT" : "CREDIT"}<DTPOSTED>${dt}<TRNAMT>${v}${fitid !== undefined ? `<FITID>${fitid}` : ""}${extra}<MEMO>${memo}</STMTTRN>\n`;
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf8 = (s: string) => new TextEncoder().encode(s);

// 1. Itaú — SGML, CHARSET 1252 com acentos, data com hora e fuso
{
  const txt = sgml("0341", "1234", "56789-0",
    t("20261001120000[-3:BRT]", "-150.00", "PIX ENVIADO JOÃO ÇÃ", "IT1") + t("20261002", "1000.00", "TED RECEBIDA", "IT2"),
    "<LEDGERBAL><BALAMT>2350.00<DTASOF>20261003</LEDGERBAL>");
  const e = lerOfx(decodificarOfx(latin1(txt)));
  eq("itau banco", e.banco, "341");
  eq("itau conta", e.conta, "567890");
  eq("itau acento 1252", e.movimentos[0].memo, "PIX ENVIADO JOÃO ÇÃ");
  eq("itau data com fuso", e.movimentos[0].data, "2026-10-01");
  eq("itau saldo final", e.saldo_final, 2350);
  eq("itau conferencia", conferirSaldo(e), { abertura: 1500, fechamento: 2350, movimento: 850 });
}
// 2. Bradesco — FITID repetido no mesmo dia
{
  const e = lerOfx(sgml("237", "0001", "0410855", t("20261002", "-10.00", "TARIFA", "777") + t("20261002", "-10.00", "TARIFA", "777")));
  eq("bradesco fitid unico", e.movimentos.map((m) => m.fitid), ["777", "777#2"]);
}
// 3. Santander — OFX 2.x XML com fechos, valor com vírgula
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="211"?>\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>033</BANKID><BRANCHID>3333</BRANCHID><ACCTID>130012345</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM><BANKTRANLIST><DTSTART>20261001000000</DTSTART><DTEND>20261005000000</DTEND><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261003000000[-03:EST]</DTPOSTED><TRNAMT>-1.234,56</TRNAMT><FITID>SAN1</FITID><MEMO>BOLETO PAGO</MEMO></STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>100,00</BALAMT><DTASOF>20261005</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const e = lerOfx(decodificarOfx(utf8(xml)));
  eq("santander xml valor virgula", e.movimentos[0].valor, -1234.56);
  eq("santander saldo virgula", e.saldo_final, 100);
  eq("santander banco", e.banco, "033");
}
// 4. Banco do Brasil — sem FITID, dois lançamentos iguais no dia
{
  const e = lerOfx(sgml("001", "1234-5", "12345-6", t("20261002", "-50.00", "PIX - ENVIADO") + t("20261002", "-50.00", "PIX - ENVIADO")));
  eq("bb sem fitid gera 2", e.movimentos.length, 2);
  eq("bb sintetico distinto", e.movimentos[0].fitid !== e.movimentos[1].fitid, true);
  eq("bb sintetico estavel", lerOfx(sgml("001", "1234-5", "12345-6", t("20261002", "-50.00", "PIX - ENVIADO") + t("20261002", "-50.00", "PIX - ENVIADO"))).movimentos[0].fitid, e.movimentos[0].fitid);
}
// 5. Caixa — FITID "0" e CHECKNUM/REFNUM
{
  const e = lerOfx(sgml("104", "0001", "00100012345-1", t("20261001", "200.00", "DEP DINHEIRO", "0", "<CHECKNUM>000123<REFNUM>ABC")));
  eq("caixa fitid zero vira sintetico", e.movimentos[0].fitid.startsWith("sint:"), true);
  eq("caixa checknum", e.movimentos[0].checknum, "000123");
  eq("caixa refnum", e.movimentos[0].refnum, "ABC");
}
// 6. Inter — UTF-8 sem declarar, NAME no lugar de MEMO
{
  const txt = sgml("077", "0001", "1234567", "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>99.90<FITID>INT1<NAME>Pix recebido de José</STMTTRN>").replace("CHARSET:1252", "CHARSET:NONE");
  const e = lerOfx(decodificarOfx(utf8(txt)));
  eq("inter utf8 sem declarar", e.movimentos[0].nome, "Pix recebido de José");
}
// 7. Nubank — fatura de cartão (CCSTMTRS / CCACCTFROM)
{
  const txt = `${SGML_CAB("UTF-8")}<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL<CCACCTFROM><ACCTID>nubank-cc-1234</CCACCTFROM><BANKTRANLIST><DTSTART>20260901<DTEND>20260930<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910<TRNAMT>-45.90<FITID>NU1<MEMO>Uber *Trip</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>-45.90<DTASOF>20260930</LEDGERBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const e = lerOfx(txt);
  eq("nubank cartao", e.cartao, true);
  eq("nubank conta digitos", e.conta, "1234");
  eq("nubank valor", e.movimentos[0].valor, -45.9);
}
// 8. C6 — normal
{
  const e = lerOfx(sgml("336", "0001", "123456789", t("20261002", "-160.00", "Reembolso de Despesas", "C61")));
  eq("c6", [e.banco, e.movimentos[0].valor], ["336", -160]);
}
// 9. Sicredi — agência colada no ACCTID
{
  const contas: ContaCorrente[] = [{ empresa: "SF", cod_cc: 1, descricao: "Sicredi", codigo_banco: "748", numero_conta_corrente: "12345-6", tipo_conta_corrente: "CC", inativo: "N", codigo_agencia: "0101" }];
  const e = lerOfx(sgml("748", "0101", "010112345", t("20261002", "10.00", "X", "S1")));
  eq("sicredi acha conta", acharConta(e, contas).map((c) => c.cod_cc), [1]);
}
// 10. Sicoob — tudo positivo, saída indicada só pelo TRNTYPE
{
  const trns = `<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261002<TRNAMT>30.00<FITID>SC1<MEMO>TARIFA</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>500.00<FITID>SC2<MEMO>CREDITO PIX</STMTTRN>`;
  const e = lerOfx(sgml("756", "3001", "998877", trns));
  eq("sicoob sinal pelo tipo", e.movimentos.map((m) => m.valor), [-30, 500]);
}
// 11. BTG — dois extratos (duas contas) no mesmo arquivo
{
  const um = (conta: string, fit: string) => `<STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>208<BRANCHID>0050<ACCTID>${conta}<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>20261001<DTEND>20261003<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>1.00<FITID>${fit}<MEMO>X</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>1.00<DTASOF>20261003</LEDGERBAL></STMTRS></STMTTRNRS>`;
  const txt = `${SGML_CAB()}<OFX><BANKMSGSRSV1>${um("111", "B1")}${um("222", "B2")}</BANKMSGSRSV1></OFX>`;
  const es = lerExtratos(txt);
  eq("btg dois extratos", es.map((e) => [e.conta, e.movimentos[0].fitid]), [["111", "B1"], ["222", "B2"]]);
}
// 12. Mercado Pago — sem BANKID (usa FID), entidades &amp;
{
  const txt = `${SGML_CAB()}<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>MP<FID>323</FI></SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>55555</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>12.34<FITID>MP1<MEMO>Venda &amp; frete</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const e = lerOfx(txt);
  eq("mercadopago fid", e.banco, "323");
  eq("mercadopago entidade", e.movimentos[0].memo, "Venda & frete");
  eq("mercadopago periodo pelos movimentos", [e.inicio, e.fim], ["2026-10-02", "2026-10-02"]);
}
// 13. PagBank — valor com milhar e ponto decimal "1,234.56"
{
  eq("pagbank milhar", valorOfx("1,234.56"), 1234.56);
  eq("valor parenteses", valorOfx("(10,00)"), -10);
  eq("valor sufixo D", valorOfx("10,00 D"), -10);
  eq("valor R$", valorOfx("R$ 1.000,00"), 1000);
}
// 14. Omie Cash — XML 2.x com BOM UTF-8
{
  const xml = `﻿<?xml version="1.0" encoding="utf-8"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>450</BANKID><BRANCHID>0001</BRANCHID><ACCTID>9988776</ACCTID></BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>2026-10-02T10:00:00</DTPOSTED><TRNAMT>350.00</TRNAMT><FITID>OC1</FITID><MEMO>Pix recebido · Cliente Ação</MEMO></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const e = lerOfx(decodificarOfx(utf8(xml)));
  eq("omiecash bom + data iso", [e.banco, e.movimentos[0].data, e.movimentos[0].memo], ["450", "2026-10-02", "Pix recebido · Cliente Ação"]);
}
// 15. Datas inválidas e lançamento zero são ignorados
{
  eq("data invalida", dataOfx("20261399"), null);
  const e = lerOfx(sgml("237", "1", "2", t("20261002", "0.00", "ZERO", "Z") + t("2026", "5.00", "SEM DATA", "Y")));
  eq("zero e sem data fora", e.movimentos.length, 0);
}
// 16. CSV com ; e crédito/débito separados + XLSX serial de data
{
  const csv = `Data;Histórico;Documento;Crédito (R$);Débito (R$);Saldo (R$)\n01/10/2026;PIX RECEBIDO;123;1.000,00;;1.000,00\n02/10/2026;TARIFA;;;12,50;987,50\n`;
  const linhas = partirCsv(csv);
  const mapa = sugerirMapa(linhas[0]);
  eq("csv mapa sugerido", [mapa.data, mapa.historico, mapa.credito, mapa.debito, mapa.saldo], [0, 1, 3, 4, 5]);
  const e = lerLinhasExtrato(linhas, { ...mapa, valor: -1 });
  eq("csv valores", e.movimentos.map((m) => m.valor), [1000, -12.5]);
  eq("csv saldo final", e.saldo_final, 987.5);
  const x = lerLinhasExtrato([["Data", "Valor", "Hist"], [46296, -20, "X"]], { data: 0, valor: 1, historico: 2 });
  eq("xlsx serial", x.movimentos[0].data, "2026-10-01");
}
// 17. Conta: banco + número com DV / zeros
{
  const contas: ContaCorrente[] = [
    { empresa: "SF", cod_cc: 10, descricao: "Bradesco CC", codigo_banco: "237", numero_conta_corrente: "41085-5", tipo_conta_corrente: "CC", inativo: "N" },
    { empresa: "SF", cod_cc: 11, descricao: "Bradesco Aplic", codigo_banco: "237", numero_conta_corrente: "41085-5", tipo_conta_corrente: "CA", inativo: "N" },
  ];
  eq("conta cc antes de aplicacao", acharConta({ banco: "0237", conta: "0041085", agencia: null, cartao: false }, contas).map((c) => c.cod_cc), [10, 11]);
  eq("banco diferente nao casa", acharConta({ banco: "341", conta: "410855", agencia: null, cartao: false }, contas).length, 0);
}

console.log(`${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
