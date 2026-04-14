-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 05 -- finance.* (Contas Pagar, Contas Receber, Pesquisa Titulos,
--   Extratos CC, Clientes, Categorias, Projetos, Contas Correntes, Empresas,
--   Parcelas, Lancamentos CC, Auxiliares financeiros)
--
-- Execute este bloco inteiro no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/zodflkfdnjhtwcjutbjl/sql/new
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS finance;

-- ---------------------------------------------------------------------------
-- 1. finance.contas_pagar (endpoint: /financas/contapagar/ | ListarContasPagar)
-- Contas a pagar. 40 colunas.
-- PK: (empresa, codigo_lancamento_omie)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.contas_pagar (
  empresa                       TEXT    NOT NULL,
  codigo_lancamento_omie        BIGINT  NOT NULL,
  codigo_lancamento_integracao  TEXT,
  codigo_cliente_fornecedor     BIGINT,
  data_vencimento               TEXT,
  data_previsao                 TEXT,
  valor_documento               NUMERIC,
  valor_pago                    NUMERIC,
  codigo_categoria              TEXT,
  categorias_rateio             TEXT,
  id_conta_corrente             BIGINT,
  numero_documento_fiscal       TEXT,
  data_emissao                  TEXT,
  data_entrada                  TEXT,
  codigo_projeto                BIGINT,
  numero_pedido                 TEXT,
  numero_documento              TEXT,
  numero_parcela                TEXT,
  chave_nfe                     TEXT,
  status_titulo                 TEXT,
  id_origem                     TEXT,
  observacao                    TEXT,
  valor_pis                     NUMERIC,
  retem_pis                     TEXT,
  valor_cofins                  NUMERIC,
  retem_cofins                  TEXT,
  valor_csll                    NUMERIC,
  retem_csll                    TEXT,
  valor_ir                      NUMERIC,
  retem_ir                      TEXT,
  valor_iss                     NUMERIC,
  retem_iss                     TEXT,
  valor_inss                    NUMERIC,
  retem_inss                    TEXT,
  info_d_inc                    TEXT,
  info_h_inc                    TEXT,
  info_u_inc                    TEXT,
  info_d_alt                    TEXT,
  info_h_alt                    TEXT,
  info_u_alt                    TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_lancamento_omie)
);

CREATE INDEX IF NOT EXISTS idx_cp_empresa       ON finance.contas_pagar(empresa);
CREATE INDEX IF NOT EXISTS idx_cp_vencimento    ON finance.contas_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cp_status        ON finance.contas_pagar(status_titulo);
CREATE INDEX IF NOT EXISTS idx_cp_cliente       ON finance.contas_pagar(codigo_cliente_fornecedor);
CREATE INDEX IF NOT EXISTS idx_cp_emissao       ON finance.contas_pagar(data_emissao);

-- ---------------------------------------------------------------------------
-- 2. finance.contas_receber (endpoint: /financas/contareceber/ | ListarContasReceber)
-- Contas a receber. 43 colunas (inclui boleto).
-- PK: (empresa, codigo_lancamento_omie)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.contas_receber (
  empresa                       TEXT    NOT NULL,
  codigo_lancamento_omie        BIGINT  NOT NULL,
  codigo_lancamento_integracao  TEXT,
  codigo_cliente_fornecedor     BIGINT,
  data_vencimento               TEXT,
  data_previsao                 TEXT,
  valor_documento               NUMERIC,
  codigo_categoria              TEXT,
  categorias_rateio             TEXT,
  id_conta_corrente             BIGINT,
  numero_documento              TEXT,
  numero_parcela                TEXT,
  numero_documento_fiscal       TEXT,
  numero_pedido                 TEXT,
  chave_nfe                     TEXT,
  data_emissao                  TEXT,
  id_origem                     TEXT,
  codigo_projeto                BIGINT,
  codigo_vendedor               BIGINT,
  status_titulo                 TEXT,
  observacao                    TEXT,
  valor_pis                     NUMERIC,
  retem_pis                     TEXT,
  valor_cofins                  NUMERIC,
  retem_cofins                  TEXT,
  valor_csll                    NUMERIC,
  retem_csll                    TEXT,
  valor_ir                      NUMERIC,
  retem_ir                      TEXT,
  valor_iss                     NUMERIC,
  retem_iss                     TEXT,
  valor_inss                    NUMERIC,
  retem_inss                    TEXT,
  boleto_gerado                 TEXT,
  boleto_dt_emissao             TEXT,
  boleto_numero                 TEXT,
  boleto_num_bancario           TEXT,
  info_d_inc                    TEXT,
  info_h_inc                    TEXT,
  info_u_inc                    TEXT,
  info_d_alt                    TEXT,
  info_h_alt                    TEXT,
  info_u_alt                    TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_lancamento_omie)
);

