-- 37 — De-para de itens: nome do fornecedor ↔ nosso item (decisão do Benny, 01/10/2026).
--
-- A NF do fornecedor chama o material de outro jeito (cProd/xProd dele), mas é o
-- mesmo item do nosso cadastro. Na CONFERÊNCIA (e ao casar NF↔PC) a pessoa
-- confirma "na NF: <xProd> (cód. fornecedor X) → nosso item: <descrição>" e o
-- par fica gravado aqui, por fornecedor. Usos:
--   1. conferência: cada linha da NF já vem com o nosso item sugerido pelo de-para;
--   2. casamento automático NF↔PC e "Gerar pedido a partir da NF": o de-para
--      conhecido vem antes (exato por fornecedor + cProd; sem cProd, pelo xProd);
--   3. Estoque: compras.v_item_aliases / GET /api/compras/aliases?n_cod_prod=
--      ("Como os fornecedores chamam este item").
-- Movimento de estoque é sempre do NOSSO item (ncod_prod); a qtd da NF vira a
-- nossa multiplicando por `fator` (ex.: NF em CX com 12 UN → fator 12).

create table if not exists compras.item_fornecedor_alias (
  id              bigserial primary key,
  empresa         text not null default 'SF',
  fornecedor_cnpj text not null,
  fornecedor_cod  bigint,
  fornecedor_nome text,
  chave_forn      text not null,           -- cProd do fornecedor; sem cProd: 'x:' || xProd normalizado
  cprod           text,
  xprod           text not null,
  ncm             text,
  unidade_forn    text,
  fator           numeric not null default 1 check (fator > 0),
  ncod_prod       bigint not null,
  produto_cod     text,
  descricao       text,
  unidade         text,
  confirmado_por  text not null,
  confirmado_em   timestamptz not null default now(),
  pedido_id       bigint,
  pedido_numero   text,
  nf_chave        text,
  nf_numero       text,
  vezes           int not null default 1,
  created_at      timestamptz not null default now(),
  unique (empresa, fornecedor_cnpj, chave_forn)
);
create index if not exists item_alias_prod on compras.item_fornecedor_alias (ncod_prod);
alter table compras.item_fornecedor_alias enable row level security;
revoke all on compras.item_fornecedor_alias from public, anon, authenticated;
grant all on compras.item_fornecedor_alias to service_role;
grant usage, select on sequence compras.item_fornecedor_alias_id_seq to service_role;

create or replace function compras.alias_chave(p_cprod text, p_xprod text)
returns text language sql immutable as $$
  select case when coalesce(trim(p_cprod), '') <> '' then upper(trim(p_cprod))
              else 'x:' || upper(regexp_replace(trim(coalesce(p_xprod, '')), '\s+', ' ', 'g')) end
$$;

-- De-para conhecido para um item da NF (exato por fornecedor + cProd; senão pelo xProd).
create or replace function compras.alias_de(p_empresa text, p_cnpj text, p_cprod text, p_xprod text)
returns compras.item_fornecedor_alias language sql stable security definer set search_path = compras, public as $$
  select a.* from compras.item_fornecedor_alias a
   where a.empresa = p_empresa and a.fornecedor_cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
     and (a.chave_forn = compras.alias_chave(p_cprod, p_xprod)
          or (coalesce(trim(p_cprod), '') <> '' and a.chave_forn = compras.alias_chave(null, p_xprod)))
   order by (a.chave_forn = compras.alias_chave(p_cprod, p_xprod)) desc, a.confirmado_em desc
   limit 1
$$;

