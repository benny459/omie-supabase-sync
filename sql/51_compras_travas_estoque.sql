-- 51 — Compras: travas de vínculo, avisos e entrada de estoque nativa (05/10/2026)
--
-- (a) PC do painel exige vínculo: cada item ligado a item de RC, ou o pedido
--     marcado "sem RC" com motivo (vai a aprovação, como o PC gerado da NF);
--     e ligado a PV/OS, ou marcado "compra avulsa" (estoque/uso interno) com
--     motivo. Vale ao gravar (incluir/alterar) e ao aprovar/solicitar
--     aprovação de PC criado a partir da data em compras.config
--     'regras_vinculo_desde' — pedidos antigos não mudam.
-- (b) Aviso de RC nova: contagem "nova desde a última visita" por pessoa
--     (compras.rc_vistas) + aviso por Webex uma vez por RC (compras.rc_avisos).
-- (c) PC criado no Omie depois de 01/10/2026 (a regra é PC só no painel):
--     lista/contagem na tela + aviso por Webex uma vez por PC.
-- (d) Entrada de estoque ao Conferir (etapa 80) PC do painel, por item
--     (de-para → item de estoque), CMC médio ponderado; desfeita ao sair de 80
--     ou cancelar. Enquanto o Omie ainda recebe as NF de entrada (estoque
--     vem do sync dele), a entrada fica em modo SOMBRA: registada em
--     compras.estoque_entradas, sem mexer no saldo nem no CMC — evita contar
--     duas vezes. Virar para valer: compras.config 'entrada_estoque' →
--     {"ativa": true} (decisão do Benny, no dia em que o Omie deixar de
--     receber as NF de entrada).

