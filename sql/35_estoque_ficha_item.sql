-- 35 — Estoque v2, fase 1 (ficha do item, só leitura) · 01/10/2026
-- Plano: docs/plans/ESTOQUE_FICHA_ITEM.md (branch mockup/estoque-v2).
-- Só objetos NOVOS (o projeto omie-data é compartilhado com o ALLKA Portal):
--   funções  orders.fn_html_unescape / fn_norm_desc / fn_chave_desc / fn_numeros / fn_variante
--   views    orders.v_estoque_saldo_local · orders.v_estoque_mov_cli · orders.v_estoque_item · orders.v_estoque_duplicidade
--   tabela   orders.estoque_duplicidade + função orders.refresh_estoque_duplicidade() (pg_trgm é caro → refresh agendado)
--   pg_cron  refresh-estoque-duplicidade
-- Leitura só pelo service role nas rotas /api/estoque/* (anon/authenticated sem grant).

-- Descrições do Omie chegam com entidades HTML (às vezes duas vezes: &amp;quot;).
create or replace function orders.fn_html_unescape(t text) returns text
language sql immutable parallel safe as $$
  select case when t is null then null else
    replace(replace(replace(replace(replace(replace(replace(replace(
      replace(replace(t, '&amp;', '&'), '&amp;', '&'),
      '&quot;', '"'), '&#34;', '"'), '&#39;', ''''), '&#039;', ''''), '&apos;', ''''),
      '&lt;', '<'), '&gt;', '>'), '&nbsp;', ' ')
  end
$$;

-- Maiúsculas, sem acento, pontuação vira espaço (palavras preservadas).
create or replace function orders.fn_norm_desc(t text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(regexp_replace(
    translate(upper(orders.fn_html_unescape(coalesce(t, ''))),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Z0-9]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Chave de "nome igual": sem acento, sem espaço, sem pontuação.
create or replace function orders.fn_chave_desc(t text) returns text
language sql immutable parallel safe as $$
  select replace(orders.fn_norm_desc(t), ' ', '')
$$;

-- Números/medidas da descrição (ordenados) — "parecido" só vale com os mesmos números.
create or replace function orders.fn_numeros(t text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(m[1] order by m[1]), '{}')
  from regexp_matches(orders.fn_html_unescape(coalesce(t, '')), '(\d+(?:[.,/-]\d+)*)', 'g') m
$$;

-- Variante: cada lado tem uma palavra curta (≤3) que o outro não tem (C×LR, AZ×PT).
create or replace function orders.fn_variante(a text, b text) returns boolean
language sql immutable parallel safe as $$
  with pa as (select distinct w from regexp_split_to_table(orders.fn_norm_desc(a), ' ') w where w <> ''),
       pb as (select distinct w from regexp_split_to_table(orders.fn_norm_desc(b), ' ') w where w <> '')
  select exists (select 1 from pa where length(w) <= 3 and w not in (select w from pb))
     and exists (select 1 from pb where length(w) <= 3 and w not in (select w from pa))
$$;

-- Movimentos com cliente e projeto (via pedido de venda). Remessas não casam — ficam sem cliente.
create or replace view orders.v_estoque_mov_cli as
select m.empresa, m.id_mov, m.id_prod, m.dt_mov, m.des_origem, m.tipo, m.qtde, m.valor, m.saldo, m.cmc,
       coalesce(m.num_doc, m.num_pedido) as doc, m.num_pedido, m.codigo_local_estoque,
       (coalesce(m.cancelamento, 'N') = 'S') as cancelado,
       pv.numero_pedido as pv_numero,
       coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente,
       pr.nome as projeto
from orders.estoque_movimentos m
left join sales.pedidos_venda pv on pv.empresa = m.empresa and pv.codigo_pedido = m.id_pedido
left join finance.clientes c on c.empresa = pv.empresa and c.codigo_cliente_omie = pv.codigo_cliente
left join finance.projetos pr on pr.empresa = pv.empresa and pr.codigo::text = pv.codigo_projeto;

-- Pares de possível duplicidade (nome igual + parecido ≥ 0,85 com os mesmos números).
-- Tabela + função (e não matview): o "parecido" precisa de índice GiST de trigramas
-- numa tabela temporária — sem ele o auto-join leva 30 s; com ele, ~3 s.
create table if not exists orders.estoque_duplicidade (
  empresa text not null, prod_a bigint not null, prod_b bigint not null,
  tipo text not null, sim numeric not null, chave text,
  atualizado_em timestamptz not null default now(),
  primary key (empresa, prod_a, prod_b)
);
alter table orders.estoque_duplicidade enable row level security;

create or replace function orders.refresh_estoque_duplicidade() returns integer
language plpgsql set search_path = orders, public, pg_temp as $fn$
declare n integer;
begin
  create temp table _k on commit drop as
    with d as (
      select empresa, n_cod_prod, orders.fn_html_unescape(max(descricao)) as descricao
      from orders.estoque_posicao group by 1, 2)
    select d.*, orders.fn_chave_desc(descricao) as chave, lower(orders.fn_norm_desc(descricao)) as norm,
           orders.fn_numeros(descricao) as nums
    from d;
  create index on _k using gist (norm gist_trgm_ops);
  analyze _k;
  perform set_config('pg_trgm.similarity_threshold', '0.85', true);

  create temp table _p on commit drop as
    select a.empresa, a.n_cod_prod as prod_a, b.n_cod_prod as prod_b, 'exata'::text as tipo, 1.0::numeric as sim, a.chave
    from _k a join _k b on b.empresa = a.empresa and b.chave = a.chave and b.n_cod_prod > a.n_cod_prod
    where a.chave <> ''
    union all
    select a.empresa, a.n_cod_prod, b.n_cod_prod, 'similar', round(similarity(a.norm, b.norm)::numeric, 2), null
    from _k a join _k b on b.norm % a.norm and b.empresa = a.empresa and b.n_cod_prod > a.n_cod_prod
      and b.chave <> a.chave and b.nums = a.nums
    where not orders.fn_variante(a.descricao, b.descricao);

  delete from orders.estoque_duplicidade d
  where not exists (select 1 from _p where _p.empresa = d.empresa and _p.prod_a = d.prod_a and _p.prod_b = d.prod_b);
  insert into orders.estoque_duplicidade (empresa, prod_a, prod_b, tipo, sim, chave)
  select empresa, prod_a, prod_b, tipo, sim, chave from _p
  on conflict (empresa, prod_a, prod_b) do update
    set tipo = excluded.tipo, sim = excluded.sim, chave = excluded.chave, atualizado_em = now();
  select count(*) into n from orders.estoque_duplicidade;
  return n;
end
$fn$;

-- Fase 4 vai tirar daqui os pares já decididos (platform.estoque_duplicidade_decisao).
create or replace view orders.v_estoque_duplicidade as
select empresa, prod_a, prod_b, tipo, sim, chave, atualizado_em from orders.estoque_duplicidade;

-- SALDO: ponto único de cálculo. Hoje = espelho do Omie. Fase 3 (ajuste de saldo SÓ no
-- painel, nunca enviado ao Omie — decisão do Benny 01/10/26): trocar "0::numeric as ajuste"
-- pelo somatório de platform.estoque_ajuste aprovados por item/local. Todo o resto
-- (v_estoque_item, ficha, lista, auditoria) já lê saldo/saldo_omie/ajuste daqui.
create or replace view orders.v_estoque_saldo_local as
select p.empresa, p.n_cod_prod, p.codigo_local_estoque, p.codigo, p.descricao,
       p.saldo as saldo_omie, 0::numeric as ajuste, p.saldo + 0::numeric as saldo,
       p.fisico, p.reservado, p.pendente, p.cmc, p.estoque_minimo, p.data_posicao
from orders.estoque_posicao p;

-- Uma linha por produto: posição agregada + consumo + última movimentação + sinais de auditoria.
create or replace view orders.v_estoque_item as
with pos as (
  select empresa, n_cod_prod, max(codigo) as codigo, orders.fn_html_unescape(max(descricao)) as descricao,
         sum(saldo) as saldo, sum(saldo_omie) as saldo_omie, sum(ajuste) as ajuste,
         sum(fisico) as fisico, sum(reservado) as reservado, sum(pendente) as pendente,
         coalesce(sum(cmc * greatest(saldo, 0)) / nullif(sum(greatest(saldo, 0)), 0), max(cmc)) as cmc,
         max(estoque_minimo) as estoque_minimo, max(data_posicao) as data_posicao,
         bool_or(saldo < 0) as local_negativo,
         jsonb_agg(jsonb_build_object('local', codigo_local_estoque::text, 'saldo', saldo, 'saldo_omie', saldo_omie,
           'ajuste', ajuste, 'pendente', pendente, 'reservado', reservado, 'cmc', cmc) order by codigo_local_estoque) as locais
  from orders.v_estoque_saldo_local group by 1, 2
), c90 as (
  select empresa, id_prod, sum(abs(qtde)) as q90
  from orders.estoque_movimentos
  where tipo = 'saida' and coalesce(cancelamento, 'N') <> 'S' and dt_mov >= current_date - 90
  group by 1, 2
), um as (
  select empresa, id_prod, max(dt_mov) as ult, count(*) as n
  from orders.estoque_movimentos where coalesce(cancelamento, 'N') <> 'S' group by 1, 2
), pcs as (
  select p.empresa, i.ncod_prod,
         count(*) filter (where coalesce(p.etapa, '') not in ('60', '80') and p.dt_rec is null
                            and coalesce(i.qtd_recebida, 0) < i.qtd
                            and p.emissao < current_date - 60 and p.emissao >= current_date - 730) as pcs_velhos,
         count(*) filter (where i.qtd_recebida > i.qtd) as rec_a_mais,
         max(p.emissao) as ult_pc
  from compras.itens i join compras.pedidos p on p.id = i.pedido_id
  where p.tipo = 'PC' and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2
), dup as (
  select empresa, prod_a as id from orders.estoque_duplicidade
  union select empresa, prod_b from orders.estoque_duplicidade
)
select pos.empresa, pos.n_cod_prod, pos.codigo, pos.descricao,
       sp.unidade, sp.ncm,
       pos.saldo, pos.saldo_omie, pos.ajuste, pos.fisico, pos.reservado, pos.pendente, pos.cmc, pos.estoque_minimo, pos.data_posicao,
       pos.locais, jsonb_array_length(pos.locais) as n_locais, pos.local_negativo,
       coalesce(c90.q90, 0) as consumo_90d, um.ult as ult_mov, coalesce(um.n, 0) as n_mov,
       coalesce(pcs.pcs_velhos, 0) as pcs_velhos, coalesce(pcs.rec_a_mais, 0) as rec_a_mais, pcs.ult_pc,
       (dup.id is not null) as duplicidade
from pos
left join c90 on c90.empresa = pos.empresa and c90.id_prod = pos.n_cod_prod
left join um on um.empresa = pos.empresa and um.id_prod = pos.n_cod_prod
left join pcs on pcs.empresa = pos.empresa and pcs.ncod_prod = pos.n_cod_prod
left join (select distinct on (empresa, id_omie) empresa, id_omie, unidade, ncm from sales.produtos order by empresa, id_omie, synced_at desc) sp
  on sp.empresa = pos.empresa and sp.id_omie = pos.n_cod_prod
left join (select distinct empresa, id from dup) dup on dup.empresa = pos.empresa and dup.id = pos.n_cod_prod;

revoke all on orders.v_estoque_item, orders.v_estoque_saldo_local, orders.v_estoque_mov_cli, orders.v_estoque_duplicidade, orders.estoque_duplicidade
  from anon, authenticated;
revoke all on function orders.refresh_estoque_duplicidade() from public, anon, authenticated;

select orders.refresh_estoque_duplicidade();

-- Refresh dos pares (o import_estoque roda 3x/dia útil; 4x/dia sobra).
select cron.schedule('refresh-estoque-duplicidade', '41 */6 * * *',
  $$select orders.refresh_estoque_duplicidade()$$);
