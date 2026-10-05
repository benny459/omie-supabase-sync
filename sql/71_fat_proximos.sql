-- Nova emissão (05/10/26): próximos números sem consumir (aplicado como p71_fat_proximos_numeros).
create or replace function orders.fat_proximos(p_empresa text)
returns jsonb language plpgsql stable security definer set search_path = vendas, public as $$
declare v_pv bigint; v_os bigint; o_pv bigint; o_os bigint; c orders.fat_config;
begin
  select coalesce(max(ultimo), 0) into v_pv from vendas.numeracao where empresa = p_empresa and tipo = 'PV';
  select coalesce(max(ultimo), 0) into v_os from vendas.numeracao where empresa = p_empresa and tipo = 'OS';
  select coalesce(max(numero_pedido::bigint), 0) into o_pv from sales.pedidos_venda
   where empresa = p_empresa and numero_pedido ~ '^\d+$' and codigo_pedido < 9000000000000;
  select coalesce(max(numero_os::bigint), 0) into o_os from sales.ordens_servico
   where empresa = p_empresa and numero_os ~ '^\d+$' and codigo_os ~ '^\d+$' and codigo_os::bigint < 9000000000000;
  select * into c from orders.fat_config where empresa = p_empresa;
  return jsonb_build_object(
    'pv', greatest(v_pv, o_pv) + 1, 'os', greatest(v_os, o_os) + 1,
    'nfe', case when c.ambiente = 'producao' then c.nfe_proximo_producao else c.nfe_proximo_homologacao end,
    'nfe_serie', case when c.ambiente = 'producao' then c.nfe_serie_producao else c.nfe_serie_homologacao end,
    'recibo', c.recibo_proximo, 'ambiente', c.ambiente, 'producao_liberada', c.producao_liberada);
end $$;
revoke all on function orders.fat_proximos(text) from public, anon, authenticated;
grant execute on function orders.fat_proximos(text) to service_role;
-- Chave PIX/beneficiário das contas: em cadastros.aux.dados (pix_tipo, pix_chave, beneficiario) — sem DDL.