-- ── Configuração ────────────────────────────────────────────────────────────
create table if not exists compras.config (
  chave      text primary key,
  valor      jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table compras.config enable row level security;
revoke all on compras.config from public, anon, authenticated;
grant all on compras.config to service_role;
insert into compras.config (chave, valor, updated_by) values
  ('regras_vinculo_desde', jsonb_build_object('em', now()), 'sql/51'),
  ('entrada_estoque', '{"ativa": false}'::jsonb, 'sql/51')
on conflict (chave) do nothing;

create or replace function compras.regras_desde() returns timestamptz
language sql stable security definer set search_path = compras, public as $$
  select coalesce((select (valor->>'em')::timestamptz from compras.config where chave = 'regras_vinculo_desde'), now())
$$;

-- ── (a) Vínculo obrigatório ────────────────────────────────────────────────
alter table compras.pedidos
  add column if not exists sem_rc boolean not null default false,
  add column if not exists sem_rc_motivo text,
  add column if not exists avulsa boolean not null default false,
  add column if not exists avulsa_motivo text;

/** Texto do problema de vínculo do PC, ou null se está tudo certo. */
create or replace function compras.vinculo_erro(p_id bigint) returns text
language plpgsql stable security definer set search_path = compras, public as $$
declare v compras.pedidos; v_soltos text; v_n int;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found or v.tipo <> 'PC' or v.origem <> 'painel' or v.cancelado then return null; end if;
  select count(*), string_agg('#' || i.seq || ' ' || left(i.descricao, 40), ', ' order by i.seq)
    into v_n, v_soltos
    from compras.itens i
   where i.pedido_id = p_id and not exists (select 1 from compras.item_rc l where l.pc_item_id = i.id);
  if not v.sem_rc and v_n > 0 then
    return 'Item sem requisição (RC): ' || v_soltos
        || '. Ligue cada item a uma RC ou marque "Pedido sem RC" e informe o motivo.';
  end if;
  if v.sem_rc and coalesce(trim(v.sem_rc_motivo), '') = '' then
    return 'Informe o motivo do pedido sem RC.';
  end if;
  if not v.avulsa and coalesce(v.pv_os_painel, v.pv_os, '') = '' then
    return 'Ligue o pedido a um PV/OS ou marque "Compra avulsa (estoque / uso interno)" e informe o motivo.';
  end if;
  if v.avulsa and coalesce(trim(v.avulsa_motivo), '') = '' then
    return 'Informe o motivo da compra avulsa.';
  end if;
  return null;
end $$;

-- compras_salvar: mesma função de antes + flags, PV/OS herdado da RC e trava.
create or replace function orders.compras_salvar(p jsonb, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $function$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_ped compras.pedidos;
  v_tipo text := coalesce(p->>'tipo', 'PC');
  v_novo boolean := v_id is null;
  v_it jsonb; v_item_id bigint; v_keep bigint[] := '{}'; v_seq int := 0;
  v_merc numeric := 0; v_frete jsonb := coalesce(p->'frete', '{}'::jsonb); v_total numeric;
  v_err text; v_atual compras.pedidos;
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
    sem_rc = case when p ? 'semRc' then coalesce((p->>'semRc')::boolean, false) else sem_rc end,
    sem_rc_motivo = case when p ? 'semRcMotivo' then nullif(trim(p->>'semRcMotivo'), '') else sem_rc_motivo end,
    avulsa = case when p ? 'avulsa' then coalesce((p->>'avulsa')::boolean, false) else avulsa end,
    avulsa_motivo = case when p ? 'avulsaMotivo' then nullif(trim(p->>'avulsaMotivo'), '') else avulsa_motivo end,
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

  if v_tipo = 'PC' then
    -- PV/OS vazio: herda da(s) RC(s) quando todas apontam para o mesmo PV/OS.
    update compras.pedidos pp set pv_os = r.pv, pv_cliente = coalesce(pp.pv_cliente, r.cli)
      from (select max(coalesce(rp.pv_os_painel, rp.pv_os)) as pv, max(coalesce(rp.pv_cliente_painel, rp.pv_cliente)) as cli,
                   count(distinct coalesce(rp.pv_os_painel, rp.pv_os)) as n
              from compras.itens pi
              join compras.item_rc l on l.pc_item_id = pi.id
              join compras.itens ri on ri.id = l.rc_item_id
              join compras.pedidos rp on rp.id = ri.pedido_id
             where pi.pedido_id = v_id and coalesce(rp.pv_os_painel, rp.pv_os) is not null) r
     where pp.id = v_id and r.n = 1 and coalesce(pp.pv_os_painel, pp.pv_os, '') = '';
    v_err := compras.vinculo_erro(v_id);
    if v_err is not null then raise exception '%', v_err; end if;
    select * into v_atual from compras.pedidos where id = v_id;
    -- Pedido sem RC vai a aprovação, como o gerado da NF.
    if v_atual.sem_rc and v_atual.aprov_status in ('nao_solicitada', 'na', 'nao_aprovado') then
      update compras.pedidos set aprov_status = 'aguardando',
             etapa = case when etapa = '10' then '15' else etapa end where id = v_id;
      perform compras.add_hist(v_id, 'Pedido sem RC — vai a aprovação · motivo: ' || v_atual.sem_rc_motivo, p_por);
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'num', (select numero from compras.pedidos where id = v_id));
end $function$;

-- compras_aprovar: PCs novos (desde a regra) sem vínculo não vão a aprovação nem são aprovados.
create or replace function orders.compras_aprovar(p_ids bigint[], p_status text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $function$
declare n int; v_bloq jsonb := '[]'::jsonb; v_ids bigint[];
begin
  if p_status not in ('aprovado', 'aguardando', 'nao_aprovado', 'nao_solicitada') then raise exception 'status inválido'; end if;
  if p_status in ('aprovado', 'aguardando') then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'num', x.numero, 'erro', x.e)), '[]'::jsonb)
      into v_bloq
      from (select p.id, p.numero, compras.vinculo_erro(p.id) as e from compras.pedidos p
             where p.id = any (p_ids) and p.origem = 'painel' and p.tipo = 'PC'
               and p.created_at >= compras.regras_desde()) x
     where x.e is not null;
  end if;
  select coalesce(array_agg(i), '{}') into v_ids from unnest(p_ids) i
   where not exists (select 1 from jsonb_array_elements(v_bloq) b where (b->>'id')::bigint = i);
  update compras.pedidos set
    aprov_status = p_status,
    aprov_por = case when p_status = 'aprovado' then p_por end,
    aprov_em = case when p_status = 'aprovado' then now() end,
    aprov_valor = case when p_status = 'aprovado' then valor_total end,
    etapa = case when origem = 'painel' and p_status in ('aprovado', 'aguardando') and etapa = '10' then '15' else etapa end,
    updated_at = now(), updated_by = p_por
  where id = any (v_ids) and tipo = 'PC' and not cancelado;
  get diagnostics n = row_count;
  insert into compras.historico (pedido_id, texto, por)
  select id, case p_status when 'aprovado' then 'Aprovado' when 'aguardando' then 'Aprovação solicitada'
                           when 'nao_aprovado' then 'Não aprovado' else 'Aprovação retirada' end, p_por
    from compras.pedidos where id = any (v_ids) and tipo = 'PC';
  return jsonb_build_object('alterados', n, 'bloqueados', v_bloq);
