-- Estoque v2 (02/10/26) — movimentações do painel (nunca vão ao Omie).
-- Saldo continua = Omie + painel, calculado só em orders.v_estoque_saldo_local: o "ajuste" de lá passa a
-- somar os ajustes de inventário/mesclagem E as movimentações manuais aplicadas.
--   Tipos configuráveis (platform.estoque_mov_tipo): sentido entra | sai | transfere; origem
--     omie (só rótulo: entradas/saídas por NF vêm do Omie), inventario (fluxo da senha de inventário), manual.
--   Justificativas por tipo (platform.estoque_mov_motivo).
--   Movimento (platform.estoque_movimento): solicitante, cliente, projeto, PV/OS, PC, locais, quantidade,
--     motivo + obs, quem registrou. Tipos que exigem aprovação ficam "pendente" até o administrador aprovar.

create table if not exists platform.estoque_mov_tipo (
  id bigserial primary key,
  empresa text not null default 'SF',
  codigo text not null,
  nome text not null,
  sentido text not null check (sentido in ('entra', 'sai', 'transfere')),
  origem text not null default 'manual' check (origem in ('manual', 'omie', 'inventario')),
  exige_aprovacao boolean not null default false,
  exige_cliente_ou_projeto boolean not null default false,
  exige_pc boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 100,
  descricao text,
  updated_by_email text, updated_at timestamptz not null default now(),
  unique (empresa, codigo)
);
create table if not exists platform.estoque_mov_motivo (
  id bigserial primary key,
  tipo_id bigint not null references platform.estoque_mov_tipo (id),
  nome text not null,
  ativo boolean not null default true,
  ordem int not null default 100,
  unique (tipo_id, nome)
);
create table if not exists platform.estoque_movimento (
  id bigserial primary key,
  empresa text not null,
  tipo_id bigint not null references platform.estoque_mov_tipo (id),
  n_cod_prod bigint not null,
  quantidade numeric not null check (quantidade > 0),
  local_origem bigint, local_destino bigint,
  solicitante_user uuid, solicitante_nome text not null,
  cliente text, projeto text, pv_os text, pc_numero text,
  motivo_id bigint references platform.estoque_mov_motivo (id), motivo text not null, obs text,
  status text not null check (status in ('aplicado', 'pendente', 'rejeitado', 'cancelado')),
  cmc numeric not null default 0, valor numeric not null default 0,
  aprovado_por_email text, aprovado_em timestamptz, decisao_obs text,
  cancelado_por_email text, cancelado_em timestamptz,
  created_by uuid, created_by_email text, created_at timestamptz not null default now()
);
create index if not exists estoque_movimento_item on platform.estoque_movimento (empresa, n_cod_prod) where status = 'aplicado';
create index if not exists estoque_movimento_data on platform.estoque_movimento (empresa, created_at desc);
create index if not exists estoque_movimento_pend on platform.estoque_movimento (status) where status = 'pendente';
alter table platform.estoque_mov_tipo enable row level security;
alter table platform.estoque_mov_motivo enable row level security;
alter table platform.estoque_movimento enable row level security;
grant usage, select on sequence platform.estoque_mov_tipo_id_seq, platform.estoque_mov_motivo_id_seq, platform.estoque_movimento_id_seq to service_role;

-- Tipos e justificativas iniciais (ajustáveis no "Configurar").
insert into platform.estoque_mov_tipo (codigo, nome, sentido, origem, exige_aprovacao, exige_cliente_ou_projeto, exige_pc, ordem, descricao) values
  ('nf_compra',     'Entrada por NF de compra',         'entra',     'omie',       false, false, false, 10, 'Automática: vem do Omie quando a NF de compra é conferida/lançada.'),
  ('nf_venda',      'Saída por NF de venda/remessa',    'sai',       'omie',       false, false, false, 20, 'Automática: vem do Omie (venda, remessa, devolução).'),
  ('saida_obra',    'Saída para obra/projeto',          'sai',       'manual',     false, true,  false, 30, 'Material que sai do estoque para uma obra ou projeto.'),
  ('retorno_obra',  'Retorno de obra',                  'entra',     'manual',     false, true,  false, 40, 'Sobra ou material não usado que volta da obra.'),
  ('transferencia', 'Transferência entre locais',       'transfere', 'manual',     false, false, false, 50, 'Muda o material de um local para outro; o total não muda.'),
  ('consumo',       'Consumo interno',                  'sai',       'manual',     false, false, false, 60, 'Uso da própria empresa (oficina, testes, laboratório).'),
  ('perda',         'Perda / avaria / descarte',        'sai',       'manual',     true,  false, false, 70, 'Precisa da aprovação do administrador antes de baixar o saldo.'),
  ('dev_fornecedor','Devolução ao fornecedor',          'sai',       'manual',     false, false, true,  80, 'Material devolvido ao fornecedor — informe o PC.'),
  ('inventario',    'Ajuste de inventário',             'transfere', 'inventario', false, false, false, 90, 'Só com a senha de uma janela de inventário (aba Inventário).')
