// Lê a planilha CP-MC do sistema de propostas e devolve o plano de fechamento.
//
// ── Por que procurar marcadores em vez de linhas fixas ──────────────────────
// A planilha é gerada, e cada revisão pode ter um número diferente de itens —
// a agenda de pagamentos de um projeto tem 14 linhas, a de outro tem 40. Ler
// "linha 23" funcionaria uma vez e silenciosamente leria a coisa errada na
// próxima. Então cada bloco é achado pelo seu título e lido até a linha em
// branco, que é como a planilha separa os blocos.
//
// ── O que se lê de cada aba ────────────────────────────────────────────────
//   Fluxo     condições, parcelas de entrada, saídas sem PC, agenda de compras
//   MC        valor de venda, custo por natureza, margem
// As outras abas (CP, Lotes, Fornecedores, Condições) são detalhe de como a
// proposta chegou nesses números — o plano não precisa delas, e a lista de
// materiais já existe na tela por outro caminho.

import * as XLSX from "xlsx";

export type ParcelaPlano = {
  parcela: number;
  evento: string;
  pct: number | null;
  dt_plano: string | null;
  valor: number;
};

export type SaidaPlano = {
  origem: "material" | "sem_pc";
  descricao: string;
  fornecedor: string | null;
  etapa: string | null;
  dias_apos_base: number | null;
  dt_prevista: string | null;
  valor: number;
  no_fluxo: boolean;
};

export type PlanoFechamento = {
  proposta: string | null;
  cliente: string | null;
  data_base: string | null;
  valor_venda: number | null;
  prazo_entrega_dias: number | null;
  entrega_prevista: string | null;
  frete: string | null;
  deslocamento: string | null;
  instalacao: string | null;
  impostos: string | null;
  garantia: string | null;
  forma_pagamento: string | null;
  faturamento: string | null;
  observacoes: string | null;
  custo_materiais: number | null;
  custo_mao_obra: number | null;
  custo_despesas: number | null;
  margem_pct: number | null;
  margem_valor: number | null;
  parcelas: ParcelaPlano[];
  saidas: SaidaPlano[];
  /** O que não foi encontrado. A tela mostra — um plano que importou meio e não
   *  diz qual metade é pior que um plano que não importou. */
  avisos: string[];
};

type Matriz = unknown[][];

const txt = (v: unknown): string =>
  v == null ? "" : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();

const semAcento = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Número tolerante: aceita 1.234,56 (pt-BR), 1234.56 e o que o Excel já
 *  entregou como number. Devolve null para "—", vazio e lixo. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/[R$\s%]/g, "");
  if (!s || s === "—" || s === "-") return null;
  // "1.234,56" → "1234.56"; "1234.56" fica como está.
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Data em ISO. O Excel entrega Date quando lido com cellDates; o resto vem
 *  como texto dd/mm/aaaa. */