end $function$;

-- PC gerado da NF: não tem RC por natureza; marca com motivo (aprovação já é obrigatória).
create or replace function orders.compras_gerar_pc_da_nf(p_chave text, p_cat_cod text, p_cat text, p_proj_cod text, p_proj text, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $function$
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
    'semRc', true, 'semRcMotivo', 'Gerado da NF-e ' || (d->>'numero') || ' (chegou sem pedido)',
    'avulsa', true, 'avulsaMotivo', 'Gerado da NF-e ' || (d->>'numero') || ' — ligue ao PV/OS se a compra for de uma venda',
    'novaAprov', 'aguardando',
    'origemDe', 'Pedido gerado a partir da NF-e ' || (d->>'numero') || ' por ' || p_por
  ), p_por, p_uid);
  v_id := (v_r->>'id')::bigint;

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
end $function$;

-- Duplicar leva as marcações (o vínculo item↔RC não é copiado: a trava pede de novo).
create or replace function orders.compras_duplicar(p_id bigint, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $function$
declare v compras.pedidos; v_novo bigint;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  insert into compras.pedidos (empresa, tipo, numero, etapa, fornecedor_cod, fornecedor_nome, fornecedor_cnpj,
    categoria_cod, categoria_desc, comprador, comprador_cod, projeto_cod, projeto_nome, conta_cod, conta_desc,
    parcela_cod, emissao, previsao, contato, contrato, obs, obs_int, pv_os, pv_cliente, aprov_status,
    frete, valor_total, origem, omie_sync_status, created_by, updated_by, sem_rc, sem_rc_motivo, avulsa, avulsa_motivo)
  values (v.empresa, v.tipo, compras.proximo_numero(v.empresa),
    case when v.tipo = 'RC' then '20' else '10' end, v.fornecedor_cod, v.fornecedor_nome, v.fornecedor_cnpj,
    v.categoria_cod, v.categoria_desc, v.comprador, v.comprador_cod, v.projeto_cod, v.projeto_nome, v.conta_cod, v.conta_desc,
    v.parcela_cod, (now() at time zone 'America/Sao_Paulo')::date, v.previsao, v.contato, v.contrato, v.obs, v.obs_int,
    v.pv_os, v.pv_cliente, case when v.tipo = 'RC' then 'na' else 'nao_solicitada' end,
    v.frete, v.valor_total, 'painel', null, p_uid, p_por, v.sem_rc, v.sem_rc_motivo, v.avulsa, v.avulsa_motivo)
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
end $function$;

-- compras_pedido / compras_lista passam a devolver as marcações.
create or replace function orders.compras_vinculo(p_id bigint) returns jsonb
language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object('semRc', p.sem_rc, 'semRcMotivo', p.sem_rc_motivo, 'avulsa', p.avulsa,
                            'avulsaMotivo', p.avulsa_motivo, 'vinculoErro', compras.vinculo_erro(p.id),
                            'regraVinculo', p.created_at >= compras.regras_desde())
    from compras.pedidos p where p.id = p_id
$$;

-- ── (b) e (c) Avisos ───────────────────────────────────────────────────────
create table if not exists compras.rc_vistas (email text primary key, visto_em timestamptz not null default now());
create table if not exists compras.rc_avisos (pedido_id bigint primary key references compras.pedidos(id) on delete cascade,
                                              em timestamptz not null default now());
create table if not exists compras.omie_pc_avisos (pedido_id bigint primary key references compras.pedidos(id) on delete cascade,
                                                   em timestamptz not null default now());
do $$ declare t text; begin
  foreach t in array array['compras.rc_vistas', 'compras.rc_avisos', 'compras.omie_pc_avisos'] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from public, anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;

/** RCs abertas (com saldo por atender) criadas no painel. */
create or replace function compras.rcs_abertas_base() returns table (id bigint, numero text, empresa text, pv text, cliente text,
  n_itens bigint, valor numeric, created_at timestamptz, por text)
language sql stable security definer set search_path = compras, public as $$
  select p.id, p.numero, p.empresa, coalesce(p.pv_os_painel, p.pv_os), coalesce(p.pv_cliente_painel, p.pv_cliente),
         (select count(*) from compras.itens i where i.pedido_id = p.id), round(p.valor_total, 2), p.created_at,
         (select h.por from compras.historico h where h.pedido_id = p.id order by h.em, h.id limit 1)
    from compras.pedidos p
   where p.tipo = 'RC' and p.etapa = '20' and not p.cancelado and p.origem = 'painel'
     and exists (select 1 from compras.itens ri where ri.pedido_id = p.id
                  and ri.qtd > coalesce((select sum(l.qtd) from compras.item_rc l
                                           join compras.itens pi on pi.id = l.pc_item_id
                                           join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                                          where l.rc_item_id = ri.id), 0))
$$;

/** Selo da tela de Compras: RCs novas desde a última visita da pessoa + PCs criados no Omie após 01/10. */
create or replace function orders.compras_avisos(p_email text) returns jsonb
language sql stable security definer set search_path = compras, public as $$
  with v as (select coalesce((select visto_em from compras.rc_vistas where email = lower(p_email)), now() - interval '7 days') as desde),
  novas as (select b.* from compras.rcs_abertas_base() b, v where b.created_at > v.desde),
  omie as (select p.id, p.numero, p.empresa, p.fornecedor_nome, round(p.valor_total, 2) as valor, p.emissao, p.created_at
             from compras.pedidos p
            where p.origem = 'omie' and p.tipo = 'PC' and not p.cancelado and not coalesce(p.omie_ausente, false)
              and p.emissao >= date '2026-10-01')
  select jsonb_build_object(
    'rcDesde', (select desde from v),
    'rcNovas', (select count(*) from novas),
    'rcNovasIds', (select coalesce(jsonb_agg(id order by created_at desc), '[]'::jsonb) from novas),
    'pcsOmie', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'num', numero, 'emp', empresa, 'forn', fornecedor_nome,
                                                             'valor', valor, 'emissao', emissao) order by emissao desc, numero desc), '[]'::jsonb)
                  from omie))
