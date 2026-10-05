-- 49_vendas_proprio.sql — PV e OS nativos do painel (05/10/26, ciclo de vendas sem Omie, pacote P1).
--
-- A partir daqui o pedido de venda (PV) e a ordem de serviço (OS) podem nascer
-- no próprio painel — pelo CRM (servidor-a-servidor) ou pela tela /erp/vendas.
-- A fonte da verdade é o schema `vendas`. Para que TUDO o que já lê PV/OS
-- (Avulsos, Operação, faturamento/backlog, ERP·Vendas, RC do CRM, BI) os veja
-- em tempo real sem reescrever dezenas de views, cada documento é ESPELHADO nas
-- mesmas tabelas do espelho do Omie (sales.pedidos_venda / itens_vendidos /
-- etapas_pedidos / ordens_servico) com um código sintético >= 9.000.000.000.000
-- (os códigos do Omie andam pelos 1,2e10 — nunca colidem). O sync do Omie só faz
-- upsert pelas chaves dele, então nunca toca nestas linhas.
--
-- Numeração: continua a sequência do Omie, separada para PV e OS, por empresa
-- (próximo = maior entre o último nativo e o maior número vindo do Omie, +1).
--
-- Quem usa o caminho nativo: vendas.config.pv_os_nativo por empresa — DEFAULT
-- false (o CRM continua a criar no Omie). Virar a chave é decisão do Benny,
-- quando o faturamento pela Focus (P5) estiver pronto.
--
-- O schema não é exposto no PostgREST: tudo passa por orders.vendas_* (security
-- definer, execução só service_role), como em compras.

create schema if not exists vendas;
revoke all on schema vendas from public, anon, authenticated;
grant usage on schema vendas to service_role;

