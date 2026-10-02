-- Estoque v2 (02/10/26) — "Nova movimentação" em LOTE + autocompletar de cliente / projeto / PV-OS / PC.
--   platform.estoque_mov_lote: o cabeçalho (tipo, solicitante, cliente, projeto, PV/OS, PC, justificativa, obs);
--   cada linha vira um platform.estoque_movimento com lote_id. Lançamento atômico (tudo ou nada).
--   Tipo que exige aprovação: o lote inteiro fica pendente e é aprovado/rejeitado de uma vez.

create table if not exists platform.estoque_mov_lote (
  id bigserial primary key,
  empresa text not null default 'SF',
  tipo_id bigint not null references platform.estoque_mov_tipo (id),
  solicitante_nome text not null, cliente text, projeto text, pv_os text, pc_numero text, motivo text not null, obs text,
  status text not null check (status in ('aplicado', 'pendente', 'rejeitado', 'cancelado')),
  n_linhas int not null default 0, quantidade numeric not null default 0, valor numeric not null default 0,
  created_by uuid, created_by_email text, created_at timestamptz not null default now()
);
alter table platform.estoque_mov_lote enable row level security;
alter table platform.estoque_movimento add column if not exists lote_id bigint references platform.estoque_mov_lote (id);
create index if not exists estoque_movimento_lote on platform.estoque_movimento (lote_id) where lote_id is not null;
grant usage, select on sequence platform.estoque_mov_lote_id_seq to service_role;

-- Lança o lote: cabeçalho + linhas [{n_cod_prod, quantidade, local_origem?, local_destino?, obs?}]. Reusa todas as
-- validações de orders.estoque_movimentar em cada linha; qualquer erro desfaz tudo (diz a linha).
create or replace function orders.estoque_movimentar_lote(p jsonb, p_user uuid, p_email text, p_admin boolean) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare l platform.estoque_mov_lote; t platform.estoque_mov_tipo; x jsonb; i int := 0; m jsonb; v_mot text; q numeric := 0; v numeric := 0;
begin
  if jsonb_typeof(p->'linhas') <> 'array' or jsonb_array_length(p->'linhas') = 0 then raise exception 'Adicione pelo menos um item'; end if;
  if jsonb_array_length(p->'linhas') > 500 then raise exception 'No máximo 500 linhas por lote'; end if;
  select * into t from platform.estoque_mov_tipo where id = (p->>'tipo_id')::bigint and ativo;
  if not found then raise exception 'Tipo de movimentação inválido ou inativo'; end if;
  v_mot := nullif(trim(coalesce(p->>'motivo', '')), '');
  if nullif(p->>'motivo_id', '') is not null then
    select nome into v_mot from platform.estoque_mov_motivo where id = (p->>'motivo_id')::bigint and tipo_id = t.id and ativo;
  end if;
  if v_mot is null then raise exception 'Escolha ou escreva a justificativa'; end if;
  insert into platform.estoque_mov_lote (empresa, tipo_id, solicitante_nome, cliente, projeto, pv_os, pc_numero, motivo, obs, status, created_by, created_by_email)
  values ('SF', t.id, coalesce(nullif(trim(p->>'solicitante_nome'), ''), '?'), nullif(trim(coalesce(p->>'cliente', '')), ''), nullif(trim(coalesce(p->>'projeto', '')), ''),
          nullif(trim(coalesce(p->>'pv_os', '')), ''), nullif(trim(coalesce(p->>'pc_numero', '')), ''), v_mot, nullif(trim(coalesce(p->>'obs', '')), ''),
          'aplicado', p_user, p_email)
  returning * into l;
  for x in select * from jsonb_array_elements(p->'linhas') loop
    i := i + 1;
    begin
      m := orders.estoque_movimentar(
        (p - 'linhas' - 'motivo_id') || jsonb_build_object('motivo', v_mot, 'n_cod_prod', x->'n_cod_prod', 'quantidade', x->'quantidade',
          'local_origem', coalesce(x->>'local_origem', p->>'local_origem'), 'local_destino', coalesce(x->>'local_destino', p->>'local_destino'),
          'obs', concat_ws(' · ', nullif(trim(coalesce(p->>'obs', '')), ''), nullif(trim(coalesce(x->>'obs', '')), ''))),
        p_user, p_email, p_admin);
    exception when others then
      raise exception 'Linha %: %', i, sqlerrm;
    end;
    update platform.estoque_movimento set lote_id = l.id where id = (m->>'id')::bigint;
    q := q + (m->>'quantidade')::numeric; v := v + abs((m->>'quantidade')::numeric * (m->>'cmc')::numeric);
    if i = 1 then update platform.estoque_mov_lote set status = m->>'status' where id = l.id; end if;
  end loop;
  update platform.estoque_mov_lote set n_linhas = i, quantidade = q, valor = round(v, 2) where id = l.id returning * into l;
  return to_jsonb(l);
end
$fn$;

-- Aprovar / rejeitar / cancelar o lote inteiro (administrador, checado na rota).
create or replace function orders.estoque_mov_decidir_lote(p_lote bigint, p_acao text, p_obs text, p_email text) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare l platform.estoque_mov_lote; r record; n int := 0;
begin
  select * into l from platform.estoque_mov_lote where id = p_lote for update;
  if not found then raise exception 'Lote não encontrado'; end if;
  for r in select id from platform.estoque_movimento where lote_id = p_lote
             and status = case when p_acao in ('aprovar', 'rejeitar') then 'pendente' else status end
             and status in ('aplicado', 'pendente') loop
    perform orders.estoque_mov_decidir(r.id, p_acao, p_obs, p_email);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nada a decidir neste lote'; end if;
  update platform.estoque_mov_lote set status = case p_acao when 'aprovar' then 'aplicado' when 'rejeitar' then 'rejeitado' else 'cancelado' end
   where id = p_lote returning * into l;
  return to_jsonb(l) || jsonb_build_object('linhas', n);
