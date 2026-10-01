-- 28 — Etapa "Enviado ao fornecedor", saldo da requisição (fracionamento) e
--      vínculo de requisição à venda editável (01/10/2026, decisões do Benny).
--
--   · Etapas: Requisição → Pedido de Compra → Aprovação → Enviado ao
--     fornecedor (35, nova) → Faturado → Recebido → Conferido. O pedido vai
--     para 35 quando é enviado pelo modal de e-mail ou marcado "enviado"
--     (WhatsApp etc.); guarda quando, por quem e para quem. O histórico do
--     Omie não tem essa etapa (segue pela NF, como antes).
--   · Requisição fracionada: o cartão mostra só o saldo (itens/qtd ainda a
--     comprar, valor = saldo) e sai da coluna quando o saldo zera.
--   · Venda (PV/OS) da requisição pode ser vinculada/trocada depois — inclusive
--     nas que vieram do Omie (pv_os_painel tem precedência sobre o do espelho).

alter table compras.pedidos drop constraint if exists pedidos_etapa_check;
alter table compras.pedidos add constraint pedidos_etapa_check check (etapa in ('20','10','15','35','40','60','80'));
alter table compras.pedidos add column if not exists enviado_em   timestamptz;
alter table compras.pedidos add column if not exists enviado_por  text;
alter table compras.pedidos add column if not exists enviado_para text;
alter table compras.pedidos add column if not exists enviado_meio text;
alter table compras.pedidos add column if not exists pv_os_painel      text;
alter table compras.pedidos add column if not exists pv_cliente_painel text;

create or replace function compras.etapa_ordem(e text) returns int
language sql immutable as $$
  select coalesce(array_position(array['20','10','15','35','40','60','80'], e), 0)
$$;

create or replace function orders.compras_lista(p_desde date default null)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  with base as (
    select p.* from compras.pedidos p
     where not p.cancelado and not p.omie_ausente
       and (p_desde is null or p.origem = 'painel' or p.emissao is null or p.emissao >= p_desde)
  ),
  it as (
    select i.pedido_id, count(*) as n,
           left(string_agg(i.descricao || ' ' || coalesce(i.produto_cod, ''), ' | ' order by i.seq), 300) as busca
      from compras.itens i join base b on b.id = i.pedido_id group by 1
  ),
  rcs_do_pc as (
    select pi.pedido_id, array_agg(distinct rp.numero) as rcs
      from compras.item_rc l
      join compras.itens pi on pi.id = l.pc_item_id
      join compras.itens ri on ri.id = l.rc_item_id
      join compras.pedidos rp on rp.id = ri.pedido_id
     group by 1
  ),
  cob_item as (
    select ri.pedido_id, ri.id, ri.qtd, ri.valor_unit,
           coalesce(sum(l.qtd) filter (where pp.id is not null), 0) as cov
      from compras.itens ri
      join base rp on rp.id = ri.pedido_id and rp.tipo = 'RC'
      left join compras.item_rc l on l.rc_item_id = ri.id
      left join compras.itens pi on pi.id = l.pc_item_id
      left join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
     group by 1, 2, 3, 4
  ),
  cob as (
    select pedido_id, count(*) as total, count(*) filter (where qtd > 0 and cov >= qtd) as done,
           round(sum(greatest(qtd - cov, 0) * valor_unit), 2) as saldo,
           count(*) filter (where cov > 0 and cov < qtd) as parciais
      from cob_item group by 1
  ),
  cob_pcs as (
    select ri.pedido_id, array_agg(distinct pp.numero) as pcs
      from compras.item_rc l
      join compras.itens ri on ri.id = l.rc_item_id
      join compras.itens pi on pi.id = l.pc_item_id
      join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'tipo', b.tipo, 'num', b.numero, 'etapa', b.etapa, 'emp', b.empresa,
    'forn', b.fornecedor_nome, 'fornCod', b.fornecedor_cod, 'cnpj', b.fornecedor_cnpj,
    'proj', b.projeto_nome, 'emissao', b.emissao, 'previsao', b.previsao,
    'cat', b.categoria_desc, 'comprador', b.comprador, 'contato', b.contato,
    'parc', b.parcela_cod, 'conta', b.conta_desc, 'numForn', b.num_pedido_fornecedor,
    'contrato', b.contrato, 'nf', b.nf, 'dtRec', b.dt_rec, 'dtFat', b.dt_faturado,
    'pv', coalesce(b.pv_os_painel, b.pv_os), 'pvCliente', coalesce(b.pv_cliente_painel, b.pv_cliente),
    'obsInt', left(b.obs_int, 200),
    'enviadoEm', b.enviado_em, 'enviadoPara', b.enviado_para, 'enviadoMeio', b.enviado_meio,
    'valor', round(b.valor_total, 2), 'nItens', coalesce(it.n, 0), 'busca', it.busca,
    'aprov', b.aprov_status, 'aprovPor', b.aprov_por, 'aprovEm', b.aprov_em,
    'origem', b.origem, 'sync', b.omie_sync_status) || jsonb_build_object(
    'rcs', r.rcs,
    'cobDone', case when b.tipo = 'RC' then coalesce(c.done, 0) end,
    'cobTotal', case when b.tipo = 'RC' then coalesce(c.total, 0) end,
    'cobPcs', cp.pcs,
    'saldo', case when b.tipo = 'RC' then coalesce(c.saldo, round(b.valor_total, 2)) end,
    'parciais', case when b.tipo = 'RC' then c.parciais end
  )) order by b.emissao desc nulls last, b.id desc), '[]'::jsonb)
    from base b
    left join it on it.pedido_id = b.id
    left join rcs_do_pc r on r.pedido_id = b.id
    left join cob c on c.pedido_id = b.id
    left join cob_pcs cp on cp.pedido_id = b.id
