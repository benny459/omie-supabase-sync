-- 59 — Cadastros sem duplicados + ficha 360 (05/10/26)
--
-- Pedido do Benny: "não haja duplicação… se alguém cadastrar algo em Serviços,
-- não deixar duplicar". Regras, aplicadas no banco (valem para painel, Serviços,
-- CRM e o sync do Omie):
--   1. Uma ENTIDADE por CNPJ/CPF (cadastros.entidades). A mesma empresa pode ter
--      uma linha por empresa do grupo (SF/CD/WW) — cada uma com o seu código do
--      Omie, que PCs, títulos e vistas continuam a usar — mas todas apontam para
--      a mesma entidade. Não é duplicado; é a mesma pessoa com papel em várias
--      empresas. Editar os dados partilhados numa propaga para as outras.
--   2. Mesmo CNPJ/CPF nunca cria pessoa nova: na mesma empresa é recusado
--      (SQLSTATE P0D01, candidatos no DETAIL); noutra empresa nasce ligado à
--      mesma entidade.
--   3. Sem documento: semelhança de nome (pg_trgm) + cidade/telefone/e-mail.
--      Semelhança forte bloqueia e devolve os candidatos ("já existe — usar
--      este"). Só administrador força, com motivo, e fica no histórico.
--   4. Prospect sem documento entra como pré-cadastro (mesma guarda).
--   5. Duplicados que já existem: relatório + mesclar/agrupar (com desfazer).
--      Nada é mesclado sozinho.
-- Aplicado em omie-data como p10_cadastros_sem_duplicados_1..5 e p10_cadastros_ficha360.
-- Nunca escreve no Omie.

alter table cadastros.pessoas add column if not exists entidade_id bigint;
alter table cadastros.pessoas add column if not exists pre_cadastro boolean not null default false;
alter table cadastros.pessoas add column if not exists mesclado_em bigint;   -- id do sobrevivente

create table if not exists cadastros.entidades (
  id         bigint generated always as identity primary key,
  doc        text unique,
  criado_em  timestamptz not null default now()
);
alter table cadastros.entidades enable row level security;
revoke all on cadastros.entidades from public, anon, authenticated;
grant all on cadastros.entidades to service_role;

-- Semente: uma entidade por documento; sem documento, uma por linha.
insert into cadastros.entidades (doc)
select distinct doc from cadastros.pessoas where doc is not null
on conflict (doc) do nothing;
update cadastros.pessoas p set entidade_id = e.id
  from cadastros.entidades e where p.doc is not null and e.doc = p.doc and p.entidade_id is null;
do $$ declare r record; v bigint; begin
  for r in select id from cadastros.pessoas where entidade_id is null loop
    insert into cadastros.entidades (doc) values (null) returning id into v;
    update cadastros.pessoas set entidade_id = v where id = r.id;
  end loop;
end $$;
create index if not exists pessoas_entidade_idx on cadastros.pessoas (entidade_id);
create index if not exists pessoas_nome_chave_idx on cadastros.pessoas using gin (cadastros.nome_chave(razao_social) public.gin_trgm_ops);

-- Toda a pessoa nova (ou que ganha documento) fica na entidade do seu documento.
-- (doc é coluna gerada: no BEFORE ainda não está calculado — usa-se cnpj_cpf.)
create or replace function cadastros.tg_entidade() returns trigger
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_doc text := nullif(regexp_replace(coalesce(new.cnpj_cpf, ''), '\D', '', 'g'), ''); v bigint;
begin
  if v_doc is not null then
    select id into v from cadastros.entidades where doc = v_doc;
    if v is null then
      if new.entidade_id is not null
         and (select doc from cadastros.entidades where id = new.entidade_id) is null
         and not exists (select 1 from cadastros.pessoas where entidade_id = new.entidade_id and id is distinct from new.id) then
        update cadastros.entidades set doc = v_doc where id = new.entidade_id;
        v := new.entidade_id;
      else
        insert into cadastros.entidades (doc) values (v_doc) returning id into v;
      end if;
    end if;
    new.entidade_id := v;
    new.pre_cadastro := false;
  elsif new.entidade_id is null then
    insert into cadastros.entidades (doc) values (null) returning id into v;
    new.entidade_id := v;
  end if;
  return new;
end $$;
drop trigger if exists pessoas_entidade on cadastros.pessoas;
create trigger pessoas_entidade before insert or update of cnpj_cpf on cadastros.pessoas
  for each row execute function cadastros.tg_entidade();


-- ── Candidatos a duplicado ─────────────────────────────────────────────────
-- p: {empresa, doc, razao, fantasia, cidade, telefone, email, excluir (id)}
-- devolve [{id, empresa, codigo, razao, fantasia, doc, cidade, uf, motivo, score, forte}]
-- forte = é (quase certamente) a mesma pessoa → bloqueia a criação.
create or replace function cadastros.candidatos(p jsonb, p_lim int default 8) returns jsonb
language plpgsql stable security definer set search_path to 'cadastros', 'public' as $$
declare v_doc text := nullif(regexp_replace(coalesce(p->>'doc', ''), '\D', '', 'g'), '');
  v_nome text := cadastros.nome_chave(coalesce(nullif(p->>'razao', ''), p->>'fantasia'));
  v_fant text := cadastros.nome_chave(p->>'fantasia');
  v_cid text := cadastros.nome_chave(p->>'cidade');
  v_tel text := right(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), 8);
  v_mail text := nullif(lower(trim(p->>'email')), '');
  v_exc bigint := nullif(p->>'excluir', '')::bigint;
  v_ent bigint; r jsonb;
