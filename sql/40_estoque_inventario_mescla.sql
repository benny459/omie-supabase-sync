-- 40 — Estoque v2: família do produto, janelas de inventário com senha temporária,
-- ajustes de saldo SÓ no painel (nunca vão ao Omie) e mesclagem de duplicidades · 01/10/2026
-- Só objetos novos (omie-data é compartilhado com o ALLKA). Tabelas com RLS e sem policy:
-- só o service role (rotas /api/estoque/*) lê e grava. Views do 36 são recriadas aqui.

-- ── Família do produto (espelho só-leitura do Omie, ListarProdutos) ─────────
create table if not exists orders.produto_familia (
  empresa text not null, id_omie bigint not null,
  codigo_familia bigint, descricao_familia text,
  synced_at timestamptz not null default now(),
  primary key (empresa, id_omie)
);
alter table orders.produto_familia enable row level security;

-- ── Janelas de inventário ────────────────────────────────────────────────────
-- A senha (6 caracteres) é mostrada UMA vez ao admin; aqui fica só sha256(sal:senha).
create table if not exists platform.estoque_janela (
  id bigserial primary key,
  nome text not null,
  codigo_salt text not null,
  codigo_hash text not null,
  escopo jsonb not null default '{}'::jsonb,          -- {} = tudo · {"familia": "..."} · {"local": "2264756939"}
  valida_ate timestamptz not null,
  revogada_em timestamptz, revogada_por uuid, revogada_por_email text,
  created_by uuid, created_by_email text,
  created_at timestamptz not null default now()
);
alter table platform.estoque_janela enable row level security;

-- Tentativas de senha (limite contra chute: 8 erros / 15 min por usuário).
create table if not exists platform.estoque_janela_tentativa (
  id bigserial primary key, user_id uuid, ok boolean not null, janela_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists estoque_janela_tentativa_user on platform.estoque_janela_tentativa (user_id, created_at desc);
alter table platform.estoque_janela_tentativa enable row level security;

-- ── Decisões de duplicidade (não é / mesclado) ───────────────────────────────
create table if not exists platform.estoque_duplicidade_decisao (
  id bigserial primary key,
  empresa text not null, prod_a bigint not null, prod_b bigint not null,  -- prod_a < prod_b
  decisao text not null check (decisao in ('nao_e', 'mesclado')),
  principal bigint, secundario bigint,
  ativo boolean not null default true,
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  desfeito_por uuid, desfeito_por_email text, desfeito_em timestamptz,
  check (prod_a < prod_b)
);
create unique index if not exists estoque_dup_decisao_ativa on platform.estoque_duplicidade_decisao (empresa, prod_a, prod_b) where ativo;
alter table platform.estoque_duplicidade_decisao enable row level security;

-- ── Ajustes de saldo (só no painel) ─────────────────────────────────────────
create table if not exists platform.estoque_ajuste (
  id bigserial primary key,
  empresa text not null, n_cod_prod bigint not null, codigo_local_estoque bigint not null,
  tipo text not null check (tipo in ('inventario', 'mesclagem')),
  janela_id bigint references platform.estoque_janela (id),
  mescla_id bigint references platform.estoque_duplicidade_decisao (id),
  saldo_antes numeric not null, contagem numeric not null, diferenca numeric not null,
  cmc numeric not null default 0, valor numeric not null default 0,
  motivo text not null, obs text,
  status text not null default 'aplicado' check (status in ('aplicado', 'revertido')),
  revisao text not null default 'pendente' check (revisao in ('pendente', 'conferido', 'contestado')),
  revisado_por uuid, revisado_por_email text, revisado_em timestamptz,
  revertido_por uuid, revertido_por_email text, revertido_em timestamptz,
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  check (tipo <> 'inventario' or janela_id is not null),
  check (tipo <> 'mesclagem' or mescla_id is not null)
);
create index if not exists estoque_ajuste_item on platform.estoque_ajuste (empresa, n_cod_prod, codigo_local_estoque) where status = 'aplicado';
create index if not exists estoque_ajuste_janela on platform.estoque_ajuste (janela_id);
alter table platform.estoque_ajuste enable row level security;

revoke all on orders.produto_familia, platform.estoque_janela, platform.estoque_janela_tentativa,
  platform.estoque_duplicidade_decisao, platform.estoque_ajuste from anon, authenticated;

-- ── SALDO = espelho do Omie + ajustes do painel aplicados (ponto único) ──────
-- Locais que só existem por ajuste (mesclagem trouxe saldo de um local que o principal
-- não tinha no Omie) entram com saldo_omie 0.
create or replace view orders.v_estoque_saldo_local as
with aj as (
  select empresa, n_cod_prod, codigo_local_estoque, sum(diferenca) as ajuste
  from platform.estoque_ajuste where status = 'aplicado'
  group by 1, 2, 3
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
              where p.empresa = e.empresa and p.n_cod_prod = e.n_cod_prod order by p.codigo_local_estoque limit 1) b on true;

-- Pares ainda a decidir: sem decisão ativa e sem item já mesclado.
create or replace view orders.v_estoque_duplicidade as
select d.empresa, d.prod_a, d.prod_b, d.tipo, d.sim, d.chave, d.atualizado_em
from orders.estoque_duplicidade d
where not exists (select 1 from platform.estoque_duplicidade_decisao x
                  where x.ativo and x.empresa = d.empresa and x.prod_a = d.prod_a and x.prod_b = d.prod_b)
  and not exists (select 1 from platform.estoque_duplicidade_decisao x
                  where x.ativo and x.decisao = 'mesclado' and x.empresa = d.empresa and x.secundario in (d.prod_a, d.prod_b));

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
)
select pos.empresa, pos.n_cod_prod, pos.codigo, pos.descricao,
       sp.unidade, sp.ncm,
       pos.saldo, pos.saldo_omie, pos.ajuste, pos.fisico, pos.reservado, pos.pendente, pos.cmc, pos.estoque_minimo, pos.data_posicao,
       pos.locais, jsonb_array_length(pos.locais) as n_locais, pos.local_negativo,
       coalesce(c90.q90, 0) as consumo_90d, um.ult as ult_mov, coalesce(um.n, 0) as n_mov,
       coalesce(pcs.pcs_velhos, 0) as pcs_velhos, coalesce(pcs.rec_a_mais, 0) as rec_a_mais, pcs.ult_pc,
       (dup.id is not null) as duplicidade,
       fam.codigo_familia, fam.descricao_familia as familia,
       mesc.principal as mesclado_em,
       (select max(x.codigo) from orders.estoque_posicao x where x.empresa = pos.empresa and x.n_cod_prod = mesc.principal) as mesclado_em_codigo
from pos
left join c90 on c90.empresa = pos.empresa and c90.id_prod = pos.n_cod_prod
left join um on um.empresa = pos.empresa and um.id_prod = pos.n_cod_prod
left join pcs on pcs.empresa = pos.empresa and pcs.ncod_prod = pos.n_cod_prod
left join (select distinct on (empresa, id_omie) empresa, id_omie, unidade, ncm from sales.produtos order by empresa, id_omie, synced_at desc) sp
  on sp.empresa = pos.empresa and sp.id_omie = pos.n_cod_prod
left join (select distinct empresa, id from dup) dup on dup.empresa = pos.empresa and dup.id = pos.n_cod_prod
left join orders.produto_familia fam on fam.empresa = pos.empresa and fam.id_omie = pos.n_cod_prod
left join mesc on mesc.empresa = pos.empresa and mesc.secundario = pos.n_cod_prod;

revoke all on orders.v_estoque_item, orders.v_estoque_saldo_local, orders.v_estoque_duplicidade from anon, authenticated;

-- ── Escritas (transação + checagens no servidor). Só service role executa. ───
-- Ajuste de inventário: a janela é checada AQUI (revogada/expirada/escopo) além da rota.
create or replace function orders.estoque_ajustar(
  p_janela bigint, p_empresa text, p_prod bigint, p_local bigint, p_contagem numeric,
  p_motivo text, p_obs text, p_user uuid, p_email text
) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare j platform.estoque_janela; s numeric; c numeric; fam text; r platform.estoque_ajuste;
begin
  select * into j from platform.estoque_janela where id = p_janela for update;
  if not found then raise exception 'Janela de inventário inexistente'; end if;
  if j.revogada_em is not null then raise exception 'Janela de inventário revogada'; end if;
  if j.valida_ate <= now() then raise exception 'Janela de inventário expirada'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  if p_contagem is null or p_contagem < 0 then raise exception 'Contagem inválida'; end if;
  if j.escopo ? 'local' and j.escopo->>'local' <> p_local::text then
    raise exception 'Esta janela vale só para o local %', j.escopo->>'local';
  end if;
  if j.escopo ? 'familia' then
    select descricao_familia into fam from orders.produto_familia where empresa = p_empresa and id_omie = p_prod;
    if coalesce(fam, '') <> j.escopo->>'familia' then raise exception 'Esta janela vale só para a família %', j.escopo->>'familia'; end if;
  end if;
  select saldo, cmc into s, c from orders.v_estoque_saldo_local
   where empresa = p_empresa and n_cod_prod = p_prod and codigo_local_estoque = p_local;
  if not found then raise exception 'Item/local não encontrado na posição de estoque'; end if;
  -- Local com CMC zerado no Omie (comum no Local 2): usa o maior CMC do item.
  if coalesce(c, 0) = 0 then select max(cmc) into c from orders.estoque_posicao where empresa = p_empresa and n_cod_prod = p_prod; end if;
  if p_contagem = s then raise exception 'Sem diferença: contagem igual ao saldo'; end if;
  insert into platform.estoque_ajuste (empresa, n_cod_prod, codigo_local_estoque, tipo, janela_id, saldo_antes, contagem,
    diferenca, cmc, valor, motivo, obs, created_by, created_by_email)
  values (p_empresa, p_prod, p_local, 'inventario', p_janela, s, p_contagem, p_contagem - s, coalesce(c, 0),
    round((p_contagem - s) * coalesce(c, 0), 2), p_motivo, nullif(trim(coalesce(p_obs, '')), ''), p_user, p_email)
  returning * into r;
  return to_jsonb(r);
end
$fn$;

create or replace function orders.estoque_revisar(p_id bigint, p_revisao text, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare r platform.estoque_ajuste;
begin
  if p_revisao not in ('pendente', 'conferido', 'contestado') then raise exception 'Revisão inválida'; end if;
  update platform.estoque_ajuste set revisao = p_revisao, revisado_por = p_user, revisado_por_email = p_email, revisado_em = now()
   where id = p_id and status = 'aplicado' returning * into r;
  if not found then raise exception 'Ajuste não encontrado ou já revertido'; end if;
  return to_jsonb(r);
end
$fn$;

-- Reverter: só ajuste de inventário contestado (mesclagem desfaz-se pela mescla inteira).
create or replace function orders.estoque_reverter(p_id bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare r platform.estoque_ajuste;
begin
  update platform.estoque_ajuste set status = 'revertido', revertido_por = p_user, revertido_por_email = p_email, revertido_em = now()
   where id = p_id and status = 'aplicado' and tipo = 'inventario' and revisao = 'contestado' returning * into r;
  if not found then raise exception 'Só um ajuste de inventário aplicado e contestado pode ser revertido'; end if;
  return to_jsonb(r);
end
$fn$;

-- Mesclar: o saldo do secundário (por local) passa ao principal por dois ajustes 'mesclagem'.
create or replace function orders.estoque_mesclar(p_empresa text, p_principal bigint, p_secundario bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare a bigint := least(p_principal, p_secundario); b bigint := greatest(p_principal, p_secundario);
        d platform.estoque_duplicidade_decisao; l record; c_p numeric; n int := 0;
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
  for l in select v.codigo_local_estoque, v.saldo,
                  coalesce(nullif(v.cmc, 0), (select max(x.cmc) from orders.estoque_posicao x where x.empresa = p_empresa and x.n_cod_prod = p_secundario)) as cmc
           from orders.v_estoque_saldo_local v
           where v.empresa = p_empresa and v.n_cod_prod = p_secundario and v.saldo <> 0 loop
    select coalesce((select saldo from orders.v_estoque_saldo_local where empresa = p_empresa and n_cod_prod = p_principal
                     and codigo_local_estoque = l.codigo_local_estoque), 0) into c_p;
    insert into platform.estoque_ajuste (empresa, n_cod_prod, codigo_local_estoque, tipo, mescla_id, saldo_antes, contagem, diferenca,
      cmc, valor, motivo, revisao, created_by, created_by_email)
    values (p_empresa, p_secundario, l.codigo_local_estoque, 'mesclagem', d.id, l.saldo, 0, -l.saldo, coalesce(l.cmc, 0),
      round(-l.saldo * coalesce(l.cmc, 0), 2), 'Mesclagem: saldo transferido ao código principal', 'conferido', p_user, p_email),
           (p_empresa, p_principal, l.codigo_local_estoque, 'mesclagem', d.id, c_p, c_p + l.saldo, l.saldo, coalesce(l.cmc, 0),
      round(l.saldo * coalesce(l.cmc, 0), 2), 'Mesclagem: saldo recebido do código duplicado', 'conferido', p_user, p_email);
    n := n + 1;
  end loop;
  return jsonb_build_object('decisao', to_jsonb(d), 'locais_transferidos', n);
end
$fn$;

create or replace function orders.estoque_nao_duplicidade(p_empresa text, p_a bigint, p_b bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare d platform.estoque_duplicidade_decisao;
begin
  insert into platform.estoque_duplicidade_decisao (empresa, prod_a, prod_b, decisao, created_by, created_by_email)
  values (p_empresa, least(p_a, p_b), greatest(p_a, p_b), 'nao_e', p_user, p_email) returning * into d;
  return to_jsonb(d);
exception when unique_violation then raise exception 'Este par já tem uma decisão';
end
$fn$;

-- Desfazer decisão (mesclagem → reverte os ajustes dela; "não é" → o par volta para a lista).
create or replace function orders.estoque_desfazer_decisao(p_id bigint, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare d platform.estoque_duplicidade_decisao; n int;
begin
  update platform.estoque_duplicidade_decisao set ativo = false, desfeito_por = p_user, desfeito_por_email = p_email, desfeito_em = now()
   where id = p_id and ativo returning * into d;
  if not found then raise exception 'Decisão não encontrada ou já desfeita'; end if;
  update platform.estoque_ajuste set status = 'revertido', revertido_por = p_user, revertido_por_email = p_email, revertido_em = now()
   where mescla_id = p_id and status = 'aplicado';
  get diagnostics n = row_count;
  return jsonb_build_object('decisao', to_jsonb(d), 'ajustes_revertidos', n);
end
$fn$;

revoke all on function orders.estoque_ajustar(bigint, text, bigint, bigint, numeric, text, text, uuid, text),
  orders.estoque_revisar(bigint, text, uuid, text), orders.estoque_reverter(bigint, uuid, text),
  orders.estoque_mesclar(text, bigint, bigint, uuid, text), orders.estoque_nao_duplicidade(text, bigint, bigint, uuid, text),
  orders.estoque_desfazer_decisao(bigint, uuid, text) from public, anon, authenticated;
grant execute on function orders.estoque_ajustar(bigint, text, bigint, bigint, numeric, text, text, uuid, text),
  orders.estoque_revisar(bigint, text, uuid, text), orders.estoque_reverter(bigint, uuid, text),
  orders.estoque_mesclar(text, bigint, bigint, uuid, text), orders.estoque_nao_duplicidade(text, bigint, bigint, uuid, text),
  orders.estoque_desfazer_decisao(bigint, uuid, text) to service_role;

-- Inserções feitas pela rota (janela, tentativa) usam as sequências com o service role.
grant usage, select on sequence platform.estoque_janela_id_seq, platform.estoque_janela_tentativa_id_seq,
  platform.estoque_ajuste_id_seq, platform.estoque_duplicidade_decisao_id_seq to service_role;