function data(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Usa os componentes LOCAIS: o Excel guarda data sem fuso, e toISOString
    // converte para UTC — o que empurra a data um dia para trás a oeste de
    // Greenwich. Uma parcela de 11/09 viraria 10/09 em silêncio.
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = txt(v);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

/** Índice da primeira linha cujo início bate com o marcador. */
function acharLinha(m: Matriz, marcador: string, desde = 0): number {
  const alvo = semAcento(marcador);
  for (let i = desde; i < m.length; i++) {
    const primeira = semAcento(txt(m[i]?.[0]));
    if (primeira.startsWith(alvo)) return i;
  }
  return -1;
}

/** Linhas de um bloco: começa depois do título (pulando o cabeçalho) e vai até
 *  a primeira linha vazia. */
function bloco(m: Matriz, marcador: string, pularCabecalho = 1): Matriz {
  const i = acharLinha(m, marcador);
  if (i < 0) return [];
  const out: Matriz = [];
  for (let r = i + 1 + pularCabecalho; r < m.length; r++) {
    const linha = m[r] ?? [];
    const vazia = linha.every((c) => txt(c) === "");
    if (vazia) break;
    out.push(linha);
  }
  return out;
}

export function lerPlanoFechamento(buf: ArrayBuffer): PlanoFechamento {
  const wb = XLSX.read(buf, { cellDates: true });
  const avisos: string[] = [];
  const matriz = (nome: string): Matriz => {
    const ws = wb.Sheets[nome];
    if (!ws) { avisos.push(`Aba "${nome}" não existe nesta planilha.`); return []; }
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: null });
  };

  const fluxo = matriz("Fluxo");
  const mc = matriz("MC");

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  // Linha 1: "FLUXO DE CAIXA DO PROJETO · SW_1609251654_rev3"; linha 2: cliente.
  const tituloFluxo = txt(fluxo[0]?.[0]);
  const proposta = tituloFluxo.split("·").pop()?.trim() || null;
  const cliente = txt(fluxo[1]?.[0]) || null;

  // ── Condições de fechamento ──────────────────────────────────────────────
  // Item | Confirmado | (vazio) | Como está na proposta. O "Confirmado" é a
  // resposta dada ao ganhar; quando está em branco vale a coluna da proposta.
  const cond = new Map<string, { conf: string; prop: string }>();
  for (const l of bloco(fluxo, "CONDIÇÕES DE FECHAMENTO")) {
    const chave = semAcento(txt(l[0]));
    if (!chave) continue;
    cond.set(chave, { conf: txt(l[1]), prop: txt(l[3]) });
  }
  const condicao = (k: string): string | null => {
    const c = cond.get(semAcento(k));
    if (!c) return null;
    return c.conf || c.prop || null;
  };

  // "Prazo de entrega | 90 dias | | Conta a partir de 11/09/2026 — previsão 10/12/2026"
  const prazoRaw = cond.get(semAcento("Prazo de entrega"));
  const prazo_entrega_dias = prazoRaw ? num(prazoRaw.conf.replace(/dias?/i, "")) : null;
  const entrega_prevista = prazoRaw
    ? data(prazoRaw.prop.split("previsão").pop()?.trim() ?? "") : null;
  const data_base = data(cond.get(semAcento("Início oficial do projeto"))?.conf ?? "")
    ?? (prazoRaw ? data(prazoRaw.prop.match(/a partir de\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "") : null);

  if (!cond.size) avisos.push("Não achei o bloco de condições de fechamento.");

  // ── Parcelas de entrada ──────────────────────────────────────────────────
  const parcelas: ParcelaPlano[] = [];
  for (const l of bloco(fluxo, "ENTRADAS")) {
    const n = num(l[0]);
    const valor = num(l[4]);
    if (n == null || valor == null) continue;
    parcelas.push({
      parcela: Math.trunc(n),
      evento: txt(l[1]) || `Parcela ${Math.trunc(n)}`,
      // "25%" → 25
      pct: num(l[2]),
      dt_plano: data(l[3]),
      valor,
    });
  }
  if (!parcelas.length) avisos.push("Nenhuma parcela de entrada encontrada.");

  // ── Saídas ───────────────────────────────────────────────────────────────
  const saidas: SaidaPlano[] = [];

  // Mão de obra e despesas: nunca viram pedido de compra, então se não vierem
  // por aqui não aparecem em lugar nenhum do fluxo.
  for (const l of bloco(fluxo, "SAÍDAS DO PROJETO")) {
    const valor = num(l[3]);
    const desc = txt(l[0]);
    if (!desc || valor == null) continue;
    saidas.push({
      origem: "sem_pc",
      descricao: desc,
      fornecedor: null,
      etapa: null,
      dias_apos_base: num(l[1]) != null ? Math.trunc(num(l[1])!) : null,
      dt_prevista: data(l[2]),
      valor,
      no_fluxo: semAcento(txt(l[4])) !== "nao",
    });
  }

  // Agenda de pagamentos: os materiais, já agregados por fornecedor e
  // vencimento. É esta agregação que reproduz a curva da planilha dia a dia.
  for (const l of bloco(fluxo, "AGENDA DE PAGAMENTOS")) {
    const venc = data(l[0]);
    const valor = num(l[4]);
    const forn = txt(l[1]);
    // A última linha do bloco é o TOTAL, sem vencimento nem fornecedor.
    if (!venc || valor == null || semAcento(forn) === "" ) continue;
    saidas.push({
      origem: "material",
      descricao: `${forn}${txt(l[2]) ? ` · ${txt(l[2])}` : ""}`,
      fornecedor: forn,
      etapa: txt(l[2]) || null,
      dias_apos_base: null,
      dt_prevista: venc,
      valor,
      no_fluxo: true,
    });
  }
  if (!saidas.length) avisos.push("Nenhuma saída encontrada (nem agenda, nem mão de obra).");

  // ── Margem de contribuição ───────────────────────────────────────────────
  // As tabelas da MC são numeradas: "#  Descrição  Valor  Como é calculado".
  // Buscar pelo NÚMERO da linha é estável mesmo que o texto mude de redação.
  const mcLinha = (n: number): number | null => {
    for (const l of mc) if (num(l[0]) === n) return num(l[2]);
    return null;
  };
  const valor_venda = mcLinha(1);
  const custo_materiais = mcLinha(14);
  const custo_mao_obra = mcLinha(15);
  const custo_despesas = mcLinha(19);
  const margem_pct = mcLinha(24);
  const margem_valor = mcLinha(25);
  if (valor_venda == null) avisos.push("Não achei o faturamento total na aba MC.");

  // ── Conferências entre abas ──────────────────────────────────────────────
  //
  // As parcelas são digitadas na planilha e o valor de venda é calculado. Nada
  // no arquivo garante que fechem. Na proposta que serviu de referência elas
  // divergiam em R$ 2.500 — e um plano importado em silêncio carregaria essa
  // diferença para dentro do painel como se fosse fato.
  //
  // Não corrijo: a planilha é a fonte e talvez a diferença seja proposital
  // (um frete somado à parcela, por exemplo). Só me recuso a escondê-la.
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (valor_venda != null && parcelas.length) {
    const somaP = parcelas.reduce((a, p) => a + p.valor, 0);
    if (Math.abs(somaP - valor_venda) > 0.05) {
      avisos.push(
        `As parcelas somam ${brl(somaP)}, mas o faturamento total da MC é ${brl(valor_venda)} `
        + `— diferença de ${brl(somaP - valor_venda)}. Vem assim da planilha; confira antes de aprovar.`);
    }
  }
  const somaCustoMC = (custo_materiais ?? 0) + (custo_mao_obra ?? 0) + (custo_despesas ?? 0);
  const somaS = saidas.filter((s) => s.no_fluxo).reduce((a, s) => a + s.valor, 0);
  if (somaCustoMC > 0 && Math.abs(somaS - somaCustoMC) > 0.05) {
    avisos.push(
      `As saídas do fluxo somam ${brl(somaS)}, mas o custo total da MC é ${brl(somaCustoMC)} `
      + `— diferença de ${brl(somaS - somaCustoMC)}.`);
  }

  return {
    proposta, cliente, data_base, valor_venda,
    prazo_entrega_dias, entrega_prevista,
    frete:           condicao("Frete"),
    deslocamento:    condicao("Deslocamento e estadia"),
    instalacao:      condicao("Instalação"),
    impostos:        condicao("Impostos"),
    garantia:        condicao("Garantia"),
    forma_pagamento: condicao("Forma de pagamento"),
    faturamento:     condicao("Faturamento"),
    observacoes:     condicao("Observações"),
    custo_materiais, custo_mao_obra, custo_despesas, margem_pct, margem_valor,
    parcelas, saidas, avisos,
  };
}
