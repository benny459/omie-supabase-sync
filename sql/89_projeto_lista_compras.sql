-- 06/10/26 — Lista de materiais do projeto ligada às compras.
-- • rc_projetos_itens ganha un, data_necessaria e o vínculo por ITEM:
--   rc_item_id (linha da RC gerada da lista) e pc_item_id (linha do PC casada
--   automaticamente), com via/score para conferência.
-- • compras.pedidos/itens já trazem os PCs nativos E os do Omie (espelho), então
--   o vínculo e o acompanhamento usam só eles.
-- • rc_projetos_compras(): situação de cada linha (RC/PC/recebido/NF), itens de
--   PC "fora da lista", totais (estimado × budget × comprometido × pago) e fluxo
--   mensal (planejado × comprometido × pago).
-- • rc_projetos_autolink(): casa linhas da lista com itens de PC do projeto —
--   código igual primeiro, depois descrição parecida (pg_trgm).
alter table approval.rc_projetos_itens
  add column if not exists un text,
  add column if not exists data_necessaria date,
  add column if not exists rc_item_id bigint,
  add column if not exists pc_item_id bigint,
  add column if not exists vinculo_via text,
  add column if not exists vinculo_score numeric,
  add column if not exists vinculo_em timestamptz;
create index if not exists rc_projetos_itens_rc_item on approval.rc_projetos_itens (rc_item_id) where rc_item_id is not null;
create index if not exists rc_projetos_itens_pc_item on approval.rc_projetos_itens (pc_item_id) where pc_item_id is not null;

create or replace function approval._norm_item(t text) returns text
language sql immutable set search_path = '' as $$
  select trim(regexp_replace(lower(public.unaccent(coalesce(t, ''))), '[^a-z0-9/.,x]+', ' ', 'g'))
$$;

-- Itens de PC do projeto (nativos e espelho do Omie, não cancelados).
-- Números/medidas da descrição (1.1/2, 3/4, 32, 1,0 → 1): casamento automático
-- por descrição só quando as medidas batem — "abraçadeira 1.1/2" ≠ "2.1/2".
create or replace function approval._nums(t text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct v order by v), '{}')
    from (select case when m[1] ~ '^[0-9]+[.,][0-9]+$'
                      then trim(trailing '.' from trim(trailing '0' from replace(m[1], ',', '.')))
                      when m[1] ~ '^[0-9]+$' then ltrim(m[1], '0')
                      else replace(m[1], ',', '.') end v
            from regexp_matches(lower(coalesce(t, '')), '([0-9]+(?:[.,][0-9]+)*(?:/[0-9]+)?)', 'g') m) x
$$;

create or replace function approval._projeto_pc_itens(p_empresa text, p_projeto bigint)
returns table (pc_item_id bigint, pedido_id bigint, numero text, origem text, fornecedor text,
               etapa text, aprov text, previsao date, nf text, produto_cod text, descricao text,
               unidade text, qtd numeric, valor_unit numeric, valor numeric, qtd_recebida numeric)
language sql stable security definer set search_path = '' as $$
  select i.id, p.id, p.numero, p.origem, p.fornecedor_nome, p.etapa, p.aprov_status, p.previsao, p.nf,
         i.produto_cod, i.descricao, i.unidade, i.qtd, i.valor_unit,
         round(coalesce(i.qtd, 0) * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0) + coalesce(i.ipi, 0) + coalesce(i.st, 0), 2),
         i.qtd_recebida
    from compras.pedidos p join compras.itens i on i.pedido_id = p.id
   where p.empresa = p_empresa and p.projeto_cod = p_projeto and p.tipo = 'PC'
     and not p.cancelado and not coalesce(p.omie_ausente, false)
$$;

create or replace function approval.rc_projetos_autolink(p_empresa text, p_projeto bigint, p_aplicar boolean default false,
                                                         p_por text default null, p_min_auto numeric default 0.6)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; n int := 0; r record;
