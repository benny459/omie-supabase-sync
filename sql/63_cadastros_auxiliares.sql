-- 63_cadastros_auxiliares.sql — todos os cadastros do Omie vivem no painel (05/10/26)
--
-- Pedido do Benny: "preciso ter todos os cadastros que tínhamos no Omie e já a
-- possibilidade de criarmos novos (fechamos um projeto novo e já quero cadastrar)".
--
-- Modelo: uma tabela só, cadastros.aux, para os cadastros auxiliares
--   projetos · contas (bancos/caixas) · categorias · centros_custo (departamentos)
--   · condicoes (formas/parcelas) · tipos_documento · vendedores · servicos (LC116)
--   · unidades · empresas
-- Cada linha guarda o código (o do Omie, ou um nativo) e o resto em `dados`.
--
-- Os ~40 lugares do painel que já liam os espelhos do Omie (finance.projetos,
-- finance.contas_correntes, finance.categorias, compras.cad_departamentos,
-- sales.formas_pagamento, …) continuam a ler os mesmos espelhos: o que nasce ou é
-- editado no painel é ESCRITO nesses espelhos ("espelhar"), com códigos nativos
-- fora da faixa do Omie, e um gatilho impede o sync do Omie de desfazer edições
-- feitas no painel. Assim um projeto novo aparece na hora no PC, no PV/OS, nos
-- títulos, no BI e na rentabilidade, sem mexer em cada tela.
--
-- Nada é escrito no Omie.


-- ─── espelhos novos (o Omie não tinha espelho destes) ──────────────────────────
create table if not exists finance.vendedores (
  empresa text not null, codigo bigint not null, nome text, email text,
  comissao numeric, inativo text, raw jsonb, synced_at timestamptz default now(),
  primary key (empresa, codigo));
create table if not exists sales.servicos_cadastro (
  empresa text not null, codigo bigint not null, descricao text, cod_lc116 text,
  cod_servico_municipio text, aliquota_iss numeric, inativo text, raw jsonb,
  synced_at timestamptz default now(), primary key (empresa, codigo));
alter table finance.vendedores enable row level security;
alter table sales.servicos_cadastro enable row level security;
revoke all on finance.vendedores, sales.servicos_cadastro from anon, authenticated;
grant all on finance.vendedores, sales.servicos_cadastro to service_role;

-- ─── o cadastro nativo ─────────────────────────────────────────────────────────
create table if not exists cadastros.aux (
  id bigserial primary key,
  registro text not null check (registro in ('projetos','contas','categorias','centros_custo',
    'condicoes','tipos_documento','vendedores','servicos','unidades','empresas')),
  empresa text not null,                      -- SF/CD/WW, ou '*' nos cadastros globais
  codigo text not null,
  omie_codigo text,
  nome text not null,
  nome_norm text,
  dados jsonb not null default '{}'::jsonb,
  inativo boolean not null default false,
  origem text not null default 'omie' check (origem in ('omie','painel')),
  editado_no_painel boolean not null default false,
  criado_em timestamptz not null default now(), criado_por text,
  atualizado_em timestamptz not null default now(), atualizado_por text,
  unique (registro, empresa, codigo));
create index if not exists aux_reg_emp_norm on cadastros.aux (registro, empresa, nome_norm);
create index if not exists aux_nome_trgm on cadastros.aux using gin (nome public.gin_trgm_ops);

create table if not exists cadastros.aux_hist (
  id bigserial primary key, aux_id bigint, registro text, empresa text, codigo text,
  acao text, antes jsonb, depois jsonb, motivo text, por text, em timestamptz not null default now());
create index if not exists aux_hist_aux on cadastros.aux_hist (aux_id, em desc);

create sequence if not exists cadastros.aux_codigo_seq;      -- códigos numéricos nativos (9e12 + n)
create sequence if not exists cadastros.aux_condicao_seq;    -- N001, N002…
create sequence if not exists cadastros.aux_tipodoc_seq;

alter table cadastros.aux enable row level security;
alter table cadastros.aux_hist enable row level security;
revoke all on cadastros.aux, cadastros.aux_hist from anon, authenticated;
grant all on cadastros.aux, cadastros.aux_hist to service_role;
grant usage on sequence cadastros.aux_codigo_seq, cadastros.aux_condicao_seq, cadastros.aux_tipodoc_seq to service_role;

create or replace function cadastros.aux_global(p_reg text) returns boolean
language sql immutable as $$ select p_reg in ('tipos_documento','unidades','empresas') $$;

-- "28/56/84 dias" → {28,56,84}; "A Vista" → {0}; "3 Parcelas" (sem dias) → null
create or replace function cadastros.aux_dias(p_desc text) returns int[]
language sql immutable as $$
  select case
    when p_desc ~* 'vista' then array[0]
    when p_desc ~* 'parcela' and p_desc !~ '\d+\s*/' then null
    else (select nullif(array_agg(m[1]::int order by o), '{}')
            from regexp_matches(coalesce(p_desc,''), '(\d{1,3})', 'g') with ordinality r(m, o)
           where m[1]::int <= 720)
  end $$;

