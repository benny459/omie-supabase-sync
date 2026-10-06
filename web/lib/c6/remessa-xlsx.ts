import "server-only";
import JSZip from "jszip";
import { C6_CONTAS_B64, C6_SALARIOS_B64 } from "./templates";
import { limparTextoC6, chavePixC6 } from "./texto";

// Preenche os modelos de pagamento em lote do C6 Bank (05/10/26) sem mexer no
// layout: só as células das linhas 3–102 de cada aba são escritas (com o estilo
// que o modelo já tem) e o total da linha 103 é atualizado. Regras do banco
// (aba INSTRUÇÕES): datas dd/mm/aaaa, nenhuma linha em branco entre pagamentos,
// até 100 pagamentos por aba, só a chave Pix aceita caracteres especiais.

export type Modelo = "contas" | "salarios";
export type Modalidade = "PIX_CHAVE" | "PIX_CONTA" | "BOLETO" | "TED";

export type LinhaC6 = {
  modalidade: Modalidade;
  nome: string;
  doc?: string | null;        // CPF/CNPJ (só dígitos)
  chave?: string | null;      // chave ou código Pix
  chaveTipo?: string | null;  // pix_tipo do cadastro (telefone/cpf/email…) — desempata CPF × celular
  barras?: string | null;     // código de barras / linha digitável (só dígitos)
  ispb?: string | null;       // banco (ISPB) — Pix por agência e conta
  compe?: string | null;      // banco (cód. COMPE) — TED
  contaTipo?: string | null;  // Conta Corrente | Conta Poupança | Conta Pagamento
  agencia?: string | null;
  conta?: string | null;      // conta e dígito
  finalidade?: string | null; // TED: "07 - Pagamento de fornecedores" …
  valor: number;
  data: string;               // YYYY-MM-DD
  descricao?: string | null;
};

type Col = { col: string; campo: (l: LinhaC6) => string | number | null | undefined; num?: boolean };

const BR = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const limpa = (s: string | null | undefined, max = 140) => limparTextoC6(s, max);

/** Colunas de cada aba, exatamente na ordem do modelo do C6. */
const LAYOUT: Record<Modalidade, { cols: Col[]; soma: string }> = {
  PIX_CHAVE: { soma: "C", cols: [
    { col: "A", campo: (l) => limpa(l.nome, 80) },
    { col: "B", campo: (l) => chavePixC6(l.chave, l.chaveTipo) },
    { col: "C", campo: (l) => l.valor, num: true },
    { col: "D", campo: (l) => BR(l.data) },
    { col: "E", campo: (l) => limpa(l.descricao, 140) },
  ] },
  PIX_CONTA: { soma: "G", cols: [
    { col: "A", campo: (l) => limpa(l.nome, 80) },
    { col: "B", campo: (l) => l.doc },
    { col: "C", campo: (l) => l.ispb },
    { col: "D", campo: (l) => l.contaTipo },
    { col: "E", campo: (l) => l.agencia },
    { col: "F", campo: (l) => l.conta },
    { col: "G", campo: (l) => l.valor, num: true },
    { col: "H", campo: (l) => BR(l.data) },
    { col: "I", campo: (l) => limpa(l.descricao, 140) },
  ] },
  BOLETO: { soma: "B", cols: [
    { col: "A", campo: (l) => l.barras },
    { col: "B", campo: (l) => l.valor, num: true },
    { col: "C", campo: (l) => BR(l.data) },
    { col: "D", campo: (l) => limpa(l.nome, 80) },
  ] },
  TED: { soma: "H", cols: [
    { col: "A", campo: (l) => limpa(l.nome, 80) },
    { col: "B", campo: (l) => l.doc },
    { col: "C", campo: (l) => l.compe },
    { col: "D", campo: (l) => l.contaTipo },
    { col: "E", campo: (l) => l.agencia },
    { col: "F", campo: (l) => l.conta },
    { col: "G", campo: (l) => l.finalidade },
    { col: "H", campo: (l) => l.valor, num: true },
    { col: "I", campo: (l) => BR(l.data) },
    { col: "J", campo: (l) => limpa(l.descricao, 140) },
  ] },
};

/** Aba (arquivo XML) de cada modalidade em cada modelo. */
const ABA: Record<Modelo, Partial<Record<Modalidade, string>>> = {
  contas: { PIX_CHAVE: "xl/worksheets/sheet2.xml", PIX_CONTA: "xl/worksheets/sheet3.xml", BOLETO: "xl/worksheets/sheet4.xml", TED: "xl/worksheets/sheet5.xml" },
  salarios: { PIX_CHAVE: "xl/worksheets/sheet2.xml", PIX_CONTA: "xl/worksheets/sheet3.xml" },
};
export const MODALIDADES_DO_MODELO: Record<Modelo, Modalidade[]> = {
  contas: ["PIX_CHAVE", "PIX_CONTA", "BOLETO", "TED"],
  salarios: ["PIX_CHAVE", "PIX_CONTA"],
};
export const FINALIDADES_TED = [
  "01 - Crédito em conta", "02 - Transferência entre contas de mesma titularidade",
  "03 - Pagamento a concessionárias de serviço público", "04 - Pagamento de impostos, tributos e taxas",
  "05 - Pagamento de aluguéis e taxas de condomínio", "06 - Pagamento de duplicatas e títulos",
  "07 - Pagamento de fornecedores", "08 - Pagamento de mensalidade escolar", "09 - Depósito judicial",
  "10 - Pensão alimentícia", "11 - Pagamento de operações de crédito por cliente", "12 - Operação de câmbio - Não interbancária ",
];
export const MAX_POR_ABA = 100;

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colIdx = (c: string) => c.charCodeAt(0) - 64;

