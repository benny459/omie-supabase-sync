-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION 04 -- orders.* (NFe Entrada, Recebimento NFe, Pedidos Compra, Auxiliares)
--
-- Execute este bloco inteiro no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/zodflkfdnjhtwcjutbjl/sql/new
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS orders;

-- ---------------------------------------------------------------------------
-- 1. orders.nfe_entrada (endpoint: /contador/xml/ListarDocumentos)
-- NFe de entrada recebidas. 12 colunas.
-- PK: (empresa, id_nf)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.nfe_entrada (
  empresa          TEXT    NOT NULL,
  numero           TEXT,                -- nNumero
  serie            TEXT,                -- cSerie
  chave_acesso     TEXT,                -- nChave
  emissao          TEXT,                -- dEmissao
  hora             TEXT,                -- hEmissao
  valor            NUMERIC,             -- nValor
  status           TEXT,                -- cStatus
  id_nf            BIGINT  NOT NULL,    -- nIdNF
  id_pedido        BIGINT,              -- nIdPedido
  id_receb         BIGINT,              -- nIdReceb
  pedido_xml       TEXT,                -- extraido de cXml via regex <xPed>

  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, id_nf)
);

CREATE INDEX IF NOT EXISTS idx_nfe_entrada_empresa ON orders.nfe_entrada(empresa);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_emissao ON orders.nfe_entrada(emissao);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_chave ON orders.nfe_entrada(chave_acesso);
CREATE INDEX IF NOT EXISTS idx_nfe_entrada_id_pedido ON orders.nfe_entrada(id_pedido);

-- ---------------------------------------------------------------------------
-- 2. orders.recebimento_nfe (endpoint: /produtos/recebimentonfe/ListarRecebimentos)
-- Recebimentos de NFe com detalhes de cabecalho, info cadastro, totais e parcelas.
-- 50 colunas.
-- PK: (empresa, id_receb)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.recebimento_nfe (
  empresa              TEXT    NOT NULL,
  id_receb             BIGINT  NOT NULL,    -- cabec.nIdReceb
  chave_nfe            TEXT,                -- cabec.cChaveNfe
  id_fornecedor        BIGINT,              -- cabec.nIdFornecedor
  razao_social         TEXT,                -- cabec.cRazaoSocial
  nome_fantasia        TEXT,                -- cabec.cNome
  cnpj_cpf             TEXT,                -- cabec.cCNPJ_CPF
  num_nfe              TEXT,                -- cabec.cNumeroNFe
  serie                TEXT,                -- cabec.cSerieNFe
  modelo               TEXT,                -- cabec.cModeloNFe
  emissao              TEXT,                -- cabec.dEmissaoNFe
  valor_nfe            NUMERIC,             -- cabec.nValorNFe
  natureza_operacao    TEXT,                -- cabec.cNaturezaOperacao
  etapa                TEXT,                -- cabec.cEtapa
  faturado             TEXT,                -- infoCadastro.cFaturado
  dt_fat               TEXT,                -- infoCadastro.dFat
  recebido             TEXT,                -- infoCadastro.cRecebido
  dt_rec               TEXT,                -- infoCadastro.dRec
  autorizado           TEXT,                -- infoCadastro.cAutorizado
  cancelada            TEXT,                -- infoCadastro.cCancelada
  bloqueado            TEXT,                -- infoCadastro.cBloqueado
  denegado             TEXT,                -- infoCadastro.cDenegado
  operacao             TEXT,                -- infoCadastro.cOperacao
  dt_inc               TEXT,                -- infoCadastro.dInc
  hr_inc               TEXT,                -- infoCadastro.hInc
  user_inc             TEXT,                -- infoCadastro.cUsuarioInc
  dt_alt               TEXT,                -- infoCadastro.dAlt
  hr_alt               TEXT,                -- infoCadastro.hAlt
  user_alt             TEXT,                -- infoCadastro.cUsuarioAlt
  total_nfe            NUMERIC,             -- totais.vTotalNFe
  total_produtos       NUMERIC,             -- totais.vTotalProdutos
  vlr_frete            NUMERIC,             -- totais.vFrete
  vlr_desconto         NUMERIC,             -- totais.vDesconto
  vlr_seguro           NUMERIC,             -- totais.vSeguro
  outras_despesas      NUMERIC,             -- totais.vOutrasDespesas
  vlr_icms             NUMERIC,             -- totais.vICMS
  icms_st              NUMERIC,             -- totais.vICMSST
  vlr_ipi              NUMERIC,             -- totais.vIPI
  vlr_pis              NUMERIC,             -- totais.vPIS
  vlr_cofins           NUMERIC,             -- totais.vCOFINS
  cod_parcela          TEXT,                -- parcelas.cCodParcela
  qtd_parcela          NUMERIC,             -- parcelas.nQtdParcela
  categ_compra         TEXT,                -- infoAdicionais.cCategCompra
  id_conta             BIGINT,              -- infoAdicionais.nIdConta
  dt_registro          TEXT,                -- infoAdicionais.dRegistro
  id_projeto           BIGINT,              -- infoAdicionais.nIdProjeto
  id_pedido            BIGINT,              -- itensRecebimento[0].itensCabec.nIdPedido
  num_pedido           TEXT,                -- itensRecebimento[0].itensCabec.cNumPedido
  id_item_pedido       BIGINT,              -- itensRecebimento[0].itensCabec.nIdItPedido
  tem_vinculo          TEXT,                -- "SIM"/"NAO"

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, id_receb)
);