-- ─── valores das colunas do espelho a partir da linha nativa ───────────────────
create or replace function cadastros.aux_espelho_json(p_tab text, a cadastros.aux) returns jsonb
language plpgsql stable as $$
declare d jsonb := a.dados; sn text := case when a.inativo then 'S' else 'N' end;
begin
  case p_tab
  when 'finance.projetos' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo::bigint, 'nome', a.nome,
      'inativo', sn, 'cod_int', d->>'cod_int');
  when 'finance.contas_correntes' then
    return jsonb_build_object('empresa', a.empresa, 'cod_cc', a.codigo::bigint, 'descricao', a.nome,
      'tipo_conta_corrente', coalesce(d->>'tipo','CC'), 'codigo_banco', d->>'banco',
      'codigo_agencia', d->>'agencia', 'numero_conta_corrente', d->>'conta',
      'saldo_inicial', nullif(d->>'saldo_inicial','')::numeric,
      'saldo_data', case when d->>'saldo_data' ~ '^\d{4}-\d{2}-\d{2}$'
                         then to_char((d->>'saldo_data')::date, 'DD/MM/YYYY') else d->>'saldo_data' end,
      'valor_limite', nullif(d->>'limite','')::numeric, 'inativo', sn, 'observacao', d->>'obs',
      'nome_gerente', d->>'gerente', 'telefone', d->>'telefone', 'email', d->>'email');
  when 'finance.categorias' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo, 'descricao', a.nome,
      'descricao_padrao', coalesce(d->>'descricao_padrao', a.nome), 'conta_inativa', sn,
      'categoria_superior', d->>'superior',
      'totalizadora', case when (d->>'totalizadora')::boolean then 'S' else 'N' end,
      'conta_receita', case when (d->>'receita')::boolean then 'S' else 'N' end,
      'conta_despesa', case when (d->>'despesa')::boolean then 'S' else 'N' end,
      'natureza', d->>'natureza', 'tipo_categoria', d->>'tipo', 'codigo_dre', d->>'codigo_dre');
  when 'sales.categorias' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo, 'descricao', a.nome,
      'conta_receita', case when (d->>'receita')::boolean then 'S' else 'N' end,
      'conta_despesa', case when (d->>'despesa')::boolean then 'S' else 'N' end);
  when 'compras.cad_departamentos' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo, 'descricao', a.nome, 'inativo', a.inativo);
  when 'sales.formas_pagamento', 'orders.formas_pagamento_vendas', 'orders.formas_pagamento_compras' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo, 'descricao', a.nome,
      'num_parcelas', nullif(d->>'n_parcelas','')::numeric);
  when 'finance.parcelas' then
    return jsonb_build_object('codigo', a.codigo, 'descricao', a.nome, 'n_parcelas', nullif(d->>'n_parcelas','')::numeric);
  when 'finance.tipos_documento' then
    return jsonb_build_object('codigo', a.codigo, 'descricao', a.nome);
  when 'orders.unidades' then
    return jsonb_build_object('sigla', a.codigo, 'descricao', a.nome);
  when 'finance.vendedores' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo::bigint, 'nome', a.nome,
      'email', d->>'email', 'comissao', nullif(d->>'comissao','')::numeric, 'inativo', sn);
  when 'sales.servicos_cadastro' then
    return jsonb_build_object('empresa', a.empresa, 'codigo', a.codigo::bigint, 'descricao', a.nome,
      'cod_lc116', d->>'lc116', 'cod_servico_municipio', d->>'cod_municipio',
      'aliquota_iss', nullif(d->>'aliquota_iss','')::numeric, 'inativo', sn);
  when 'compras.cad_empresas' then
    return jsonb_build_object('empresa', a.codigo, 'razao_social', a.nome, 'nome_fantasia', d->>'fantasia',
      'cnpj', d->>'cnpj', 'ie', d->>'ie', 'im', d->>'im', 'endereco', d->>'endereco', 'numero', d->>'numero',
      'complemento', d->>'complemento', 'bairro', d->>'bairro', 'cidade', d->>'cidade', 'uf', d->>'uf',
      'cep', d->>'cep', 'telefone', d->>'telefone', 'email', d->>'email');
  else return null;
  end case;
end $$;