$$;

create or replace function orders.compras_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object(
    'id', p.id, 'tipo', p.tipo, 'num', p.numero, 'etapa', p.etapa, 'emp', p.empresa,
    'etapaOmie', p.etapa_omie, 'cancelado', p.cancelado,
    'forn', p.fornecedor_nome, 'fornCod', p.fornecedor_cod, 'cnpj', p.fornecedor_cnpj,
    'catCod', p.categoria_cod, 'cat', p.categoria_desc, 'comprador', p.comprador, 'compradorCod', p.comprador_cod,
    'projCod', p.projeto_cod, 'proj', p.projeto_nome, 'contaCod', p.conta_cod, 'conta', p.conta_desc,
    'parc', p.parcela_cod, 'emissao', p.emissao, 'previsao', p.previsao, 'contato', p.contato,
    'numForn', p.num_pedido_fornecedor, 'contrato', p.contrato, 'obs', p.obs, 'obsInt', p.obs_int,
    'pv', coalesce(p.pv_os_painel, p.pv_os), 'pvCliente', coalesce(p.pv_cliente_painel, p.pv_cliente),
    'nf', p.nf, 'chave', p.chave_nfe, 'criadoEm', p.created_at,
    'enviadoEm', p.enviado_em, 'enviadoPor', p.enviado_por, 'enviadoPara', p.enviado_para, 'enviadoMeio', p.enviado_meio,
    -- pedidos de compra que atendem itens desta requisição
    'pcsDaRc', (select coalesce(jsonb_agg(distinct pp.numero), '[]'::jsonb) from compras.itens ri
                  join compras.item_rc l on l.rc_item_id = ri.id join compras.itens pi on pi.id = l.pc_item_id
                  join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado where ri.pedido_id = p.id),
    'dtFat', p.dt_faturado, 'dtRec', p.dt_rec,
    'aprov', p.aprov_status, 'aprovPor', p.aprov_por, 'aprovEm', p.aprov_em, 'aprovValor', p.aprov_valor,
    'frete', p.frete, 'valor', p.valor_total, 'origem', p.origem, 'ncodPed', p.omie_ncod_ped,
    'sync', p.omie_sync_status) || jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'seq', i.seq, 'cod', i.produto_cod, 'ncodProd', i.ncod_prod, 'desc', i.descricao,
        'un', i.unidade, 'qtd', i.qtd, 'vu', i.valor_unit, 'desc0', i.desconto, 'ipi', i.ipi, 'st', i.st,
        'ncm', i.ncm, 'local', i.local_estoque, 'obs', i.obs, 'rec', i.qtd_recebida,
        -- item de pedido: a que linha de requisição atende
        'rc', (select jsonb_build_object('itemId', ri.id, 'num', rp.numero, 'idx', ri.seq, 'desc', ri.descricao, 'qtd', ri.qtd)
                 from compras.item_rc l join compras.itens ri on ri.id = l.rc_item_id
                 join compras.pedidos rp on rp.id = ri.pedido_id
                where l.pc_item_id = i.id limit 1),
        -- item de requisição: quanto já está em pedidos (sem contar cancelados)
        'cov', (select coalesce(sum(l.qtd), 0) from compras.item_rc l
                  join compras.itens pi on pi.id = l.pc_item_id
                  join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                 where l.rc_item_id = i.id)
      ) order by i.seq, i.id) from compras.itens i where i.pedido_id = p.id), '[]'::jsonb),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'venc', x.vencimento, 'valor', x.valor, 'doc', x.tipo_doc) order by x.n)
                            from compras.parcelas x where x.pedido_id = p.id), '[]'::jsonb),
    'deptos', coalesce((select jsonb_agg(jsonb_build_object('nome', d.departamento, 'perc', d.perc) order by d.departamento)
                          from compras.departamentos d where d.pedido_id = p.id), '[]'::jsonb),
    'hist', coalesce((select jsonb_agg(jsonb_build_object('t', h.texto, 'em', h.em, 'por', h.por) order by h.em, h.id)
                        from compras.historico h where h.pedido_id = p.id), '[]'::jsonb)
  )
  from compras.pedidos p where p.id = p_id