begin
  -- itens de PC já usados por algum vínculo (direto ou pela RC da lista)
  create temp table if not exists _alk_usados (pc_item_id bigint) on commit drop;
  truncate _alk_usados;
  insert into _alk_usados
    select l.pc_item_id from approval.rc_projetos_itens l
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and l.pc_item_id is not null
    union
    select ir.pc_item_id from approval.rc_projetos_itens l join compras.item_rc ir on ir.rc_item_id = l.rc_item_id
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto;

  create temp table if not exists _alk_cand (lista_id uuid, pc_item_id bigint, via text, score numeric, medidas_ok boolean) on commit drop;
  truncate _alk_cand;
  insert into _alk_cand
  select l.id, c.pc_item_id,
         case when nullif(lower(trim(l.cat_codigo)), '') = lower(trim(c.produto_cod)) then 'codigo' else 'descricao' end,
         case when nullif(lower(trim(l.cat_codigo)), '') = lower(trim(c.produto_cod)) then 1
              else round(public.similarity(approval._norm_item(l.item || ' ' || coalesce(l.modelo, '')), approval._norm_item(c.descricao))::numeric, 3) end,
         approval._nums(l.item || ' ' || coalesce(l.modelo, '')) = approval._nums(c.descricao)
    from approval.rc_projetos_itens l
    cross join approval._projeto_pc_itens(p_empresa, p_projeto) c
   where l.empresa = p_empresa and l.codigo_projeto = p_projeto
     and l.rc_item_id is null and l.pc_item_id is null and nullif(trim(l.pc_numero), '') is null
     and not exists (select 1 from _alk_usados u where u.pc_item_id = c.pc_item_id)
     and (nullif(lower(trim(l.cat_codigo)), '') = lower(trim(c.produto_cod))
          or public.similarity(approval._norm_item(l.item || ' ' || coalesce(l.modelo, '')), approval._norm_item(c.descricao)) >= 0.4);

  -- guloso: maior score primeiro, um item de PC por linha e vice-versa
  create temp table if not exists _alk_esc (lista_id uuid, pc_item_id bigint, via text, score numeric, medidas_ok boolean) on commit drop;
  truncate _alk_esc;
  for r in select * from _alk_cand order by (via = 'codigo') desc, medidas_ok desc, score desc, lista_id loop
    if not exists (select 1 from _alk_esc e where e.lista_id = r.lista_id or e.pc_item_id = r.pc_item_id) then
      insert into _alk_esc values (r.lista_id, r.pc_item_id, r.via, r.score, r.medidas_ok);
    end if;
  end loop;

  if p_aplicar then
    update approval.rc_projetos_itens l
       set pc_item_id = e.pc_item_id, vinculo_via = e.via, vinculo_score = e.score, vinculo_em = now(),
           pc_numero = c.numero, atualizado_em = now(), atualizado_por = coalesce(p_por, 'auto')
      from _alk_esc e join approval._projeto_pc_itens(p_empresa, p_projeto) c on c.pc_item_id = e.pc_item_id
     where l.id = e.lista_id and (e.via = 'codigo' or (e.score >= p_min_auto and e.medidas_ok));
    get diagnostics n = row_count;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('lista_id', e.lista_id, 'item', l.item, 'pc', c.numero, 'pc_item_id', e.pc_item_id,
           'desc_pc', c.descricao, 'via', e.via, 'score', e.score, 'medidas_ok', e.medidas_ok,
           'auto', e.via = 'codigo' or (e.score >= p_min_auto and e.medidas_ok), 'aplicado', p_aplicar and (e.via = 'codigo' or (e.score >= p_min_auto and e.medidas_ok)))
           order by e.score desc), '[]'::jsonb)
    into v
    from _alk_esc e join approval.rc_projetos_itens l on l.id = e.lista_id
    join approval._projeto_pc_itens(p_empresa, p_projeto) c on c.pc_item_id = e.pc_item_id;
  return jsonb_build_object('aplicados', n, 'casamentos', v);
