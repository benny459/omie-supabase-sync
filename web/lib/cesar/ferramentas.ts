// As ferramentas do Cesar.
//
// ── Por que ferramenta fixa, e não SQL livre ─────────────────────────────────
// A tentação num "agente que domina o financeiro" é dar a ele o banco e deixar
// escrever a própria consulta. O defeito que isso produz é específico e já
// apareceu três vezes neste projeto só nesta semana: somar através de um join
// que devolve mais de uma linha por chave. Em todas, o número saiu PLAUSÍVEL —
// margem de 100% onde não havia custo lançado, R$ 155 mil de compra onde havia
// R$ 61 mil, categoria de uma empresa aplicada a outra. Nenhum deles pareceu
// errado; um deles só caiu porque o Benny conhecia a venda.
//
// Um modelo que escreve SQL erra a mesma coisa e ainda afirma com convicção.
// Então o Cesar não escreve consulta: ele CHAMA função que já existe, já está
// na tela e já foi conferida. Se faltar alcance, a resposta é acrescentar
// ferramenta aqui — não afrouxar a regra.
//
// ── Truncagem ───────────────────────────────────────────────────────────────
// Toda ferramenta que devolve lista tem teto. O teto é DECLARADO na resposta
// (`truncado`), porque a falha grave não é a lista curta — é o Cesar somar uma
// lista cortada e anunciar o total. O prompt manda usar a função de resumo
// nesse caso.

import type Anthropic from "@anthropic-ai/sdk";

/** Escopo padrão do painel, o mesmo das telas. Deixar explícito evita a
 *  pergunta "esses números são de qual empresa?" a cada resposta. */
export const EMP_RECEBER = ["SF"];
export const EMP_PAGAR   = ["SF", "CD", "WW"];

const TETO_PADRAO = 150;

type Def = {
  /** Função em `bi`. */
  fn: string;
  descricao: string;
  /** JSON Schema das entradas que o Cesar controla. */
  entrada: Record<string, unknown>;
  /** Monta os argumentos da RPC a partir do que o modelo pediu. É aqui que o
   *  escopo de empresa é fixado — não é decisão do modelo. */
  args: (i: Record<string, unknown>) => Record<string, unknown>;
  teto?: number;
};

const dataOpt = (desc: string) => ({ type: "string", description: `${desc} (AAAA-MM-DD).` });
const natureza = {
  type: "string", enum: ["R", "P"],
  description: "R = a receber (cliente me deve). P = a pagar (devo ao fornecedor).",
};
const periodo = {
  p_from: dataOpt("Início do período"),
  p_to:   dataOpt("Fim do período"),
};

/** Empresas conforme a natureza — o painel recebe pela Safe e paga pelo grupo. */
const empDe = (n: unknown) => (n === "P" ? EMP_PAGAR : EMP_RECEBER);