begin
  if v_exc is not null then select entidade_id into v_ent from cadastros.pessoas where id = v_exc; end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then v_doc := null; end if;
  if v_nome is not null and length(v_nome) < 3 then v_nome := null; end if;

  with porDoc as (
    select q.*, 1.0::numeric as score, 'mesmo CNPJ/CPF'::text as motivo, true as forte
      from cadastros.pessoas q
     where v_doc is not null and q.doc = v_doc and q.mesclado_em is null
  ), porNome as (
    select q.*, s.sn, s.extra from cadastros.pessoas q
    cross join lateral (select greatest(similarity(cadastros.nome_chave(q.razao_social), v_nome),
                                        coalesce(similarity(cadastros.nome_chave(q.nome_fantasia), v_nome), 0),
                                        coalesce(similarity(cadastros.nome_chave(q.razao_social), v_fant), 0))::numeric as sn,
                               (case when v_cid is not null and cadastros.nome_chave(q.cidade) = v_cid then 1 else 0 end
                                + case when length(v_tel) = 8 and (right(regexp_replace(coalesce(q.telefone, ''), '\D', '', 'g'), 8) = v_tel
                                                                    or right(regexp_replace(coalesce(q.telefone2, ''), '\D', '', 'g'), 8) = v_tel) then 2 else 0 end
                                + case when v_mail is not null and v_mail in (lower(q.email), lower(q.email_cobranca), lower(q.email_nfe)) then 4 else 0 end) as extra) s
     where v_nome is not null and q.mesclado_em is null
       and cadastros.nome_chave(q.razao_social) % v_nome
       and not (v_doc is not null and q.doc is not null and q.doc <> v_doc)   -- CNPJs diferentes = pessoas diferentes (filiais)
  ), todos as (
    select id, empresa, codigo, razao_social, nome_fantasia, cnpj_cpf, cidade, uf, entidade_id, score, motivo, forte from porDoc
    union all
    select id, empresa, codigo, razao_social, nome_fantasia, cnpj_cpf, cidade, uf, entidade_id,
           least(1, sn + case when extra >= 4 then 0.3 when extra >= 2 then 0.2 when extra >= 1 then 0.1 else 0 end)::numeric(4,3),
           concat_ws(' + ', 'nome ' || round(sn * 100) || '%',
             case when extra & 1 = 1 then 'mesma cidade' end, case when extra & 2 = 2 then 'mesmo telefone' end,
             case when extra & 4 = 4 then 'mesmo e-mail' end),
           -- forte: nome praticamente igual, ou parecido + contacto/cidade em comum; e só quando
           -- quem se cadastra não tem documento (com documento, o documento é que decide).
           (v_doc is null or cnpj_cpf is null)
             and (sn >= 0.9 or (sn >= 0.6 and extra >= 2) or (sn >= 0.75 and extra >= 1))
      from porNome
     where sn >= 0.45
  ), uni as (
    select distinct on (id) * from todos
     where id is distinct from v_exc and (v_ent is null or entidade_id <> v_ent)
     order by id, forte desc, score desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'empresa', empresa, 'codigo', codigo, 'razao', razao_social,
           'fantasia', nome_fantasia, 'doc', cnpj_cpf, 'cidade', cidade, 'uf', uf, 'entidade', entidade_id,
           'motivo', motivo, 'score', score, 'forte', forte) order by forte desc, score desc), '[]'::jsonb)
    into r
    from (select * from uni order by forte desc, score desc limit greatest(1, least(coalesce(p_lim, 8), 30))) z;
  return r;
end $$;

-- Códigos (empresa da pessoa) que contam como "esta pessoa": o próprio, o do Omie
-- e os de quem foi mesclado nela.
create or replace function cadastros.codigos_de(p_id bigint) returns bigint[]
language sql stable security definer set search_path to 'cadastros', 'public' as $$
  select coalesce(array_agg(distinct c) filter (where c is not null), '{}')
    from (select codigo c from cadastros.pessoas where id = p_id or mesclado_em = p_id
          union all select codigo_omie from cadastros.pessoas where id = p_id or mesclado_em = p_id) x
$$;

-- ── Criar / editar com a guarda ────────────────────────────────────────────
-- Novidades face ao sql/50: guarda de semelhança na criação sem documento
-- (POSSIVEL_DUPLICADO + candidatos no DETAIL), forçar com motivo, pré-cadastro,
-- e propagação dos dados partilhados às outras empresas da mesma entidade.
create or replace function orders.cadastros_salvar(p jsonb, p_por text) returns jsonb
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_emp text := upper(coalesce(nullif(p->>'empresa', ''), 'SF'));
  v_doc text := nullif(regexp_replace(coalesce(p->>'doc', ''), '\D', '', 'g'), ''); v_razao text := nullif(trim(p->>'razao'), '');
  v_ant cadastros.pessoas; v_novo cadastros.pessoas; v_dup cadastros.pessoas; v_irmao cadastros.pessoas;
  v_cli boolean := coalesce((p->>'cliente')::boolean, false); v_forn boolean := coalesce((p->>'fornecedor')::boolean, false);
  v_transp boolean := coalesce((p->>'transportadora')::boolean, false);
  v_forcar boolean := coalesce((p->>'forcar')::boolean, false); v_motivo text := nullif(trim(p->>'forcarMotivo'), '');
  v_cand jsonb; v_ent bigint;
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
    if v_ant.mesclado_em is not null then raise exception 'Este cadastro foi mesclado no %; edite o sobrevivente', v_ant.mesclado_em; end if;
    v_emp := v_ant.empresa; -- a empresa não muda depois de criado
  end if;

  if v_doc is not null then
    select * into v_dup from cadastros.pessoas
     where empresa = v_emp and doc = v_doc and id is distinct from v_id and mesclado_em is null limit 1;
    if found then
      raise exception using errcode = 'P0D01',
        message = format('Já existe um cadastro com este documento: %s (código %s)', v_dup.razao_social, v_dup.codigo),
        detail = jsonb_build_array(jsonb_build_object('id', v_dup.id, 'empresa', v_dup.empresa, 'codigo', v_dup.codigo,
                   'razao', v_dup.razao_social, 'doc', v_dup.cnpj_cpf, 'motivo', 'mesmo CNPJ/CPF', 'forte', true))::text;
    end if;
  end if;

  -- Guarda de semelhança: só na criação, só sem documento (com documento, o documento decide).
  if v_id is null and v_doc is null then
    v_cand := cadastros.candidatos(p || jsonb_build_object('razao', v_razao), 8);
    if exists (select 1 from jsonb_array_elements(v_cand) c where (c->>'forte')::boolean) then
      if not v_forcar then
        raise exception using errcode = 'P0D01',
          message = 'Possível duplicado: já existe um cadastro muito parecido — use o existente',
          detail = (select jsonb_agg(c) from jsonb_array_elements(v_cand) c where (c->>'forte')::boolean)::text;
      elsif v_motivo is null then
        raise exception 'Para criar mesmo assim, informe o motivo';
      end if;
    end if;
  end if;

  if v_id is null then
    -- Mesmo documento noutra empresa: nasce na mesma entidade, com os dados dela por base.
    if v_doc is not null then
      select * into v_irmao from cadastros.pessoas where doc = v_doc and mesclado_em is null order by (origem = 'painel') desc, updated_at desc limit 1;
    end if;
    insert into cadastros.pessoas (empresa, codigo, origem, created_by, updated_by, razao_social, cnpj_cpf)
    values (v_emp, nextval('cadastros.codigo_painel_seq'), 'painel', p_por, p_por, v_razao, nullif(trim(p->>'doc'), ''))
    returning id into v_id;
    if v_irmao.id is not null then
      p := (cadastros.pessoa_json(v_irmao) - 'id' - 'empresa' - 'codigo' - 'origem' - 'codigoOmie') || jsonb_strip_nulls(p);
    end if;
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
    pre_cadastro = (v_doc is null and coalesce((p->>'preCadastro')::boolean, pre_cadastro)),
    editado_no_painel = editado_no_painel or origem = 'omie',
    updated_at = now(), updated_by = p_por
  where id = v_id
  returning * into v_novo;

  insert into cadastros.pessoas_hist (pessoa_id, acao, antes, depois, por)
  values (v_id,
          case when v_ant.id is not null then 'editado' when v_forcar and v_motivo is not null then 'criado_forcado' else 'criado' end,
          case when v_ant.id is null then null else cadastros.pessoa_json(v_ant) end,
          cadastros.pessoa_json(v_novo) || case when v_forcar and v_motivo is not null and v_ant.id is null
                                               then jsonb_build_object('forcadoMotivo', v_motivo, 'candidatos', v_cand) else '{}'::jsonb end,
          p_por);

  -- Dados partilhados valem para a pessoa inteira: propaga às outras empresas da entidade.
  with irmaos as (
    update cadastros.pessoas s set
      razao_social = v_novo.razao_social, nome_fantasia = v_novo.nome_fantasia, pessoa_fisica = v_novo.pessoa_fisica,
      inscricao_estadual = v_novo.inscricao_estadual, inscricao_municipal = v_novo.inscricao_municipal,
      cep = v_novo.cep, logradouro = v_novo.logradouro, numero = v_novo.numero, complemento = v_novo.complemento,
      bairro = v_novo.bairro, cidade = v_novo.cidade, uf = v_novo.uf, cidade_ibge = v_novo.cidade_ibge,
      telefone = v_novo.telefone, telefone2 = v_novo.telefone2, email = v_novo.email,
      email_cobranca = v_novo.email_cobranca, email_nfe = v_novo.email_nfe, contato = v_novo.contato, contatos = v_novo.contatos,
      editado_no_painel = true, updated_at = now(), updated_by = p_por
     where s.entidade_id = v_novo.entidade_id and s.id <> v_novo.id and s.mesclado_em is null
       and v_novo.doc is not null and s.doc = v_novo.doc
    returning s.id)
  insert into cadastros.pessoas_hist (pessoa_id, acao, depois, por)
  select id, 'propagado', jsonb_build_object('de', v_novo.id, 'empresa', v_novo.empresa), p_por from irmaos;

  return cadastros.pessoa_json(v_novo);
