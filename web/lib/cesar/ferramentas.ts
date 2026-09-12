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
import type { SupabaseClient } from "@supabase/supabase-js";

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

// ── Ações (não são consultas ao bi) ─────────────────────────────────────────
// Chamados e reports. Diferente das consultas, estas ESCREVEM — em public.bugs
// (mesma central do SupportWidget) e em public.cesar_reports — ou devolvem uma
// ação para o navegador executar (gerar o PDF). Por isso recebem um contexto
// com o usuário logado e um cliente service_role do schema public.

/** Telas cujo controle aceita reports incorporados do Cesar. */
export const TELAS_REPORT = [
  "/bi/fluxo-caixa",
  "/bi/contas-pagar",
  "/bi/contas-receber",
  "/bi/financeiro",
  "/relatorios/faturamento",
];

// Mesmo tenant do SupportWidget (web/lib/bug-supabase.ts). Duplicado de
// propósito: aquele módulo instancia um client de BROWSER no load do módulo,
// e este arquivo roda no servidor.
const BUG_EMPRESA_ID = "b1bf590f-c281-41f8-9968-a70b0dc02b31";

export type CtxAcao = {
  /** Cliente service_role no schema PUBLIC — bugs, bug_sessions, cesar_reports. */
  publico: SupabaseClient;
  email: string;
  nome: string;
  isAdmin: boolean;
};

