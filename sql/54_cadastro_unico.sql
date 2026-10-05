-- 54 — Cadastro único de clientes para todas as plataformas (P8, 05/10/26)
--
-- cadastros.pessoas (sql/50) passa a ser o cadastro-mestre também da app de
-- Serviços (app.waterworks) e do CRM Legado (Propostas-WW). Cada app guarda na
-- sua linha local o par (empresa, codigo) do mestre; os dados partilhados vêm do
-- mestre, os dados próprios de cada app (subsistemas, contratos, equipamentos,
-- endereço da unidade, prospects do CRM) continuam locais.
--
-- As apps falam com o mestre pela rota /api/cadastros/sync (servidor-a-servidor,
-- passe HMAC com CADASTROS_SYNC_SECRET), que chama estas funções:
--   cadastros_resolver     liga linhas locais ao mestre (código Omie → CNPJ/CPF → nome
--                          exato único) e, se pedido, cria o mestre (origem = app)
--   cadastros_salvar_app   cria/edita o mestre a partir de uma app (mescla com o atual)
--   cadastros_mudancas     o que mudou no mestre desde X, só dos registos ligados à app
-- Nunca escreve no Omie.

alter table cadastros.pessoas drop constraint if exists pessoas_origem_check;
alter table cadastros.pessoas add constraint pessoas_origem_check
  check (origem in ('omie', 'painel', 'servicos', 'crm'));

create table if not exists cadastros.vinculos (
  app        text not null check (app in ('servicos', 'crm')),
  ref        text not null,
  empresa    text not null,
  codigo     bigint not null,
  como       text not null,
  criado_em  timestamptz not null default now(),
  primary key (app, ref)
);
create index if not exists vinculos_codigo_idx on cadastros.vinculos (empresa, codigo);
alter table cadastros.vinculos enable row level security;
revoke all on cadastros.vinculos from public, anon, authenticated;
grant all on cadastros.vinculos to service_role;

