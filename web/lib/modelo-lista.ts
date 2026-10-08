// Modelo Excel da lista de materiais (08/10/26, refeito a pedido do Benny: "PROCV não — eu
// quero começar a digitar e já me abre a lista para eu selecionar").
//
//   aba "Lista"     — 1ª coluna "Item (digite e escolha)": validação de dados do tipo LISTA
//                     apontando para o nome CATALOGO ("CÓDIGO · descrição"). Excel 365/web
//                     procura enquanto digita; versões antigas mostram a lista. Aviso (não
//                     bloqueio): texto livre entra e vira item "sem código" na importação.
//                     B:H = bloco PARA_COLAR, na ordem posicional do colar da grade/modal
//                     (Código · Item · Qtd · Un · Necessário em · Valor unit. · Grupo), marcado
//                     em azul — copia e cola direto. Ele preenche Qtd, Necessário em, Grupo e
//                     (opcional, à direita) Valor unit. se diferente; o resto sai por fórmula,
//                     em cinza e travado.
//   aba "Catálogo"  — os itens do estoque (código novo, ativos), visível para consultar e filtrar,
//                     protegida (sem senha) para não estragar a lista do menu.
//   aba "Grupos"    — grupos do projeto + cadastro, alimenta o menu da coluna Grupo.
//
// Puro (sem banco): quem chama passa os dados — a rota /api/rc-projetos/modelo, o script da
// prévia e os testes.
import ExcelJS from "exceljs";

export type ItemModelo = {
  codigo: string; descricao: string; un: string | null; familia: string | null;
  fornecedor: string | null; ultimo_preco: number | null; prazo_dias: number | null;
};
export type GrupoModelo = { nome: string; origem: "projeto" | "proposta" | "cadastro" };

/** Linhas preparadas na aba Lista. */
export const LINHAS_MODELO = 300;
/** Linha do cabeçalho na aba Lista (1 = título, 2 = instrução, 3 = faixa "copie estas colunas"). */
export const LINHA_CAB = 4;
export const CAB_ESCOLHA = "Item (digite e escolha)";

/** O texto que aparece no menu: "ME0063 · ROTAMETRO P/ PAINEL 10 A 100 LPM". Sem * ? ~ —
 *  no CORRESP/MATCH exato eles viram curinga e casariam o item errado. */
export function rotuloItem(codigo: string, descricao: string): string {
  const d = String(descricao ?? "").replace(/\*/g, "x").replace(/[?~]/g, "-").replace(/\s+/g, " ").trim();
  return `${String(codigo).trim()} · ${d}`.slice(0, 250);
}

const NAVY = "FF12275F";
const ACCENT = "FF2F6BFF";
const CINZA = "FFEEF0F4";
const CINZA_TXT = "FF4A5468";
const INPUT = "FFFFFFFF";
const BORDA = { style: "thin" as const, color: { argb: "FFD5DAE3" } };
const bordas = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA };

