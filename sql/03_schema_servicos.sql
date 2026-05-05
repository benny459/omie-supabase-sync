-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 03 — sales.* (Ordens de Serviço + Contratos de Serviço)
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- sales.ordens_servico (endpoint: /servicos/os/ListarOS)
-- Cada OS pode ter múltiplos serviços prestados → 1 linha por serviço
-- PK: (empresa, codigo_os, seq_item)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.ordens_servico (
  empresa            TEXT    NOT NULL,
  codigo_os          TEXT    NOT NULL,     -- nCodOS
  seq_item           INTEGER NOT NULL,     -- nSeqItem (se não tem serviço, 0)

  numero_os          TEXT,                  -- cNumOS
  codigo_cliente     TEXT,                  -- nCodCli
  dt_previsao        TEXT,                  -- dDtPrevisao
  valor_total        NUMERIC,               -- nValorTotal
  etapa              TEXT,                  -- cEtapa
  codigo_categoria   TEXT,                  -- cCodCateg
  codigo_projeto     TEXT,                  -- nCodProj
  codigo_cc          TEXT,                  -- nCodCC
  codigo_parcela     TEXT,                  -- cCodParc
  qtd_parcelas       TEXT,                  -- nQtdeParc
  faturada           TEXT,                  -- cFaturada
  cancelada          TEXT,                  -- cCancelada
  d_inc              TEXT,                  -- dDtInc
  dt_fat             TEXT,                  -- dDtFat

  codigo_servico     TEXT,                  -- nCodServico
  descricao_servico  TEXT,                  -- cDescServ
  quantidade         NUMERIC,               -- nQtde
  valor_unitario     NUMERIC,               -- nValUnit
  trib_servico       TEXT,                  -- cTribServ
  retem_iss          TEXT,                  -- cRetemISS
  aliq_iss           NUMERIC,               -- imp.nAliqISS
  valor_iss          NUMERIC,               -- imp.nValorISS
  retem_inss         TEXT,                  -- imp.cRetemINSS
  valor_inss         NUMERIC,               -- imp.nValorINSS

  codigo_vendedor    TEXT,                  -- nCodVend
  num_recibo         TEXT,                  -- cNumRecibo
  numero_contrato    TEXT,                  -- InformacoesAdicionais.cNumContrato (Nº do Contrato de Venda Omie = nº proposta CRM)

  synced_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_os, seq_item)
);

CREATE INDEX IF NOT EXISTS idx_ordens_servico_empresa ON sales.ordens_servico(empresa);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_cliente ON sales.ordens_servico(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_d_inc ON sales.ordens_servico(d_inc DESC);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_etapa ON sales.ordens_servico(etapa);

-- ─────────────────────────────────────────────────────────────────────────────
-- sales.contratos_servico (endpoint: /servicos/contrato/ListarContratos)
-- PK: (empresa, codigo_contrato, seq)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales.contratos_servico (
  empresa            TEXT    NOT NULL,
  codigo_contrato    TEXT    NOT NULL,     -- nCodCtr
  seq                INTEGER NOT NULL,     -- itemCabecalho.seq

  numero_contrato    TEXT,                  -- cNumCtr
  codigo_cliente     TEXT,                  -- nCodCli
  situacao           TEXT,                  -- cCodSit
  vig_inicial        TEXT,                  -- dVigInicial
  vig_final          TEXT,                  -- dVigFinal
  tipo_faturamento   TEXT,                  -- cTipoFat
  dia_faturamento    TEXT,                  -- nDiaFat
  vlr_tot_mes        NUMERIC,               -- nValTotMes
  codigo_categoria   TEXT,                  -- cCodCateg
  codigo_cc          TEXT,                  -- nCodCC
  codigo_projeto     TEXT,                  -- nCodProj

  codigo_servico     TEXT,                  -- itemCabecalho.codServico
  quantidade         NUMERIC,               -- itemCabecalho.quant
  valor_unitario     NUMERIC,               -- itemCabecalho.valorUnit
  valor_total        NUMERIC,               -- itemCabecalho.valorTotal
  cod_lc116          TEXT,                  -- codLC116
  cod_serv_munic     TEXT,                  -- codServMunic
  descricao_completa TEXT,                  -- itemDescrServ.descrCompleta
  aliq_iss           NUMERIC,               -- itemImpostos.aliqISS
  valor_iss          NUMERIC,               -- itemImpostos.valorISS
  retem_iss          TEXT,                  -- itemImpostos.retISS

  synced_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa, codigo_contrato, seq)
);

CREATE INDEX IF NOT EXISTS idx_contratos_servico_empresa ON sales.contratos_servico(empresa);
CREATE INDEX IF NOT EXISTS idx_contratos_servico_cliente ON sales.contratos_servico(codigo_cliente);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS + Grants
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE sales.ordens_servico    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.contratos_servico ENABLE ROW LEVEL SECURITY;

GRANT ALL ON sales.ordens_servico    TO service_role;
GRANT ALL ON sales.contratos_servico TO service_role;
