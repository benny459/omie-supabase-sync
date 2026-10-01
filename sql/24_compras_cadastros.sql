-- 24 — Cadastros do Omie para Compras (departamentos, compradores, empresas)
--      e entrada para o sync read-only (01/10/2026).
--
-- O schema compras não é exposto no PostgREST; os scripts do GitHub Actions
-- gravam por RPC em orders.compras_* (service_role).

create table if not exists compras.cad_empresas (
  empresa       text primary key,          -- SF / CD / WW
  codigo_omie   bigint,
  razao_social  text,
  nome_fantasia text,
  cnpj          text,
  ie            text,
  im            text,
  endereco      text,
  numero        text,
  complemento   text,
  bairro        text,
  cidade        text,
  uf            text,
  cep           text,
  telefone      text,
  email         text,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);
alter table compras.cad_empresas enable row level security;
grant all on compras.cad_empresas to service_role;

-- Grava uma lista de cadastros vinda do Omie. p_tipo: departamentos | compradores | empresas.
create or replace function orders.compras_gravar_cadastro(p_tipo text, p_empresa text, p_rows jsonb)
returns int language plpgsql security definer set search_path = compras, public as $$
declare n int := 0;
begin
  if p_tipo = 'departamentos' then
    insert into compras.cad_departamentos (empresa, codigo, descricao, inativo, synced_at)
    select p_empresa, x->>'codigo', coalesce(nullif(x->>'descricao', ''), x->>'codigo'),
           coalesce(x->>'inativo', 'N') = 'S', now()
      from jsonb_array_elements(p_rows) x where coalesce(x->>'codigo', '') <> ''
    on conflict (empresa, codigo) do update set descricao = excluded.descricao, inativo = excluded.inativo, synced_at = now();
    get diagnostics n = row_count;
  elsif p_tipo = 'compradores' then
    insert into compras.cad_compradores (empresa, codigo, nome, synced_at)
    select p_empresa, (x->>'codigo')::bigint, x->>'nome', now()
      from jsonb_array_elements(p_rows) x where coalesce(x->>'codigo', '') ~ '^\d+$' and coalesce(x->>'nome', '') <> ''
    on conflict (empresa, codigo) do update set nome = excluded.nome, synced_at = now();
    get diagnostics n = row_count;
  elsif p_tipo = 'empresas' then
    insert into compras.cad_empresas (empresa, codigo_omie, razao_social, nome_fantasia, cnpj, ie, im, endereco, numero,
                                      complemento, bairro, cidade, uf, cep, telefone, email, raw, synced_at)
    select p_empresa, nullif(x->>'codigo_empresa', '')::bigint, x->>'razao_social', x->>'nome_fantasia', x->>'cnpj',
           x->>'inscricao_estadual', x->>'inscricao_municipal', x->>'endereco', x->>'endereco_numero', x->>'complemento',
           x->>'bairro', x->>'cidade', x->>'estado', x->>'cep',
           nullif(trim(coalesce(x->>'telefone1_ddd', '') || ' ' || coalesce(x->>'telefone1_numero', '')), ''),
           x->>'email', x, now()
      from jsonb_array_elements(p_rows) x limit 1
    on conflict (empresa) do update set codigo_omie = excluded.codigo_omie, razao_social = excluded.razao_social,
      nome_fantasia = excluded.nome_fantasia, cnpj = excluded.cnpj, ie = excluded.ie, im = excluded.im,
      endereco = excluded.endereco, numero = excluded.numero, complemento = excluded.complemento,
      bairro = excluded.bairro, cidade = excluded.cidade, uf = excluded.uf, cep = excluded.cep,
      telefone = excluded.telefone, email = excluded.email, raw = excluded.raw, synced_at = now();
    get diagnostics n = row_count;
  else
    raise exception 'tipo de cadastro inválido: %', p_tipo;
  end if;
  return n;
end $$;

-- Para o workflow: conciliar depois do import e contar o espelho por empresa.
create or replace function orders.compras_conciliar()
returns jsonb language sql security definer set search_path = compras, public as $$
  select compras.conciliar_omie()
$$;

create or replace function orders.compras_contagem_espelho()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_object_agg(empresa, jsonb_build_object('pedidos', n, 'min', mn, 'max', mx)), '{}'::jsonb)
    from (select empresa, count(distinct ncod_ped) n,
                 min(to_date(nullif(dinc_data, ''), 'DD/MM/YYYY')) mn, max(to_date(nullif(dinc_data, ''), 'DD/MM/YYYY')) mx
            from orders.pedidos_compra group by 1) z
$$;

-- Dados da SAFE WATER conhecidos pelo cadastro da Focus NFe (30/09/2026) — o
-- sync do Omie sobrescreve quando rodar (ListarEmpresas).
insert into compras.cad_empresas (empresa, razao_social, nome_fantasia, cnpj, ie, im, endereco, numero, complemento,
                                  bairro, cidade, uf, cep, telefone, email)
values ('SF', 'SAFE WATER BRASIL LTDA', 'SAFE WATER BRASIL LTDA', '15.766.003/0001-08', '206878808115', '4AY5076',
        'Avenida Tucunaré', '550', 'GALPÃO AMJ/AMI', 'Tamboré', 'Barueri', 'SP', '06460-020', '(11) 4705-4848',
        'contasareceber@waterworks.com.br')
on conflict (empresa) do nothing;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'orders' and p.proname like 'compras\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