-- ─── escreve a linha nativa nos espelhos que as telas leem ────────────────────
create or replace function cadastros.aux_espelhar(p_id bigint) returns void
language plpgsql security definer set search_path = cadastros, public as $$
declare a cadastros.aux; j jsonb; e text;
begin
  select * into a from cadastros.aux where id = p_id;
  if not found then return; end if;
  perform set_config('cadastros.aux_espelhando', '1', true);
  case a.registro
  when 'projetos' then
    j := cadastros.aux_espelho_json('finance.projetos', a);
    insert into finance.projetos (empresa, codigo, nome, inativo, cod_int, synced_at)
    values (a.empresa, (j->>'codigo')::bigint, j->>'nome', j->>'inativo', j->>'cod_int', now())
    on conflict (empresa, codigo) do update set nome = excluded.nome, inativo = excluded.inativo,
      cod_int = coalesce(excluded.cod_int, finance.projetos.cod_int);
  when 'contas' then
    j := cadastros.aux_espelho_json('finance.contas_correntes', a);
    insert into finance.contas_correntes (empresa, cod_cc, descricao, tipo_conta_corrente, codigo_banco,
      codigo_agencia, numero_conta_corrente, saldo_inicial, saldo_data, valor_limite, inativo, observacao,
      nome_gerente, telefone, email, synced_at)
    select empresa, cod_cc, descricao, tipo_conta_corrente, codigo_banco, codigo_agencia, numero_conta_corrente,
      saldo_inicial, saldo_data, valor_limite, inativo, observacao, nome_gerente, telefone, email, now()
      from jsonb_populate_record(null::finance.contas_correntes, j)
    on conflict (empresa, cod_cc) do update set descricao = excluded.descricao,
      tipo_conta_corrente = excluded.tipo_conta_corrente, codigo_banco = excluded.codigo_banco,
      codigo_agencia = excluded.codigo_agencia, numero_conta_corrente = excluded.numero_conta_corrente,
      saldo_inicial = excluded.saldo_inicial, saldo_data = excluded.saldo_data, valor_limite = excluded.valor_limite,
      inativo = excluded.inativo, observacao = excluded.observacao, nome_gerente = excluded.nome_gerente,
      telefone = excluded.telefone, email = excluded.email;
  when 'categorias' then
    j := cadastros.aux_espelho_json('finance.categorias', a);
    insert into finance.categorias (empresa, codigo, descricao, descricao_padrao, conta_inativa, categoria_superior,
      totalizadora, conta_receita, conta_despesa, natureza, tipo_categoria, codigo_dre, synced_at)
    select empresa, codigo, descricao, descricao_padrao, conta_inativa, categoria_superior, totalizadora,
      conta_receita, conta_despesa, natureza, tipo_categoria, codigo_dre, now()
      from jsonb_populate_record(null::finance.categorias, j)
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, conta_inativa = excluded.conta_inativa,
      categoria_superior = excluded.categoria_superior, totalizadora = excluded.totalizadora,
      conta_receita = excluded.conta_receita, conta_despesa = excluded.conta_despesa;
    j := cadastros.aux_espelho_json('sales.categorias', a);
    insert into sales.categorias (empresa, codigo, descricao, conta_receita, conta_despesa, synced_at)
    values (a.empresa, a.codigo, j->>'descricao', j->>'conta_receita', j->>'conta_despesa', now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao,
      conta_receita = excluded.conta_receita, conta_despesa = excluded.conta_despesa;
  when 'centros_custo' then
    insert into compras.cad_departamentos (empresa, codigo, descricao, inativo, synced_at)
    values (a.empresa, a.codigo, a.nome, a.inativo, now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, inativo = excluded.inativo;
  when 'condicoes' then
    insert into sales.formas_pagamento (empresa, codigo, descricao, num_parcelas, synced_at)
    values (a.empresa, a.codigo, a.nome, nullif(a.dados->>'n_parcelas','')::numeric, now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, num_parcelas = excluded.num_parcelas;
    insert into orders.formas_pagamento_vendas (empresa, codigo, descricao, num_parcelas, synced_at)
    values (a.empresa, a.codigo, a.nome, nullif(a.dados->>'n_parcelas','')::numeric, now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, num_parcelas = excluded.num_parcelas;
    insert into orders.formas_pagamento_compras (empresa, codigo, descricao, num_parcelas, synced_at)
    values (a.empresa, a.codigo, a.nome, nullif(a.dados->>'n_parcelas','')::numeric, now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, num_parcelas = excluded.num_parcelas;
    insert into finance.parcelas (codigo, descricao, n_parcelas, synced_at)
    values (a.codigo, a.nome, nullif(a.dados->>'n_parcelas','')::numeric, now())
    on conflict (codigo) do nothing;
  when 'tipos_documento' then
    insert into finance.tipos_documento (codigo, descricao, synced_at) values (a.codigo, a.nome, now())
    on conflict (codigo) do update set descricao = excluded.descricao;
  when 'unidades' then
    foreach e in array array['SF','CD','WW'] loop
      insert into orders.unidades (empresa, sigla, descricao, synced_at) values (e, a.codigo, a.nome, now())
      on conflict (empresa, sigla) do update set descricao = excluded.descricao;
    end loop;
  when 'vendedores' then
    insert into finance.vendedores (empresa, codigo, nome, email, comissao, inativo, synced_at)
    values (a.empresa, a.codigo::bigint, a.nome, a.dados->>'email', nullif(a.dados->>'comissao','')::numeric,
            case when a.inativo then 'S' else 'N' end, now())
    on conflict (empresa, codigo) do update set nome = excluded.nome, email = excluded.email,
      comissao = excluded.comissao, inativo = excluded.inativo;
  when 'servicos' then
    insert into sales.servicos_cadastro (empresa, codigo, descricao, cod_lc116, cod_servico_municipio, aliquota_iss, inativo, synced_at)
    values (a.empresa, a.codigo::bigint, a.nome, a.dados->>'lc116', a.dados->>'cod_municipio',
            nullif(a.dados->>'aliquota_iss','')::numeric, case when a.inativo then 'S' else 'N' end, now())
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, cod_lc116 = excluded.cod_lc116,
      cod_servico_municipio = excluded.cod_servico_municipio, aliquota_iss = excluded.aliquota_iss, inativo = excluded.inativo;
  when 'empresas' then
    j := cadastros.aux_espelho_json('compras.cad_empresas', a);
    insert into compras.cad_empresas (empresa, razao_social, nome_fantasia, cnpj, ie, im, endereco, numero,
      complemento, bairro, cidade, uf, cep, telefone, email, synced_at)
    select empresa, razao_social, nome_fantasia, cnpj, ie, im, endereco, numero, complemento, bairro, cidade,
      uf, cep, telefone, email, now() from jsonb_populate_record(null::compras.cad_empresas, j)
    on conflict (empresa) do update set razao_social = excluded.razao_social, nome_fantasia = excluded.nome_fantasia,
      cnpj = excluded.cnpj, ie = excluded.ie, im = excluded.im, endereco = excluded.endereco, numero = excluded.numero,
      complemento = excluded.complemento, bairro = excluded.bairro, cidade = excluded.cidade, uf = excluded.uf,
      cep = excluded.cep, telefone = excluded.telefone, email = excluded.email;
  end case;
  perform set_config('cadastros.aux_espelhando', '0', true);
end $$;

-- ─── o sync do Omie não desfaz o que foi editado no painel ────────────────────
create or replace function cadastros.tg_aux_protege() returns trigger
language plpgsql security definer set search_path = cadastros, public as $$
declare reg text; emp text; cod text; a cadastros.aux; j jsonb;
        tab text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
begin
  if current_setting('cadastros.aux_espelhando', true) = '1' then return NEW; end if;
  case tab
    when 'finance.projetos' then reg := 'projetos'; emp := NEW.empresa; cod := NEW.codigo::text;
    when 'finance.contas_correntes' then reg := 'contas'; emp := NEW.empresa; cod := NEW.cod_cc::text;
    when 'finance.categorias' then reg := 'categorias'; emp := NEW.empresa; cod := NEW.codigo;
    when 'sales.categorias' then reg := 'categorias'; emp := NEW.empresa; cod := NEW.codigo;
    when 'compras.cad_departamentos' then reg := 'centros_custo'; emp := NEW.empresa; cod := NEW.codigo;
    when 'sales.formas_pagamento' then reg := 'condicoes'; emp := NEW.empresa; cod := NEW.codigo;
    when 'finance.tipos_documento' then reg := 'tipos_documento'; emp := '*'; cod := NEW.codigo;
    when 'compras.cad_empresas' then reg := 'empresas'; emp := '*'; cod := NEW.empresa;
    when 'finance.vendedores' then reg := 'vendedores'; emp := NEW.empresa; cod := NEW.codigo::text;
    when 'sales.servicos_cadastro' then reg := 'servicos'; emp := NEW.empresa; cod := NEW.codigo::text;
    else return NEW;
  end case;
  select * into a from cadastros.aux x where x.registro = reg and x.empresa = emp and x.codigo = cod and x.editado_no_painel;
  if not found then return NEW; end if;
  j := cadastros.aux_espelho_json(tab, a);
  if j is null then return NEW; end if;
  NEW := jsonb_populate_record(NEW, j);
  return NEW;
end $$;

do $$ declare t text; begin
  foreach t in array array['finance.projetos','finance.contas_correntes','finance.categorias','sales.categorias',
    'compras.cad_departamentos','sales.formas_pagamento','finance.tipos_documento','compras.cad_empresas',
    'finance.vendedores','sales.servicos_cadastro'] loop
    execute format('drop trigger if exists aux_protege on %s', t);
    execute format('create trigger aux_protege before insert or update on %s for each row execute function cadastros.tg_aux_protege()', t);
  end loop;
end $$;

-- ─── espelho do Omie → cadastro nativo (de hora em hora) ──────────────────────
create or replace function orders.cad_aux_sync_omie() returns jsonb
language plpgsql security definer set search_path = cadastros, public as $$
declare n int; tot jsonb := '{}'::jsonb;
begin
  -- staging comum: (registro, empresa, codigo, nome, dados, inativo)
  create temp table if not exists _aux_src (registro text, empresa text, codigo text, nome text, dados jsonb, inativo boolean) on commit drop;
  truncate _aux_src;

  insert into _aux_src
  select 'projetos', empresa, codigo::text, coalesce(nullif(trim(nome),''), codigo::text),
         jsonb_strip_nulls(jsonb_build_object('cod_int', nullif(cod_int,''))), coalesce(inativo,'N') = 'S'
    from finance.projetos where codigo < 9000000000000;
  insert into _aux_src
  select 'contas', empresa, cod_cc::text, coalesce(nullif(trim(descricao),''), cod_cc::text),
         jsonb_strip_nulls(jsonb_build_object('tipo', tipo_conta_corrente, 'banco', nullif(codigo_banco,''),
           'agencia', nullif(codigo_agencia,''), 'conta', nullif(numero_conta_corrente,''), 'saldo_inicial', saldo_inicial,
           'saldo_data', case when saldo_data ~ '^\d{2}/\d{2}/\d{4}$' then to_char(to_date(saldo_data,'DD/MM/YYYY'),'YYYY-MM-DD') else nullif(saldo_data,'') end,
           'limite', valor_limite, 'obs', nullif(observacao,''), 'gerente', nullif(nome_gerente,''),
           'telefone', nullif(telefone,''), 'email', nullif(email,''))),
         coalesce(inativo,'N') = 'S'
    from finance.contas_correntes where cod_cc < 9000000000000;
  insert into _aux_src
  select 'categorias', empresa, codigo, coalesce(nullif(trim(descricao),''), codigo),
         jsonb_strip_nulls(jsonb_build_object('superior', nullif(categoria_superior,''),
           'totalizadora', totalizadora = 'S', 'receita', conta_receita = 'S', 'despesa', conta_despesa = 'S',
           'natureza', nullif(natureza,''), 'tipo', nullif(tipo_categoria,''), 'codigo_dre', nullif(codigo_dre,''),
           'descricao_padrao', nullif(descricao_padrao,''), 'transferencia', transferencia = 'S')),
         coalesce(conta_inativa,'N') = 'S'
    from finance.categorias where codigo !~ '^N';
  insert into _aux_src
  select 'centros_custo', empresa, codigo, coalesce(nullif(trim(descricao),''), codigo), '{}'::jsonb, coalesce(inativo,false)
    from compras.cad_departamentos where codigo !~ '^9\d{12}$';
  insert into _aux_src
  select 'condicoes', empresa, codigo, coalesce(nullif(trim(descricao),''), codigo),
         jsonb_strip_nulls(jsonb_build_object('n_parcelas', num_parcelas, 'dias', to_jsonb(cadastros.aux_dias(descricao)))), false
    from sales.formas_pagamento where codigo !~ '^N\d{3}$';
  insert into _aux_src
  select 'tipos_documento', '*', codigo, coalesce(nullif(trim(descricao),''), codigo), '{}'::jsonb, false
    from finance.tipos_documento where codigo !~ '^N\d{3}$';
  insert into _aux_src
  select distinct on (sigla) 'unidades', '*', upper(trim(sigla)), coalesce(nullif(trim(descricao),''), upper(trim(sigla))), '{}'::jsonb, false
    from orders.unidades where coalesce(trim(sigla),'') <> '' order by sigla, empresa;
  insert into _aux_src
  select 'vendedores', empresa, codigo::text, coalesce(nullif(trim(nome),''), 'Vendedor ' || codigo),
         jsonb_strip_nulls(jsonb_build_object('email', nullif(email,''), 'comissao', comissao)), coalesce(inativo,'N') = 'S'
    from finance.vendedores where codigo < 9000000000000;
  insert into _aux_src
  select 'servicos', empresa, codigo::text, coalesce(nullif(trim(descricao),''), codigo::text),
         jsonb_strip_nulls(jsonb_build_object('lc116', nullif(cod_lc116,''), 'cod_municipio', nullif(cod_servico_municipio,''),
           'aliquota_iss', aliquota_iss)), coalesce(inativo,'N') = 'S'
    from sales.servicos_cadastro where codigo < 9000000000000;
  insert into _aux_src
  select 'empresas', '*', empresa, coalesce(nullif(trim(razao_social),''), empresa),
         jsonb_strip_nulls(jsonb_build_object('fantasia', nome_fantasia, 'cnpj', cnpj, 'ie', ie, 'im', im,
           'endereco', endereco, 'numero', numero, 'complemento', complemento, 'bairro', bairro, 'cidade', cidade,
           'uf', uf, 'cep', cep, 'telefone', telefone, 'email', email)), false
    from compras.cad_empresas;

  -- novos do Omie
  insert into cadastros.aux (registro, empresa, codigo, omie_codigo, nome, nome_norm, dados, inativo, origem, criado_por, atualizado_por)
  select s.registro, s.empresa, s.codigo, case when s.registro in ('unidades','empresas') then null else s.codigo end,
         s.nome, cadastros.texto_norm(s.nome), s.dados, s.inativo, 'omie', 'sync-omie', 'sync-omie'
    from _aux_src s
   where not exists (select 1 from cadastros.aux a where a.registro = s.registro and a.empresa = s.empresa and a.codigo = s.codigo);
  get diagnostics n = row_count; tot := tot || jsonb_build_object('novos', n);

  -- atualizações do Omie (só o que não foi editado no painel)
  update cadastros.aux a set nome = s.nome, nome_norm = cadastros.texto_norm(s.nome), dados = a.dados || s.dados,
         inativo = s.inativo, atualizado_em = now(), atualizado_por = 'sync-omie'
    from _aux_src s
   where a.registro = s.registro and a.empresa = s.empresa and a.codigo = s.codigo
     and a.origem = 'omie' and not a.editado_no_painel
     and (a.nome is distinct from s.nome or a.inativo is distinct from s.inativo or not (a.dados @> s.dados));
  get diagnostics n = row_count; tot := tot || jsonb_build_object('atualizados', n);
  return tot;
end $$;

-- ─── guarda de duplicados ──────────────────────────────────────────────────────
create or replace function cadastros.aux_candidatos(p_reg text, p_emp text, p_nome text, p_dados jsonb, p_id bigint)
returns jsonb language sql stable as $$
  with base as (
    select a.id, a.codigo, a.nome, a.inativo, a.origem,
      case
        when p_reg = 'contas' and nullif(regexp_replace(coalesce(p_dados->>'conta',''),'\D','','g'),'') is not null
             and ltrim(regexp_replace(coalesce(a.dados->>'conta',''),'\D','','g'),'0') = ltrim(regexp_replace(coalesce(p_dados->>'conta',''),'\D','','g'),'0')
             and ltrim(coalesce(a.dados->>'banco',''),'0') = ltrim(coalesce(p_dados->>'banco',''),'0')
             and ltrim(regexp_replace(coalesce(a.dados->>'agencia',''),'\D','','g'),'0') = ltrim(regexp_replace(coalesce(p_dados->>'agencia',''),'\D','','g'),'0')
          then 'mesma conta bancária'
        when p_reg = 'empresas' and nullif(regexp_replace(coalesce(p_dados->>'cnpj',''),'\D','','g'),'') is not null
             and regexp_replace(coalesce(a.dados->>'cnpj',''),'\D','','g') = regexp_replace(coalesce(p_dados->>'cnpj',''),'\D','','g')
          then 'mesmo CNPJ'
        when a.nome_norm = cadastros.texto_norm(p_nome)
             and (p_reg <> 'categorias' or coalesce(a.dados->>'superior','') = coalesce(p_dados->>'superior',''))
          then 'mesmo nome'
        when p_reg in ('projetos','vendedores','servicos','centros_custo','contas')
             and public.similarity(a.nome, p_nome) >= 0.8 then 'nome muito parecido'
      end as motivo
    from cadastros.aux a
    where a.registro = p_reg and (a.empresa = p_emp or cadastros.aux_global(p_reg))
      and (p_id is null or a.id <> p_id) and not a.inativo)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome, 'origem', origem, 'motivo', motivo)
           order by motivo, nome), '[]'::jsonb)
    from (select * from base where motivo is not null limit 8) x $$;

-- ─── RPCs (só service_role; as rotas do painel validam sessão e permissões) ───
create or replace function orders.cad_aux_listar(p_registro text, p_empresa text, p_q text, p_inativos boolean,
  p_lim int default 100, p_off int default 0) returns jsonb
language plpgsql stable security definer set search_path = cadastros, public as $$
declare emp text := case when cadastros.aux_global(p_registro) then '*' else upper(coalesce(p_empresa,'SF')) end;
        qn text := cadastros.texto_norm(p_q); r jsonb;
begin
  with f as (
    select a.* from cadastros.aux a
     where a.registro = p_registro and a.empresa = emp and (p_inativos or not a.inativo)
       and (p_q is null or qn is null or a.nome_norm like '%' || qn || '%' or a.codigo ilike '%' || p_q || '%'
            or a.dados::text ilike '%' || p_q || '%'))
  select jsonb_build_object(
    'total', (select count(*) from f),
    'nativos', (select count(*) from f where origem = 'painel'),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'registro', registro, 'empresa', empresa,
        'codigo', codigo, 'omieCodigo', omie_codigo, 'nome', nome, 'dados', dados, 'inativo', inativo,
        'origem', origem, 'editado', editado_no_painel, 'criadoEm', criado_em, 'atualizadoEm', atualizado_em)
        order by case when p_registro = 'categorias' then codigo end, nome)
      from (select * from f order by case when p_registro = 'categorias' then codigo end, nome limit p_lim offset p_off) x), '[]'::jsonb))
  into r;
  return r;