on conflict (empresa, codigo) do nothing;
insert into platform.estoque_mov_motivo (tipo_id, nome, ordem)
select t.id, m.nome, m.ordem from platform.estoque_mov_tipo t
join (values
  ('saida_obra', 'Instalação', 1), ('saida_obra', 'Manutenção', 2), ('saida_obra', 'Garantia', 3), ('saida_obra', 'Contrato de serviço', 4),
  ('retorno_obra', 'Sobra de obra', 1), ('retorno_obra', 'Material não usado', 2), ('retorno_obra', 'Troca na obra', 3),
  ('transferencia', 'Reposição do local', 1), ('transferencia', 'Organização do estoque', 2), ('transferencia', 'Separação para obra', 3),
  ('consumo', 'Uso na oficina', 1), ('consumo', 'Teste / laboratório', 2), ('consumo', 'Amostra', 3),
  ('perda', 'Avaria', 1), ('perda', 'Vencido', 2), ('perda', 'Extravio', 3), ('perda', 'Descarte', 4),
  ('dev_fornecedor', 'Defeito', 1), ('dev_fornecedor', 'Pedido errado', 2), ('dev_fornecedor', 'Excesso', 3)
) m (codigo, nome, ordem) on m.codigo = t.codigo and t.empresa = 'SF'
on conflict (tipo_id, nome) do nothing;

-- Efeito de cada movimento aplicado no saldo, por local (transferência: sai da origem, entra no destino).
create or replace view orders.v_estoque_mov_efeito as
select m.empresa, m.n_cod_prod, m.local_origem as codigo_local_estoque, -m.quantidade as delta, m.id as mov_id
from platform.estoque_movimento m join platform.estoque_mov_tipo t on t.id = m.tipo_id
where m.status = 'aplicado' and t.sentido in ('sai', 'transfere') and m.local_origem is not null
union all
select m.empresa, m.n_cod_prod, m.local_destino, m.quantidade, m.id
from platform.estoque_movimento m join platform.estoque_mov_tipo t on t.id = m.tipo_id
where m.status = 'aplicado' and t.sentido in ('entra', 'transfere') and m.local_destino is not null;
revoke all on orders.v_estoque_mov_efeito from anon, authenticated;

-- Registrar uma movimentação manual (validações aqui, não só na tela).
create or replace function orders.estoque_movimentar(p jsonb, p_user uuid, p_email text, p_admin boolean) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare t platform.estoque_mov_tipo; m platform.estoque_movimento; v_q numeric := (p->>'quantidade')::numeric;
        v_prod bigint := (p->>'n_cod_prod')::bigint; v_or bigint := nullif(p->>'local_origem', '')::bigint; v_de bigint := nullif(p->>'local_destino', '')::bigint;
        v_mot text := nullif(trim(coalesce(p->>'motivo', '')), ''); v_motid bigint := nullif(p->>'motivo_id', '')::bigint;
        v_sol text := nullif(trim(coalesce(p->>'solicitante_nome', '')), ''); v_cmc numeric; v_status text;
begin
  select * into t from platform.estoque_mov_tipo where id = (p->>'tipo_id')::bigint and ativo;
  if not found then raise exception 'Tipo de movimentação inválido ou inativo'; end if;
  if t.origem = 'omie' then raise exception '"%" é automática (vem do Omie) — não se lança à mão', t.nome; end if;
  if t.origem = 'inventario' then raise exception 'Ajuste de inventário só pela aba Inventário, com a senha da janela'; end if;
  if v_q is null or v_q <= 0 then raise exception 'Informe uma quantidade maior que zero'; end if;
  if not exists (select 1 from orders.v_estoque_saldo_local where n_cod_prod = v_prod) then raise exception 'Item não encontrado no estoque'; end if;
  if exists (select 1 from orders.v_estoque_mescla_dono where secundario = v_prod) then raise exception 'Este código foi mesclado — movimente o código principal'; end if;
  if t.sentido in ('sai', 'transfere') and v_or is null then raise exception 'Escolha o local de origem'; end if;
  if t.sentido in ('entra', 'transfere') and v_de is null then raise exception 'Escolha o local de destino'; end if;
  if t.sentido = 'transfere' and v_or = v_de then raise exception 'Origem e destino precisam ser locais diferentes'; end if;
  if t.sentido = 'sai' then v_de := null; end if;
  if t.sentido = 'entra' then v_or := null; end if;
  if v_sol is null then raise exception 'Informe quem pediu o material (solicitante)'; end if;
  if t.exige_cliente_ou_projeto and nullif(trim(coalesce(p->>'cliente', '')), '') is null and nullif(trim(coalesce(p->>'projeto', '')), '') is null then
    raise exception '"%" exige cliente ou projeto', t.nome;
  end if;
  if t.exige_pc and nullif(trim(coalesce(p->>'pc_numero', '')), '') is null then raise exception '"%" exige o número do PC', t.nome; end if;
  if v_motid is not null then
    select nome into v_mot from platform.estoque_mov_motivo where id = v_motid and tipo_id = t.id and ativo;
    if not found then raise exception 'Justificativa inválida para este tipo'; end if;
  end if;
  if v_mot is null then raise exception 'Escolha ou escreva a justificativa'; end if;
  select coalesce(nullif(max(cmc) filter (where codigo_local_estoque = coalesce(v_or, v_de)), 0), max(cmc), 0) into v_cmc
    from orders.v_estoque_saldo_local where n_cod_prod = v_prod;
  v_status := case when t.exige_aprovacao and not p_admin then 'pendente' else 'aplicado' end;
  insert into platform.estoque_movimento (empresa, tipo_id, n_cod_prod, quantidade, local_origem, local_destino, solicitante_user, solicitante_nome,
    cliente, projeto, pv_os, pc_numero, motivo_id, motivo, obs, status, cmc, valor, aprovado_por_email, aprovado_em, created_by, created_by_email)
  values (coalesce(p->>'empresa', 'SF'), t.id, v_prod, v_q, v_or, v_de, nullif(p->>'solicitante_user', '')::uuid, v_sol,
    nullif(trim(coalesce(p->>'cliente', '')), ''), nullif(trim(coalesce(p->>'projeto', '')), ''), nullif(trim(coalesce(p->>'pv_os', '')), ''),
    nullif(trim(coalesce(p->>'pc_numero', '')), ''), v_motid, v_mot, nullif(trim(coalesce(p->>'obs', '')), ''), v_status,
    v_cmc, round(v_q * v_cmc * case t.sentido when 'sai' then -1 when 'entra' then 1 else 0 end, 2),
    case when t.exige_aprovacao and p_admin then p_email end, case when t.exige_aprovacao and p_admin then now() end, p_user, p_email)
  returning * into m;
  return to_jsonb(m);
