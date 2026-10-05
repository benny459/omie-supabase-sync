-- Estoque — Separação de material para PROJETO (05/10/26, pedido do Benny).
-- Aplicado como migrações p63_estoque_separacao_projeto_1, _2 e p63b_separacao_desfazer_alias (omie-data, 05/10/26).
-- "Quando fechamos um projeto temos que separar material para ele: movimentar como se já estivesse separado, em batelada."
--
-- Modelo: RESERVA por projeto (livro próprio), não um local novo.
--   * Separar  → o material continua no mesmo local físico; saldo total igual; DISPONÍVEL cai e RESERVADO[projeto] sobe.
--   * Devolver → reservado[projeto] → disponível (saldo igual).
--   * Consumir → reservado[projeto] → saída real: grava um platform.estoque_movimento "Consumo em projeto" (sai do local,
--                baixa o saldo, CMC do momento registado como custo do projeto).
--   Porquê não um local por projeto: os locais vêm do Omie (estoque_posicao) e o saldo por local soma Omie + painel;
--   um local fictício por projeto apareceria como estoque "noutro sítio" e confundiria inventário e transferências.
--   A reserva é só nossa: platform.estoque_reserva (linhas) + platform.estoque_sep_lote (cabeçalho, desfazível inteiro).
--   Disponível = saldo do local − reservas ativas no local (orders.v_estoque_disponivel_local).
--   Projetos: finance.projetos (código Omie + nome "PJ364_…"); quando existir o cadastro nativo de projetos, o código é o mesmo.