/** Escreve (ou cria) a célula `ref` na linha `row`, mantendo o estilo (s=) do modelo. */
function escreveCelula(xml: string, row: number, col: string, valor: string | number | null | undefined, num: boolean): string {
  const ref = `${col}${row}`;
  const reCel = new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(reCel);
  const attrs = (m?.[1] ?? "").replace(/\s+t="[^"]*"/, "");
  const vazio = valor == null || valor === "";
  const corpo = vazio ? `<c r="${ref}"${attrs}/>`
    : num ? `<c r="${ref}"${attrs}><v>${Number(valor).toFixed(2)}</v></c>`
    : `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(valor))}</t></is></c>`;
  if (m) return xml.replace(reCel, corpo);
  // a célula não existe no modelo: insere na linha, na ordem das colunas
  const reRow = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
  return xml.replace(reRow, (_t, ini: string, meio: string, fim: string) => {
    const cels = meio.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) ?? [];
    const antes = cels.filter((c) => colIdx(c.match(/<c r="([A-Z]+)/)![1]) < colIdx(col));
    const depois = cels.filter((c) => colIdx(c.match(/<c r="([A-Z]+)/)![1]) > colIdx(col));
    return ini + antes.join("") + corpo + depois.join("") + fim;
  });
}

/** Gera o .xlsx preenchido. Devolve o arquivo e um resumo por aba. */
export async function gerarArquivoC6(modelo: Modelo, linhas: LinhaC6[]): Promise<{ buf: Buffer; porAba: Record<string, number> }> {
  const zip = await JSZip.loadAsync(Buffer.from(modelo === "contas" ? C6_CONTAS_B64 : C6_SALARIOS_B64, "base64"));
  const porAba: Record<string, number> = {};
  for (const mod of MODALIDADES_DO_MODELO[modelo]) {
    const ls = linhas.filter((l) => l.modalidade === mod);
    if (!ls.length) continue;
    if (ls.length > MAX_POR_ABA) throw new Error(`O modelo do C6 aceita até ${MAX_POR_ABA} pagamentos por aba (${mod}: ${ls.length})`);
    const caminho = ABA[modelo][mod]!;
    let xml = await zip.file(caminho)!.async("string");
    const { cols, soma } = LAYOUT[mod];
    ls.forEach((l, i) => {
      const row = 3 + i;
      for (const c of cols) xml = escreveCelula(xml, row, c.col, c.campo(l), !!c.num);
    });
    const total = ls.reduce((s, l) => s + l.valor, 0);
    xml = xml.replace(new RegExp(`(<c r="${soma}103"[^>]*><f>[^<]*</f><v>)[^<]*(</v>)`), `$1${total.toFixed(2)}$2`);
    zip.file(caminho, xml);
    porAba[mod] = ls.length;
  }
  // o Excel recalcula as fórmulas ao abrir
  const wbPath = "xl/workbook.xml";
  let wb = await zip.file(wbPath)!.async("string");
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b(?![^>]*fullCalcOnLoad)/, '<calcPr fullCalcOnLoad="1"');
  zip.file(wbPath, wb);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buf, porAba };
}

/** Valida uma linha conforme as regras do modelo; devolve as pendências. */
export function validarLinha(l: LinhaC6, hojeISO: string): string[] {
  const e: string[] = [];
  if (!(l.valor > 0)) e.push("valor");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data)) e.push("data de pagamento");
  else {
    if (l.data < hojeISO) e.push("data de pagamento no passado");
    const lim = new Date(hojeISO + "T00:00:00"); lim.setFullYear(lim.getFullYear() + 1);
    if (new Date(l.data + "T00:00:00") > lim) e.push("data além de 1 ano");
  }
  const dig = (s?: string | null) => String(s ?? "").replace(/\D/g, "");
  if (l.modalidade === "PIX_CHAVE") {
    if (!(l.chave ?? "").trim()) e.push("chave Pix");
    if (!l.nome) e.push("nome do recebedor");
  }
  if (l.modalidade === "PIX_CONTA" || l.modalidade === "TED") {
    if (!l.nome) e.push("nome");
    if (![11, 14].includes(dig(l.doc).length)) e.push("CPF/CNPJ");
    if (l.modalidade === "PIX_CONTA" && !dig(l.ispb)) e.push("banco (ISPB)");
    if (l.modalidade === "TED" && !dig(l.compe)) e.push("banco (COMPE)");
    if (!["Conta Corrente", "Conta Poupança", "Conta Pagamento"].includes(l.contaTipo ?? "")) e.push("tipo de conta");
    if (!dig(l.agencia)) e.push("agência");
    if (!dig(l.conta)) e.push("conta e dígito");
    if (l.modalidade === "TED" && !FINALIDADES_TED.includes(l.finalidade ?? "")) e.push("finalidade da TED");
  }
  if (l.modalidade === "BOLETO") {
    const b = dig(l.barras);
    if (b.length !== 44 && b.length !== 47 && b.length !== 48) e.push("código de barras (44/47/48 dígitos)");
  }
  return e;
}