end $$;

create or replace function approval.rc_projetos_compras(p_empresa text, p_projeto bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_itens jsonb; v_fora jsonb; v_tot jsonb; v_fluxo jsonb;
begin
  with pc as (select * from approval._projeto_pc_itens(p_empresa, p_projeto)),
  lig as (  -- (linha da lista, item de PC) por qualquer caminho
    select l.id lista_id, ir.pc_item_id, 'rc'::text via from approval.rc_projetos_itens l
      join compras.item_rc ir on ir.rc_item_id = l.rc_item_id
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto
    union
    select l.id, l.pc_item_id, coalesce(l.vinculo_via, 'manual') from approval.rc_projetos_itens l
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and l.pc_item_id is not null
  ),
  porlinha as (
    select g.lista_id, jsonb_agg(jsonb_build_object('pc', c.numero, 'pedido_id', c.pedido_id, 'origem', c.origem,
             'fornecedor', c.fornecedor, 'etapa', c.etapa, 'aprov', c.aprov, 'previsao', c.previsao, 'nf', c.nf,
             'qtd', c.qtd, 'valor_unit', c.valor_unit, 'valor', c.valor, 'qtd_recebida', c.qtd_recebida, 'via', g.via)
             order by c.numero) pcs,
           sum(c.valor) valor_pc
      from lig g join pc c on c.pc_item_id = g.pc_item_id group by g.lista_id
  ),
  legado as (  -- vínculo antigo só pelo nº do PC (sem item)
    select l.id lista_id, jsonb_agg(distinct jsonb_build_object('pc', p.numero, 'pedido_id', p.id, 'origem', p.origem,
             'fornecedor', p.fornecedor_nome, 'etapa', p.etapa, 'aprov', p.aprov_status, 'previsao', p.previsao, 'nf', p.nf, 'via', 'pedido')) pcs
      from approval.rc_projetos_itens l
      join compras.pedidos p on p.empresa = l.empresa and p.tipo = 'PC' and not p.cancelado
                            and p.numero = any (string_to_array(regexp_replace(l.pc_numero, '\s', '', 'g'), ','))
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and nullif(trim(l.pc_numero), '') is not null
       and l.pc_item_id is null and l.rc_item_id is null
     group by l.id
  ),
  rc as (
    select l.id lista_id, p.numero rc_numero from approval.rc_projetos_itens l
      join compras.itens i on i.id = l.rc_item_id join compras.pedidos p on p.id = i.pedido_id and not p.cancelado
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'equipamento', l.equipamento, 'item', l.item, 'modelo', l.modelo, 'qtd', l.qtd, 'un', l.un,
           'codigo', l.cat_codigo, 'custo', l.cat_valor_unit, 'fornecedor', l.cat_fornecedor,
           'data_necessaria', l.data_necessaria, 'estimado', round(coalesce(l.qtd, 0) * coalesce(l.cat_valor_unit, 0), 2),
           'rc', r.rc_numero, 'vinculo_via', l.vinculo_via, 'vinculo_score', l.vinculo_score,
           'pcs', coalesce(pl.pcs, lg.pcs, '[]'::jsonb), 'valor_pc', pl.valor_pc)
           order by l.equipamento, l.item), '[]'::jsonb)
    into v_itens
    from approval.rc_projetos_itens l
    left join porlinha pl on pl.lista_id = l.id
    left join legado lg on lg.lista_id = l.id
    left join rc r on r.lista_id = l.id
   where l.empresa = p_empresa and l.codigo_projeto = p_projeto;

  -- itens de PC do projeto que nenhuma linha da lista cobre
  with pc as (select * from approval._projeto_pc_itens(p_empresa, p_projeto)),
  cobertos as (
    select ir.pc_item_id from approval.rc_projetos_itens l join compras.item_rc ir on ir.rc_item_id = l.rc_item_id
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto
    union select l.pc_item_id from approval.rc_projetos_itens l
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and l.pc_item_id is not null
  ),
  pcs_legado as (
    select distinct unnest(string_to_array(regexp_replace(l.pc_numero, '\s', '', 'g'), ',')) numero
      from approval.rc_projetos_itens l
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and nullif(trim(l.pc_numero), '') is not null
       and l.pc_item_id is null and l.rc_item_id is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('pc_item_id', c.pc_item_id, 'pc', c.numero, 'fornecedor', c.fornecedor,
           'descricao', c.descricao, 'codigo', c.produto_cod, 'qtd', c.qtd, 'valor', c.valor, 'previsao', c.previsao)
           order by c.numero, c.descricao), '[]'::jsonb)
    into v_fora
    from pc c
   where not exists (select 1 from cobertos k where k.pc_item_id = c.pc_item_id)
     and not exists (select 1 from pcs_legado g where g.numero = c.numero);

  select jsonb_build_object(
    'estimado', (select coalesce(sum(coalesce(qtd, 0) * coalesce(cat_valor_unit, 0)), 0) from approval.rc_projetos_itens
                  where empresa = p_empresa and codigo_projeto = p_projeto),
    'comprometido', (select coalesce(sum(valor), 0) from approval._projeto_pc_itens(p_empresa, p_projeto)),
    -- pago = saídas realizadas do projeto (mesma fonte do fluxo: bi.projeto_realizado_mensal)
    'pago', (select coalesce(sum(r.saida_realizada), 0) from bi.projeto_realizado_mensal(p_projeto, array[p_empresa]) r),
    'budget_lista', (select valor_budget from approval.rc_projetos_budget where empresa = p_empresa and codigo_projeto = p_projeto),
    'budget_plano', (select custo_materiais from approval.projeto_plano where empresa = p_empresa and codigo_projeto = p_projeto),
    'venda', (select coalesce(valor_fechado, valor_venda) from approval.projeto_plano where empresa = p_empresa and codigo_projeto = p_projeto),
    'margem_plano', (select margem_valor from approval.projeto_plano where empresa = p_empresa and codigo_projeto = p_projeto)
  ) into v_tot;

  -- fluxo mensal: planejado (linhas ainda sem PC, pela data necessária),
  -- comprometido (parcelas dos PCs do projeto) e pago (saídas realizadas do projeto)
  with plan as (
    select date_trunc('month', l.data_necessaria)::date mes, sum(coalesce(l.qtd, 0) * coalesce(l.cat_valor_unit, 0)) v
      from approval.rc_projetos_itens l
     where l.empresa = p_empresa and l.codigo_projeto = p_projeto and l.rc_item_id is null and l.pc_item_id is null
       and nullif(trim(l.pc_numero), '') is null
     group by 1
  ),
  comp as (
    select date_trunc('month', coalesce(pa.vencimento, p.previsao, p.emissao))::date mes,
           sum(coalesce(pa.valor, p.valor_total)) v
      from compras.pedidos p left join compras.parcelas pa on pa.pedido_id = p.id
     where p.empresa = p_empresa and p.projeto_cod = p_projeto and p.tipo = 'PC' and not p.cancelado
       and not coalesce(p.omie_ausente, false)
     group by 1
  ),
  pago as (
    select r.mes, r.saida_realizada v from bi.projeto_realizado_mensal(p_projeto, array[p_empresa]) r
  ),
  meses as (select mes from plan union select mes from comp union select mes from pago)
  select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'planejado', coalesce(a.v, 0), 'comprometido', coalesce(c.v, 0),
           'pago', coalesce(g.v, 0)) order by m.mes nulls first), '[]'::jsonb)
    into v_fluxo
    from meses m left join plan a on a.mes is not distinct from m.mes
    left join comp c on c.mes is not distinct from m.mes left join pago g on g.mes is not distinct from m.mes;

  return jsonb_build_object('itens', v_itens, 'fora_da_lista', v_fora, 'totais', v_tot, 'fluxo', v_fluxo);