CREATE INDEX IF NOT EXISTS idx_cr_empresa       ON finance.contas_receber(empresa);
CREATE INDEX IF NOT EXISTS idx_cr_vencimento    ON finance.contas_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_cr_status        ON finance.contas_receber(status_titulo);
CREATE INDEX IF NOT EXISTS idx_cr_cliente       ON finance.contas_receber(codigo_cliente_fornecedor);
CREATE INDEX IF NOT EXISTS idx_cr_emissao       ON finance.contas_receber(data_emissao);

-- ---------------------------------------------------------------------------
-- 3. finance.pesquisa_titulos (endpoint: /financas/pesquisartitulos/ | PesquisarLancamentos)
-- Titulos consolidados (receber + pagar). 58 colunas.
-- PK: (empresa, cod_titulo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.pesquisa_titulos (
  empresa              TEXT    NOT NULL,
  cod_titulo           BIGINT  NOT NULL,      -- nCodTitulo
  cod_int_titulo       TEXT,                   -- cCodIntTitulo
  num_titulo           TEXT,                   -- cNumTitulo
  dt_emissao           TEXT,                   -- dDtEmissao
  dt_vencimento        TEXT,                   -- dDtVenc
  dt_previsao          TEXT,                   -- dDtPrevisao
  dt_pagamento         TEXT,                   -- dDtPagamento
  cod_cliente          BIGINT,                 -- nCodCliente
  cpf_cnpj_cliente     TEXT,                   -- cCPFCNPJCliente
  cod_contrato         BIGINT,                 -- nCodCtr
  num_contrato         TEXT,                   -- cNumCtr
  cod_os               BIGINT,                 -- nCodOS
  num_os               TEXT,                   -- cNumOS
  cod_cc               BIGINT,                 -- nCodCC
  status               TEXT,                   -- cStatus
  natureza             TEXT,                   -- cNatureza
  tipo                 TEXT,                   -- cTipo
  operacao             TEXT,                   -- cOperacao
  num_doc_fiscal       TEXT,                   -- cNumDocFiscal
  cod_categoria        TEXT,                   -- cCodCateg
  categorias_rateio    TEXT,                   -- aCodCateg joined
  num_parcela          TEXT,                   -- cNumParcela
  valor_titulo         NUMERIC,               -- nValorTitulo
  valor_pis            NUMERIC,
  ret_pis              TEXT,
  valor_cofins         NUMERIC,
  ret_cofins           TEXT,
  valor_csll           NUMERIC,
  ret_csll             TEXT,
  valor_ir             NUMERIC,
  ret_ir               TEXT,
  valor_iss            NUMERIC,
  ret_iss              TEXT,
  valor_inss           NUMERIC,
  ret_inss             TEXT,
  observacao           TEXT,
  cod_projeto          TEXT,                   -- cCodProjeto
  cod_vendedor         TEXT,                   -- cCodVendedor
  cod_comprador        BIGINT,                 -- nCodComprador
  codigo_barras        TEXT,                   -- cCodigoBarras
  nsu                  TEXT,                   -- cNSU
  cod_nf               BIGINT,                 -- nCodNF
  dt_registro          TEXT,                   -- dDtRegistro
  num_boleto           TEXT,                   -- cNumBoleto
  chave_nfe            TEXT,                   -- cChaveNFe
  origem               TEXT,                   -- cOrigem
  cod_tit_repet        BIGINT,                 -- nCodTitRepet
  dt_cancelamento      TEXT,                   -- dDtCanc
  liquidado            TEXT,                   -- resumo.cLiquidado
  val_pago             NUMERIC,               -- resumo.nValPago
  val_aberto           NUMERIC,               -- resumo.nValAberto
  desconto             NUMERIC,               -- resumo.nDesconto
  juros                NUMERIC,               -- resumo.nJuros
  multa                NUMERIC,               -- resumo.nMulta
  val_liquido          NUMERIC,               -- resumo.nValLiquido
  info_d_inc           TEXT,
  info_h_inc           TEXT,
  info_u_inc           TEXT,
  info_d_alt           TEXT,
  info_h_alt           TEXT,
  info_u_alt           TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_titulo)
);

