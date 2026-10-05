-- 05/10/26: dados da conta de recebimento (banco/agência/conta/PIX) para a 2ª via
-- do recibo completar o bloco "Pagamento" (cadastros não é exposto no PostgREST).
create or replace function orders.fat_conta_dados(p_empresa text, p_codigo text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select a.dados from cadastros.aux a
  where a.registro = 'contas' and a.empresa = p_empresa and a.codigo = p_codigo and not a.inativo
  limit 1
$$;
revoke all on function orders.fat_conta_dados(text, text) from public, anon, authenticated;
grant execute on function orders.fat_conta_dados(text, text) to service_role;
