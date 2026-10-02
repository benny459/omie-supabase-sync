-- Histórico de códigos (02/10/26, aprovado pelo Benny): nada histórico é reescrito; cada lugar mostra o código usado
-- no documento E o item de hoje. Um resolvedor só, para todos os módulos (Estoque, Compras…):
--   platform.v_item_codigo_resolvido — QUALQUER código/id já usado → item atual.
--   origem: 'omie' (código do Omie do próprio item) · 'mesclado' (código/ id de um item mesclado noutro; desfazer a
--           mesclagem tira a linha) · 'recodificado' (código novo do painel e códigos antigos depois de recodificar)
--           · 'fornecedor' (código do fornecedor no de-para do Compras).
--   desde/por: quando e quem (mesclagem, recodificação, confirmação do de-para); null para o código do Omie.
-- "Aplicar códigos" e "Recodificar" já gravam em platform.estoque_item_codigo (código, data, quem) — a view lê de lá.
-- Função para lote: orders.item_codigo_resolver(p_empresa, p_codigos text[]) — casa sem diferença de maiúsculas,
-- por código ou por id (n_cod_prod).

create or replace view platform.v_item_codigo_resolvido as
with dono as (
  -- dono final de cada código mesclado (cadeias A→B→C), com quando/quem da mesclagem que o tirou de cena
  select d.empresa, d.secundario, d.dono, x.created_at as desde, x.created_by_email as por
  from orders.v_estoque_mescla_dono d
  join platform.estoque_duplicidade_decisao x on x.ativo and x.decisao = 'mesclado' and x.empresa = d.empresa and x.secundario = d.secundario
), cur as (
  -- item de hoje: código do Omie, código novo (se houver) e descrição
  select p.empresa, p.n_cod_prod, max(p.codigo) as codigo_omie, orders.fn_html_unescape(max(p.descricao)) as descricao
  from orders.estoque_posicao p group by 1, 2
  union all
  select c.empresa, -c.id, c.omie_codigo, c.descricao
  from platform.estoque_item_cadastro c
  where c.n_cod_prod is null
), novo as (
  select empresa, n_cod_prod, max(codigo) filter (where atual) as codigo_novo from platform.estoque_item_codigo group by 1, 2
), usados as (
  -- código do Omie de cada item (os mesclados viram origem 'mesclado')
  select p.empresa, max(p.codigo) as codigo_usado, p.n_cod_prod as n_cod_prod_usado,
         case when dn.dono is null then 'omie' else 'mesclado' end as origem, dn.desde, dn.por, null::text as fornecedor
  from orders.estoque_posicao p left join dono dn on dn.empresa = p.empresa and dn.secundario = p.n_cod_prod
  group by p.empresa, p.n_cod_prod, dn.dono, dn.desde, dn.por
  union all
  -- códigos do painel (o novo e os antigos depois de recodificar)
  select k.empresa, k.codigo, k.n_cod_prod, 'recodificado', k.created_at, k.created_by_email, null
  from platform.estoque_item_codigo k
  union all
  -- códigos do fornecedor (de-para do Compras)
  select a.empresa, a.codigo_fornecedor, a.ncod_prod, 'fornecedor', a.confirmado_em, a.confirmado_por, a.fornecedor_nome
  from compras.v_item_aliases a
  where a.codigo_fornecedor is not null and a.ncod_prod is not null
)
select u.empresa, u.codigo_usado, u.n_cod_prod_usado, u.origem,
       coalesce(dn.dono, u.n_cod_prod_usado) as n_cod_prod_atual,
       coalesce(nv.codigo_novo, c.codigo_omie) as codigo_atual,
       c.codigo_omie as codigo_omie_atual, nv.codigo_novo as codigo_novo_atual,
       c.descricao as descricao_atual,
       coalesce(u.desde, dn.desde) as desde, coalesce(u.por, dn.por) as por,
       u.fornecedor,
       (coalesce(dn.dono, u.n_cod_prod_usado) <> u.n_cod_prod_usado) as mudou_de_item
from usados u
left join dono dn on dn.empresa = u.empresa and dn.secundario = u.n_cod_prod_usado
left join cur c on c.empresa = u.empresa and c.n_cod_prod = coalesce(dn.dono, u.n_cod_prod_usado)
left join novo nv on nv.empresa = u.empresa and nv.n_cod_prod = coalesce(dn.dono, u.n_cod_prod_usado);
revoke all on platform.v_item_codigo_resolvido from anon, authenticated;
grant select on platform.v_item_codigo_resolvido to service_role;

-- Lote: devolve, para cada código/id pedido, as linhas que casam (pode haver mais de uma: ex. o mesmo código de
-- fornecedor em dois itens). Ordem: omie, recodificado, mesclado, fornecedor.
create or replace function orders.item_codigo_resolver(p_empresa text, p_codigos text[])
returns setof platform.v_item_codigo_resolvido
language sql stable security definer set search_path = platform, orders, public as $$
  select r.* from platform.v_item_codigo_resolvido r
  where r.empresa = p_empresa
    and (upper(r.codigo_usado) = any (select upper(trim(x)) from unnest(p_codigos) x)
         or r.n_cod_prod_usado::text = any (select trim(x) from unnest(p_codigos) x))
  order by r.codigo_usado, case r.origem when 'omie' then 1 when 'recodificado' then 2 when 'mesclado' then 3 else 4 end
$$;
revoke all on function orders.item_codigo_resolver(text, text[]) from public, anon, authenticated;
grant execute on function orders.item_codigo_resolver(text, text[]) to service_role;

-- Linha do tempo de um item (ficha): todos os códigos que respondem nele hoje.
create or replace function orders.item_codigos_do_item(p_empresa text, p_prod bigint)
returns setof platform.v_item_codigo_resolvido
language sql stable security definer set search_path = platform, orders, public as $$
  select r.* from platform.v_item_codigo_resolvido r
  where r.empresa = p_empresa and r.n_cod_prod_atual = p_prod
  order by case r.origem when 'omie' then 1 when 'mesclado' then 2 when 'recodificado' then 3 else 4 end, r.desde nulls first
$$;
revoke all on function orders.item_codigos_do_item(text, bigint) from public, anon, authenticated;
grant execute on function orders.item_codigos_do_item(text, bigint) to service_role;