create table if not exists vendas.config (
  empresa        text primary key,
  pv_os_nativo   boolean not null default false,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
insert into vendas.config (empresa) values ('SF'), ('CD'), ('WW') on conflict do nothing;

create table if not exists vendas.numeracao (
  empresa text not null,
  tipo    text not null check (tipo in ('PV', 'OS')),
  ultimo  bigint not null default 0,
  primary key (empresa, tipo)
);

create table if not exists vendas.documentos (
  id                 bigserial primary key,
  empresa            text not null default 'SF',
  tipo               text not null check (tipo in ('PV', 'OS')),
  numero             text not null,
  codigo             bigint generated always as (9000000000000 + id) stored,
  status             text not null default 'aberto' check (status in ('aberto', 'faturado', 'cancelado')),
  etapa              text not null default '10',
  cliente_codigo     bigint,          -- finance.clientes.codigo_cliente_omie (cadastro de clientes)
  cliente_nome       text,
  cliente_cnpj       text,
  proposta           text,            -- nº da proposta do CRM (= nº do contrato)
  num_pedido_cliente text,
  contato            text,
  emissao            date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  previsao           date,
  condicao_codigo    text,            -- sales.formas_pagamento.codigo
  condicao_descricao text,
  qtd_parcelas       integer,
  projeto_codigo     text,            -- finance.projetos.codigo
  categoria_codigo   text,            -- finance.categorias.codigo
  vendedor_codigo    text,
  conta_codigo       text,            -- conta corrente
  cenario_impostos   text,
  consumidor_final   text,
  observacoes        text,
  obs_nf             text,
  valor_mercadorias  numeric(15,2) not null default 0,
  valor_desconto     numeric(15,2) not null default 0,
  valor_frete        numeric(15,2) not null default 0,
  valor_total        numeric(15,2) not null default 0,
  dt_fat             date,
  nf                 text,
  chave_nfe          text,
  origem             text not null default 'painel' check (origem in ('painel', 'crm')),
  cancelado_motivo   text,
  criado_por         text,
  criado_em          timestamptz not null default now(),
  atualizado_por     text,
  atualizado_em      timestamptz not null default now(),
  unique (empresa, tipo, numero)
);
create unique index if not exists vendas_documentos_codigo on vendas.documentos (codigo);
-- Uma proposta, um documento de cada tipo (PV+OS da mesma proposta é permitido).
create unique index if not exists vendas_documentos_proposta on vendas.documentos (empresa, tipo, proposta)
  where proposta is not null and status <> 'cancelado';

create table if not exists vendas.itens (
  id             bigserial primary key,
  documento_id   bigint not null references vendas.documentos(id) on delete cascade,
  seq            integer not null,
  codigo         text,                -- código do item (catálogo/estoque)
  ncod_prod      bigint,              -- id do produto/serviço no cadastro (Omie, enquanto houver)
  descricao      text not null,
  unidade        text not null default 'UN',
  ncm            text,
  cfop           text,
  quantidade     numeric(15,4) not null default 1,
  valor_unitario numeric(15,4) not null default 0,
  valor_desconto numeric(15,2) not null default 0,
  valor_total    numeric(15,2) generated always as (round(quantidade * valor_unitario, 2) - valor_desconto) stored,
  fiscal         jsonb,               -- serviço: lc116, mun, trib, retemIss, aliqIss
  unique (documento_id, seq)
);

create table if not exists vendas.parcelas (
  id           bigserial primary key,
  documento_id bigint not null references vendas.documentos(id) on delete cascade,
  numero       integer not null,
  vencimento   date not null,
  valor        numeric(15,2) not null,
  percentual   numeric(9,4),
  dias         integer,
  unique (documento_id, numero)
);

create table if not exists vendas.historico (
  id           bigserial primary key,
  documento_id bigint not null references vendas.documentos(id) on delete cascade,
  em           timestamptz not null default now(),
  por          text,
  acao         text not null,
  detalhe      jsonb
);
create index if not exists vendas_historico_doc on vendas.historico (documento_id, em desc);

alter table vendas.config     enable row level security;
alter table vendas.numeracao  enable row level security;
alter table vendas.documentos enable row level security;
alter table vendas.itens      enable row level security;
alter table vendas.parcelas   enable row level security;
alter table vendas.historico  enable row level security;
grant all on all tables in schema vendas to service_role;
grant usage, select on all sequences in schema vendas to service_role;

-- ── Número seguinte (PV e OS separados, continuando o Omie) ─────────────────
create or replace function vendas.proximo_numero(p_emp text, p_tipo text)
returns text language plpgsql security definer set search_path = vendas, public as $$
declare v bigint; omie bigint;
begin
  insert into vendas.numeracao (empresa, tipo, ultimo) values (p_emp, p_tipo, 0) on conflict do nothing;
  perform 1 from vendas.numeracao where empresa = p_emp and tipo = p_tipo for update;
  if p_tipo = 'PV' then
    select coalesce(max(numero_pedido::bigint), 0) into omie from sales.pedidos_venda
     where empresa = p_emp and numero_pedido ~ '^\d+$' and codigo_pedido < 9000000000000;
  else
    select coalesce(max(numero_os::bigint), 0) into omie from sales.ordens_servico
     where empresa = p_emp and numero_os ~ '^\d+$' and codigo_os ~ '^\d+$' and codigo_os::bigint < 9000000000000;
  end if;
  update vendas.numeracao set ultimo = greatest(ultimo, omie) + 1
   where empresa = p_emp and tipo = p_tipo returning ultimo into v;
  return v::text;
end $$;

-- ── Parcelas a partir da condição (A Vista, "Para 28 dias", "30/60/90", "3 Parcelas") ──
create or replace function vendas.parcelas_da_condicao(p_emp text, p_cond text, p_qtd integer, p_base date, p_total numeric)
returns table (numero integer, vencimento date, valor numeric, percentual numeric, dias integer)
language plpgsql stable security definer set search_path = vendas, public as $$
declare descr text; d int[]; n int; i int; acum numeric := 0; v numeric;
begin
  select fp.descricao into descr from sales.formas_pagamento fp where fp.empresa = p_emp and fp.codigo = p_cond;
  descr := coalesce(descr, '');
  if descr ~ '^\s*\d+(\s*/\s*\d+)+\s*$' then
    d := (select array_agg(x::int order by ord) from unnest(regexp_split_to_array(trim(descr), '\s*/\s*')) with ordinality as t(x, ord));
  elsif descr ~* 'para\s+\d+\s+dias' then
    d := array[(regexp_match(descr, '(\d+)'))[1]::int];
  elsif descr ~* 'vista' then
    d := array[0];
  else
    n := greatest(1, coalesce(p_qtd, (regexp_match(descr, '^(\d+)\s+parcela'))[1]::int, 1));
    d := (select array_agg(k * 30) from generate_series(1, n) k);
  end if;
  n := array_length(d, 1);
  for i in 1..n loop
    v := case when i < n then round(p_total / n, 2) else p_total - acum end;
    acum := acum + v;
    numero := i; vencimento := p_base + d[i]; valor := v; dias := d[i];
    percentual := case when p_total > 0 then round(v * 100 / p_total, 4) else null end;
    return next;
  end loop;
end $$;

-- ── Espelho nas tabelas do Omie (para todas as views existentes) ─────────────
create or replace function vendas.espelhar(p_id bigint)
returns void language plpgsql security definer set search_path = vendas, public as $$
declare
  d vendas.documentos;
  br text; prev text; fat text; nitens int; parc text;
  canc text; fatur text;
begin
  select * into d from vendas.documentos where id = p_id;
  if not found then return; end if;
  br   := to_char(d.emissao, 'DD/MM/YYYY');
  prev := to_char(coalesce(d.previsao, d.emissao), 'DD/MM/YYYY');
  fat  := to_char(d.dt_fat, 'DD/MM/YYYY');
  canc := case when d.status = 'cancelado' then 'S' else 'N' end;
  fatur := case when d.status = 'faturado' then 'S' else 'N' end;
  select count(*) into nitens from vendas.itens where documento_id = d.id;
  parc := coalesce(d.qtd_parcelas, (select count(*) from vendas.parcelas where documento_id = d.id)::int, 1)::text;

  if d.tipo = 'PV' then
    insert into sales.pedidos_venda as t (
      empresa, codigo_pedido, cod_pedido_integracao, numero_pedido, codigo_cliente, data_previsao, etapa,
      codigo_parcela, qtde_parcelas, origem_pedido, valor_total, quantidade_itens, valor_mercadorias,
      valor_desconto, valor_frete, codigo_categoria, codigo_conta, num_pedido_cliente, contato,
      consumidor_final, codigo_vendedor, codigo_projeto, dados_adicionais_nf, d_inc, d_alt, numero_contrato, synced_at)
    values (
      d.empresa, d.codigo, 'painel:' || d.id, d.numero, d.cliente_codigo, prev, d.etapa,
      d.condicao_codigo, parc::numeric, 'PAINEL', d.valor_total, nitens, d.valor_mercadorias,
      d.valor_desconto, d.valor_frete, d.categoria_codigo, d.conta_codigo, d.num_pedido_cliente, d.contato,
      d.consumidor_final, d.vendedor_codigo, d.projeto_codigo, d.obs_nf, br, to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
      d.proposta, now())
    on conflict (empresa, codigo_pedido) do update set
      numero_pedido = excluded.numero_pedido, codigo_cliente = excluded.codigo_cliente,
      data_previsao = excluded.data_previsao, etapa = excluded.etapa, codigo_parcela = excluded.codigo_parcela,
      qtde_parcelas = excluded.qtde_parcelas, valor_total = excluded.valor_total,
      quantidade_itens = excluded.quantidade_itens, valor_mercadorias = excluded.valor_mercadorias,
      valor_desconto = excluded.valor_desconto, valor_frete = excluded.valor_frete,
      codigo_categoria = excluded.codigo_categoria, codigo_conta = excluded.codigo_conta,
      num_pedido_cliente = excluded.num_pedido_cliente, contato = excluded.contato,
      consumidor_final = excluded.consumidor_final, codigo_vendedor = excluded.codigo_vendedor,
      codigo_projeto = excluded.codigo_projeto, dados_adicionais_nf = excluded.dados_adicionais_nf,
      d_alt = excluded.d_alt, numero_contrato = excluded.numero_contrato, synced_at = now();

    delete from sales.itens_vendidos where empresa = d.empresa and codigo_pedido = d.codigo;
    insert into sales.itens_vendidos (
      empresa, codigo_pedido, codigo_item, numero_pedido, data_previsao, codigo_cliente, etapa, codigo_parcela,
      codigo_item_integracao, codigo_produto, codigo_prod_omie, descricao, unidade, quantidade, valor_unitario,
      valor_total, ncm, valor_desconto, d_inc, synced_at)
    select d.empresa, d.codigo, d.codigo * 1000 + i.seq, d.numero, prev, d.cliente_codigo, d.etapa, d.condicao_codigo,
           'painel:' || d.id || '-' || i.seq, i.ncod_prod, i.codigo, i.descricao, i.unidade, i.quantidade, i.valor_unitario,
           i.valor_total, i.ncm, i.valor_desconto, br, now()
      from vendas.itens i where i.documento_id = d.id;

    insert into sales.etapas_pedidos as t (
      empresa, codigo_pedido, cod_int_pedido, numero, etapa, faturado, dt_fat, num_nfe, chave_nfe,
      cancelado, d_inc, synced_at)
    values (d.empresa, d.codigo, 'painel:' || d.id, d.numero, d.etapa, fatur, fat, d.nf, d.chave_nfe, canc, br, now())
    on conflict (empresa, codigo_pedido) do update set
      numero = excluded.numero, etapa = excluded.etapa, faturado = excluded.faturado, dt_fat = excluded.dt_fat,
      num_nfe = excluded.num_nfe, chave_nfe = excluded.chave_nfe, cancelado = excluded.cancelado, synced_at = now();
  else
    delete from sales.ordens_servico where empresa = d.empresa and codigo_os = d.codigo::text
       and seq_item not in (select seq from vendas.itens where documento_id = d.id);
    insert into sales.ordens_servico as t (
      empresa, codigo_os, seq_item, numero_os, codigo_cliente, dt_previsao, valor_total, etapa, codigo_categoria,
      codigo_projeto, codigo_cc, codigo_parcela, qtd_parcelas, faturada, cancelada, d_inc, dt_fat,
      codigo_servico, descricao_servico, quantidade, valor_unitario, trib_servico, retem_iss, aliq_iss,
      codigo_vendedor, num_recibo, numero_contrato, synced_at)
    select d.empresa, d.codigo::text, s.seq, d.numero, d.cliente_codigo::text, prev, d.valor_total, d.etapa, d.categoria_codigo,
           d.projeto_codigo, d.conta_codigo, d.condicao_codigo, parc, fatur, canc, br, fat,
           s.ncod_prod::text, s.descricao, s.quantidade, s.valor_unitario, s.fiscal ->> 'trib',
           coalesce(s.fiscal ->> 'retemIss', 'N'), nullif(s.fiscal ->> 'aliqIss', '')::numeric,
           d.vendedor_codigo, d.nf, d.proposta, now()
      from (select seq, ncod_prod, descricao, quantidade, valor_unitario, fiscal from vendas.itens where documento_id = d.id
            union all
            select 1, null, coalesce(d.observacoes, 'OS ' || d.numero), 1, d.valor_total, null
             where not exists (select 1 from vendas.itens where documento_id = d.id)) s
    on conflict (empresa, codigo_os, seq_item) do update set
      numero_os = excluded.numero_os, codigo_cliente = excluded.codigo_cliente, dt_previsao = excluded.dt_previsao,
      valor_total = excluded.valor_total, etapa = excluded.etapa, codigo_categoria = excluded.codigo_categoria,
      codigo_projeto = excluded.codigo_projeto, codigo_cc = excluded.codigo_cc, codigo_parcela = excluded.codigo_parcela,
      qtd_parcelas = excluded.qtd_parcelas, faturada = excluded.faturada, cancelada = excluded.cancelada,
      dt_fat = excluded.dt_fat, codigo_servico = excluded.codigo_servico, descricao_servico = excluded.descricao_servico,
      quantidade = excluded.quantidade, valor_unitario = excluded.valor_unitario, trib_servico = excluded.trib_servico,
      retem_iss = excluded.retem_iss, aliq_iss = excluded.aliq_iss, codigo_vendedor = excluded.codigo_vendedor,
      num_recibo = excluded.num_recibo, numero_contrato = excluded.numero_contrato, synced_at = now();
  end if;
end $$;

-- Remove o espelho (só para apagar documentos de teste; documentos reais cancelam-se).
create or replace function vendas.desespelhar(p_id bigint)
returns void language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id;
  if not found then return; end if;
  if d.tipo = 'PV' then
    delete from sales.itens_vendidos where empresa = d.empresa and codigo_pedido = d.codigo;
    delete from sales.etapas_pedidos where empresa = d.empresa and codigo_pedido = d.codigo;
    delete from sales.pedidos_venda  where empresa = d.empresa and codigo_pedido = d.codigo;
  else
    delete from sales.ordens_servico where empresa = d.empresa and codigo_os = d.codigo::text;
  end if;
end $$;

-- ── Documento completo (cabeçalho + itens + parcelas + histórico + nomes) ────
create or replace function orders.vendas_documento(p_id bigint)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select to_jsonb(d) || jsonb_build_object(
    'label', d.tipo || d.numero,
    'cliente', coalesce(nullif(c.nome_fantasia, ''), c.razao_social, d.cliente_nome),
    'cliente_razao', c.razao_social,
    'cnpj', coalesce(c.cnpj_cpf, d.cliente_cnpj),
    'cidade', c.cidade, 'uf', c.estado,
    'projeto', pj.nome, 'categoria', cat.descricao,
    'condicao', coalesce(fp.descricao, d.condicao_descricao),
    'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.seq) from vendas.itens i where i.documento_id = d.id), '[]'),
    'parcelas', coalesce((select jsonb_agg(to_jsonb(p) order by p.numero) from vendas.parcelas p where p.documento_id = d.id), '[]'),
    'historico', coalesce((select jsonb_agg(to_jsonb(h) order by h.em desc) from vendas.historico h where h.documento_id = d.id), '[]'),
    'rcs', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'num', cp.numero, 'tipo', cp.tipo))
                       from compras.pedidos cp where cp.empresa = d.empresa and not coalesce(cp.cancelado, false)
                        and (cp.pv_os = d.tipo || d.numero or cp.pv_os_painel = d.tipo || d.numero)), '[]')
  )
  from vendas.documentos d
  left join finance.clientes c on c.empresa = d.empresa and c.codigo_cliente_omie = d.cliente_codigo
  left join finance.projetos pj on pj.empresa = d.empresa and pj.codigo::text = d.projeto_codigo
  left join finance.categorias cat on cat.empresa = d.empresa and cat.codigo = d.categoria_codigo
  left join sales.formas_pagamento fp on fp.empresa = d.empresa and fp.codigo = d.condicao_codigo
  where d.id = p_id