end
$fn$;

-- Autocompletar para a "Nova movimentação": cliente (razão/fantasia + CNPJ), projeto (código + nome + cliente
-- sugerido), PV/OS em aberto (com cliente e projeto) e PCs. Busca sem acento e sem diferença de maiúsculas.
create or replace function orders.fn_sem_acento(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
$$;

create or replace function orders.estoque_autocompletar(p_tipo text, p_q text, p_empresa text default 'SF') returns jsonb
language plpgsql stable security definer set search_path = orders, public as $fn$
declare q text := '%' || orders.fn_sem_acento(trim(coalesce(p_q, ''))) || '%'; r jsonb;
begin
  if p_tipo = 'cliente' then
    select coalesce(jsonb_agg(x), '[]') into r from (
      select c.codigo_cliente_omie as id, c.razao_social, c.nome_fantasia, c.cnpj_cpf, c.cidade, c.estado
      from finance.clientes c
      where c.empresa = p_empresa and coalesce(c.inativo, 'N') <> 'S'
        and orders.fn_sem_acento(concat_ws(' ', c.razao_social, c.nome_fantasia, c.cnpj_cpf, regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g'))) like q
      order by (orders.fn_sem_acento(c.nome_fantasia) like q) desc, c.nome_fantasia nulls last, c.razao_social limit 15) x;
  elsif p_tipo = 'projeto' then
    select coalesce(jsonb_agg(x), '[]') into r from (
      select pj.codigo as id, pj.nome,
             (select coalesce(c.nome_fantasia, c.razao_social) from (
                select pv.codigo_cliente::text as cli from sales.pedidos_venda pv where pv.empresa = p_empresa and pv.codigo_projeto = pj.codigo::text
                union all
                select os.codigo_cliente from sales.ordens_servico os where os.empresa = p_empresa and os.codigo_projeto = pj.codigo::text
              ) u join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie::text = u.cli
              group by 1 order by count(*) desc limit 1) as cliente
      from finance.projetos pj
      where pj.empresa = p_empresa and coalesce(pj.inativo, 'N') <> 'S' and orders.fn_sem_acento(pj.nome) like q
      order by pj.nome limit 15) x;
  elsif p_tipo = 'pvos' then
    select coalesce(jsonb_agg(x), '[]') into r from (
      select * from (
        select 'PV ' || pv.numero_pedido as rotulo, 'PV' as tipo, pv.numero_pedido as numero, pv.etapa,
               coalesce(c.nome_fantasia, c.razao_social) as cliente, pj.nome as projeto, pv.valor_total as valor
        from sales.pedidos_venda pv
        left join finance.clientes c on c.empresa = pv.empresa and c.codigo_cliente_omie = pv.codigo_cliente
        left join finance.projetos pj on pj.empresa = pv.empresa and pj.codigo::text = pv.codigo_projeto
        where pv.empresa = p_empresa and pv.etapa in ('10', '20', '50')
          and orders.fn_sem_acento(concat_ws(' ', 'pv', pv.numero_pedido, c.razao_social, c.nome_fantasia, pj.nome)) like q
        union all
        select distinct on (os.numero_os) 'OS ' || os.numero_os, 'OS', os.numero_os, os.etapa,
               coalesce(c.nome_fantasia, c.razao_social), pj.nome, os.valor_total
        from sales.ordens_servico os
        left join finance.clientes c on c.empresa = os.empresa and c.codigo_cliente_omie::text = os.codigo_cliente
        left join finance.projetos pj on pj.empresa = os.empresa and pj.codigo::text = os.codigo_projeto
        where os.empresa = p_empresa and coalesce(os.faturada, 'N') <> 'S' and coalesce(os.cancelada, 'N') <> 'S'
          and orders.fn_sem_acento(concat_ws(' ', 'os', os.numero_os, c.razao_social, c.nome_fantasia, pj.nome)) like q
      ) y order by numero desc limit 15) x;
  elsif p_tipo = 'pc' then
    select coalesce(jsonb_agg(x), '[]') into r from (
      select p.numero, p.fornecedor_nome as fornecedor, p.emissao, p.projeto_nome as projeto
      from compras.pedidos p
      where p.empresa = p_empresa and p.tipo = 'PC' and not coalesce(p.cancelado, false)
        and orders.fn_sem_acento(concat_ws(' ', p.numero, p.fornecedor_nome)) like q
      order by p.emissao desc nulls last limit 15) x;
  else
    raise exception 'tipo inválido';
  end if;
  return r;
end
$fn$;

revoke all on function orders.estoque_movimentar_lote(jsonb, uuid, text, boolean), orders.estoque_mov_decidir_lote(bigint, text, text, text),
  orders.estoque_autocompletar(text, text, text) from public, anon, authenticated;
grant execute on function orders.estoque_movimentar_lote(jsonb, uuid, text, boolean), orders.estoque_mov_decidir_lote(bigint, text, text, text),
  orders.estoque_autocompletar(text, text, text) to service_role;