end $$;

-- pessoa_json ganha entidade, pré-cadastro e mescla.
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
    'entidade', p.entidade_id, 'preCadastro', p.pre_cadastro, 'mescladoEm', p.mesclado_em,
    'criadoEm', p.created_at, 'criadoPor', p.created_by, 'alteradoEm', p.updated_at, 'alteradoPor', p.updated_by)
$$;

revoke all on function cadastros.candidatos(jsonb, int) from public, anon, authenticated;
grant execute on function cadastros.candidatos(jsonb, int) to service_role;

create or replace function orders.cadastros_candidatos(p jsonb) returns jsonb
language sql stable security definer set search_path to 'cadastros', 'public' as $$
  select cadastros.candidatos(p, 8)
$$;
revoke all on function orders.cadastros_candidatos(jsonb) from public, anon, authenticated;
grant execute on function orders.cadastros_candidatos(jsonb) to service_role;

-- ── Apps (Serviços/CRM): ligar sem duplicar ────────────────────────────────
-- Segue a cadeia de mescla até ao sobrevivente.
create or replace function cadastros.sobrevivente(p cadastros.pessoas) returns cadastros.pessoas
language plpgsql stable security definer set search_path to 'cadastros', 'public' as $$
declare r cadastros.pessoas := p; n int := 0;
begin
  while r.mesclado_em is not null and n < 10 loop
    select * into r from cadastros.pessoas where id = r.mesclado_em; n := n + 1;
  end loop;
  return r;
end $$;

create or replace function orders.cadastros_resolver(p_app text, p_itens jsonb, p_criar boolean default false, p_por text default null, p_gravar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare it jsonb; v_emp text; v_cod bigint; v_doc text; v_nome text; v_hit cadastros.pessoas; v_n int;
  v_como text; v_out jsonb := '[]'::jsonb; v_novo jsonb; v_cand jsonb;
begin
  if p_app not in ('servicos', 'crm') then raise exception 'app inválida: %', p_app; end if;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_emp := upper(coalesce(nullif(it->>'empresa', ''), 'SF'));
    v_cod := case when coalesce(it->>'codigoOmie', '') ~ '^\d{4,}$' then (it->>'codigoOmie')::bigint end;
    v_doc := nullif(regexp_replace(coalesce(it->>'doc', ''), '\D', '', 'g'), '');
    if v_doc is not null and not cadastros.doc_valido(v_doc) then v_doc := null; end if;
    v_nome := cadastros.nome_chave(it->>'nome');
    v_hit := null; v_como := 'nao_achado'; v_cand := null;

    select p.* into v_hit from cadastros.vinculos v join cadastros.pessoas p on p.empresa = v.empresa and p.codigo = v.codigo
     where v.app = p_app and v.ref = it->>'ref';
    if found then v_como := 'ligado'; end if;

    if v_hit.id is null and v_cod is not null then
      select * into v_hit from cadastros.pessoas
       where codigo = v_cod or codigo_omie = v_cod
       order by (empresa = v_emp) desc, (codigo = v_cod) desc, (mesclado_em is null) desc limit 1;
      if found then v_como := 'omie'; end if;
    end if;

    -- CNPJ/CPF: a entidade é a mesma em qualquer empresa do grupo.
    if v_hit.id is null and v_doc is not null then
      select * into v_hit from cadastros.pessoas where doc = v_doc
       order by (mesclado_em is null) desc, (empresa = v_emp) desc, updated_at desc limit 1;
      if found then v_como := 'doc'; end if;
    end if;

    if v_hit.id is null and v_nome is not null then
      select count(*) into v_n from cadastros.pessoas
       where empresa = v_emp and mesclado_em is null
         and (cadastros.nome_chave(razao_social) = v_nome or cadastros.nome_chave(nome_fantasia) = v_nome);
      if v_n = 1 then
        select * into v_hit from cadastros.pessoas
         where empresa = v_emp and mesclado_em is null
           and (cadastros.nome_chave(razao_social) = v_nome or cadastros.nome_chave(nome_fantasia) = v_nome);
        v_como := 'nome';
      elsif v_n > 1 then
        v_como := 'ambiguo';
        v_cand := cadastros.candidatos(jsonb_build_object('razao', it->>'nome', 'cidade', it->>'cidade',
                    'telefone', it->>'telefone', 'email', it->>'email'), 8);
      end if;
    end if;

    if v_hit.id is not null then v_hit := cadastros.sobrevivente(v_hit); end if;

    -- Não está no mestre: só cria se nada parecido existir (a guarda do cadastros_salvar decide).
    if v_hit.id is null and v_como = 'nao_achado' and p_criar and p_gravar
       and coalesce(nullif(trim(it->>'nome'), ''), nullif(trim(it->>'razao'), '')) is not null then
      begin
        v_novo := orders.cadastros_salvar_app(
          jsonb_strip_nulls(jsonb_build_object('empresa', v_emp, 'razao', coalesce(nullif(trim(it->>'razao'), ''), trim(it->>'nome')),
            'fantasia', it->>'fantasia', 'doc', v_doc, 'email', it->>'email', 'telefone', it->>'telefone',
            'cidade', it->>'cidade', 'uf', it->>'uf', 'logradouro', it->>'logradouro', 'cliente', true,
            'preCadastro', v_doc is null)),
          p_app, it->>'ref', coalesce(p_por, p_app));
        select * into v_hit from cadastros.pessoas where id = (v_novo->>'id')::bigint;
        v_como := 'criado';
      exception when sqlstate 'P0D01' then
        v_como := 'candidatos';
        get stacked diagnostics v_novo = pg_exception_detail;
        v_cand := v_novo; v_novo := null;
      end;
    elsif v_hit.id is null and v_como = 'nao_achado' then
      v_cand := cadastros.candidatos(jsonb_build_object('razao', it->>'nome', 'doc', v_doc, 'cidade', it->>'cidade',
                  'telefone', it->>'telefone', 'email', it->>'email'), 5);
    end if;

    if v_hit.id is not null and p_gravar then
      insert into cadastros.vinculos (app, ref, empresa, codigo, como)
      values (p_app, it->>'ref', v_hit.empresa, v_hit.codigo, v_como)
      on conflict (app, ref) do update set empresa = excluded.empresa, codigo = excluded.codigo,
        como = case when cadastros.vinculos.codigo = excluded.codigo then cadastros.vinculos.como else excluded.como end;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('ref', it->>'ref', 'empresa', v_hit.empresa, 'codigo', v_hit.codigo,
      'como', v_como, 'pessoa', case when v_hit.id is not null then cadastros.pessoa_json(v_hit) end, 'candidatos', v_cand)));
  end loop;
  return v_out;
