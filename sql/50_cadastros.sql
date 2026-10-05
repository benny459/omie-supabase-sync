-- 50 — Cadastros próprios de clientes e fornecedores (P2 do ciclo de vendas sem Omie, 05/10/26)
--
-- Até aqui o cadastro de clientes/fornecedores era só o espelho do Omie
-- (finance.clientes). Agora o cadastro vive no painel: cadastros.pessoas.
--  - Semeado a partir do espelho do Omie (código do Omie guardado como referência;
--    o `codigo` desses registos É o código do Omie, para os PCs/títulos antigos
--    continuarem a casar).
--  - Registos novos nascem aqui, com código próprio (sequência a partir de
--    90.000.000.001, fora da faixa do Omie), e nunca vão ao Omie.
--  - Enquanto a equipa ainda cadastrar no Omie, cadastros_sync_omie() (de hora
--    em hora) traz só o que falta e atualiza os registos vindos do Omie que não
--    foram editados no painel. Nunca escreve no Omie.
--
-- O schema não é exposto no PostgREST: tudo passa por funções orders.cadastros_*
-- (security definer, só service_role), chamadas pelas rotas /api/cadastros, que
-- validam sessão e permissões.

create schema if not exists cadastros;
revoke all on schema cadastros from public;
grant usage on schema cadastros to service_role;

create sequence if not exists cadastros.codigo_painel_seq start with 90000000001;