CREATE INDEX IF NOT EXISTS idx_pt_empresa     ON finance.pesquisa_titulos(empresa);
CREATE INDEX IF NOT EXISTS idx_pt_status      ON finance.pesquisa_titulos(status);
CREATE INDEX IF NOT EXISTS idx_pt_natureza    ON finance.pesquisa_titulos(natureza);
CREATE INDEX IF NOT EXISTS idx_pt_vencimento  ON finance.pesquisa_titulos(dt_vencimento);
CREATE INDEX IF NOT EXISTS idx_pt_cliente     ON finance.pesquisa_titulos(cod_cliente);
CREATE INDEX IF NOT EXISTS idx_pt_emissao     ON finance.pesquisa_titulos(dt_emissao);

-- ---------------------------------------------------------------------------
-- 4. finance.extratos_cc (endpoint: /financas/extrato/ | ListarExtrato)
-- Extrato de conta corrente. 32 colunas.
-- PK: (empresa, cod_conta_corrente, cod_lancamento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.extratos_cc (
  empresa              TEXT    NOT NULL,
  cod_conta_corrente   BIGINT  NOT NULL,
  descricao_cc         TEXT,
  cod_banco            TEXT,
  cod_agencia          TEXT,
  num_conta            TEXT,
  cod_lancamento       BIGINT  NOT NULL,       -- nCodLancamento
  cod_lanc_relac       BIGINT,                 -- nCodLancRelac
  situacao             TEXT,                    -- cSituacao
  data_lancamento      TEXT,                    -- dDataLancamento
  des_cliente          TEXT,                    -- cDesCliente
  cod_cliente          BIGINT,                 -- nCodCliente
  raz_cliente          TEXT,                    -- cRazCliente
  doc_cliente          TEXT,                    -- cDocCliente
  tipo_documento       TEXT,                    -- cTipoDocumento
  numero               TEXT,                    -- cNumero
  valor_documento      NUMERIC,                -- nValorDocumento
  saldo                NUMERIC,                -- nSaldo
  cod_categoria        TEXT,                    -- cCodCategoria
  des_categoria        TEXT,                    -- cDesCategoria
  documento_fiscal     TEXT,                    -- cDocumentoFiscal
  parcela              TEXT,                    -- cParcela
  nosso_numero         TEXT,                    -- cNossoNumero
  origem               TEXT,                    -- cOrigem
  vendedor             TEXT,                    -- cVendedor
  projeto              TEXT,                    -- cProjeto
  observacoes          TEXT,                    -- cObservacoes
  data_inclusao        TEXT,                    -- cDataInclusao
  hora_inclusao        TEXT,                    -- cHoraInclusao
  natureza             TEXT,                    -- cNatureza
  bloqueado            TEXT,                    -- cBloqueado
  data_conciliacao     TEXT,                    -- dDataConciliacao

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_conta_corrente, cod_lancamento)
);