$$;

create or replace function orders.compras_rc_marcar_vistas(p_email text) returns void
language sql security definer set search_path = compras, public as $$
  insert into compras.rc_vistas (email, visto_em) values (lower(p_email), now())
  on conflict (email) do update set visto_em = now()
$$;

/** Para o aviso por Webex (uma vez por RC / por PC do Omie). */
create or replace function orders.compras_avisos_pendentes() returns jsonb
language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object(
    'rcs', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'num', b.numero, 'pv', b.pv, 'cliente', b.cliente,
                                                         'nItens', b.n_itens, 'valor', b.valor, 'por', b.por) order by b.created_at), '[]'::jsonb)
              from compras.rcs_abertas_base() b
             where b.created_at > now() - interval '3 days' and not exists (select 1 from compras.rc_avisos a where a.pedido_id = b.id)),
    'pcsOmie', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'num', p.numero, 'forn', p.fornecedor_nome,
                                                             'valor', round(p.valor_total, 2), 'emissao', p.emissao) order by p.emissao), '[]'::jsonb)
                  from compras.pedidos p
                 where p.origem = 'omie' and p.tipo = 'PC' and not p.cancelado and not coalesce(p.omie_ausente, false)
                   and p.emissao >= date '2026-10-01'
                   and not exists (select 1 from compras.omie_pc_avisos a where a.pedido_id = p.id)))
$$;

create or replace function orders.compras_avisos_marcar(p_rcs bigint[], p_pcs bigint[]) returns void
language sql security definer set search_path = compras, public as $$
  insert into compras.rc_avisos (pedido_id) select unnest(coalesce(p_rcs, '{}')) on conflict do nothing;
  insert into compras.omie_pc_avisos (pedido_id) select unnest(coalesce(p_pcs, '{}')) on conflict do nothing;
$$;

-- ── (d) Entrada de estoque ao Conferir ─────────────────────────────────────
insert into platform.estoque_mov_tipo (empresa, codigo, nome, sentido, origem, exige_aprovacao, exige_cliente_ou_projeto,
                                       exige_pc, ativo, ordem, descricao, updated_by_email)
