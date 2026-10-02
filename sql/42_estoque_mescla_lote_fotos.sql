-- Estoque v2 (02/10/26)
--  1) "Mesclar todos": mesclagem por GRUPO (2+ códigos sob um principal) e em LOTE.
--     Cada grupo é uma mesclagem própria (desfaz sozinho, ou troca o principal); o lote junta os grupos
--     de um clique "Mesclar todos" e também desfaz inteiro. Tudo só no painel — nada vai ao Omie.
--     Saldo: os mesmos ajustes 'mesclagem' de antes (secundário zera, principal recebe), por decisão.
--     Movimentos, PCs e uso dos mesclados respondem no principal (v_estoque_mescla_dono, transitivo).
--  2) Fotos dos itens: bucket privado "produtos", foto atual, busca (candidatos) e o estado do job.

-- ── 1. Mesclagem em grupo / lote ─────────────────────────────────────────────
create table if not exists platform.estoque_mescla_lote (
  id bigserial primary key,
  empresa text not null,
  escopo text not null check (escopo in ('exatas', 'todos')),
  n_grupos int not null default 0, n_erros int not null default 0,
  ativo boolean not null default true,
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  desfeito_por uuid, desfeito_por_email text, desfeito_em timestamptz
);
create table if not exists platform.estoque_mescla_grupo (
  id bigserial primary key,
  empresa text not null,
  lote_id bigint references platform.estoque_mescla_lote (id),
  principal bigint not null,
  membros bigint[] not null,               -- inclui o principal
  tipo text not null default 'exata' check (tipo in ('exata', 'parecido')),
  ativo boolean not null default true,
  substituido_por bigint references platform.estoque_mescla_grupo (id),  -- "trocar principal" gera um grupo novo
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  desfeito_por uuid, desfeito_por_email text, desfeito_em timestamptz
);
create index if not exists estoque_mescla_grupo_lote on platform.estoque_mescla_grupo (lote_id);
alter table platform.estoque_duplicidade_decisao add column if not exists grupo_id bigint references platform.estoque_mescla_grupo (id);
create index if not exists estoque_dup_decisao_grupo on platform.estoque_duplicidade_decisao (grupo_id) where grupo_id is not null;
alter table platform.estoque_mescla_lote enable row level security;
alter table platform.estoque_mescla_grupo enable row level security;
grant usage, select on sequence platform.estoque_mescla_lote_id_seq, platform.estoque_mescla_grupo_id_seq to service_role;

-- Dono de cada código mesclado, seguindo cadeias (A→B e depois B→C: o dono de A é C).
create or replace view orders.v_estoque_mescla_dono as
with recursive m as (
  select empresa, secundario, principal from platform.estoque_duplicidade_decisao where ativo and decisao = 'mesclado'
), r (empresa, secundario, dono, prof) as (
  select empresa, secundario, principal, 1 from m
  union all
  select r.empresa, r.secundario, m.principal, r.prof + 1
  from r join m on m.empresa = r.empresa and m.secundario = r.dono
  where r.prof < 20
)
select distinct on (empresa, secundario) empresa, secundario, dono
from r order by empresa, secundario, prof desc;
revoke all on orders.v_estoque_mescla_dono from anon, authenticated;

-- Movimentos nos últimos 12 meses (regra do principal sugerido).
create or replace function orders.estoque_mov12(p_empresa text, p_ids bigint[])
returns table (id_prod bigint, n bigint)
language sql stable security definer set search_path = orders, public as $$
  select m.id_prod, count(*) from orders.estoque_movimentos m
  where m.empresa = p_empresa and m.id_prod = any (p_ids) and coalesce(m.cancelamento, 'N') <> 'S'
    and m.dt_mov >= current_date - 365
  group by 1
$$;

