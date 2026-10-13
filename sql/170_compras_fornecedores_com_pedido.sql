-- 13/10/26 (Benny): a Consulta de fornecedor só lista quem tem pedido de compra — nada de salário, luz, telefone.
create or replace function orders.compras_fornecedores_com_pedido(p_q text, p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
    select jsonb_build_object('cod', p.fornecedor_cod, 'nome', max(p.fornecedor_nome), 'cnpj', max(p.fornecedor_cnpj),
                              'n', count(*), 'ultimo', max(p.emissao)) x
      from compras.pedidos p
     where p.empresa = p_empresa and p.tipo = 'PC' and not p.cancelado and p.fornecedor_cod is not null
       and (p.fornecedor_nome ilike '%' || trim(p_q) || '%'
            or (length(regexp_replace(p_q, '\D', '', 'g')) >= 4
                and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') like '%' || regexp_replace(p_q, '\D', '', 'g') || '%'))
     group by p.fornecedor_cod
     order by max(p.emissao) desc
     limit 15) s
$function$;
grant execute on function orders.compras_fornecedores_com_pedido(text, text) to service_role;