create table if not exists cadastros.pessoas (
  id                  bigint generated always as identity primary key,
  empresa             text not null check (empresa in ('SF', 'CD', 'WW')),
  codigo              bigint not null,
  origem              text not null default 'painel' check (origem in ('omie', 'painel')),
  codigo_omie         bigint,
  eh_cliente          boolean not null default false,
  eh_fornecedor       boolean not null default false,
  eh_transportadora   boolean not null default false,
  pessoa_fisica       boolean not null default false,
  razao_social        text not null,
  nome_fantasia       text,
  cnpj_cpf            text,
  doc                 text generated always as (nullif(regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g'), '')) stored,
  inscricao_estadual  text,
  inscricao_municipal text,
  optante_simples     boolean,
  contribuinte        text,
  cep                 text,
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  uf                  text,
  cidade_ibge         text,
  telefone            text,
  telefone2           text,
  email               text,
  email_cobranca      text,
  email_nfe           text,
  contato             text,
  contatos            jsonb not null default '[]'::jsonb,
  tags                text,
  obs                 text,
  ativo               boolean not null default true,
  editado_no_painel   boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          text,
  updated_at          timestamptz not null default now(),
  updated_by          text,
  unique (empresa, codigo)
);
create unique index if not exists pessoas_empresa_doc_uq on cadastros.pessoas (empresa, doc) where doc is not null;
create index if not exists pessoas_busca_idx on cadastros.pessoas using gin ((razao_social || ' ' || coalesce(nome_fantasia, '')) public.gin_trgm_ops);
create index if not exists pessoas_codigo_omie_idx on cadastros.pessoas (empresa, codigo_omie);

create table if not exists cadastros.pessoas_hist (
  id         bigint generated always as identity primary key,
  pessoa_id  bigint not null references cadastros.pessoas(id) on delete cascade,
  acao       text not null,
  antes      jsonb,
  depois     jsonb,
  por        text,
  em         timestamptz not null default now()
);
create index if not exists pessoas_hist_pessoa_idx on cadastros.pessoas_hist (pessoa_id, em desc);

alter table cadastros.pessoas enable row level security;
alter table cadastros.pessoas_hist enable row level security;
revoke all on cadastros.pessoas, cadastros.pessoas_hist from public, anon, authenticated;
grant all on cadastros.pessoas, cadastros.pessoas_hist to service_role;
grant usage, select on sequence cadastros.codigo_painel_seq to service_role;

-- ── Validação de CPF/CNPJ (dígitos verificadores) ──────────────────────────
create or replace function cadastros.doc_valido(p_doc text) returns boolean
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g'); s int; r int; i int;
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if length(d) = 11 then
    if d ~ '^(\d)\1{10}$' then return false; end if;
    s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, 10, 1)::int then return false; end if;
    s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    return r = substr(d, 11, 1)::int;
  elsif length(d) = 14 then
    if d ~ '^(\d)\1{13}$' then return false; end if;
    s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * w1[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    if r <> substr(d, 13, 1)::int then return false; end if;
    s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * w2[i]; end loop;
    r := s % 11; r := case when r < 2 then 0 else 11 - r end;
    return r = substr(d, 14, 1)::int;
  end if;
  return false;
end $$;

-- ── Semente / sincronização a partir do espelho do Omie ────────────────────
-- Idempotente. Só lê finance.clientes; nunca escreve no Omie.
create or replace function orders.cadastros_sync_omie() returns jsonb
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare n_novos int := 0; n_ligados int := 0; n_atual int := 0;
begin
  -- 1) cadastro nativo com o mesmo CNPJ/CPF de um cliente do Omie: só liga o código do Omie.
  with o as (
    select k.empresa, k.codigo_cliente_omie, nullif(regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g'), '') as doc
      from finance.clientes k
  )
  update cadastros.pessoas p set codigo_omie = o.codigo_cliente_omie
    from o
   where p.origem = 'painel' and p.codigo_omie is null and o.doc is not null
     and p.empresa = o.empresa and p.doc = o.doc;
  get diagnostics n_ligados = row_count;

  -- 2) atualiza os registos vindos do Omie que ninguém editou no painel.
  update cadastros.pessoas p set
    razao_social = coalesce(nullif(replace(k.razao_social, '&amp;', '&'), ''), replace(k.nome_fantasia, '&amp;', '&'), p.razao_social),
    nome_fantasia = nullif(replace(k.nome_fantasia, '&amp;', '&'), ''),
    cnpj_cpf = nullif(k.cnpj_cpf, ''),
    eh_cliente = coalesce(k.tags, '') ilike '%cliente%',
    eh_fornecedor = coalesce(k.tags, '') ilike '%fornecedor%',
    eh_transportadora = coalesce(k.tags, '') ilike '%transport%',
    pessoa_fisica = coalesce(k.pessoa_fisica, 'N') = 'S',
    inscricao_estadual = nullif(k.inscricao_estadual, ''), inscricao_municipal = nullif(k.inscricao_municipal, ''),
    optante_simples = case k.optante_simples_nacional when 'S' then true when 'N' then false end,
    contribuinte = nullif(k.contribuinte, ''),
    cep = nullif(k.cep, ''), logradouro = nullif(k.endereco, ''), numero = nullif(k.endereco_numero, ''),
    complemento = nullif(k.complemento, ''), bairro = nullif(k.bairro, ''), cidade = nullif(k.cidade, ''),
    uf = nullif(k.estado, ''), cidade_ibge = nullif(k.cidade_ibge, ''),
    telefone = nullif(trim(coalesce(k.telefone1_ddd, '') || ' ' || coalesce(k.telefone1_numero, '')), ''),
    telefone2 = nullif(trim(coalesce(k.telefone2_ddd, '') || ' ' || coalesce(k.telefone2_numero, '')), ''),
    email = nullif(k.email, ''), contato = nullif(k.contato, ''), tags = k.tags,
    ativo = coalesce(k.inativo, 'N') <> 'S', updated_at = now(), updated_by = 'sync omie'
  from finance.clientes k
  where p.origem = 'omie' and not p.editado_no_painel
    and k.empresa = p.empresa and k.codigo_cliente_omie = p.codigo
    and k.synced_at > p.updated_at
    and not exists (select 1 from cadastros.pessoas q where q.empresa = p.empresa and q.id <> p.id
                      and q.doc = nullif(regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g'), ''));
  get diagnostics n_atual = row_count;

  -- 3) clientes do Omie que ainda não estão no cadastro (nem pelo código nem pelo documento).
  insert into cadastros.pessoas (empresa, codigo, origem, codigo_omie, eh_cliente, eh_fornecedor, eh_transportadora,
    pessoa_fisica, razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, inscricao_municipal, optante_simples,
    contribuinte, cep, logradouro, numero, complemento, bairro, cidade, uf, cidade_ibge, telefone, telefone2,
    email, contato, tags, ativo, created_by, updated_by)
  select k.empresa, k.codigo_cliente_omie, 'omie', k.codigo_cliente_omie,
         coalesce(k.tags, '') ilike '%cliente%', coalesce(k.tags, '') ilike '%fornecedor%', coalesce(k.tags, '') ilike '%transport%',
         coalesce(k.pessoa_fisica, 'N') = 'S',
         coalesce(nullif(replace(k.razao_social, '&amp;', '&'), ''), nullif(replace(k.nome_fantasia, '&amp;', '&'), ''), '(sem nome no Omie)'),
         nullif(replace(k.nome_fantasia, '&amp;', '&'), ''), nullif(k.cnpj_cpf, ''),
         nullif(k.inscricao_estadual, ''), nullif(k.inscricao_municipal, ''),
         case k.optante_simples_nacional when 'S' then true when 'N' then false end, nullif(k.contribuinte, ''),
         nullif(k.cep, ''), nullif(k.endereco, ''), nullif(k.endereco_numero, ''), nullif(k.complemento, ''),
         nullif(k.bairro, ''), nullif(k.cidade, ''), nullif(k.estado, ''), nullif(k.cidade_ibge, ''),
         nullif(trim(coalesce(k.telefone1_ddd, '') || ' ' || coalesce(k.telefone1_numero, '')), ''),
         nullif(trim(coalesce(k.telefone2_ddd, '') || ' ' || coalesce(k.telefone2_numero, '')), ''),
         nullif(k.email, ''), nullif(k.contato, ''), k.tags, coalesce(k.inativo, 'N') <> 'S', 'sync omie', 'sync omie'
    from finance.clientes k
   where not exists (select 1 from cadastros.pessoas p where p.empresa = k.empresa and (p.codigo = k.codigo_cliente_omie or p.codigo_omie = k.codigo_cliente_omie))
     and not exists (select 1 from cadastros.pessoas p where p.empresa = k.empresa
                       and p.doc = nullif(regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g'), ''))
  on conflict do nothing;
  get diagnostics n_novos = row_count;

  return jsonb_build_object('novos', n_novos, 'atualizados', n_atual, 'ligados', n_ligados);
end $$;

-- ── Uma pessoa em JSON (forma usada pela tela) ─────────────────────────────
create or replace function cadastros.pessoa_json(p cadastros.pessoas) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'empresa', p.empresa, 'codigo', p.codigo, 'origem', p.origem, 'codigoOmie', p.codigo_omie,
    'cliente', p.eh_cliente, 'fornecedor', p.eh_fornecedor, 'transportadora', p.eh_transportadora,
    'pf', p.pessoa_fisica, 'razao', p.razao_social, 'fantasia', p.nome_fantasia, 'doc', p.cnpj_cpf,
    'ie', p.inscricao_estadual, 'im', p.inscricao_municipal, 'simples', p.optante_simples, 'contribuinte', p.contribuinte,
    'cep', p.cep, 'logradouro', p.logradouro, 'numero', p.numero, 'complemento', p.complemento, 'bairro', p.bairro,
    'cidade', p.cidade, 'uf', p.uf, 'ibge', p.cidade_ibge, 'telefone', p.telefone, 'telefone2', p.telefone2,
    'email', p.email, 'emailCobranca', p.email_cobranca, 'emailNfe', p.email_nfe, 'contato', p.contato,
    'contatos', p.contatos, 'tags', p.tags, 'obs', p.obs, 'ativo', p.ativo, 'editado', p.editado_no_painel,
    'criadoEm', p.created_at, 'criadoPor', p.created_by, 'alteradoEm', p.updated_at, 'alteradoPor', p.updated_by)
$$;

-- ── Lista com busca ────────────────────────────────────────────────────────
create or replace function orders.cadastros_listar(p_papel text, p_empresa text default 'SF', p_q text default null,
  p_ativos boolean default true, p_lim int default 50, p_off int default 0)
returns jsonb language sql stable security definer set search_path to 'cadastros', 'public' as $$
  with base as (
    select p.* from cadastros.pessoas p
     where p.empresa = upper(coalesce(p_empresa, 'SF'))
       and (case p_papel when 'cliente' then p.eh_cliente
                         when 'fornecedor' then (p.eh_fornecedor or p.eh_transportadora)
                         else true end)
       and (not coalesce(p_ativos, true) or p.ativo)
       and (coalesce(trim(p_q), '') = ''
            or p.razao_social ilike '%' || trim(p_q) || '%' or p.nome_fantasia ilike '%' || trim(p_q) || '%'
            or (length(regexp_replace(p_q, '\D', '', 'g')) >= 4 and p.doc like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
            or p.cidade ilike trim(p_q) || '%' or p.codigo::text = trim(p_q))
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'nativos', (select count(*) from base where origem = 'painel'),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'codigo', b.codigo, 'origem', b.origem, 'razao', b.razao_social, 'fantasia', b.nome_fantasia,
        'doc', b.cnpj_cpf, 'cidade', b.cidade, 'uf', b.uf, 'email', b.email, 'telefone', b.telefone,
        'cliente', b.eh_cliente, 'fornecedor', b.eh_fornecedor, 'transportadora', b.eh_transportadora, 'ativo', b.ativo,
        'criadoEm', b.created_at) order by b.ord, b.razao_social)
      from (select *, case when origem = 'painel' then 0 else 1 end as ord from base
             order by case when origem = 'painel' then 0 else 1 end, razao_social
             limit greatest(1, least(coalesce(p_lim, 50), 200)) offset greatest(coalesce(p_off, 0), 0)) b), '[]'::jsonb))