-- Grava/atualiza um de-para (conferência ou casamento).
create or replace function orders.compras_alias_salvar(p jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v_cnpj text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g'); v_id bigint; v_ped compras.pedidos;
begin
  if v_cnpj = '' then raise exception 'De-para precisa do CNPJ do fornecedor'; end if;
  if nullif(p->>'ncodProd', '') is null then raise exception 'Escolha o nosso item'; end if;
  if coalesce(p->>'xprod', '') = '' and coalesce(p->>'cprod', '') = '' then raise exception 'Item da NF sem código nem descrição'; end if;
  select * into v_ped from compras.pedidos where id = nullif(p->>'pedidoId', '')::bigint;
  insert into compras.item_fornecedor_alias as a (empresa, fornecedor_cnpj, fornecedor_cod, fornecedor_nome, chave_forn, cprod, xprod,
      ncm, unidade_forn, fator, ncod_prod, produto_cod, descricao, unidade, confirmado_por, pedido_id, pedido_numero, nf_chave, nf_numero)
  values (coalesce(p->>'emp', v_ped.empresa, 'SF'), v_cnpj, coalesce(nullif(p->>'fornCod', '')::bigint, v_ped.fornecedor_cod),
      coalesce(p->>'forn', v_ped.fornecedor_nome), compras.alias_chave(p->>'cprod', p->>'xprod'), nullif(trim(p->>'cprod'), ''),
      coalesce(nullif(p->>'xprod', ''), p->>'cprod'), nullif(p->>'ncm', ''), nullif(upper(trim(p->>'unForn')), ''),
      coalesce(nullif(p->>'fator', '')::numeric, 1), (p->>'ncodProd')::bigint, nullif(p->>'cod', ''), nullif(p->>'desc', ''),
      nullif(upper(trim(p->>'un')), ''), p_por, v_ped.id, v_ped.numero, nullif(p->>'chave', ''), nullif(p->>'nf', ''))
  on conflict (empresa, fornecedor_cnpj, chave_forn) do update set
      fornecedor_cod = coalesce(excluded.fornecedor_cod, a.fornecedor_cod), fornecedor_nome = coalesce(excluded.fornecedor_nome, a.fornecedor_nome),
      cprod = coalesce(excluded.cprod, a.cprod), xprod = excluded.xprod, ncm = coalesce(excluded.ncm, a.ncm),
      unidade_forn = coalesce(excluded.unidade_forn, a.unidade_forn), fator = excluded.fator,
      ncod_prod = excluded.ncod_prod, produto_cod = excluded.produto_cod, descricao = excluded.descricao, unidade = excluded.unidade,
      confirmado_por = excluded.confirmado_por, confirmado_em = now(),
      pedido_id = coalesce(excluded.pedido_id, a.pedido_id), pedido_numero = coalesce(excluded.pedido_numero, a.pedido_numero),
      nf_chave = coalesce(excluded.nf_chave, a.nf_chave), nf_numero = coalesce(excluded.nf_numero, a.nf_numero),
      vezes = a.vezes + case when excluded.nf_chave is distinct from a.nf_chave then 1 else 0 end
  returning id into v_id;
  if v_ped.id is not null then
    perform compras.add_hist(v_ped.id, 'De-para: "' || coalesce(nullif(p->>'xprod', ''), p->>'cprod') || '"'
      || case when coalesce(p->>'cprod', '') <> '' then ' (cód. fornecedor ' || (p->>'cprod') || ')' else '' end
      || ' = ' || coalesce(nullif(p->>'desc', ''), p->>'ncodProd')
      || case when coalesce(nullif(p->>'fator', '')::numeric, 1) <> 1 then ' · fator ' || (p->>'fator') else '' end, p_por);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Itens das NF casadas com o pedido, com o nosso item sugerido (de-para → item
-- do PC parecido → mesma posição) — tela de Conferência.
create or replace function orders.compras_conferencia_dados(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  with p as (select * from compras.pedidos where id = p_id),
  pit as (select i.*, row_number() over (order by i.seq) as pos from compras.itens i where i.pedido_id = p_id),
  nfi as (
    select fr.chave, coalesce(nullif(ltrim(fr.numero, '0'), ''), substr(fr.chave, 26, 9)) as nf, fr.empresa,
           regexp_replace(coalesce(fr.emitente_doc, ''), '\D', '', 'g') as cnpj,
           i, o
      from compras.nf_vinculos v
      join orders.focus_recebidos fr on fr.tipo = 'nfe' and fr.chave = v.chave
      cross join lateral jsonb_array_elements(coalesce(fr.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) with ordinality t(i, o)
     where v.pedido_id = p_id and v.status = 'confirmado'
  )
  select jsonb_build_object(
    'pedido', (select jsonb_build_object('id', id, 'num', numero, 'forn', fornecedor_nome, 'cnpj', fornecedor_cnpj, 'fornCod', fornecedor_cod,
                                          'etapa', etapa, 'aprov', aprov_status, 'emp', empresa) from p),
    'itensPc', (select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'ncodProd', ncod_prod, 'cod', produto_cod, 'desc', descricao,
                                  'un', unidade, 'qtd', qtd, 'qtdRec', qtd_recebida, 'vu', valor_unit) order by seq), '[]'::jsonb) from pit),
    'itensNf', (select coalesce(jsonb_agg(jsonb_build_object(
        'chave', n.chave, 'nf', n.nf, 'n', coalesce(n.i->>'numero_item', n.o::text),
        'cprod', n.i->>'codigo_produto', 'xprod', n.i->>'descricao', 'ncm', n.i->>'codigo_ncm',
        'un', upper(coalesce(n.i->>'unidade_comercial', '')), 'qtd', nullif(n.i->>'quantidade_comercial', '')::numeric,
        'vu', nullif(n.i->>'valor_unitario_comercial', '')::numeric, 'total', nullif(n.i->>'valor_bruto', '')::numeric,
        'alias', (select jsonb_build_object('ncodProd', a.ncod_prod, 'cod', a.produto_cod, 'desc', a.descricao, 'fator', a.fator,
                                            'por', a.confirmado_por, 'em', a.confirmado_em, 'pc', a.pedido_numero, 'vezes', a.vezes)
                    from compras.alias_de(n.empresa, n.cnpj, n.i->>'codigo_produto', n.i->>'descricao') a where a.id is not null),
        'sugestao', (select jsonb_build_object('ncodProd', x.ncod_prod, 'cod', x.produto_cod, 'desc', x.descricao, 'un', x.unidade, 'como', x.como)
                       from (select pit.ncod_prod, pit.produto_cod, pit.descricao, pit.unidade, 'parecido' as como,
                                    public.similarity(lower(pit.descricao), lower(n.i->>'descricao')) as s
                               from pit where pit.ncod_prod is not null
                             union all
                             select pit.ncod_prod, pit.produto_cod, pit.descricao, pit.unidade, 'mesma posição', 0.01
                               from pit where pit.pos = n.o and pit.ncod_prod is not null
                             order by s desc limit 1) x)
      ) order by n.chave, n.o), '[]'::jsonb) from nfi n)
  )