CREATE INDEX IF NOT EXISTS idx_ext_empresa   ON finance.extratos_cc(empresa);
CREATE INDEX IF NOT EXISTS idx_ext_data      ON finance.extratos_cc(data_lancamento);
CREATE INDEX IF NOT EXISTS idx_ext_cc        ON finance.extratos_cc(cod_conta_corrente);
CREATE INDEX IF NOT EXISTS idx_ext_cliente   ON finance.extratos_cc(cod_cliente);

-- ---------------------------------------------------------------------------
-- 5. finance.clientes (endpoint: /geral/clientes/ | ListarClientes)
-- Cadastro de clientes/fornecedores. 39 colunas.
-- PK: (empresa, codigo_cliente_omie)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.clientes (
  empresa                    TEXT    NOT NULL,
  codigo_cliente_omie        BIGINT  NOT NULL,
  codigo_cliente_integracao  TEXT,
  razao_social               TEXT,
  nome_fantasia              TEXT,
  cnpj_cpf                   TEXT,
  contato                    TEXT,
  endereco                   TEXT,
  endereco_numero            TEXT,
  complemento                TEXT,
  bairro                     TEXT,
  cidade                     TEXT,
  estado                     TEXT,
  cep                        TEXT,
  telefone1_ddd              TEXT,
  telefone1_numero           TEXT,
  telefone2_ddd              TEXT,
  telefone2_numero           TEXT,
  fax_ddd                    TEXT,
  fax_numero                 TEXT,
  email                      TEXT,
  homepage                   TEXT,
  inscricao_estadual         TEXT,
  inscricao_municipal        TEXT,
  inscricao_suframa          TEXT,
  pessoa_fisica              TEXT,
  optante_simples_nacional   TEXT,
  contribuinte               TEXT,
  produtor_rural             TEXT,
  inativo                    TEXT,
  importado_api              TEXT,
  cidade_ibge                TEXT,
  tags                       TEXT,
  info_d_inc                 TEXT,
  info_h_inc                 TEXT,
  info_u_inc                 TEXT,
  info_d_alt                 TEXT,
  info_h_alt                 TEXT,
  info_u_alt                 TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_cliente_omie)
);

CREATE INDEX IF NOT EXISTS idx_cli_empresa   ON finance.clientes(empresa);
CREATE INDEX IF NOT EXISTS idx_cli_cnpj      ON finance.clientes(cnpj_cpf);
CREATE INDEX IF NOT EXISTS idx_cli_razao     ON finance.clientes(razao_social);
CREATE INDEX IF NOT EXISTS idx_cli_inativo   ON finance.clientes(inativo);

