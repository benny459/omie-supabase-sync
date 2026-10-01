-- 35 — "Gerar pedido a partir da NF" (decisão do Benny, 01/10/2026).
--
-- NF-e que chegou sem pedido pode virar um pedido de compra do painel:
--   · fornecedor, itens (código/descrição/NCM/qtd/valor/desconto/IPI/ST),
--     totais e parcelas (duplicatas da NF; sem duplicata, à vista na emissão)
--     vêm do detalhe da Focus; item casa com o catálogo quando dá, senão fica
--     a descrição da NF;
--   · categoria escolhida no diálogo (padrão: a do último pedido do
--     fornecedor), projeto opcional, numeração normal;
--   · nasce PENDENTE (aguardando aprovação), já casado com a NF;
--   · aprovado → vai direto para "Faturado pelo fornecedor";
--   · cancelado ou não aprovado → a NF volta para "NF sem pedido".
-- Enquanto o pedido não é aprovado, o título da NF no Contas a Pagar mostra
-- "⛔ aguardando aprovação do pedido — não pagar".

alter table compras.pedidos add column if not exists gerado_da_nf text;
alter table compras.nf_vinculos drop constraint if exists nf_vinculos_origem_check;
alter table compras.nf_vinculos add constraint nf_vinculos_origem_check check (origem in ('xped', 'texto', 'resumo', 'gerado'));
create index if not exists pedidos_gerado_da_nf on compras.pedidos (gerado_da_nf) where gerado_da_nf is not null;

-- Monta o pedido a partir da NF (sem gravar): usado na prévia do diálogo e no gerar.
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
           'desc', coalesce(c.descricao, i->>'descricao'), 'descNf', i->>'descricao',
           'cod', c.codigo, 'ncodProd', c.ncod_prod, 'casado', c.ncod_prod is not null,
           'codForn', i->>'codigo_produto', 'ncm', nullif(i->>'codigo_ncm', ''),
           'un', coalesce(nullif(upper(trim(i->>'unidade_comercial')), ''), 'UN'),
           'qtd', coalesce(nullif(i->>'quantidade_comercial', '')::numeric, 1),
           'vu', coalesce(nullif(i->>'valor_unitario_comercial', '')::numeric,
                          nullif(i->>'valor_bruto', '')::numeric / greatest(coalesce(nullif(i->>'quantidade_comercial', '')::numeric, 1), 0.0001)),
           'desc0', coalesce(nullif(i->>'valor_desconto', '')::numeric, 0),
           'ipi', coalesce(nullif(i->>'ipi_valor', '')::numeric, 0),
           'st', coalesce(nullif(i->>'icms_valor_st', '')::numeric, 0) + coalesce(nullif(i->>'fcp_valor_st', '')::numeric, 0),
           'obs', 'NF-e ' || coalesce(ltrim(f.numero, '0'), '') || ' item ' || coalesce(i->>'numero_item', o::text)
             || case when coalesce(i->>'codigo_produto', '') <> '' then ' · cód. fornecedor ' || (i->>'codigo_produto') else '' end
         ) order by o)
    into v_itens
    from jsonb_array_elements(r->'itens') with ordinality t(i, o)
    left join lateral (
      select m.ncod_prod, m.codigo, m.descricao
        from orders.mv_catalogo_compra m
       where upper(trim(m.descricao)) = upper(trim(i->>'descricao'))
          or (public.similarity(lower(i->>'descricao'), lower(m.descricao)) >= 0.8
              and orders.medidas(i->>'descricao') <@ orders.medidas(m.descricao))
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

create or replace function orders.compras_pc_da_nf_previa(p_chave text)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select compras.pc_da_nf(p_chave)
$$;

create or replace function orders.compras_gerar_pc_da_nf(p_chave text, p_cat_cod text, p_cat text,
                                                          p_proj_cod text, p_proj text, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare d jsonb; v_r jsonb; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('compras_pc_da_nf:' || p_chave));
  if not exists (select 1 from compras.v_nf_sem_pedido where chave = p_chave) then
    raise exception 'Esta NF-e não está mais em "NF sem pedido" (já foi casada, dispensada ou já tem pedido gerado)';
  end if;
  if coalesce(p_cat_cod, '') = '' then raise exception 'Escolha a categoria do pedido'; end if;
  d := compras.pc_da_nf(p_chave);

  v_r := orders.compras_salvar(jsonb_build_object(
    'tipo', 'PC', 'emp', d->>'emp',
    'forn', d->>'forn', 'fornCod', d->>'fornCod', 'cnpj', d->>'cnpj',
    'catCod', p_cat_cod, 'cat', p_cat, 'projCod', nullif(p_proj_cod, ''), 'proj', nullif(p_proj, ''),
    'contaCod', d->>'contaCod', 'conta', d->>'conta',
    'previsao', d->>'emissao', 'numForn', null,
    'obsInt', 'Gerado da NF-e ' || (d->>'numero') || ' (' || p_chave || ')',
    'frete', d->'frete', 'itens', d->'itens', 'parcelas', d->'parcelas',
    'novaAprov', 'aguardando',
    'origemDe', 'Pedido gerado a partir da NF-e ' || (d->>'numero') || ' por ' || p_por
  ), p_por, p_uid);
  v_id := (v_r->>'id')::bigint;

  -- já casado com a NF, mas fica na coluna Pedido de Compra (pendente) até aprovar
  update compras.pedidos set gerado_da_nf = p_chave, nf = d->>'numero', chave_nfe = p_chave,
         dt_faturado = (d->>'emissao')::date
   where id = v_id;
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo, status, decidido_por, decidido_em)
  values (p_chave, v_id, 'gerado', 1, 'gerado da NF', 'confirmado', p_por, now())
  on conflict (chave, pedido_id) do update set status = 'confirmado', motivo = 'gerado da NF', origem = 'gerado',
    decidido_por = p_por, decidido_em = now();
  perform compras.add_hist(v_id, 'Casado com a NF-e ' || (d->>'numero') || ' — aguarda aprovação para seguir a Faturado', p_por);
  return jsonb_build_object('id', v_id, 'num', v_r->>'num', 'itens', jsonb_array_length(d->'itens'),
                            'casados', (select count(*) from jsonb_array_elements(d->'itens') x where (x->>'casado')::boolean));