$$;

-- Estoque: "Como os fornecedores chamam este item".
create or replace view compras.v_item_aliases as
select a.ncod_prod, a.produto_cod, a.descricao as nosso_item, a.empresa, a.fornecedor_cnpj, a.fornecedor_cod, a.fornecedor_nome,
       a.cprod as codigo_fornecedor, a.xprod as nome_na_nf, a.ncm, a.unidade_forn, a.fator, a.unidade,
       a.confirmado_por, a.confirmado_em, a.pedido_numero, a.nf_numero, a.nf_chave, a.vezes
  from compras.item_fornecedor_alias a;
revoke all on compras.v_item_aliases from public, anon, authenticated;
grant select on compras.v_item_aliases to service_role;

create or replace function orders.compras_aliases(p_ncod_prod bigint default null, p_cod text default null, p_cnpj text default null)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(to_jsonb(v) order by v.confirmado_em desc), '[]'::jsonb)
    from compras.v_item_aliases v
   where (p_ncod_prod is null or v.ncod_prod = p_ncod_prod)
     and (p_cod is null or v.produto_cod = p_cod)
     and (p_cnpj is null or v.fornecedor_cnpj = regexp_replace(p_cnpj, '\D', '', 'g'))
     and (p_ncod_prod is not null or p_cod is not null or p_cnpj is not null)
$$;

