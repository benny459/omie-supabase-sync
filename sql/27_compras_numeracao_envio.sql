-- 27 — Numeração do pedido continua a do Omie, nItemPed no casamento de NF e
--      registro de envio do pedido ao fornecedor (01/10/2026).
--
-- Benny: os pedidos agora só existem no painel, então o número segue a
-- sequência do Omie por empresa (máximo cNumero + 1, só dígitos — cabe no
-- xPed da NF-e, ≤ 15 caracteres) e o fornecedor não percebe a troca.

create table if not exists compras.numeracao (
  empresa text primary key,
  ultimo  bigint not null default 0
);
alter table compras.numeracao enable row level security;
grant all on compras.numeracao to service_role;

-- Próximo número da empresa: o maior entre o contador e qualquer número só de
-- dígitos já visto (painel ou Omie) + 1. Lock na linha da empresa: dois
-- pedidos salvos ao mesmo tempo não pegam o mesmo número.
create or replace function compras.proximo_numero(p_empresa text)
returns text language plpgsql security definer set search_path = compras, public as $$
declare v bigint;
begin
  insert into compras.numeracao (empresa, ultimo) values (p_empresa, 0) on conflict (empresa) do nothing;
  perform 1 from compras.numeracao where empresa = p_empresa for update;
  select greatest(
           (select ultimo from compras.numeracao where empresa = p_empresa),
           coalesce((select max(numero::bigint) from compras.pedidos where empresa = p_empresa and numero ~ '^\d{1,15}$'), 0),
           coalesce((select max(cnumero::bigint) from orders.pedidos_compra where empresa = p_empresa and cnumero ~ '^\d{1,15}$'), 0)
         ) + 1 into v;
  update compras.numeracao set ultimo = v where empresa = p_empresa;
  return v::text;
end $$;

