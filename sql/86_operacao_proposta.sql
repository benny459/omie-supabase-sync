-- 86 · Operação: de que proposta do CRM veio cada PV/OS (06/10/26)
-- Benny: "mostrar, caso tenha vindo do CRM, de qual proposta ele foi gerado..
-- ao clicar levará para aquela proposta do CRM".
-- Fontes: PV/OS nativo (vendas.documentos.proposta) e, para os PV/OS do Omie,
-- a RC automática que o CRM abriu ("[CRM proposta OPS…]" na obs interna).
create or replace function orders.operacao_propostas(p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(label, proposta), '{}'::jsonb) from (
    select distinct on (label) label, proposta from (
      select upper(d.tipo || d.numero) as label, d.proposta, 1 as pri
        from vendas.documentos d
       where d.empresa = p_empresa and nullif(d.proposta, '') is not null and d.numero is not null
      union all
      select upper(regexp_replace(coalesce(p.pv_os_painel, p.pv_os), '\s', '', 'g')),
             substring(p.obs_int from '\[CRM proposta ([A-Za-z0-9_]+)\]'), 2
        from compras.pedidos p
       where p.empresa = p_empresa and p.tipo = 'RC' and not p.cancelado
         and coalesce(p.pv_os_painel, p.pv_os) is not null and p.obs_int like '%[CRM proposta %'
    ) x where proposta is not null
    order by label, pri
  ) y
$$;
revoke all on function orders.operacao_propostas(text) from public, anon, authenticated;
grant execute on function orders.operacao_propostas(text) to service_role;
