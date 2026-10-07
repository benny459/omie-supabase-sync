-- 07/10/26 (Benny, PV1970): a NF-e só sai com código do NOSSO estoque.
-- Antes, fat_itens_validar aceitava o código antigo do Omie (ex.: 3020030)
-- quando ele já tinha item nosso (FE0019) — a nota saía com o código antigo.
-- Agora: o resolvedor troca o código antigo pelo nosso (vínculo OU código
-- antigo do Omie) e a validação só aceita o código atual do estoque.

create or replace function orders.fat_itens_resolver(p_empresa text, p_codigos text[])
returns table(codigo text, codigo_nativo text, n_cod_prod bigint, descricao text)
language sql stable security definer set search_path to ''
as $$
  select distinct on (upper(c)) c, codigo_nativo, n_cod_prod, descricao from (
    -- vínculo manual (código de compra → item nosso)
    select trim(c) c, k.codigo codigo_nativo, k.n_cod_prod, i.descricao, 1 pri, v.criado_em
      from unnest(p_codigos) c
      join platform.estoque_item_vinculo v on v.empresa = p_empresa and v.desfeito_em is null and upper(v.codigo_origem) = upper(trim(c))
      join platform.estoque_item_codigo k on k.empresa = p_empresa and k.atual and k.n_cod_prod = orders.estoque_item_nativo(p_empresa, v.n_cod_prod_destino)
      left join orders.v_estoque_item i on i.empresa = p_empresa and i.n_cod_prod = k.n_cod_prod
    union all
    -- código antigo (Omie ou anterior) de um item que já é nosso
    select trim(c), k.codigo, k.n_cod_prod, r.descricao_atual, 2, null
      from unnest(p_codigos) c
      join platform.v_item_codigo_resolvido r on r.empresa = p_empresa and upper(r.codigo_usado) = upper(trim(c)) and r.codigo_novo_atual is not null
      join platform.estoque_item_codigo k on k.empresa = p_empresa and k.atual and upper(k.codigo) = upper(r.codigo_novo_atual)
  ) x
  where nullif(c, '') is not null
    and not exists (select 1 from platform.estoque_item_codigo z where z.empresa = p_empresa and z.atual and upper(z.codigo) = upper(c))
  order by upper(c), pri, criado_em desc nulls last
$$;

create or replace function orders.fat_itens_validar(p_empresa text, p_codigos text[])
returns jsonb
language sql stable security definer set search_path to 'platform', 'orders', 'public'
as $$
  select coalesce(jsonb_agg(distinct c), '[]'::jsonb) from unnest(p_codigos) c
  where nullif(trim(c), '') is not null
    and not exists (select 1 from platform.estoque_item_codigo k where k.empresa = p_empresa and k.atual and upper(k.codigo) = upper(trim(c)))
$$;