end $$;

-- "Já existe — usar este": liga a linha da app a um cadastro escolhido (e marca o papel de cliente).
create or replace function orders.cadastros_vincular_app(p_app text, p_ref text, p_empresa text, p_codigo bigint, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v cadastros.pessoas;
begin
  if p_app not in ('servicos', 'crm') then raise exception 'app inválida: %', p_app; end if;
  if coalesce(p_ref, '') = '' then raise exception 'ref obrigatória'; end if;
  select * into v from cadastros.pessoas where empresa = upper(p_empresa) and codigo = p_codigo;
  if not found then raise exception 'Cadastro % / % não encontrado', p_empresa, p_codigo; end if;
  v := cadastros.sobrevivente(v);
  if not v.eh_cliente then
    update cadastros.pessoas set eh_cliente = true, updated_at = now(), updated_by = coalesce(p_por, p_app) where id = v.id returning * into v;
    insert into cadastros.pessoas_hist (pessoa_id, acao, depois, por) values (v.id, 'papel_cliente', jsonb_build_object('app', p_app), coalesce(p_por, p_app));
  end if;
  insert into cadastros.vinculos (app, ref, empresa, codigo, como) values (p_app, p_ref, v.empresa, v.codigo, 'escolhido')
  on conflict (app, ref) do update set empresa = excluded.empresa, codigo = excluded.codigo, como = 'escolhido';
  return cadastros.pessoa_json(v);
end $$;

-- Busca para os seletores das apps: todas as empresas do grupo, uma linha por entidade
-- (a da empresa pedida primeiro), clientes primeiro, sem mesclados.
create or replace function orders.cadastros_buscar_app(p_q text, p_empresa text default 'SF', p_lim int default 20)
returns jsonb language sql stable security definer set search_path to 'cadastros', 'public' as $$
  with base as (
    select distinct on (p.entidade_id) p.* from cadastros.pessoas p
     where p.ativo and p.mesclado_em is null
       and (p.razao_social ilike '%' || p_q || '%' or p.nome_fantasia ilike '%' || p_q || '%'
            or (length(regexp_replace(p_q, '\D', '', 'g')) >= 4 and p.doc like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
            or p.codigo::text = trim(p_q))
     order by p.entidade_id, (p.empresa = upper(coalesce(nullif(p_empresa, ''), 'SF'))) desc, p.eh_cliente desc
  )
  select coalesce(jsonb_agg(cadastros.pessoa_json(b) order by b.eh_cliente desc, b.razao_social), '[]'::jsonb)
    from (select * from base order by eh_cliente desc, razao_social limit greatest(1, least(coalesce(p_lim, 20), 50))) b
$$;

revoke all on function orders.cadastros_vincular_app(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function orders.cadastros_vincular_app(text, text, text, bigint, text) to service_role;
revoke all on function cadastros.sobrevivente(cadastros.pessoas) from public, anon, authenticated;
grant execute on function cadastros.sobrevivente(cadastros.pessoas) to service_role;

-- ── Duplicados que já existem ──────────────────────────────────────────────
create table if not exists cadastros.duplicidade_ignorada (
  a bigint not null, b bigint not null, por text, em timestamptz not null default now(),
  primary key (a, b), check (a < b)
);
alter table cadastros.duplicidade_ignorada enable row level security;
revoke all on cadastros.duplicidade_ignorada from public, anon, authenticated;
grant all on cadastros.duplicidade_ignorada to service_role;

create table if not exists cadastros.mesclas (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('mesclar', 'agrupar')),
  sobrevivente_id  bigint not null,
  absorvido_id     bigint not null,
  empresa          text,
  codigo_antigo    bigint,
  codigo_novo      bigint,
  antes            jsonb not null,
  repontes         jsonb not null default '{}'::jsonb,
  motivo           text,
  por              text,
  em               timestamptz not null default now(),
  desfeita_em      timestamptz,
  desfeita_por     text
);
alter table cadastros.mesclas enable row level security;
revoke all on cadastros.mesclas from public, anon, authenticated;
grant all on cadastros.mesclas to service_role;

-- Relatório: grupos para decidir (nada é mesclado sozinho).
--   nome_igual     mesma empresa, mesmo nome, documentos compatíveis (nenhum, ou só um)
--   outra_empresa  mesmo nome em empresas diferentes, entidades diferentes, sem documento a separá-los → agrupar
--   parecido       mesma empresa, nome ≥ 85% parecido, documentos compatíveis
create or replace function orders.cadastros_duplicidades(p_lim int default 300) returns jsonb
language plpgsql volatile security definer set search_path to 'cadastros', 'public' as $$
declare r jsonb; v_lim int := greatest(1, least(coalesce(p_lim, 300), 1000));
begin
  perform set_config('pg_trgm.similarity_threshold', '0.85', true);
  with ativos as (
    select p.*, cadastros.nome_chave(p.razao_social) nk from cadastros.pessoas p where p.mesclado_em is null
  ),
  g1 as (  -- mesma empresa, mesmo nome
    select 'nome_igual' tipo, empresa || ':' || nk chave, array_agg(id order by (doc is not null) desc, (origem = 'painel') desc, id) ids
      from ativos where nk is not null
     group by empresa, nk
    having count(*) > 1 and count(distinct doc) <= 1
  ),
  g2 as (  -- mesmo nome noutras empresas, entidades diferentes
    select 'outra_empresa' tipo, nk chave, array_agg(id order by (doc is not null) desc, empresa, id) ids
      from ativos where nk is not null
     group by nk
    having count(distinct empresa) > 1 and count(distinct entidade_id) > 1 and count(distinct doc) <= 1
  ),
  g3 as (  -- parecido (pares), mesma empresa
    select 'parecido' tipo, a.id || '-' || b.id chave, array[a.id, b.id] ids
      from cadastros.pessoas a
      join cadastros.pessoas b on cadastros.nome_chave(b.razao_social) % cadastros.nome_chave(a.razao_social)
                              and b.empresa = a.empresa and b.id > a.id and b.mesclado_em is null
                              and cadastros.nome_chave(b.razao_social) <> cadastros.nome_chave(a.razao_social)
     where a.mesclado_em is null and (a.doc is null or b.doc is null)
     limit v_lim
  ),
  todos as (select * from g1 union all select * from g2 union all select * from g3),
  filtrados as (  -- tira os pares marcados "não é duplicado"
    select t.* from todos t
     where exists (select 1 from unnest(t.ids) x, unnest(t.ids) y
                    where x < y and not exists (select 1 from cadastros.duplicidade_ignorada i where i.a = x and i.b = y))
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'nomeIgual', (select count(*) from filtrados where tipo = 'nome_igual'),
      'outraEmpresa', (select count(*) from filtrados where tipo = 'outra_empresa'),
      'parecido', (select count(*) from filtrados where tipo = 'parecido'),
      'entidadesMultiEmpresa', (select count(*) from (select entidade_id from ativos group by 1 having count(distinct empresa) > 1) z),
      'pessoas', (select count(*) from ativos), 'entidades', (select count(distinct entidade_id) from ativos),
      'mesclas', (select count(*) from cadastros.mesclas where desfeita_em is null)),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('tipo', f.tipo, 'chave', f.chave, 'membros',
        (select jsonb_agg(jsonb_build_object('id', p.id, 'empresa', p.empresa, 'codigo', p.codigo, 'origem', p.origem,
                  'razao', p.razao_social, 'fantasia', p.nome_fantasia, 'doc', p.cnpj_cpf, 'cidade', p.cidade, 'uf', p.uf,
                  'cliente', p.eh_cliente, 'fornecedor', p.eh_fornecedor, 'ativo', p.ativo, 'entidade', p.entidade_id,
                  'criadoEm', p.created_at) order by array_position(f.ids, p.id))
           from cadastros.pessoas p where p.id = any(f.ids)))
        order by case f.tipo when 'nome_igual' then 0 when 'outra_empresa' then 1 else 2 end, f.chave)
      from (select * from filtrados order by case tipo when 'nome_igual' then 0 when 'outra_empresa' then 1 else 2 end, chave limit v_lim) f), '[]'::jsonb),
    'feitas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'sobrevivente', m.sobrevivente_id,
        'absorvido', m.absorvido_id, 'empresa', m.empresa, 'codigoAntigo', m.codigo_antigo, 'codigoNovo', m.codigo_novo,
        'razao', (select razao_social from cadastros.pessoas where id = m.sobrevivente_id),
        'motivo', m.motivo, 'por', m.por, 'em', m.em, 'desfeitaEm', m.desfeita_em) order by m.em desc)
      from (select * from cadastros.mesclas order by em desc limit 50) m), '[]'::jsonb))
  into r;
  return r;