end $$;

revoke all on function approval.rc_projetos_compras(text, bigint) from public, anon, authenticated;
revoke all on function approval.rc_projetos_autolink(text, bigint, boolean, text, numeric) from public, anon, authenticated;
revoke all on function approval._projeto_pc_itens(text, bigint) from public, anon, authenticated;
grant execute on function approval.rc_projetos_compras(text, bigint) to service_role;
grant execute on function approval.rc_projetos_autolink(text, bigint, boolean, text, numeric) to service_role;
grant execute on function approval._projeto_pc_itens(text, bigint) to service_role;

-- Depois de gravar um PC (compras-server.posGravar): casa os itens dele com a
-- lista do projeto, se houver lista.
create or replace function approval.rc_projetos_autolink_pc(p_pedido_id bigint, p_por text default 'auto (PC)')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e text; pj bigint;
begin
  select p.empresa, p.projeto_cod into e, pj from compras.pedidos p where p.id = p_pedido_id and p.tipo = 'PC';
  if pj is null then return jsonb_build_object('ok', true, 'sem_projeto', true); end if;
  if not exists (select 1 from approval.rc_projetos_itens where empresa = e and codigo_projeto = pj) then
    return jsonb_build_object('ok', true, 'sem_lista', true);
  end if;
  return approval.rc_projetos_autolink(e, pj, true, p_por);
