-- 32 — Correções do feed de RCs para a operação (01/10/2026):
--   · grava custom_fields.rc_qtd (sem ele v_pc_completo_enriched usava qtd 1 e
--     somava preços unitários) — sempre por MERGE, sem apagar outras chaves;
--   · descrições do Omie com entidades HTML (&quot; &amp; &#39; …) decodificadas
--     no feed, nos itens de compras.* e nas linhas já publicadas.

create or replace function compras.sem_entidades(t text) returns text
language sql immutable as $$
  select case when t is null or t !~ '&' then t else
    replace(replace(replace(replace(replace(replace(replace(replace(t,
      '&quot;', '"'), '&#34;', '"'), '&apos;', ''''), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' '), '&amp;', '&') end
$$;

create or replace function compras.publicar_rcs_operacao()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
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
             where l.rc_item_id = i.id) as recebido
      from compras.pedidos p join compras.itens i on i.pedido_id = p.id
     where p.tipo = 'RC' and not p.cancelado and not p.omie_ausente
       and coalesce(p.pv_os_painel, p.pv_os) is not null
  )
  select b.*,
         case when b.pcs is null then 'Em requisição'
              when b.recebido then 'Recebido (PC ' || b.pcs || ')' else 'Em PC ' || b.pcs end as compras_status,
         exists (select 1 from sales.pedidos_venda pv join sales.etapas_pedidos ep
                   on ep.empresa = pv.empresa and ep.codigo_pedido = pv.codigo_pedido
                  where pv.empresa = b.empresa and 'PV' || pv.numero_pedido = b.label and coalesce(ep.faturado, '') = 'S')
         or exists (select 1 from sales.ordens_servico os
                     where os.empresa = b.empresa and 'OS' || os.numero_os = b.label and coalesce(os.dt_fat, '') <> '') as fechado
    from base b;

  -- atualiza as linhas que esta função já criou
  with upd as (
    update approval.approvals a set
      rc_numero = r.rc_num, rc_descricao = r.descricao, rc_custo = r.valor_unit,
      rc_custo_total = round(r.valor_unit * r.qtd, 2), comprador = coalesce(a.comprador, r.comprador),
      pc_numero_manual = coalesce(split_part(r.pcs, ',', 1), a.pc_numero_manual),
      -- merge: só estas chaves; as outras do custom_fields (ww_*, anexos…) ficam
      custom_fields = coalesce(a.custom_fields, '{}'::jsonb)
                      || jsonb_build_object('compras_status', r.compras_status, 'rc_qtd', r.qtd),
      updated_at = now()
      from _rcp r
     where a.empresa = r.empresa and a.custom_fields->>'rc_compras' = r.item_id::text
       and ((a.rc_numero, a.rc_descricao, a.rc_custo, a.rc_custo_total, a.pc_numero_manual, a.custom_fields->>'compras_status')
            is distinct from (r.rc_num, r.descricao, r.valor_unit, round(r.valor_unit * r.qtd, 2),
                              coalesce(split_part(r.pcs, ',', 1), a.pc_numero_manual), r.compras_status)
            or (a.custom_fields->>'rc_qtd')::numeric is distinct from r.qtd)
    returning 1
  ) select count(*) into v_upd from upd;

  -- cria as que faltam (PV/OS em aberto, sem linha equivalente no balde)
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
           'rc_auto', 'PENDENTE', n.label, n.comprador, n.rc_num, n.descricao, n.valor_unit, round(n.valor_unit * n.qtd, 2),
           nullif(split_part(coalesce(n.pcs, ''), ',', 1), ''),
           jsonb_build_object('rc_compras', n.item_id::text, 'compras_status', n.compras_status, 'rc_qtd', n.qtd)
      from novas n
    returning 1
  ) select count(*) into v_ins from ins;

  -- remove o que sumiu, se ninguém mexeu na linha
  with del as (
    delete from approval.approvals a
     where a.custom_fields ? 'rc_compras' and a.status = 'PENDENTE' and a.aprovador_email is null
       and not exists (select 1 from _rcp r where r.empresa = a.empresa and r.item_id::text = a.custom_fields->>'rc_compras')
    returning 1
  ) select count(*) into v_del from del;

  return jsonb_build_object('criadas', v_ins, 'atualizadas', v_upd, 'removidas', v_del);
end $$;

update compras.itens set descricao = compras.sem_entidades(descricao) where descricao ~ '&[a-z#0-9]+;';
update compras.pedidos set fornecedor_nome = compras.sem_entidades(fornecedor_nome) where fornecedor_nome ~ '&[a-z#0-9]+;';
update approval.approvals set rc_descricao = compras.sem_entidades(rc_descricao)
 where custom_fields ? 'rc_compras' and rc_descricao ~ '&[a-z#0-9]+;';
update approval.approvals a set custom_fields = a.custom_fields || jsonb_build_object('rc_qtd', i.qtd)
  from compras.itens i
 where a.custom_fields ? 'rc_compras' and i.id = (a.custom_fields->>'rc_compras')::bigint
   and (a.custom_fields->>'rc_qtd')::numeric is distinct from i.qtd;
revoke all on function compras.sem_entidades(text) from public, anon, authenticated;
