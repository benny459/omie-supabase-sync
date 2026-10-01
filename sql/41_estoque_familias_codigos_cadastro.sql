-- 41 — Estoque v2: famílias com prefixo, código novo por família (F0001…), cadastro de item
-- e cópia no Omie · 01/10/2026. Só objetos novos (omie-data é compartilhado com o ALLKA).
--
-- Identidade do item: n_cod_prod (id do Omie). Item criado no painel que ainda não tem id do
-- Omie usa id negativo (-cadastro.id) até o Omie devolver o dele (orders.estoque_cadastro_omie_ok
-- troca o id em todas as tabelas do painel).

create table if not exists platform.estoque_familia (
  id bigserial primary key,
  empresa text not null default 'SF',
  nome text not null,
  prefixo text not null check (prefixo ~ '^[A-Z]{1,3}$'),
  descricao text,
  ativo boolean not null default true,
  sistema boolean not null default false,          -- "Sem família" (não se apaga)
  material boolean not null default true,          -- false: "família" que não é tipo de material (Ativo, Orçamentos…)
  mesclada_em bigint references platform.estoque_familia (id),
  omie_codigo_familia bigint,                      -- família correspondente no Omie (para IncluirProduto)
  proximo integer not null default 1,              -- próximo número do código (F0001 → 1)
  created_by_email text, created_at timestamptz not null default now(),
  updated_by_email text, updated_at timestamptz not null default now(),
  unique (empresa, prefixo)
);
create unique index if not exists estoque_familia_nome on platform.estoque_familia (empresa, lower(nome));
alter table platform.estoque_familia enable row level security;

-- Configuração do Estoque (ex.: revisão de famílias concluída → libera a recodificação).
create table if not exists platform.estoque_config (
  chave text primary key, valor jsonb not null, updated_by_email text, updated_at timestamptz not null default now()
);
alter table platform.estoque_config enable row level security;

-- Sugestão de família por item (motor: palavra da descrição + vizinho parecido + capítulo do NCM).
create table if not exists platform.estoque_familia_sugestao (
  empresa text not null, n_cod_prod bigint not null,
  familia_atual_id bigint references platform.estoque_familia (id),
  familia_sugerida_id bigint references platform.estoque_familia (id),
  confianca numeric not null default 0, motivo text,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'rejeitada', 'alterada')),
  familia_escolhida_id bigint references platform.estoque_familia (id),
  decidido_por_email text, decidido_em timestamptz, gerado_em timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
alter table platform.estoque_familia_sugestao enable row level security;

