-- 31 — RC pipeline passa a ler a etapa 20 (Requisição) do Omie (01/10/2026).
--
-- Aplicado em produção em 01/10/2026 (~13:30 UTC) como a migração
-- "rc_captura_inclui_etapa_requisicao", com autorização do Benny. Este arquivo
-- é só o REGISTRO: regenerado de pg_get_functiondef depois de aplicado — não
-- reaplicar. Mudança: cetapa IN ('10','15') → ('10','15','20') nas duas
-- funções, porque desde junho a equipa lança as RCs na etapa Requisição.
--
-- Convive com compras.publicar_rcs_operacao (sql/30): cada uma pula o item que
-- a outra já pôs no balde do PV/OS (rc_numero igual / chave rc_auto).

CREATE OR REPLACE FUNCTION approval.capturar_rcs_omie()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_preenchidas int := 0;
  v_criadas int := 0;
  v_min bigint;
BEGIN
  SELECT LEAST(COALESCE(MIN(ncod_ped),0), -1) - 1 INTO v_min FROM approval.approvals;

  CREATE TEMP TABLE _rc_itens ON COMMIT DROP AS
  WITH refs AS (
    SELECT DISTINCT pc.empresa,
           NULLIF(regexp_replace(pc.cnumero,'\D','','g'),'')::numeric AS rc_num,
           pc.ncod_item, pc.cdescricao, pc.nval_unit, pc.nqtde, pc.nval_tot,
           upper(m[1] || m[2]) AS label
    FROM orders.pedidos_compra pc,
         LATERAL regexp_matches(coalesce(pc.cobs_int,'') || ' ' || coalesce(pc.cobs,''),
                                '(PV|OS)\s*-?\s*(\d{3,5})', 'gi') m
    WHERE pc.cetapa IN ('10','15','20')
    UNION
    SELECT DISTINCT pc.empresa,
           NULLIF(regexp_replace(pc.cnumero,'\D','','g'),'')::numeric,
           pc.ncod_item, pc.cdescricao, pc.nval_unit, pc.nqtde, pc.nval_tot,
           upper(v.label)
    FROM orders.pedidos_compra pc
    JOIN approval.rc_vinculos v ON v.empresa = pc.empresa AND v.cnumero = pc.cnumero
    WHERE pc.cetapa IN ('10','15','20') AND v.metodo IN ('triangulacao','manual')
  )
  SELECT r.*,
         (r.rc_num::text || ':' || r.ncod_item::text) AS auto_key,
         EXISTS (
           SELECT 1 FROM sales.pedidos_venda pv
           JOIN sales.etapas_pedidos ep ON ep.empresa = pv.empresa AND ep.codigo_pedido = pv.codigo_pedido
           WHERE pv.empresa = r.empresa AND 'PV'||pv.numero_pedido = r.label AND coalesce(ep.faturado,'') = 'S'
         ) OR EXISTS (
           SELECT 1 FROM sales.ordens_servico os
           WHERE os.empresa = r.empresa AND 'OS'||os.numero_os = r.label AND coalesce(os.dt_fat,'') <> ''
         ) AS fechado
  FROM refs r
  WHERE r.rc_num IS NOT NULL
    AND (EXISTS (SELECT 1 FROM sales.pedidos_venda pv WHERE pv.empresa=r.empresa AND 'PV'||pv.numero_pedido = r.label)
      OR EXISTS (SELECT 1 FROM sales.ordens_servico os WHERE os.empresa=r.empresa AND 'OS'||os.numero_os = r.label))
    AND NOT EXISTS (
      SELECT 1 FROM approval.approvals a
      WHERE a.empresa = r.empresa AND upper(a.pv_os_label) = r.label
        AND (a.custom_fields->>'rc_auto' = r.rc_num::text || ':' || r.ncod_item::text
             OR a.rc_numero = r.rc_num)
    );

  WITH slots AS (
    SELECT a.empresa, a.ncod_ped, upper(a.pv_os_label) AS label,
           row_number() OVER (PARTITION BY a.empresa, upper(a.pv_os_label) ORDER BY a.ncod_ped DESC) AS pos
    FROM approval.approvals a
    WHERE a.ncod_ped < 0 AND a.rc_numero IS NULL AND a.rc_descricao IS NULL
      AND a.pv_os_label IS NOT NULL AND coalesce(a.modulo,'') <> 'pcs'
      AND a.pc_numero_manual IS NULL
  ), itens AS (
    SELECT i.*, row_number() OVER (PARTITION BY i.empresa, i.label ORDER BY i.rc_num, i.ncod_item) AS pos
    FROM _rc_itens i
  ), pares AS (
    SELECT s.empresa, s.ncod_ped, i.rc_num, i.cdescricao, i.nval_unit, i.nqtde, i.nval_tot, i.auto_key
    FROM slots s JOIN itens i ON i.empresa = s.empresa AND i.label = s.label AND i.pos = s.pos
  ), upd AS (
    UPDATE approval.approvals a SET
      rc_numero = p.rc_num,
      rc_descricao = p.cdescricao,
      rc_custo = p.nval_unit,
      rc_custo_total = coalesce(p.nval_tot, p.nval_unit * p.nqtde),
      custom_fields = coalesce(a.custom_fields,'{}'::jsonb) || jsonb_build_object('rc_auto', p.auto_key),
      updated_at = now()
    FROM pares p WHERE a.empresa = p.empresa AND a.ncod_ped = p.ncod_ped
    RETURNING p.auto_key
  )
  SELECT count(*) INTO v_preenchidas FROM upd;

  WITH restantes AS (
    SELECT i.*, row_number() OVER (ORDER BY i.empresa, i.label, i.rc_num, i.ncod_item) AS seq
    FROM _rc_itens i
    WHERE NOT i.fechado
      AND NOT EXISTS (
        SELECT 1 FROM approval.approvals a
        WHERE a.empresa = i.empresa AND a.custom_fields->>'rc_auto' = i.auto_key
      )
  ), ins AS (
    INSERT INTO approval.approvals
      (empresa, ncod_ped, modulo, source, status, pv_os_label,
       rc_numero, rc_descricao, rc_custo, rc_custo_total, custom_fields)
    SELECT r.empresa, v_min - r.seq,
           coalesce((SELECT min(a2.modulo) FROM approval.approvals a2
                     WHERE a2.empresa = r.empresa AND upper(a2.pv_os_label) = r.label
                       AND a2.modulo <> 'pcs'), 'avulsos'),
           'rc_auto', 'PENDENTE', r.label,
           r.rc_num, r.cdescricao, r.nval_unit,
           coalesce(r.nval_tot, r.nval_unit * r.nqtde),
           jsonb_build_object('rc_auto', r.auto_key)
    FROM restantes r
    RETURNING 1
  )
  SELECT count(*) INTO v_criadas FROM ins;

  RETURN jsonb_build_object('preenchidas', v_preenchidas, 'criadas', v_criadas);
