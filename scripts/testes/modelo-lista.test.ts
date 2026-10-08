// cd web && NODE_PATH=$PWD/node_modules npx tsx --test ../scripts/testes/modelo-lista.test.ts
// Modelo Excel da lista de materiais (lib/modelo-lista) → preenchido → lido de volta pelo
// importar planilha (lib/ler-planilha) e pelo colar do Excel (lib/colar-grade).
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { montarModeloLista, rotuloItem, LINHA_CAB, LINHAS_MODELO, CAB_ESCOLHA, type ItemModelo } from "../../web/lib/modelo-lista";
import { arquivoParaTexto } from "../../web/lib/ler-planilha";
import { lerColagem, separarEscolha, ALVOS_LISTA, POSICIONAIS_LISTA } from "../../web/lib/colar-grade";

const ITENS: ItemModelo[] = [
  { codigo: "ME0063", descricao: "ROTAMETRO P/ PAINEL 10 A 100 LPM", un: "UN", familia: "MEDIDORES", fornecedor: "ACME LTDA", ultimo_preco: 412.5, prazo_dias: 12 },
  { codigo: "TB0101", descricao: "TUBO PVC 1/2\" * 6M", un: "BR", familia: "TUBOS", fornecedor: null, ultimo_preco: 30, prazo_dias: null },
  { codigo: "SV0035", descricao: "MAO DE OBRA PARA IMPLANTAÇÃO DE QUADRO ELETRICO", un: "UN", familia: "SERVIÇOS", fornecedor: null, ultimo_preco: null, prazo_dias: null },
];
const GRUPOS = [{ nome: "Abrandador", origem: "projeto" as const }, { nome: "Geral", origem: "cadastro" as const }];
const novo = () => montarModeloLista({ itens: ITENS, grupos: GRUPOS, empresa: "SF", projeto: "projeto 9000000000013" });
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
const ler = (texto: string) => lerColagem(texto, ALVOS_LISTA, POSICIONAIS_LISTA).linhas;