create table if not exists platform.estoque_item_familia (
  empresa text not null, n_cod_prod bigint not null,
  familia_id bigint not null references platform.estoque_familia (id),
  updated_by_email text, updated_at timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
alter table platform.estoque_item_familia enable row level security;

-- Códigos do painel. O atual tem atual=true; os anteriores ficam como apelido (busca e deep link).
create table if not exists platform.estoque_item_codigo (
  id bigserial primary key,
  empresa text not null, n_cod_prod bigint not null,
  codigo text not null, familia_id bigint references platform.estoque_familia (id),
  atual boolean not null default true,
  motivo text not null default 'inicial',          -- inicial | recodificado | cadastro
  created_by_email text, created_at timestamptz not null default now(),
  unique (empresa, codigo)
);
create unique index if not exists estoque_item_codigo_atual on platform.estoque_item_codigo (empresa, n_cod_prod) where atual;
alter table platform.estoque_item_codigo enable row level security;

create table if not exists platform.estoque_item_cadastro (
  id bigserial primary key,
  empresa text not null default 'SF',
  n_cod_prod bigint,                               -- id do Omie (null enquanto não existe lá)
  origem text not null check (origem in ('painel', 'omie')),  -- criado no painel | edição de item do Omie
  descricao text, unidade text, ncm text, ean text,
  preco_ref numeric, local_padrao bigint,
  minimo numeric, ponto_pedido numeric, maximo numeric,
  foto_url text, obs text, ativo boolean not null default true,
  omie_status text not null default 'nao_enviado' check (omie_status in ('nao_enviado', 'ok', 'erro', 'desligado')),
  omie_erro text, omie_codigo text, omie_enviado_em timestamptz, omie_resposta jsonb,
  created_by_email text, created_at timestamptz not null default now(),
  updated_by_email text, updated_at timestamptz not null default now()
);
create unique index if not exists estoque_item_cadastro_prod on platform.estoque_item_cadastro (empresa, n_cod_prod) where n_cod_prod is not null;
alter table platform.estoque_item_cadastro enable row level security;

revoke all on platform.estoque_familia, platform.estoque_item_familia, platform.estoque_item_codigo, platform.estoque_item_cadastro,
  platform.estoque_config, platform.estoque_familia_sugestao from anon, authenticated;
grant usage, select on sequence platform.estoque_familia_id_seq, platform.estoque_item_codigo_id_seq, platform.estoque_item_cadastro_id_seq to service_role;

-- "Sem família" de sistema (prefixo X, editável).
insert into platform.estoque_familia (empresa, nome, prefixo, descricao, sistema, material)
values ('SF', 'Sem família', 'X', 'Itens ainda sem família', true, false)
on conflict do nothing;

-- Prefixo sugerido (1–3 letras, único na empresa): 1ª letra; iniciais de 2 palavras; 2 letras; 3 letras; …
create or replace function orders.estoque_prefixo_sugerido(p_empresa text, p_nome text) returns text
language plpgsql stable security definer set search_path = platform, orders, public as $fn$
declare w text[]; c text; cand text[] := '{}'; a int; b int;
begin
  w := regexp_split_to_array(btrim(regexp_replace(orders.fn_norm_desc(p_nome), '[^A-Z ]', '', 'g')), '\s+');
  if coalesce(w[1], '') = '' then w := array['X']; end if;
  cand := cand || left(w[1], 1);
  if array_length(w, 1) >= 2 and w[2] <> '' then cand := cand || (left(w[1], 1) || left(w[2], 1)); end if;
  cand := cand || left(w[1], 2) || left(w[1], 3);
  if array_length(w, 1) >= 3 and w[3] <> '' then cand := cand || (left(w[1], 1) || left(w[2], 1) || left(w[3], 1)); end if;
  for a in 2..length(w[1]) loop cand := cand || (left(w[1], 1) || substr(w[1], a, 1)); end loop;
  for a in 2..length(w[1]) loop for b in a + 1..length(w[1]) loop cand := cand || (left(w[1], 1) || substr(w[1], a, 1) || substr(w[1], b, 1)); end loop; end loop;
  foreach c in array cand loop
    if c ~ '^[A-Z]{1,3}$' and not exists (select 1 from platform.estoque_familia where empresa = p_empresa and prefixo = c) then return c; end if;
  end loop;
  for a in 65..90 loop
    c := left(w[1], 1) || chr(a);
    if not exists (select 1 from platform.estoque_familia where empresa = p_empresa and prefixo = c) then return c; end if;
  end loop;
  raise exception 'Sem prefixo livre para %', p_nome;
end
$fn$;

-- Importa as famílias do Omie (espelho orders.produto_familia) como famílias do painel, com prefixo
-- sugerido e marcando as que não são tipo de material. Idempotente (por omie_codigo_familia).
create or replace function orders.estoque_familias_importar_omie(p_empresa text, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare r record; n int := 0;
begin
  for r in select codigo_familia, max(descricao_familia) as nome from orders.produto_familia
           where empresa = p_empresa and codigo_familia is not null and coalesce(descricao_familia, '') <> ''
           group by 1 order by count(*) desc
  loop
    if exists (select 1 from platform.estoque_familia where empresa = p_empresa and omie_codigo_familia = r.codigo_familia) then continue; end if;
    if exists (select 1 from platform.estoque_familia where empresa = p_empresa and lower(nome) = lower(r.nome)) then
      update platform.estoque_familia set omie_codigo_familia = r.codigo_familia
       where empresa = p_empresa and lower(nome) = lower(r.nome) and omie_codigo_familia is null;
      continue;
    end if;
    insert into platform.estoque_familia (empresa, nome, prefixo, omie_codigo_familia, material, created_by_email, updated_by_email)
    values (p_empresa, r.nome, orders.estoque_prefixo_sugerido(p_empresa, r.nome), r.codigo_familia,
            orders.fn_norm_desc(r.nome) !~ '(ORCAMENTO|PEDIDO|ATIVO|FRETE|DESPESA|SISTEMA|MISCELANEA|SERVICO|IMOBILIZADO|USO E CONSUMO)',
            p_email, p_email);
    n := n + 1;
  end loop;
  return jsonb_build_object('importadas', n);
end
$fn$;

-- ── Saldo por local (ponto único) — inclui itens criados no painel sem posição no Omie ──
create or replace view orders.v_estoque_saldo_local as
with aj as (
  select empresa, n_cod_prod, codigo_local_estoque, sum(diferenca) as ajuste
  from platform.estoque_ajuste where status = 'aplicado'
  group by 1, 2, 3
), cad as (
  select c.empresa, coalesce(c.n_cod_prod, -c.id) as n_cod_prod, coalesce(c.local_padrao, 2264756939) as codigo_local_estoque,
         c.preco_ref, c.minimo
  from platform.estoque_item_cadastro c
  where c.origem = 'painel'
    and not exists (select 1 from orders.estoque_posicao p where p.empresa = c.empresa and p.n_cod_prod = c.n_cod_prod)
), extra as (
  select aj.empresa, aj.n_cod_prod, aj.codigo_local_estoque
  from aj
  where not exists (select 1 from orders.estoque_posicao p
                    where p.empresa = aj.empresa and p.n_cod_prod = aj.n_cod_prod and p.codigo_local_estoque = aj.codigo_local_estoque)
    and exists (select 1 from orders.estoque_posicao p where p.empresa = aj.empresa and p.n_cod_prod = aj.n_cod_prod)
)
select p.empresa, p.n_cod_prod, p.codigo_local_estoque, p.codigo, p.descricao,
       p.saldo as saldo_omie, coalesce(aj.ajuste, 0) as ajuste, p.saldo + coalesce(aj.ajuste, 0) as saldo,
       p.fisico, p.reservado, p.pendente, p.cmc, p.estoque_minimo, p.data_posicao
from orders.estoque_posicao p
left join aj on aj.empresa = p.empresa and aj.n_cod_prod = p.n_cod_prod and aj.codigo_local_estoque = p.codigo_local_estoque
union all
select e.empresa, e.n_cod_prod, e.codigo_local_estoque, b.codigo, b.descricao,
       0, aj.ajuste, aj.ajuste, 0, 0, 0, b.cmc, b.estoque_minimo, b.data_posicao
from extra e
join aj on aj.empresa = e.empresa and aj.n_cod_prod = e.n_cod_prod and aj.codigo_local_estoque = e.codigo_local_estoque
join lateral (select codigo, descricao, cmc, estoque_minimo, data_posicao from orders.estoque_posicao p
              where p.empresa = e.empresa and p.n_cod_prod = e.n_cod_prod order by p.codigo_local_estoque limit 1) b on true
union all
-- Itens do painel ainda sem posição no Omie: um local (o padrão) + locais que tenham ajuste.
select c.empresa, c.n_cod_prod, l.loc, null::text, null::text,
       0, coalesce(aj.ajuste, 0), coalesce(aj.ajuste, 0), 0, 0, 0, coalesce(c.preco_ref, 0), coalesce(c.minimo, 0), current_date
from cad c
cross join lateral (select c.codigo_local_estoque as loc
                    union select a.codigo_local_estoque from aj a where a.empresa = c.empresa and a.n_cod_prod = c.n_cod_prod) l
left join aj on aj.empresa = c.empresa and aj.n_cod_prod = c.n_cod_prod and aj.codigo_local_estoque = l.loc;

create or replace view orders.v_estoque_item as
with pos as (
  select empresa, n_cod_prod, max(codigo) as codigo, orders.fn_html_unescape(max(descricao)) as descricao,
         sum(saldo) as saldo, sum(saldo_omie) as saldo_omie, sum(ajuste) as ajuste,
         sum(fisico) as fisico, sum(reservado) as reservado, sum(pendente) as pendente,
         coalesce(sum(cmc * greatest(saldo, 0)) / nullif(sum(greatest(saldo, 0)), 0), max(cmc)) as cmc,
         max(estoque_minimo) as estoque_minimo, max(data_posicao) as data_posicao,
         bool_or(saldo < 0) as local_negativo,
         jsonb_agg(jsonb_build_object('local', codigo_local_estoque::text, 'saldo', saldo, 'saldo_omie', saldo_omie,
           'ajuste', ajuste, 'pendente', pendente, 'reservado', reservado, 'cmc', cmc) order by codigo_local_estoque) as locais
  from orders.v_estoque_saldo_local group by 1, 2
), c90 as (
  select empresa, id_prod, sum(abs(qtde)) as q90
  from orders.estoque_movimentos
  where tipo = 'saida' and coalesce(cancelamento, 'N') <> 'S' and dt_mov >= current_date - 90
  group by 1, 2
), um as (
  select empresa, id_prod, max(dt_mov) as ult, count(*) as n
  from orders.estoque_movimentos where coalesce(cancelamento, 'N') <> 'S' group by 1, 2
), pcs as (
  select p.empresa, i.ncod_prod,
         count(*) filter (where coalesce(p.etapa, '') not in ('60', '80') and p.dt_rec is null
                            and coalesce(i.qtd_recebida, 0) < i.qtd
                            and p.emissao < current_date - 60 and p.emissao >= current_date - 730) as pcs_velhos,
         count(*) filter (where i.qtd_recebida > i.qtd) as rec_a_mais,
         max(p.emissao) as ult_pc
  from compras.itens i join compras.pedidos p on p.id = i.pedido_id
  where p.tipo = 'PC' and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2
), dup as (
  select empresa, prod_a as id from orders.v_estoque_duplicidade
  union select empresa, prod_b from orders.v_estoque_duplicidade
), mesc as (
  select empresa, secundario, principal from platform.estoque_duplicidade_decisao where ativo and decisao = 'mesclado'
), cad as (
  select c.*, coalesce(c.n_cod_prod, -c.id) as id_item from platform.estoque_item_cadastro c
), cod as (
  select empresa, n_cod_prod,
         max(codigo) filter (where atual) as codigo_novo,
         array_remove(array_agg(codigo) filter (where not atual), null) as codigos_antigos
  from platform.estoque_item_codigo group by 1, 2
)
select pos.empresa, pos.n_cod_prod,
       coalesce(pos.codigo, cad.omie_codigo, cod.codigo_novo, pos.n_cod_prod::text) as codigo,
       coalesce(nullif(cad.descricao, ''), pos.descricao) as descricao,
       coalesce(nullif(cad.unidade, ''), sp.unidade) as unidade, coalesce(nullif(cad.ncm, ''), sp.ncm) as ncm,
       pos.saldo, pos.saldo_omie, pos.ajuste, pos.fisico, pos.reservado, pos.pendente, pos.cmc, pos.estoque_minimo, pos.data_posicao,
       pos.locais, jsonb_array_length(pos.locais) as n_locais, pos.local_negativo,
       coalesce(c90.q90, 0) as consumo_90d, um.ult as ult_mov, coalesce(um.n, 0) as n_mov,
       coalesce(pcs.pcs_velhos, 0) as pcs_velhos, coalesce(pcs.rec_a_mais, 0) as rec_a_mais, pcs.ult_pc,
       (dup.id is not null) as duplicidade,
       coalesce(pf.omie_codigo_familia, fam.codigo_familia) as codigo_familia,
       coalesce(pf.nome, fam.descricao_familia) as familia,
       mesc.principal as mesclado_em,
       (select max(x.codigo) from orders.estoque_posicao x where x.empresa = pos.empresa and x.n_cod_prod = mesc.principal) as mesclado_em_codigo,
       -- painel: família com prefixo, código novo, cadastro
       pf.id as familia_id, pf.prefixo as familia_prefixo, pf.material as familia_material,
       cod.codigo_novo, cod.codigos_antigos,
       coalesce(pos.codigo, cad.omie_codigo) as codigo_omie,
       cad.id as cadastro_id, cad.origem as cadastro_origem, cad.ean, cad.preco_ref, cad.local_padrao,
       cad.minimo as alarme_minimo, cad.ponto_pedido as alarme_ponto_pedido, cad.maximo as alarme_maximo,
       cad.foto_url, cad.obs as cadastro_obs, coalesce(cad.ativo, true) as ativo,
       cad.omie_status, cad.omie_erro
from pos
left join c90 on c90.empresa = pos.empresa and c90.id_prod = pos.n_cod_prod
left join um on um.empresa = pos.empresa and um.id_prod = pos.n_cod_prod
left join pcs on pcs.empresa = pos.empresa and pcs.ncod_prod = pos.n_cod_prod
left join (select distinct on (empresa, id_omie) empresa, id_omie, unidade, ncm from sales.produtos order by empresa, id_omie, synced_at desc) sp
  on sp.empresa = pos.empresa and sp.id_omie = pos.n_cod_prod
left join (select distinct empresa, id from dup) dup on dup.empresa = pos.empresa and dup.id = pos.n_cod_prod
left join orders.produto_familia fam on fam.empresa = pos.empresa and fam.id_omie = pos.n_cod_prod
left join mesc on mesc.empresa = pos.empresa and mesc.secundario = pos.n_cod_prod
left join platform.estoque_item_familia itf on itf.empresa = pos.empresa and itf.n_cod_prod = pos.n_cod_prod
left join lateral (select f.id from platform.estoque_familia f
                   where f.empresa = pos.empresa and f.omie_codigo_familia = fam.codigo_familia and f.ativo limit 1) fo on true
left join platform.estoque_familia pf on pf.id = coalesce(itf.familia_id, fo.id)
left join cad on cad.empresa = pos.empresa and cad.id_item = pos.n_cod_prod
left join cod on cod.empresa = pos.empresa and cod.n_cod_prod = pos.n_cod_prod;

revoke all on orders.v_estoque_item, orders.v_estoque_saldo_local from anon, authenticated;

-- ── Código: próximo número da família (trava a linha da família: dois cadastros ao mesmo tempo não repetem) ──
create or replace function orders.estoque_proximo_codigo(p_familia bigint) returns text
language plpgsql security definer set search_path = platform, public as $fn$
declare f platform.estoque_familia; c text;
begin
  select * into f from platform.estoque_familia where id = p_familia for update;
  if not found then raise exception 'Família inexistente'; end if;
  loop
    c := f.prefixo || lpad(f.proximo::text, 4, '0');
    f.proximo := f.proximo + 1;
    exit when not exists (select 1 from platform.estoque_item_codigo where empresa = f.empresa and codigo = c);
  end loop;
  update platform.estoque_familia set proximo = f.proximo where id = f.id;
  return c;
end
$fn$;

-- Família efetiva do item: atribuída no painel; senão a família do Omie mapeada; senão "Sem família".
create or replace function orders.estoque_familia_do_item(p_empresa text, p_prod bigint) returns bigint
language sql stable security definer set search_path = platform, orders, public as $$
  select coalesce(
    (select familia_id from platform.estoque_item_familia where empresa = p_empresa and n_cod_prod = p_prod),
    (select f.id from orders.produto_familia o join platform.estoque_familia f
       on f.empresa = o.empresa and f.omie_codigo_familia = o.codigo_familia and f.ativo
      where o.empresa = p_empresa and o.id_omie = p_prod limit 1),
    (select id from platform.estoque_familia where empresa = p_empresa and sistema limit 1))
$$;

-- Prévia da codificação em massa: itens sem código atual (fora os mesclados em outro), em ordem de
-- família e descrição, com o código que receberiam. Não grava nada.
create or replace function orders.estoque_revisao_familias_concluida(p_empresa text) returns boolean
language sql stable security definer set search_path = platform, public as $$
  select coalesce((select (valor->>'concluida')::boolean from platform.estoque_config where chave = 'revisao_familias_' || p_empresa), false)
$$;

create or replace function orders.estoque_codificar_previa(p_empresa text default 'SF') returns jsonb
language sql stable security definer set search_path = platform, orders, public as $$
  with it as (
    select v.empresa, v.n_cod_prod, v.codigo_omie, v.descricao, orders.estoque_familia_do_item(v.empresa, v.n_cod_prod) as familia_id
    from orders.v_estoque_item v
    where v.empresa = p_empresa and v.codigo_novo is null and v.mesclado_em is null
  ), num as (
    select it.*, f.nome as familia, f.prefixo, f.proximo,
           row_number() over (partition by it.familia_id order by upper(orders.fn_norm_desc(it.descricao)), it.n_cod_prod) - 1 as k
    from it join platform.estoque_familia f on f.id = it.familia_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('n_cod_prod', n_cod_prod, 'codigo_omie', codigo_omie, 'descricao', descricao,
           'familia_id', familia_id, 'familia', familia, 'codigo_novo', prefixo || lpad((proximo + k)::text, 4, '0'))
         order by familia, k), '[]'::jsonb)
  from num
$$;

-- Aplica a codificação em massa (admin). Mesma ordem da prévia; usa e avança a sequência de cada família.
create or replace function orders.estoque_codificar_aplicar(p_empresa text, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare r record; c text; n int := 0;
begin
  if not orders.estoque_revisao_familias_concluida(p_empresa) then
    raise exception 'Conclua a revisão de famílias antes de gerar os códigos novos';
  end if;
  perform pg_advisory_xact_lock(hashtext('estoque_codificar_' || p_empresa));
  for r in
    select v.n_cod_prod, v.descricao, orders.estoque_familia_do_item(v.empresa, v.n_cod_prod) as familia_id
    from orders.v_estoque_item v
    where v.empresa = p_empresa and v.codigo_novo is null and v.mesclado_em is null
    order by 3, upper(orders.fn_norm_desc(v.descricao)), v.n_cod_prod
  loop
    c := orders.estoque_proximo_codigo(r.familia_id);
    insert into platform.estoque_item_codigo (empresa, n_cod_prod, codigo, familia_id, motivo, created_by_email)
    values (p_empresa, r.n_cod_prod, c, r.familia_id, 'inicial', p_email);
    insert into platform.estoque_item_familia (empresa, n_cod_prod, familia_id, updated_by_email)
    values (p_empresa, r.n_cod_prod, r.familia_id, p_email) on conflict (empresa, n_cod_prod) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('codificados', n);
end
$fn$;

-- Recodificar (admin): novo código da família escolhida; o anterior vira apelido.
create or replace function orders.estoque_recodificar(p_empresa text, p_prod bigint, p_familia bigint, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare c text; ant text;
begin
  select codigo into ant from platform.estoque_item_codigo where empresa = p_empresa and n_cod_prod = p_prod and atual;
  c := orders.estoque_proximo_codigo(p_familia);
  update platform.estoque_item_codigo set atual = false where empresa = p_empresa and n_cod_prod = p_prod and atual;
  insert into platform.estoque_item_codigo (empresa, n_cod_prod, codigo, familia_id, motivo, created_by_email)
  values (p_empresa, p_prod, c, p_familia, 'recodificado', p_email);
  insert into platform.estoque_item_familia (empresa, n_cod_prod, familia_id, updated_by_email)
  values (p_empresa, p_prod, p_familia, p_email)
  on conflict (empresa, n_cod_prod) do update set familia_id = excluded.familia_id, updated_by_email = excluded.updated_by_email, updated_at = now();
  return jsonb_build_object('codigo', c, 'anterior', ant);
end
$fn$;

-- Cadastro de item (criar no painel ou editar item existente). p: campos do formulário.
-- Criar: gera o código (sequência da família ou o código informado pelo admin). Editar: família
-- muda sem trocar o código (recodificar é outra ação).
create or replace function orders.estoque_cadastrar(p jsonb, p_admin boolean, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare c platform.estoque_item_cadastro; v_id bigint; v_prod bigint; v_fam bigint; v_cod text; v_emp text := coalesce(p->>'empresa', 'SF');
        v_ncm text := regexp_replace(coalesce(p->>'ncm', ''), '\D', '', 'g'); novo boolean := (p->>'cadastro_id') is null and (p->>'n_cod_prod') is null;
begin
  if coalesce(trim(p->>'descricao'), '') = '' then raise exception 'Informe a descrição'; end if;
  if v_ncm <> '' and length(v_ncm) <> 8 then raise exception 'NCM precisa ter 8 dígitos'; end if;
  if coalesce(p->>'ean', '') <> '' and regexp_replace(p->>'ean', '\D', '', 'g') !~ '^(\d{8}|\d{12,14})$' then raise exception 'EAN inválido (8, 12, 13 ou 14 dígitos)'; end if;
  v_fam := nullif(p->>'familia_id', '')::bigint;
  if v_fam is not null and not exists (select 1 from platform.estoque_familia where id = v_fam and empresa = v_emp and ativo) then
    raise exception 'Família inválida ou inativa';
  end if;
  if (p->>'minimo') is not null and (p->>'ponto_pedido') is not null and (p->>'ponto_pedido')::numeric < (p->>'minimo')::numeric then
    raise exception 'Ponto de pedido não pode ser menor que o mínimo';
  end if;
  if (p->>'maximo') is not null and (p->>'ponto_pedido') is not null and (p->>'maximo')::numeric < (p->>'ponto_pedido')::numeric then
    raise exception 'Máximo não pode ser menor que o ponto de pedido';
  end if;

  if novo then
    insert into platform.estoque_item_cadastro (empresa, origem, created_by_email, updated_by_email) values (v_emp, 'painel', p_email, p_email) returning id into v_id;
    v_prod := -v_id;
  elsif (p->>'cadastro_id') is not null then
    v_id := (p->>'cadastro_id')::bigint;
    select coalesce(n_cod_prod, -id) into v_prod from platform.estoque_item_cadastro where id = v_id;
    if not found then raise exception 'Cadastro não encontrado'; end if;
  else
    v_prod := (p->>'n_cod_prod')::bigint;
    insert into platform.estoque_item_cadastro (empresa, n_cod_prod, origem, created_by_email, updated_by_email)
    values (v_emp, v_prod, 'omie', p_email, p_email)
    on conflict (empresa, n_cod_prod) where n_cod_prod is not null do update set updated_at = now() returning id into v_id;
  end if;

  update platform.estoque_item_cadastro set
    descricao = trim(p->>'descricao'), unidade = nullif(upper(trim(coalesce(p->>'unidade', ''))), ''),
    ncm = nullif(v_ncm, ''), ean = nullif(regexp_replace(coalesce(p->>'ean', ''), '\D', '', 'g'), ''),
    preco_ref = nullif(p->>'preco_ref', '')::numeric, local_padrao = nullif(p->>'local_padrao', '')::bigint,
    minimo = nullif(p->>'minimo', '')::numeric, ponto_pedido = nullif(p->>'ponto_pedido', '')::numeric, maximo = nullif(p->>'maximo', '')::numeric,
    foto_url = nullif(trim(coalesce(p->>'foto_url', '')), ''), obs = nullif(trim(coalesce(p->>'obs', '')), ''),
    ativo = coalesce((p->>'ativo')::boolean, true), updated_by_email = p_email, updated_at = now()
  where id = v_id returning * into c;

  if v_fam is not null then
    insert into platform.estoque_item_familia (empresa, n_cod_prod, familia_id, updated_by_email) values (v_emp, v_prod, v_fam, p_email)
    on conflict (empresa, n_cod_prod) do update set familia_id = excluded.familia_id, updated_by_email = excluded.updated_by_email, updated_at = now();
  end if;

  if not exists (select 1 from platform.estoque_item_codigo where empresa = v_emp and n_cod_prod = v_prod and atual) then
    v_fam := coalesce(v_fam, orders.estoque_familia_do_item(v_emp, v_prod));
    if p_admin and coalesce(trim(p->>'codigo'), '') <> '' then
      v_cod := upper(trim(p->>'codigo'));
      if exists (select 1 from platform.estoque_item_codigo where empresa = v_emp and codigo = v_cod) then raise exception 'Código % já existe', v_cod; end if;
    else
      v_cod := orders.estoque_proximo_codigo(v_fam);
    end if;
    insert into platform.estoque_item_codigo (empresa, n_cod_prod, codigo, familia_id, motivo, created_by_email)
    values (v_emp, v_prod, v_cod, v_fam, case when novo then 'cadastro' else 'inicial' end, p_email);
  end if;
  return jsonb_build_object('cadastro', to_jsonb(c), 'n_cod_prod', v_prod,
    'codigo', (select codigo from platform.estoque_item_codigo where empresa = v_emp and n_cod_prod = v_prod and atual));
end
$fn$;

-- Omie devolveu o id do produto criado: troca o id provisório (negativo) pelo do Omie.
create or replace function orders.estoque_cadastro_omie_ok(p_cadastro bigint, p_prod bigint, p_codigo text, p_resposta jsonb) returns void
language plpgsql security definer set search_path = platform, public as $fn$
declare v_emp text; v_old bigint;
begin
  select empresa, coalesce(n_cod_prod, -id) into v_emp, v_old from platform.estoque_item_cadastro where id = p_cadastro;
  update platform.estoque_item_cadastro set n_cod_prod = p_prod, omie_codigo = p_codigo, omie_status = 'ok', omie_erro = null,
    omie_enviado_em = now(), omie_resposta = p_resposta where id = p_cadastro;
  if v_old <> p_prod then
    update platform.estoque_item_codigo set n_cod_prod = p_prod where empresa = v_emp and n_cod_prod = v_old;
    update platform.estoque_item_familia set n_cod_prod = p_prod where empresa = v_emp and n_cod_prod = v_old;
    update platform.estoque_ajuste set n_cod_prod = p_prod where empresa = v_emp and n_cod_prod = v_old;
  end if;
end
$fn$;

create or replace function orders.estoque_cadastro_omie_status(p_cadastro bigint, p_status text, p_erro text, p_resposta jsonb) returns void
language sql security definer set search_path = platform, public as $$
  update platform.estoque_item_cadastro set omie_status = p_status, omie_erro = p_erro, omie_resposta = p_resposta,
    omie_enviado_em = case when p_status = 'ok' then now() else omie_enviado_em end where id = p_cadastro
$$;

-- Parecidos (aviso de duplicidade antes de salvar): mesma lógica de nome normalizado + trigramas.
create or replace function orders.estoque_parecidos(p_empresa text, p_descricao text, p_excluir bigint default null) returns jsonb
language sql stable security definer set search_path = orders, public as $$
  select coalesce(jsonb_agg(x order by x->>'sim' desc), '[]'::jsonb) from (
    select jsonb_build_object('n_cod_prod', v.n_cod_prod, 'codigo', v.codigo, 'codigo_novo', v.codigo_novo, 'descricao', v.descricao,
             'saldo', v.saldo, 'sim', round(similarity(lower(orders.fn_norm_desc(v.descricao)), lower(orders.fn_norm_desc(p_descricao)))::numeric, 2),
             'igual', orders.fn_chave_desc(v.descricao) = orders.fn_chave_desc(p_descricao)) as x
    from orders.v_estoque_item v
    where v.empresa = p_empresa and (p_excluir is null or v.n_cod_prod <> p_excluir) and v.mesclado_em is null
      and (orders.fn_chave_desc(v.descricao) = orders.fn_chave_desc(p_descricao)
           or similarity(lower(orders.fn_norm_desc(v.descricao)), lower(orders.fn_norm_desc(p_descricao))) >= 0.6)
    order by similarity(lower(orders.fn_norm_desc(v.descricao)), lower(orders.fn_norm_desc(p_descricao))) desc limit 6
  ) t
$$;

-- ── Famílias: mesclar (move os itens) ───────────────────────────────────────
create or replace function orders.estoque_familia_mesclar(p_de bigint, p_para bigint, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare d platform.estoque_familia; para platform.estoque_familia; n int;
begin
  if p_de = p_para then raise exception 'Escolha duas famílias diferentes'; end if;
  select * into d from platform.estoque_familia where id = p_de for update;
  select * into para from platform.estoque_familia where id = p_para;
  if d.id is null or para.id is null then raise exception 'Família inexistente'; end if;
  if d.sistema then raise exception '"%" é de sistema e não pode ser mesclada', d.nome; end if;
  if not para.ativo then raise exception 'A família de destino está inativa'; end if;
  -- itens cuja família efetiva é a origem (atribuição explícita ou mapeamento do Omie) ganham atribuição explícita no destino
  insert into platform.estoque_item_familia (empresa, n_cod_prod, familia_id, updated_by_email)
  select v.empresa, v.n_cod_prod, p_para, p_email from orders.v_estoque_item v where v.familia_id = p_de
  on conflict (empresa, n_cod_prod) do update set familia_id = excluded.familia_id, updated_by_email = excluded.updated_by_email, updated_at = now();
  get diagnostics n = row_count;
  update platform.estoque_familia set ativo = false, mesclada_em = p_para, updated_by_email = p_email, updated_at = now() where id = p_de;
  update platform.estoque_familia_sugestao set familia_sugerida_id = p_para where familia_sugerida_id = p_de;
  update platform.estoque_familia_sugestao set familia_escolhida_id = p_para where familia_escolhida_id = p_de;
  return jsonb_build_object('itens_movidos', n);
end
$fn$;

-- Atribuir família a itens (decisão da revisão ou mudança manual). Não troca o código já gerado.
create or replace function orders.estoque_atribuir_familia(p_empresa text, p_itens bigint[], p_familia bigint, p_email text) returns integer
language plpgsql security definer set search_path = platform, public as $fn$
declare n int;
begin
  if not exists (select 1 from platform.estoque_familia where id = p_familia and empresa = p_empresa and ativo) then raise exception 'Família inválida ou inativa'; end if;
  insert into platform.estoque_item_familia (empresa, n_cod_prod, familia_id, updated_by_email)
  select p_empresa, unnest(p_itens), p_familia, p_email
  on conflict (empresa, n_cod_prod) do update set familia_id = excluded.familia_id, updated_by_email = excluded.updated_by_email, updated_at = now();
  get diagnostics n = row_count;
  return n;
end
$fn$;

-- ── Sugestão automática de família ──────────────────────────────────────────
-- Candidatos: itens em "Sem família" ou numa família que não é tipo de material. Referência: itens em
-- famílias de material ativas. Três sinais, cada um com sua confiança:
--   palavra — 1ª palavra da descrição: se ≥ 60% dos itens de referência com essa palavra estão na
--             mesma família (mín. 4 itens) → fatia × 0,95
--   vizinho — item de referência mais parecido (trigramas ≥ 0,45) → similaridade
--   NCM     — capítulo de 4 dígitos: se ≥ 60% dos itens de referência com esse NCM4 estão numa
--             família (mín. 4) → fatia × 0,85
-- Vence a família com maior confiança; cada outro sinal que concorda soma 0,08 (teto 0,99).
-- Recalcula só as pendentes; decisões já tomadas ficam.
create or replace function orders.estoque_sugerir_familias(p_empresa text) returns jsonb
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare v_n int;
begin
  create temp table _it on commit drop as
    select v.n_cod_prod, v.descricao, v.familia_id,
           coalesce(f.material and not f.sistema and f.ativo, false) as ref,
           lower(orders.fn_norm_desc(v.descricao)) as norm, split_part(orders.fn_norm_desc(v.descricao), ' ', 1) as w1,
           left(regexp_replace(coalesce(v.ncm, ''), '\D', '', 'g'), 4) as ncm4
    from orders.v_estoque_item v left join platform.estoque_familia f on f.id = v.familia_id
    where v.empresa = p_empresa and v.mesclado_em is null;
  create temp table _ref on commit drop as select * from _it where ref;
  create index on _ref using gist (norm gist_trgm_ops);
  analyze _ref;
  -- candidatos: sem família / família que não é material, MAIS os "fora do lugar": item numa família de
  -- material cuja 1ª palavra aponta com ≥ 70% (mín. 5 itens) para outra família (ex.: membrana em HIDRAULICA)
  create temp table _cand on commit drop as
    select * from _it where not ref
    union
    select i.* from _it i
    join (select x.w1, x.familia_id, x.qtd::numeric / sum(x.qtd) over (partition by x.w1) as fatia, sum(x.qtd) over (partition by x.w1) as tot
          from (select r.w1, r.familia_id, count(*) as qtd from _ref r where length(r.w1) >= 3 group by 1, 2) x) w
      on w.w1 = i.w1 and w.fatia >= 0.7 and w.tot >= 5 and w.familia_id <> i.familia_id
    where i.ref;
  delete from _cand c where exists (select 1 from platform.estoque_familia_sugestao s
                    where s.empresa = p_empresa and s.n_cod_prod = c.n_cod_prod and s.status <> 'pendente');

  create temp table _sig (n_cod_prod bigint, familia_id bigint, conf numeric, motivo text) on commit drop;
  insert into _sig
  select c.n_cod_prod, w.familia_id, round(w.fatia * 0.95, 2),
         format('palavra "%s" → %s (%s%% de %s itens)', c.w1, f.nome, round(w.fatia * 100), w.tot)
  from _cand c
  join (select x.w1, x.familia_id, x.qtd::numeric / sum(x.qtd) over (partition by x.w1) as fatia, sum(x.qtd) over (partition by x.w1) as tot
        from (select r.w1, r.familia_id, count(*) as qtd from _ref r where length(r.w1) >= 3 group by 1, 2) x) w on w.w1 = c.w1
  join platform.estoque_familia f on f.id = w.familia_id
  where w.fatia >= 0.6 and w.tot >= 4;
  insert into _sig
  select c.n_cod_prod, w.familia_id, round(w.fatia * 0.85, 2),
         format('NCM %s → %s (%s%% de %s itens)', c.ncm4, f.nome, round(w.fatia * 100), w.tot)
  from _cand c
  join (select x.ncm4, x.familia_id, x.qtd::numeric / sum(x.qtd) over (partition by x.ncm4) as fatia, sum(x.qtd) over (partition by x.ncm4) as tot
        from (select r.ncm4, r.familia_id, count(*) as qtd from _ref r where length(r.ncm4) = 4 group by 1, 2) x) w on w.ncm4 = c.ncm4
  join platform.estoque_familia f on f.id = w.familia_id
  where w.fatia >= 0.6 and w.tot >= 4;
  perform set_config('pg_trgm.similarity_threshold', '0.45', true);
  insert into _sig
  select distinct on (c.n_cod_prod) c.n_cod_prod, r.familia_id, round(similarity(c.norm, r.norm)::numeric, 2),
         format('parecido com %s (%s%%) → %s', left(r.descricao, 60), round(similarity(c.norm, r.norm) * 100), f.nome)
  from _cand c join _ref r on r.norm % c.norm
  join platform.estoque_familia f on f.id = r.familia_id
  order by c.n_cod_prod, similarity(c.norm, r.norm) desc;

  delete from _sig g using _cand c where g.n_cod_prod = c.n_cod_prod and g.familia_id = c.familia_id;
  -- "fora do lugar" só vira candidato se houver de facto outra família para sugerir
  delete from _cand c where c.ref and not exists (select 1 from _sig g where g.n_cod_prod = c.n_cod_prod);
  delete from platform.estoque_familia_sugestao s where s.empresa = p_empresa and s.status = 'pendente';
  insert into platform.estoque_familia_sugestao (empresa, n_cod_prod, familia_atual_id, familia_sugerida_id, confianca, motivo)
  -- item já numa família de material: nunca "alta" (não entra no aceitar-em-lote das altas)
  select p_empresa, c.n_cod_prod, c.familia_id, b.familia_id,
         case when c.ref then least(coalesce(b.conf, 0), 0.79) else coalesce(b.conf, 0) end,
         case when c.ref then 'fora do lugar? ' || b.motivo else b.motivo end
  from _cand c
  left join lateral (
    select s.familia_id, least(0.99, max(s.conf) + 0.08 * (count(*) - 1)) as conf,
           string_agg(s.motivo, ' · ' order by s.conf desc) as motivo
    from _sig s where s.n_cod_prod = c.n_cod_prod group by s.familia_id
    order by least(0.99, max(s.conf) + 0.08 * (count(*) - 1)) desc limit 1
  ) b on true
  on conflict (empresa, n_cod_prod) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('candidatos', v_n,
    'alta', (select count(*) from platform.estoque_familia_sugestao where empresa = p_empresa and status = 'pendente' and confianca >= 0.8),
    'media', (select count(*) from platform.estoque_familia_sugestao where empresa = p_empresa and status = 'pendente' and confianca >= 0.6 and confianca < 0.8),
    'baixa', (select count(*) from platform.estoque_familia_sugestao where empresa = p_empresa and status = 'pendente' and confianca > 0 and confianca < 0.6),
    'sem_sugestao', (select count(*) from platform.estoque_familia_sugestao where empresa = p_empresa and status = 'pendente' and familia_sugerida_id is null));
end
$fn$;

-- Decidir sugestões em lote: aceita (usa a sugerida), alterada (usa p_familia), rejeitada (fica onde está),
-- pendente (volta atrás — desfaz a atribuição feita pela revisão).
create or replace function orders.estoque_decidir_sugestoes(p_empresa text, p_itens bigint[], p_acao text, p_familia bigint, p_email text) returns integer
language plpgsql security definer set search_path = platform, orders, public as $fn$
declare n int := 0; r record;
begin
  if p_acao not in ('aceita', 'alterada', 'rejeitada', 'pendente') then raise exception 'Ação inválida'; end if;
  if p_acao = 'alterada' and not exists (select 1 from platform.estoque_familia where id = p_familia and ativo) then raise exception 'Escolha uma família ativa'; end if;
  for r in select * from platform.estoque_familia_sugestao where empresa = p_empresa and n_cod_prod = any (p_itens) for update loop
    if p_acao = 'aceita' and r.familia_sugerida_id is null then continue; end if;
    update platform.estoque_familia_sugestao set status = p_acao,
      familia_escolhida_id = case p_acao when 'aceita' then r.familia_sugerida_id when 'alterada' then p_familia else null end,
      decidido_por_email = case when p_acao = 'pendente' then null else p_email end, decidido_em = case when p_acao = 'pendente' then null else now() end
    where empresa = p_empresa and n_cod_prod = r.n_cod_prod;
    if p_acao in ('aceita', 'alterada') then
      perform orders.estoque_atribuir_familia(p_empresa, array[r.n_cod_prod], case p_acao when 'aceita' then r.familia_sugerida_id else p_familia end, p_email);
    elsif r.status in ('aceita', 'alterada') then
      if r.familia_atual_id is null then delete from platform.estoque_item_familia where empresa = p_empresa and n_cod_prod = r.n_cod_prod;
      else perform orders.estoque_atribuir_familia(p_empresa, array[r.n_cod_prod], r.familia_atual_id, p_email); end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end
$fn$;

create or replace function orders.estoque_revisao_familias_marcar(p_empresa text, p_concluida boolean, p_email text) returns jsonb
language sql security definer set search_path = platform, public as $$
  insert into platform.estoque_config (chave, valor, updated_by_email) values ('revisao_familias_' || p_empresa,
    jsonb_build_object('concluida', p_concluida, 'em', now(), 'por', p_email), p_email)
  on conflict (chave) do update set valor = excluded.valor, updated_by_email = excluded.updated_by_email, updated_at = now()
  returning valor
$$;

revoke all on function orders.estoque_prefixo_sugerido(text, text), orders.estoque_familias_importar_omie(text, text),
  orders.estoque_revisao_familias_concluida(text), orders.estoque_familia_mesclar(bigint, bigint, text),
  orders.estoque_atribuir_familia(text, bigint[], bigint, text), orders.estoque_sugerir_familias(text),
  orders.estoque_decidir_sugestoes(text, bigint[], text, bigint, text), orders.estoque_revisao_familias_marcar(text, boolean, text)
  from public, anon, authenticated;
grant execute on function orders.estoque_prefixo_sugerido(text, text), orders.estoque_familias_importar_omie(text, text),
  orders.estoque_revisao_familias_concluida(text), orders.estoque_familia_mesclar(bigint, bigint, text),
  orders.estoque_atribuir_familia(text, bigint[], bigint, text), orders.estoque_sugerir_familias(text),
  orders.estoque_decidir_sugestoes(text, bigint[], text, bigint, text), orders.estoque_revisao_familias_marcar(text, boolean, text)
  to service_role;
grant usage, select on sequence platform.estoque_familia_id_seq to service_role;

revoke all on function orders.estoque_proximo_codigo(bigint), orders.estoque_familia_do_item(text, bigint),
  orders.estoque_codificar_previa(text), orders.estoque_codificar_aplicar(text, text), orders.estoque_recodificar(text, bigint, bigint, text),
  orders.estoque_cadastrar(jsonb, boolean, text), orders.estoque_cadastro_omie_ok(bigint, bigint, text, jsonb),
  orders.estoque_cadastro_omie_status(bigint, text, text, jsonb), orders.estoque_parecidos(text, text, bigint)
  from public, anon, authenticated;
grant execute on function orders.estoque_proximo_codigo(bigint), orders.estoque_familia_do_item(text, bigint),
  orders.estoque_codificar_previa(text), orders.estoque_codificar_aplicar(text, text), orders.estoque_recodificar(text, bigint, bigint, text),
  orders.estoque_cadastrar(jsonb, boolean, text), orders.estoque_cadastro_omie_ok(bigint, bigint, text, jsonb),
  orders.estoque_cadastro_omie_status(bigint, text, text, jsonb), orders.estoque_parecidos(text, text, bigint)
  to service_role;