create table if not exists platform.estoque_sep_lote (
  id bigserial primary key,
  empresa text not null default 'SF',
  tipo text not null check (tipo in ('separar', 'devolver', 'consumir')),
  projeto_codigo bigint not null,
  projeto_nome text,
  solicitante_nome text,
  motivo text,
  obs text,
  status text not null default 'aplicado' check (status in ('aplicado', 'desfeito')),
  n_linhas int not null default 0,
  quantidade numeric not null default 0,
  valor numeric not null default 0,
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  desfeito_por_email text, desfeito_em timestamptz, desfeito_obs text
);
create table if not exists platform.estoque_reserva (
  id bigserial primary key,
  lote_id bigint not null references platform.estoque_sep_lote (id),
  empresa text not null default 'SF',
  tipo text not null check (tipo in ('separar', 'devolver', 'consumir')),
  n_cod_prod bigint not null,
  local bigint not null,
  projeto_codigo bigint not null,
  quantidade numeric not null check (quantidade > 0),
  cmc numeric not null default 0,
  valor numeric not null default 0,
  mov_id bigint references platform.estoque_movimento (id),
  status text not null default 'aplicado' check (status in ('aplicado', 'desfeito')),
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists estoque_reserva_proj on platform.estoque_reserva (empresa, projeto_codigo) where status = 'aplicado';
create index if not exists estoque_reserva_item on platform.estoque_reserva (empresa, n_cod_prod) where status = 'aplicado';
create index if not exists estoque_reserva_lote on platform.estoque_reserva (lote_id);
create index if not exists estoque_sep_lote_proj on platform.estoque_sep_lote (empresa, projeto_codigo, created_at desc);
alter table platform.estoque_sep_lote enable row level security;
alter table platform.estoque_reserva enable row level security;
revoke all on platform.estoque_sep_lote, platform.estoque_reserva from anon, authenticated;
grant select, insert, update on platform.estoque_sep_lote, platform.estoque_reserva to service_role;
grant usage, select on sequence platform.estoque_sep_lote_id_seq, platform.estoque_reserva_id_seq to service_role;

-- Tipo de movimento usado pelo "consumir" (inativo: não aparece na "Nova movimentação" genérica — só nasce daqui).
insert into platform.estoque_mov_tipo (empresa, codigo, nome, sentido, origem, exige_aprovacao, exige_cliente_ou_projeto, exige_pc, ativo, ordem, descricao)
values ('SF', 'consumo_projeto', 'Consumo em projeto (separado)', 'sai', 'manual', false, true, false, false, 35,
        'Gerado pela Separação p/ projeto ao consumir material reservado. Não reative: lance pela tela de Separação.')
on conflict (empresa, codigo) do nothing;

-- Permissão fina (catálogo espelhado de web/lib/acessos-catalogo.ts).
insert into platform.permissoes_catalogo (chave, modulo, rotulo, descricao, ordem)
values ('estoque.separar_projeto', 'estoque', 'Separar material para projeto', 'Reservar, devolver e consumir material de projetos (em lote)', 245)
on conflict (chave) do nothing;

-- Reservado ativo por item/local/projeto.
create or replace view orders.v_estoque_reserva as
select r.empresa, r.n_cod_prod, r.local, r.projeto_codigo,
       sum(case r.tipo when 'separar' then r.quantidade else -r.quantidade end) as reservado
from platform.estoque_reserva r
where r.status = 'aplicado'
group by 1, 2, 3, 4
having sum(case r.tipo when 'separar' then r.quantidade else -r.quantidade end) <> 0;
revoke all on orders.v_estoque_reserva from anon, authenticated;

-- Disponível por local = saldo − reservas (todas os projetos) naquele local.
create or replace view orders.v_estoque_disponivel_local as
select s.empresa, s.n_cod_prod, s.codigo_local_estoque as local, s.saldo, s.cmc,
       coalesce(rv.reservado, 0) as reservado, s.saldo - coalesce(rv.reservado, 0) as disponivel
from orders.v_estoque_saldo_local s
left join (select empresa, n_cod_prod, local, sum(reservado) as reservado from orders.v_estoque_reserva group by 1, 2, 3) rv
  on rv.empresa = s.empresa and rv.n_cod_prod = s.n_cod_prod and rv.local = s.codigo_local_estoque;
revoke all on orders.v_estoque_disponivel_local from anon, authenticated;

-- Por item (para listas/ficha): total reservado e em quantos projetos.
create or replace view orders.v_estoque_reserva_item as
select empresa, n_cod_prod, sum(reservado) as reservado_proj, count(distinct projeto_codigo) as n_projetos
from orders.v_estoque_reserva group by 1, 2;
revoke all on orders.v_estoque_reserva_item from anon, authenticated;
grant select on orders.v_estoque_reserva, orders.v_estoque_disponivel_local, orders.v_estoque_reserva_item to service_role;

-- Nome do projeto (finance.projetos; o cadastro nativo, quando existir, mantém o mesmo código).
create or replace function orders.estoque_projeto_nome(p_empresa text, p_codigo bigint) returns text
language sql stable security definer set search_path = finance, public as $$
  select nome from finance.projetos where empresa = p_empresa and codigo = p_codigo limit 1
$$;

-- Lançar um lote: {empresa?, tipo: separar|devolver|consumir, projeto_codigo, solicitante_nome, motivo?, obs?,
--                  linhas: [{n_cod_prod, quantidade, local?, obs?}]} — tudo ou nada; erro diz a linha.
create or replace function orders.estoque_separacao(p jsonb, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare
  v_emp text := coalesce(nullif(p->>'empresa', ''), 'SF');
  v_tipo text := p->>'tipo';
  v_proj bigint := nullif(p->>'projeto_codigo', '')::bigint;
  v_nome text; v_sol text := nullif(trim(coalesce(p->>'solicitante_nome', '')), '');
  v_mot text; l platform.estoque_sep_lote; x jsonb; i int := 0;
  v_prod bigint; v_q numeric; v_loc bigint; v_disp numeric; v_res numeric; v_cmc numeric; v_mov bigint; v_tipo_mov bigint;
  tq numeric := 0; tv numeric := 0;
begin
  if v_tipo not in ('separar', 'devolver', 'consumir') then raise exception 'Tipo inválido (separar, devolver ou consumir)'; end if;
  if v_proj is null then raise exception 'Escolha o projeto'; end if;
  v_nome := orders.estoque_projeto_nome(v_emp, v_proj);
  if v_nome is null then raise exception 'Projeto % não encontrado', v_proj; end if;
  if v_sol is null then raise exception 'Informe quem pediu (solicitante)'; end if;
  if jsonb_typeof(p->'linhas') <> 'array' or jsonb_array_length(p->'linhas') = 0 then raise exception 'Adicione pelo menos um item'; end if;
  if jsonb_array_length(p->'linhas') > 500 then raise exception 'No máximo 500 linhas por lote'; end if;
  v_mot := coalesce(nullif(trim(coalesce(p->>'motivo', '')), ''),
                    case v_tipo when 'separar' then 'Separação para o projeto' when 'devolver' then 'Devolução do projeto ao estoque' else 'Consumo no projeto' end);
  if v_tipo = 'consumir' then
    select id into v_tipo_mov from platform.estoque_mov_tipo where empresa = v_emp and codigo = 'consumo_projeto';
    if v_tipo_mov is null then raise exception 'Tipo "consumo_projeto" não configurado'; end if;
  end if;

  insert into platform.estoque_sep_lote (empresa, tipo, projeto_codigo, projeto_nome, solicitante_nome, motivo, obs, created_by, created_by_email)
  values (v_emp, v_tipo, v_proj, v_nome, v_sol, v_mot, nullif(trim(coalesce(p->>'obs', '')), ''), p_user, p_email)
  returning * into l;

  for x in select * from jsonb_array_elements(p->'linhas') loop
    i := i + 1;
    v_prod := nullif(x->>'n_cod_prod', '')::bigint;
    v_q := nullif(replace(x->>'quantidade', ',', '.'), '')::numeric;
    v_loc := nullif(x->>'local', '')::bigint;
    if v_prod is null then raise exception 'Linha %: item não informado', i; end if;
    if v_q is null or v_q <= 0 then raise exception 'Linha %: quantidade tem de ser maior que zero', i; end if;
    if exists (select 1 from orders.v_estoque_mescla_dono where empresa = v_emp and secundario = v_prod) then
      raise exception 'Linha %: este código foi mesclado — use o código principal', i;
    end if;
    if not exists (select 1 from orders.v_estoque_saldo_local where empresa = v_emp and n_cod_prod = v_prod) then
      raise exception 'Linha %: item % não está no estoque', i, v_prod;
    end if;

    if v_tipo = 'separar' then
      if v_loc is null then  -- local com mais disponível
        select local into v_loc from orders.v_estoque_disponivel_local where empresa = v_emp and n_cod_prod = v_prod order by disponivel desc, local limit 1;
      end if;
      select coalesce(sum(disponivel), 0), coalesce(max(cmc), 0) into v_disp, v_cmc
        from orders.v_estoque_disponivel_local where empresa = v_emp and n_cod_prod = v_prod and local = v_loc;
      if v_q > v_disp then
        raise exception 'Linha %: só há % disponível no local (pediu %)', i, trim(to_char(greatest(v_disp, 0), 'FM999999990.###')), trim(to_char(v_q, 'FM999999990.###'));
      end if;
    else
      if v_loc is null then  -- local onde este projeto tem mais reservado
        select local into v_loc from orders.v_estoque_reserva where empresa = v_emp and n_cod_prod = v_prod and projeto_codigo = v_proj order by reservado desc limit 1;
      end if;
      select coalesce(sum(reservado), 0) into v_res from orders.v_estoque_reserva
        where empresa = v_emp and n_cod_prod = v_prod and projeto_codigo = v_proj and local = v_loc;
      if v_q > v_res then
        raise exception 'Linha %: o projeto só tem % separado deste item (pediu %)', i, trim(to_char(greatest(v_res, 0), 'FM999999990.###')), trim(to_char(v_q, 'FM999999990.###'));
      end if;
      select coalesce(nullif(max(cmc) filter (where codigo_local_estoque = v_loc), 0), max(cmc), 0) into v_cmc
        from orders.v_estoque_saldo_local where empresa = v_emp and n_cod_prod = v_prod;
    end if;

    v_mov := null;
    if v_tipo = 'consumir' then
      insert into platform.estoque_movimento (empresa, tipo_id, n_cod_prod, quantidade, local_origem, local_destino, solicitante_user, solicitante_nome,
        projeto, motivo, obs, status, cmc, valor, created_by, created_by_email)
      values (v_emp, v_tipo_mov, v_prod, v_q, v_loc, null, p_user, v_sol, v_nome, v_mot,
        concat_ws(' · ', 'Separação lote #' || l.id, nullif(trim(coalesce(x->>'obs', '')), '')), 'aplicado', v_cmc, round(-v_q * v_cmc, 2), p_user, p_email)
      returning id into v_mov;
    end if;

    insert into platform.estoque_reserva (lote_id, empresa, tipo, n_cod_prod, local, projeto_codigo, quantidade, cmc, valor, mov_id, obs)
    values (l.id, v_emp, v_tipo, v_prod, v_loc, v_proj, v_q, v_cmc, round(v_q * v_cmc, 2), v_mov, nullif(trim(coalesce(x->>'obs', '')), ''));
    tq := tq + v_q; tv := tv + v_q * v_cmc;
  end loop;

  update platform.estoque_sep_lote set n_linhas = i, quantidade = tq, valor = round(tv, 2) where id = l.id returning * into l;
  return to_jsonb(l);
end
$fn$;

-- Desfazer um lote inteiro (consumo: cancela o movimento e o saldo volta). Recusa se deixaria reserva negativa
-- (ex.: separação já parcialmente devolvida/consumida por outro lote — desfaça esse antes).
create or replace function orders.estoque_separacao_desfazer(p_lote bigint, p_email text, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare l platform.estoque_sep_lote; r record;
begin
  select * into l from platform.estoque_sep_lote where id = p_lote for update;
  if not found then raise exception 'Lote não encontrado'; end if;
  if l.status <> 'aplicado' then raise exception 'Este lote já foi desfeito'; end if;
  for r in select * from platform.estoque_reserva where lote_id = p_lote and status = 'aplicado' loop
    if r.mov_id is not null then
      update platform.estoque_movimento set status = 'cancelado', cancelado_por_email = p_email, cancelado_em = now(),
        decisao_obs = concat_ws(' · ', 'Lote de separação #' || p_lote || ' desfeito', nullif(trim(coalesce(p_obs, '')), ''))
       where id = r.mov_id and status = 'aplicado';
    end if;
  end loop;
  update platform.estoque_reserva set status = 'desfeito' where lote_id = p_lote and status = 'aplicado';
  if exists (
    select 1 from platform.estoque_reserva rr
    where rr.status = 'aplicado' and (rr.empresa, rr.n_cod_prod, rr.local, rr.projeto_codigo) in
          (select x.empresa, x.n_cod_prod, x.local, x.projeto_codigo from platform.estoque_reserva x where x.lote_id = p_lote)
    group by rr.empresa, rr.n_cod_prod, rr.local, rr.projeto_codigo
    having sum(case rr.tipo when 'separar' then rr.quantidade else -rr.quantidade end) < 0
  ) then
    raise exception 'Não dá para desfazer: parte deste material já foi devolvida ou consumida noutro lote — desfaça esse lote antes';
  end if;
  update platform.estoque_sep_lote set status = 'desfeito', desfeito_por_email = p_email, desfeito_em = now(),
    desfeito_obs = nullif(trim(coalesce(p_obs, '')), '') where id = p_lote returning * into l;
  return to_jsonb(l);
end
$fn$;

-- Candidatos para o lote de um projeto: itens das RC/PC do projeto (necessário = RC, ou PC se não houver RC),
-- mais o que já está separado. Cada linha: saldo, disponível, separado p/ este projeto, necessário, CMC, local sugerido.
create or replace function orders.estoque_separacao_candidatos(p_empresa text, p_projeto bigint) returns jsonb
language sql stable security definer set search_path = orders, platform, compras, approval, public as $fn$
with ped as (
  select coalesce(md.dono, i.ncod_prod) as n_cod_prod, p.tipo, sum(i.qtd) as qtd
  from compras.pedidos p
  join compras.itens i on i.pedido_id = p.id
  left join orders.v_estoque_mescla_dono md on md.empresa = p.empresa and md.secundario = i.ncod_prod
  where p.empresa = p_empresa and p.projeto_cod = p_projeto and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2
), nec as (
  select n_cod_prod, coalesce(sum(qtd) filter (where tipo = 'RC'), sum(qtd) filter (where tipo = 'PC')) as necessario,
         bool_or(tipo = 'RC') as tem_rc
  from ped group by 1
), res as (
  select n_cod_prod, sum(reservado) as separado from orders.v_estoque_reserva
  where empresa = p_empresa and projeto_codigo = p_projeto group by 1
), base as (
  select coalesce(nec.n_cod_prod, res.n_cod_prod) as n_cod_prod, nec.necessario, coalesce(nec.tem_rc, false) as tem_rc, coalesce(res.separado, 0) as separado
  from nec full join res on res.n_cod_prod = nec.n_cod_prod
), disp as (
  select n_cod_prod, sum(saldo) as saldo, sum(disponivel) as disponivel,
         (array_agg(local order by disponivel desc))[1] as local_sugerido, max(cmc) as cmc
  from orders.v_estoque_disponivel_local where empresa = p_empresa and n_cod_prod in (select n_cod_prod from base) group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
  'n_cod_prod', b.n_cod_prod, 'codigo', coalesce(it.codigo_novo, it.codigo), 'codigo_omie', it.codigo_omie, 'descricao', it.descricao,
  'unidade', it.unidade, 'saldo', coalesce(d.saldo, 0), 'disponivel', coalesce(d.disponivel, 0), 'separado', b.separado,
  'necessario', b.necessario, 'origem', case when b.tem_rc then 'RC' when b.necessario is not null then 'PC' else 'separado' end,
  'cmc', coalesce(it.cmc, d.cmc, 0), 'local_sugerido', d.local_sugerido, 'no_estoque', it.n_cod_prod is not null
) order by it.descricao nulls last), '[]'::jsonb)
from base b
left join orders.v_estoque_item it on it.empresa = p_empresa and it.n_cod_prod = b.n_cod_prod
left join disp d on d.n_cod_prod = b.n_cod_prod
$fn$;

-- Materiais separados de um projeto (por item/local) + resumo de consumo + últimos lotes.
create or replace function orders.estoque_separacao_projeto(p_empresa text, p_projeto bigint) returns jsonb
language sql stable security definer set search_path = orders, platform, public as $fn$
select jsonb_build_object(
  'projeto', jsonb_build_object('codigo', p_projeto, 'nome', orders.estoque_projeto_nome(p_empresa, p_projeto)),
  'itens', coalesce((
    select jsonb_agg(jsonb_build_object('n_cod_prod', r.n_cod_prod, 'local', r.local, 'reservado', r.reservado,
      'codigo', coalesce(it.codigo_novo, it.codigo), 'descricao', it.descricao, 'unidade', it.unidade, 'cmc', coalesce(it.cmc, 0),
      'valor', round(r.reservado * coalesce(it.cmc, 0), 2)) order by it.descricao)
    from orders.v_estoque_reserva r left join orders.v_estoque_item it on it.empresa = r.empresa and it.n_cod_prod = r.n_cod_prod
    where r.empresa = p_empresa and r.projeto_codigo = p_projeto and r.reservado > 0), '[]'::jsonb),
  'consumido', coalesce((
    select jsonb_build_object('quantidade', sum(r.quantidade), 'valor', round(sum(r.valor), 2), 'linhas', count(*))
    from platform.estoque_reserva r where r.empresa = p_empresa and r.projeto_codigo = p_projeto and r.tipo = 'consumir' and r.status = 'aplicado'), '{}'::jsonb),
  'lotes', coalesce((
    select jsonb_agg(to_jsonb(l) order by l.created_at desc) from (
      select * from platform.estoque_sep_lote where empresa = p_empresa and projeto_codigo = p_projeto order by created_at desc limit 50) l), '[]'::jsonb)
)
$fn$;

-- Reservas de um item por projeto (ficha do item).
create or replace function orders.estoque_reserva_do_item(p_empresa text, p_n_cod_prod bigint) returns jsonb
language sql stable security definer set search_path = orders, public as $fn$
select coalesce(jsonb_agg(jsonb_build_object('projeto_codigo', r.projeto_codigo, 'projeto', orders.estoque_projeto_nome(r.empresa, r.projeto_codigo),
  'local', r.local, 'reservado', r.reservado) order by r.reservado desc), '[]'::jsonb)
from orders.v_estoque_reserva r where r.empresa = p_empresa and r.n_cod_prod = p_n_cod_prod and r.reservado > 0
$fn$;

-- Lotes recentes (todas os projetos) para a tela de Separação.
create or replace function orders.estoque_separacao_lotes(p_empresa text, p_lim int default 50) returns jsonb
language sql stable security definer set search_path = platform, public as $fn$
select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
from (select * from platform.estoque_sep_lote where empresa = p_empresa order by created_at desc limit greatest(1, least(p_lim, 200))) l
$fn$;

-- Busca de projeto por código (PJ364, 41_VP…), nome ou código Omie.
create or replace function orders.estoque_projetos_buscar(p_empresa text, p_q text) returns jsonb
language sql stable security definer set search_path = orders, finance, public as $fn$
select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'nome', x.nome, 'separados', x.separados) order by x.nome), '[]'::jsonb)
from (
  select pj.codigo, pj.nome,
         (select count(*) from orders.v_estoque_reserva r where r.empresa = pj.empresa and r.projeto_codigo = pj.codigo and r.reservado > 0) as separados
  from finance.projetos pj
  where pj.empresa = p_empresa and coalesce(pj.inativo, 'N') <> 'S'
    and (coalesce(trim(p_q), '') = '' or orders.fn_casa(concat_ws(' ', pj.nome, pj.cod_int, pj.codigo::text), p_q))
  order by pj.nome limit 20
) x
$fn$;