end
$fn$;

-- Aprovar / rejeitar (perda, avaria…) e cancelar um movimento aplicado (o saldo volta). Só administrador (checado na rota).
create or replace function orders.estoque_mov_decidir(p_id bigint, p_acao text, p_obs text, p_email text) returns jsonb
language plpgsql security definer set search_path = platform, public as $fn$
declare m platform.estoque_movimento;
begin
  select * into m from platform.estoque_movimento where id = p_id for update;
  if not found then raise exception 'Movimentação não encontrada'; end if;
  if p_acao in ('aprovar', 'rejeitar') then
    if m.status <> 'pendente' then raise exception 'Esta movimentação não está aguardando aprovação'; end if;
    update platform.estoque_movimento set status = case p_acao when 'aprovar' then 'aplicado' else 'rejeitado' end,
      aprovado_por_email = p_email, aprovado_em = now(), decisao_obs = nullif(trim(coalesce(p_obs, '')), '') where id = p_id returning * into m;
  elsif p_acao = 'cancelar' then
    if m.status not in ('aplicado', 'pendente') then raise exception 'Só dá para cancelar uma movimentação aplicada ou pendente'; end if;
    update platform.estoque_movimento set status = 'cancelado', cancelado_por_email = p_email, cancelado_em = now(),
      decisao_obs = nullif(trim(coalesce(p_obs, '')), '') where id = p_id returning * into m;
  else raise exception 'Ação inválida'; end if;
  return to_jsonb(m);
end
$fn$;
revoke all on function orders.estoque_movimentar(jsonb, uuid, text, boolean), orders.estoque_mov_decidir(bigint, text, text, text) from public, anon, authenticated;
grant execute on function orders.estoque_movimentar(jsonb, uuid, text, boolean), orders.estoque_mov_decidir(bigint, text, text, text) to service_role;

-- Saldo: "ajuste" = ajustes de inventário/mesclagem + movimentações manuais aplicadas.
create or replace view orders.v_estoque_saldo_local as
with aj as (
  select empresa, n_cod_prod, codigo_local_estoque, sum(d) as ajuste
  from (
    select empresa, n_cod_prod, codigo_local_estoque, diferenca as d from platform.estoque_ajuste where status = 'aplicado'
    union all
    select empresa, n_cod_prod, codigo_local_estoque, delta from orders.v_estoque_mov_efeito
  ) x
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
-- Itens do painel ainda sem posição no Omie: um local (o padrão) + locais que tenham ajuste/movimento.
select c.empresa, c.n_cod_prod, l.loc, null::text, null::text,
       0, coalesce(aj.ajuste, 0), coalesce(aj.ajuste, 0), 0, 0, 0, coalesce(c.preco_ref, 0), coalesce(c.minimo, 0), current_date
from cad c
cross join lateral (select c.codigo_local_estoque as loc
                    union select a.codigo_local_estoque from aj a where a.empresa = c.empresa and a.n_cod_prod = c.n_cod_prod) l
left join aj on aj.empresa = c.empresa and aj.n_cod_prod = c.n_cod_prod and aj.codigo_local_estoque = l.loc;
revoke all on orders.v_estoque_saldo_local from anon, authenticated;