export function montarModeloLista(opts: {
  itens: ItemModelo[]; grupos: GrupoModelo[]; empresa: string; projeto?: string | null; linhas?: number;
}): ExcelJS.Workbook {
  const nLin = opts.linhas ?? LINHAS_MODELO;
  const itens = opts.itens;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Painel WaterWorks";
  wb.created = new Date();
  // Excel recalcula tudo ao abrir (as fórmulas saem daqui sem resultado gravado)
  wb.calcProperties = { fullCalcOnLoad: true };

  const lista = wb.addWorksheet("Lista", { views: [{ state: "frozen", ySplit: LINHA_CAB, zoomScale: 110 }],
    properties: { tabColor: { argb: ACCENT } } });
  const cat = wb.addWorksheet("Catálogo", { views: [{ state: "frozen", ySplit: 1 }], properties: { tabColor: { argb: NAVY } } });
  const grp = wb.addWorksheet("Grupos", { views: [{ state: "frozen", ySplit: 1 }], properties: { tabColor: { argb: "FF8A94A8" } } });

  // ── Catálogo ──
  cat.columns = [
    { header: "Item (como aparece na lista)", key: "rot", width: 70 }, { header: "Código", key: "cod", width: 11 },
    { header: "Descrição", key: "desc", width: 56 }, { header: "Un", key: "un", width: 6 }, { header: "Família", key: "fam", width: 22 },
    { header: "Fornecedor habitual", key: "forn", width: 34 }, { header: "Último preço", key: "preco", width: 13 },
    { header: "Prazo médio (dias)", key: "prazo", width: 11 },
  ];
  for (const i of itens) {
    cat.addRow({ rot: rotuloItem(i.codigo, i.descricao), cod: i.codigo, desc: i.descricao, un: i.un ?? "", fam: i.familia ?? "",
      forn: i.fornecedor ?? "", preco: i.ultimo_preco ?? null, prazo: i.prazo_dias ?? null });
  }
  cat.getColumn("preco").numFmt = "#,##0.00";
  estiloCab(cat.getRow(1));
  cat.autoFilter = { from: "A1", to: `H${Math.max(2, itens.length + 1)}` };
  const ultCat = Math.max(2, itens.length + 1);
  const ref = (col: string) => `'Catálogo'!$${col}$2:$${col}$${ultCat}`;
  wb.definedNames.add(ref("A"), "CATALOGO");
  wb.definedNames.add(ref("B"), "CAT_CODIGO");
  void cat.protect("", { selectLockedCells: true, selectUnlockedCells: true, autoFilter: true, formatColumns: true });

  // ── Grupos ──
  grp.columns = [{ header: "Grupo", key: "nome", width: 30 }, { header: "De onde vem", key: "orig", width: 40 }];
  const grupos = opts.grupos.length ? opts.grupos : [{ nome: "Geral", origem: "cadastro" as const }];
  const ORIGEM = { projeto: "já usado neste projeto", proposta: "equipamento da proposta (CRM)", cadastro: "cadastro de grupos" };
  for (const g of grupos) grp.addRow({ nome: g.nome, orig: ORIGEM[g.origem] });
  estiloCab(grp.getRow(1));
  wb.definedNames.add(`'Grupos'!$A$2:$A$${grupos.length + 1}`, "GRUPOS");

  // ── Lista ──
  // A: escolha · B:H = BLOCO PARA COLAR, na ordem posicional da grade/modal (lib/colar-grade,
  // POSICIONAIS_LISTA): Código · Item · Qtd · Un · Necessário em · Valor unit. · Grupo ·
  // I: separador · J:N informações (Valor unit. se diferente, Fornecedor, Último preço, Prazo,
  // Total) · O: auxiliar oculta (nº da linha no catálogo).
  type Col = { h: string; w: number; auto?: boolean; fmt?: string; hidden?: boolean; vazia?: boolean };
  const COLS: Col[] = [
    { h: CAB_ESCOLHA, w: 60 },                                  // A
    { h: "Código", w: 10, auto: true },                         // B ┐
    { h: "Item", w: 50, auto: true },                           // C │
    { h: "Qtd", w: 8, fmt: "#,##0.##" },                        // D │ bloco
    { h: "Un", w: 6, auto: true },                              // E │ PARA_COLAR
    { h: "Necessário em", w: 14, fmt: "dd/mm/yyyy" },           // F │
    { h: "Valor unit.", w: 13, auto: true, fmt: "#,##0.00" },   // G │
    { h: "Grupo", w: 22 },                                      // H ┘
    { h: "", w: 2.5, vazia: true },                             // I separador
    { h: "Valor unit. (se diferente)", w: 15, fmt: "#,##0.00" },// J
    { h: "Fornecedor habitual", w: 30, auto: true },            // K
    { h: "Último preço", w: 13, auto: true, fmt: "#,##0.00" },  // L
    { h: "Prazo médio (dias)", w: 11, auto: true },             // M
    { h: "Total", w: 14, auto: true, fmt: "#,##0.00" },         // N
    { h: "nº no catálogo", w: 8, auto: true, hidden: true },    // O (auxiliar)
  ];
  COLS.forEach((c, i) => {
    const col = lista.getColumn(i + 1);
    col.width = c.w;
    if (c.fmt) col.numFmt = c.fmt;
    if (c.hidden) col.hidden = true;
  });
  const BLOCO_INI = 2, BLOCO_FIM = 8; // B:H
  const ultCol = "N";
  const solido = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  lista.mergeCells(`A1:${ultCol}1`);
  const t = lista.getCell("A1");
  t.value = `Lista de materiais${opts.projeto ? ` — ${opts.projeto}` : ""} · ${opts.empresa}`;
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = solido(NAVY);
  t.alignment = { vertical: "middle", indent: 1 };
  lista.getRow(1).height = 26;
  lista.mergeCells(`A2:${ultCol}2`);
  const ins = lista.getCell("A2");
  ins.value = "① Na coluna A digite o código ou parte da descrição e escolha na lista. ② Preencha Qtd, Necessário em e Grupo (cinza = automático). "
    + "③ Para levar ao painel: COPIE AS COLUNAS B:H (área azul) da 1ª à última linha preenchida — ou Ctrl+G › PARA_COLAR — e cole com Ctrl+V numa linha em branco da lista de materiais. "
    + "Ou importe o arquivo inteiro: + Adicionar itens › Importar planilha. Item fora do estoque: digite o nome e confirme o aviso (entra \"sem código\").";
  ins.font = { italic: true, size: 10, color: { argb: CINZA_TXT } };
  ins.alignment = { wrapText: true, vertical: "middle", indent: 1 };
  ins.fill = solido("FFF5F7FB");
  lista.getRow(2).height = 44;

  // faixa de marcação (linha 3): "digite aqui" sobre A e "copie estas colunas" sobre o bloco
  const faixa = lista.getRow(LINHA_CAB - 1);
  faixa.height = 30;
  const fA = faixa.getCell(1);
  fA.value = "▼ DIGITE AQUI E ESCOLHA O ITEM";
  fA.font = { bold: true, color: { argb: NAVY } };
  fA.fill = solido("FFE4EAF7");
  fA.alignment = { vertical: "middle", indent: 1 };
  lista.mergeCells(LINHA_CAB - 1, BLOCO_INI, LINHA_CAB - 1, BLOCO_FIM);
  const fB = faixa.getCell(BLOCO_INI);
  fB.value = "▼ COPIE ESTAS COLUNAS (B:H) — da 1ª linha preenchida até a última — e cole com Ctrl+V numa linha em branco da lista";
  fB.font = { bold: true, color: { argb: "FFFFFFFF" } };
  fB.fill = solido(ACCENT);
  fB.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

  const cab = lista.getRow(LINHA_CAB);
  COLS.forEach((c, i) => { cab.getCell(i + 1).value = c.h || null; });
  estiloCab(cab);
  COLS.forEach((c, i) => {
    const cel = cab.getCell(i + 1);
    if (c.vazia) { cel.fill = solido("FFFFFFFF"); cel.border = {}; return; }
    const noBloco = i + 1 >= BLOCO_INI && i + 1 <= BLOCO_FIM;
    if (noBloco) cel.fill = solido(c.auto ? "FF1F4FC4" : ACCENT);
    else if (c.auto) cel.fill = solido("FF3A4A75");
  });
  cab.height = 30;
  cab.getCell(1).note = "Digite parte do código ou da descrição: o Excel 365 filtra a lista enquanto você digita. "
    + "No Excel antigo, use a setinha. Pode digitar um item que não está no estoque.";

  const L = LINHA_CAB + 1;
  const ultLista = LINHA_CAB + nLin;
  const C = (col: string) => `'Catálogo'!$${col}$2:$${col}$${ultCat}`;
  const AZUL = { style: "medium" as const, color: { argb: ACCENT } };
  for (let r = L; r <= ultLista; r++) {
    const row = lista.getRow(r);
    const f: Record<string, string> = {
      O: `IF($A${r}="","",IFERROR(MATCH($A${r},CATALOGO,0),IFERROR(MATCH($A${r},CAT_CODIGO,0),"")))`,
      B: `IF($O${r}="","",INDEX(${C("B")},$O${r}))`,
      C: `IF($A${r}="","",IF($O${r}="",$A${r},INDEX(${C("C")},$O${r})))`,
      E: `IF($O${r}="","",INDEX(${C("D")},$O${r})&"")`,
      G: `IF($A${r}="","",IF($J${r}<>"",$J${r},$L${r}))`,
      K: `IF($O${r}="","",INDEX(${C("F")},$O${r})&"")`,
      L: `IF($O${r}="","",IF(INDEX(${C("G")},$O${r})="","",INDEX(${C("G")},$O${r})))`,
      M: `IF($O${r}="","",IF(INDEX(${C("H")},$O${r})="","",INDEX(${C("H")},$O${r})))`,
      N: `IF(OR($A${r}="",$D${r}="",$G${r}=""),"",IFERROR($D${r}*$G${r},""))`,
    };
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const letra = String.fromCharCode(65 + i);
      if (c.vazia) return;
      const noBloco = i + 1 >= BLOCO_INI && i + 1 <= BLOCO_FIM;
      cell.border = {
        ...bordas,
        ...(i + 1 === BLOCO_INI ? { left: AZUL } : {}), ...(i + 1 === BLOCO_FIM ? { right: AZUL } : {}),
        ...(noBloco && r === ultLista ? { bottom: AZUL } : {}),
      };
      if (c.auto) {
        cell.value = { formula: f[letra], result: "" } as ExcelJS.CellFormulaValue;
        cell.fill = solido(noBloco ? "FFE6ECF8" : CINZA);
        cell.font = { color: { argb: CINZA_TXT } };
        cell.protection = { locked: true };
      } else {
        cell.fill = solido(INPUT);
        cell.protection = { locked: false };
      }
    });
  }
  // contorno de cima do bloco (cabeçalho)
  for (let c = BLOCO_INI; c <= BLOCO_FIM; c++) {
    const cel = cab.getCell(c);
    cel.border = { ...bordas, top: AZUL, ...(c === BLOCO_INI ? { left: AZUL } : {}), ...(c === BLOCO_FIM ? { right: AZUL } : {}) };
  }
  // Ctrl+G › PARA_COLAR seleciona as linhas do bloco (sem o cabeçalho)
  wb.definedNames.add(`Lista!$B$${L}:$H$${ultLista}`, "PARA_COLAR");

  // validação por FAIXA (uma por coluna): célula a célula, o "otimizador" do ExcelJS ordena
  // os endereços como texto (A10 < A4) e grava faixas sobrepostas — o Excel pede reparo.
  const dvs = (lista as unknown as { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }).dataValidations;
  const dv = (l: string, v: ExcelJS.DataValidation) => dvs.add(`${l}${L}:${l}${ultLista}`, v);
  dv("A", {
    type: "list", allowBlank: true, formulae: ["CATALOGO"], showErrorMessage: true, errorStyle: "information",
    errorTitle: "Item fora do estoque", error: "Esse texto não está no catálogo. Clique OK para manter como item \"sem código\" (você compatibiliza depois no painel) ou Cancelar para escolher da lista.",
  });
  dv("D", {
    type: "decimal", operator: "greaterThan", formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: "warning",
    errorTitle: "Quantidade", error: "A quantidade deve ser um número maior que zero.",
  });
  dv("F", {
    type: "date", operator: "greaterThan", formulae: [new Date(Date.UTC(2020, 0, 1))], allowBlank: true,
    showInputMessage: true, promptTitle: "Necessário em", prompt: "Data no formato dd/mm/aaaa",
    showErrorMessage: true, errorStyle: "warning", errorTitle: "Data", error: "Use uma data no formato dd/mm/aaaa.",
  });
  dv("H", {
    type: "list", allowBlank: true, formulae: ["GRUPOS"], showErrorMessage: true, errorStyle: "information",
    errorTitle: "Grupo novo", error: "Esse grupo não está na lista. Clique OK para criar um grupo novo com esse nome.",
  });
  dv("J", {
    type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: "warning",
    showInputMessage: true, promptTitle: "Valor unitário", prompt: "Só se for diferente do último preço (coluna L). Vazio = usa o último preço.",
    errorTitle: "Valor", error: "Use um número (ex.: 125,90).",
  });
  lista.autoFilter = { from: { row: LINHA_CAB, column: 1 }, to: { row: ultLista, column: COLS.length - 1 } };
  // travada SEM senha: as colunas cinza não se apagam sem querer; Revisão › Desproteger se precisar
  void lista.protect("", {
    selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, formatCells: true,
    autoFilter: true, sort: false, insertRows: false, deleteRows: false,
  });
  return wb;
}

function estiloCab(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = bordas;
  });
  row.height = Math.max(row.height ?? 0, 22);
}