export const FERRAMENTAS: Record<string, Def> = {
  // ── Caixa ────────────────────────────────────────────────────────────────
  saldo_por_conta: {
    fn: "saldo_por_conta",
    descricao: "Saldo atual de cada conta bancária, por empresa, com a data do último extrato importado. Use para responder 'quanto tenho em caixa hoje'.",
    entrada: {},
    args: () => ({ p_empresas: null }),
  },
  fluxo_realizado: {
    fn: "fluxo_caixa_realizado",
    descricao: "O que JÁ se moveu no caixa, dia a dia, pela data de baixa do título. Vai até ontem. Use para 'o que entrou e saiu na última semana/mês'. Não é o extrato bancário: tarifa e transferência entre contas não passam por título.",
    entrada: {
      p_dias_atras: { type: "integer", description: "Quantos dias para trás. Máximo 365." },
    },
    args: (i) => ({ p_dias_atras: Math.min(Number(i.p_dias_atras) || 30, 365) }),
    teto: 400,
  },
  fluxo_titulos: {
    fn: "fluxo_caixa_titulos",
    descricao: "Títulos que compõem a projeção do caixa, um a um, com previsão, valor, contraparte e categoria. Use para 'o que vence nos próximos X dias' ou 'quais títulos estão atrasados'. Lista longa — prefira fluxo_realizado ou titulos_resumo quando a pergunta for de total.",
    entrada: {
      p_dias: { type: "integer", description: "Horizonte em dias a partir de hoje (7 a 180)." },
      p_so_atrasados: { type: "boolean", description: "true traz apenas os já vencidos." },
    },
    args: (i) => ({
      p_dias: Math.min(Math.max(Number(i.p_dias) || 60, 7), 180),
      p_so_atrasados: !!i.p_so_atrasados,
      p_ano: null,
    }),
    teto: 200,
  },

  // ── Títulos, os dois lados ───────────────────────────────────────────────
  titulos_resumo: {
    fn: "tit_resumo",
    descricao: "Totais em aberto de um lado: saldo aberto, quantidade, a vencer, em atraso, esta semana, próximos 30 dias e total liquidado no período. É a fonte certa para QUALQUER total — nunca some uma lista para chegar num total.",
    entrada: { p_natureza: natureza },
    args: (i) => ({ p_natureza: i.p_natureza, p_empresas: empDe(i.p_natureza) }),
  },
  titulos_aging: {
    fn: "tit_aging",
    descricao: "Vencido repartido por idade do atraso (faixas). Use para 'há quanto tempo está parado'.",
    entrada: { p_natureza: natureza },
    args: (i) => ({ p_natureza: i.p_natureza, p_empresas: empDe(i.p_natureza) }),
  },
  titulos_horizonte: {
    fn: "tit_horizonte",
    descricao: "Reparte o saldo aberto em vencido, o que vence no horizonte (90 dias) e o futuro contratado além disso.",
    entrada: { p_natureza: natureza },
    args: (i) => ({ p_natureza: i.p_natureza, p_empresas: empDe(i.p_natureza) }),
  },
  titulos_mensal: {
    fn: "tit_mensal",
    descricao: "Mês a mês: quanto foi EMITIDO e quanto foi LIQUIDADO de um lado. A diferença entre os dois é o que a projeção do caixa carrega para frente.",
    entrada: { p_natureza: natureza, ...periodo },
    args: (i) => ({ p_natureza: i.p_natureza, p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_empresas: empDe(i.p_natureza) }),
    teto: 60,
  },
  top_contrapartes: {
    fn: "tit_top_contraparte",
    descricao: "Maiores clientes (R) ou fornecedores (P) por valor LIQUIDADO no período — para onde o dinheiro foi, ou de onde veio.",
    entrada: { p_natureza: natureza, ...periodo,
               p_limit: { type: "integer", description: "Quantos nomes (padrão 20)." } },
    args: (i) => ({ p_natureza: i.p_natureza, p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_empresas: empDe(i.p_natureza), p_limit: Math.min(Number(i.p_limit) || 20, 60),
                    p_pagos: true }),
    teto: 60,
  },
  em_atraso: {
    fn: "contrapartes_em_atraso",
    descricao: "Quem concentra o vencido, com valor, quantidade de títulos, pior atraso, atraso médio e a repartição até 30d / 31-90d / 90d+. Use para 'quem me deve' e 'a quem eu devo'. A coluna 90d+ separa atraso operacional de passivo antigo.",
    entrada: { p_natureza: natureza,
               p_limit: { type: "integer", description: "Quantos nomes (padrão 25)." } },
    args: (i) => ({ p_natureza: i.p_natureza, p_empresas: empDe(i.p_natureza),
                    p_limit: Math.min(Number(i.p_limit) || 25, 80) }),
    teto: 80,
  },
  titulos_detalhe: {
    fn: "titulos_detalhe",
    descricao: "Títulos linha a linha de um lado, com contraparte, categoria, vencimento, previsão e valor. Use quando a pergunta for 'quais exatamente'.",
    entrada: { p_natureza: natureza, ...periodo,
               p_apenas_abertos: { type: "boolean", description: "true (padrão) só o que está em aberto." } },
    args: (i) => ({ p_natureza: i.p_natureza, p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_empresas: empDe(i.p_natureza),
                    p_apenas_abertos: i.p_apenas_abertos !== false,
                    p_base_data: "previsao", p_limit: 400 }),
    teto: 200,
  },

  // ── Faturamento e recebíveis ─────────────────────────────────────────────
  faturamento_resumo: {
    fn: "fat_resumo",
    descricao: "Totais de faturamento no período: valor, quantidade de documentos, ticket médio.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
  },
  faturamento_mensal_categoria: {
    fn: "fat_mensal_categoria",
    descricao: "Faturamento mês a mês repartido por tipo de venda (Projetos, Contratuais, Avulsos, Revenda, BOT/SW).",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 120,
  },
  coorte_faturamento: {
    fn: "fat_coorte",
    descricao: "Do que foi faturado em cada MÊS, quanto já virou dinheiro: recebido, a vencer, vencido e sem título emitido, mais o % recebido. Responde 'o que aconteceu com o faturamento de julho'.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 60,
  },
  coorte_por_tipo_venda: {
    fn: "fat_coorte_categoria",
    descricao: "A mesma coorte, aberta por tipo de venda. É onde se vê que Projetos atrasa diferente de Avulsos — o total esconde isso.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 200,
  },
  coorte_detalhe: {
    fn: "fat_coorte_detalhe",
    descricao: "A lista de clientes e documentos por trás de um número da coorte. Escolha o tipo de venda e a parcela. Use quando o Benny perguntar QUEM está por trás de um valor.",
    entrada: {
      ...periodo,
      p_categoria: { type: "string", description: "Tipo de venda exato: Projetos, Contratuais, Avulsos, Revenda, BOT/SW. Omita para todos." },
      p_bucket: { type: "string", enum: ["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"],
                  description: "Qual parcela detalhar." },
    },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_categoria: i.p_categoria ?? null, p_bucket: i.p_bucket ?? "faturado",
                    p_empresas: EMP_RECEBER }),
    teto: 200,
  },
  maiores_faturamentos: {
    fn: "fat_top",
    descricao: "Maiores do período por dimensão: projeto, cliente ou categoria.",
    entrada: { ...periodo,
               p_dim: { type: "string", enum: ["projeto", "cliente", "categoria"], description: "Como agrupar." },
               p_limit: { type: "integer", description: "Quantos (padrão 20)." } },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_dim: i.p_dim ?? "cliente", p_limit: Math.min(Number(i.p_limit) || 20, 60) }),
    teto: 60,
  },
  prazos_faturamento: {
    fn: "fat_prazos",
    descricao: "Prazos praticados: quanto tempo entre faturar e vencer, e entre vencer e receber.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 60,
  },

  // ── Resultado ────────────────────────────────────────────────────────────
  dre: {
    fn: "dre_resumida",
    descricao: "DRE resumida do período: receitas, custos e despesas por macro-grupo, com o resultado.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 80,
  },
  dre_despesas: {
    fn: "dre_saidas",
    descricao: "As saídas abertas por categoria, com opção de média mensal e de abrir por mês. Use para 'onde estou gastando' e 'quanto gasto por mês com X'.",
    entrada: { ...periodo,
               p_macro_grupo: { type: "string", description: "Filtra um macro-grupo específico. Omita para todos." },
               p_media_mensal: { type: "boolean", description: "true devolve a média mensal em vez do total." },
               p_por_mes: { type: "boolean", description: "true abre mês a mês." } },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_macro_grupo: i.p_macro_grupo ?? null,
                    p_media_mensal: !!i.p_media_mensal, p_por_mes: !!i.p_por_mes }),
    teto: 200,
  },
  dre_despesas_detalhe: {
    fn: "dre_saidas_detalhe",
    descricao: "Lançamentos de saída um a um, para conferir uma categoria que chamou atenção.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null, p_limit: 300 }),
    teto: 200,
  },
  previsto_realizado_mensal: {
    fn: "fluxo_mensal_previsto_realizado",
    descricao: "Mês a mês do ano: entrada e saída previstas contra realizadas, e o resultado dos dois. Responde 'o mês fechou como eu esperava'.",
    entrada: { p_ano: { type: "integer", description: "Ano. Omita para o corrente." } },
    args: (i) => ({ p_ano: i.p_ano ?? null }),
    teto: 24,
  },
  ciclo_financeiro: {
    fn: "ciclo_financeiro",
    descricao: "Prazo médio de recebimento, de pagamento e o ciclo entre os dois. Diz se estou financiando o cliente.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
  },

  // ── Margem e rentabilidade ───────────────────────────────────────────────
  margem_total: {
    fn: "margem_total",
    descricao: "Margem consolidada do período: receita, custo e percentual.",
    entrada: { ...periodo,
               p_media_mensal: { type: "boolean", description: "true devolve média mensal." } },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_media_mensal: !!i.p_media_mensal }),
  },
  margem_por_venda: {
    fn: "monitor_margem_venda",
    descricao: "Margem de cada venda avulsa, com receita, custo de compra e a faixa. ATENÇÃO ao ler: 'Sem custo lançado' NÃO é margem de 100% — é ausência de informação. Nunca trate faixa sem custo como venda lucrativa.",
    entrada: { ...periodo,
               p_cat_venda: { type: "array", items: { type: "string" },
                              description: "Tipos de venda. Omita para todos." } },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_cat_venda: i.p_cat_venda ?? null, p_base_data: "faturamento", p_limit: 2000 }),
    teto: 200,
  },
  margem_por_projeto: {
    fn: "margem_por_projeto",
    descricao: "Margem por projeto. Leia junto com cobertura_custo_projeto: boa parte das compras não carrega código de projeto, então projeto sem custo ligado aparece com margem alta sem ser verdade.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 120,
  },
  cobertura_custo_projeto: {
    fn: "cobertura_custo_projeto",
    descricao: "Que fração das compras do período tem código de projeto. É o denominador de confiança da margem por projeto — cite sempre que falar dela.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
  },
  rentabilidade_cliente: {
    fn: "rentabilidade_cliente",
    descricao: "Por cliente: faturamento, compras, despesas, mão de obra e a margem resultante.",
    entrada: { ...periodo,
               p_limit: { type: "integer", description: "Quantos clientes (padrão 30)." } },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null,
                    p_limit: Math.min(Number(i.p_limit) || 30, 80) }),
    teto: 80,
  },

  // ── Vendas e compras ─────────────────────────────────────────────────────
  vendas_resumo: {
    fn: "vendas_resumo",
    descricao: "Pedidos de venda e ordens de serviço no período: quantidade, valor, situação.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
  },
  compras_mensal: {
    fn: "compras_mensal",
    descricao: "Compras mês a mês.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null }),
    teto: 60,
  },
  compras_por_grupo: {
    fn: "ap_por_grupo",
    descricao: "Contas a pagar agrupadas por grupo de categoria — a visão de 'com o que eu gasto'.",
    entrada: { ...periodo },
    args: (i) => ({ p_from: i.p_from ?? null, p_to: i.p_to ?? null, p_empresas: EMP_PAGAR }),
    teto: 80,
  },
};