create or replace function compras.conciliar_omie()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v_novos int := 0; v_atual int := 0; v_itens int := 0; v_aus int := 0; v_hist int := 0;
begin
  drop table if exists _src;
  create temp table _src on commit drop as
  with cab as (
    select distinct on (p.empresa, p.ncod_ped) p.*
      from orders.pedidos_compra p
     order by p.empresa, p.ncod_ped, p.ncod_item
  ),
  rec as (
    select empresa, id_pedido,
           max(etapa) filter (where etapa in ('40','60','80')) as etapa,
           string_agg(distinct nullif(num_nfe, ''), ', ') as nf,
           min(nullif(chave_nfe, '')) as chave,
           max(to_date(nullif(dt_rec, ''), 'DD/MM/YYYY')) filter (where recebido = 'S') as dt_rec,
           max(to_date(nullif(dt_fat, ''), 'DD/MM/YYYY')) as dt_fat
      from orders.recebimento_nfe
     where id_pedido is not null
     group by 1, 2
  ),
  tot as (
    select empresa, ncod_ped,
           sum(coalesce(nfrete, 0)) as frete, sum(coalesce(nseguro, 0)) as seguro,
           sum(coalesce(ndespesas, 0)) as outras,
           sum(coalesce(nqtde, 0) * coalesce(nval_unit, 0) - coalesce(ndesconto, 0)
               + coalesce(nvalor_ipi, 0) + coalesce(nvalor_st, 0)) as itens
      from orders.pedidos_compra group by 1, 2
  )
  select c.empresa, c.ncod_ped,
         case when c.cetapa = '20' then 'RC' else 'PC' end as tipo,
         c.cnumero as numero,
         coalesce(r.etapa, case when c.cetapa in ('10','15','20') then c.cetapa else '10' end) as etapa_omie,
         nullif(c.ncod_for, 0) as fornecedor_cod,
         replace(nullif(coalesce(nullif(k.razao_social, ''), k.nome_fantasia), ''), '&amp;', '&') as fornecedor_nome,
         nullif(k.cnpj_cpf, '') as fornecedor_cnpj,
         nullif(c.ccod_categ, '') as categoria_cod, cat.descricao as categoria_desc,
         coalesce(nullif(a.comprador, ''), cc.nome) as comprador, nullif(c.ncod_compr, 0) as comprador_cod,
         nullif(c.ncod_proj, 0) as projeto_cod, pj.nome as projeto_nome,
         nullif(c.ncod_cc, 0) as conta_cod, ccr.descricao as conta_desc,
         nullif(c.ccod_parc, '') as parcela_cod,
         to_date(nullif(c.dinc_data, ''), 'DD/MM/YYYY') as emissao,
         to_date(nullif(c.ddt_previsao, ''), 'DD/MM/YYYY') as previsao,
         nullif(c.ccontato, '') as contato, nullif(c.cnum_pedido, '') as num_pedido_fornecedor,
         nullif(c.ccontrato, '') as contrato, nullif(c.cobs, '') as obs, nullif(c.cobs_int, '') as obs_int,
         coalesce(nullif(a.pv_os_label, ''),
                  (select upper(m[1]) || m[2] from regexp_match(coalesce(c.cobs_int, '') || ' ' || coalesce(c.cobs, ''),
                                                               '(PV|OS)\s*0*(\d{3,})', 'i') as m)) as pv_os,
         r.nf, r.chave as chave_nfe, r.dt_fat as dt_faturado, r.dt_rec,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then 'aprovado'
              when a.status in ('NAO_APROVADO','REJEITADO_VALIDADE') then 'nao_aprovado'
              when a.status in ('PENDENTE','PRE_SELECAO') then 'aguardando'
              when c.cetapa = '20' then 'na'
              else 'nao_solicitada' end as aprov_status,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then coalesce(a.aprovador_email, 'Omie') end as aprov_por,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then a.aprovado_em end as aprov_em,
         a.valor_aprovado as aprov_valor,
         jsonb_strip_nulls(jsonb_build_object(
           'tipo', '9 - Sem Ocorrência de Transporte',
           'valor', nullif(t.frete, 0), 'seguro', nullif(t.seguro, 0), 'outras', nullif(t.outras, 0))) as frete,
         coalesce(nullif(c.ntotal_pedido, 0), t.itens + t.frete + t.seguro + t.outras, 0) as valor_total
    from cab c
    left join rec r              on r.empresa = c.empresa and r.id_pedido = c.ncod_ped
    left join tot t              on t.empresa = c.empresa and t.ncod_ped = c.ncod_ped
    left join approval.approvals a on a.empresa = c.empresa and a.ncod_ped = c.ncod_ped
    left join finance.clientes k on k.empresa = c.empresa and k.codigo_cliente_omie = c.ncod_for
    left join finance.categorias cat on cat.empresa = c.empresa and cat.codigo = c.ccod_categ
    left join compras.cad_compradores cc on cc.empresa = c.empresa and cc.codigo = c.ncod_compr
    left join finance.projetos pj on pj.empresa = c.empresa and pj.codigo = c.ncod_proj
    left join finance.contas_correntes ccr on ccr.empresa = c.empresa and ccr.cod_cc = c.ncod_cc;

  -- Guarda de numeração: desde 01/10/26 o painel continua a sequência do Omie.
  -- Se um pedido feito no Omie depois disso chegar com um número que o painel
  -- já usou, ele entra como "<número>-OMIE" (não colide, e o xPed das NF-e
  -- continua apontando para o pedido do painel).
  update _src s set numero = s.numero || '-OMIE'
   where exists (select 1 from compras.pedidos p where p.empresa = s.empresa and p.numero = s.numero and p.origem = 'painel');

  -- Cliente da venda de origem (PV/OS) — à parte: a view de vendas é pesada
  -- para entrar no join de cada pedido.
  alter table _src add column pv_cliente text;
  update _src s set pv_cliente = v.cliente
    from (select distinct on (empresa, label) empresa, label, cliente
            from sales.v_erp_vendas where label is not null order by empresa, label) v
   where v.empresa = s.empresa and v.label = s.pv_os;

  -- Histórico das mudanças de etapa vindas do Omie (antes do upsert, para ver o valor velho).
  insert into compras.historico (pedido_id, texto, por)
  select p.id, 'Omie: ' || coalesce(ef_old.desc_etapa, p.etapa_omie) || ' → ' || coalesce(ef_new.desc_etapa, s.etapa_omie), 'sync Omie'
    from _src s
    join compras.pedidos p on p.empresa = s.empresa and p.omie_ncod_ped = s.ncod_ped and p.origem = 'omie'
    left join orders.etapas_faturamento ef_old on ef_old.empresa = 'SF' and ef_old.cod_operacao = '21' and ef_old.cod_etapa = p.etapa_omie
    left join orders.etapas_faturamento ef_new on ef_new.empresa = 'SF' and ef_new.cod_operacao = '21' and ef_new.cod_etapa = s.etapa_omie
   where p.etapa_omie is distinct from s.etapa_omie;
  get diagnostics v_hist = row_count;

  with up as (
    insert into compras.pedidos as p (
      empresa, tipo, numero, etapa, etapa_omie, fornecedor_cod, fornecedor_nome, fornecedor_cnpj,
      categoria_cod, categoria_desc, comprador, comprador_cod, projeto_cod, projeto_nome,
      conta_cod, conta_desc, parcela_cod, emissao, previsao, contato, num_pedido_fornecedor, contrato,
      obs, obs_int, pv_os, pv_cliente, nf, chave_nfe, dt_faturado, dt_rec,
      aprov_status, aprov_por, aprov_em, aprov_valor, frete, valor_total,
      origem, omie_ncod_ped, omie_sync_status, omie_ausente, updated_by)
    select s.empresa, s.tipo, s.numero, s.etapa_omie, s.etapa_omie, s.fornecedor_cod, s.fornecedor_nome, s.fornecedor_cnpj,
           s.categoria_cod, s.categoria_desc, s.comprador, s.comprador_cod, s.projeto_cod, s.projeto_nome,
           s.conta_cod, s.conta_desc, s.parcela_cod, s.emissao, s.previsao, s.contato, s.num_pedido_fornecedor, s.contrato,
           s.obs, s.obs_int, s.pv_os, s.pv_cliente, s.nf, s.chave_nfe, s.dt_faturado, s.dt_rec,
           s.aprov_status, s.aprov_por, s.aprov_em, s.aprov_valor, s.frete, s.valor_total,
           'omie', s.ncod_ped, 'espelho', false, 'sync Omie'
      from _src s
    on conflict (empresa, omie_ncod_ped) do update set
      tipo = excluded.tipo, numero = excluded.numero,
      etapa = compras.etapa_max(excluded.etapa_omie, p.etapa_manual),
      etapa_omie = excluded.etapa_omie,
      fornecedor_cod = excluded.fornecedor_cod, fornecedor_nome = excluded.fornecedor_nome,
      fornecedor_cnpj = excluded.fornecedor_cnpj, categoria_cod = excluded.categoria_cod,
      categoria_desc = excluded.categoria_desc, comprador = excluded.comprador,
      comprador_cod = excluded.comprador_cod, projeto_cod = excluded.projeto_cod,
      projeto_nome = excluded.projeto_nome, conta_cod = excluded.conta_cod, conta_desc = excluded.conta_desc,
      parcela_cod = excluded.parcela_cod, emissao = excluded.emissao, previsao = excluded.previsao,
      contato = excluded.contato, num_pedido_fornecedor = excluded.num_pedido_fornecedor,
      contrato = excluded.contrato, obs = excluded.obs, obs_int = excluded.obs_int,
      pv_os = excluded.pv_os, pv_cliente = excluded.pv_cliente,
      -- NF registrada no painel (Focus/manual) não é apagada por um espelho sem NF
      nf = coalesce(excluded.nf, p.nf), chave_nfe = coalesce(excluded.chave_nfe, p.chave_nfe),
      dt_faturado = coalesce(excluded.dt_faturado, p.dt_faturado), dt_rec = coalesce(excluded.dt_rec, p.dt_rec),
      aprov_status = excluded.aprov_status, aprov_por = excluded.aprov_por, aprov_em = excluded.aprov_em,
      aprov_valor = excluded.aprov_valor, frete = excluded.frete, valor_total = excluded.valor_total,
      omie_ausente = false, updated_at = now(), updated_by = 'sync Omie'
    where p.origem = 'omie'
      -- só regrava o que mudou (o sync roda a cada 30 min sobre ~5 mil pedidos)
      and (p.tipo, p.numero, p.etapa_omie, p.fornecedor_cod, p.fornecedor_nome, p.categoria_cod, p.comprador,
           p.projeto_cod, p.projeto_nome, p.conta_cod, p.parcela_cod, p.emissao, p.previsao, p.contato,
           p.num_pedido_fornecedor, p.contrato, p.obs, p.obs_int, p.pv_os, p.pv_cliente, p.nf, p.chave_nfe,
           p.dt_faturado, p.dt_rec, p.aprov_status, p.aprov_em, p.valor_total, p.frete, p.omie_ausente)
          is distinct from
          (excluded.tipo, excluded.numero, excluded.etapa_omie, excluded.fornecedor_cod, excluded.fornecedor_nome,
           excluded.categoria_cod, excluded.comprador, excluded.projeto_cod, excluded.projeto_nome, excluded.conta_cod,
           excluded.parcela_cod, excluded.emissao, excluded.previsao, excluded.contato, excluded.num_pedido_fornecedor,
           excluded.contrato, excluded.obs, excluded.obs_int, excluded.pv_os, excluded.pv_cliente,
           coalesce(excluded.nf, p.nf), coalesce(excluded.chave_nfe, p.chave_nfe),
           coalesce(excluded.dt_faturado, p.dt_faturado), coalesce(excluded.dt_rec, p.dt_rec),
           excluded.aprov_status, excluded.aprov_em, excluded.valor_total, excluded.frete, false)
    returning (xmax = 0) as novo, p.id
  )
  select count(*) filter (where novo), count(*) filter (where not novo) into v_novos, v_atual from up;

  insert into compras.historico (pedido_id, texto, por)
  select p.id, 'Importado do Omie', 'sync Omie' from compras.pedidos p
   where p.origem = 'omie' and not exists (select 1 from compras.historico h where h.pedido_id = p.id);

  -- Itens: upsert por (pedido, nCodItem) e remove o que saiu do Omie.
  with it as (
    select p.id as pedido_id, c.ncod_item,
           row_number() over (partition by c.empresa, c.ncod_ped order by c.ncod_item) as seq,
           nullif(c.cproduto, '') as produto_cod, nullif(c.ncod_prod, 0) as ncod_prod,
           replace(replace(replace(coalesce(c.cdescricao, ''), '&quot;', '"'), '&amp;', '&'), '&apos;', '''') as descricao,
           nullif(c.cunidade, '') as unidade, coalesce(c.nqtde, 0) as qtd, coalesce(c.nval_unit, 0) as valor_unit,
           coalesce(c.ndesconto, 0) as desconto, coalesce(c.nvalor_ipi, 0) as ipi, coalesce(c.nvalor_st, 0) as st,
           nullif(c.cncm, '') as ncm, nullif(c.loc_estoque, '') as local_estoque, nullif(c.nqtde_rec, 0) as qtd_recebida
      from orders.pedidos_compra c
      join compras.pedidos p on p.empresa = c.empresa and p.omie_ncod_ped = c.ncod_ped and p.origem = 'omie'
     where c.ncod_item is not null
  ), ins as (
    insert into compras.itens as i (pedido_id, omie_ncod_item, seq, produto_cod, ncod_prod, descricao, unidade,
                                    qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, qtd_recebida)
    select pedido_id, ncod_item, seq, produto_cod, ncod_prod, descricao, unidade,
           qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, qtd_recebida from it
    on conflict (pedido_id, omie_ncod_item) do update set
      seq = excluded.seq, produto_cod = excluded.produto_cod, ncod_prod = excluded.ncod_prod,
      descricao = excluded.descricao, unidade = excluded.unidade, qtd = excluded.qtd,
      valor_unit = excluded.valor_unit, desconto = excluded.desconto, ipi = excluded.ipi, st = excluded.st,
      ncm = excluded.ncm, local_estoque = excluded.local_estoque,
      qtd_recebida = nullif(greatest(coalesce(excluded.qtd_recebida, 0), coalesce(i.qtd_recebida, 0)), 0)
    where (i.seq, i.produto_cod, i.descricao, i.qtd, i.valor_unit, i.desconto, i.ipi, i.st, i.qtd_recebida, i.ncm, i.local_estoque)
          is distinct from (excluded.seq, excluded.produto_cod, excluded.descricao, excluded.qtd, excluded.valor_unit,
                            excluded.desconto, excluded.ipi, excluded.st,
                            nullif(greatest(coalesce(excluded.qtd_recebida, 0), coalesce(i.qtd_recebida, 0)), 0),
                            excluded.ncm, excluded.local_estoque)
    returning 1
  )
  select count(*) into v_itens from ins;

  delete from compras.itens i
   using compras.pedidos p
   where i.pedido_id = p.id and p.origem = 'omie' and i.omie_ncod_item is not null
     and not exists (select 1 from orders.pedidos_compra c
                      where c.empresa = p.empresa and c.ncod_ped = p.omie_ncod_ped and c.ncod_item = i.omie_ncod_item);

  update compras.pedidos p set omie_ausente = true, updated_at = now()
   where p.origem = 'omie' and not p.omie_ausente
     and not exists (select 1 from _src s where s.empresa = p.empresa and s.ncod_ped = p.omie_ncod_ped);
  get diagnostics v_aus = row_count;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'itens_gravados', v_itens,
                            'ausentes', v_aus, 'historico', v_hist);
end $$;


-- Salvar e duplicar passam a numerar pela sequência do Omie.
create or replace function orders.compras_salvar(p jsonb, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_ped compras.pedidos;
  v_tipo text := coalesce(p->>'tipo', 'PC');
  v_novo boolean := v_id is null;
  v_it jsonb; v_item_id bigint; v_keep bigint[] := '{}'; v_seq int := 0;
  v_merc numeric := 0; v_frete jsonb := coalesce(p->'frete', '{}'::jsonb); v_total numeric;
begin
  if v_tipo not in ('RC', 'PC') then raise exception 'tipo inválido'; end if;
  if not v_novo then
    select * into v_ped from compras.pedidos where id = v_id for update;
    if not found then raise exception 'Pedido % não existe', v_id; end if;
    if v_ped.origem <> 'painel' then
      raise exception 'Pedido importado do Omie (histórico): só leitura';
    end if;
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_merc := v_merc + coalesce((v_it->>'qtd')::numeric, 0) * coalesce((v_it->>'vu')::numeric, 0)
              - coalesce((v_it->>'desc0')::numeric, 0) + coalesce((v_it->>'ipi')::numeric, 0) + coalesce((v_it->>'st')::numeric, 0);
  end loop;
  v_total := round(v_merc + coalesce((v_frete->>'valor')::numeric, 0) + coalesce((v_frete->>'seguro')::numeric, 0)
                   + coalesce((v_frete->>'outras')::numeric, 0), 2);

  if v_novo then
    insert into compras.pedidos (empresa, tipo, numero, etapa, origem, omie_sync_status, aprov_status, created_by, emissao)
    values (coalesce(p->>'emp', 'SF'), v_tipo, compras.proximo_numero(coalesce(p->>'emp', 'SF')),
            case when v_tipo = 'RC' then '20' else '10' end, 'painel', null,
            case when v_tipo = 'RC' then 'na' else 'nao_solicitada' end, p_uid,
            (now() at time zone 'America/Sao_Paulo')::date)
    returning * into v_ped;
    v_id := v_ped.id;
    perform compras.add_hist(v_id, case when v_tipo = 'RC' then 'Requisição incluída no painel' else 'Pedido incluído no painel' end, p_por);
    if p->>'origemDe' is not null then perform compras.add_hist(v_id, p->>'origemDe', p_por); end if;
  else
    perform compras.add_hist(v_id, coalesce(p->>'histTexto', 'Alterado'), p_por);
  end if;

  update compras.pedidos set
    tipo = v_tipo,
    fornecedor_cod = nullif(p->>'fornCod', '')::bigint, fornecedor_nome = nullif(p->>'forn', ''),
    fornecedor_cnpj = nullif(p->>'cnpj', ''),
    categoria_cod = nullif(p->>'catCod', ''), categoria_desc = nullif(p->>'cat', ''),
    comprador = nullif(p->>'comprador', ''), comprador_cod = nullif(p->>'compradorCod', '')::bigint,
    projeto_cod = nullif(p->>'projCod', '')::bigint, projeto_nome = nullif(p->>'proj', ''),
    conta_cod = nullif(p->>'contaCod', '')::bigint, conta_desc = nullif(p->>'conta', ''),
    parcela_cod = nullif(p->>'parc', ''),
    previsao = nullif(p->>'previsao', '')::date,
    contato = nullif(p->>'contato', ''), num_pedido_fornecedor = nullif(p->>'numForn', ''),
    contrato = nullif(p->>'contrato', ''), obs = nullif(p->>'obs', ''), obs_int = nullif(p->>'obsInt', ''),
    pv_os = nullif(p->>'pv', ''), pv_cliente = nullif(p->>'pvCliente', ''),
    frete = v_frete, valor_total = v_total,
    -- avanço pedido junto com o salvar (ex.: "Salvar e solicitar aprovação")
    etapa = coalesce(nullif(p->>'novaEtapa', ''), etapa),
    aprov_status = case when p->>'novaAprov' = 'aguardando' and v_tipo = 'PC' then 'aguardando'
                        when v_tipo = 'RC' then 'na'
                        when aprov_status = 'na' then 'nao_solicitada' else aprov_status end,
    updated_at = now(), updated_by = p_por
  where id = v_id;
  if p->>'novaEtapa' is not null and p->>'novaEtapa' <> coalesce(v_ped.etapa, '') and not v_novo then
    perform compras.add_hist(v_id, 'Etapa → ' || (p->>'novaEtapa'), p_por);
  end if;
  if p->>'novaAprov' = 'aguardando' then perform compras.add_hist(v_id, 'Aprovação solicitada', p_por); end if;

  -- Itens: atualiza os que vieram com id, cria os novos, apaga os que saíram.
  for v_it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    v_item_id := nullif(v_it->>'id', '')::bigint;
    if v_item_id is not null and exists (select 1 from compras.itens where id = v_item_id and pedido_id = v_id) then
      update compras.itens set seq = v_seq, produto_cod = nullif(v_it->>'cod', ''),
        ncod_prod = nullif(v_it->>'ncodProd', '')::bigint, descricao = coalesce(v_it->>'desc', ''),
        unidade = coalesce(nullif(v_it->>'un', ''), 'UN'), qtd = coalesce((v_it->>'qtd')::numeric, 0),
        valor_unit = coalesce((v_it->>'vu')::numeric, 0), desconto = coalesce((v_it->>'desc0')::numeric, 0),
        ipi = coalesce((v_it->>'ipi')::numeric, 0), st = coalesce((v_it->>'st')::numeric, 0),
        ncm = nullif(v_it->>'ncm', ''), local_estoque = nullif(v_it->>'local', ''), obs = nullif(v_it->>'obs', '')
      where id = v_item_id;
    else
      insert into compras.itens (pedido_id, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit,
                                 desconto, ipi, st, ncm, local_estoque, obs)
      values (v_id, v_seq, nullif(v_it->>'cod', ''), nullif(v_it->>'ncodProd', '')::bigint, coalesce(v_it->>'desc', ''),
              coalesce(nullif(v_it->>'un', ''), 'UN'), coalesce((v_it->>'qtd')::numeric, 0),
              coalesce((v_it->>'vu')::numeric, 0), coalesce((v_it->>'desc0')::numeric, 0),
              coalesce((v_it->>'ipi')::numeric, 0), coalesce((v_it->>'st')::numeric, 0),
              nullif(v_it->>'ncm', ''), nullif(v_it->>'local', ''), nullif(v_it->>'obs', ''))
      returning id into v_item_id;
    end if;
    v_keep := v_keep || v_item_id;
    -- vínculo com a requisição (só pedido de compra)
    delete from compras.item_rc where pc_item_id = v_item_id;
    if v_tipo = 'PC' and nullif(v_it->'rc'->>'itemId', '') is not null then
      insert into compras.item_rc (pc_item_id, rc_item_id, qtd)
      select v_item_id, ri.id, coalesce((v_it->>'qtd')::numeric, 0)
        from compras.itens ri join compras.pedidos rp on rp.id = ri.pedido_id
       where ri.id = (v_it->'rc'->>'itemId')::bigint and rp.tipo = 'RC';
    end if;
  end loop;
  delete from compras.itens where pedido_id = v_id and not (id = any (v_keep));

  delete from compras.parcelas where pedido_id = v_id;
  insert into compras.parcelas (pedido_id, n, vencimento, valor, tipo_doc)
  select v_id, row_number() over (), nullif(x->>'venc', '')::date, coalesce((x->>'valor')::numeric, 0), coalesce(x->>'doc', 'Boleto')
    from jsonb_array_elements(case when v_tipo = 'PC' then coalesce(p->'parcelas', '[]'::jsonb) else '[]'::jsonb end) x;

  delete from compras.departamentos where pedido_id = v_id;
  insert into compras.departamentos (pedido_id, departamento, perc)
  select v_id, x->>'nome', sum(coalesce((x->>'perc')::numeric, 0))
    from jsonb_array_elements(case when v_tipo = 'PC' then coalesce(p->'deptos', '[]'::jsonb) else '[]'::jsonb end) x
   where coalesce(x->>'nome', '') <> '' group by 2;

  return jsonb_build_object('id', v_id, 'num', (select numero from compras.pedidos where id = v_id));
end $$;

create or replace function orders.compras_duplicar(p_id bigint, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; v_novo bigint;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  insert into compras.pedidos (empresa, tipo, numero, etapa, fornecedor_cod, fornecedor_nome, fornecedor_cnpj,
    categoria_cod, categoria_desc, comprador, comprador_cod, projeto_cod, projeto_nome, conta_cod, conta_desc,
    parcela_cod, emissao, previsao, contato, contrato, obs, obs_int, pv_os, pv_cliente, aprov_status,
    frete, valor_total, origem, omie_sync_status, created_by, updated_by)
  values (v.empresa, v.tipo, compras.proximo_numero(v.empresa),
    case when v.tipo = 'RC' then '20' else '10' end, v.fornecedor_cod, v.fornecedor_nome, v.fornecedor_cnpj,
    v.categoria_cod, v.categoria_desc, v.comprador, v.comprador_cod, v.projeto_cod, v.projeto_nome, v.conta_cod, v.conta_desc,
    v.parcela_cod, (now() at time zone 'America/Sao_Paulo')::date, v.previsao, v.contato, v.contrato, v.obs, v.obs_int,
    v.pv_os, v.pv_cliente, case when v.tipo = 'RC' then 'na' else 'nao_solicitada' end,
    v.frete, v.valor_total, 'painel', null, p_uid, p_por)
  returning id into v_novo;
  insert into compras.itens (pedido_id, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit,
                             desconto, ipi, st, ncm, local_estoque, obs)
  select v_novo, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, obs
    from compras.itens where pedido_id = p_id;
  insert into compras.parcelas (pedido_id, n, vencimento, valor, tipo_doc)
  select v_novo, n, vencimento, valor, tipo_doc from compras.parcelas where pedido_id = p_id;
  insert into compras.departamentos (pedido_id, departamento, perc)
  select v_novo, departamento, perc from compras.departamentos where pedido_id = p_id;
  perform compras.add_hist(v_novo, 'Duplicado do ' || v.numero, p_por);
  return jsonb_build_object('id', v_novo, 'num', (select numero from compras.pedidos where id = v_novo));
end $$;

-- NF-e da Focus: traz também o nItemPed (item do nosso pedido citado na NF).
create or replace function orders.compras_nfs_do_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', v.chave, 'origem', v.origem, 'score', v.score, 'motivo', v.motivo, 'status', v.status,
           'numero', f.numero, 'emissao', f.emissao, 'valor', f.valor, 'emitente', f.emitente_nome,
           'cnpj', f.emitente_doc, 'situacao', f.situacao, 'completa', f.completa,
           'outrosPedidos', (select coalesce(jsonb_agg(p2.numero), '[]'::jsonb) from compras.nf_vinculos v2
                               join compras.pedidos p2 on p2.id = v2.pedido_id
                              where v2.chave = v.chave and v2.pedido_id <> v.pedido_id and v2.status <> 'descartado'),
           'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                        'n', i->>'numero_item', 'cod', i->>'codigo_produto', 'desc', i->>'descricao',
                        'ncm', i->>'codigo_ncm', 'un', i->>'unidade_comercial',
                        'qtd', (i->>'quantidade_comercial')::numeric, 'vu', (i->>'valor_unitario_comercial')::numeric,
                        'total', (i->>'valor_bruto')::numeric, 'xped', i->>'pedido_compra',
                        'nItemPed', i->>'numero_item_pedido_compra')), '[]'::jsonb)
                       from jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) i)
         ) order by (v.status = 'confirmado') desc, v.score desc, f.emissao desc), '[]'::jsonb)
    from compras.nf_vinculos v
    join orders.focus_recebidos f on f.tipo = 'nfe' and f.chave = v.chave
   where v.pedido_id = p_id and v.status <> 'descartado'
$$;

-- Registro no histórico do pedido (envio ao fornecedor etc.).
create or replace function orders.compras_registrar(p_id bigint, p_texto text, p_por text)
returns void language sql security definer set search_path = compras, public as $$
  insert into compras.historico (pedido_id, texto, por) values (p_id, p_texto, p_por)
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or n.nspname = 'compras' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
