-- 06/10/26: abrir RC/PC pelo número (links de Operação → /erp/compras?abrir=7346&tipo=RC).
create or replace function orders.compras_id_por_numero(p_empresa text, p_numero text, p_tipo text default null)
returns bigint language sql stable security definer set search_path = '' as $$
  select p.id from compras.pedidos p
  where p.empresa = upper(p_empresa) and p.numero = trim(p_numero)
    and (p_tipo is null or p.tipo = upper(p_tipo))
  order by p.cancelado, p.id desc
  limit 1
$$;
revoke all on function orders.compras_id_por_numero(text, text, text) from public, anon, authenticated;
grant execute on function orders.compras_id_por_numero(text, text, text) to service_role;