-- "Gerar pedido a partir da NF" usa o de-para antes do catálogo (qtd × fator, valor ÷ fator).
create or replace function compras.pc_da_nf(p_chave text)
returns jsonb language plpgsql stable security definer set search_path = compras, public as $$
declare f orders.focus_recebidos; r jsonb; v_cnpj text; v_forn record; v_ult record; v_itens jsonb; v_parc jsonb;
begin
  select * into f from orders.focus_recebidos where tipo = 'nfe' and chave = p_chave;
  if not found then raise exception 'NF-e não encontrada na Focus'; end if;
  r := f.detalhe->'requisicao_nota_fiscal';
  if r is null or jsonb_typeof(r->'itens') <> 'array' or jsonb_array_length(r->'itens') = 0 then
    raise exception 'A NF-e % ainda não tem o XML completo na Focus (só resumo) — não dá para montar os itens', coalesce(ltrim(f.numero, '0'), '');
  end if;
  v_cnpj := regexp_replace(coalesce(f.emitente_doc, r->>'cnpj_emitente', ''), '\D', '', 'g');

  select k.codigo_cliente_omie as cod, replace(coalesce(nullif(k.razao_social, ''), k.nome_fantasia), '&amp;', '&') as nome
    into v_forn
    from finance.clientes k
   where k.empresa = f.empresa and regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g') = v_cnpj and v_cnpj <> ''
   order by (coalesce(k.inativo, 'N') <> 'S') desc, (coalesce(k.tags, '') ilike '%fornecedor%') desc
   limit 1;

  -- padrões do último pedido do mesmo fornecedor (categoria e conta corrente)
  select p.categoria_cod, p.categoria_desc, p.conta_cod, p.conta_desc into v_ult
    from compras.pedidos p
   where p.empresa = f.empresa and p.tipo = 'PC' and not p.cancelado and p.categoria_cod is not null
     and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = v_cnpj and v_cnpj <> ''
   order by p.emissao desc nulls last, p.id desc limit 1;

  select jsonb_agg(jsonb_build_object(
           'desc', coalesce(al.descricao, c.descricao, i->>'descricao'), 'descNf', i->>'descricao',
           'cod', coalesce(al.produto_cod, c.codigo), 'ncodProd', coalesce(al.ncod_prod, c.ncod_prod),
           'casado', coalesce(al.ncod_prod, c.ncod_prod) is not null, 'deAlias', al.id is not null,
           'codForn', i->>'codigo_produto', 'ncm', nullif(i->>'codigo_ncm', ''),
           'un', coalesce(al.unidade, nullif(upper(trim(i->>'unidade_comercial')), ''), 'UN'),
           'qtd', coalesce(nullif(i->>'quantidade_comercial', '')::numeric, 1) * coalesce(al.fator, 1),
           'vu', round(coalesce(nullif(i->>'valor_unitario_comercial', '')::numeric,
                          nullif(i->>'valor_bruto', '')::numeric / greatest(coalesce(nullif(i->>'quantidade_comercial', '')::numeric, 1), 0.0001))
                 / coalesce(al.fator, 1), 6),
           'desc0', coalesce(nullif(i->>'valor_desconto', '')::numeric, 0),
           'ipi', coalesce(nullif(i->>'ipi_valor', '')::numeric, 0),
           'st', coalesce(nullif(i->>'icms_valor_st', '')::numeric, 0) + coalesce(nullif(i->>'fcp_valor_st', '')::numeric, 0),
           'obs', 'NF-e ' || coalesce(ltrim(f.numero, '0'), '') || ' item ' || coalesce(i->>'numero_item', o::text)
             || case when coalesce(i->>'codigo_produto', '') <> '' then ' · cód. fornecedor ' || (i->>'codigo_produto') else '' end
         ) order by o)
    into v_itens
    from jsonb_array_elements(r->'itens') with ordinality t(i, o)
    -- de-para conhecido do fornecedor vem antes do catálogo (sql/37)
    left join lateral (select x.* from compras.alias_de(f.empresa, v_cnpj, i->>'codigo_produto', i->>'descricao') x where x.id is not null) al on true
    left join lateral (
      select m.ncod_prod, m.codigo, m.descricao
        from orders.mv_catalogo_compra m
       where al.id is null and (upper(trim(m.descricao)) = upper(trim(i->>'descricao'))
          or (public.similarity(lower(i->>'descricao'), lower(m.descricao)) >= 0.8
              and orders.medidas(i->>'descricao') <@ orders.medidas(m.descricao)))
       order by (upper(trim(m.descricao)) = upper(trim(i->>'descricao'))) desc,
                public.similarity(lower(i->>'descricao'), lower(m.descricao)) desc, m.qtd_compras desc nulls last
       limit 1) c on true;

  -- parcelas: duplicatas da NF; sem duplicata, uma parcela à vista na emissão
  select jsonb_agg(jsonb_build_object('venc', d->>'data_vencimento', 'valor', (d->>'valor')::numeric, 'doc', 'Boleto') order by d->>'data_vencimento')
    into v_parc
    from jsonb_array_elements(coalesce(r->'duplicatas', '[]'::jsonb)) d
   where coalesce(d->>'valor', '') <> '';
  if v_parc is null then
    v_parc := jsonb_build_array(jsonb_build_object('venc', (f.emissao at time zone 'America/Sao_Paulo')::date,
                                                   'valor', coalesce(f.valor, nullif(r->>'valor_total', '')::numeric), 'doc', 'Boleto'));
  end if;

  return jsonb_build_object(
    'chave', f.chave, 'numero', coalesce(nullif(ltrim(f.numero, '0'), ''), substr(f.chave, 26, 9)),
    'emp', f.empresa, 'emissao', (f.emissao at time zone 'America/Sao_Paulo')::date, 'valorNf', f.valor,
    'forn', coalesce(v_forn.nome, f.emitente_nome), 'fornCod', v_forn.cod, 'fornCadastrado', v_forn.cod is not null,
    'cnpj', v_cnpj, 'catCod', v_ult.categoria_cod, 'cat', v_ult.categoria_desc,
    'contaCod', v_ult.conta_cod, 'conta', v_ult.conta_desc,
    'frete', jsonb_build_object('valor', coalesce(nullif(r->>'valor_frete', '')::numeric, 0),
                                'seguro', coalesce(nullif(r->>'valor_seguro', '')::numeric, 0),
                                'outras', coalesce(nullif(r->>'valor_outras_despesas', '')::numeric, 0)),
    'itens', coalesce(v_itens, '[]'::jsonb), 'parcelas', v_parc);