$$;

-- ── Criar / editar ───────────────────────────────────────────────────────────
-- p: { id?, empresa, tipo, cliente_codigo, cliente_nome?, proposta?, previsao, condicao_codigo,
--      qtd_parcelas?, projeto_codigo?, categoria_codigo?, vendedor_codigo?, conta_codigo?, cenario_impostos?,
--      consumidor_final?, observacoes?, obs_nf?, num_pedido_cliente?, contato?, valor_desconto?, valor_frete?,
--      origem?, itens: [{codigo?, ncod_prod?, descricao, unidade?, ncm?, cfop?, quantidade, valor_unitario, valor_desconto?, fiscal?}],
--      parcelas?: [{numero, vencimento, valor, percentual?, dias?}] }
create or replace function orders.vendas_salvar(p jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare
  v_id bigint := nullif(p ->> 'id', '')::bigint;
  v_emp text := upper(coalesce(nullif(p ->> 'empresa', ''), 'SF'));
  v_tipo text := upper(coalesce(p ->> 'tipo', ''));
  d vendas.documentos;
  v_cli record; it jsonb; k int := 0; v_merc numeric; v_total numeric; v_base date; ja text;
begin
  if jsonb_typeof(p -> 'itens') is distinct from 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception 'O documento precisa de pelo menos um item';
  end if;
  if nullif(p ->> 'cliente_codigo', '') is null then raise exception 'Escolha o cliente'; end if;

  select codigo_cliente_omie, coalesce(nullif(nome_fantasia, ''), razao_social) nome, cnpj_cpf
    into v_cli from finance.clientes where empresa = v_emp and codigo_cliente_omie = (p ->> 'cliente_codigo')::bigint;

  if v_id is null then
    if v_tipo not in ('PV', 'OS') then raise exception 'Tipo tem de ser PV ou OS'; end if;
    if nullif(p ->> 'proposta', '') is not null then
      select tipo || numero into ja from vendas.documentos
       where empresa = v_emp and tipo = v_tipo and proposta = p ->> 'proposta' and status <> 'cancelado' limit 1;
      if ja is not null then raise exception 'A proposta % já tem o documento %', p ->> 'proposta', ja; end if;
    end if;
    insert into vendas.documentos (empresa, tipo, numero, origem, criado_por, atualizado_por, cliente_codigo)
    values (v_emp, v_tipo, vendas.proximo_numero(v_emp, v_tipo),
            case when p ->> 'origem' = 'crm' then 'crm' else 'painel' end, p_por, p_por, (p ->> 'cliente_codigo')::bigint)
    returning * into d;
  else
    select * into d from vendas.documentos where id = v_id for update;
    if not found then raise exception 'Documento % não encontrado', v_id; end if;
    if d.status <> 'aberto' then raise exception 'O % está %: não pode ser editado', d.tipo || d.numero, d.status; end if;
  end if;

  update vendas.documentos set
    cliente_codigo     = (p ->> 'cliente_codigo')::bigint,
    cliente_nome       = coalesce(v_cli.nome, nullif(p ->> 'cliente_nome', ''), cliente_nome),
    cliente_cnpj       = coalesce(v_cli.cnpj_cpf, nullif(p ->> 'cliente_cnpj', ''), cliente_cnpj),
    proposta           = coalesce(nullif(p ->> 'proposta', ''), proposta),
    num_pedido_cliente = nullif(p ->> 'num_pedido_cliente', ''),
    contato            = nullif(p ->> 'contato', ''),
    previsao           = nullif(p ->> 'previsao', '')::date,
    condicao_codigo    = nullif(p ->> 'condicao_codigo', ''),
    condicao_descricao = (select descricao from sales.formas_pagamento where empresa = v_emp and codigo = p ->> 'condicao_codigo'),
    qtd_parcelas       = nullif(p ->> 'qtd_parcelas', '')::int,
    projeto_codigo     = nullif(p ->> 'projeto_codigo', ''),
    categoria_codigo   = nullif(p ->> 'categoria_codigo', ''),
    vendedor_codigo    = nullif(p ->> 'vendedor_codigo', ''),
    conta_codigo       = nullif(p ->> 'conta_codigo', ''),
    cenario_impostos   = nullif(p ->> 'cenario_impostos', ''),
    consumidor_final   = nullif(p ->> 'consumidor_final', ''),
    observacoes        = nullif(p ->> 'observacoes', ''),
    obs_nf             = nullif(p ->> 'obs_nf', ''),
    valor_desconto     = coalesce(nullif(p ->> 'valor_desconto', '')::numeric, 0),
    valor_frete        = coalesce(nullif(p ->> 'valor_frete', '')::numeric, 0),
    etapa              = coalesce(nullif(p ->> 'etapa', ''), etapa),
    atualizado_por     = p_por, atualizado_em = now()
  where id = d.id;

  delete from vendas.itens where documento_id = d.id;
  for it in select * from jsonb_array_elements(p -> 'itens') loop
    k := k + 1;
    if coalesce(trim(it ->> 'descricao'), '') = '' then raise exception 'Item % sem descrição', k; end if;
    insert into vendas.itens (documento_id, seq, codigo, ncod_prod, descricao, unidade, ncm, cfop, quantidade, valor_unitario, valor_desconto, fiscal)
    values (d.id, k, nullif(it ->> 'codigo', ''), nullif(it ->> 'ncod_prod', '')::bigint, trim(it ->> 'descricao'),
            coalesce(nullif(it ->> 'unidade', ''), 'UN'), nullif(it ->> 'ncm', ''), nullif(it ->> 'cfop', ''),
            coalesce(nullif(it ->> 'quantidade', '')::numeric, 1), coalesce(nullif(it ->> 'valor_unitario', '')::numeric, 0),
            coalesce(nullif(it ->> 'valor_desconto', '')::numeric, 0),
            case when jsonb_typeof(it -> 'fiscal') = 'object' then it -> 'fiscal' end);
  end loop;

  select coalesce(sum(valor_total), 0) into v_merc from vendas.itens where documento_id = d.id;
  update vendas.documentos set valor_mercadorias = v_merc,
         valor_total = v_merc - valor_desconto + valor_frete
   where id = d.id returning * into d;

  delete from vendas.parcelas where documento_id = d.id;
  if jsonb_typeof(p -> 'parcelas') = 'array' and jsonb_array_length(p -> 'parcelas') > 0 then
    insert into vendas.parcelas (documento_id, numero, vencimento, valor, percentual, dias)
    select d.id, coalesce(nullif(x ->> 'numero', '')::int, o::int), (x ->> 'vencimento')::date, (x ->> 'valor')::numeric,
           nullif(x ->> 'percentual', '')::numeric, nullif(x ->> 'dias', '')::int
      from jsonb_array_elements(p -> 'parcelas') with ordinality as t(x, o);
  else
    v_base := coalesce(d.previsao, d.emissao);
    insert into vendas.parcelas (documento_id, numero, vencimento, valor, percentual, dias)
    select d.id, c.numero, c.vencimento, c.valor, c.percentual, c.dias
      from vendas.parcelas_da_condicao(d.empresa, d.condicao_codigo, d.qtd_parcelas, v_base, d.valor_total) c;
  end if;

  insert into vendas.historico (documento_id, por, acao, detalhe)
  values (d.id, p_por, case when v_id is null then 'criado' else 'editado' end,
          jsonb_build_object('valor_total', d.valor_total, 'itens', k, 'origem', d.origem, 'proposta', d.proposta));

  perform vendas.espelhar(d.id);
  return jsonb_build_object('id', d.id, 'tipo', d.tipo, 'numero', d.numero, 'label', d.tipo || d.numero,
                            'codigo', d.codigo, 'valor_total', d.valor_total, 'empresa', d.empresa);
end $$;

-- ── Cancelar ─────────────────────────────────────────────────────────────────
create or replace function orders.vendas_cancelar(p_id bigint, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento'; end if;
  select * into d from vendas.documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if d.status = 'faturado' then raise exception 'O % já foi faturado — cancele a nota primeiro', d.tipo || d.numero; end if;
  if d.status = 'cancelado' then return jsonb_build_object('id', d.id, 'status', d.status); end if;
  update vendas.documentos set status = 'cancelado', cancelado_motivo = p_motivo, atualizado_por = p_por, atualizado_em = now()
   where id = p_id;
  insert into vendas.historico (documento_id, por, acao, detalhe) values (p_id, p_por, 'cancelado', jsonb_build_object('motivo', p_motivo));
  perform vendas.espelhar(p_id);
  return jsonb_build_object('id', p_id, 'status', 'cancelado');
end $$;

-- ── Marcar faturado (para o faturamento pela Focus — P5) ─────────────────────
create or replace function orders.vendas_marcar_faturado(p_id bigint, p_nf text, p_chave text, p_dt date, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if d.status = 'cancelado' then raise exception 'O % está cancelado', d.tipo || d.numero; end if;
  update vendas.documentos set status = 'faturado', etapa = '60', nf = p_nf, chave_nfe = p_chave,
         dt_fat = coalesce(p_dt, (now() at time zone 'America/Sao_Paulo')::date), atualizado_por = p_por, atualizado_em = now()
   where id = p_id;
  insert into vendas.historico (documento_id, por, acao, detalhe)
  values (p_id, p_por, 'faturado', jsonb_build_object('nf', p_nf, 'chave', p_chave, 'dt', p_dt));
  perform vendas.espelhar(p_id);
  return jsonb_build_object('id', p_id, 'status', 'faturado');
end $$;

-- ── Lista e consultas ────────────────────────────────────────────────────────
create or replace function orders.vendas_lista(p_empresa text default null, p_desde date default null)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'empresa', d.empresa, 'tipo', d.tipo, 'numero', d.numero, 'label', d.tipo || d.numero,
    'status', d.status, 'cliente', coalesce(nullif(c.nome_fantasia, ''), c.razao_social, d.cliente_nome),
    'proposta', d.proposta, 'emissao', d.emissao, 'previsao', d.previsao, 'valor_total', d.valor_total,
    'origem', d.origem, 'nf', d.nf) order by d.id desc), '[]')
  from vendas.documentos d
  left join finance.clientes c on c.empresa = d.empresa and c.codigo_cliente_omie = d.cliente_codigo
  where (p_empresa is null or d.empresa = p_empresa) and (p_desde is null or d.emissao >= p_desde)
