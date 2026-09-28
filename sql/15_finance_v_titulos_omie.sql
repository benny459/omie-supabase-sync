-- 15: finance.v_titulos_omie — TODOS os campos do título, como o Omie os devolve.
--
-- Porquê uma view nova em vez de mexer na v_titulos:
--   A v_titulos lê finance.contas_pagar (+ contas_receber). Medido em 28/09/26,
--   essa fonte é um SUBCONJUNTO estrito de finance.pesquisa_titulos:
--     · 0 títulos existem só na contas_pagar
--     · 42.126 existem só na pesquisa_titulos
--     · janela 2019→2050 contra 2022→2050
--     · 69 colunas contra 41, e sync mais recente
--   Ou seja, a tela lia a fonte mais pobre, menor e mais velha. Esta view passa
--   a ler a completa. A v_titulos fica intacta porque as funções de BI (tit_*,
--   ap_*) dependem dela — trocar as duas coisas ao mesmo tempo misturaria uma
--   mudança de fonte com uma mudança de números.
--
-- Nada é filtrado aqui de propósito: cancelados, liquidados e sem data entram.
-- Quem decide o que mostrar é a tela; uma view que esconde é uma view que mente.

CREATE OR REPLACE VIEW finance.v_titulos_omie AS
SELECT
  -- ── Identidade ────────────────────────────────────────────────────────────
  p.empresa,
  p.natureza,                                    -- 'P' a pagar · 'R' a receber
  CASE p.natureza WHEN 'P' THEN 'pagar' ELSE 'receber' END  AS tipo,
  p.cod_titulo,
  p.cod_int_titulo,
  p.cod_tit_repet,                               -- recorrência: repetição de qual título
  p.num_titulo,
  p.num_parcela,
  p.num_doc_fiscal,
  p.num_boleto,
  p.codigo_barras,
  p.nsu,
  p.chave_nfe,
  p.num_contrato,
  p.cod_contrato,
  p.num_os,
  p.cod_os,
  p.cod_nf,

  -- ── Contraparte ───────────────────────────────────────────────────────────
  p.cod_cliente,
  COALESCE(NULLIF(cli.nome_fantasia, ''), cli.razao_social)  AS contraparte,
  cli.razao_social                               AS contraparte_razao,
  COALESCE(NULLIF(p.cpf_cnpj_cliente, ''), cli.cnpj_cpf)     AS cnpj_cpf,
  p.cod_vendedor,
  p.cod_comprador,

  -- ── Datas (o Omie manda dd/mm/yyyy; as _d já vêm em date) ─────────────────
  p.dt_registro,
  p.dt_emissao_d                                 AS emissao,
  p.dt_vencimento_d                              AS vencimento,
  p.dt_previsao_d                                AS previsao,
  p.dt_pagamento_d                               AS pagamento,
  p.dt_cancelamento,

  -- ── Dinheiro ──────────────────────────────────────────────────────────────
  p.valor_titulo,
  p.val_liquido,
  p.val_pago,
  p.val_aberto,                                  -- saldo devedor do título
  p.juros,
  p.multa,
  p.desconto,

  -- ── Impostos retidos ──────────────────────────────────────────────────────
  p.valor_ir,    p.ret_ir,
  p.valor_pis,   p.ret_pis,
  p.valor_cofins, p.ret_cofins,
  p.valor_csll,  p.ret_csll,
  p.valor_inss,  p.ret_inss,
  p.valor_iss,   p.ret_iss,

  -- ── Classificação ─────────────────────────────────────────────────────────
  p.cod_categoria,
  cat.descricao                                  AS categoria,
  p.categorias_rateio,                           -- '2.01.01, 2.01.03' quando rateado
  -- Rateado é diferente de mal classificado: a tela precisa distinguir para não
  -- somar o título inteiro numa categoria só.
  (p.categorias_rateio LIKE '%,%')               AS tem_rateio,
  p.grupo_despesa,
  p.cod_projeto,
  proj.nome                                      AS projeto,
  p.cod_cc,
  cc.descricao                                   AS conta_corrente,
  p.operacao,
  p.origem,                                      -- ADCP APIP BARP COMP CTEP DEVP IMPP MANP RPTP
  p.tipo                                         AS tipo_documento,

  -- ── Estado ────────────────────────────────────────────────────────────────
  p.status,                                      -- do Omie: A VENCER ATRASADO VENCE HOJE PAGO LIQUIDADO CANCELADO
  p.liquidado,
  p.status_pago_d,
  p.observacao,

  -- ── Auditoria do Omie ─────────────────────────────────────────────────────
  p.info_d_inc, p.info_h_inc, p.info_u_inc,
  p.info_d_alt, p.info_h_alt, p.info_u_alt,
  p.synced_at,

  -- ── Derivados de leitura ──────────────────────────────────────────────────
  -- Em aberto pelo saldo, não pelo status: título com status velho mas saldo
  -- zero já não se paga, e o inverso também acontece.
  (COALESCE(p.val_aberto, 0) > 0
     AND COALESCE(p.dt_cancelamento, '') = '')   AS em_aberto,
  (p.dt_vencimento_d - CURRENT_DATE)             AS dias_para_vencer
FROM finance.pesquisa_titulos p
LEFT JOIN finance.clientes cli
       ON cli.empresa = p.empresa AND cli.codigo_cliente_omie = p.cod_cliente
LEFT JOIN finance.categorias cat
       ON cat.empresa = p.empresa AND cat.codigo = p.cod_categoria
LEFT JOIN finance.projetos proj
       ON proj.empresa = p.empresa AND proj.codigo::text = p.cod_projeto
LEFT JOIN finance.contas_correntes cc
       ON cc.empresa = p.empresa AND cc.cod_cc = p.cod_cc;

COMMENT ON VIEW finance.v_titulos_omie IS
  'Título do Omie com todos os campos (fonte: finance.pesquisa_titulos, superconjunto de contas_pagar). Base da tela operacional de Contas a Pagar.';