CREATE INDEX IF NOT EXISTS idx_recebimento_nfe_empresa ON orders.recebimento_nfe(empresa);
CREATE INDEX IF NOT EXISTS idx_recebimento_nfe_emissao ON orders.recebimento_nfe(emissao);
CREATE INDEX IF NOT EXISTS idx_recebimento_nfe_fornecedor ON orders.recebimento_nfe(id_fornecedor);
CREATE INDEX IF NOT EXISTS idx_recebimento_nfe_etapa ON orders.recebimento_nfe(etapa);
CREATE INDEX IF NOT EXISTS idx_recebimento_nfe_id_pedido ON orders.recebimento_nfe(id_pedido);

-- ---------------------------------------------------------------------------
-- 3. orders.pedidos_compra (endpoint: /produtos/pedidocompra/PesquisarPedCompra)
-- Pedidos de compra com itens (1 row por item, como ItensVendidos em Sales).
-- 53 colunas.
-- PK: (empresa, ncod_ped, ncod_item) -- pedido + item
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.pedidos_compra (
  empresa              TEXT    NOT NULL,
  ncod_ped             BIGINT  NOT NULL,    -- cabecalho_consulta.nCodPed
  cnumero              TEXT,                -- cabecalho_consulta.cNumero
  ccod_categ           TEXT,                -- cabecalho_consulta.cCodCateg
  cetapa               TEXT,                -- cabecalho_consulta.cEtapa
  dinc_data            TEXT,                -- cabecalho_consulta.dIncData
  cinc_hora            TEXT,                -- cabecalho_consulta.cIncHora
  ncod_for             BIGINT,              -- cabecalho_consulta.nCodFor
  ccod_int_for         TEXT,                -- cabecalho_consulta.cCodIntFor
  ccontato             TEXT,                -- cabecalho_consulta.cContato
  ccod_parc            TEXT,                -- cabecalho_consulta.cCodParc
  nqtde_parc           NUMERIC,             -- cabecalho_consulta.nQtdeParc
  ddt_previsao         TEXT,                -- cabecalho_consulta.dDtPrevisao
  ncod_cc              BIGINT,              -- cabecalho_consulta.nCodCC
  ncod_int_cc          TEXT,                -- cabecalho_consulta.nCodIntCC
  ncod_compr           BIGINT,              -- cabecalho_consulta.nCodCompr
  ncod_proj            BIGINT,              -- cabecalho_consulta.nCodProj
  ccod_int_ped         TEXT,                -- cabecalho_consulta.cCodIntPed
  cnum_pedido          TEXT,                -- cabecalho_consulta.cNumPedido
  ccontrato            TEXT,                -- cabecalho_consulta.cContrato
  cobs                 TEXT,                -- cabecalho_consulta.cObs
  cobs_int             TEXT,                -- cabecalho_consulta.cObsInt
  ntotal_pedido        NUMERIC,             -- cabecalho_consulta.nTotalPedido
  ccod_status          TEXT,                -- cabecalho_consulta.cCodStatus
  cdesc_status         TEXT,                -- cabecalho_consulta.cDescStatus
  crecebido            TEXT,                -- cabecalho_consulta.cRecebido
  ddata_recebimento    TEXT,                -- cabecalho_consulta.dDataRecebimento
  ddt_faturamento      TEXT,                -- cabecalho_consulta.dDtFaturamento
  cnumero_nf           TEXT,                -- cabecalho_consulta.cNumeroNF

  -- Item (produto) fields
  ncod_item            BIGINT  NOT NULL DEFAULT 0,  -- produtos_consulta.nCodItem
  ncod_prod            BIGINT,              -- produtos_consulta.nCodProd
  ccod_int_prod        TEXT,                -- produtos_consulta.cCodIntProd
  cproduto             TEXT,                -- produtos_consulta.cProduto
  cdescricao           TEXT,                -- produtos_consulta.cDescricao
  cunidade             TEXT,                -- produtos_consulta.cUnidade
  nqtde                NUMERIC,             -- produtos_consulta.nQtde
  nval_unit            NUMERIC,             -- produtos_consulta.nValUnit
  nval_tot             NUMERIC,             -- produtos_consulta.nValTot
  ndesconto            NUMERIC,             -- produtos_consulta.nDesconto
  nfrete               NUMERIC,             -- produtos_consulta.nFrete
  nseguro              NUMERIC,             -- produtos_consulta.nSeguro
  ndespesas            NUMERIC,             -- produtos_consulta.nDespesas
  loc_estoque          TEXT,                -- produtos_consulta.codigo_local_estoque
  cean                 TEXT,                -- produtos_consulta.cEAN
  cncm                 TEXT,                -- produtos_consulta.cNCM
  nqtde_rec            NUMERIC,             -- produtos_consulta.nQtdeRec
  npeso_bruto          NUMERIC,             -- produtos_consulta.nPesoBruto
  npeso_liq            NUMERIC,             -- produtos_consulta.nPesoLiq
  ccod_int_item        TEXT,                -- produtos_consulta.cCodIntItem
  nval_merc            NUMERIC,             -- produtos_consulta.nValMerc
  nvalor_cofins        NUMERIC,             -- produtos_consulta.nValorCofins
  nvalor_icms          NUMERIC,             -- produtos_consulta.nValorIcms
  nvalor_ipi           NUMERIC,             -- produtos_consulta.nValorIpi
  nvalor_pis           NUMERIC,             -- produtos_consulta.nValorPis
  nvalor_st            NUMERIC,             -- produtos_consulta.nValorSt

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, ncod_ped, ncod_item)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_empresa ON orders.pedidos_compra(empresa);
CREATE INDEX IF NOT EXISTS idx_pedidos_compra_etapa ON orders.pedidos_compra(cetapa);
CREATE INDEX IF NOT EXISTS idx_pedidos_compra_fornecedor ON orders.pedidos_compra(ncod_for);
CREATE INDEX IF NOT EXISTS idx_pedidos_compra_dinc ON orders.pedidos_compra(dinc_data);
CREATE INDEX IF NOT EXISTS idx_pedidos_compra_projeto ON orders.pedidos_compra(ncod_proj);