select e, 'compra_painel', 'Entrada por compra (painel)', 'entra', 'manual', false, false, false, false, 2,
       'Automática: PC do painel conferido (sql/51). Não se lança à mão — fica inativa na lista de tipos.', 'sql/51'
  from (values ('SF')) x(e)
on conflict (empresa, codigo) do nothing;

create table if not exists compras.cmc_nativo (
  empresa      text not null,
  n_cod_prod   bigint not null,
  cmc          numeric not null,
  mov_id       bigint,
  atualizado_em timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
create table if not exists compras.estoque_entradas (
  id            bigserial primary key,
  pedido_id     bigint not null references compras.pedidos(id) on delete cascade,
  item_id       bigint not null,
  empresa       text not null,
  n_cod_prod    bigint not null,
  local_destino bigint,
  quantidade    numeric not null,
  valor_unit    numeric not null,
  cmc_antes     numeric,
  cmc_antes_nativo boolean not null default false,
  cmc_depois    numeric,
  mov_id        bigint,
  status        text not null check (status in ('ativa', 'sombra', 'revertida')),
  criado_em     timestamptz not null default now(),
  revertido_em  timestamptz
);
create unique index if not exists estoque_entradas_item_viva on compras.estoque_entradas (item_id) where status in ('ativa', 'sombra');
do $$ declare t text; begin
  foreach t in array array['compras.cmc_nativo', 'compras.estoque_entradas'] loop
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from public, anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
grant usage, select on sequence compras.estoque_entradas_id_seq to service_role;

/** Item do PC → item de estoque (n_cod_prod atual, seguindo mesclas e recodificações). */
create or replace function compras.item_estoque(p_emp text, p_ncod bigint, p_cod text) returns bigint
language plpgsql stable security definer set search_path = compras, orders, platform, public as $$
declare n bigint;
begin
  if p_ncod is not null then
    select r.n_cod_prod_atual into n from platform.v_item_codigo_resolvido r
     where r.empresa = p_emp and r.n_cod_prod_usado = p_ncod and r.n_cod_prod_atual is not null limit 1;
    n := coalesce(n, p_ncod);
  elsif coalesce(trim(p_cod), '') <> '' then
    select r.n_cod_prod_atual into n from platform.v_item_codigo_resolvido r
     where r.empresa = p_emp and r.codigo_usado = trim(p_cod) and r.n_cod_prod_atual is not null limit 1;
  end if;
  if n is null or not exists (select 1 from orders.v_estoque_saldo_local s where s.empresa = p_emp and s.n_cod_prod = n) then
    return null;
  end if;
  return n;
end $$;

create or replace function compras.estoque_entrar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = compras, orders, platform, public as $$
declare v compras.pedidos; i compras.itens; v_ativa boolean; v_tipo bigint; n bigint; v_q numeric; v_vu numeric;
        v_loc bigint; v_saldo numeric; v_cmc numeric; v_novo numeric; v_mov bigint; v_nat compras.cmc_nativo;
        v_ok int := 0; v_sem text[] := '{}';
begin
  select * into v from compras.pedidos where id = p_id;
  if not found or v.origem <> 'painel' or v.tipo <> 'PC' then return null; end if;
  v_ativa := coalesce((select (valor->>'ativa')::boolean from compras.config where chave = 'entrada_estoque'), false);
  select id into v_tipo from platform.estoque_mov_tipo where empresa = v.empresa and codigo = 'compra_painel';
  for i in select * from compras.itens where pedido_id = p_id order by seq, id loop
    continue when exists (select 1 from compras.estoque_entradas e where e.item_id = i.id and e.status in ('ativa', 'sombra'));
    v_q := coalesce(nullif(i.qtd_recebida, 0), i.qtd);
    continue when coalesce(v_q, 0) <= 0;
    n := compras.item_estoque(v.empresa, i.ncod_prod, i.produto_cod);
    if n is null then v_sem := v_sem || ('#' || i.seq || ' ' || left(i.descricao, 40)); continue; end if;
    v_vu := round((i.qtd * i.valor_unit - coalesce(i.desconto, 0) + coalesce(i.ipi, 0) + coalesce(i.st, 0)) / nullif(i.qtd, 0), 6);
    select coalesce(sum(s.saldo), 0), coalesce(max(s.cmc), 0) into v_saldo, v_cmc
      from orders.v_estoque_saldo_local s where s.empresa = v.empresa and s.n_cod_prod = n;
    v_loc := coalesce(case when i.local_estoque ~ '^\d+$' then i.local_estoque::bigint end,
                      (select c.local_padrao from platform.estoque_item_cadastro c where c.empresa = v.empresa and c.n_cod_prod = n limit 1),
                      (select s.codigo_local_estoque from orders.v_estoque_saldo_local s where s.empresa = v.empresa and s.n_cod_prod = n
                        order by s.saldo desc nulls last limit 1),
                      2264756939);
    v_novo := case when v_saldo > 0 then round((v_saldo * v_cmc + v_q * v_vu) / (v_saldo + v_q), 6) else v_vu end;
    select * into v_nat from compras.cmc_nativo where empresa = v.empresa and n_cod_prod = n;
    v_mov := null;
    if v_ativa then
      insert into platform.estoque_movimento (empresa, tipo_id, n_cod_prod, quantidade, local_destino, solicitante_nome,
        pc_numero, pv_os, motivo, obs, status, cmc, valor, created_by_email)
      values (v.empresa, v_tipo, n, v_q, v_loc, 'Compras · conferência', v.numero, coalesce(v.pv_os_painel, v.pv_os),
        'Entrada por compra — PC ' || v.numero, 'NF-e ' || coalesce(v.nf, '—') || ' · item #' || i.seq, 'aplicado',
        v_vu, round(v_q * v_vu, 2), v.updated_by)
      returning id into v_mov;
      insert into compras.cmc_nativo (empresa, n_cod_prod, cmc, mov_id, atualizado_em)
      values (v.empresa, n, v_novo, v_mov, now())
      on conflict (empresa, n_cod_prod) do update set cmc = excluded.cmc, mov_id = excluded.mov_id, atualizado_em = now();
    end if;
    insert into compras.estoque_entradas (pedido_id, item_id, empresa, n_cod_prod, local_destino, quantidade, valor_unit,
                                          cmc_antes, cmc_antes_nativo, cmc_depois, mov_id, status)
    values (p_id, i.id, v.empresa, n, v_loc, v_q, v_vu, v_cmc, v_nat.n_cod_prod is not null, v_novo, v_mov,
            case when v_ativa then 'ativa' else 'sombra' end);
    v_ok := v_ok + 1;
  end loop;
  if v_ok > 0 or array_length(v_sem, 1) > 0 then
    perform compras.add_hist(p_id,
      case when v_ativa then 'Entrada no estoque: ' else 'Entrada no estoque (modo sombra — o saldo ainda vem do Omie): ' end
      || v_ok || ' item(ns)'
      || case when array_length(v_sem, 1) > 0 then ' · sem item de estoque: ' || array_to_string(v_sem, ', ') else '' end,
      'sistema');
  end if;
  return jsonb_build_object('entradas', v_ok, 'ativa', v_ativa, 'semItem', to_jsonb(v_sem));
end $$;

create or replace function compras.estoque_desfazer(p_id bigint, p_motivo text default 'desconferido') returns jsonb
language plpgsql security definer set search_path = compras, orders, platform, public as $$
declare e compras.estoque_entradas; v_nat compras.cmc_nativo; v_s numeric; v_c numeric; n int := 0;
begin
  for e in select * from compras.estoque_entradas where pedido_id = p_id and status in ('ativa', 'sombra') order by id desc loop
    update compras.estoque_entradas set status = 'revertida', revertido_em = now() where id = e.id;
    if e.status = 'ativa' and e.mov_id is not null then
      update platform.estoque_movimento set status = 'cancelado', cancelado_em = now(),
             cancelado_por_email = 'compras (' || p_motivo || ')' where id = e.mov_id and status = 'aplicado';
      select * into v_nat from compras.cmc_nativo where empresa = e.empresa and n_cod_prod = e.n_cod_prod;
      if v_nat.n_cod_prod is not null then
        if not exists (select 1 from compras.estoque_entradas x where x.empresa = e.empresa and x.n_cod_prod = e.n_cod_prod and x.status = 'ativa') then
          -- nenhuma entrada nativa viva: volta ao CMC de origem (Omie / cadastro)
          delete from compras.cmc_nativo where empresa = e.empresa and n_cod_prod = e.n_cod_prod;
        else
          -- outras entradas continuam: tira só a contribuição desta do médio (vale fora de ordem)
          select coalesce(sum(s.saldo), 0) into v_s from orders.v_estoque_saldo_local s
           where s.empresa = e.empresa and s.n_cod_prod = e.n_cod_prod;
          v_c := case when v_s > 0 then round(((v_s + e.quantidade) * v_nat.cmc - e.quantidade * e.valor_unit) / v_s, 6) end;
          if v_c is not null and v_c > 0 then
            update compras.cmc_nativo set cmc = v_c, mov_id = null, atualizado_em = now()
             where empresa = e.empresa and n_cod_prod = e.n_cod_prod;
          end if;
        end if;
      end if;
    end if;
    n := n + 1;
  end loop;
  if n > 0 then perform compras.add_hist(p_id, 'Entrada no estoque desfeita (' || p_motivo || '): ' || n || ' item(ns)', 'sistema'); end if;
  return jsonb_build_object('revertidas', n);
end $$;

create or replace function compras.tg_estoque_conferido() returns trigger
language plpgsql security definer set search_path = compras, public as $$
begin
  if new.origem <> 'painel' or new.tipo <> 'PC' then return null; end if;
  if new.cancelado and not old.cancelado then
    perform compras.estoque_desfazer(new.id, 'pedido cancelado');
  elsif new.etapa = '80' and old.etapa is distinct from '80' and not new.cancelado then
    perform compras.estoque_entrar(new.id);
  elsif old.etapa = '80' and new.etapa <> '80' then
    perform compras.estoque_desfazer(new.id, 'saiu de Conferido');
  end if;
  return null;
end $$;
drop trigger if exists estoque_conferido on compras.pedidos;
create trigger estoque_conferido after update of etapa, cancelado on compras.pedidos
  for each row execute function compras.tg_estoque_conferido();

/** Entradas de estoque de um pedido (folha). */
create or replace function orders.compras_estoque_do_pedido(p_id bigint) returns jsonb
language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('itemId', e.item_id, 'nCodProd', e.n_cod_prod, 'qtd', e.quantidade,
           'vu', e.valor_unit, 'cmcAntes', e.cmc_antes, 'cmcDepois', e.cmc_depois, 'status', e.status, 'em', e.criado_em)
           order by e.id), '[]'::jsonb)
    from compras.estoque_entradas e where e.pedido_id = p_id and e.status <> 'revertida'
