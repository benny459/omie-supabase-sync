-- 19 — Catálogo de compras para montar a lista de materiais no painel (30/09/2026).
--
-- Uma linha por produto do Omie (SF): o que se comprou (pedidos de compra) e o
-- que está só cadastrado. Para cada um:
--   ultimo_preco / ultima_compra / ultimo_pc   — do pedido mais recente
--   fornecedor                                  — do pedido mais recente
--   entrega_dias  — média (dias) entre o pedido e a NF de entrada ligada a ele.
--                   Sem histórico do item, vale a média do fornecedor (entrega_fonte).
--   fat_dias      — média do prazo de pagamento dos pedidos (condição do Omie:
--                   "Para 28 dias" = 28, "30/60/90" = 60, "A Vista" = 0).
-- Materializada (15.9k linhas de PC viram ~5k produtos) e renovada a cada hora.

-- pg_trgm já instalado no schema public

drop materialized view if exists orders.mv_catalogo_compra cascade;
create materialized view orders.mv_catalogo_compra as
with parc as (
  select codigo,
         case when descricao ilike 'a vista' then 0
              else (select avg(n::numeric) from (
                      select (regexp_matches(descricao, '(\d+)', 'g'))[1] n
                      union all select '0' where descricao ilike 'a vista/%') z)
         end as dias
  from finance.parcelas
),
linhas as (
  select c.ncod_ped, c.ncod_prod, c.cproduto, c.cunidade, c.nval_unit, c.ncod_for, c.cnumero,
         replace(replace(replace(replace(c.cdescricao, '&quot;', '"'), '&amp;', '&'), '&apos;', ''''), '&#39;', '''') as descricao,
         to_date(nullif(c.dinc_data, ''), 'DD/MM/YYYY') as d_ped,
         p.dias as fat_dias
  from orders.pedidos_compra c
  left join parc p on p.codigo = c.ccod_parc
  where c.empresa = 'SF' and c.ncod_prod is not null and coalesce(c.nval_unit, 0) > 0
),
entrega as (
  select l.ncod_ped, min(coalesce(to_date(nullif(r.dt_rec, ''), 'DD/MM/YYYY'),
                                  to_date(nullif(r.emissao, ''), 'DD/MM/YYYY'))) - min(l.d_ped) as dias
  from (select distinct ncod_ped, d_ped from linhas) l
  join orders.recebimento_nfe r on r.empresa = 'SF' and r.id_pedido = l.ncod_ped
  group by l.ncod_ped
),
por_forn as (
  select l.ncod_for, avg(e.dias) entrega, avg(l.fat_dias) fat
  from (select distinct ncod_ped, ncod_for, fat_dias from linhas) l
  left join entrega e on e.ncod_ped = l.ncod_ped
  group by 1
),
ultimo as (
  select distinct on (ncod_prod) ncod_prod, cproduto, cunidade, nval_unit, ncod_for, cnumero, d_ped, descricao
  from linhas order by ncod_prod, d_ped desc nulls last, ncod_ped desc
),
agg as (
  select l.ncod_prod, count(distinct l.ncod_ped) qtd_compras,
         avg(e.dias) entrega_item, avg(l.fat_dias) fat_item
  from linhas l left join entrega e on e.ncod_ped = l.ncod_ped
  group by 1
),
comprados as (
  select 'SF'::text empresa, u.ncod_prod, u.cproduto codigo, u.descricao, u.cunidade unidade,
         u.nval_unit ultimo_preco, u.d_ped ultima_compra, u.cnumero ultimo_pc,
         u.ncod_for fornecedor_cod, replace(coalesce(nullif(k.nome_fantasia, ''), k.razao_social), '&amp;', '&') fornecedor,
         a.qtd_compras,
         round(coalesce(a.entrega_item, f.entrega))::int entrega_dias,
         case when a.entrega_item is not null then 'item' when f.entrega is not null then 'fornecedor' end entrega_fonte,
         round(coalesce(a.fat_item, f.fat))::int fat_dias
  from ultimo u
  join agg a on a.ncod_prod = u.ncod_prod
  left join por_forn f on f.ncod_for = u.ncod_for
  left join finance.clientes k on k.empresa = 'SF' and k.codigo_cliente_omie = u.ncod_for
),
so_cadastro as (
  select 'SF'::text, p.sku::bigint, null::text, replace(replace(replace(p.descricao, '&quot;', '"'), '&amp;', '&'), '&apos;', ''''), p.unidade,
         nullif(p.valor_unitario, 0), null::date, null::text, null::bigint, null::text, 0::bigint,
         null::int, null::text, null::int
  from orders.produtos_compras p
  where p.empresa = 'SF' and p.sku ~ '^\d+$'
    and not exists (select 1 from ultimo u where u.ncod_prod = p.sku::bigint)
)
select * from comprados
union all
select * from so_cadastro;

create unique index mv_catalogo_compra_pk on orders.mv_catalogo_compra (empresa, ncod_prod);
create index mv_catalogo_compra_desc_trgm on orders.mv_catalogo_compra using gin (descricao public.gin_trgm_ops);

-- Números/medidas de um texto (1/2, 3/4, 4040, 12, 6,0 → 6) — trava do casamento:
-- "tubo 1/2" nunca é aceito sozinho como "tubo 1" só porque o texto é parecido.
create or replace function orders.medidas(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct regexp_replace(regexp_replace(m[1], ',', '.', 'g'), '\.0+$', '')), '{}')
  from regexp_matches(lower(coalesce(t, '')), '(\d+(?:[.,]\d+)?(?:/\d+)?)', 'g') m
$$;

-- Busca do autocompletar: código exato > todas as palavras presentes > começa com
-- a 1ª palavra > já foi comprado > semelhança do texto.
create or replace function orders.buscar_catalogo(q text, lim int default 12)
returns table (ncod_prod bigint, codigo text, descricao text, unidade text, ultimo_preco numeric,
               ultima_compra date, ultimo_pc text, fornecedor text, qtd_compras bigint,
               entrega_dias int, entrega_fonte text, fat_dias int, score real)
language sql stable security definer set search_path = '' as $$
  with tk as (
    select coalesce(array_agg(t order by o), '{}') toks, greatest(count(*), 1) n
    from regexp_split_to_table(lower(trim(q)), '\s+') with ordinality s(t, o) where t <> ''
  )
  select c.ncod_prod, c.codigo, c.descricao, c.unidade, c.ultimo_preco, c.ultima_compra, c.ultimo_pc,
         c.fornecedor, c.qtd_compras, c.entrega_dias, c.entrega_fonte, c.fat_dias,
         (case when c.codigo = q then 3 else 0 end
          + (select count(*) from unnest(tk.toks) t where lower(c.descricao) like '%' || t || '%')::real / tk.n
          + case when lower(c.descricao) like tk.toks[1] || '%' then 0.5 else 0 end
          + case when coalesce(c.qtd_compras, 0) > 0 then 0.1 else 0 end
          + 0.3 * public.word_similarity(lower(q), lower(c.descricao)))::real as score
  from orders.mv_catalogo_compra c, tk
  where c.codigo = q
     or c.descricao ilike '%' || q || '%'
     or lower(q) operator(public.<%) lower(c.descricao)
     or (select bool_and(lower(c.descricao) like '%' || t || '%') from unnest(tk.toks) t)
  order by score desc, c.qtd_compras desc nulls last, c.ultima_compra desc nulls last
  limit greatest(1, least(lim, 50));
$$;

-- Casamento em lote (planilha): 3 candidatos por linha, medidas_ok primeiro.
drop function if exists orders.casar_catalogo(text[]);
create or replace function orders.casar_catalogo(itens text[])
returns table (idx int, ncod_prod bigint, codigo text, descricao text, unidade text, ultimo_preco numeric,
               ultima_compra date, fornecedor text, qtd_compras bigint, entrega_dias int,
               entrega_fonte text, fat_dias int, score real, medidas_ok boolean, rank int)
language sql stable security definer set search_path = '' as $$
  select t.idx::int, c.ncod_prod, c.codigo, c.descricao, c.unidade, c.ultimo_preco, c.ultima_compra,
         c.fornecedor, c.qtd_compras, c.entrega_dias, c.entrega_fonte, c.fat_dias, c.score, c.medidas_ok,
         c.rank::int
  from unnest(itens) with ordinality t(txt, idx)
  cross join lateral (
    select x.*, row_number() over (order by x.medidas_ok desc, x.score desc, x.qtd_compras desc nulls last) rank
    from (
      select m.ncod_prod, m.codigo, m.descricao, m.unidade, m.ultimo_preco, m.ultima_compra, m.fornecedor,
             m.qtd_compras, m.entrega_dias, m.entrega_fonte, m.fat_dias,
             public.similarity(lower(t.txt), lower(m.descricao)) as score,
             orders.medidas(t.txt) <@ orders.medidas(m.descricao) as medidas_ok
      from orders.mv_catalogo_compra m
      where lower(t.txt) operator(public.%) lower(m.descricao)
         or m.codigo = t.txt
    ) x
    order by x.medidas_ok desc, x.score desc, x.qtd_compras desc nulls last
    limit 3
  ) c
  where coalesce(trim(t.txt), '') <> '';
$$;

grant select on orders.mv_catalogo_compra to service_role, authenticated;
grant execute on function orders.buscar_catalogo(text, int) to service_role, authenticated;
grant execute on function orders.casar_catalogo(text[]) to service_role, authenticated;
grant execute on function orders.medidas(text) to service_role, authenticated;

select cron.schedule('refresh-catalogo-compra', '7 * * * *',
  $$refresh materialized view concurrently orders.mv_catalogo_compra$$);

-- Itens da lista guardam o que veio do catálogo (a linha continua editável).
alter table approval.rc_projetos_itens
  add column if not exists cat_ncod_prod    bigint,
  add column if not exists cat_codigo       text,
  add column if not exists cat_valor_unit   numeric,
  add column if not exists cat_fornecedor   text,
  add column if not exists cat_entrega_dias int,
  add column if not exists cat_fat_dias     int;
alter table approval.rc_projetos_itens_lixeira
  add column if not exists cat_ncod_prod    bigint,
  add column if not exists cat_codigo       text,
  add column if not exists cat_valor_unit   numeric,
  add column if not exists cat_fornecedor   text,
  add column if not exists cat_entrega_dias int,
  add column if not exists cat_fat_dias     int;