end $$;

create or replace function orders.cad_aux_obter(p_id bigint) returns jsonb
language sql stable security definer set search_path = cadastros, public as $$
  select jsonb_build_object('id', a.id, 'registro', a.registro, 'empresa', a.empresa, 'codigo', a.codigo,
    'omieCodigo', a.omie_codigo, 'nome', a.nome, 'dados', a.dados, 'inativo', a.inativo, 'origem', a.origem,
    'editado', a.editado_no_painel, 'criadoEm', a.criado_em, 'criadoPor', a.criado_por,
    'atualizadoEm', a.atualizado_em, 'atualizadoPor', a.atualizado_por,
    'historico', coalesce((select jsonb_agg(jsonb_build_object('acao', h.acao, 'por', h.por, 'em', h.em,
        'motivo', h.motivo, 'antes', h.antes, 'depois', h.depois) order by h.em desc)
      from (select * from cadastros.aux_hist h where h.aux_id = a.id order by em desc limit 30) h), '[]'::jsonb))
  from cadastros.aux a where a.id = p_id $$;

-- Sugestões para um cadastro novo: próximo PJ/CT, próximo código de categoria debaixo do grupo.
create or replace function orders.cad_aux_sugestao(p_registro text, p_empresa text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = cadastros, public as $$
declare emp text := upper(coalesce(p_empresa,'SF')); sup text := p_extra->>'superior'; r jsonb := '{}'::jsonb;
begin
  if p_registro = 'projetos' then
    select jsonb_build_object(
      'PJ', coalesce(max(substring(nome from '^PJ(\d+)')::int) filter (where nome ~ '^PJ\d+'), 0) + 1,
      'CT', coalesce(max(substring(nome from '^CT(\d+)')::int) filter (where nome ~ '^CT\d+'), 0) + 1)
      into r from cadastros.aux where registro = 'projetos';  -- a numeração PJ/CT é uma só para as três empresas
  elsif p_registro = 'categorias' and sup is not null then
    select jsonb_build_object('codigo', sup || '.' || lpad((coalesce(max(nullif(regexp_replace(substr(codigo, length(sup) + 2), '\D', '', 'g'), '')::int), 0) + 1)::text, 2, '0'))
      into r from cadastros.aux where registro = 'categorias' and empresa = emp and codigo ~ ('^' || replace(sup, '.', '\.') || '\.\d+$');
  end if;
  return r;
end $$;

create or replace function orders.cad_aux_salvar(p jsonb, p_por text) returns jsonb
language plpgsql security definer set search_path = cadastros, public as $$
declare
  reg text := p->>'registro';
  emp text;
  a cadastros.aux; antes jsonb; novo boolean := (p->>'id') is null;
  v_nome text := nullif(trim(p->>'nome'), '');
  v_dados jsonb := coalesce(p->'dados', '{}'::jsonb);
  cod text; cand jsonb; tipo text; num int; sup text;
begin
  if not novo then
    select * into a from cadastros.aux where id = (p->>'id')::bigint for update;
    if not found then raise exception 'Cadastro não encontrado'; end if;
    reg := a.registro; emp := a.empresa;
  else
    if reg is null or reg not in ('projetos','contas','categorias','centros_custo','condicoes','tipos_documento',
                                  'vendedores','servicos','unidades','empresas') then
      raise exception 'Cadastro desconhecido: %', coalesce(reg, '(vazio)');
    end if;
    emp := case when cadastros.aux_global(reg) then '*' else upper(coalesce(nullif(p->>'empresa',''), 'SF')) end;
    if emp <> '*' and emp not in ('SF','CD','WW') then raise exception 'Empresa inválida: %', emp; end if;
  end if;

  -- regras por cadastro
  if reg = 'projetos' and novo then
    tipo := upper(coalesce(nullif(v_dados->>'tipo',''), 'PJ'));
    if tipo in ('PJ','CT') then
      num := nullif(v_dados->>'numero','')::int;
      if num is null then
        num := (orders.cad_aux_sugestao('projetos', emp)->>tipo)::int;
      end if;
      if v_nome is null then raise exception 'Informe o nome do projeto'; end if;
      if v_nome !~* ('^' || tipo || '\d+') then v_nome := tipo || num || '_' || v_nome; end if;
      v_dados := v_dados || jsonb_build_object('tipo', tipo, 'numero', num);
    end if;
  end if;
  if reg = 'categorias' and novo then
    sup := nullif(v_dados->>'superior','');
    if sup is null then raise exception 'Escolha o grupo (categoria superior) da nova categoria'; end if;
    if not exists (select 1 from cadastros.aux where registro = 'categorias' and empresa = emp and codigo = sup) then
      raise exception 'Grupo % não existe nesta empresa', sup;
    end if;
    if not (v_dados ? 'receita') then
      v_dados := v_dados || jsonb_build_object('receita', sup like '1%', 'despesa', sup like '2%');
    end if;
  end if;
  if reg = 'condicoes' then
    if not (v_dados ? 'dias') or jsonb_typeof(v_dados->'dias') = 'null' then
      v_dados := v_dados || jsonb_build_object('dias', to_jsonb(cadastros.aux_dias(coalesce(v_nome, a.nome))));
    end if;
    if nullif(v_dados->>'n_parcelas','') is null and jsonb_typeof(v_dados->'dias') = 'array' then
      v_dados := v_dados || jsonb_build_object('n_parcelas', jsonb_array_length(v_dados->'dias'));
    end if;
  end if;
  if novo and v_nome is null and reg not in ('unidades') then raise exception 'Informe o nome / descrição'; end if;

  -- código
  if novo then
    cod := nullif(upper(trim(p->>'codigo')), '');
    case reg
      when 'projetos','contas','vendedores','servicos','centros_custo' then
        cod := (9000000000000 + nextval('cadastros.aux_codigo_seq'))::text;
      when 'categorias' then
        cod := orders.cad_aux_sugestao('categorias', emp, jsonb_build_object('superior', sup))->>'codigo';
      when 'condicoes' then
        loop
          cod := 'N' || lpad(nextval('cadastros.aux_condicao_seq')::text, 3, '0');
          exit when not exists (select 1 from cadastros.aux where registro = 'condicoes' and empresa = emp and codigo = cod);
        end loop;
      when 'tipos_documento' then
        if cod is null then
          loop
            cod := 'N' || lpad(nextval('cadastros.aux_tipodoc_seq')::text, 3, '0');
            exit when not exists (select 1 from cadastros.aux where registro = 'tipos_documento' and codigo = cod);
          end loop;
        end if;
      when 'unidades', 'empresas' then
        if cod is null or cod !~ '^[A-Z0-9²³/]{1,6}$' then raise exception 'Informe a sigla (até 6 letras/números)'; end if;
      else null;
    end case;
    if exists (select 1 from cadastros.aux where registro = reg and empresa = emp and codigo = cod) then
      raise exception 'Já existe um cadastro com o código %', cod;
    end if;
    if v_nome is null then v_nome := cod; end if;
  end if;

  -- duplicados: recusa com os candidatos, a menos que um admin force com motivo (a rota tira o "forcar" de quem não é admin)
  cand := cadastros.aux_candidatos(reg, emp, coalesce(v_nome, a.nome), case when novo then v_dados else a.dados || v_dados end, case when novo then null else a.id end);
  if jsonb_array_length(cand) > 0 and coalesce((p->>'forcar')::boolean, false) is not true then
    raise exception using errcode = 'P0D01',
      message = 'Já existe um cadastro parecido — use o existente ou peça a um administrador para criar mesmo assim',
      detail = cand::text;
  end if;
  if jsonb_array_length(cand) > 0 and nullif(trim(p->>'forcarMotivo'),'') is null then
    raise exception 'Para criar mesmo havendo um parecido, informe o motivo';
  end if;

  if novo then
    insert into cadastros.aux (registro, empresa, codigo, nome, nome_norm, dados, inativo, origem, criado_por, atualizado_por)
    values (reg, emp, cod, v_nome, cadastros.texto_norm(v_nome), jsonb_strip_nulls(v_dados),
            coalesce((p->>'inativo')::boolean, false), 'painel', p_por, p_por)
    returning * into a;
    insert into cadastros.aux_hist (aux_id, registro, empresa, codigo, acao, depois, motivo, por)
    values (a.id, reg, emp, a.codigo, case when jsonb_array_length(cand) > 0 then 'criado_forcado' else 'criado' end,
            to_jsonb(a) - 'nome_norm', nullif(trim(p->>'forcarMotivo'),''), p_por);
  else
    antes := to_jsonb(a) - 'nome_norm';
    update cadastros.aux set
      nome = coalesce(v_nome, a.nome), nome_norm = cadastros.texto_norm(coalesce(v_nome, a.nome)),
      dados = jsonb_strip_nulls(a.dados || v_dados),
      inativo = coalesce((p->>'inativo')::boolean, a.inativo),
      editado_no_painel = (a.origem = 'omie') or a.editado_no_painel,
      atualizado_em = now(), atualizado_por = p_por
     where id = a.id returning * into a;
    insert into cadastros.aux_hist (aux_id, registro, empresa, codigo, acao, antes, depois, motivo, por)
    values (a.id, reg, emp, a.codigo, 'editado', antes, to_jsonb(a) - 'nome_norm', nullif(trim(p->>'forcarMotivo'),''), p_por);
  end if;

  perform cadastros.aux_espelhar(a.id);
  return orders.cad_aux_obter(a.id);
end $$;

-- Lista curta para os seletores (código + nome) e contagens para a tela inicial do módulo.
create or replace function orders.cad_aux_opcoes(p_registro text, p_empresa text) returns jsonb
language sql stable security definer set search_path = cadastros, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'dados', dados) order by
    case when p_registro = 'categorias' then codigo end, nome), '[]'::jsonb)
  from cadastros.aux where registro = p_registro and not inativo
   and empresa = case when cadastros.aux_global(p_registro) then '*' else upper(coalesce(p_empresa,'SF')) end $$;