end $$;

create or replace function orders.cadastros_ignorar_dup(p_ids bigint[], p_por text) returns int
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare n int;
begin
  insert into cadastros.duplicidade_ignorada (a, b, por)
  select x, y, p_por from unnest(p_ids) x, unnest(p_ids) y where x < y
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Mesclar: o absorvido deixa de existir para o uso (inativo, aponta o sobrevivente);
-- as tabelas do painel que guardam o código passam a apontar o sobrevivente; o
-- espelho do Omie não muda (as fichas e buscas resolvem os códigos antigos por
-- cadastros.codigos_de). Empresas diferentes: só agrupa na mesma entidade.
create or replace function orders.cadastros_mesclar(p_sobrevivente bigint, p_absorvido bigint, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare s cadastros.pessoas; a cadastros.pessoas; v_tipo text; v_rep jsonb := '{}'::jsonb; v_ids jsonb; v_refs jsonb; v_id bigint;
begin
  if p_sobrevivente = p_absorvido then raise exception 'Escolha dois cadastros diferentes'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo'; end if;
  select * into s from cadastros.pessoas where id = p_sobrevivente for update;
  select * into a from cadastros.pessoas where id = p_absorvido for update;
  if s.id is null or a.id is null then raise exception 'Cadastro não encontrado'; end if;
  if s.mesclado_em is not null or a.mesclado_em is not null then raise exception 'Um dos cadastros já foi mesclado'; end if;
  if s.doc is not null and a.doc is not null and s.doc <> a.doc then
    raise exception 'CNPJ/CPF diferentes — são pessoas diferentes (ex.: filiais); não dá para mesclar';
  end if;
  v_tipo := case when s.empresa = a.empresa then 'mesclar' else 'agrupar' end;

  if v_tipo = 'agrupar' then
    if a.doc is not null and s.doc is null then
      raise exception 'Escolha como sobrevivente o cadastro que tem CNPJ/CPF';
    end if;
    insert into cadastros.mesclas (tipo, sobrevivente_id, absorvido_id, empresa, antes, motivo, por)
    values ('agrupar', s.id, a.id, a.empresa, jsonb_build_object('entidade', a.entidade_id), p_motivo, p_por) returning id into v_id;
    update cadastros.pessoas set entidade_id = s.entidade_id, updated_at = now(), updated_by = p_por where id = a.id;
    insert into cadastros.pessoas_hist (pessoa_id, acao, depois, por) values
      (a.id, 'agrupado', jsonb_build_object('com', s.id, 'mescla', v_id, 'motivo', p_motivo), p_por),
      (s.id, 'agrupado', jsonb_build_object('com', a.id, 'mescla', v_id, 'motivo', p_motivo), p_por);
    return jsonb_build_object('id', v_id, 'tipo', 'agrupar');
  end if;

  -- Mesma empresa: re-aponta as tabelas do painel (só linhas nativas).
  with u as (update compras.pedidos set fornecedor_cod = s.codigo
              where empresa = a.empresa and fornecedor_cod = a.codigo and coalesce(origem, '') <> 'omie' returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('pedidos', v_ids);
  with u as (update finance.pagar_previsto set fornecedor_cod = s.codigo
              where empresa = a.empresa and fornecedor_cod = a.codigo returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('pagar_previsto', v_ids);
  with u as (update finance.receber set codigo_cliente_omie = s.codigo
              where empresa = a.empresa and codigo_cliente_omie = a.codigo and coalesce(origem, '') <> 'omie' returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('receber', v_ids);
  with u as (update vendas.documentos set cliente_codigo = s.codigo
              where empresa = a.empresa and cliente_codigo = a.codigo returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('vendas', v_ids);
  with u as (update platform.pc_cliente_atribuicao set codigo_cliente_omie = s.codigo
              where empresa = a.empresa and codigo_cliente_omie = a.codigo returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('atribuicao', v_ids);
  with u as (update compras.item_fornecedor_alias set fornecedor_cod = s.codigo
              where empresa = a.empresa and fornecedor_cod = a.codigo returning id)
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_ids from u; v_rep := v_rep || jsonb_build_object('alias', v_ids);
  with u as (update cadastros.vinculos set codigo = s.codigo, como = 'mesclado'
              where empresa = a.empresa and codigo = a.codigo returning jsonb_build_object('app', app, 'ref', ref) j)
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_refs from u; v_rep := v_rep || jsonb_build_object('vinculos', v_refs);

  insert into cadastros.mesclas (tipo, sobrevivente_id, absorvido_id, empresa, codigo_antigo, codigo_novo, antes, repontes, motivo, por)
  values ('mesclar', s.id, a.id, a.empresa, a.codigo, s.codigo,
          jsonb_build_object('a', jsonb_build_object('ativo', a.ativo, 'doc', a.cnpj_cpf, 'entidade', a.entidade_id),
                             's', jsonb_build_object('doc', s.cnpj_cpf, 'entidade', s.entidade_id,
                                                     'cliente', s.eh_cliente, 'fornecedor', s.eh_fornecedor, 'transportadora', s.eh_transportadora)),
          v_rep, p_motivo, p_por)
  returning id into v_id;

  -- O sobrevivente herda o documento e os papéis que lhe faltavam.
  update cadastros.pessoas set mesclado_em = s.id, ativo = false, cnpj_cpf = case when s.doc is null then null else cnpj_cpf end,
         updated_at = now(), updated_by = p_por where id = a.id;
  update cadastros.pessoas set
    cnpj_cpf = coalesce(cnpj_cpf, a.cnpj_cpf),
    eh_cliente = eh_cliente or a.eh_cliente, eh_fornecedor = eh_fornecedor or a.eh_fornecedor,
    eh_transportadora = eh_transportadora or a.eh_transportadora,
    updated_at = now(), updated_by = p_por
  where id = s.id;
  insert into cadastros.pessoas_hist (pessoa_id, acao, depois, por) values
    (a.id, 'mesclado_em', jsonb_build_object('sobrevivente', s.id, 'codigo', s.codigo, 'mescla', v_id, 'motivo', p_motivo), p_por),
    (s.id, 'absorveu', jsonb_build_object('absorvido', a.id, 'codigo', a.codigo, 'mescla', v_id, 'motivo', p_motivo), p_por);
  return jsonb_build_object('id', v_id, 'tipo', 'mesclar', 'repontes', v_rep);
end $$;

create or replace function orders.cadastros_desfazer_mescla(p_id bigint, p_por text) returns jsonb
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare m cadastros.mesclas; s cadastros.pessoas; a cadastros.pessoas; j jsonb;
begin
  select * into m from cadastros.mesclas where id = p_id for update;
  if not found then raise exception 'Mescla % não encontrada', p_id; end if;
  if m.desfeita_em is not null then raise exception 'Esta mescla já foi desfeita'; end if;
  select * into s from cadastros.pessoas where id = m.sobrevivente_id;
  select * into a from cadastros.pessoas where id = m.absorvido_id;

  if m.tipo = 'agrupar' then
    update cadastros.pessoas set entidade_id = (m.antes->>'entidade')::bigint, updated_at = now(), updated_by = p_por where id = a.id;
  else
    update compras.pedidos set fornecedor_cod = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'pedidos') x);
    update finance.pagar_previsto set fornecedor_cod = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'pagar_previsto') x);
    update finance.receber set codigo_cliente_omie = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'receber') x);
    update vendas.documentos set cliente_codigo = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'vendas') x);
    update platform.pc_cliente_atribuicao set codigo_cliente_omie = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'atribuicao') x);
    update compras.item_fornecedor_alias set fornecedor_cod = m.codigo_antigo
     where id::text in (select x from jsonb_array_elements_text(m.repontes->'alias') x);
    for j in select * from jsonb_array_elements(coalesce(m.repontes->'vinculos', '[]'::jsonb)) loop
      update cadastros.vinculos set codigo = m.codigo_antigo, como = 'desfeito' where app = j->>'app' and ref = j->>'ref';
    end loop;
    -- documento: tira do sobrevivente o que veio do absorvido, devolve ao absorvido.
    update cadastros.pessoas set cnpj_cpf = m.antes->'s'->>'doc',
           eh_cliente = (m.antes->'s'->>'cliente')::boolean, eh_fornecedor = (m.antes->'s'->>'fornecedor')::boolean,
           eh_transportadora = (m.antes->'s'->>'transportadora')::boolean, updated_at = now(), updated_by = p_por
     where id = s.id;
    update cadastros.pessoas set mesclado_em = null, ativo = coalesce((m.antes->'a'->>'ativo')::boolean, true),
           cnpj_cpf = m.antes->'a'->>'doc', updated_at = now(), updated_by = p_por
     where id = a.id;
    update cadastros.pessoas set entidade_id = (m.antes->'s'->>'entidade')::bigint where id = s.id;
    update cadastros.pessoas set entidade_id = (m.antes->'a'->>'entidade')::bigint where id = a.id;
  end if;
  update cadastros.mesclas set desfeita_em = now(), desfeita_por = p_por where id = m.id;
  insert into cadastros.pessoas_hist (pessoa_id, acao, depois, por) values
    (a.id, 'mescla_desfeita', jsonb_build_object('mescla', m.id), p_por),
    (s.id, 'mescla_desfeita', jsonb_build_object('mescla', m.id), p_por);
  return jsonb_build_object('id', m.id, 'desfeita', true);
