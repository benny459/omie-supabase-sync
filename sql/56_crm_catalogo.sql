-- 56 — Catálogo nativo para o CRM (P7, 05/10/26)
--
-- O CRM (Propostas-WW) passa a montar a CP e a RC com o código NATIVO do item
-- (código novo por família; o do Omie fica ao lado) e o custo do painel (CMC,
-- última compra, histórico). A busca reaproveita o que o Compras já usa
-- (buscar_catalogo + item_codigo_resolver + compras_historico_preco); aqui só
-- entram:
--   • platform.estoque_item_preco_max — preço MÁXIMO de compra por item
--     (opcional; "componentes com limites e valores considerados máximos").
--     Ninguém é bloqueado: CP, RC e PC mostram um aviso quando passam dele.
--   • orders.estoque_preco_max_definir / _ler — gravar e ler o limite.
--   • orders.crm_itens_info — CMC, saldo, unidade e limite de vários itens de
--     uma vez (enriquece a busca do CRM).
-- Aditivo: nenhuma tabela/função existente muda.

create table if not exists platform.estoque_item_preco_max (
  empresa       text    not null default 'SF',
  n_cod_prod    bigint  not null,
  preco_maximo  numeric not null check (preco_maximo > 0),
  obs           text,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
alter table platform.estoque_item_preco_max enable row level security;
revoke all on platform.estoque_item_preco_max from public, anon, authenticated;
grant select, insert, update, delete on platform.estoque_item_preco_max to service_role;

-- Grava (valor > 0) ou apaga (valor nulo/0) o limite de um item.
create or replace function orders.estoque_preco_max_definir(p_empresa text, p_prod bigint, p_valor numeric, p_obs text, p_email text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if p_prod is null then raise exception 'Item obrigatório'; end if;
  if coalesce(p_valor, 0) <= 0 then
    delete from platform.estoque_item_preco_max where empresa = coalesce(p_empresa, 'SF') and n_cod_prod = p_prod;
    return jsonb_build_object('n_cod_prod', p_prod, 'preco_maximo', null);
  end if;
  insert into platform.estoque_item_preco_max (empresa, n_cod_prod, preco_maximo, obs, atualizado_por, atualizado_em)
  values (coalesce(p_empresa, 'SF'), p_prod, round(p_valor, 4), nullif(trim(coalesce(p_obs, '')), ''), p_email, now())
  on conflict (empresa, n_cod_prod) do update
    set preco_maximo = excluded.preco_maximo, obs = excluded.obs,
        atualizado_por = excluded.atualizado_por, atualizado_em = now();
  return jsonb_build_object('n_cod_prod', p_prod, 'preco_maximo', round(p_valor, 4));
end $$;

create or replace function orders.estoque_preco_max_ler(p_empresa text, p_prods bigint[])
returns table(n_cod_prod bigint, preco_maximo numeric, obs text, atualizado_por text, atualizado_em timestamptz)
language sql stable security definer set search_path to '' as $$
  select m.n_cod_prod, m.preco_maximo, m.obs, m.atualizado_por, m.atualizado_em
  from platform.estoque_item_preco_max m
  where m.empresa = coalesce(p_empresa, 'SF') and m.n_cod_prod = any(p_prods);
$$;

-- Dados do Estoque de vários itens (o CRM pede só os que a busca devolveu).
create or replace function orders.crm_itens_info(p_empresa text, p_prods bigint[])
returns table(n_cod_prod bigint, codigo_novo text, codigo_omie text, unidade text, cmc numeric, saldo numeric,
              ult_preco numeric, preco_maximo numeric, ativo boolean)
language sql stable security definer set search_path to '' as $$
  select coalesce(i.n_cod_prod, m.n_cod_prod), i.codigo_novo, i.codigo_omie, i.unidade, i.cmc, i.saldo, i.ult_preco, m.preco_maximo, i.ativo
  from unnest(p_prods) as x(id)
  left join orders.v_estoque_item i on i.empresa = coalesce(p_empresa, 'SF') and i.n_cod_prod = x.id
  left join platform.estoque_item_preco_max m on m.empresa = coalesce(p_empresa, 'SF') and m.n_cod_prod = x.id
  where i.n_cod_prod is not null or m.n_cod_prod is not null;
$$;

revoke all on function orders.estoque_preco_max_definir(text, bigint, numeric, text, text) from public, anon, authenticated;
revoke all on function orders.estoque_preco_max_ler(text, bigint[]) from public, anon, authenticated;
revoke all on function orders.crm_itens_info(text, bigint[]) from public, anon, authenticated;
grant execute on function orders.estoque_preco_max_definir(text, bigint, numeric, text, text) to service_role;
grant execute on function orders.estoque_preco_max_ler(text, bigint[]) to service_role;
grant execute on function orders.crm_itens_info(text, bigint[]) to service_role;
