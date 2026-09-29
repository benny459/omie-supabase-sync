-- 15: Captura automática de RCs do Omie pro painel (fim da digitação de rc_numero)
--
-- Descoberta que sustenta isto: a "requisição de compra" da operação NÃO é o
-- objeto requisicaocompra da API — é um pedido de compra em etapa 10/15, já
-- sincronizado em orders.pedidos_compra, cuja obs/obs_int cita o PV/OS
-- (ex: "PV1926"). Os rc_numero digitados à mão no painel são os cnumero
-- desses PCs (validado: 7199/7215/7229/7231/7232/7290 batem 1:1).
--
-- A função approval.capturar_rcs_omie() roda de hora em hora via pg_cron
-- ('capturar-rcs-omie', 5 * * * *) e, para cada item de RC ainda não
-- representado no bucket:
--   1º preenche placeholders vazios (linhas manuais sem rc_numero/descrição);
--   2º cria linhas novas (source='rc_auto') — só em PV/OS em aberto, pra não
--      inundar buckets históricos já faturados.
-- Idempotente via custom_fields->>'rc_auto' = cnumero:ncod_item.
-- Reverter uma captura: DELETE WHERE source='rc_auto' (criadas) /
-- UPDATE ... SET rc_* = NULL WHERE custom_fields ? 'rc_auto' (preenchidas).
--
-- Migrações aplicadas: "capturar_rcs_omie" (função + cron) e "source_rc_auto"
-- (CHECK de approvals.source ganhou 'rc_auto'). Definição autoritativa no
-- banco; este arquivo é a referência. Backfill inicial 29/09/26: 23 linhas
-- preenchidas + 35 criadas.
--
-- Limite conhecido: RCs cujas observações não citam PV/OS não são capturadas
-- (o matching por itens×valores da proposta do CRM fica pra v2). O processo
-- do comprador continua: escrever "PVxxxx"/"OSxxxx" na observação interna da
-- RC no Omie — o painel faz o resto.

ALTER TABLE approval.approvals DROP CONSTRAINT approvals_source_check;
ALTER TABLE approval.approvals ADD CONSTRAINT approvals_source_check
  CHECK (source = ANY (ARRAY['smartsuite'::text, 'native'::text, 'rc_auto'::text]));

CREATE OR REPLACE FUNCTION approval.capturar_rcs_omie() RETURNS jsonb
LANGUAGE plpgsql AS $$
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
    WHERE pc.cetapa IN ('10','15')
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
END $$;

SELECT cron.schedule('capturar-rcs-omie', '5 * * * *', $$SELECT approval.capturar_rcs_omie()$$);