end $$;
revoke all on function approval.rc_projetos_autolink_pc(bigint, text) from public, anon, authenticated;
grant execute on function approval.rc_projetos_autolink_pc(bigint, text) to service_role;

-- A grade lê un/data_necessaria e o vínculo por item.
create or replace view approval.v_rc_projetos_itens as
 WITH pc_status AS (
         SELECT DISTINCT ON (v.empresa, COALESCE(v.pc_numero, v.pc_numero_manual)) v.empresa,
            COALESCE(v.pc_numero, v.pc_numero_manual) AS pc_key,
            v.pc_etapa_texto, v.mt_status_fornecimento, v.dt_previsao, v.nova_prev_materiais, v.mt_data_recebimento_nf,
            v.nome_fornecedor, v.valor_total, v.pc_forma_pagamento, v.prazo_entrega_dias, v.dt_inclusao
           FROM approval.v_pc_completo_enriched v
          WHERE ((v.pc_numero IS NOT NULL) OR (v.pc_numero_manual IS NOT NULL))
          ORDER BY v.empresa, COALESCE(v.pc_numero, v.pc_numero_manual), v.mt_data_recebimento_nf DESC NULLS LAST
        )
 SELECT i.id, i.empresa, i.codigo_projeto, i.equipamento, i.item, i.qtd, i.modelo, i.observacao, i.pc_numero,
    s.mt_status_fornecimento AS status_fornec, s.pc_etapa_texto, s.pc_etapa_texto AS pc_etapa_code,
    s.dt_previsao, s.nova_prev_materiais, (s.mt_data_recebimento_nf)::text AS mt_data_recebimento_nf,
    s.nome_fornecedor, s.valor_total AS pc_valor_total, s.pc_forma_pagamento, s.prazo_entrega_dias,
    s.dt_inclusao AS pc_dt_inclusao, i.criado_em, i.criado_por, i.atualizado_em, i.atualizado_por,
    i.cat_ncod_prod, i.cat_codigo, i.cat_valor_unit, i.cat_fornecedor, i.cat_entrega_dias, i.cat_fat_dias,
    i.un, i.data_necessaria, i.rc_item_id, i.pc_item_id, i.vinculo_via, i.vinculo_score
   FROM (approval.rc_projetos_itens i
     LEFT JOIN pc_status s ON (((s.empresa = i.empresa) AND (s.pc_key = i.pc_numero))));