-- ---------------------------------------------------------------------------
-- 6. finance.categorias (endpoint: /geral/categorias/ | ListarCategorias)
-- Categorias DRE. 23 colunas.
-- PK: (empresa, codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.categorias (
  empresa                TEXT    NOT NULL,
  codigo                 TEXT    NOT NULL,
  descricao              TEXT,
  descricao_padrao       TEXT,
  tipo_categoria         TEXT,
  conta_inativa          TEXT,
  definida_pelo_usuario  TEXT,
  id_conta_contabil      TEXT,
  tag_conta_contabil     TEXT,
  conta_despesa          TEXT,
  conta_receita          TEXT,
  nao_exibir             TEXT,
  natureza               TEXT,
  totalizadora           TEXT,
  transferencia          TEXT,
  codigo_dre             TEXT,
  categoria_superior     TEXT,
  dre_codigo_dre         TEXT,
  dre_descricao_dre      TEXT,
  dre_nao_exibir_dre     TEXT,
  dre_nivel_dre          TEXT,
  dre_sinal_dre          TEXT,
  dre_totaliza_dre       TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_cat_empresa   ON finance.categorias(empresa);
CREATE INDEX IF NOT EXISTS idx_cat_natureza  ON finance.categorias(natureza);

-- ---------------------------------------------------------------------------
-- 7. finance.projetos (endpoint: /geral/projetos/ | ListarProjetos)
-- Projetos. 10 colunas. Nota: Projetos_7.gs importa apenas SF (hardcoded).
-- PK: (empresa, codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.projetos (
  empresa     TEXT    NOT NULL,
  codigo      BIGINT  NOT NULL,
  cod_int     TEXT,
  nome        TEXT,
  inativo     TEXT,
  data_inc    TEXT,
  hora_inc    TEXT,
  user_inc    TEXT,
  data_alt    TEXT,
  hora_alt    TEXT,
  user_alt    TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_proj_empresa  ON finance.projetos(empresa);

-- ---------------------------------------------------------------------------
-- 8. finance.contas_correntes (endpoint: /geral/contacorrente/ | ListarContasCorrentes)
-- Contas correntes bancarias. 22 colunas.
-- PK: (empresa, cod_cc)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.contas_correntes (
  empresa                  TEXT    NOT NULL,
  cod_cc                   BIGINT  NOT NULL,   -- nCodCC
  cod_cc_int               TEXT,               -- cCodCCInt
  descricao                TEXT,
  tipo_conta_corrente      TEXT,
  codigo_banco             TEXT,
  codigo_agencia           TEXT,
  numero_conta_corrente    TEXT,
  saldo_inicial            NUMERIC,
  saldo_data               TEXT,
  valor_limite             NUMERIC,
  inativo                  TEXT,
  observacao               TEXT,
  nome_gerente             TEXT,
  telefone                 TEXT,
  email                    TEXT,
  data_inc                 TEXT,
  hora_inc                 TEXT,
  user_inc                 TEXT,
  data_alt                 TEXT,
  hora_alt                 TEXT,
  user_alt                 TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_cc)
);

CREATE INDEX IF NOT EXISTS idx_cc_empresa  ON finance.contas_correntes(empresa);

-- ---------------------------------------------------------------------------
-- 9. finance.empresas (endpoint: /geral/empresas/ | ListarEmpresas)
-- Cadastro de empresas. 30 colunas. Importa apenas SF (single-key).
-- PK: codigo_empresa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.empresas (
  codigo_empresa             BIGINT  NOT NULL,
  codigo_empresa_integracao  TEXT,
  cnpj                       TEXT,
  razao_social               TEXT,
  nome_fantasia              TEXT,
  endereco                   TEXT,
  endereco_numero            TEXT,
  complemento                TEXT,
  bairro                     TEXT,
  cidade                     TEXT,
  estado                     TEXT,
  cep                        TEXT,
  telefone1_ddd              TEXT,
  telefone1_numero           TEXT,
  telefone2_ddd              TEXT,
  telefone2_numero           TEXT,
  email                      TEXT,
  website                    TEXT,
  inscricao_estadual         TEXT,
  inscricao_municipal        TEXT,
  cnae                       TEXT,
  regime_tributario          TEXT,
  optante_simples_nacional   TEXT,
  inativa                    TEXT,
  gera_nfe                   TEXT,
  gera_nfse                  TEXT,
  inclusao_data              TEXT,
  inclusao_hora              TEXT,
  alteracao_data             TEXT,
  alteracao_hora             TEXT,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (codigo_empresa)
);

-- ---------------------------------------------------------------------------
-- 10. finance.parcelas (endpoint: /geral/parcelas/ | ListarParcelas)
-- Condicoes de parcelas. 3 colunas. Single-key (SF only).
-- PK: codigo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.parcelas (
  codigo      TEXT    NOT NULL,
  descricao   TEXT,
  n_parcelas  NUMERIC,

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (codigo)
);

-- ---------------------------------------------------------------------------
-- 11. finance.lancamentos_cc (endpoint: /financas/contacorrentelancamentos/ | ListarLancCC)
-- Lancamentos de conta corrente. 30 colunas.
-- PK: (empresa, cod_lancamento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.lancamentos_cc (
  empresa          TEXT    NOT NULL,
  cod_lancamento   BIGINT  NOT NULL,           -- nCodLanc
  cod_int_lanc     TEXT,                        -- cCodIntLanc
  cod_agrup        BIGINT,                      -- nCodAgrup
  cod_cc           BIGINT,                      -- cabecalho.nCodCC
  dt_lancamento    TEXT,                        -- cabecalho.dDtLanc
  valor_lancamento NUMERIC,                    -- cabecalho.nValorLanc
  categorias       TEXT,                        -- detalhes.aCodCateg joined
  tipo             TEXT,                        -- detalhes.cTipo
  num_documento    TEXT,                        -- detalhes.cNumDoc
  cod_cliente      BIGINT,                      -- detalhes.nCodCliente
  cod_projeto      BIGINT,                      -- detalhes.nCodProjeto
  observacao       TEXT,                        -- detalhes.cObs
  origem           TEXT,                        -- diversos.cOrigem
  dt_conciliacao   TEXT,                        -- diversos.dDtConc
  hr_conciliacao   TEXT,                        -- diversos.cHrConc
  user_conciliacao TEXT,                        -- diversos.cUsConc
  cod_vendedor     BIGINT,                      -- diversos.nCodVendedor
  cod_comprador    BIGINT,                      -- diversos.nCodComprador
  natureza         TEXT,                        -- diversos.cNatureza
  ident_lancamento TEXT,                        -- diversos.cIdentLanc
  cod_lanc_cp      BIGINT,                      -- diversos.nCodLancCP
  cod_lanc_cr      BIGINT,                      -- diversos.nCodLancCR
  info_d_inc       TEXT,
  info_h_inc       TEXT,
  info_u_inc       TEXT,
  info_d_alt       TEXT,
  info_h_alt       TEXT,
  info_u_alt       TEXT,
  info_imp_api     TEXT,                        -- info.cImpAPI

  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_lancamento)
);

CREATE INDEX IF NOT EXISTS idx_lcc_empresa    ON finance.lancamentos_cc(empresa);
CREATE INDEX IF NOT EXISTS idx_lcc_data       ON finance.lancamentos_cc(dt_lancamento);
CREATE INDEX IF NOT EXISTS idx_lcc_cc         ON finance.lancamentos_cc(cod_cc);

-- ---------------------------------------------------------------------------
-- 12-18. Auxiliares financeiros (7 tabelas pequenas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.bandeiras_cartao (
  codigo    TEXT NOT NULL PRIMARY KEY,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS finance.origens_lancamento (
  codigo    TEXT NOT NULL PRIMARY KEY,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS finance.finalidades_transferencia (
  banco     TEXT,
  codigo    TEXT NOT NULL PRIMARY KEY,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS finance.dre (
  codigo_dre   TEXT NOT NULL PRIMARY KEY,
  descricao_dre TEXT
);

CREATE TABLE IF NOT EXISTS finance.tipos_conta_corrente (
  codigo    TEXT NOT NULL PRIMARY KEY,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS finance.tipos_documento (
  codigo    TEXT NOT NULL PRIMARY KEY,
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS finance.bancos (
  codigo TEXT NOT NULL PRIMARY KEY,
  nome   TEXT,
  tipo   TEXT
);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS + GRANTS
-- ════════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON TABLES TO service_role;

GRANT USAGE  ON SCHEMA finance TO anon, authenticated, service_role;
GRANT ALL    ON ALL TABLES IN SCHEMA finance TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Expose finance schema via PostgREST
-- ════════════════════════════════════════════════════════════════════════════

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, storage, graphql_public, sales, orders, finance';
NOTIFY pgrst, 'reload config';