$$;

create or replace function orders.cadastros_obter(p_id bigint) returns jsonb
language sql stable security definer set search_path to 'cadastros', 'public' as $$
  select cadastros.pessoa_json(p) || jsonb_build_object('historico',
           coalesce((select jsonb_agg(jsonb_build_object('acao', h.acao, 'por', h.por, 'em', h.em) order by h.em desc)
                       from (select * from cadastros.pessoas_hist where pessoa_id = p.id order by em desc limit 20) h), '[]'::jsonb))
    from cadastros.pessoas p where p.id = p_id
$$;

-- ── Criar / editar ─────────────────────────────────────────────────────────
create or replace function orders.cadastros_salvar(p jsonb, p_por text) returns jsonb
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_emp text := upper(coalesce(nullif(p->>'empresa', ''), 'SF'));
  v_doc text := nullif(regexp_replace(coalesce(p->>'doc', ''), '\D', '', 'g'), ''); v_razao text := nullif(trim(p->>'razao'), '');
  v_ant cadastros.pessoas; v_novo cadastros.pessoas; v_dup cadastros.pessoas;
  v_cli boolean := coalesce((p->>'cliente')::boolean, false); v_forn boolean := coalesce((p->>'fornecedor')::boolean, false);
  v_transp boolean := coalesce((p->>'transportadora')::boolean, false);