$$;

-- CMC: o médio nativo (só existe com a entrada ativa) passa à frente do do Omie.
-- Mesma view de antes; só a coluna cmc ganha o coalesce.
create or replace view orders.v_estoque_saldo_local as
 WITH aj AS (
         SELECT x.empresa, x.n_cod_prod, x.codigo_local_estoque, sum(x.d) AS ajuste
           FROM ( SELECT estoque_ajuste.empresa, estoque_ajuste.n_cod_prod, estoque_ajuste.codigo_local_estoque,
                         estoque_ajuste.diferenca AS d
                   FROM platform.estoque_ajuste
                  WHERE (estoque_ajuste.status = 'aplicado'::text)
                UNION ALL
                 SELECT v_estoque_mov_efeito.empresa, v_estoque_mov_efeito.n_cod_prod, v_estoque_mov_efeito.codigo_local_estoque,
                        v_estoque_mov_efeito.delta
                   FROM orders.v_estoque_mov_efeito) x
          GROUP BY x.empresa, x.n_cod_prod, x.codigo_local_estoque
        ), cad AS (
         SELECT c.empresa, COALESCE(c.n_cod_prod, (- c.id)) AS n_cod_prod,
            COALESCE(c.local_padrao, '2264756939'::bigint) AS codigo_local_estoque, c.preco_ref, c.minimo
           FROM platform.estoque_item_cadastro c
          WHERE ((c.origem = 'painel'::text) AND (NOT (EXISTS ( SELECT 1 FROM orders.estoque_posicao p
                  WHERE ((p.empresa = c.empresa) AND (p.n_cod_prod = c.n_cod_prod))))))
        ), extra AS (
         SELECT aj.empresa, aj.n_cod_prod, aj.codigo_local_estoque
           FROM aj
          WHERE ((NOT (EXISTS ( SELECT 1 FROM orders.estoque_posicao p
                  WHERE ((p.empresa = aj.empresa) AND (p.n_cod_prod = aj.n_cod_prod) AND (p.codigo_local_estoque = aj.codigo_local_estoque)))))
                AND (EXISTS ( SELECT 1 FROM orders.estoque_posicao p
                  WHERE ((p.empresa = aj.empresa) AND (p.n_cod_prod = aj.n_cod_prod)))))
        )
 SELECT p.empresa, p.n_cod_prod, p.codigo_local_estoque, p.codigo, p.descricao, p.saldo AS saldo_omie,
    COALESCE(aj.ajuste, (0)::numeric) AS ajuste, (p.saldo + COALESCE(aj.ajuste, (0)::numeric)) AS saldo,
    p.fisico, p.reservado, p.pendente, COALESCE(nat.cmc, p.cmc) AS cmc, p.estoque_minimo, p.data_posicao
   FROM orders.estoque_posicao p
     LEFT JOIN aj ON (((aj.empresa = p.empresa) AND (aj.n_cod_prod = p.n_cod_prod) AND (aj.codigo_local_estoque = p.codigo_local_estoque)))
     LEFT JOIN compras.cmc_nativo nat ON nat.empresa = p.empresa AND nat.n_cod_prod = p.n_cod_prod
