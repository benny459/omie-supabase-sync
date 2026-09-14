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
  /** Prazo em dias contado do eixo de pagamento. Permite recalcular a previsão
   *  quando o eixo se move, em vez de redigitar as datas uma a uma. */
  dias: number | null;
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
  /** O que a MC calculou. */
  valor_venda: number | null;
  /** O que foi ACORDADO ao ganhar. Quando os dois diferem, vale este — é o que
   *  a própria planilha declara na observação. */
  valor_fechado: number | null;
  confirmado_por: string | null;
  confirmado_em: string | null;
  /** De onde os prazos de pagamento contam. Não é a data_base: aquela é o eixo
   *  das etapas de obra, e as duas podem ser diferentes. */
  eixo_pagamento: string | null;
  /** O texto que foi ao PDF e que o cliente aceitou — separado do confirmado,
   *  porque a planilha separa, e a diferença entre os dois é informação. */
  prop_pagamento: string | null;
  prop_faturamento: string | null;
  prop_prazo: string | null;
  prop_frete: string | null;
  prop_garantia: string | null;
  prop_instalacao: string | null;
  prop_observacoes: string | null;
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
  // A aba Condições virou a autoridade do fechamento na revisão de 14/09; antes
  // só existia o resumo espelhado na aba Fluxo. Lê-se dela quando existe e cai
  // para o espelho quando não — planilha antiga continua importando.
  const condAba = wb.Sheets["Condições"]
    ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Condições"],
        { header: 1, blankrows: true, defval: null })
    : [];

  /** Lê um bloco "Item | Confirmado | (vazio) | Observação" num mapa. */
  const mapaBloco = (m: Matriz, marcador: string) => {
    const out = new Map<string, { conf: string; obs: string }>();
    for (const l of bloco(m, marcador)) {
      const k = semAcento(txt(l[0]));
      if (!k) continue;
      // A coluna 2 costuma ser vazia (merge da planilha); a observação é a 3.
      out.set(k, { conf: txt(l[1]), obs: txt(l[3]) || txt(l[2]) });
    }
    return out;
  };
  const fech = mapaBloco(condAba, "FECHAMENTO —");
  const conta = mapaBloco(condAba, "POR CONTA DE QUEM");
  const entrega = mapaBloco(condAba, "ENTREGA E PRAZOS");
  const propTxt = mapaBloco(condAba, "TEXTO DA PROPOSTA");
  const buscar = (m: Map<string, { conf: string; obs: string }>, k: string) =>
    m.get(semAcento(k))?.conf || null;

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
  const prazo_entrega_dias = (prazoRaw ? num(prazoRaw.conf.replace(/dias?/i, "")) : null)
    ?? num((buscar(entrega, "Prazo de entrega") ?? "").replace(/dias?/i, ""));
  const entrega_prevista = (prazoRaw
      ? data(prazoRaw.prop.split("previsão").pop()?.trim() ?? "") : null)
    ?? data(buscar(entrega, "Entrega prevista") ?? "");
  const data_base = data(cond.get(semAcento("Início oficial do projeto"))?.conf ?? "")
    ?? data(buscar(entrega, "Início oficial do projeto") ?? "")
    ?? (prazoRaw ? data(prazoRaw.prop.match(/a partir de\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? "") : null);

  // ── O que só a aba Condições diz ─────────────────────────────────────────
  const valor_fechado = num(buscar(fech, "Valor total fechado"));
  const confirmado_por = buscar(fech, "Confirmado por");
  // "Confirmado por | Benny A. | | em 13/09/2026, 17:28:25"
  const confirmado_em = fech.get(semAcento("Confirmado por"))?.obs
    ?.replace(/^em\s*/i, "").trim() || null;

  /** O eixo dos PRAZOS DE PAGAMENTO, que pode não ser o início do projeto.
   *
   *  Na proposta de referência são 31/08 e 11/09 — onze dias de diferença.
   *  Tratá-los como a mesma data deslocaria todas as previsões de faturamento,
   *  e o erro seria invisível porque as duas datas parecem a mesma coisa. */
  const eixo_pagamento = data(buscar(entrega, "Prazos de pagamento contam de") ?? "");

  if (!cond.size) avisos.push("Não achei o bloco de condições de fechamento.");

  // ── Parcelas de entrada ──────────────────────────────────────────────────
  //
  // Duas fontes para a mesma lista. A da aba Condições é mais rica — traz a
  // coluna DIAS, que é o prazo contra o eixo de pagamento e permite recalcular
  // as datas se o eixo se mover. Quando ela não existe (planilha antiga), o
  // espelho da aba Fluxo serve.
  //
  //   Condições: # | Evento | % | Dias | Previsão | Valor
  //   Fluxo:     # | Evento | % | Previsão | Valor
  const parcelas: ParcelaPlano[] = [];
  const linhasCond = bloco(condAba, "PARCELAS ACORDADAS");
  if (linhasCond.length) {
    for (const l of linhasCond) {
      const n = num(l[0]);
      const valor = num(l[5]);
      // A última linha do bloco é o TOTAL — não tem número de parcela.
      if (n == null || valor == null) continue;
      parcelas.push({
        parcela: Math.trunc(n),
        evento: txt(l[1]) || `Parcela ${Math.trunc(n)}`,
        pct: num(l[2]),
        dias: num(l[3]) != null ? Math.trunc(num(l[3])!) : null,
        dt_plano: data(l[4]),
        valor,
      });
    }
  } else {
    for (const l of bloco(fluxo, "ENTRADAS")) {
      const n = num(l[0]);
      const valor = num(l[4]);
      if (n == null || valor == null) continue;
      parcelas.push({
        parcela: Math.trunc(n),
        evento: txt(l[1]) || `Parcela ${Math.trunc(n)}`,
        pct: num(l[2]),   // "25%" → 25
        dias: null,
        dt_plano: data(l[3]),
        valor,
      });
    }
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

  // As parcelas conferem contra o VALOR FECHADO, não contra o calculado na MC.
  // A planilha declara qual dos dois vale ("Difere do valor calculado na
  // proposta — vale o que foi fechado"), e medir contra o errado acusaria uma
  // divergência que não existe enquanto esconde a que existe.
  const referencia = valor_fechado ?? valor_venda;
  const rotRef = valor_fechado != null ? "o valor fechado" : "o faturamento total da MC";
  if (referencia != null && parcelas.length) {
    const somaP = parcelas.reduce((a, p) => a + p.valor, 0);
    if (Math.abs(somaP - referencia) > 0.05) {
      avisos.push(
        `As parcelas somam ${brl(somaP)}, mas ${rotRef} é ${brl(referencia)} `
        + `— diferença de ${brl(somaP - referencia)}. Vem assim da planilha; confira antes de aprovar.`);
    }
  }
  // Fechado ≠ calculado não é erro: é a negociação. Mas é o número que muda a
  // margem do projeto, então a tela precisa dizer que mudou.
  if (valor_fechado != null && valor_venda != null
      && Math.abs(valor_fechado - valor_venda) > 0.05) {
    avisos.push(
      `Valor fechado ${brl(valor_fechado)} contra ${brl(valor_venda)} calculado na proposta `
      + `(${valor_fechado > valor_venda ? "+" : ""}${brl(valor_fechado - valor_venda)}). `
      + `Vale o fechado — a margem projetada da MC foi calculada sobre o outro.`);
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
    valor_fechado, confirmado_por, confirmado_em, eixo_pagamento,
    prop_pagamento:   buscar(propTxt, "Pagamento"),
    prop_faturamento: buscar(propTxt, "Faturamento"),
    prop_prazo:       buscar(propTxt, "Prazo de entrega"),
    prop_frete:       buscar(propTxt, "Frete"),
    prop_garantia:    buscar(propTxt, "Garantia"),
    prop_instalacao:  buscar(propTxt, "Instalação"),
    prop_observacoes: buscar(propTxt, "Observações"),
    prazo_entrega_dias, entrega_prevista,
    // Preferir a aba Condições (a autoridade) e cair para o espelho da Fluxo.
    frete:           buscar(conta, "Frete")                  ?? condicao("Frete"),
    deslocamento:    buscar(conta, "Deslocamento e estadia") ?? condicao("Deslocamento e estadia"),
    instalacao:      buscar(conta, "Instalação")             ?? condicao("Instalação"),
    impostos:        buscar(conta, "Impostos")               ?? condicao("Impostos"),
    garantia:        condicao("Garantia")                    ?? buscar(propTxt, "Garantia"),
    forma_pagamento: buscar(fech, "Forma de pagamento")      ?? condicao("Forma de pagamento"),
    faturamento:     condicao("Faturamento")                 ?? buscar(propTxt, "Faturamento"),
    observacoes:     condicao("Observações")                 ?? buscar(propTxt, "Observações"),
    custo_materiais, custo_mao_obra, custo_despesas, margem_pct, margem_valor,
    parcelas, saidas, avisos,
  };
}