begin
  if v_razao is null then raise exception 'Informe a razão social (ou o nome, para pessoa física)'; end if;
  if v_emp not in ('SF', 'CD', 'WW') then raise exception 'Empresa inválida: %', v_emp; end if;
  if not (v_cli or v_forn or v_transp) then raise exception 'Marque se é cliente, fornecedor ou transportadora'; end if;
  if v_doc is not null and not cadastros.doc_valido(v_doc) then
    raise exception '% inválido: %', case when length(v_doc) = 11 then 'CPF' else 'CNPJ' end, p->>'doc';
  end if;
  if upper(coalesce(nullif(trim(p->>'uf'), ''), 'SP')) !~ '^[A-Z]{2}$' then raise exception 'UF inválida'; end if;

  if v_id is not null then
    select * into v_ant from cadastros.pessoas where id = v_id for update;
    if not found then raise exception 'Cadastro % não encontrado', v_id; end if;
    v_emp := v_ant.empresa; -- a empresa não muda depois de criado
  end if;

  if v_doc is not null then
    select * into v_dup from cadastros.pessoas
     where empresa = v_emp and doc = v_doc and id is distinct from v_id limit 1;
    if found then
      raise exception 'Já existe um cadastro com este documento: % (código %)', v_dup.razao_social, v_dup.codigo;
    end if;
  end if;

  if v_id is null then
    insert into cadastros.pessoas (empresa, codigo, origem, created_by, updated_by, razao_social)
    values (v_emp, nextval('cadastros.codigo_painel_seq'), 'painel', p_por, p_por, v_razao)
    returning id into v_id;
  end if;

  update cadastros.pessoas set
    eh_cliente = v_cli, eh_fornecedor = v_forn, eh_transportadora = v_transp,
    pessoa_fisica = coalesce((p->>'pf')::boolean, length(coalesce(v_doc, '')) = 11),
    razao_social = v_razao, nome_fantasia = nullif(trim(p->>'fantasia'), ''),
    cnpj_cpf = nullif(trim(p->>'doc'), ''),
    inscricao_estadual = nullif(trim(p->>'ie'), ''), inscricao_municipal = nullif(trim(p->>'im'), ''),
    optante_simples = (p->>'simples')::boolean, contribuinte = nullif(p->>'contribuinte', ''),
    cep = nullif(trim(p->>'cep'), ''), logradouro = nullif(trim(p->>'logradouro'), ''), numero = nullif(trim(p->>'numero'), ''),
    complemento = nullif(trim(p->>'complemento'), ''), bairro = nullif(trim(p->>'bairro'), ''),
    cidade = nullif(trim(p->>'cidade'), ''), uf = nullif(upper(trim(p->>'uf')), ''), cidade_ibge = nullif(trim(p->>'ibge'), ''),
    telefone = nullif(trim(p->>'telefone'), ''), telefone2 = nullif(trim(p->>'telefone2'), ''),
    email = nullif(lower(trim(p->>'email')), ''), email_cobranca = nullif(lower(trim(p->>'emailCobranca')), ''),
    email_nfe = nullif(lower(trim(p->>'emailNfe')), ''), contato = nullif(trim(p->>'contato'), ''),
    contatos = coalesce(case when jsonb_typeof(p->'contatos') = 'array' then p->'contatos' end, contatos),
    obs = nullif(trim(p->>'obs'), ''), ativo = coalesce((p->>'ativo')::boolean, true),
    editado_no_painel = editado_no_painel or origem = 'omie',
    updated_at = now(), updated_by = p_por
  where id = v_id
  returning * into v_novo;

  insert into cadastros.pessoas_hist (pessoa_id, acao, antes, depois, por)
  values (v_id, case when v_ant.id is null then 'criado' else 'editado' end,
          case when v_ant.id is null then null else cadastros.pessoa_json(v_ant) end, cadastros.pessoa_json(v_novo), p_por);

  return cadastros.pessoa_json(v_novo);