UNION ALL
 SELECT e.empresa, e.n_cod_prod, e.codigo_local_estoque, b.codigo, b.descricao, 0 AS saldo_omie, aj.ajuste,
    aj.ajuste AS saldo, 0 AS fisico, 0 AS reservado, 0 AS pendente, COALESCE(nat.cmc, b.cmc) AS cmc,
    b.estoque_minimo, b.data_posicao
   FROM extra e
     JOIN aj ON (((aj.empresa = e.empresa) AND (aj.n_cod_prod = e.n_cod_prod) AND (aj.codigo_local_estoque = e.codigo_local_estoque)))
     JOIN LATERAL ( SELECT p.codigo, p.descricao, p.cmc, p.estoque_minimo, p.data_posicao
           FROM orders.estoque_posicao p
          WHERE ((p.empresa = e.empresa) AND (p.n_cod_prod = e.n_cod_prod))
          ORDER BY p.codigo_local_estoque
         LIMIT 1) b ON (true)
     LEFT JOIN compras.cmc_nativo nat ON nat.empresa = e.empresa AND nat.n_cod_prod = e.n_cod_prod
UNION ALL
 SELECT c.empresa, c.n_cod_prod, l.loc AS codigo_local_estoque, NULL::text AS codigo, NULL::text AS descricao,
    0 AS saldo_omie, COALESCE(aj.ajuste, (0)::numeric) AS ajuste, COALESCE(aj.ajuste, (0)::numeric) AS saldo,
    0 AS fisico, 0 AS reservado, 0 AS pendente, COALESCE(nat.cmc, c.preco_ref, (0)::numeric) AS cmc,
    COALESCE(c.minimo, (0)::numeric) AS estoque_minimo, CURRENT_DATE AS data_posicao
   FROM cad c
     CROSS JOIN LATERAL ( SELECT c.codigo_local_estoque AS loc
        UNION
         SELECT a.codigo_local_estoque FROM aj a WHERE ((a.empresa = c.empresa) AND (a.n_cod_prod = c.n_cod_prod))) l
     LEFT JOIN aj ON (((aj.empresa = c.empresa) AND (aj.n_cod_prod = c.n_cod_prod) AND (aj.codigo_local_estoque = l.loc)))
     LEFT JOIN compras.cmc_nativo nat ON nat.empresa = c.empresa AND nat.n_cod_prod = c.n_cod_prod;

-- ── Permissões das funções novas/alteradas ─────────────────────────────────
do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname in ('compras_salvar', 'compras_aprovar', 'compras_gerar_pc_da_nf', 'compras_duplicar',
                     'compras_vinculo', 'compras_avisos', 'compras_rc_marcar_vistas', 'compras_avisos_pendentes',
                     'compras_avisos_marcar', 'compras_estoque_do_pedido'))
               or (n.nspname = 'compras' and p.proname in ('regras_desde', 'vinculo_erro', 'rcs_abertas_base', 'item_estoque',
                     'estoque_entrar', 'estoque_desfazer', 'tg_estoque_conferido')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