/** Preenche como o Benny faria; `comResultado` simula o Excel gravando o resultado das fórmulas. */
async function preencher(comResultado: boolean): Promise<Buffer> {
  const wb = novo();
  const ws = wb.getWorksheet("Lista")!;
  const linhas: [string, number | null, string | null, string | null, number | null][] = [
    [rotuloItem("ME0063", ITENS[0].descricao), 2, "2026-10-30", "Abrandador", null],
    [rotuloItem("TB0101", ITENS[1].descricao), 5, null, null, 27.9],
    ["VÁLVULA ESPECIAL FORA DO ESTOQUE", 1, "2026-11-15", "Grupo Novo", null], // texto livre
    ["SV0035", 1, null, "Geral", null],                                        // só o código
  ];
  linhas.forEach(([a, q, d, g, v], i) => {
    const r = ws.getRow(LINHA_CAB + 1 + i);
    r.getCell(1).value = a;
    if (q != null) r.getCell(2).value = q;
    if (d) r.getCell(3).value = new Date(`${d}T00:00:00Z`);
    if (g) r.getCell(4).value = g;
    if (v != null) r.getCell(5).value = v;
    if (comResultado) {
      const it = ITENS.find((x) => a.startsWith(x.codigo));
      const set = (c: number, res: unknown) => { const f = (r.getCell(c).value as ExcelJS.CellFormulaValue).formula; r.getCell(c).value = { formula: f, result: res } as ExcelJS.CellFormulaValue; };
      set(6, it?.codigo ?? ""); set(7, it?.descricao ?? a); set(8, it?.un ?? ""); set(10, it?.ultimo_preco ?? "");
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

test("rótulo do menu: CÓDIGO · descrição, sem curingas do CORRESP", () => {
  assert.equal(rotuloItem("ME0063", "ROTAMETRO P/ PAINEL 10 A 100 LPM"), "ME0063 · ROTAMETRO P/ PAINEL 10 A 100 LPM");
  assert.equal(rotuloItem("TB0101", 'TUBO PVC 1/2" * 6M ?'), 'TB0101 · TUBO PVC 1/2" x 6M -');
});

test("separarEscolha: escolhido, só código e texto livre", () => {
  assert.deepEqual(separarEscolha("ME0063 · ROTAMETRO P/ PAINEL"), { codigo: "ME0063", descricao: "ROTAMETRO P/ PAINEL" });
  assert.deepEqual(separarEscolha(" me0063 "), { codigo: "ME0063", descricao: "" });
  assert.deepEqual(separarEscolha("Válvula especial"), { codigo: "", descricao: "Válvula especial" });
});

test("o modelo gerado: abas, nomes, validações e fórmulas", async () => {
  const buf = Buffer.from(await novo().xlsx.writeBuffer() as ArrayBuffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Lista", "Catálogo", "Grupos"]);
  const ws = wb.getWorksheet("Lista")!;
  assert.equal(ws.getCell(LINHA_CAB, 1).value, CAB_ESCOLHA);
  const a = ws.getCell(LINHA_CAB + 1, 1).dataValidation;
  assert.equal(a.type, "list"); assert.equal(a.errorStyle, "information"); assert.deepEqual(a.formulae, ["CATALOGO"]);
  assert.equal(ws.getCell(LINHA_CAB + LINHAS_MODELO, 4).dataValidation.formulae?.[0], "GRUPOS");
  assert.equal(ws.getCell(LINHA_CAB + 1, 3).dataValidation.type, "date");
  assert.match(String((ws.getCell(LINHA_CAB + 1, 6).value as ExcelJS.CellFormulaValue).formula), /INDEX\('Catálogo'!\$B\$2:\$B\$4,\$M4\)/);
  assert.notEqual(ws.getCell(LINHA_CAB + 1, 6).protection?.locked, false, "coluna automática travada (padrão do Excel)");
  assert.equal(ws.getCell(LINHA_CAB + 1, 2).protection?.locked, false);
  const xml = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(xml.Workbook?.Names?.map((n) => n.Name).sort(), ["CATALOGO", "CAT_CODIGO", "GRUPOS"]);
  assert.equal(XLSX.utils.sheet_to_json(xml.Sheets["Catálogo"]).length, 3);
  // o modelo em branco não importa nada
  assert.deepEqual(ler(arquivoParaTexto("m.xlsx", buf)), []);
});

for (const comResultado of [true, false]) {
  test(`importar o modelo preenchido (${comResultado ? "salvo pelo Excel, com resultados" : "sem resultado das fórmulas"})`, async () => {
    const linhas = ler(arquivoParaTexto("lista.xlsx", await preencher(comResultado)));
    assert.equal(linhas.length, 4, "as ~300 linhas vazias do modelo são puladas");
    const [l1, l2, l3, l4] = linhas;
    assert.equal(l1.cat_codigo, "ME0063");
    assert.equal(l1.item, "ROTAMETRO P/ PAINEL 10 A 100 LPM");
    assert.equal(l1.qtd, "2");
    assert.equal(l1.data_necessaria, "2026-10-30");
    assert.equal(l1.equipamento, "Abrandador");
    assert.equal(l1.cat_valor_unit ?? "", "", "valor vazio = usa o último preço do catálogo");
    assert.equal(l2.cat_codigo, "TB0101");
    assert.equal(l2.cat_valor_unit, "27.9");
    assert.equal(l2.data_necessaria ?? "", "");
    assert.equal(l3.cat_codigo ?? "", "", "texto livre entra sem código");
    assert.equal(l3.item, "VÁLVULA ESPECIAL FORA DO ESTOQUE");
    assert.equal(l3.equipamento, "Grupo Novo");
    assert.equal(l4.cat_codigo, "SV0035");
  });
}

test("colar do Excel a aba Lista copiada (título + instrução + cabeçalho + linhas, datas dd/mm/aaaa)", () => {
  const cab = [CAB_ESCOLHA, "Qtd", "Necessário em", "Grupo", "Valor unit. (se diferente)", "Código", "Descrição", "Un", "Fornecedor habitual", "Último preço", "Prazo médio (dias)", "Total"];
  const texto = [
    "Lista de materiais — projeto 9000000000013 · SF",
    "Na coluna A comece a digitar…",
    cab.join("\t"),
    ["ME0063 · ROTAMETRO P/ PAINEL 10 A 100 LPM", "3", "30/10/2026", "Abrandador", "", "ME0063", "ROTAMETRO P/ PAINEL 10 A 100 LPM", "UN", "ACME", "412,50", "12", "1.237,50"].join("\t"),
    ["", "", "", "", "", "", "", "", "", "", "", ""].join("\t"),
    ["Parafuso especial", "10", "", "", "1,20", "", "Parafuso especial", "", "", "", "", "12,00"].join("\t"),
  ].join("\n");
  const r = lerColagem(texto, ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(r.comCabecalho, true);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(
    { c: r.linhas[0].cat_codigo, i: r.linhas[0].item, q: r.linhas[0].qtd, d: r.linhas[0].data_necessaria, v: r.linhas[0].cat_valor_unit },
    { c: "ME0063", i: "ROTAMETRO P/ PAINEL 10 A 100 LPM", q: "3", d: "2026-10-30", v: "" });
  assert.equal(r.linhas[1].cat_codigo ?? "", "");
  assert.equal(r.linhas[1].cat_valor_unit, "1,20");
  assert.ok(serial("2026-10-30") > 46000);
});

test("colagem antiga (sem modelo) continua igual", () => {
  const r = lerColagem("Código\tItem\tQtd\nME0063\tRotâmetro\t2", ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.deepEqual(r.linhas, [{ cat_codigo: "ME0063", item: "Rotâmetro", qtd: "2" }]);
  const s = lerColagem("ME0063\tRotâmetro\t2", ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(s.comCabecalho, false);
  assert.equal(s.linhas[0].item, "Rotâmetro");
});