type DefAcao = {
  descricao: string;
  entrada: Record<string, unknown>;
  required: string[];
  exec: (ctx: CtxAcao, i: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// A leitura de status espelha o STATUS_LABEL do SupportWidget — o Cesar tem
// que contar a MESMA história que o balão de suporte conta, senão o usuário
// ouve duas versões do mesmo chamado.
const STATUS_HUMANO: Record<string, string> = {
  aberto: "recebido — na fila da análise automática",
  em_processamento: "em análise",
  aguardando_user: "aguardando uma resposta sua (responda pelo balão Suporte)",
  pronto: "resolvido — aguardando a publicação",
  pendente_merge: "quase publicando",
  validado: "concluído",
  excede_escopo: "encaminhado para avaliação humana",
  falhou: "a correção automática não conseguiu — a equipe foi avisada",
  recusado: "não tratado",
  cancelado: "cancelado",
  sugestao_futura: "sugestão registrada — aguardando o Benny avaliar",
};

export const ACOES: Record<string, DefAcao> = {
  criar_ticket: {
    descricao:
      "Abre um chamado na central de suporte do painel: problema (algo quebrado/errado — entra na fila de correção automática) ou sugestao (pedido de melhoria/função nova — fica aguardando o Benny avaliar; NADA é aprovado automaticamente). Chame SÓ depois que a pessoa CONFIRMAR que quer abrir. A descrição deve conter tudo que ela relatou: tela, o que fez, o que aconteceu, o que esperava.",
    entrada: {
      descricao: { type: "string", description: "Relato completo, em linguagem simples." },
      tipo: { type: "string", enum: ["problema", "sugestao"], description: "problema = quebrado/errado; sugestao = melhoria/função nova." },
      tela: { type: "string", description: "Caminho da tela onde aconteceu, ex.: /bi/fluxo-caixa. Opcional." },
    },
    required: ["descricao", "tipo"],
    exec: async (ctx, i) => {
      const descricao = String(i.descricao || "").trim();
      if (descricao.length < 15) return { erro: "descrição curta demais — peça mais detalhes antes de abrir" };
      const sugestao = i.tipo === "sugestao";
      const tela = typeof i.tela === "string" ? i.tela.slice(0, 200) : "";

      // Mesmo formato do SupportWidget: uma sessão + o bug ligado a ela. O
      // cron bug-analyze só pega status='aberto' — sugestão entra como
      // 'sugestao_futura' e fica parada até alguém decidir, sem disparar nada.
      const sess = await ctx.publico
        .from("bug_sessions")
        .insert({
          empresa_id: BUG_EMPRESA_ID,
          reporter_email: ctx.email,
          reporter_nome: ctx.nome,
          status: "submetida",
          bug_count: 1,
          submitted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (sess.error || !sess.data) return { erro: "não consegui registrar o chamado agora" };

      const bug = await ctx.publico
        .from("bugs")
        .insert({
          empresa_id: BUG_EMPRESA_ID,
          session_id: sess.data.id,
          reporter_email: ctx.email,
          reporter_nome: ctx.nome,
          descricao,
          url: tela,
          user_agent: "Cesar (assistente do painel)",
          console_logs: [],
          imagens_extras: [],
          mensagens: [{ role: "user", content: descricao, ts: new Date().toISOString() }],
          status: sugestao ? "sugestao_futura" : "aberto",
          contexto: { source: "cesar", tipo: sugestao ? "sugestao" : "problema", ...(tela ? { tela } : {}) },
        })
        .select("ticket_code")
        .single();
      if (bug.error || !bug.data) return { erro: "não consegui registrar o chamado agora" };

      return {
        ticket_code: bug.data.ticket_code,
        tipo: sugestao ? "sugestao" : "problema",
        mensagem: sugestao
          ? "sugestão registrada — diga o NÚMERO do ticket e explique que ela fica aguardando o Benny avaliar; dá pra acompanhar pelo balão Suporte ou perguntando aqui"
          : "chamado aberto — a análise é automática; diga o NÚMERO do ticket e que dá pra acompanhar pelo balão Suporte no canto da tela ou perguntando aqui pro Cesar",
      };
    },
  },

  consultar_ticket: {
    descricao:
      "Andamento dos chamados da própria pessoa: por código (TK...) ou, sem código, os últimos que ela abriu. Use quando perguntarem 'e meu chamado?', 'já resolveram?'.",
    entrada: {
      codigo: { type: "string", description: "Código TK..., opcional — sem ele mostra os últimos da pessoa." },
    },
    required: [],
    exec: async (ctx, i) => {
      const codigo = String(i.codigo || "").trim().toUpperCase();
      const cols = "ticket_code,status,descricao,url,created_at,github_issue_number,mensagens";
      const base = ctx.publico.from("bugs").select(cols).eq("empresa_id", BUG_EMPRESA_ID);
      const { data, error } = codigo
        ? await base.eq("ticket_code", codigo).limit(1)
        : await base.eq("reporter_email", ctx.email).order("created_at", { ascending: false }).limit(5);
      if (error) return { erro: "não consegui consultar agora" };
      if (!data?.length) return { nada: codigo ? `não achei o chamado ${codigo}` : "a pessoa não tem chamados abertos" };

      type Linha = {
        ticket_code: string | null; status: string; descricao: string | null; url: string | null;
        created_at: string; github_issue_number: number | null;
        mensagens: { role?: string; from?: string; content?: string }[] | null;
      };
      return {
        chamados: (data as Linha[]).map((b) => {
          // Igual ao effectiveStatus do widget: Issue criada com status ainda
          // 'aberto' significa que a correção já está a caminho.
          const eff = b.github_issue_number && (b.status === "aberto" || b.status === "em_processamento")
            ? "pronto" : b.status;
          const ultimaDoSuporte = (b.mensagens ?? []).filter((m) => m.role && m.role !== "user").slice(-1)[0];
          return {
            codigo: b.ticket_code,
            aberto_em: b.created_at?.slice(0, 10),
            resumo: (b.descricao || "").slice(0, 90),
            situacao: STATUS_HUMANO[eff] ?? eff,
            ...(b.url ? { tela: b.url } : {}),
            ...(ultimaDoSuporte?.content ? { ultima_mensagem_do_suporte: String(ultimaDoSuporte.content).slice(0, 300) } : {}),
          };
        }),
      };
    },
  },

  gerar_report_pdf: {
    descricao:
      "Gera um PDF profissional (título, KPIs, tabelas, gráfico de barras) que baixa na hora no navegador. Monte o conteúdo APENAS com números que as ferramentas desta conversa devolveram — nunca estime nem invente. Depois de gerar, PERGUNTE se a pessoa quer incorporar o report ao controle da tela correspondente (aí use salvar_report).",
    entrada: {
      titulo: { type: "string", description: "Título do report, ex.: 'Contas a pagar — Setembro/2026'." },
      subtitulo: { type: "string", description: "Uma linha de contexto (período, filtro, escopo)." },
      kpis: {
        type: "array",
        description: "Até 8 números de destaque.",
        items: { type: "object", properties: { rotulo: { type: "string" }, valor: { type: "string", description: "Já formatado, ex.: 'R$ 4.707,54'." } }, required: ["rotulo", "valor"] },
      },
      tabelas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            colunas: { type: "array", items: { type: "string" } },
            linhas: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Valores já formatados (R$, datas dd/mm)." },
          },
          required: ["colunas", "linhas"],
        },
      },
      barras: {
        type: "array",
        description: "Gráficos de barras horizontais (ex.: total por categoria).",
        items: {
          type: "object",
          properties: {
            titulo: { type: "string" },
            itens: { type: "array", items: { type: "object", properties: { rotulo: { type: "string" }, valor: { type: "number", description: "Valor numérico cru, para o tamanho da barra." }, texto: { type: "string", description: "Rótulo formatado exibido na ponta, ex.: 'R$ 12.300,00'." } }, required: ["rotulo", "valor"] } },
          },
          required: ["titulo", "itens"],
        },
      },
    },
    required: ["titulo"],
    exec: async (_ctx, i) => {
      const titulo = String(i.titulo || "").trim();
      if (!titulo) return { erro: "faltou o título do report" };
      const report = {
        titulo,
        subtitulo: i.subtitulo ? String(i.subtitulo) : undefined,
        kpis: Array.isArray(i.kpis) ? i.kpis : undefined,
        tabelas: Array.isArray(i.tabelas) ? i.tabelas : undefined,
        barras: Array.isArray(i.barras) ? i.barras : undefined,
      };
      if (!report.kpis?.length && !report.tabelas?.length && !report.barras?.length) {
        return { erro: "report vazio — inclua kpis, tabelas ou barras com os números consultados" };
      }
      return {
        acao_cliente: { acao: "report_pdf", report },
        mensagem: "o PDF baixa em instantes no navegador — agora PERGUNTE se a pessoa quer incorporar este report ao controle da tela correspondente (se sim, use salvar_report com o MESMO conteúdo)",
      };
    },
  },

  salvar_report: {
    descricao:
      `Incorpora um report gerado ao controle de uma tela do painel — ele fica na seção 'Reports do Cesar' no fim daquela tela, para qualquer pessoa com acesso baixar depois. Use SÓ depois que a pessoa confirmar, reenviando o MESMO conteúdo do gerar_report_pdf. Telas válidas: ${TELAS_REPORT.join(", ")}.`,
    entrada: {
      tela: { type: "string", enum: TELAS_REPORT, description: "Tela cujo controle recebe o report — a que corresponde ao assunto." },
      titulo: { type: "string" },
      report: { type: "object", description: "O mesmo objeto passado ao gerar_report_pdf (titulo, subtitulo, kpis, tabelas, barras)." },
    },
    required: ["tela", "titulo", "report"],
    exec: async (ctx, i) => {
      const tela = String(i.tela || "");
      if (!TELAS_REPORT.includes(tela)) return { erro: "tela inválida para incorporar report" };
      const titulo = String(i.titulo || "").trim();
      const report = i.report;
      if (!titulo || !report || typeof report !== "object") return { erro: "faltou o título ou o conteúdo do report" };
      const { error } = await ctx.publico.from("cesar_reports").insert({
        tela,
        titulo: titulo.slice(0, 140),
        payload: report,
        criado_por: ctx.email,
      });
      if (error) return { erro: "não consegui salvar o report agora" };
      return {
        ok: true,
        mensagem: `report incorporado ao controle de ${tela} — aparece na seção "Reports do Cesar" no fim daquela tela, com download em PDF`,
      };
    },
  },
};

/** Catálogo no formato que a API de tools espera. */
export function tools(): Anthropic.Tool[] {
  const consultas = Object.entries(FERRAMENTAS).map(([nome, d]) => ({
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
  const acoes = Object.entries(ACOES).map(([nome, d]) => ({
    name: nome,
    description: d.descricao,
    input_schema: {
      type: "object" as const,
      properties: d.entrada,
      required: d.required,
    },
  }));
  return [...consultas, ...acoes];
}

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
};

/** Executa uma ferramenta e devolve o resultado já com a truncagem declarada.
 *  Ações (chamados/reports) exigem o ctx com o usuário; consultas não. */
export async function executar(
  adm: Rpc, nome: string, entrada: Record<string, unknown>, ctx?: CtxAcao,
): Promise<Record<string, unknown>> {
  const acao = ACOES[nome];
  if (acao) {
    if (!ctx) return { erro: `${nome}: contexto do usuário ausente` };
    try {
      return await acao.exec(ctx, entrada);
    } catch (e) {
      console.error(`cesar acao ${nome}`, e);
      return { erro: "a ação falhou agora — tente de novo em instantes" };
    }
  }

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
