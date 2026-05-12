-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 10 — RC Projetos (lista hierárquica de itens por equipamento)
-- v1.3.0 — 2026-05-12
--
-- Lista de RC pra projetos: usuário sobe XLSX com N abas (= equipamentos),
-- cada aba tem itens (item / qtd / modelo). Cada item pode ser vinculado a
-- um PC do Omie (campo pc_numero) — quando vinculado, o status do item
-- espelha approval.approvals.mt_status_fornecimento do PC vinculado.
--
-- Re-upload faz MERGE: items novos INSERT, items existentes (mesma natural
-- key: empresa, codigo_projeto, equipamento, item_norm) UPDATE preservando
-- pc_numero ja vinculado.
--
-- Coexiste com o RC tradicional (RcExcelDropZone — col B/C/D=desc/qtd/custo,
-- 1 sheet) usado em /avulsos. Este é específico de /projetos, sem valores,
-- hierárquico, status auto via PC vinculado.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval.rc_projetos_itens (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa         TEXT         NOT NULL,
  codigo_projeto  BIGINT       NOT NULL,
  equipamento     TEXT         NOT NULL,
  item            TEXT         NOT NULL,
  -- Natural key normalizada (lower+trim) pra dedup robusto no merge
  item_norm       TEXT         GENERATED ALWAYS AS (lower(btrim(item))) STORED,
  qtd             NUMERIC,
  modelo          TEXT,
  observacao      TEXT,
  -- Vinculo manual a um PC do Omie (referencia approval.approvals.pc_numero_manual
  -- OU orders.pedidos_compra.cnumero). Status do item vira espelho do PC.
  pc_numero       TEXT,
  criado_em       TIMESTAMPTZ  DEFAULT NOW(),
  criado_por      TEXT,
  atualizado_em   TIMESTAMPTZ  DEFAULT NOW(),
  atualizado_por  TEXT,
  UNIQUE (empresa, codigo_projeto, equipamento, item_norm)
);

CREATE INDEX IF NOT EXISTS idx_rc_projetos_itens_projeto
  ON approval.rc_projetos_itens(empresa, codigo_projeto);
CREATE INDEX IF NOT EXISTS idx_rc_projetos_itens_pc
  ON approval.rc_projetos_itens(empresa, pc_numero)
  WHERE pc_numero IS NOT NULL;

ALTER TABLE approval.rc_projetos_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rc_projetos_itens_read ON approval.rc_projetos_itens;
CREATE POLICY rc_projetos_itens_read ON approval.rc_projetos_itens
  FOR SELECT USING (true);

DROP POLICY IF EXISTS rc_projetos_itens_write ON approval.rc_projetos_itens;
CREATE POLICY rc_projetos_itens_write ON approval.rc_projetos_itens
  FOR ALL
  USING (platform.is_admin() OR platform.is_buyer()
      OR platform.can_write_module('projetos') OR platform.is_approver('projetos'))
  WITH CHECK (platform.is_admin() OR platform.is_buyer()
      OR platform.can_write_module('projetos') OR platform.is_approver('projetos'));

GRANT ALL ON approval.rc_projetos_itens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON approval.rc_projetos_itens TO authenticated;

CREATE OR REPLACE FUNCTION approval.fn_rc_projetos_itens_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rc_projetos_itens_touch ON approval.rc_projetos_itens;
CREATE TRIGGER trg_rc_projetos_itens_touch
BEFORE UPDATE ON approval.rc_projetos_itens
FOR EACH ROW EXECUTE FUNCTION approval.fn_rc_projetos_itens_touch();

-- ──────────────────────────────────────────────────────────────────────────
-- VIEW v_rc_projetos_itens — itens + status do PC vinculado (auto)
-- Status espelha approval.approvals.mt_status_fornecimento do PC vinculado.
-- Match pc_numero: pc_numero_manual em approvals OU cnumero em pedidos_compra.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW approval.v_rc_projetos_itens AS
SELECT
  i.id, i.empresa, i.codigo_projeto, i.equipamento, i.item, i.qtd, i.modelo,
  i.observacao, i.pc_numero,
  (SELECT MAX(a.mt_status_fornecimento)
     FROM approval.approvals a
     LEFT JOIN orders.pedidos_compra pc
       ON pc.empresa = a.empresa AND pc.ncod_ped = a.ncod_ped
    WHERE a.empresa = i.empresa
      AND i.pc_numero IS NOT NULL
      AND (a.pc_numero_manual = i.pc_numero OR pc.cnumero = i.pc_numero)
      AND a.mt_status_fornecimento IS NOT NULL
  ) AS status_fornec,
  (SELECT MAX(pc.cetapa)
     FROM orders.pedidos_compra pc
    WHERE pc.empresa = i.empresa AND pc.cnumero = i.pc_numero
  ) AS pc_etapa_code,
  i.criado_em, i.criado_por, i.atualizado_em, i.atualizado_por
FROM approval.rc_projetos_itens i;

GRANT SELECT ON approval.v_rc_projetos_itens TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