-- Resumo por projeto para a LISTA de Projetos (uma consulta para todos): itens separados, valor (CMC) e
-- "% separado" = Σ min(separado, necessário) / Σ necessário, onde necessário vem das RC (ou PC) do projeto com item de estoque.
create or replace function orders.estoque_separacao_resumo_projetos(p_empresa text) returns jsonb
language sql stable security definer set search_path = orders, platform, compras, public as $fn$
with res as (
  select r.projeto_codigo, r.n_cod_prod, sum(r.reservado) as separado
  from orders.v_estoque_reserva r where r.empresa = p_empresa and r.reservado > 0 group by 1, 2
), ped as (
  select p.projeto_cod as projeto_codigo, coalesce(md.dono, i.ncod_prod) as n_cod_prod, p.tipo, sum(i.qtd) as qtd
  from compras.pedidos p join compras.itens i on i.pedido_id = p.id
  left join orders.v_estoque_mescla_dono md on md.empresa = p.empresa and md.secundario = i.ncod_prod
  where p.empresa = p_empresa and p.projeto_cod in (select projeto_codigo from res) and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2, 3
), nec as (
  select projeto_codigo, n_cod_prod, coalesce(sum(qtd) filter (where tipo = 'RC'), sum(qtd) filter (where tipo = 'PC')) as necessario
  from ped group by 1, 2
), cmc as (
  select n_cod_prod, max(cmc) as cmc from orders.v_estoque_saldo_local where empresa = p_empresa
    and n_cod_prod in (select n_cod_prod from res) group by 1
), por as (
  select r.projeto_codigo, count(*) as itens, sum(r.separado) as quantidade, round(sum(r.separado * coalesce(c.cmc, 0)), 2) as valor
  from res r left join cmc c on c.n_cod_prod = r.n_cod_prod group by 1
), pct as (
  select n.projeto_codigo, sum(least(coalesce(r.separado, 0), n.necessario)) / nullif(sum(n.necessario), 0) as pct
  from nec n left join res r on r.projeto_codigo = n.projeto_codigo and r.n_cod_prod = n.n_cod_prod
  where n.necessario > 0 group by 1
)
select coalesce(jsonb_object_agg(por.projeto_codigo::text, jsonb_build_object('itens', por.itens, 'quantidade', por.quantidade,
  'valor', por.valor, 'pct', round(pct.pct * 100))), '{}'::jsonb)
from por left join pct on pct.projeto_codigo = por.projeto_codigo
$fn$;

revoke all on function orders.estoque_separacao(jsonb, uuid, text), orders.estoque_separacao_desfazer(bigint, text, text),
  orders.estoque_separacao_candidatos(text, bigint), orders.estoque_separacao_projeto(text, bigint), orders.estoque_reserva_do_item(text, bigint),
  orders.estoque_separacao_lotes(text, int), orders.estoque_projetos_buscar(text, text), orders.estoque_projeto_nome(text, bigint),
  orders.estoque_separacao_resumo_projetos(text)
  from public, anon, authenticated;
grant execute on function orders.estoque_separacao(jsonb, uuid, text), orders.estoque_separacao_desfazer(bigint, text, text),
  orders.estoque_separacao_candidatos(text, bigint), orders.estoque_separacao_projeto(text, bigint), orders.estoque_reserva_do_item(text, bigint),
  orders.estoque_separacao_lotes(text, int), orders.estoque_projetos_buscar(text, text), orders.estoque_projeto_nome(text, bigint),
  orders.estoque_separacao_resumo_projetos(text)
  to service_role;
