-- 38 — Compras usa o histórico de códigos do Estoque (02/10/2026, aprovado pelo Benny).
-- Fonte: platform.v_item_codigo_resolvido / orders.item_codigo_resolver (sql/47, agente do Estoque).
-- Nada gravado em PC/NF é reescrito: só leitura/consolidação.
--   · compras_codigos_equivalentes(q): todos os códigos que respondem no(s) mesmo(s) item(ns) de hoje
--     (busca da lista/tabela por código antigo ou novo);
--   · compras_historico_preco: consolida o histórico de preço de todos os códigos do item de hoje;
--   · compras_aliases: de-para do fornecedor consolidado por item de hoje (itens mesclados entram juntos).

create or replace function orders.compras_codigos_equivalentes(p_q text, p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path = compras, platform, orders, public as $$
  with alvo as (
    select distinct r.n_cod_prod_atual from orders.item_codigo_resolver(p_empresa, array[trim(p_q)]) r
     where coalesce(trim(p_q), '') <> ''
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nCodProdAtual', a.n_cod_prod_atual,
           'codigoAtual', (select max(v.codigo_atual) from platform.v_item_codigo_resolvido v where v.empresa = p_empresa and v.n_cod_prod_atual = a.n_cod_prod_atual),
           'descricaoAtual', (select max(v.descricao_atual) from platform.v_item_codigo_resolvido v where v.empresa = p_empresa and v.n_cod_prod_atual = a.n_cod_prod_atual),
           'codigos', (select coalesce(jsonb_agg(distinct v.codigo_usado), '[]'::jsonb) from platform.v_item_codigo_resolvido v
                        where v.empresa = p_empresa and v.n_cod_prod_atual = a.n_cod_prod_atual and v.origem <> 'fornecedor'),
           'ids', (select coalesce(jsonb_agg(distinct v.n_cod_prod_usado), '[]'::jsonb) from platform.v_item_codigo_resolvido v
                    where v.empresa = p_empresa and v.n_cod_prod_atual = a.n_cod_prod_atual))), '[]'::jsonb)
    from alvo a
$$;

-- Histórico de preço: o código pedido + todos os códigos/ids do mesmo item de hoje.
create or replace function orders.compras_historico_preco(p_cod text, p_lim int default 25)
returns jsonb language sql stable security definer set search_path = compras, platform, orders, public as $$
  with eq as (
    select v.codigo_usado, v.n_cod_prod_usado
      from platform.v_item_codigo_resolvido v
     where v.origem <> 'fornecedor'
       and v.n_cod_prod_atual in (select r.n_cod_prod_atual from orders.item_codigo_resolver('SF', array[p_cod]) r)
  )
  select coalesce(jsonb_agg(jsonb_build_object('n', x.numero, 'd', x.emissao, 'f', x.fornecedor_nome,
                                               'q', x.qtd, 'vu', x.valor_unit, 'id', x.pedido_id, 'cod', x.produto_cod)
                            order by x.emissao desc nulls last, x.pedido_id desc), '[]'::jsonb)
    from (select p.numero, p.emissao, p.fornecedor_nome, i.qtd, i.valor_unit, p.id as pedido_id, i.produto_cod
            from compras.itens i join compras.pedidos p on p.id = i.pedido_id
           where (i.produto_cod = p_cod
                  or upper(i.produto_cod) in (select upper(codigo_usado) from eq)
                  or i.ncod_prod in (select n_cod_prod_usado from eq))
             and p.tipo = 'PC' and not p.cancelado and i.valor_unit > 0
           order by p.emissao desc nulls last, p.id desc limit greatest(1, least(p_lim, 100))) x
$$;

-- De-para do fornecedor consolidado pelo item de hoje (inclui os itens mesclados nele).
create or replace function orders.compras_aliases(p_ncod_prod bigint default null, p_cod text default null, p_cnpj text default null)
returns jsonb language sql stable security definer set search_path = compras, platform, orders, public as $$
  with atual as (
    select distinct r.n_cod_prod_atual from orders.item_codigo_resolver('SF',
             array_remove(array[p_ncod_prod::text, p_cod], null)) r
  ), ids as (
    select p_ncod_prod as id where p_ncod_prod is not null
    union select v.n_cod_prod_usado from platform.v_item_codigo_resolvido v where v.n_cod_prod_atual in (select n_cod_prod_atual from atual)
    union select n_cod_prod_atual from atual
  )
  select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object('n_cod_prod_atual', coalesce((select max(n_cod_prod_atual) from atual), v.ncod_prod))
                            order by v.confirmado_em desc), '[]'::jsonb)
    from compras.v_item_aliases v
   where ((p_ncod_prod is null and p_cod is null) or v.ncod_prod in (select id from ids) or (p_cod is not null and v.produto_cod = p_cod))
     and (p_cnpj is null or v.fornecedor_cnpj = regexp_replace(p_cnpj, '\D', '', 'g'))
     and (p_ncod_prod is not null or p_cod is not null or p_cnpj is not null)
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'orders' and p.proname in ('compras_codigos_equivalentes', 'compras_historico_preco', 'compras_aliases') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