create or replace function orders.cad_aux_resumo() returns jsonb
language sql stable security definer set search_path = cadastros, public as $$
  select coalesce(jsonb_object_agg(registro, jsonb_build_object('total', t, 'ativos', at, 'nativos', nat)), '{}'::jsonb)
  from (select registro, count(*) t, count(*) filter (where not inativo) at, count(*) filter (where origem = 'painel') nat
          from cadastros.aux group by registro) x $$;

revoke all on function orders.cad_aux_listar(text,text,text,boolean,int,int), orders.cad_aux_obter(bigint),
  orders.cad_aux_sugestao(text,text,jsonb), orders.cad_aux_salvar(jsonb,text), orders.cad_aux_opcoes(text,text),
  orders.cad_aux_resumo(), orders.cad_aux_sync_omie() from public, anon, authenticated;
grant execute on function orders.cad_aux_listar(text,text,text,boolean,int,int), orders.cad_aux_obter(bigint),
  orders.cad_aux_sugestao(text,text,jsonb), orders.cad_aux_salvar(jsonb,text), orders.cad_aux_opcoes(text,text),
  orders.cad_aux_resumo(), orders.cad_aux_sync_omie() to service_role;

-- Carga inicial + de hora em hora (depois do sync do Omie)
select orders.cad_aux_sync_omie();
select cron.unschedule('cadastros-aux-sync') where exists (select 1 from cron.job where jobname = 'cadastros-aux-sync');
select cron.schedule('cadastros-aux-sync', '17 * * * *', $$select orders.cad_aux_sync_omie()$$);

-- Conta bancária: agência/conta comparadas sem zeros à esquerda (p12_cad_aux_5) — já refletido em aux_candidatos acima.

-- Transportadoras como aba própria (p12_cad_aux_6): cadastros_listar aceita p_papel = 'transportadora'.
-- (a mesma função de sql/59, com o ramo novo no case)
--   when 'transportadora' then p.eh_transportadora