end $$;


-- Casamento automático NF↔PC: de-para conhecido antes de fornecedor+valor.
create or replace function compras.casar_auto()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare r record; n_xped int := 0; n_valor int := 0;
begin
  -- a) xPed = número do pedido, mesmo fornecedor
  for r in
    select v.chave, v.pedido_id from compras.nf_vinculos v
      join compras.pedidos p on p.id = v.pedido_id
     where v.status = 'sugerido' and v.origem = 'xped' and v.score >= 1
       and p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado' and p.etapa in ('10', '15')
       and not exists (select 1 from compras.nf_vinculos c where c.chave = v.chave and c.status = 'confirmado')
  loop
    perform compras.ligar_nf(r.chave, r.pedido_id, 'automático', 'casada automaticamente por xPed');
    n_xped := n_xped + 1;
  end loop;

  -- a2) de-para conhecido (sql/37): todos os itens da NF têm de-para do
  --     fornecedor e um único PC aprovado em aberto desse fornecedor tem esses itens
  for r in
    with nfs as (
      select f.chave, f.empresa, regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g') as cnpj,
             array_agg(al.ncod_prod) as prods, bool_and(al.id is not null) as todos
        from orders.focus_recebidos f
        cross join lateral jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) t(i)
        left join lateral (select x.* from compras.alias_de(f.empresa, f.emitente_doc, t.i->>'codigo_produto', t.i->>'descricao') x
                            where x.id is not null) al on true
       where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada')
         and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.status = 'confirmado')
         and exists (select 1 from compras.item_fornecedor_alias a2
                      where a2.fornecedor_cnpj = regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g'))
       group by 1, 2, 3
    ), cand as (
      select n.chave, p.id as pedido_id, count(*) over (partition by n.chave) as k
        from nfs n
        join compras.pedidos p on p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado'
                              and p.etapa in ('10', '15') and p.empresa = n.empresa
                              and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj
       where n.todos
         and n.prods <@ (select array_agg(i.ncod_prod) from compras.itens i where i.pedido_id = p.id and i.ncod_prod is not null)
         and not exists (select 1 from compras.nf_vinculos c where c.chave = n.chave and c.pedido_id = p.id and c.status = 'descartado')
    )
    select chave, pedido_id from cand where k = 1
  loop
    perform compras.ligar_nf(r.chave, r.pedido_id, 'automático', 'casada automaticamente pelo de-para de itens');
    n_valor := n_valor + 1;
  end loop;

  -- b) fornecedor + valor (±1%) + janela de datas, pedido único
  for r in
    with cand as (
      select f.chave, p.id as pedido_id,
             count(*) over (partition by f.chave) as n
        from orders.focus_recebidos f
        join compras.pedidos p on p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado'
                              and p.etapa in ('10', '15') and p.empresa = f.empresa
                              and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g')
                              and abs(p.valor_total - f.valor) <= greatest(0.01 * f.valor, 0.05)
                              and f.emissao::date between p.emissao and p.emissao + 120
       where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada')
         and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.status in ('confirmado'))
         and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.pedido_id = p.id and c.status = 'descartado')
    )
    select chave, pedido_id from cand where n = 1
  loop
    perform compras.ligar_nf(r.chave, r.pedido_id, 'automático', 'casada automaticamente por fornecedor e valor');
    n_valor := n_valor + 1;
  end loop;
  return jsonb_build_object('por_xped', n_xped, 'por_valor', n_valor);
end $$;


do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname in ('compras_alias_salvar', 'compras_conferencia_dados', 'compras_aliases'))
               or (n.nspname = 'compras' and p.proname in ('alias_chave', 'alias_de', 'pc_da_nf', 'casar_auto')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