end $$;

-- Aprovação / cancelamento / reprovação do pedido gerado da NF.
create or replace function compras.tg_pc_da_nf()
returns trigger language plpgsql security definer set search_path = compras, public as $$
declare v_num text := coalesce(new.nf, '');
begin
  if new.gerado_da_nf is null then return new; end if;
  -- cancelado ou não aprovado: a NF volta para "NF sem pedido"
  if (new.cancelado and not old.cancelado)
     or (new.aprov_status = 'nao_aprovado' and old.aprov_status is distinct from 'nao_aprovado') then
    update compras.nf_vinculos set status = 'descartado', decidido_por = new.updated_by, decidido_em = now()
     where chave = new.gerado_da_nf and pedido_id = new.id and status = 'confirmado';
    new.chave_nfe := null; new.nf := null; new.dt_faturado := null;
    if new.etapa in ('40') then new.etapa := '10'; end if;
    insert into compras.historico (pedido_id, texto, por)
    values (new.id, 'NF-e ' || v_num || ' voltou para "NF sem pedido" (' ||
            case when new.cancelado then 'pedido cancelado' else 'pedido não aprovado' end || ')', new.updated_by);
    return new;
  end if;
  -- aprovado: segue direto para Faturado (a NF já chegou)
  if new.aprov_status = 'aprovado' and old.aprov_status is distinct from 'aprovado' and not new.cancelado then
    if not exists (select 1 from compras.nf_vinculos where chave = new.gerado_da_nf and status = 'confirmado' and pedido_id <> new.id)
       and not exists (select 1 from compras.nf_dispensadas where chave = new.gerado_da_nf) then
      insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo, status, decidido_por, decidido_em)
      values (new.gerado_da_nf, new.id, 'gerado', 1, 'gerado da NF', 'confirmado', new.aprov_por, now())
      on conflict (chave, pedido_id) do update set status = 'confirmado';
      select coalesce(nullif(ltrim(numero, '0'), ''), substr(chave, 26, 9)), (emissao at time zone 'America/Sao_Paulo')::date
        into new.nf, new.dt_faturado from orders.focus_recebidos where tipo = 'nfe' and chave = new.gerado_da_nf;
      new.chave_nfe := new.gerado_da_nf;
      if new.etapa in ('10', '15', '35') then new.etapa := '40'; end if;
      insert into compras.historico (pedido_id, texto, por)
      values (new.id, 'Aprovado com a NF-e ' || coalesce(new.nf, '') || ' já recebida — segue direto para Faturado pelo fornecedor', new.aprov_por);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pc_da_nf on compras.pedidos;
create trigger pc_da_nf before update of aprov_status, cancelado on compras.pedidos
  for each row when (new.gerado_da_nf is not null) execute function compras.tg_pc_da_nf();

-- NF casada com pedido do painel que ainda não foi aprovado → "aguardando aprovação"
create or replace function orders.compras_nf_sem_pedido_resumo()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object('n', count(*), 'valor', coalesce(sum(valor), 0),
           'nfs', coalesce(jsonb_agg(jsonb_build_object('cnpj', regexp_replace(coalesce(emitente_doc, ''), '\D', '', 'g'),
                     'numero', coalesce(nullif(ltrim(numero, '0'), ''), ltrim(substr(chave, 26, 9), '0')), 'chave', chave)), '[]'::jsonb),
           'aguardando', (
             select coalesce(jsonb_agg(distinct jsonb_build_object('cnpj', regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g'),
                      'numero', coalesce(nullif(ltrim(f.numero, '0'), ''), ltrim(substr(f.chave, 26, 9), '0')), 'chave', f.chave,
                      'pedido', p.numero)), '[]'::jsonb)
               from compras.nf_vinculos v
               join compras.pedidos p on p.id = v.pedido_id
               join orders.focus_recebidos f on f.tipo = 'nfe' and f.chave = v.chave
              where v.status = 'confirmado' and p.origem = 'painel' and not p.cancelado and p.aprov_status <> 'aprovado'))
    from compras.v_nf_sem_pedido
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname in ('compras_pc_da_nf_previa', 'compras_gerar_pc_da_nf', 'compras_nf_sem_pedido_resumo'))
               or (n.nspname = 'compras' and p.proname in ('pc_da_nf', 'tg_pc_da_nf')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
