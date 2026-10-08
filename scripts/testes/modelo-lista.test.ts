// cd web && NODE_PATH=$PWD/node_modules npx tsx --test ../scripts/testes/modelo-lista.test.ts
// Modelo Excel da lista de materiais (lib/modelo-lista) → preenchido → lido de volta pelo
// importar planilha (lib/ler-planilha) e pelo colar do Excel (lib/colar-grade).
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { montarModeloLista, rotuloItem, LINHA_CAB, LINHAS_MODELO, CAB_ESCOLHA, type ItemModelo } from "../../web/lib/modelo-lista";
import { arquivoParaTexto } from "../../web/lib/ler-planilha";
import { lerColagem, separarEscolha, ALVOS_LISTA, POSICIONAIS_LISTA, POSICIONAIS_EXTRAS_GRADE } from "../../web/lib/colar-grade";

const ITENS: ItemModelo[] = [
  { codigo: "ME0063", descricao: "ROTAMETRO P/ PAINEL 10 A 100 LPM", un: "UN", familia: "MEDIDORES", fornecedor: "ACME LTDA", ultimo_preco: 412.5, prazo_dias: 12 },
  { codigo: "TB0101", descricao: "TUBO PVC 1/2\" * 6M", un: "BR", familia: "TUBOS", fornecedor: null, ultimo_preco: 30, prazo_dias: null },
  { codigo: "SV0035", descricao: "MAO DE OBRA PARA IMPLANTAÇÃO DE QUADRO ELETRICO", un: "UN", familia: "SERVIÇOS", fornecedor: null, ultimo_preco: null, prazo_dias: null },
];
const GRUPOS = [{ nome: "Abrandador", origem: "projeto" as const }, { nome: "Geral", origem: "cadastro" as const }];
const novo = () => montarModeloLista({ itens: ITENS, grupos: GRUPOS, empresa: "SF", projeto: "projeto 9000000000013" });
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
    r.getCell("A").value = a;
    if (q != null) r.getCell("D").value = q;
    if (d) r.getCell("F").value = new Date(`${d}T00:00:00Z`);
    if (g) r.getCell("H").value = g;
    if (v != null) r.getCell("J").value = v;
    if (comResultado) {
      const it = ITENS.find((x) => a.startsWith(x.codigo));
      const set = (c: string, res: unknown) => { const f = (r.getCell(c).value as ExcelJS.CellFormulaValue).formula; r.getCell(c).value = { formula: f, result: res } as ExcelJS.CellFormulaValue; };
      set("B", it?.codigo ?? ""); set("C", it?.descricao ?? a); set("E", it?.un ?? ""); set("L", it?.ultimo_preco ?? "");
      set("G", v ?? it?.ultimo_preco ?? "");
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
  const a = ws.getCell(`A${LINHA_CAB + 1}`).dataValidation;
  assert.equal(a.type, "list"); assert.equal(a.errorStyle, "information"); assert.deepEqual(a.formulae, ["CATALOGO"]);
  assert.equal(ws.getCell(`H${LINHA_CAB + LINHAS_MODELO}`).dataValidation.formulae?.[0], "GRUPOS");
  assert.equal(ws.getCell(`F${LINHA_CAB + 1}`).dataValidation.type, "date");
  // bloco B:H na ordem posicional do colar
  assert.deepEqual(["B", "C", "D", "E", "F", "G", "H"].map((c) => ws.getCell(`${c}${LINHA_CAB}`).value),
    POSICIONAIS_LISTA.map((p) => p.label));
  assert.match(String(ws.getCell(`B${LINHA_CAB - 1}`).value), /COPIE ESTAS COLUNAS \(B:H\)/);
  assert.match(String((ws.getCell(`B${LINHA_CAB + 1}`).value as ExcelJS.CellFormulaValue).formula), /INDEX\('Catálogo'!\$B\$2:\$B\$4,\$O5\)/);
  assert.notEqual(ws.getCell(`B${LINHA_CAB + 1}`).protection?.locked, false, "coluna automática travada (padrão do Excel)");
  assert.equal(ws.getCell(`D${LINHA_CAB + 1}`).protection?.locked, false);
  const xml = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(xml.Workbook?.Names?.map((n) => n.Name).sort(), ["CATALOGO", "CAT_CODIGO", "GRUPOS", "PARA_COLAR"]);
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
    assert.equal(l1.cat_valor_unit ?? "", comResultado ? "412.5" : "", "sem 'se diferente' = último preço (pela fórmula, ou o modal completa do catálogo)");
    assert.equal(l2.cat_codigo, "TB0101");
    assert.equal(l2.cat_valor_unit, "27.9", "o 'se diferente' manda");
    assert.equal(l2.data_necessaria ?? "", "");
    assert.equal(l3.cat_codigo ?? "", "", "texto livre entra sem código");
    assert.equal(l3.item, "VÁLVULA ESPECIAL FORA DO ESTOQUE");
    assert.equal(l3.equipamento, "Grupo Novo");
    assert.equal(l4.cat_codigo, "SV0035");
  });
}

