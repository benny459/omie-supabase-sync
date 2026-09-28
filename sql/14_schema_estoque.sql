-- 14: schema estoque — posição e movimentação de estoque do Omie
-- (endpoint estoque/consulta: ListarPosEstoque + ListarMovimentoEstoque).
-- Datas já convertidas pra DATE no importer (scripts/import_estoque.py).
--
-- ⚠️ ESTADO FINAL: o PostgREST do projeto só expõe public/sales/orders/finance/
-- approval/platform/bi (config de Dashboard, não de migração). A migração
-- "estoque_para_schema_orders" moveu as tabelas para orders.estoque_posicao e
-- orders.estoque_movimentos — este arquivo fica como referência do DDL.

CREATE SCHEMA IF NOT EXISTS estoque;

CREATE TABLE IF NOT EXISTS estoque.posicao (
  empresa              text        NOT NULL,
  n_cod_prod           bigint      NOT NULL,
  codigo_local_estoque bigint      NOT NULL DEFAULT 0,
  codigo               text,
  descricao            text,
  saldo                numeric,
  fisico               numeric,
  reservado            numeric,
  pendente             numeric,
  cmc                  numeric,
  preco_unitario       numeric,
  estoque_minimo       numeric,
  data_posicao         date,
  synced_at            timestamptz DEFAULT now(),
  PRIMARY KEY (empresa, n_cod_prod, codigo_local_estoque)
);

CREATE TABLE IF NOT EXISTS estoque.movimentos (
  empresa              text        NOT NULL,
  id_mov               bigint      NOT NULL,
  id_prod              bigint,
  dt_mov               date,
  dt_emissao           date,
  cod_origem           text,
  des_origem           text,
  operacao             text,
  tipo                 text,          -- entrada / saida
  num_doc              text,
  num_pedido           text,
  qtde                 numeric,
  valor                numeric,
  saldo                numeric,       -- saldo do produto após o movimento
  cmc                  numeric,
  descricao            text,          -- descrição do produto
  codigo_local_estoque bigint,
  cancelamento         text,
  devolucao            text,
  id_doc               bigint,
  id_pedido            bigint,
  id_recebimento       bigint,
  synced_at            timestamptz DEFAULT now(),
  PRIMARY KEY (empresa, id_mov)
);

CREATE INDEX IF NOT EXISTS movimentos_prod_dt_idx
  ON estoque.movimentos (empresa, id_prod, dt_mov DESC);
CREATE INDEX IF NOT EXISTS movimentos_dt_idx
  ON estoque.movimentos (empresa, dt_mov DESC);

GRANT USAGE ON SCHEMA estoque TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA estoque TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA estoque
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
