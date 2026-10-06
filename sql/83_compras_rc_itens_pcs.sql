-- 06/10/26: PCs que atendem cada item da RC (folha da requisição mostra nº + link).
create or replace function orders.compras_rc_itens_pcs(p_rc_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.rc_item_id::text, x.pcs), '{}'::jsonb) from (
    select l.rc_item_id, jsonb_agg(distinct jsonb_build_object('id', pp.id, 'num', pp.numero)) as pcs
      from compras.itens i
      join compras.item_rc l on l.rc_item_id = i.id
      join compras.itens pi on pi.id = l.pc_item_id
      join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
     where i.pedido_id = p_rc_id
     group by l.rc_item_id
  ) x
$$;
revoke all on function orders.compras_rc_itens_pcs(bigint) from public, anon, authenticated;
grant execute on function orders.compras_rc_itens_pcs(bigint) to service_role;