$$;

create or replace function orders.vendas_da_proposta(p_empresa text, p_proposta text)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero, 'label', tipo || numero,
                  'codigo', codigo, 'status', status, 'valor_total', valor_total) order by id), '[]')
  from vendas.documentos where empresa = p_empresa and proposta = p_proposta and status <> 'cancelado'
$$;

create or replace function orders.vendas_config(p_empresa text)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce((select jsonb_build_object('empresa', empresa, 'pv_os_nativo', pv_os_nativo,
                   'atualizado_em', atualizado_em, 'atualizado_por', atualizado_por)
                   from vendas.config where empresa = upper(p_empresa)),
                  jsonb_build_object('empresa', upper(p_empresa), 'pv_os_nativo', false))
$$;

create or replace function orders.vendas_config_definir(p_empresa text, p_nativo boolean, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
begin
  insert into vendas.config (empresa, pv_os_nativo, atualizado_em, atualizado_por)
  values (upper(p_empresa), p_nativo, now(), p_por)
  on conflict (empresa) do update set pv_os_nativo = excluded.pv_os_nativo, atualizado_em = now(), atualizado_por = p_por;
  return orders.vendas_config(p_empresa);
end $$;

-- Apaga um documento de TESTE (nome do cliente/observação com "TESTE E2E"), com espelho e RCs ligadas não incluídas.
create or replace function orders.vendas_apagar_teste(p_id bigint)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id;
  if not found then return jsonb_build_object('ok', false); end if;
  if coalesce(d.observacoes, '') !~* 'TESTE E2E' then raise exception 'Só documentos de teste (observação com TESTE E2E) podem ser apagados'; end if;
  perform vendas.desespelhar(p_id);
  delete from vendas.documentos where id = p_id;
  -- devolve o número se era o último
  update vendas.numeracao set ultimo = ultimo - 1 where empresa = d.empresa and tipo = d.tipo and ultimo = d.numero::bigint;
  return jsonb_build_object('ok', true, 'apagado', d.tipo || d.numero);
end $$;

-- Atualiza a lista de Avulsos na hora (o cron faz a cada 10 min).
create or replace function orders.vendas_refrescar()
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    refresh materialized view concurrently sales.mv_pc_avulsos;
  exception when others then
    refresh materialized view sales.mv_pc_avulsos;
  end;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'vendas.proximo_numero(text,text)', 'vendas.parcelas_da_condicao(text,text,integer,date,numeric)',
    'vendas.espelhar(bigint)', 'vendas.desespelhar(bigint)',
    'orders.vendas_documento(bigint)', 'orders.vendas_salvar(jsonb,text)', 'orders.vendas_cancelar(bigint,text,text)',
    'orders.vendas_marcar_faturado(bigint,text,text,date,text)', 'orders.vendas_lista(text,date)',
    'orders.vendas_da_proposta(text,text)', 'orders.vendas_config(text)', 'orders.vendas_config_definir(text,boolean,text)',
    'orders.vendas_apagar_teste(bigint)', 'orders.vendas_refrescar()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 49d: clientes do cadastro próprio (P2) + faturamento pela Focus (P5) ──────
-- O cliente do PV/OS é cadastros.pessoas.codigo (P2): os do Omie mantêm o
-- código do Omie; os novos começam em 90.000.000.001. As views de Avulsos e de
-- vendas resolvem o nome por finance.clientes — por isso um cliente NOVO usado
-- num PV/OS é espelhado lá (código >= 90e9, que o sync do Omie nunca toca).

create or replace function vendas.espelhar_cliente(p_emp text, p_codigo bigint)
returns void language plpgsql security definer set search_path = vendas, public as $$
declare p cadastros.pessoas;
begin
  if p_codigo is null or p_codigo < 90000000000 then return; end if;
  select * into p from cadastros.pessoas where empresa = p_emp and codigo = p_codigo;
  if not found then return; end if;
  insert into finance.clientes as k (
    empresa, codigo_cliente_omie, codigo_cliente_integracao, razao_social, nome_fantasia, cnpj_cpf, contato,
    endereco, endereco_numero, complemento, bairro, cidade, estado, cep, email, inscricao_estadual,
    inscricao_municipal, pessoa_fisica, optante_simples_nacional, contribuinte, inativo, cidade_ibge, tags, synced_at)
  values (
    p.empresa, p.codigo, 'painel:' || p.id, p.razao_social, p.nome_fantasia, p.cnpj_cpf, p.contato,
    p.logradouro, p.numero, p.complemento, p.bairro, p.cidade, p.uf, p.cep, coalesce(p.email_nfe, p.email),
    p.inscricao_estadual, p.inscricao_municipal, case when p.pessoa_fisica then 'S' else 'N' end,
    case p.optante_simples when true then 'S' when false then 'N' end, p.contribuinte,
    case when p.ativo then 'N' else 'S' end, p.cidade_ibge, 'painel', now())
  on conflict (empresa, codigo_cliente_omie) do update set
    razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia, cnpj_cpf = excluded.cnpj_cpf,
    contato = excluded.contato, endereco = excluded.endereco, endereco_numero = excluded.endereco_numero,
    complemento = excluded.complemento, bairro = excluded.bairro, cidade = excluded.cidade, estado = excluded.estado,
    cep = excluded.cep, email = excluded.email, inscricao_estadual = excluded.inscricao_estadual,
    inscricao_municipal = excluded.inscricao_municipal, pessoa_fisica = excluded.pessoa_fisica,
    optante_simples_nacional = excluded.optante_simples_nacional, contribuinte = excluded.contribuinte,
    inativo = excluded.inativo, cidade_ibge = excluded.cidade_ibge, synced_at = now();
end $$;

-- O passo 1 do sync de cadastros (P2) liga um cadastro nativo ao Omie pelo
-- CNPJ; os espelhos acima (código >= 90e9) não são do Omie e ficam de fora.
do $$
declare def text;
begin
  def := pg_get_functiondef('orders.cadastros_sync_omie'::regproc);
  if position('codigo_cliente_omie < 90000000000' in def) = 0 then
    def := replace(def, E'      from finance.clientes k\n  )', E'      from finance.clientes k\n     where k.codigo_cliente_omie < 90000000000\n  )');
    if position('codigo_cliente_omie < 90000000000' in def) = 0 then
      raise exception 'cadastros_sync_omie mudou — ajuste o filtro dos espelhos à mão';
    end if;
    execute def;
  end if;
end $$;

-- espelhar(): agora também garante o cliente nativo no espelho.
do $$
declare def text;
begin
  def := pg_get_functiondef('vendas.espelhar(bigint)'::regprocedure);
  if position('vendas.espelhar_cliente' in def) = 0 then
    def := replace(def, E'  if not found then return; end if;\n  br   :=',
                        E'  if not found then return; end if;\n  perform vendas.espelhar_cliente(d.empresa, d.cliente_codigo);\n  br   :=');
    if position('vendas.espelhar_cliente' in def) = 0 then raise exception 'espelhar: ponto de inserção não encontrado'; end if;
    execute def;
  end if;
end $$;

-- Cliente: cadastro próprio (P2) primeiro, espelho do Omie como reserva.
create or replace function vendas.cliente(p_emp text, p_codigo bigint)
returns table (codigo bigint, nome text, razao text, cnpj text, cidade text, uf text)
language sql stable security definer set search_path = vendas, public as $$
  select p.codigo, coalesce(nullif(p.nome_fantasia, ''), p.razao_social), p.razao_social, p.cnpj_cpf, p.cidade, p.uf
    from cadastros.pessoas p where p.empresa = p_emp and (p.codigo = p_codigo or p.codigo_omie = p_codigo)
  union all
  select k.codigo_cliente_omie, coalesce(nullif(k.nome_fantasia, ''), k.razao_social), k.razao_social, k.cnpj_cpf, k.cidade, k.estado
    from finance.clientes k where k.empresa = p_emp and k.codigo_cliente_omie = p_codigo
     and not exists (select 1 from cadastros.pessoas p where p.empresa = p_emp and (p.codigo = p_codigo or p.codigo_omie = p_codigo))
  limit 1
$$;

do $$
declare def text;
begin
  def := pg_get_functiondef('orders.vendas_salvar(jsonb,text)'::regprocedure);
  def := replace(def,
    E'  select codigo_cliente_omie, coalesce(nullif(nome_fantasia, \'\'), razao_social) nome, cnpj_cpf\n    into v_cli from finance.clientes where empresa = v_emp and codigo_cliente_omie = (p ->> \'cliente_codigo\')::bigint;',
    E'  select c.codigo, c.nome, c.cnpj as cnpj_cpf into v_cli from vendas.cliente(v_emp, (p ->> \'cliente_codigo\')::bigint) c;\n  if v_cli.codigo is null then raise exception \'Cliente % não está no cadastro\', p ->> \'cliente_codigo\'; end if;');
  if position('vendas.cliente(' in def) = 0 then raise exception 'vendas_salvar: ponto de troca não encontrado'; end if;
  execute def;
end $$;

create or replace function orders.vendas_documento(p_id bigint)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select to_jsonb(d) || jsonb_build_object(
    'label', d.tipo || d.numero,
    'cliente', coalesce(c.nome, d.cliente_nome),
    'cliente_razao', c.razao,
    'cnpj', coalesce(c.cnpj, d.cliente_cnpj),
    'cidade', c.cidade, 'uf', c.uf,
    'projeto', pj.nome, 'categoria', cat.descricao,
    'condicao', coalesce(fp.descricao, d.condicao_descricao),
    'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.seq) from vendas.itens i where i.documento_id = d.id), '[]'),
    'parcelas', coalesce((select jsonb_agg(to_jsonb(p) order by p.numero) from vendas.parcelas p where p.documento_id = d.id), '[]'),
    'historico', coalesce((select jsonb_agg(to_jsonb(h) order by h.em desc) from vendas.historico h where h.documento_id = d.id), '[]'),
    'rcs', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'num', cp.numero, 'tipo', cp.tipo))
                       from compras.pedidos cp where cp.empresa = d.empresa and not coalesce(cp.cancelado, false)
                        and (cp.pv_os = d.tipo || d.numero or cp.pv_os_painel = d.tipo || d.numero)), '[]'),
    'emissoes', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'ambiente', e.ambiente,
                            'status', e.status, 'numero', e.numero, 'mensagem', e.mensagem) order by e.id desc)
                            from orders.fat_emissoes e
                           where e.origem_tipo in ('pv', 'os', 'venda') and e.origem_id = d.id::text), '[]')
  )
  from vendas.documentos d
  left join lateral vendas.cliente(d.empresa, d.cliente_codigo) c on true
  left join finance.projetos pj on pj.empresa = d.empresa and pj.codigo::text = d.projeto_codigo
  left join finance.categorias cat on cat.empresa = d.empresa and cat.codigo = d.categoria_codigo
  left join sales.formas_pagamento fp on fp.empresa = d.empresa and fp.codigo = d.condicao_codigo
  where d.id = p_id