-- ---------------------------------------------------------------------------
-- 4. orders.produtos_compras (endpoint: /geral/produtos/ListarProdutos)
-- Cadastro completo de produtos (weekly). 12 colunas.
-- PK: (empresa, id_omie)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.produtos_compras (
  empresa              TEXT    NOT NULL,
  id_omie              BIGINT  NOT NULL,    -- p.codigo (ID interno Omie)
  codigo_integracao    TEXT,                -- p.codigo_produto_integracao
  sku                  TEXT,                -- p.codigo_produto
  descricao            TEXT,                -- p.descricao
  valor_unitario       NUMERIC,             -- p.valor_unitario
  unidade              TEXT,                -- p.unidade
  ncm                  TEXT,                -- p.ncm
  ean                  TEXT,                -- p.ean
  marca                TEXT,                -- p.marca
  peso_liq             NUMERIC,             -- p.peso_liq
  codigo_familia       TEXT,                -- p.codigo_familia

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, id_omie)
);

CREATE INDEX IF NOT EXISTS idx_produtos_compras_empresa ON orders.produtos_compras(empresa);
CREATE INDEX IF NOT EXISTS idx_produtos_compras_sku ON orders.produtos_compras(sku);

-- ---------------------------------------------------------------------------
-- 5. orders.etapas_faturamento (endpoint: /produtos/etapafat/ListarEtapasFaturamento)
-- Etapas do faturamento com array aninhado.
-- PK: (empresa, cod_operacao, cod_etapa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.etapas_faturamento (
  empresa              TEXT    NOT NULL,
  cod_operacao         TEXT    NOT NULL,     -- cCodOperacao
  desc_operacao        TEXT,                -- cDescOperacao
  cod_etapa            TEXT    NOT NULL,     -- etapas[].cCodigo
  desc_padrao          TEXT,                -- etapas[].cDescrPadrao
  desc_etapa           TEXT,                -- etapas[].cDescricao
  inativo              TEXT,                -- etapas[].cInativo

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_operacao, cod_etapa)
);

CREATE INDEX IF NOT EXISTS idx_etapas_fat_empresa ON orders.etapas_faturamento(empresa);

