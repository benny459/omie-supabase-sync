-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 11 — Budget por projeto (RC Projetos)
-- v1.4.0 — 2026-05-14
-- 1 row por (empresa, codigo_projeto) com o valor maximo (budget) que pode
-- ser gasto naquele projeto. Mostrado no header do bloco "Itens RC" do
-- /projetos junto com Comprometido (sum dos PCs vinculados aos itens) e
-- Restante (budget - comprometido).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS approval.rc_projetos_budget (
  empresa         TEXT         NOT NULL,
  codigo_projeto  BIGINT       NOT NULL,
  valor_budget    NUMERIC      NOT NULL,
  observacao      TEXT,
  criado_em       TIMESTAMPTZ  DEFAULT NOW(),
  criado_por      TEXT,
  atualizado_em   TIMESTAMPTZ  DEFAULT NOW(),
  atualizado_por  TEXT,
  PRIMARY KEY (empresa, codigo_projeto)
);

ALTER TABLE approval.rc_projetos_budget ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rc_projetos_budget_read ON approval.rc_projetos_budget;
CREATE POLICY rc_projetos_budget_read ON approval.rc_projetos_budget FOR SELECT USING (true);

DROP POLICY IF EXISTS rc_projetos_budget_write ON approval.rc_projetos_budget;
CREATE POLICY rc_projetos_budget_write ON approval.rc_projetos_budget
  FOR ALL
  USING (platform.is_admin() OR platform.is_buyer()
      OR platform.can_write_module('projetos') OR platform.is_approver('projetos'))
  WITH CHECK (platform.is_admin() OR platform.is_buyer()
      OR platform.can_write_module('projetos') OR platform.is_approver('projetos'));

GRANT ALL ON approval.rc_projetos_budget TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON approval.rc_projetos_budget TO authenticated;

CREATE OR REPLACE FUNCTION approval.fn_rc_projetos_budget_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_rc_projetos_budget_touch ON approval.rc_projetos_budget;
CREATE TRIGGER trg_rc_projetos_budget_touch
BEFORE UPDATE ON approval.rc_projetos_budget
FOR EACH ROW EXECUTE FUNCTION approval.fn_rc_projetos_budget_touch();

-- VIEW v_rc_projetos_resumo: 1 row por projeto com budget + comprometido + restante.
-- Inclui projetos sem budget (UNION ALL).
CREATE OR REPLACE VIEW approval.v_rc_projetos_resumo AS
WITH itens_por_projeto AS (
  SELECT empresa, codigo_projeto,
         COUNT(*) AS qtd_itens,
         COUNT(*) FILTER (WHERE pc_numero IS NOT NULL) AS qtd_itens_com_pc,
         ARRAY_AGG(DISTINCT pc_numero) FILTER (WHERE pc_numero IS NOT NULL) AS pcs_vinculados
    FROM approval.rc_projetos_itens
   GROUP BY empresa, codigo_projeto
),
pcs_resolvidos AS (
  SELECT i.empresa, i.codigo_projeto,
         COALESCE(SUM(DISTINCT pc_val), 0) AS valor_comprometido
    FROM itens_por_projeto i
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (pc_num) pc_num,
             (SELECT MAX(a.valor_aprovado)
                FROM approval.approvals a
                LEFT JOIN orders.pedidos_compra pc
                  ON pc.empresa = a.empresa AND pc.ncod_ped = a.ncod_ped
               WHERE a.empresa = i.empresa
                 AND (a.pc_numero_manual = pc_num OR pc.cnumero = pc_num)) AS pc_val
        FROM unnest(COALESCE(i.pcs_vinculados, ARRAY[]::text[])) AS pc_num
    ) p ON TRUE
   GROUP BY i.empresa, i.codigo_projeto
)
SELECT b.empresa, b.codigo_projeto, b.valor_budget,
       COALESCE(p.valor_comprometido, 0) AS valor_comprometido,
       (b.valor_budget - COALESCE(p.valor_comprometido, 0)) AS valor_restante,
       COALESCE(i.qtd_itens, 0) AS qtd_itens,
       COALESCE(i.qtd_itens_com_pc, 0) AS qtd_itens_com_pc,
       b.observacao, b.atualizado_em, b.atualizado_por
  FROM approval.rc_projetos_budget b
  LEFT JOIN itens_por_projeto i ON i.empresa = b.empresa AND i.codigo_projeto = b.codigo_projeto
  LEFT JOIN pcs_resolvidos   p ON p.empresa = b.empresa AND p.codigo_projeto = b.codigo_projeto
UNION ALL
SELECT i.empresa, i.codigo_projeto, NULL::numeric AS valor_budget,
       COALESCE(p.valor_comprometido, 0) AS valor_comprometido,
       NULL::numeric AS valor_restante,
       i.qtd_itens, i.qtd_itens_com_pc,
       NULL::text AS observacao, NULL::timestamptz AS atualizado_em, NULL::text AS atualizado_por
  FROM itens_por_projeto i
  LEFT JOIN pcs_resolvidos p ON p.empresa = i.empresa AND p.codigo_projeto = i.codigo_projeto
 WHERE NOT EXISTS (
   SELECT 1 FROM approval.rc_projetos_budget b
    WHERE b.empresa = i.empresa AND b.codigo_projeto = i.codigo_projeto
 );

GRANT SELECT ON approval.v_rc_projetos_resumo TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
