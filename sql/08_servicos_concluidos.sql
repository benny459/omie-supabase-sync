-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 08 — Campos de conclusão de serviços (escritos pelo waterworks-app)
-- v1.2.0 — 2026-05-05
--
-- Adiciona 4 colunas em approval.approvals + index parcial.
-- Os campos são populados via UPDATE direto pelo app de serviços
-- (waterworks-app em app.waterworks.com.br) usando service_role.
-- O painel apenas EXIBE — não escreve nesses campos via UI.
--
-- Convenção pro waterworks-app:
--   UPDATE approval.approvals
--      SET servicos_concluidos     = TRUE,
--          servicos_os_numero      = 'OS-1058',
--          servicos_concluidos_em  = now(),
--          servicos_concluidos_por = '<email do operador>',
--          updated_by              = 'waterworks-app:<email do operador>'
--    WHERE empresa = $1 AND ncod_ped = $2;
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE approval.approvals
  ADD COLUMN IF NOT EXISTS servicos_concluidos     BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS servicos_os_numero      TEXT,
  ADD COLUMN IF NOT EXISTS servicos_concluidos_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS servicos_concluidos_por TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_servicos_concluidos
  ON approval.approvals(servicos_concluidos)
  WHERE servicos_concluidos = TRUE;