-- Nome comparável: maiúsculas, sem acentos, espaços simples.
create or replace function cadastros.nome_chave(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(upper(translate(trim(coalesce(t, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'), '')
$$;

-- ── Ligar linhas locais ao mestre ──────────────────────────────────────────
-- p_itens: [{ref, empresa?, codigoOmie?, doc?, nome?, ...campos do cadastro p/ criar}]
-- devolve [{ref, empresa, codigo, como}] — como: omie | doc | nome | criado | ambiguo | nao_achado
-- p_gravar=false: só consulta (prévia/relatório) — não grava vínculos nem cria nada.
create or replace function orders.cadastros_resolver(p_app text, p_itens jsonb, p_criar boolean default false, p_por text default null, p_gravar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare it jsonb; v_emp text; v_cod bigint; v_doc text; v_nome text; v_hit cadastros.pessoas; v_n int;
  v_como text; v_out jsonb := '[]'::jsonb; v_novo jsonb;
begin
  if p_app not in ('servicos', 'crm') then raise exception 'app inválida: %', p_app; end if;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_emp := upper(coalesce(nullif(it->>'empresa', ''), 'SF'));
    v_cod := case when coalesce(it->>'codigoOmie', '') ~ '^\d{4,}$' then (it->>'codigoOmie')::bigint end;
    v_doc := nullif(regexp_replace(coalesce(it->>'doc', ''), '\D', '', 'g'), '');
    if v_doc is not null and not cadastros.doc_valido(v_doc) then v_doc := null; end if;
    v_nome := cadastros.nome_chave(it->>'nome');
    v_hit := null; v_como := 'nao_achado';

    -- 1) já ligado antes
    select p.* into v_hit from cadastros.vinculos v join cadastros.pessoas p on p.empresa = v.empresa and p.codigo = v.codigo
     where v.app = p_app and v.ref = it->>'ref';
    if found then v_como := 'ligado'; end if;

    -- 2) código do Omie (o código dos registos vindos do Omie é o próprio código Omie)
    if v_hit.id is null and v_cod is not null then
      select * into v_hit from cadastros.pessoas
       where codigo = v_cod or codigo_omie = v_cod
       order by (empresa = v_emp) desc, (codigo = v_cod) desc limit 1;
      if found then v_como := 'omie'; end if;
    end if;

    -- 3) CNPJ/CPF (na empresa pedida; senão, único entre as empresas)
    if v_hit.id is null and v_doc is not null then
      select * into v_hit from cadastros.pessoas where empresa = v_emp and doc = v_doc limit 1;
      if not found then
        select count(*) into v_n from cadastros.pessoas where doc = v_doc;
        if v_n = 1 then select * into v_hit from cadastros.pessoas where doc = v_doc; end if;
      end if;
      if v_hit.id is not null then v_como := 'doc'; end if;
    end if;

    -- 4) nome exato (razão social ou fantasia), só se for único na empresa
    if v_hit.id is null and v_nome is not null then
      select count(*) into v_n from cadastros.pessoas
       where empresa = v_emp and (cadastros.nome_chave(razao_social) = v_nome or cadastros.nome_chave(nome_fantasia) = v_nome);
      if v_n = 1 then
        select * into v_hit from cadastros.pessoas
         where empresa = v_emp and (cadastros.nome_chave(razao_social) = v_nome or cadastros.nome_chave(nome_fantasia) = v_nome);
        v_como := 'nome';
      elsif v_n > 1 then v_como := 'ambiguo';
      end if;
    end if;

    -- 5) não existe no mestre: cria (origem = app), se pedido
    if v_hit.id is null and v_como = 'nao_achado' and p_criar and p_gravar and coalesce(nullif(trim(it->>'nome'), ''), nullif(trim(it->>'razao'), '')) is not null then
      v_novo := orders.cadastros_salvar_app(
        jsonb_strip_nulls(jsonb_build_object('empresa', v_emp, 'razao', coalesce(nullif(trim(it->>'razao'), ''), trim(it->>'nome')),
          'fantasia', it->>'fantasia', 'doc', v_doc, 'email', it->>'email', 'telefone', it->>'telefone',
          'cidade', it->>'cidade', 'uf', it->>'uf', 'logradouro', it->>'logradouro', 'cliente', true)),
        p_app, it->>'ref', coalesce(p_por, p_app));
      select * into v_hit from cadastros.pessoas where id = (v_novo->>'id')::bigint;
      v_como := 'criado';
    end if;

    if v_hit.id is not null and p_gravar then
      insert into cadastros.vinculos (app, ref, empresa, codigo, como)
      values (p_app, it->>'ref', v_hit.empresa, v_hit.codigo, v_como)
      on conflict (app, ref) do update set empresa = excluded.empresa, codigo = excluded.codigo,
        como = case when cadastros.vinculos.codigo = excluded.codigo then cadastros.vinculos.como else excluded.como end;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('ref', it->>'ref', 'empresa', v_hit.empresa, 'codigo', v_hit.codigo,
      'como', v_como, 'pessoa', case when v_hit.id is not null then cadastros.pessoa_json(v_hit) end));
  end loop;
  return v_out;
end $$;

-- ── Criar/editar o mestre a partir de uma app ──────────────────────────────
-- p: campos do cadastro (mesmas chaves de cadastros_salvar); com 'codigo' (+empresa)
-- edita esse registo, mesclando com o atual (o que a app não manda fica igual).
create or replace function orders.cadastros_salvar_app(p jsonb, p_app text, p_ref text default null, p_por text default null)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_atual cadastros.pessoas; v_emp text := upper(coalesce(nullif(p->>'empresa', ''), 'SF')); v_r jsonb; v_criado boolean := false;
begin
  if p_app not in ('servicos', 'crm') then raise exception 'app inválida: %', p_app; end if;
  if coalesce(p->>'codigo', '') ~ '^\d+$' then
    select * into v_atual from cadastros.pessoas where empresa = v_emp and codigo = (p->>'codigo')::bigint;
    if not found then raise exception 'Cadastro % / % não encontrado', v_emp, p->>'codigo'; end if;
  elsif p_ref is not null then
    select pe.* into v_atual from cadastros.vinculos v join cadastros.pessoas pe on pe.empresa = v.empresa and pe.codigo = v.codigo
     where v.app = p_app and v.ref = p_ref;
  end if;

  if v_atual.id is not null then
    v_r := orders.cadastros_salvar((cadastros.pessoa_json(v_atual) - 'codigo' - 'empresa') || (p - 'codigo' - 'empresa' - 'id')
             || jsonb_build_object('id', v_atual.id), coalesce(p_por, p_app));
  else
    v_r := orders.cadastros_salvar(jsonb_build_object('cliente', true) || (p - 'codigo' - 'id'), coalesce(p_por, p_app));
    update cadastros.pessoas set origem = p_app where id = (v_r->>'id')::bigint;
    v_criado := true;
  end if;

  if p_ref is not null then
    insert into cadastros.vinculos (app, ref, empresa, codigo, como)
    values (p_app, p_ref, v_r->>'empresa', (v_r->>'codigo')::bigint, case when v_criado then 'criado' else 'editado' end)
    on conflict (app, ref) do update set empresa = excluded.empresa, codigo = excluded.codigo;
  end if;
  return (select cadastros.pessoa_json(pe) from cadastros.pessoas pe where pe.id = (v_r->>'id')::bigint);
end $$;

-- ── O que mudou no mestre (só registos ligados à app) ──────────────────────
create or replace function orders.cadastros_mudancas(p_app text, p_desde timestamptz, p_lim int default 2000)
returns jsonb language sql stable security definer set search_path to 'cadastros', 'public' as $$
  with m as (
    select p.* from cadastros.pessoas p
     where p.updated_at > coalesce(p_desde, '-infinity'::timestamptz)
       and exists (select 1 from cadastros.vinculos v where v.app = p_app and v.empresa = p.empresa and v.codigo = p.codigo)
  ), o as (select * from m order by updated_at, id limit greatest(1, least(coalesce(p_lim, 2000), 5000)))
  select jsonb_build_object(
    'ate', (select max(updated_at) from o),
    'itens', coalesce((select jsonb_agg(cadastros.pessoa_json(o::cadastros.pessoas) || jsonb_build_object('refs',
        (select jsonb_agg(v.ref) from cadastros.vinculos v where v.app = p_app and v.empresa = o.empresa and v.codigo = o.codigo)))
      from o), '[]'::jsonb))
$$;

-- Busca no mestre (para o seletor de cliente das apps).
create or replace function orders.cadastros_buscar_app(p_q text, p_empresa text default 'SF', p_lim int default 20)
returns jsonb language sql stable security definer set search_path to 'cadastros', 'public' as $$
  select coalesce(jsonb_agg(cadastros.pessoa_json(p) order by p.razao_social), '[]'::jsonb)
    from (select * from cadastros.pessoas p
           where p.empresa = upper(coalesce(nullif(p_empresa, ''), 'SF')) and p.ativo and p.eh_cliente
             and (p.razao_social ilike '%' || p_q || '%' or p.nome_fantasia ilike '%' || p_q || '%'
                  or (length(regexp_replace(p_q, '\D', '', 'g')) >= 4 and p.doc like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
                  or p.codigo::text = trim(p_q))
           order by p.razao_social limit greatest(1, least(coalesce(p_lim, 20), 50))) p
$$;

revoke all on function orders.cadastros_resolver(text, jsonb, boolean, text, boolean) from public, anon, authenticated;
revoke all on function orders.cadastros_salvar_app(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function orders.cadastros_mudancas(text, timestamptz, int) from public, anon, authenticated;
revoke all on function orders.cadastros_buscar_app(text, text, int) from public, anon, authenticated;
grant execute on function orders.cadastros_resolver(text, jsonb, boolean, text, boolean) to service_role;
grant execute on function orders.cadastros_salvar_app(jsonb, text, text, text) to service_role;
grant execute on function orders.cadastros_mudancas(text, timestamptz, int) to service_role;
grant execute on function orders.cadastros_buscar_app(text, text, int) to service_role;