-- ---------------------------------------------------------------------------
-- 6. orders.formas_pagamento_vendas (endpoint: /produtos/formaspagvendas/ListarFormasPagVendas)
-- PK: (empresa, codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.formas_pagamento_vendas (
  empresa              TEXT    NOT NULL,
  codigo               TEXT    NOT NULL,     -- cCodigo
  descricao            TEXT,                -- cDescricao
  num_parcelas         NUMERIC,             -- nNumeroParcelas

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_formas_pag_vendas_empresa ON orders.formas_pagamento_vendas(empresa);

-- ---------------------------------------------------------------------------
-- 7. orders.familias_produtos (endpoint: /geral/familias/PesquisarFamilias)
-- PK: (empresa, codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.familias_produtos (
  empresa              TEXT    NOT NULL,
  codigo               BIGINT  NOT NULL,     -- famCadastro.codigo
  nome_familia         TEXT,                -- famCadastro.nomeFamilia
  cod_int              TEXT,                -- famCadastro.codInt

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_familias_empresa ON orders.familias_produtos(empresa);

-- ---------------------------------------------------------------------------
-- 8. orders.produto_fornecedor (endpoint: /estoque/produtofornecedor/ListarProdutoFornecedor)
-- Relacao fornecedor x produtos. 10 colunas.
-- PK: (empresa, cod_forn, cod_prod)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.produto_fornecedor (
  empresa              TEXT    NOT NULL,
  cod_forn             BIGINT  NOT NULL,     -- nCodForn
  cnpj                 TEXT,                -- cCpfCnpj
  fantasia             TEXT,                -- cNomeFantasia
  razao                TEXT,                -- cRazaoSocial
  cod_int_prod         TEXT,                -- produtos[].nCodIntProd
  cod_prod             TEXT    NOT NULL DEFAULT '',  -- produtos[].cCodigo
  descricao            TEXT,                -- produtos[].cDescricao
  preco                NUMERIC,             -- produtos[].nPreco
  unidade              TEXT,                -- produtos[].cUnidade

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, cod_forn, cod_prod)
);

CREATE INDEX IF NOT EXISTS idx_prod_forn_empresa ON orders.produto_fornecedor(empresa);
CREATE INDEX IF NOT EXISTS idx_prod_forn_forn ON orders.produto_fornecedor(cod_forn);

-- ---------------------------------------------------------------------------
-- 9. orders.unidades (endpoint: /geral/unidade/ListarUnidades)
-- PK: (empresa, sigla)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.unidades (
  empresa              TEXT    NOT NULL,
  sigla                TEXT    NOT NULL,     -- cCodigo
  descricao            TEXT,                -- cDescricao

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, sigla)
);

CREATE INDEX IF NOT EXISTS idx_unidades_empresa ON orders.unidades(empresa);

-- ---------------------------------------------------------------------------
-- 10. orders.formas_pagamento_compras (endpoint: /produtos/formaspagcompras/ListarFormasPagCompras)
-- PK: (empresa, codigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.formas_pagamento_compras (
  empresa              TEXT    NOT NULL,
  codigo               TEXT    NOT NULL,     -- cCodigo
  descricao            TEXT,                -- cDescricao
  num_parcelas         NUMERIC,             -- nNumeroParcelas
  cod_forma_pag        BIGINT,              -- nCodFormaPag

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_formas_pag_compras_empresa ON orders.formas_pagamento_compras(empresa);

-- ---------------------------------------------------------------------------
-- RLS + Grants para todas as tabelas do schema orders
-- ---------------------------------------------------------------------------
ALTER TABLE orders.nfe_entrada               ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.recebimento_nfe           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.pedidos_compra            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.produtos_compras          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.etapas_faturamento        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.formas_pagamento_vendas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.familias_produtos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.produto_fornecedor        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.unidades                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders.formas_pagamento_compras  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON orders.nfe_entrada               TO service_role;
GRANT ALL ON orders.recebimento_nfe           TO service_role;
GRANT ALL ON orders.pedidos_compra            TO service_role;
GRANT ALL ON orders.produtos_compras          TO service_role;
GRANT ALL ON orders.etapas_faturamento        TO service_role;
GRANT ALL ON orders.formas_pagamento_vendas   TO service_role;
GRANT ALL ON orders.familias_produtos         TO service_role;
GRANT ALL ON orders.produto_fornecedor        TO service_role;
GRANT ALL ON orders.unidades                  TO service_role;
GRANT ALL ON orders.formas_pagamento_compras  TO service_role;

-- ---------------------------------------------------------------------------
-- Expose orders schema via PostgREST (add to existing list)
-- ---------------------------------------------------------------------------
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, sales, orders';
NOTIFY pgrst, 'reload config';

-- ---------------------------------------------------------------------------
-- Verification: list all tables in orders schema
-- ---------------------------------------------------------------------------
SELECT
  table_schema || '.' || table_name AS tabela,
  pg_size_pretty(pg_total_relation_size((table_schema||'.'||table_name)::regclass)) AS tamanho
FROM information_schema.tables
WHERE table_schema = 'orders'
ORDER BY table_name;
