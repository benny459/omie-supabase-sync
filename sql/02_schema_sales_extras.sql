-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 02 — sales.* (Etapas, Pedidos Venda, Produtos, Formas Pag, Categorias)
--
-- Execute este bloco inteiro no SQL Editor do Supabase:
-- https://supabase.com/dashboard/project/zodflkfdnjhtwcjutbjl/sql/new
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS sales;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. sales.etapas_pedidos (endpoint: /produtos/pedidoetapas/ListarEtapasPedido)
-- Estado atual de cada pedido: etapa, faturamento, NF, cancelamento, devolução
-- PK: (empresa, codigo_pedido)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.etapas_pedidos (
  empresa           TEXT    NOT NULL,
  codigo_pedido     BIGINT  NOT NULL,   -- nCodPed
  cod_int_pedido    TEXT,                -- cCodIntPed
  numero            TEXT,                -- cNumero
  etapa             TEXT,                -- cEtapa
  dt_etapa          TEXT,                -- dDtEtapa
  hr_etapa          TEXT,                -- cHrEtapa
  user_etapa        TEXT,                -- cUsEtapa

  faturado          TEXT,                -- fat.cFaturado
  dt_fat            TEXT,                -- fat.dDtFat
  hr_fat            TEXT,                -- fat.cHrFat
  autorizado        TEXT,                -- fat.cAutorizado
  denegado          TEXT,                -- fat.cDenegado
  chave_nfe         TEXT,                -- fat.cChaveNFE
  num_nfe           TEXT,                -- fat.cNumNFE
  serie_nfe         TEXT,                -- fat.cSerieNFE
  dt_saida          TEXT,                -- fat.dDtSaida
  hr_saida          TEXT,                -- fat.cHrSaida
  ambiente          TEXT,                -- fat.cAmbiente

  cancelado         TEXT,                -- canc.cCancelado
  dt_canc           TEXT,                -- canc.dDtCanc
  hr_canc           TEXT,                -- canc.cHrCanc
  user_canc         TEXT,                -- canc.cUsCanc

  devolvido         TEXT,                -- dev.cDevolvido
  dt_dev            TEXT,                -- dev.dDtDev
  hr_dev            TEXT,                -- dev.cHrDev
  user_dev          TEXT,                -- dev.cUsDev

  d_inc             TEXT,                -- info.dInc
  h_inc             TEXT,                -- info.hInc
  u_inc             TEXT,                -- info.uInc
  d_alt             TEXT,                -- info.dAlt
  h_alt             TEXT,                -- info.hAlt
  u_alt             TEXT,                -- info.uAlt

  imp_api           TEXT,                -- cImpAPI

  synced_at         TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_pedido)
);