end $$;

revoke all on function orders.cadastros_duplicidades(int) from public, anon, authenticated;
revoke all on function orders.cadastros_ignorar_dup(bigint[], text) from public, anon, authenticated;
revoke all on function orders.cadastros_mesclar(bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function orders.cadastros_desfazer_mescla(bigint, text) from public, anon, authenticated;
grant execute on function orders.cadastros_duplicidades(int) to service_role;
grant execute on function orders.cadastros_ignorar_dup(bigint[], text) to service_role;
grant execute on function orders.cadastros_mesclar(bigint, bigint, text, text) to service_role;
grant execute on function orders.cadastros_desfazer_mescla(bigint, text) to service_role;

-- ── Ajustes nas funções existentes ─────────────────────────────────────────
-- Fichas contam também os códigos de quem foi mesclado; o sync do Omie não
-- reativa mesclados; a lista não mostra mesclados como ativos.
do $$ declare d text;
begin
  d := pg_get_functiondef('orders.cadastros_ficha_cliente(bigint)'::regprocedure);
  d := replace(d, 'v_cods := array_remove(array[p.codigo::text, p.codigo_omie::text], null);', 'v_cods := cadastros.codigos_de(p.id)::text[];');
  execute d;
  d := pg_get_functiondef('orders.cadastros_ficha_fornecedor(bigint)'::regprocedure);
  d := replace(d, 'v_cods := array_remove(array[p.codigo, p.codigo_omie], null);', 'v_cods := cadastros.codigos_de(p.id);');
  execute d;
  d := pg_get_functiondef('orders.cadastros_sync_omie()'::regprocedure);
  d := replace(d, 'where p.origem = ''omie'' and not p.editado_no_painel', 'where p.origem = ''omie'' and not p.editado_no_painel and p.mesclado_em is null');
  execute d;
  d := pg_get_functiondef('orders.cadastros_listar(text,text,text,boolean,integer,integer)'::regprocedure);
  d := replace(d, 'and (not coalesce(p_ativos, true) or p.ativo)', 'and (not coalesce(p_ativos, true) or (p.ativo and p.mesclado_em is null))');
  execute d;
end $$;

-- ids genéricos (uuid/bigint) nas mesclas
-- (aplicado como p10_cadastros_sem_duplicados_5_ids_genericos: v_ids jsonb; desfazer compara id::text)

-- Ficha 360 (05/10/26): a pessoa inteira — todas as empresas do grupo (mesma entidade).
-- As secções pesadas reaproveitam cadastros_ficha_cliente/fornecedor por empresa; aqui
-- ficam as partes novas: base (irmãos, mesclas, apps ligadas, parecidos), extrato
-- financeiro (baixas nativas + títulos pagos/recebidos no Omie + movimentos do banco
-- conciliados), faturamento nativo (fat_emissoes) e compras (itens comprados, RC/PC abertos).
create or replace function orders.cadastros_ficha360(p_id bigint, p_secao text) returns jsonb
language plpgsql stable security definer set search_path to 'cadastros', 'public' as $$
declare p cadastros.pessoas; v_ids bigint[]; r jsonb;
begin
  select * into p from cadastros.pessoas where id = p_id;
  if not found then raise exception 'Cadastro % não encontrado', p_id; end if;
  p := cadastros.sobrevivente(p);
  select array_agg(id order by (id = p.id) desc, empresa) into v_ids
    from cadastros.pessoas where entidade_id = p.entidade_id and mesclado_em is null;

  if p_secao = 'base' then
    return jsonb_build_object(
      'pessoa', cadastros.pessoa_json(p),
      'irmaos', (select jsonb_agg(jsonb_build_object('id', q.id, 'empresa', q.empresa, 'codigo', q.codigo, 'codigoOmie', q.codigo_omie,
                   'origem', q.origem, 'cliente', q.eh_cliente, 'fornecedor', q.eh_fornecedor, 'transportadora', q.eh_transportadora,
                   'ativo', q.ativo) order by array_position(v_ids, q.id)) from cadastros.pessoas q where q.id = any(v_ids)),
      'absorvidos', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'empresa', q.empresa, 'codigo', q.codigo, 'razao', q.razao_social))
                   from cadastros.pessoas q where q.mesclado_em = any(v_ids)), '[]'::jsonb),
      'mesclas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'sobrevivente', m.sobrevivente_id, 'absorvido', m.absorvido_id,
                   'motivo', m.motivo, 'por', m.por, 'em', m.em, 'desfeitaEm', m.desfeita_em) order by m.em desc)
                   from cadastros.mesclas m where m.sobrevivente_id = any(v_ids) or m.absorvido_id = any(v_ids)), '[]'::jsonb),
      'apps', coalesce((select jsonb_agg(jsonb_build_object('app', v.app, 'ref', v.ref, 'como', v.como, 'empresa', v.empresa, 'codigo', v.codigo))
                   from cadastros.vinculos v join cadastros.pessoas q on q.empresa = v.empresa and q.codigo = v.codigo where q.id = any(v_ids)), '[]'::jsonb),
      'parecidos', cadastros.candidatos(jsonb_build_object('razao', p.razao_social, 'doc', p.cnpj_cpf, 'cidade', p.cidade,
                   'telefone', p.telefone, 'email', p.email, 'excluir', p.id), 5),
      'historico', coalesce((select jsonb_agg(jsonb_build_object('acao', h.acao, 'por', h.por, 'em', h.em, 'empresa', q.empresa,
                   'detalhe', h.depois - 'contatos' - 'obs') order by h.em desc)
                   from (select * from cadastros.pessoas_hist where pessoa_id = any(v_ids) order by em desc limit 40) h
                   join cadastros.pessoas q on q.id = h.pessoa_id), '[]'::jsonb));
  end if;

  if p_secao = 'extrato' then
    -- Movimento financeiro: baixas nativas (com o movimento do banco conciliado) + títulos do Omie pagos/recebidos.
    with docs as (select distinct doc from cadastros.pessoas where id = any(v_ids) and doc is not null),
    cods as (select empresa, unnest(cadastros.codigos_de(id)) cod from cadastros.pessoas where id = any(v_ids)),
    nat as (
      select b.data, b.empresa, b.natureza, b.valor, b.documento, b.origem, b.estornado_em,
             m.data as mov_data, m.banco, m.memo, m.fitid, b.contraparte
        from finance.baixas b left join finance.banco_movimentos m on m.id = b.movimento_id
       where b.estornado_em is null
         and (exists (select 1 from finance.pagar_previsto x where x.id = b.pagar_id
                         and (x.fornecedor_cod in (select cod from cods where cods.empresa = x.empresa)
                              or regexp_replace(coalesce(x.fornecedor_cnpj, ''), '\D', '', 'g') in (select doc from docs)))
              or exists (select 1 from finance.receber x where x.id::text = b.receber_id::text
                         and (x.codigo_cliente_omie in (select cod from cods where cods.empresa = x.empresa)
                              or regexp_replace(coalesce(x.cliente_cnpj, ''), '\D', '', 'g') in (select doc from docs))))
    ),
    omie as (
      select x.pagamento as data, x.empresa, x.tipo as natureza, x.val_pago as valor, x.numero_documento as documento,
             'omie'::text as origem, x.numero_documento_fiscal as nf, x.numero_pedido as pedido
        from finance.v_titulos_omie x
       where coalesce(x.val_pago, 0) > 0 and x.pagamento is not null
         and (x.codigo_cliente_fornecedor in (select cod from cods where cods.empresa = x.empresa)
              or regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') in (select doc from docs))
       order by x.pagamento desc limit 300
    )
    select jsonb_build_object('itens', coalesce((select jsonb_agg(j order by (j->>'data') desc) from (
        select jsonb_build_object('data', data, 'empresa', empresa, 'natureza', case when natureza in ('pagar', 'P') then 'pagar' else 'receber' end,
                 'valor', valor, 'documento', documento, 'origem', 'painel', 'banco', banco, 'movData', mov_data, 'memo', memo,
                 'conciliado', fitid is not null) j from nat
        union all
        select jsonb_build_object('data', data, 'empresa', empresa, 'natureza', case when natureza in ('pagar', 'P') then 'pagar' else 'receber' end,
                 'valor', valor, 'documento', documento, 'origem', 'omie', 'nf', nf, 'pedido', pedido, 'conciliado', null) from omie) z), '[]'::jsonb))
      into r;
    return r;
  end if;

  if p_secao = 'fat' then
    -- Notas emitidas pelo painel (Focus) para esta pessoa, por CNPJ/CPF do destinatário.
    with docs as (select distinct doc from cadastros.pessoas where id = any(v_ids) and doc is not null)
    select jsonb_build_object('emissoes', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'empresa', e.empresa, 'ambiente', e.ambiente,
             'tipo', e.tipo, 'numero', e.numero, 'serie', e.serie, 'status', e.status, 'valor', e.valor_total, 'origem', e.origem_rotulo,
             'autorizadaEm', e.autorizada_em, 'canceladaEm', e.cancelada_em, 'criadaEm', e.created_at, 'ensaio', e.ensaio,
             'temXml', e.xml_path is not null, 'temPdf', e.pdf_path is not null) order by e.created_at desc)
        from orders.fat_emissoes e
       where regexp_replace(coalesce(e.cliente->>'cnpj', e.cliente->>'cpf', e.cliente->>'doc', e.cliente->>'cnpj_cpf', ''), '\D', '', 'g') in (select doc from docs)
       limit 200), '[]'::jsonb))
      into r;
    return r;
  end if;

  if p_secao = 'compras_extra' then
    with docs as (select distinct doc from cadastros.pessoas where id = any(v_ids) and doc is not null),
    cods as (select empresa, unnest(cadastros.codigos_de(id)) cod from cadastros.pessoas where id = any(v_ids)),
    pcs as (
      select c.* from compras.pedidos c
       where (c.fornecedor_cod in (select cod from cods where cods.empresa = c.empresa)
              or regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g') in (select doc from docs))
    )
    select jsonb_build_object(
      'itens', coalesce((select jsonb_agg(jsonb_build_object('codigo', i.produto_cod, 'descricao', i.descricao, 'unidade', i.unidade,
                  'qtd', i.qtd, 'vezes', i.vezes, 'ultimoPreco', i.ult, 'ultimaCompra', i.quando, 'total', i.total) order by i.total desc nulls last)
          from (select it.produto_cod, max(it.descricao) descricao, max(it.unidade) unidade, sum(it.qtd) qtd, count(*) vezes,
                       (array_agg(it.valor_unit order by c.emissao desc nulls last))[1] ult, max(c.emissao) quando,
                       sum(it.qtd * it.valor_unit) total
                  from pcs c join compras.itens it on it.pedido_id = c.id
                 where c.tipo = 'PC' and not c.cancelado
                 group by it.produto_cod order by sum(it.qtd * it.valor_unit) desc nulls last limit 60) i), '[]'::jsonb),
      'abertos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'numero', c.numero, 'empresa', c.empresa,
                  'etapa', c.etapa, 'emissao', c.emissao, 'previsao', c.previsao, 'valor', c.valor_total, 'pvos', coalesce(c.pv_os_painel, c.pv_os),
                  'aprov', c.aprov_status) order by c.emissao desc nulls last)
          from pcs c where not c.cancelado and coalesce(c.etapa, '') not in ('80') limit 100), '[]'::jsonb))
      into r;
    return r;
  end if;

  if p_secao = 'irmaos' then
    return to_jsonb(v_ids);
  end if;
  raise exception 'secção inválida: %', p_secao;
