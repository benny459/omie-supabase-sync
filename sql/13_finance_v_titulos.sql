-- 13: finance.v_titulos — visão unificada de Contas a Pagar + Contas a Receber
-- para o módulo Financeiro do painel (rotas /financeiro/pagar e /financeiro/receber).
-- Junta nomes (fornecedor/cliente, categoria, projeto, conta corrente) e converte
-- as datas dd/mm/yyyy do Omie pra date via approval.try_parse_br_date.

CREATE OR REPLACE VIEW finance.v_titulos AS
SELECT
  'pagar'::text                                   AS tipo,
  cp.empresa,
  cp.codigo_lancamento_omie,
  cp.codigo_cliente_fornecedor,
  COALESCE(NULLIF(cli.nome_fantasia, ''), cli.razao_social) AS contraparte,
  cli.razao_social                                AS contraparte_razao,
  cli.cnpj_cpf,
  approval.try_parse_br_date(cp.data_vencimento)  AS vencimento,
  approval.try_parse_br_date(cp.data_previsao)    AS previsao,
  approval.try_parse_br_date(cp.data_emissao)     AS emissao,
  cp.valor_documento,
  cp.valor_pago,
  cp.status_titulo,
  cp.numero_documento,
  cp.numero_parcela,
  cp.numero_documento_fiscal,
  cp.numero_pedido,
  cp.chave_nfe,
  cp.codigo_categoria,
  cat.descricao                                   AS categoria,
  cp.codigo_projeto,
  proj.nome                                       AS projeto,
  cc.descricao                                    AS conta_corrente,
  cp.observacao,
  NULL::text                                      AS boleto_gerado,
  NULL::text                                      AS boleto_numero,
  cp.synced_at
FROM finance.contas_pagar cp
LEFT JOIN finance.clientes cli
       ON cli.empresa = cp.empresa AND cli.codigo_cliente_omie = cp.codigo_cliente_fornecedor
LEFT JOIN finance.categorias cat
       ON cat.empresa = cp.empresa AND cat.codigo = cp.codigo_categoria
LEFT JOIN finance.projetos proj
       ON proj.empresa = cp.empresa AND proj.codigo = cp.codigo_projeto
LEFT JOIN finance.contas_correntes cc
       ON cc.empresa = cp.empresa AND cc.cod_cc = cp.id_conta_corrente

UNION ALL

SELECT
  'receber'::text,
  cr.empresa,
  cr.codigo_lancamento_omie,
  cr.codigo_cliente_fornecedor,
  COALESCE(NULLIF(cli.nome_fantasia, ''), cli.razao_social),
  cli.razao_social,
  cli.cnpj_cpf,
  approval.try_parse_br_date(cr.data_vencimento),
  approval.try_parse_br_date(cr.data_previsao),
  approval.try_parse_br_date(cr.data_emissao),
  cr.valor_documento,
  NULL::numeric,
  cr.status_titulo,
  cr.numero_documento,
  cr.numero_parcela,
  cr.numero_documento_fiscal,
  cr.numero_pedido,
  cr.chave_nfe,
  cr.codigo_categoria,
  cat.descricao,
  cr.codigo_projeto,
  proj.nome,
  cc.descricao,
  cr.observacao,
  cr.boleto_gerado,
  cr.boleto_numero,
  cr.synced_at
FROM finance.contas_receber cr
LEFT JOIN finance.clientes cli
       ON cli.empresa = cr.empresa AND cli.codigo_cliente_omie = cr.codigo_cliente_fornecedor
LEFT JOIN finance.categorias cat
       ON cat.empresa = cr.empresa AND cat.codigo = cr.codigo_categoria
LEFT JOIN finance.projetos proj
       ON proj.empresa = cr.empresa AND proj.codigo = cr.codigo_projeto
LEFT JOIN finance.contas_correntes cc
       ON cc.empresa = cr.empresa AND cc.cod_cc = cr.id_conta_corrente;

GRANT SELECT ON finance.v_titulos TO service_role;