CREATE INDEX IF NOT EXISTS idx_etapas_pedidos_empresa ON sales.etapas_pedidos(empresa);
CREATE INDEX IF NOT EXISTS idx_etapas_pedidos_d_alt ON sales.etapas_pedidos(d_alt DESC);
CREATE INDEX IF NOT EXISTS idx_etapas_pedidos_etapa ON sales.etapas_pedidos(etapa);
CREATE INDEX IF NOT EXISTS idx_etapas_pedidos_num_nfe ON sales.etapas_pedidos(num_nfe);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sales.pedidos_venda (cabeçalho — /produtos/pedido/ListarPedidos)
-- Diferente de itens_vendidos: 1 linha por PEDIDO (não por item)
-- PK: (empresa, codigo_pedido)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.pedidos_venda (
  empresa              TEXT    NOT NULL,
  codigo_pedido        BIGINT  NOT NULL,
  cod_pedido_integracao TEXT,
  numero_pedido        TEXT,
  codigo_cliente       BIGINT,
  data_previsao        TEXT,
  etapa                TEXT,
  codigo_parcela       TEXT,
  qtde_parcelas        NUMERIC,
  origem_pedido        TEXT,

  -- Totais
  valor_total          NUMERIC,
  quantidade_itens     NUMERIC,
  valor_mercadorias    NUMERIC,
  valor_desconto       NUMERIC,
  valor_frete          NUMERIC,
  valor_icms           NUMERIC,
  valor_pis            NUMERIC,
  valor_cofins         NUMERIC,
  base_icms_st         NUMERIC,
  valor_icms_st        NUMERIC,
  valor_ipi            NUMERIC,

  -- Frete
  cod_transportadora   TEXT,
  modalidade           TEXT,
  volumes              TEXT,
  peso_bruto           TEXT,
  peso_liquido         TEXT,

  -- Adicionais
  codigo_categoria     TEXT,
  codigo_conta         TEXT,
  num_pedido_cliente   TEXT,
  numero_contrato      TEXT,                  -- informacoes_adicionais.numero_contrato (Nº do Contrato de Venda Omie = nº proposta CRM)
  contato              TEXT,
  consumidor_final     TEXT,
  email                TEXT,
  codigo_vendedor      TEXT,
  codigo_projeto       TEXT,
  dados_adicionais_nf  TEXT,

  -- Auditoria
  d_inc                TEXT,
  h_inc                TEXT,
  u_inc                TEXT,
  d_alt                TEXT,
  h_alt                TEXT,
  u_alt                TEXT,

  synced_at            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_pedido)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_venda_empresa ON sales.pedidos_venda(empresa);
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_d_alt ON sales.pedidos_venda(d_alt DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_cliente ON sales.pedidos_venda(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_pedidos_venda_etapa ON sales.pedidos_venda(etapa);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sales.produtos (endpoint: /geral/produtos/ListarProdutosResumido)
-- Cadastro de produtos + serviços
-- PK: (empresa, id_omie)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.produtos (
  empresa            TEXT    NOT NULL,
  id_omie            BIGINT  NOT NULL,   -- p.codigo_produto (ID interno Omie)
  codigo_produto     TEXT,                -- p.codigo (código customer-facing)
  codigo_integracao  TEXT,                -- p.codigo_produto_integracao
  descricao          TEXT,
  valor_unitario     NUMERIC,
  ncm                TEXT,
  ean                TEXT,

  synced_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, id_omie)
);

CREATE INDEX IF NOT EXISTS idx_produtos_empresa ON sales.produtos(empresa);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON sales.produtos(codigo_produto);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. sales.formas_pagamento (endpoint: /produtos/formaspagvendas/ListarFormasPagVendas)
-- PK: (empresa, codigo)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.formas_pagamento (
  empresa       TEXT    NOT NULL,
  codigo        TEXT    NOT NULL,
  descricao     TEXT,
  num_parcelas  NUMERIC,

  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_formas_pagamento_empresa ON sales.formas_pagamento(empresa);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. sales.categorias (endpoint: /geral/categorias/ListarCategorias)
-- PK: (empresa, codigo)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.categorias (
  empresa          TEXT    NOT NULL,
  codigo           TEXT    NOT NULL,
  descricao        TEXT,
  conta_receita    TEXT,
  conta_despesa    TEXT,

  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo)
);

CREATE INDEX IF NOT EXISTS idx_categorias_empresa ON sales.categorias(empresa);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS + Grants para as novas tabelas
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sales.etapas_pedidos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.pedidos_venda     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.produtos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.formas_pagamento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.categorias        ENABLE ROW LEVEL SECURITY;

-- (service_role bypass RLS por padrão)

GRANT ALL ON sales.etapas_pedidos    TO service_role;
GRANT ALL ON sales.pedidos_venda     TO service_role;
GRANT ALL ON sales.produtos          TO service_role;
GRANT ALL ON sales.formas_pagamento  TO service_role;
GRANT ALL ON sales.categorias        TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ✅ Verificação: lista as novas tabelas
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  table_schema || '.' || table_name AS tabela,
  pg_size_pretty(pg_total_relation_size((table_schema||'.'||table_name)::regclass)) AS tamanho
FROM information_schema.tables
WHERE table_schema = 'sales'
ORDER BY table_name;
