-- ════════════════════════════════════════════════════════════════════════════
-- 📦 MIGRATION 09 — Trigger normalize modulo (RLS-safe)
-- v1.2.8 — 2026-05-06
--
-- Auto-corrige approval.approvals.modulo no INSERT/UPDATE com base no
-- projeto_nome da venda vinculada (mesma lógica do modulo_calc das views).
--
-- Motivo: a policy RLS approvals_write valida pelo `modulo` físico, mas as
-- views v_pc_projetos / v_pc_avulsos classificam pelo modulo_calc (derivado
-- de projeto_nome). Sem este trigger, rows criadas com modulo='avulsos'
-- (default do "+ Nova linha" e de alguns inserts do waterworks-app) que
-- pertencem a um projeto PJxxx aparecem em /projetos mas bloqueiam
-- aprovadores de projetos no momento do UPDATE de status (erro
-- "new row violates row-level security policy").
--
-- Bug original detectado em 2026-05-06: Marcelo (aprovador de projetos)
-- não conseguia aprovar 13 rows em /projetos. Migration faz fix retroativo
-- + adiciona o trigger pra evitar regressão.
--
-- Regra: se a venda vinculada (PV ou OS) tem projeto cujo nome começa com
-- "PJ" → modulo='projetos'. Se começa com "40_VS"/"41_VP" → modulo='avulsos'.
-- Outras rows (sem pv_os_label, ou projeto não encontrado) ficam intocadas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION approval.fn_normalize_modulo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_projeto_nome TEXT;
  v_label_num    TEXT;
BEGIN
  IF NEW.pv_os_label IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.pv_os_label LIKE 'PV%' THEN
    v_label_num := regexp_replace(NEW.pv_os_label, '^PV', '');
    SELECT MAX(p.nome) INTO v_projeto_nome
      FROM sales.pedidos_venda pv
      LEFT JOIN finance.projetos p
        ON p.empresa = pv.empresa AND p.codigo::text = pv.codigo_projeto
     WHERE pv.empresa = NEW.empresa
       AND pv.numero_pedido = v_label_num;
  ELSIF NEW.pv_os_label LIKE 'OS%' THEN
    v_label_num := regexp_replace(NEW.pv_os_label, '^OS', '');
    SELECT MAX(p.nome) INTO v_projeto_nome
      FROM sales.ordens_servico os
      LEFT JOIN finance.projetos p
        ON p.empresa = os.empresa AND p.codigo::text = os.codigo_projeto
     WHERE os.empresa = NEW.empresa
       AND os.numero_os = v_label_num;
  END IF;

  IF v_projeto_nome IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_projeto_nome ~ '^PJ' THEN
    NEW.modulo := 'projetos';
  ELSIF v_projeto_nome ~ '^(40_VS|41_VP)' THEN
    NEW.modulo := 'avulsos';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_modulo ON approval.approvals;
CREATE TRIGGER trg_normalize_modulo
BEFORE INSERT OR UPDATE OF pv_os_label, modulo ON approval.approvals
FOR EACH ROW
EXECUTE FUNCTION approval.fn_normalize_modulo();

-- Fix retroativo (2026-05-06):
-- UPDATE approval.approvals a
--    SET modulo = 'projetos'
--   FROM approval.v_pc_projetos v
--  WHERE v.empresa = a.empresa
--    AND v.ncod_ped = a.ncod_ped
--    AND a.modulo = 'avulsos';
-- Resultado: 13 rows corrigidas.