-- Transfere o saldo (por local) do secundário ao principal: dois ajustes 'mesclagem' ligados à decisão.
create or replace function orders.estoque_mescla_transferir(p_dec bigint) returns int
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare d platform.estoque_duplicidade_decisao; l record; c_p numeric; n int := 0;
begin
  select * into d from platform.estoque_duplicidade_decisao where id = p_dec;
  for l in select v.codigo_local_estoque, v.saldo,
                  coalesce(nullif(v.cmc, 0), (select max(x.cmc) from orders.estoque_posicao x where x.empresa = d.empresa and x.n_cod_prod = d.secundario)) as cmc
           from orders.v_estoque_saldo_local v
           where v.empresa = d.empresa and v.n_cod_prod = d.secundario and v.saldo <> 0 loop
    select coalesce((select saldo from orders.v_estoque_saldo_local where empresa = d.empresa and n_cod_prod = d.principal
                     and codigo_local_estoque = l.codigo_local_estoque), 0) into c_p;
    insert into platform.estoque_ajuste (empresa, n_cod_prod, codigo_local_estoque, tipo, mescla_id, saldo_antes, contagem, diferenca,
      cmc, valor, motivo, revisao, created_by, created_by_email)
    values (d.empresa, d.secundario, l.codigo_local_estoque, 'mesclagem', d.id, l.saldo, 0, -l.saldo, coalesce(l.cmc, 0),
      round(-l.saldo * coalesce(l.cmc, 0), 2), 'Mesclagem: saldo transferido ao código principal', 'conferido', d.created_by, d.created_by_email),
           (d.empresa, d.principal, l.codigo_local_estoque, 'mesclagem', d.id, c_p, c_p + l.saldo, l.saldo, coalesce(l.cmc, 0),
      round(l.saldo * coalesce(l.cmc, 0), 2), 'Mesclagem: saldo recebido do código duplicado', 'conferido', d.created_by, d.created_by_email);
    n := n + 1;
  end loop;
  return n;
end
$fn$;

-- Um grupo: todos os membros ficam sob o principal. Membros precisam estar ligados entre si na lista de
-- duplicidades (nome igual ou parecido), nenhum pode já estar mesclado, e par marcado "não é" bloqueia.
create or replace function orders.estoque_mesclar_grupo(
  p_empresa text, p_principal bigint, p_membros bigint[], p_tipo text, p_lote bigint, p_user uuid, p_email text
) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare g platform.estoque_mescla_grupo; v_m bigint[]; v_s bigint; d platform.estoque_duplicidade_decisao; v_loc int := 0;
        v_sozinho bigint; v_ja text;
begin
  v_m := array(select distinct x from unnest(p_membros || p_principal) x where x is not null order by 1);
  if array_length(v_m, 1) < 2 then raise exception 'Um grupo precisa de pelo menos dois códigos'; end if;
  select string_agg(coalesce(i.codigo, x::text), ', ') into v_ja
    from unnest(v_m) x left join lateral (select max(p.codigo) as codigo from orders.estoque_posicao p where p.empresa = p_empresa and p.n_cod_prod = x) i on true
   where exists (select 1 from platform.estoque_duplicidade_decisao z where z.ativo and z.decisao = 'mesclado' and z.empresa = p_empresa and z.secundario = x);
  if v_ja is not null then raise exception 'Já mesclado(s) em outro código: %', v_ja; end if;
  -- cada membro tem de ter par (não recusado) com outro membro
  select x into v_sozinho from unnest(v_m) x
   where not exists (select 1 from orders.estoque_duplicidade e
                     where e.empresa = p_empresa and (e.prod_a = x or e.prod_b = x)
                       and e.prod_a = any (v_m) and e.prod_b = any (v_m)
                       and not exists (select 1 from platform.estoque_duplicidade_decisao n where n.ativo and n.decisao = 'nao_e'
                                       and n.empresa = e.empresa and n.prod_a = e.prod_a and n.prod_b = e.prod_b))
   limit 1;
  if v_sozinho is not null then raise exception 'O código % não está na lista de duplicidades com os outros do grupo', v_sozinho; end if;

  insert into platform.estoque_mescla_grupo (empresa, lote_id, principal, membros, tipo, created_by, created_by_email)
  values (p_empresa, p_lote, p_principal, v_m, coalesce(p_tipo, 'exata'), p_user, p_email) returning * into g;
  foreach v_s in array v_m loop
    continue when v_s = p_principal;
    begin
      insert into platform.estoque_duplicidade_decisao (empresa, prod_a, prod_b, decisao, principal, secundario, grupo_id, created_by, created_by_email)
      values (p_empresa, least(p_principal, v_s), greatest(p_principal, v_s), 'mesclado', p_principal, v_s, g.id, p_user, p_email) returning * into d;
    exception when unique_violation then
      raise exception 'O par %×% já tem uma decisão (por exemplo "não é duplicidade") — desfaça antes', p_principal, v_s;
    end;
    v_loc := v_loc + orders.estoque_mescla_transferir(d.id);
  end loop;
  return jsonb_build_object('grupo', to_jsonb(g), 'locais_transferidos', v_loc);
end
$fn$;

