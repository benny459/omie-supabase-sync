-- 13/10/26 — Notas do fornecedor de um pedido (portal: /api/painel/compras/nf-entrada).
-- Junta: chave do próprio pedido, NF da Focus casada (compras.nf_vinculos) e, para PC do Omie,
-- os recebimentos (orders.recebimento_nfe.id_pedido = omie_ncod_ped) com a chave pela nfe_entrada.
create or replace function orders.compras_nfs_entrada_do_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path to 'orders', 'compras', 'public' as $function$
  with p as (select id, empresa, nf, chave_nfe, omie_ncod_ped from compras.pedidos where id = p_id),
  c as (
    select p.chave_nfe chave, null::bigint id_receb, null::date emissao, null::numeric valor, 1 ord from p where p.chave_nfe is not null
    union all
    select v.chave, null, null, null, 2 from compras.nf_vinculos v, p where v.pedido_id = p.id and coalesce(v.status, '') <> 'descartado'
    union all
    select coalesce(nullif(r.chave_nfe, ''), (select ne.chave_acesso from orders.nfe_entrada ne where ne.empresa = r.empresa and ne.id_receb = r.id_receb limit 1)),
           r.id_receb, to_date(nullif(r.emissao, ''), 'DD/MM/YYYY'), r.total_nfe, 3
      from orders.recebimento_nfe r, p where p.omie_ncod_ped is not null and r.empresa = p.empresa and r.id_pedido = p.omie_ncod_ped
    union all
    select ne.chave_acesso, ne.id_receb, ne.emissao_d, ne.valor, 4 from orders.nfe_entrada ne, p
     where p.nf ~ '^\d+$' and ne.empresa = p.empresa and ltrim(ne.numero, '0') = ltrim(p.nf, '0')
       and not exists (select 1 from orders.recebimento_nfe r where p.omie_ncod_ped is not null and r.id_pedido = p.omie_ncod_ped)
       and p.chave_nfe is null and not exists (select 1 from compras.nf_vinculos v where v.pedido_id = p.id)
  ),
  u as (
    select distinct on (coalesce(chave, 'receb:' || id_receb)) coalesce(chave, 'receb:' || id_receb) k, chave, id_receb, emissao, valor
      from c where chave is not null or id_receb is not null
     order by coalesce(chave, 'receb:' || id_receb), (id_receb is null), ord
  )
  select jsonb_build_object('empresa', (select empresa from p),
    'nfs', coalesce((select jsonb_agg(jsonb_build_object('chave', chave, 'idReceb', id_receb, 'emissao', emissao, 'valor', valor,
      'numero', case when chave ~ '^\d{44}$' then (substr(chave, 26, 9))::bigint::text else (select ltrim(nf, '0') from p) end)) from u), '[]'::jsonb));
$function$;
grant execute on function orders.compras_nfs_entrada_do_pedido(bigint) to service_role;
