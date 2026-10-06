-- 85 · Operação (Vendas avulsas / Projetos) mostra os dados do PC NATIVO (06/10/26)
--
-- Desde 01/10 os pedidos de compra nascem só no painel (compras.pedidos) e não
-- chegam ao espelho do Omie (orders.pedidos_compra). As linhas de RC em
-- Operação procuravam fornecedor, valor, previsão, etapa e NF do PC só nesse
-- espelho — por isso o PC 7349 aparecia sem fornecedor e sem valor.
--
-- 1) approval.v_pc_completo_enriched: pc_by_cnumero e recebimento_by_cnumero
--    passam a incluir os PCs nativos (o espelho do Omie continua a mandar quando
--    o número existe lá). Remendo textual da definição actual, idempotente.
-- 2) compras.publicar_rcs_operacao(): ao actualizar, também muda a linha de
--    PV/OS (pv_os_label/modulo) quando a RC muda de venda, e leva o estado de
--    aprovação do PC nativo (aprovado / não aprovado) para a linha.

do $$
declare d text; a text; b text;
begin
  d := pg_get_viewdef('approval.v_pc_completo_enriched'::regclass);
  if position('compras.pedidos' in d) > 0 then
    raise notice 'v_pc_completo_enriched já inclui PCs nativos';
    return;
  end if;

  a := 'GROUP BY pc.empresa, pc.cnumero
        ), recebimento_by_cnumero AS (';
  b := 'GROUP BY pc.empresa, pc.cnumero
        UNION ALL
         SELECT p.empresa,
            p.numero AS pc_num,
            p.etapa AS pc_etapa_code,
            NULL::text AS pc_status_omie,
            p.categoria_cod AS pc_categ_code,
            p.fornecedor_cod AS pc_cod_fornecedor,
            p.contato AS pc_contato,
            to_char(p.previsao::timestamp with time zone, ''DD/MM/YYYY''::text) AS pc_dt_previsao,
            p.projeto_cod AS pc_cod_projeto,
            p.valor_total AS pc_valor_total,
            (SELECT count(*) AS count FROM compras.itens i WHERE (i.pedido_id = p.id)) AS pc_qtd_itens,
            to_char(COALESCE(p.emissao, (p.created_at)::date)::timestamp with time zone, ''DD/MM/YYYY''::text) AS pc_dt_inclusao,
            p.parcela_cod AS pc_ccod_parc
           FROM compras.pedidos p
          WHERE ((p.tipo = ''PC''::text) AND (NOT p.cancelado) AND (NOT COALESCE(p.omie_ausente, false))
            AND (NOT (EXISTS ( SELECT 1 FROM orders.pedidos_compra x
                  WHERE ((x.empresa = p.empresa) AND (x.cnumero = p.numero))))))
        ), recebimento_by_cnumero AS (';
  if position(a in d) = 0 then raise exception 'trecho pc_by_cnumero não encontrado'; end if;
  d := replace(d, a, b);

  a := 'GROUP BY pc.empresa, pc.cnumero
        ), joined AS (';
  b := 'GROUP BY pc.empresa, pc.cnumero
        UNION ALL
         SELECT p.empresa,
            p.numero AS pc_num,
            p.nf AS omie_nf_fornecedor,
            p.dt_faturado AS omie_dt_emissao,
            p.dt_rec AS omie_dt_recebimento,
            p.etapa AS omie_etapa_code
           FROM compras.pedidos p
          WHERE ((p.tipo = ''PC''::text) AND (NOT p.cancelado) AND ((p.nf IS NOT NULL) OR (p.dt_rec IS NOT NULL))
            AND (NOT (EXISTS ( SELECT 1 FROM orders.pedidos_compra x
                  WHERE ((x.empresa = p.empresa) AND (x.cnumero = p.numero))))))
        ), joined AS (';
  if position(a in d) = 0 then raise exception 'trecho recebimento_by_cnumero não encontrado'; end if;
  d := replace(d, a, b);

  execute 'create or replace view approval.v_pc_completo_enriched as ' || d;
end $$;

create or replace function compras.publicar_rcs_operacao()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'compras', 'public'
as $function$
declare v_min bigint; v_ins int := 0; v_upd int := 0; v_del int := 0;
begin
  select least(coalesce(min(ncod_ped), 0), -1) - 1 into v_min from approval.approvals;

  drop table if exists _rcp;
  create temp table _rcp on commit drop as
  with base as (
    select p.empresa, upper(regexp_replace(coalesce(p.pv_os_painel, p.pv_os), '\s', '', 'g')) as label,
           p.numero, case when p.numero ~ '^\d{1,15}$' then p.numero::numeric end as rc_num,
           p.comprador, i.id as item_id, i.seq, compras.sem_entidades(i.descricao) as descricao, i.qtd, i.valor_unit, i.omie_ncod_item,
           (select string_agg(distinct pp.numero, ', ' order by pp.numero) from compras.item_rc l
              join compras.itens pi on pi.id = l.pc_item_id join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
             where l.rc_item_id = i.id) as pcs,
           (select bool_and(pp.etapa in ('60', '80')) from compras.item_rc l
              join compras.itens pi on pi.id = l.pc_item_id join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
             where l.rc_item_id = i.id) as recebido,
           -- PC nativo mais recente que atende o item: estado de aprovação para a linha
           (select pp.aprov_status from compras.item_rc l
              join compras.itens pi on pi.id = l.pc_item_id join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
             where l.rc_item_id = i.id and pp.origem = 'painel' order by pp.id desc limit 1) as pc_aprov,
           (select pp.aprov_valor from compras.item_rc l
              join compras.itens pi on pi.id = l.pc_item_id join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
             where l.rc_item_id = i.id and pp.origem = 'painel' order by pp.id desc limit 1) as pc_aprov_valor
      from compras.pedidos p join compras.itens i on i.pedido_id = p.id
     where p.tipo = 'RC' and not p.cancelado and not p.omie_ausente
       and coalesce(p.pv_os_painel, p.pv_os) is not null
  )
  select b.*,
         case when b.pcs is null then 'Em requisição'
              when b.recebido then 'Recebido (PC ' || b.pcs || ')' else 'Em PC ' || b.pcs end as compras_status,
         case b.pc_aprov when 'aprovado' then 'APROVADO' when 'nao_aprovado' then 'NAO_APROVADO' end as status_pc,
         exists (select 1 from sales.pedidos_venda pv join sales.etapas_pedidos ep
                   on ep.empresa = pv.empresa and ep.codigo_pedido = pv.codigo_pedido
                  where pv.empresa = b.empresa and 'PV' || pv.numero_pedido = b.label and coalesce(ep.faturado, '') = 'S')
         or exists (select 1 from sales.ordens_servico os
                     where os.empresa = b.empresa and 'OS' || os.numero_os = b.label and coalesce(os.dt_fat, '') <> '') as fechado
    from base b;

  with upd as (
    update approval.approvals a set
      rc_numero = r.rc_num, rc_descricao = r.descricao, rc_custo = r.valor_unit,
      rc_custo_total = round(r.valor_unit * r.qtd, 2), comprador = coalesce(a.comprador, r.comprador),
      pc_numero_manual = coalesce(split_part(r.pcs, ',', 1), a.pc_numero_manual),
      -- a RC mudou de venda (ex.: PV+OS ligado à OS por engano) → a linha acompanha
      pv_os_label = r.label,
      modulo = case when upper(coalesce(a.pv_os_label, '')) = r.label then a.modulo
                    else coalesce((select min(a2.modulo) from approval.approvals a2
                                    where a2.empresa = r.empresa and upper(a2.pv_os_label) = r.label
                                      and a2.modulo <> 'pcs' and a2.ncod_ped <> a.ncod_ped), a.modulo) end,
      -- PC nativo aprovado / não aprovado em Compras → a linha mostra o mesmo
      status = coalesce(r.status_pc, a.status),
      valor_aprovado = case when r.status_pc = 'APROVADO' then coalesce(r.pc_aprov_valor, a.valor_aprovado) else a.valor_aprovado end,
      custom_fields = coalesce(a.custom_fields, '{}'::jsonb)
                      || jsonb_build_object('compras_status', r.compras_status, 'rc_qtd', r.qtd),
      updated_at = now()
      from _rcp r
     where a.empresa = r.empresa and a.custom_fields->>'rc_compras' = r.item_id::text
       and ((a.rc_numero, a.rc_descricao, a.rc_custo, a.rc_custo_total, a.pc_numero_manual, a.custom_fields->>'compras_status',
             upper(coalesce(a.pv_os_label, '')), a.status)
            is distinct from (r.rc_num, r.descricao, r.valor_unit, round(r.valor_unit * r.qtd, 2),
                              coalesce(split_part(r.pcs, ',', 1), a.pc_numero_manual), r.compras_status,
                              r.label, coalesce(r.status_pc, a.status))
            or (a.custom_fields->>'rc_qtd')::numeric is distinct from r.qtd)
    returning 1
  ) select count(*) into v_upd from upd;

  with novas as (
    select r.*, row_number() over (order by r.empresa, r.label, r.numero, r.seq) as k
      from _rcp r
     where not r.fechado
       and not exists (select 1 from approval.approvals a where a.empresa = r.empresa and a.custom_fields->>'rc_compras' = r.item_id::text)
       and not exists (select 1 from approval.approvals a
                        where a.empresa = r.empresa and upper(a.pv_os_label) = r.label
                          and ((r.rc_num is not null and a.rc_numero = r.rc_num and coalesce(a.custom_fields->>'rc_compras', '') = '')
                               or a.custom_fields->>'rc_auto' = r.numero || ':' || r.omie_ncod_item))
  ), ins as (
    insert into approval.approvals (empresa, ncod_ped, modulo, source, status, pv_os_label, comprador,
                                    rc_numero, rc_descricao, rc_custo, rc_custo_total, pc_numero_manual, custom_fields)
    select n.empresa, v_min - n.k,
           coalesce((select min(a2.modulo) from approval.approvals a2
                      where a2.empresa = n.empresa and upper(a2.pv_os_label) = n.label and a2.modulo <> 'pcs'), 'avulsos'),
           'rc_auto', coalesce(n.status_pc, 'PENDENTE'), n.label, n.comprador, n.rc_num, n.descricao, n.valor_unit, round(n.valor_unit * n.qtd, 2),
           nullif(split_part(coalesce(n.pcs, ''), ',', 1), ''),
           jsonb_build_object('rc_compras', n.item_id::text, 'compras_status', n.compras_status, 'rc_qtd', n.qtd)
      from novas n
    returning 1
  ) select count(*) into v_ins from ins;

  with del as (
    delete from approval.approvals a
     where a.custom_fields ? 'rc_compras' and a.status = 'PENDENTE' and a.aprovador_email is null
       and not exists (select 1 from _rcp r where r.empresa = a.empresa and r.item_id::text = a.custom_fields->>'rc_compras')
    returning 1
  ) select count(*) into v_del from del;

  return jsonb_build_object('criadas', v_ins, 'atualizadas', v_upd, 'removidas', v_del);
end $function$;