end $$;
revoke all on function orders.cadastros_ficha360(bigint, text) from public, anon, authenticated;
grant execute on function orders.cadastros_ficha360(bigint, text) to service_role;

-- Ficha 360 mais rápida (aplicado como p10_ficha360_arrays): os códigos e documentos da
-- pessoa calculam-se uma vez em v_cods/v_docs (array) em vez de subconsultas correlacionadas
-- (compras_extra passou de 23 s para 40 ms). Ver a definição viva com pg_get_functiondef.

-- Índices para o resolver das apps (aplicado como p10_indices_nome_chave): o cron do CRM
-- mandava 300 clientes de uma vez e caía por tempo (75 ms/cliente → 6 ms/cliente).
create index if not exists pessoas_nk_razao_btree on cadastros.pessoas (empresa, cadastros.nome_chave(razao_social));
create index if not exists pessoas_nk_fantasia_btree on cadastros.pessoas (empresa, cadastros.nome_chave(nome_fantasia));
create index if not exists pessoas_doc_idx on cadastros.pessoas (doc) where doc is not null;
create index if not exists pessoas_codigo_idx on cadastros.pessoas (codigo);
create index if not exists pessoas_codigo_omie_any_idx on cadastros.pessoas (codigo_omie) where codigo_omie is not null;