-- Lote ("Mesclar todos"): cada grupo numa sub-transação — um que falhe não derruba os outros.
create or replace function orders.estoque_mesclar_lote(p_empresa text, p_escopo text, p_grupos jsonb, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare l platform.estoque_mescla_lote; x jsonb; ok int := 0; erros jsonb := '[]';
begin
  if jsonb_typeof(p_grupos) <> 'array' or jsonb_array_length(p_grupos) = 0 then raise exception 'Nenhum grupo para mesclar'; end if;
  insert into platform.estoque_mescla_lote (empresa, escopo, created_by, created_by_email)
  values (p_empresa, p_escopo, p_user, p_email) returning * into l;
  for x in select * from jsonb_array_elements(p_grupos) loop
    begin
      perform orders.estoque_mesclar_grupo(p_empresa, (x->>'principal')::bigint,
        array(select jsonb_array_elements_text(x->'membros')::bigint), x->>'tipo', l.id, p_user, p_email);
      ok := ok + 1;
    exception when others then
      erros := erros || jsonb_build_object('principal', x->>'principal', 'erro', sqlerrm);
    end;
  end loop;
  if ok = 0 then raise exception 'Nenhum grupo mesclado: %', erros->0->>'erro'; end if;
  update platform.estoque_mescla_lote set n_grupos = ok, n_erros = jsonb_array_length(erros) where id = l.id;
  return jsonb_build_object('lote_id', l.id, 'grupos', ok, 'erros', erros);
end
$fn$;

-- Desfazer uma decisão que pertence a um grupo só pelo grupo (senão o grupo ficaria pela metade).
create or replace function orders.estoque_desfazer_decisao(p_id bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare d platform.estoque_duplicidade_decisao; n int;
begin
  select * into d from platform.estoque_duplicidade_decisao where id = p_id and ativo;
  if not found then raise exception 'Decisão não encontrada ou já desfeita'; end if;
  if d.grupo_id is not null and coalesce(current_setting('estoque.desfazendo_grupo', true), '') <> d.grupo_id::text then
    raise exception 'Esta mesclagem faz parte de um grupo — desfaça o grupo';
  end if;
  update platform.estoque_duplicidade_decisao set ativo = false, desfeito_por = p_user, desfeito_por_email = p_email, desfeito_em = now()
   where id = p_id;
  update platform.estoque_ajuste set status = 'revertido', revertido_por = p_user, revertido_por_email = p_email, revertido_em = now()
   where mescla_id = p_id and status = 'aplicado';
  get diagnostics n = row_count;
  return jsonb_build_object('decisao', to_jsonb(d), 'ajustes_revertidos', n);
end
$fn$;

create or replace function orders.estoque_desfazer_grupo(p_grupo bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare g platform.estoque_mescla_grupo; d record; n int := 0; v_dono text;
begin
  select * into g from platform.estoque_mescla_grupo where id = p_grupo and ativo for update;
  if not found then raise exception 'Grupo não encontrado ou já desfeito'; end if;
  -- se o principal foi mesclado depois noutro código, desfazer este primeiro deixaria saldo negativo
  select coalesce(i.codigo, z.principal::text) into v_dono from platform.estoque_duplicidade_decisao z
    left join lateral (select max(p.codigo) as codigo from orders.estoque_posicao p where p.empresa = z.empresa and p.n_cod_prod = z.principal) i on true
   where z.ativo and z.decisao = 'mesclado' and z.empresa = g.empresa and z.secundario = g.principal limit 1;
  if v_dono is not null then raise exception 'O principal deste grupo foi mesclado depois em % — desfaça aquele primeiro', v_dono; end if;
  perform set_config('estoque.desfazendo_grupo', g.id::text, true);
  for d in select id from platform.estoque_duplicidade_decisao where grupo_id = g.id and ativo loop
    perform orders.estoque_desfazer_decisao(d.id, p_user, p_email);
    n := n + 1;
  end loop;
  perform set_config('estoque.desfazendo_grupo', '', true);
  update platform.estoque_mescla_grupo set ativo = false, desfeito_por = p_user, desfeito_por_email = p_email, desfeito_em = now() where id = g.id;
  return jsonb_build_object('grupo', g.id, 'decisoes_desfeitas', n);
end
$fn$;

-- Trocar o principal: desfaz o grupo e mescla de novo os mesmos códigos sob outro (no mesmo lote).
create or replace function orders.estoque_trocar_principal(p_grupo bigint, p_principal bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare g platform.estoque_mescla_grupo; r jsonb;
begin
  select * into g from platform.estoque_mescla_grupo where id = p_grupo and ativo;
  if not found then raise exception 'Grupo não encontrado ou já desfeito'; end if;
  if not (p_principal = any (g.membros)) then raise exception 'O novo principal precisa ser um dos códigos do grupo'; end if;
  if p_principal = g.principal then raise exception 'Este já é o principal'; end if;
  perform orders.estoque_desfazer_grupo(g.id, p_user, p_email);
  r := orders.estoque_mesclar_grupo(g.empresa, p_principal, g.membros, g.tipo, g.lote_id, p_user, p_email);
  update platform.estoque_mescla_grupo set substituido_por = (r->'grupo'->>'id')::bigint where id = g.id;
  return r;
end
$fn$;

create or replace function orders.estoque_desfazer_lote(p_lote bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare g record; ok int := 0; erros jsonb := '[]';
begin
  if not exists (select 1 from platform.estoque_mescla_lote where id = p_lote and ativo) then raise exception 'Lote não encontrado ou já desfeito'; end if;
  for g in select id, principal from platform.estoque_mescla_grupo where lote_id = p_lote and ativo order by id desc loop
    begin
      perform orders.estoque_desfazer_grupo(g.id, p_user, p_email);
      ok := ok + 1;
    exception when others then
      erros := erros || jsonb_build_object('grupo', g.id, 'erro', sqlerrm);
    end;
  end loop;
  if jsonb_array_length(erros) = 0 then
    update platform.estoque_mescla_lote set ativo = false, desfeito_por = p_user, desfeito_por_email = p_email, desfeito_em = now() where id = p_lote;
  end if;
  return jsonb_build_object('grupos_desfeitos', ok, 'erros', erros);
end
$fn$;

revoke all on function orders.estoque_mov12(text, bigint[]), orders.estoque_mescla_transferir(bigint),
  orders.estoque_mesclar_grupo(text, bigint, bigint[], text, bigint, uuid, text), orders.estoque_mesclar_lote(text, text, jsonb, uuid, text),
  orders.estoque_desfazer_decisao(bigint, uuid, text), orders.estoque_desfazer_grupo(bigint, uuid, text),
  orders.estoque_trocar_principal(bigint, bigint, uuid, text), orders.estoque_desfazer_lote(bigint, uuid, text) from public, anon, authenticated;
grant execute on function orders.estoque_mov12(text, bigint[]), orders.estoque_mescla_transferir(bigint),
  orders.estoque_mesclar_grupo(text, bigint, bigint[], text, bigint, uuid, text), orders.estoque_mesclar_lote(text, text, jsonb, uuid, text),
  orders.estoque_desfazer_decisao(bigint, uuid, text), orders.estoque_desfazer_grupo(bigint, uuid, text),
  orders.estoque_trocar_principal(bigint, bigint, uuid, text), orders.estoque_desfazer_lote(bigint, uuid, text) to service_role;

-- O par avulso (Mesclar… num grupo de dois) continua por orders.estoque_mesclar; passa a usar a mesma transferência.
create or replace function orders.estoque_mesclar(p_empresa text, p_principal bigint, p_secundario bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare a bigint := least(p_principal, p_secundario); b bigint := greatest(p_principal, p_secundario);
        d platform.estoque_duplicidade_decisao; n int;
begin
  if p_principal = p_secundario then raise exception 'Escolha dois itens diferentes'; end if;
  if not exists (select 1 from orders.estoque_duplicidade where empresa = p_empresa and prod_a = a and prod_b = b) then
    raise exception 'Este par não está na lista de possíveis duplicidades';
  end if;
  if exists (select 1 from platform.estoque_duplicidade_decisao where ativo and empresa = p_empresa
             and (secundario in (p_principal, p_secundario) and decisao = 'mesclado')) then
    raise exception 'Um dos itens já foi mesclado';
  end if;
  insert into platform.estoque_duplicidade_decisao (empresa, prod_a, prod_b, decisao, principal, secundario, created_by, created_by_email)
  values (p_empresa, a, b, 'mesclado', p_principal, p_secundario, p_user, p_email) returning * into d;
  n := orders.estoque_mescla_transferir(d.id);
  return jsonb_build_object('decisao', to_jsonb(d), 'locais_transferidos', n);
end
$fn$;

-- ── 2. Fotos ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create table if not exists platform.estoque_foto (
  empresa text not null, n_cod_prod bigint not null,
  path text not null,                       -- produtos/<empresa>/<n_cod_prod>/<hash>.<ext>
  origem text not null check (origem in ('web', 'upload', 'url')),
  source_url text, provider text, termo text,
  mime text, bytes int,
  created_by_email text, created_at timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
-- Busca automática por item: estado (retoma de onde parou) + os 5 melhores candidatos para "Trocar foto".
create table if not exists platform.estoque_foto_busca (
  empresa text not null, n_cod_prod bigint not null,
  status text not null default 'pendente' check (status in ('pendente', 'ok', 'sem_resultado', 'erro')),
  termo text, provider text,
  candidatos jsonb not null default '[]',   -- [{url, thumb, titulo, pagina, largura, altura}]
  tentativas int not null default 0, ultimo_erro text,
  buscado_em timestamptz,
  primary key (empresa, n_cod_prod)
);
-- Job (uma linha): ligado/pausado, cota por dia e o consumo do dia.
create table if not exists platform.estoque_foto_job (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default false,
  cota_dia int not null default 100 check (cota_dia between 1 and 10000),
  dia date, usados_dia int not null default 0,
  ultimo_lote_em timestamptz, ultimo_erro text, pausa_motivo text,
  updated_by_email text, updated_at timestamptz not null default now()
);
insert into platform.estoque_foto_job (id) values (1) on conflict (id) do nothing;
alter table platform.estoque_foto enable row level security;
alter table platform.estoque_foto_busca enable row level security;
alter table platform.estoque_foto_job enable row level security;

-- Fila do job: itens sem foto e ainda não buscados (ou com erro antigo e < 3 tentativas),
-- os de maior valor em estoque e mais usados primeiro. Mesclados ficam de fora.
create or replace function orders.estoque_foto_fila(p_empresa text, p_limite int) returns table (n_cod_prod bigint, descricao text, valor numeric, n_mov int)
language sql stable security definer set search_path = orders, platform, public as $$
  select i.n_cod_prod, i.descricao, round(greatest(i.saldo, 0) * i.cmc, 2), i.n_mov
  from orders.v_estoque_item i
  left join platform.estoque_foto f on f.empresa = i.empresa and f.n_cod_prod = i.n_cod_prod
  left join platform.estoque_foto_busca b on b.empresa = i.empresa and b.n_cod_prod = i.n_cod_prod
  where i.empresa = p_empresa and i.mesclado_em is null and f.n_cod_prod is null
    and (b.n_cod_prod is null or b.status = 'pendente'
         or (b.status = 'erro' and b.tentativas < 3 and b.buscado_em < now() - interval '6 hours'))
  order by greatest(i.saldo, 0) * i.cmc desc, i.n_mov desc, i.n_cod_prod
  limit p_limite
$$;
-- Reserva atômica da cota do dia (vira o dia sozinho). Devolve quantas buscas pode fazer agora.
-- p_manual: busca pedida na ficha ("Trocar foto") — conta na mesma cota, mas não exige o job ligado.
create or replace function orders.estoque_foto_reservar(p_qtd int, p_manual boolean default false) returns int
language plpgsql security definer set search_path = platform, public as $fn$
declare j platform.estoque_foto_job; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_n int;
begin
  select * into j from platform.estoque_foto_job where id = 1 for update;
  if not j.ativo and not p_manual then return 0; end if;
  if j.dia is distinct from v_hoje then j.dia := v_hoje; j.usados_dia := 0; end if;
  v_n := greatest(0, least(p_qtd, j.cota_dia - j.usados_dia));
  update platform.estoque_foto_job set dia = j.dia, usados_dia = j.usados_dia + v_n,
         ultimo_lote_em = case when p_manual then ultimo_lote_em else now() end where id = 1;
  return v_n;
end
$fn$;
revoke all on function orders.estoque_foto_fila(text, int), orders.estoque_foto_reservar(int, boolean) from public, anon, authenticated;
grant execute on function orders.estoque_foto_fila(text, int), orders.estoque_foto_reservar(int, boolean) to service_role;

-- Vez de rodar (cron e tela podem chamar ao mesmo tempo): só um ciclo por vez. p_segundos = 0 solta.
alter table platform.estoque_foto_job add column if not exists rodando_ate timestamptz;
create or replace function orders.estoque_foto_lease(p_segundos int) returns boolean
language plpgsql security definer set search_path = platform, public as $fn$
begin
  if p_segundos <= 0 then update platform.estoque_foto_job set rodando_ate = null where id = 1; return true; end if;
  update platform.estoque_foto_job set rodando_ate = now() + make_interval(secs => p_segundos)
   where id = 1 and (rodando_ate is null or rodando_ate < now());
  return found;
end
$fn$;
revoke all on function orders.estoque_foto_lease(int) from public, anon, authenticated;
grant execute on function orders.estoque_foto_lease(int) to service_role;

-- ── 3. v_estoque_item: o principal responde pelos mesclados (consumo, movimentos, PCs); mesclado_em = dono final ──
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
), dono as (
  select empresa, secundario, dono from orders.v_estoque_mescla_dono
), c90 as (
  -- movimentos, consumo e PCs de um código mesclado contam no principal (dono)
  select m.empresa, coalesce(dn.dono, m.id_prod) as id_prod, sum(abs(m.qtde)) as q90
  from orders.estoque_movimentos m left join dono dn on dn.empresa = m.empresa and dn.secundario = m.id_prod
  where m.tipo = 'saida' and coalesce(m.cancelamento, 'N') <> 'S' and m.dt_mov >= current_date - 90
  group by 1, 2
), um as (
  select m.empresa, coalesce(dn.dono, m.id_prod) as id_prod, max(m.dt_mov) as ult, count(*) as n
  from orders.estoque_movimentos m left join dono dn on dn.empresa = m.empresa and dn.secundario = m.id_prod
  where coalesce(m.cancelamento, 'N') <> 'S' group by 1, 2
), pcs as (
  select p.empresa, coalesce(dn.dono, i.ncod_prod) as ncod_prod,
         count(*) filter (where coalesce(p.etapa, '') not in ('60', '80') and p.dt_rec is null
                            and coalesce(i.qtd_recebida, 0) < i.qtd
                            and p.emissao < current_date - 60 and p.emissao >= current_date - 730) as pcs_velhos,
         count(*) filter (where i.qtd_recebida > i.qtd) as rec_a_mais,
         max(p.emissao) as ult_pc
  from compras.itens i join compras.pedidos p on p.id = i.pedido_id
  left join dono dn on dn.empresa = p.empresa and dn.secundario = i.ncod_prod
  where p.tipo = 'PC' and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2
), dup as (
  select empresa, prod_a as id from orders.v_estoque_duplicidade
  union select empresa, prod_b from orders.v_estoque_duplicidade
), mesc as (
  select empresa, secundario, dono as principal from dono
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
       coalesce((select max(x.codigo) from orders.estoque_posicao x where x.empresa = pos.empresa and x.n_cod_prod = mesc.principal),
                (select max(k.codigo) from platform.estoque_item_codigo k where k.empresa = pos.empresa and k.n_cod_prod = mesc.principal and k.atual)) as mesclado_em_codigo,
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

-- ── 4. Prévia do "Mesclar todos": PCs e fornecedores de cada código (antes → depois) ──
create or replace function orders.estoque_compras_resumo(p_empresa text, p_ids bigint[])
returns table (id_prod bigint, n_pcs bigint, fornecedores jsonb)
language sql stable security definer set search_path = compras, public as $$
  with l as (
    select i.ncod_prod as id_prod, p.id as pedido_id, coalesce(nullif(p.fornecedor_nome, ''), '(fornecedor não cadastrado)') as fornecedor,
           i.valor_unit, p.emissao
    from compras.itens i join compras.pedidos p on p.id = i.pedido_id
    where p.empresa = p_empresa and i.ncod_prod = any (p_ids) and p.tipo = 'PC' and not coalesce(p.cancelado, false)
  ), f as (
    select id_prod, fornecedor, count(*) as n, sum(valor_unit) as soma, min(valor_unit) as minimo, max(valor_unit) as maximo, max(emissao) as ult
    from l where valor_unit > 0 group by 1, 2
  )
  select x.id_prod, count(distinct l.pedido_id),
         coalesce((select jsonb_agg(jsonb_build_object('fornecedor', f.fornecedor, 'n', f.n, 'soma', f.soma, 'min', f.minimo, 'max', f.maximo, 'ult', f.ult) order by f.n desc)
                   from f where f.id_prod = x.id_prod), '[]'::jsonb)
  from unnest(p_ids) x(id_prod) left join l on l.id_prod = x.id_prod
  group by x.id_prod
$$;
revoke all on function orders.estoque_compras_resumo(text, bigint[]) from public, anon, authenticated;
grant execute on function orders.estoque_compras_resumo(text, bigint[]) to service_role;
