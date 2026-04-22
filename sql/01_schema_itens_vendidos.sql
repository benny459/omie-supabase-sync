-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 01 — sales.itens_vendidos + sync_state
-- Cole este bloco inteiro no SQL Editor do Supabase e clique em "Run"
-- https://supabase.com/dashboard/project/zodflkfdnjhtwcjutbjl/sql/new
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS sales;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela principal: 1 linha por item vendido
-- PK composta: (empresa, codigo_pedido, codigo_item)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.itens_vendidos (
  empresa                 TEXT        NOT NULL,
  codigo_pedido           BIGINT      NOT NULL,
  codigo_item             BIGINT      NOT NULL,

  numero_pedido           TEXT,
  data_previsao           TEXT,
  codigo_cliente          BIGINT,
  etapa                   TEXT,
  codigo_parcela          TEXT,
  simples_nacional        TEXT,
  codigo_item_integracao  TEXT,

  codigo_produto          BIGINT,
  codigo_prod_omie        TEXT,
  descricao               TEXT,
  unidade                 TEXT,
  quantidade              NUMERIC,
  valor_unitario          NUMERIC,
  valor_total             NUMERIC,
  ncm                     TEXT,

  tipo_desconto           TEXT,
  valor_desconto          NUMERIC,
  percentual_desconto     NUMERIC,

  cofins_st               TEXT,
  pis_st                  TEXT,
  icms_origem             TEXT,
  icms_st                 TEXT,

  d_inc                   TEXT,
  h_inc                   TEXT,
  d_alt                   TEXT,
  h_alt                   TEXT,

  synced_at               TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_pedido, codigo_item)
);

CREATE INDEX IF NOT EXISTS idx_itens_vendidos_empresa
  ON sales.itens_vendidos(empresa);

CREATE INDEX IF NOT EXISTS idx_itens_vendidos_d_alt
  ON sales.itens_vendidos(d_alt DESC, h_alt DESC);

CREATE INDEX IF NOT EXISTS idx_itens_vendidos_codigo_cliente
  ON sales.itens_vendidos(codigo_cliente);

-- ─────────────────────────────────────────────────────────────────────────────
-- Estado de sincronização (controle incremental)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.sync_state (
  modulo                  TEXT        PRIMARY KEY,
  empresa                 TEXT,
  last_sync_at            TIMESTAMPTZ,
  last_d_alt_processed    TEXT,
  last_h_alt_processed    TEXT,
  total_registros         BIGINT,
  ultima_execucao_status  TEXT,
  ultima_execucao_msg     TEXT,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ativa mas não cria policies → só service_role acessa (ideal p/ Apps Script)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sales.itens_vendidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.sync_state     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants para as roles padrão do Supabase
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA sales TO service_role, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA sales TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sales TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sales
  GRANT ALL ON SEQUENCES TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔓 Expõe o schema 'sales' no PostgREST
-- Necessário para que Apps Script consiga acessar via REST API
-- ─────────────────────────────────────────────────────────────────────────────
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, sales, storage, graphql_public';
NOTIFY pgrst, 'reload config';

-- ─────────────────────────────────────────────────────────────────────────────
-- ✅ Verificação final: lista as tabelas criadas
-- ─────────────────────────────────────────────────────────────────────────────
SELECT table_schema, table_name, pg_size_pretty(pg_total_relation_size((table_schema||'.'||table_name)::regclass)) AS tamanho
FROM information_schema.tables
WHERE table_schema = 'sales'
ORDER BY table_name;
