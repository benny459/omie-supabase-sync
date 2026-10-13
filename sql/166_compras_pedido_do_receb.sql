-- 13/10/26 — Lote de NF de entrada (portal): recebimento do Omie → pedido de compra do painel.
create or replace function orders.compras_pedidos_dos_recebimentos(p_empresa text, p_ids bigint[])
returns jsonb language sql stable security definer set search_path to 'orders', 'compras', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id_receb', r.id_receb, 'pedido_id', p.id)), '[]'::jsonb)
    from orders.recebimento_nfe r
    join compras.pedidos p on p.empresa = r.empresa and p.omie_ncod_ped = r.id_pedido and p.tipo = 'PC'
   where r.empresa = p_empresa and r.id_receb = any(p_ids);
$function$;
grant execute on function orders.compras_pedidos_dos_recebimentos(text, bigint[]) to service_role;