/** Catálogo no formato que a API de tools espera. */
export function tools(): Anthropic.Tool[] {
  return Object.entries(FERRAMENTAS).map(([nome, d]) => ({
    name: nome,
    description: d.descricao,
    input_schema: {
      type: "object" as const,
      properties: d.entrada,
      required: Object.entries(d.entrada)
        // Natureza é a única sem padrão razoável: "quanto está vencido" sem
        // dizer de que lado é pergunta ambígua, e escolher por ele seria
        // responder outra coisa.
        .filter(([k]) => k === "p_natureza")
        .map(([k]) => k),
    },
  }));
}

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
};

/** Executa uma ferramenta e devolve o resultado já com a truncagem declarada. */
export async function executar(
  adm: Rpc, nome: string, entrada: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const d = FERRAMENTAS[nome];
  if (!d) return { erro: `ferramenta desconhecida: ${nome}` };

  const { data, error } = await adm.rpc(d.fn, d.args(entrada));
  if (error) return { erro: `${d.fn}: ${error.message}` };

  const linhas = Array.isArray(data) ? data : data == null ? [] : [data];
  const teto = d.teto ?? TETO_PADRAO;
  const truncado = linhas.length > teto;

  return {
    funcao: d.fn,
    linhas: truncado ? linhas.slice(0, teto) : linhas,
    total_linhas: linhas.length,
    truncado,
    ...(truncado
      ? { aviso: `Lista cortada em ${teto} de ${linhas.length} linhas. NÃO some estas linhas para dar um total — chame a ferramenta de resumo correspondente.` }
      : {}),
  };
}