end $$;

-- ── Ficha do cliente: tudo o que existe dele (Omie histórico + nativo) ─────
-- Lê das vistas unificadas (sales.v_erp_vendas, finance.v_receber, sales.nfe_saida/
-- nfse_saida, bi.v_rentabilidade_cliente): quando os PV/OS, NFs e recebíveis
-- nativos entrarem nelas, aparecem aqui sem mudar a ficha.
create or replace function orders.cadastros_ficha_cliente(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path to 'cadastros', 'public' as $$
declare p cadastros.pessoas; v_cods text[]; r jsonb := '{}'::jsonb;
begin
  select * into p from cadastros.pessoas where id = p_id;
  if not found then raise exception 'Cadastro % não encontrado', p_id; end if;
  v_cods := array_remove(array[p.codigo::text, p.codigo_omie::text], null);

  r := r || jsonb_build_object('vendas', coalesce((
    select jsonb_agg(jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'label', v.label, 'emissao', v.emissao,
             'valor', v.valor_total, 'etapa', v.etapa_desc, 'faturado', v.faturado, 'cancelado', v.cancelado,
             'dtFat', v.dt_fat, 'nf', v.nf, 'projeto', v.projeto) order by v.emissao desc nulls last)
      from (select * from sales.v_erp_vendas v
             where v.empresa = p.empresa
               and (v.codigo_cliente = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(v.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
             order by v.emissao desc nulls last limit 300) v), '[]'::jsonb));

  r := r || jsonb_build_object('nfs', coalesce((
    select jsonb_agg(x order by x->>'emissao' desc nulls last) from (
      select jsonb_build_object('tipo', 'NF-e', 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao::date,
               'valor', n.valor_total, 'cancelada', n.cancelada, 'pedido', n.num_pedido, 'chave', n.chave_nfe) x
        from sales.nfe_saida n
       where p.doc is not null and n.empresa = p.empresa and regexp_replace(coalesce(n.cliente_cnpj, ''), '\D', '', 'g') = p.doc
      union all
      select jsonb_build_object('tipo', 'NFS-e', 'numero', s.numero, 'emissao', s.emissao::date, 'valor', s.valor_total,
               'cancelada', s.cancelada, 'pedido', s.numero_os)
        from sales.nfse_saida s
       where p.doc is not null and s.empresa = p.empresa and regexp_replace(coalesce(s.cliente_cnpj, ''), '\D', '', 'g') = p.doc
      limit 300) t), '[]'::jsonb));

  r := r || jsonb_build_object('receber', (
    with t as (
      select * from finance.v_receber x
       where x.empresa = p.empresa
         and (x.codigo_cliente_fornecedor::text = any(v_cods)
              or (p.doc is not null and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
         and coalesce(x.status_titulo, '') <> 'CANCELADO')
    select jsonb_build_object(
      'aberto', coalesce(sum(val_aberto) filter (where em_aberto), 0),
      'vencido', coalesce(sum(val_aberto) filter (where em_aberto and vencimento < current_date), 0),
      'recebido', coalesce(sum(valor_pago), 0),
      'titulos', coalesce((select jsonb_agg(jsonb_build_object('doc', y.numero_documento, 'parcela', y.numero_parcela,
                    'vencimento', y.vencimento, 'valor', y.valor_documento, 'pago', y.valor_pago, 'aberto', y.val_aberto,
                    'status', y.status_titulo, 'origem', y.origem_registro, 'nf', y.numero_documento_fiscal) order by y.vencimento desc)
                  from (select * from t order by vencimento desc nulls last limit 150) y), '[]'::jsonb))
      from t));

  r := r || jsonb_build_object('margem', (
    select jsonb_build_object('faturamento', coalesce(sum(faturamento), 0), 'compras', coalesce(sum(total_compras), 0),
             'despesas', coalesce(sum(despesas), 0), 'maoObra', coalesce(sum(custo_mao_obra), 0),
             'rentabilidade', coalesce(sum(rentabilidade), 0),
             'margem', case when coalesce(sum(faturamento), 0) > 0 then round(sum(rentabilidade) / sum(faturamento) * 100, 1) end)
      from bi.v_rentabilidade_cliente b where b.codigo_cliente::text = any(v_cods)));

  return r;
end $$;

-- ── Ficha do fornecedor: PCs, NFs de entrada, pagar e "quanto gastei" ──────
create or replace function orders.cadastros_ficha_fornecedor(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path to 'cadastros', 'public' as $$
declare p cadastros.pessoas; v_cods bigint[]; r jsonb := '{}'::jsonb;
begin
  select * into p from cadastros.pessoas where id = p_id;
  if not found then raise exception 'Cadastro % não encontrado', p_id; end if;
  v_cods := array_remove(array[p.codigo, p.codigo_omie], null);

  r := r || jsonb_build_object('pcs', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'numero', c.numero, 'emissao', c.emissao, 'etapa', c.etapa,
             'valor', c.valor_total, 'aprov', c.aprov_status, 'pvos', coalesce(c.pv_os_painel, c.pv_os), 'cliente', coalesce(c.pv_cliente_painel, c.pv_cliente),
             'nf', c.nf, 'origem', c.origem, 'cancelado', c.cancelado) order by c.emissao desc nulls last, c.id desc)
      from (select * from compras.pedidos c
             where c.empresa = p.empresa and c.tipo = 'PC'
               and (c.fornecedor_cod = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g') = p.doc))
             order by c.emissao desc nulls last, c.id desc limit 300) c), '[]'::jsonb));

  r := r || jsonb_build_object('nfs', coalesce((
    select jsonb_agg(jsonb_build_object('chave', f.chave, 'numero', ltrim(f.numero, '0'), 'emissao', (f.emissao at time zone 'America/Sao_Paulo')::date,
             'valor', f.valor, 'situacao', f.situacao,
             'pedido', (select c.numero from compras.nf_vinculos v join compras.pedidos c on c.id = v.pedido_id
                         where v.chave = f.chave and v.status = 'confirmado' limit 1)) order by f.emissao desc)
      from (select * from orders.focus_recebidos f
             where p.doc is not null and f.tipo = 'nfe' and f.empresa = p.empresa
               and regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g') = p.doc
             order by f.emissao desc limit 200) f), '[]'::jsonb));

  r := r || jsonb_build_object('pagar', (
    with t as (
      select * from finance.v_titulos_omie x
       where x.tipo = 'pagar' and x.empresa = p.empresa
         and (x.codigo_cliente_fornecedor = any(v_cods)
              or (p.doc is not null and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
         and coalesce(x.status_titulo, '') <> 'CANCELADO'),
    prev as (
      select * from finance.v_pagar_previsto x
       where x.empresa = p.empresa and x.pedido_id is not null
         and coalesce(x.status, 'previsto') not in ('substituido', 'cancelado')
         and p.doc is not null and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') = p.doc)
    select jsonb_build_object(
      'aberto', coalesce((select sum(val_aberto) from t where em_aberto), 0) + coalesce((select sum(val_aberto) from prev), 0),
      'vencido', coalesce((select sum(val_aberto) from t where em_aberto and vencimento < current_date), 0),
      'pago', coalesce((select sum(val_pago) from t), 0) + coalesce((select sum(valor_pago) from prev), 0),
      'previsto', coalesce((select sum(val_aberto) from prev), 0),
      'titulos', coalesce((select jsonb_agg(jsonb_build_object('doc', y.numero_documento, 'parcela', y.numero_parcela,
                    'vencimento', y.vencimento, 'valor', y.valor_documento, 'pago', y.val_pago, 'pagamento', y.pagamento,
                    'status', y.status_titulo, 'pedido', y.numero_pedido, 'nf', y.numero_documento_fiscal, 'origem', 'omie') order by y.vencimento desc)
                  from (select * from t order by vencimento desc nulls last limit 150) y), '[]'::jsonb)
                || coalesce((select jsonb_agg(jsonb_build_object('doc', z.numero_documento, 'parcela', z.numero_parcela,
                    'vencimento', z.vencimento, 'valor', z.valor_documento, 'pago', z.valor_pago, 'status', coalesce(z.fase, z.status),
                    'pedido', z.numero_pedido, 'origem', 'painel') order by z.vencimento desc) from prev z), '[]'::jsonb))));

  -- quanto gastei: comprado (PC emitido) e pago (pela data de pagamento), últimos 12 meses
  r := r || jsonb_build_object('gasto', coalesce((
    with m as (select to_char(date_trunc('month', current_date) - (i || ' month')::interval, 'YYYY-MM') as mes
                 from generate_series(0, 11) i),
    comp as (select to_char(c.emissao, 'YYYY-MM') mes, sum(c.valor_total) v from compras.pedidos c
              where c.empresa = p.empresa and c.tipo = 'PC' and not c.cancelado
                and (c.fornecedor_cod = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g') = p.doc))
                and c.emissao >= date_trunc('month', current_date) - interval '11 month'
              group by 1),
    pago as (select to_char(x.pagamento, 'YYYY-MM') mes, sum(x.val_pago) v from finance.v_titulos_omie x
              where x.tipo = 'pagar' and x.empresa = p.empresa and coalesce(x.val_pago, 0) > 0 and x.pagamento is not null
                and (x.codigo_cliente_fornecedor = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
                and x.pagamento >= date_trunc('month', current_date) - interval '11 month'
              group by 1)
    select jsonb_agg(jsonb_build_object('mes', m.mes, 'comprado', coalesce(comp.v, 0), 'pago', coalesce(pago.v, 0)) order by m.mes)
      from m left join comp using (mes) left join pago using (mes)), '[]'::jsonb));

  r := r || jsonb_build_object('totais', (
    select jsonb_build_object('comprado', coalesce(sum(c.valor_total), 0), 'pcs', count(*),
             'primeiro', min(c.emissao), 'ultimo', max(c.emissao))
      from compras.pedidos c where c.empresa = p.empresa and c.tipo = 'PC' and not c.cancelado
       and (c.fornecedor_cod = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g') = p.doc))));
  return r;
end $$;

-- ── Seletores que passam a ler o cadastro próprio ──────────────────────────
-- Mesma assinatura e mesma saída de antes (FolhaPedido não muda).
create or replace function orders.compras_buscar_fornecedores(p_q text, p_lim integer default 12, p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $$
  with f as (
    select k.codigo as cod, coalesce(nullif(k.razao_social, ''), k.nome_fantasia) as nome,
           nullif(k.nome_fantasia, '') as fantasia, k.cnpj_cpf as cnpj, k.eh_transportadora as transp,
           k.codigo_omie as cod_omie
      from cadastros.pessoas k
     where k.empresa = p_empresa and k.ativo and (k.eh_fornecedor or k.eh_transportadora)
       and (coalesce(p_q, '') = ''
            or k.razao_social ilike '%' || p_q || '%' or k.nome_fantasia ilike '%' || p_q || '%'
            or (length(regexp_replace(p_q, '\D', '', 'g')) >= 4 and k.doc like '%' || regexp_replace(p_q, '\D', '', 'g') || '%'))
  ),
  ult as (
    select distinct on (fornecedor_cod) fornecedor_cod, categoria_cod, categoria_desc, contato, parcela_cod,
           count(*) over (partition by fornecedor_cod) as n
      from compras.pedidos where tipo = 'PC' and fornecedor_cod in (select cod from f union select cod_omie from f where cod_omie is not null)
     order by fornecedor_cod, emissao desc nulls last, id desc
  )
  select coalesce(jsonb_agg(x.j order by x.n desc nulls last, x.nome), '[]'::jsonb) from (
    select jsonb_strip_nulls(jsonb_build_object('cod', f.cod, 'nome', f.nome, 'fantasia', f.fantasia,
             'cnpj', f.cnpj, 'transp', f.transp, 'n', u.n, 'ultCatCod', u.categoria_cod, 'ultCat', u.categoria_desc,
             'ultContato', u.contato, 'ultParc', u.parcela_cod)) as j, u.n, f.nome
      from f left join ult u on u.fornecedor_cod = f.cod
     order by u.n desc nulls last, f.nome
     limit greatest(1, least(p_lim, 50))) x
$$;

-- Saídas de estoque por cliente: o nome vem do cadastro próprio (o código é o mesmo do Omie).
create or replace function orders.estoque_busca_clientes(p_q text default null, p_cliente text default null)
returns jsonb language sql stable security definer set search_path to 'orders', 'public' as $$
  with s as (
    select m.empresa, m.id_prod, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente
    from orders.estoque_movimentos m
    join sales.pedidos_venda pv on pv.empresa = m.empresa and pv.codigo_pedido = m.id_pedido
    join cadastros.pessoas c on c.empresa = pv.empresa and c.codigo = pv.codigo_cliente
    where m.tipo = 'saida' and coalesce(m.cancelamento, 'N') <> 'S' and m.dt_mov >= current_date - 365
  )
  select case
    when p_cliente is not null then
      (select coalesce(jsonb_agg(distinct id_prod), '[]'::jsonb) from s where cliente = p_cliente)
    else
      (select coalesce(jsonb_agg(jsonb_build_object('nome', cliente, 'itens', n) order by n desc), '[]'::jsonb)
       from (select cliente, count(distinct id_prod) as n from s
             where cliente ilike '%' || p_q || '%' group by cliente order by n desc limit 5) x)
  end
$$;


-- NF que chega sem pedido (gerar PC a partir da NF): o fornecedor é procurado no
-- cadastro próprio, que inclui os fornecedores novos que nunca existiram no Omie.
do $do$
declare d text; antes text := $a$    from finance.clientes k
   where k.empresa = f.empresa and regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g') = v_cnpj and v_cnpj <> ''
   order by (coalesce(k.inativo, 'N') <> 'S') desc, (coalesce(k.tags, '') ilike '%fornecedor%') desc$a$;
  depois text := $b$    from (select codigo as codigo_cliente_omie, razao_social, nome_fantasia, ativo, eh_fornecedor
            from cadastros.pessoas where empresa = f.empresa and doc = v_cnpj) k
   where v_cnpj <> ''
   order by k.ativo desc, k.eh_fornecedor desc$b$;
begin
  d := pg_get_functiondef('compras.pc_da_nf'::regproc);
  if position(antes in d) = 0 then
    if position('cadastros.pessoas' in d) > 0 then return; end if;
    raise exception 'pc_da_nf mudou — rever o patch do cadastro';
  end if;
  execute replace(d, antes, depois);
end $do$;

revoke all on function cadastros.doc_valido(text), cadastros.pessoa_json(cadastros.pessoas) from public, anon, authenticated;
revoke all on function orders.cadastros_sync_omie(), orders.cadastros_listar(text, text, text, boolean, int, int),
  orders.cadastros_obter(bigint), orders.cadastros_salvar(jsonb, text), orders.cadastros_ficha_cliente(bigint),
  orders.cadastros_ficha_fornecedor(bigint) from public, anon, authenticated;
grant execute on function cadastros.doc_valido(text), cadastros.pessoa_json(cadastros.pessoas) to service_role;
grant execute on function orders.cadastros_sync_omie(), orders.cadastros_listar(text, text, text, boolean, int, int),
  orders.cadastros_obter(bigint), orders.cadastros_salvar(jsonb, text), orders.cadastros_ficha_cliente(bigint),
  orders.cadastros_ficha_fornecedor(bigint) to service_role;

-- (Aplicado em produção em 05/10/26 por partes, via MCP: p2_cadastros_1..7.)
-- Semente inicial + sincronização de hora em hora enquanto ainda se cadastrar no Omie.
select orders.cadastros_sync_omie();
select cron.schedule('cadastros-sync-omie', '35 * * * *', 'select orders.cadastros_sync_omie()');
