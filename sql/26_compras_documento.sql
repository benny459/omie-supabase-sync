-- 26 — Dados da empresa para o documento do pedido de compra (PDF ao fornecedor).
create or replace function orders.compras_empresa(p_empresa text)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select to_jsonb(e) - 'raw' from compras.cad_empresas e where e.empresa = p_empresa
$$;
revoke all on function orders.compras_empresa(text) from public, anon, authenticated;
grant execute on function orders.compras_empresa(text) to service_role;