test("colar do Excel a aba Lista inteira copiada (título + instrução + faixa + cabeçalho + linhas)", () => {
  const cab = [CAB_ESCOLHA, "Código", "Item", "Qtd", "Un", "Necessário em", "Valor unit.", "Grupo", "", "Valor unit. (se diferente)", "Fornecedor habitual", "Último preço", "Prazo médio (dias)", "Total"];
  const texto = [
    "Lista de materiais — projeto 9000000000013 · SF",
    "① Na coluna A digite…",
    "▼ DIGITE AQUI E ESCOLHA O ITEM\t▼ COPIE ESTAS COLUNAS (B:H)",
    cab.join("\t"),
    ["ME0063 · ROTAMETRO P/ PAINEL 10 A 100 LPM", "ME0063", "ROTAMETRO P/ PAINEL 10 A 100 LPM", "3", "UN", "30/10/2026", "412,50", "Abrandador", "", "", "ACME", "412,50", "12", "1.237,50"].join("\t"),
    Array(14).fill("").join("\t"),
    ["Parafuso especial", "", "Parafuso especial", "10", "", "", "1,20", "", "", "1,20", "", "", "", "12,00"].join("\t"),
  ].join("\n");
  const r = lerColagem(texto, ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(r.comCabecalho, true);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(
    { c: r.linhas[0].cat_codigo, i: r.linhas[0].item, q: r.linhas[0].qtd, d: r.linhas[0].data_necessaria, v: r.linhas[0].cat_valor_unit, g: r.linhas[0].equipamento },
    { c: "ME0063", i: "ROTAMETRO P/ PAINEL 10 A 100 LPM", q: "3", d: "2026-10-30", v: "412,50", g: "Abrandador" });
  assert.equal(r.linhas[1].cat_codigo ?? "", "");
  assert.equal(r.linhas[1].cat_valor_unit, "1,20");
});

// o que o Excel põe na área de transferência ao copiar B:H (fórmulas viram valores)
const BLOCO = [
  ["ME0063", "ROTAMETRO P/ PAINEL 10 A 100 LPM", "3", "UN", "30/10/2026", "412,50", "Abrandador"],
  ["", "Parafuso especial", "10", "", "15/11/2026", "1,20", "Grupo Novo"],
  ["TB0101", "TUBO PVC 1/2\" x 6M", "5", "BR", "", "30,00", ""],
];
const confere = (ls: Record<string, string>[]) => {
  assert.equal(ls.length, 3);
  assert.deepEqual(ls[0], { cat_codigo: "ME0063", item: "ROTAMETRO P/ PAINEL 10 A 100 LPM", qtd: "3", un: "UN", data_necessaria: "2026-10-30", cat_valor_unit: "412,50", equipamento: "Abrandador" });
  assert.equal(ls[1].cat_codigo, ""); assert.equal(ls[1].item, "Parafuso especial"); assert.equal(ls[1].equipamento, "Grupo Novo");
  assert.equal(ls[2].equipamento, "", "grupo vazio: a grade/modal usa o da linha/seletor");
};

test("colar o bloco B:H SEM cabeçalho — modal (ordem posicional com Grupo em 7º)", () => {
  const r = lerColagem(BLOCO.map((l) => l.join("\t")).join("\n") + "\n", ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(r.comCabecalho, false);
  confere(r.linhas);
});

test("colar o bloco B:H SEM cabeçalho — grade (editáveis + Grupo como 7ª posição)", () => {
  // as editáveis da grade da lista na ordem (o equipamento fica fora: pularNoColar)
  const editaveisGrade = [{ label: "Código", key: "cat_codigo" }, { label: "Item", key: "item" }, { label: "Qtd", key: "qtd" }, { label: "Un", key: "un" },
    { label: "Necessário em", key: "data_necessaria", tipo: "data" }, { label: "Valor unit.", key: "cat_valor_unit" }];
  const pos = [...editaveisGrade, ...POSICIONAIS_EXTRAS_GRADE];
  assert.deepEqual(pos.map((p) => p.key), POSICIONAIS_LISTA.map((p) => p.key), "grade e modal na mesma ordem");
  confere(lerColagem(BLOCO.map((l) => l.join("\t")).join("\n"), ALVOS_LISTA, pos).linhas);
});

test("colar o bloco B:H COM o cabeçalho do bloco", () => {
  const cab = ["Código", "Item", "Qtd", "Un", "Necessário em", "Valor unit.", "Grupo"];
  const r = lerColagem([cab, ...BLOCO].map((l) => l.join("\t")).join("\n"), ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(r.comCabecalho, true);
  confere(r.linhas);
});

test("colagem antiga (sem modelo) continua igual", () => {
  const r = lerColagem("Código\tItem\tQtd\nME0063\tRotâmetro\t2", ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.deepEqual(r.linhas, [{ cat_codigo: "ME0063", item: "Rotâmetro", qtd: "2" }]);
  const s = lerColagem("ME0063\tRotâmetro\t2", ALVOS_LISTA, POSICIONAIS_LISTA);
  assert.equal(s.comCabecalho, false);
  assert.equal(s.linhas[0].item, "Rotâmetro");
});