END $function$;

CREATE OR REPLACE FUNCTION approval.triangular_rcs_omie()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_auto int := 0; v_sug int := 0;
BEGIN
  CREATE TEMP TABLE _tri ON COMMIT DROP AS
  WITH rcs AS (  -- RCs sem citação, com projeto
    SELECT pc.empresa, pc.cnumero,
           min(approval.try_parse_br_date(pc.dinc_data)) rc_data,
           array_agg(DISTINCT left(lower(pc.cdescricao),60)) itens,
           min(pc.ncod_proj)::text rc_proj
    FROM orders.pedidos_compra pc
    WHERE pc.cetapa IN ('10','15','20')
      AND (coalesce(pc.cobs_int,'')||' '||coalesce(pc.cobs,'')) !~* '(PV|OS)\s*-?\s*\d{3,5}'
    GROUP BY pc.empresa, pc.cnumero
    HAVING min(pc.ncod_proj) IS NOT NULL
  ), cands AS (
    SELECT r.empresa, r.cnumero, 'PV'||pv.numero_pedido AS label,
           r.rc_data - approval.try_parse_br_date(pv.d_inc) AS gap,
           (SELECT avg((SELECT max(similarity(rci, left(lower(iv.descricao),60)))
                        FROM sales.itens_vendidos iv
                        WHERE iv.empresa=pv.empresa AND iv.numero_pedido=pv.numero_pedido))
            FROM unnest(r.itens) rci) AS sim
    FROM rcs r
    JOIN sales.pedidos_venda pv ON pv.empresa=r.empresa
      AND pv.codigo_projeto = r.rc_proj
      AND approval.try_parse_br_date(pv.d_inc) BETWEEN r.rc_data - 15 AND r.rc_data
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY empresa, cnumero ORDER BY coalesce(sim,0) DESC, gap ASC) rk
    FROM cands
  )
  SELECT r1.empresa, r1.cnumero, r1.label, r1.gap, coalesce(r1.sim,0) AS sim1,
         coalesce((SELECT r2.sim FROM ranked r2
                   WHERE r2.empresa=r1.empresa AND r2.cnumero=r1.cnumero AND r2.rk=2), 0) AS sim2
  FROM ranked r1 WHERE r1.rk=1;

  WITH up AS (
    INSERT INTO approval.rc_vinculos (empresa, cnumero, label, metodo, score, gap_dias)
    SELECT empresa, cnumero, label,
           CASE WHEN sim1 >= 0.7 AND sim1 - sim2 >= 0.3 THEN 'triangulacao' ELSE 'sugestao' END,
           round(sim1::numeric, 3), gap
    FROM _tri
    WHERE sim1 >= 0.4
    ON CONFLICT (empresa, cnumero) DO UPDATE
      SET label = EXCLUDED.label, metodo = EXCLUDED.metodo,
          score = EXCLUDED.score, gap_dias = EXCLUDED.gap_dias
      WHERE approval.rc_vinculos.metodo <> 'manual'   -- manual nunca é sobrescrito
    RETURNING metodo
  )
  SELECT count(*) FILTER (WHERE metodo='triangulacao'),
         count(*) FILTER (WHERE metodo='sugestao')
  INTO v_auto, v_sug FROM up;

  RETURN jsonb_build_object('triangulados', v_auto, 'sugestoes', v_sug);
END $function$;