$$;

-- Marcar como enviado ao fornecedor (e-mail pelo painel, WhatsApp, etc.).
create or replace function orders.compras_marcar_enviado(p_id bigint, p_para text, p_meio text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; v_nova text;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if v.tipo <> 'PC' then raise exception 'Só pedido de compra é enviado ao fornecedor'; end if;
  if v.origem = 'painel' and v.aprov_status <> 'aprovado' then
    raise exception 'Pedido ainda não aprovado — aprove antes de enviar ao fornecedor';
  end if;
  update compras.pedidos set
    enviado_em = now(), enviado_por = p_por, enviado_para = nullif(p_para, ''), enviado_meio = p_meio,
    etapa = case when origem = 'painel' then (case when compras.etapa_ordem(etapa) < compras.etapa_ordem('35') then '35' else etapa end)
                 else compras.etapa_max(etapa, '35') end,
    etapa_manual = case when origem = 'omie' then compras.etapa_max(etapa_manual, '35') else etapa_manual end,
    updated_at = now(), updated_by = p_por
  where id = p_id returning etapa into v_nova;
  perform compras.add_hist(p_id, 'Enviado ao fornecedor' || case p_meio when 'email' then ' por e-mail' when 'whatsapp' then ' por WhatsApp' else '' end
                                 || coalesce(' para ' || nullif(p_para, ''), ''), p_por);
  return jsonb_build_object('id', p_id, 'etapa', v_nova);
end $$;

-- Vincular (ou trocar) a venda de origem de uma requisição/pedido.
create or replace function orders.compras_vincular_venda(p_id bigint, p_pv text, p_cliente text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if v.origem = 'painel' then
    update compras.pedidos set pv_os = nullif(p_pv, ''), pv_cliente = nullif(p_cliente, ''), updated_at = now(), updated_by = p_por where id = p_id;
  else
    update compras.pedidos set pv_os_painel = nullif(p_pv, ''), pv_cliente_painel = nullif(p_cliente, ''), updated_at = now(), updated_by = p_por where id = p_id;
  end if;
  perform compras.add_hist(p_id, case when coalesce(p_pv, '') = '' then 'Venda de origem removida' else 'Venda de origem: ' || p_pv end, p_por);
  return jsonb_build_object('id', p_id, 'pv', nullif(p_pv, ''));
end $$;

-- Casamento de NF considera também pedidos já enviados ao fornecedor.
create or replace function compras.casar_nfs_focus()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare n_ref int := 0; n_res int := 0;
begin
  -- NF-e autorizadas, com os números de pedido citados (itens + texto).
  drop table if exists _nf;
  create temp table _nf on commit drop as
  select f.chave, f.empresa, regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g') as cnpj_emit,
         f.emitente_nome, f.valor, f.emissao::date as emissao, f.numero,
         (select array_agg(distinct upper(t))
            from (select (regexp_matches(coalesce(i->>'pedido_compra', ''), '(P\d{4,}|\d{3,})', 'gi'))[1] as t
                    from jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) i) z
           where t is not null) as refs_item,
         (select array_agg(distinct upper(m[2]))
            from regexp_matches(coalesce(f.detalhe->'requisicao_nota_fiscal'->>'informacoes_adicionais_contribuinte', ''),
                                '(pedido de compra|pedido|ped\.?|pc)\s*(?:n[º°o.]*\s*)?[:#-]?\s*(P\d{4,}|\d{3,})', 'gi') as m) as refs_texto
    from orders.focus_recebidos f
   where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada');

  -- 1 e 2: referência explícita ao número do pedido.
  with ref as (
    select n.chave, 'xped'::text as origem, r as numero from _nf n, unnest(n.refs_item) r
    union
    select n.chave, 'texto', r from _nf n, unnest(n.refs_texto) r
  ), cand as (
    select distinct on (ref.chave, p.id) ref.chave, p.id as pedido_id, ref.origem,
           case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit then 1.0 else 0.7 end as score,
           case when ref.origem = 'xped' then 'Pedido citado no item da NF' else 'Pedido citado nas informações da NF' end
             || case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                     then ' · mesmo fornecedor' else ' · fornecedor diferente do pedido' end as motivo
      from ref join _nf n on n.chave = ref.chave
      join compras.pedidos p on p.empresa = n.empresa and upper(p.numero) = ref.numero and p.tipo = 'PC' and not p.cancelado
     order by ref.chave, p.id, ref.origem desc
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, origem, score, motivo from cand
  on conflict (chave, pedido_id) do update set
    origem = excluded.origem, score = greatest(compras.nf_vinculos.score, excluded.score), motivo = excluded.motivo
  where compras.nf_vinculos.status = 'sugerido';
  get diagnostics n_ref = row_count;

  -- 3: sem referência, pelo resumo (fornecedor + valor + data) — só para
  -- pedidos ainda não recebidos e NF que não casou por referência.
  with cand as (
    select n.chave, p.id as pedido_id,
           round(greatest(0.2, 0.9 - least(1, abs(p.valor_total - n.valor) / nullif(n.valor, 0)) * 2), 2) as score,
           'Mesmo fornecedor · valor ' ||
             case when abs(p.valor_total - n.valor) <= 0.05 then 'igual'
                  else to_char(abs(p.valor_total - n.valor) / nullif(n.valor, 0) * 100, 'FM990D0') || '% diferente' end
             || ' · pedido de ' || to_char(p.emissao, 'DD/MM/YY') as motivo,
           row_number() over (partition by n.chave order by abs(p.valor_total - n.valor), p.emissao desc) as rk
      from _nf n
      join compras.pedidos p on p.empresa = n.empresa and p.tipo = 'PC' and not p.cancelado and not p.omie_ausente
                            and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                            and p.etapa in ('10', '15', '35', '40') and p.nf is null
                            and p.emissao between n.emissao - 120 and n.emissao + 5
     where not exists (select 1 from compras.nf_vinculos v where v.chave = n.chave and v.origem <> 'resumo')
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, 'resumo', score, motivo from cand where rk <= 5
  on conflict (chave, pedido_id) do nothing;
  get diagnostics n_res = row_count;

  return jsonb_build_object('nfs', (select count(*) from _nf), 'por_referencia', n_ref, 'por_resumo', n_res);
end $$;

create or replace function orders.compras_nfs_sugeridas()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  -- só pedidos que ainda esperam NF (não recebidos e sem essa chave já lançada)
  select coalesce(jsonb_object_agg(pedido_id, n), '{}'::jsonb)
    from (select v.pedido_id, count(*) n
            from compras.nf_vinculos v join compras.pedidos p on p.id = v.pedido_id
           where v.status = 'sugerido' and p.etapa in ('10', '15', '35', '40') and not p.cancelado
             and p.chave_nfe is distinct from v.chave
           group by 1) z
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or n.nspname = 'compras' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