$$;

create or replace function orders.vendas_lista(p_empresa text default null, p_desde date default null)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'empresa', d.empresa, 'tipo', d.tipo, 'numero', d.numero, 'label', d.tipo || d.numero,
    'status', d.status, 'cliente', coalesce(c.nome, d.cliente_nome),
    'proposta', d.proposta, 'emissao', d.emissao, 'previsao', d.previsao, 'valor_total', d.valor_total,
    'origem', d.origem, 'nf', d.nf) order by d.id desc), '[]')
  from vendas.documentos d
  left join lateral vendas.cliente(d.empresa, d.cliente_codigo) c on true
  where (p_empresa is null or d.empresa = p_empresa) and (p_desde is null or d.emissao >= p_desde)
$$;

-- ── Faturamento (P5): marcar e desfazer ──────────────────────────────────────
-- p_doc: { emissao_id, tipo (nfe|nfse|recibo), numero, chave, ambiente }
-- Em homologação só documentos de TESTE (observação com "TESTE E2E") mudam de
-- status; os reais ficam só com a anotação no histórico.
create or replace function orders.vendas_marcar_faturado(p_id bigint, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos; amb text := coalesce(p_doc ->> 'ambiente', 'producao');
begin
  select * into d from vendas.documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if d.status = 'cancelado' then raise exception 'O % está cancelado', d.tipo || d.numero; end if;
  if amb <> 'producao' and coalesce(d.observacoes, '') !~* 'TESTE E2E' then
    insert into vendas.historico (documento_id, por, acao, detalhe) values (p_id, 'faturamento', 'nf_homologacao', p_doc);
    return jsonb_build_object('id', p_id, 'status', d.status, 'homologacao', true);
  end if;
  update vendas.documentos set status = 'faturado', etapa = '60', nf = p_doc ->> 'numero', chave_nfe = p_doc ->> 'chave',
         dt_fat = (now() at time zone 'America/Sao_Paulo')::date, atualizado_por = 'faturamento', atualizado_em = now()
   where id = p_id;
  insert into vendas.historico (documento_id, por, acao, detalhe) values (p_id, 'faturamento', 'faturado', p_doc);
  perform vendas.espelhar(p_id);
  return jsonb_build_object('id', p_id, 'status', 'faturado');
end $$;

create or replace function orders.vendas_desfazer_faturado(p_id bigint, p_doc jsonb)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if d.status <> 'faturado' then
    insert into vendas.historico (documento_id, por, acao, detalhe) values (p_id, 'faturamento', 'nf_cancelada', p_doc);
    return jsonb_build_object('id', p_id, 'status', d.status);
  end if;
  update vendas.documentos set status = 'aberto', etapa = '50', nf = null, chave_nfe = null, dt_fat = null,
         atualizado_por = 'faturamento', atualizado_em = now()
   where id = p_id;
  insert into vendas.historico (documento_id, por, acao, detalhe) values (p_id, 'faturamento', 'faturamento_desfeito', p_doc);
  perform vendas.espelhar(p_id);
  return jsonb_build_object('id', p_id, 'status', 'aberto');
end $$;

-- Apagar teste: também tira o cliente-espelho de teste e as emissões de homologação.
create or replace function orders.vendas_apagar_teste(p_id bigint)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id;
  if not found then return jsonb_build_object('ok', false); end if;
  if coalesce(d.observacoes, '') !~* 'TESTE E2E' then raise exception 'Só documentos de teste (observação com TESTE E2E) podem ser apagados'; end if;
  perform vendas.desespelhar(p_id);
  delete from vendas.documentos where id = p_id;
  update vendas.numeracao set ultimo = ultimo - 1 where empresa = d.empresa and tipo = d.tipo and ultimo = d.numero::bigint;
  return jsonb_build_object('ok', true, 'apagado', d.tipo || d.numero);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'vendas.espelhar_cliente(text,bigint)', 'vendas.cliente(text,bigint)', 'vendas.espelhar(bigint)',
    'orders.vendas_salvar(jsonb,text)', 'orders.vendas_documento(bigint)', 'orders.vendas_lista(text,date)',
    'orders.vendas_marcar_faturado(bigint,jsonb)', 'orders.vendas_desfazer_faturado(bigint,jsonb)',
    'orders.vendas_apagar_teste(bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 49e: o documento traz o cadastro do cliente (para montar a NF no faturamento).
do $$
declare def text;
begin
  def := pg_get_functiondef('orders.vendas_documento(bigint)'::regprocedure);
  if position('''pessoa''' in def) = 0 then
    def := replace(def, E'    ''emissoes'', coalesce(',
      E'    ''pessoa'', (select to_jsonb(pp) - ''contatos'' from cadastros.pessoas pp where pp.empresa = d.empresa\n                   and (pp.codigo = d.cliente_codigo or pp.codigo_omie = d.cliente_codigo) order by (pp.codigo = d.cliente_codigo) desc limit 1),\n    ''emissoes'', coalesce(');
    if position('''pessoa''' in def) = 0 then raise exception 'vendas_documento: ponto não encontrado'; end if;
    execute def;
  end if;
end $$;
