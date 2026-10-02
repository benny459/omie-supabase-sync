-- Estoque v2 (02/10/26) — 2ª passada da revisão de famílias com IA (Claude, mesma chave do Cesar).
-- Todo item fica com uma sugestão (nada de "sem sugestão"). Cache por item + descrição: "Recalcular sugestões"
-- reaplica sem pagar de novo; só itens novos/alterados vão à IA. Nunca aplica sozinho.
-- Confiança da IA vai no máximo a "média" (0,79) — só sobe até "alta" quando o NCM ou os vizinhos concordam.

alter table platform.estoque_familia_sugestao add column if not exists fonte text not null default 'regra';
create table if not exists platform.estoque_familia_ia (
  empresa text not null, n_cod_prod bigint not null,
  descricao text not null,                 -- descrição usada (se mudar, a IA classifica de novo)
  familia_id bigint references platform.estoque_familia (id),
  confianca_ia int,                        -- 0–100, como a IA respondeu
  confianca numeric,                       -- depois do teto/concordância (0–0,99)
  motivo text, proposta_nova text,         -- proposta_nova: família que a IA acha que falta (ex.: "MEIOS FILTRANTES")
  concorda text,                           -- "ncm" | "vizinhos" | "ncm+vizinhos" | null
  modelo text, created_at timestamptz not null default now(),
  primary key (empresa, n_cod_prod)
);
alter table platform.estoque_familia_ia enable row level security;

-- Contexto para a IA: os 3 vizinhos mais parecidos (em famílias de material) e a família da maioria do NCM (4 dígitos).
create or replace function orders.estoque_ia_contexto(p_empresa text, p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = orders, platform, public as $fn$
declare r jsonb;
begin
  create temp table _ref on commit drop as
    select v.n_cod_prod, v.descricao, lower(orders.fn_norm_desc(v.descricao)) as norm, f.id as familia_id, f.nome as familia,
           left(regexp_replace(coalesce(v.ncm, ''), '\D', '', 'g'), 4) as ncm4
    from orders.v_estoque_item v join platform.estoque_familia f on f.id = v.familia_id
    where v.empresa = p_empresa and f.material and f.ativo and not f.sistema and v.mesclado_em is null;
  create index on _ref using gist (norm gist_trgm_ops);
  analyze _ref;
  create temp table _ncm on commit drop as
    select distinct on (ncm4) ncm4, familia_id, familia, n, tot from (
      select ncm4, familia_id, familia, count(*) n, sum(count(*)) over (partition by ncm4) tot from _ref where length(ncm4) = 4 group by 1, 2, 3
    ) x order by ncm4, n desc;
  select coalesce(jsonb_agg(jsonb_build_object(
           'n_cod_prod', i.n_cod_prod, 'codigo', coalesce(i.codigo_novo, i.codigo), 'descricao', i.descricao, 'ncm', i.ncm, 'unidade', i.unidade,
           'familia_atual', i.familia,
           'ncm_familia_id', nc.familia_id, 'ncm_familia', nc.familia, 'ncm_fatia', round(nc.n::numeric / nullif(nc.tot, 0), 2),
           'vizinhos', (select coalesce(jsonb_agg(jsonb_build_object('descricao', z.descricao, 'familia', z.familia, 'familia_id', z.familia_id, 'sim', round(similarity(z.norm, lower(orders.fn_norm_desc(i.descricao)))::numeric, 2))), '[]')
                        from (select * from _ref r where r.n_cod_prod <> i.n_cod_prod order by r.norm <-> lower(orders.fn_norm_desc(i.descricao)) limit 3) z)
         )), '[]') into r
  from orders.v_estoque_item i
  left join _ncm nc on nc.ncm4 = left(regexp_replace(coalesce(i.ncm, ''), '\D', '', 'g'), 4)
  where i.empresa = p_empresa and i.n_cod_prod = any (p_ids);
  return r;
end
$fn$;

-- Mesmo contexto para um texto (formulário "Novo item": ainda não existe item).
create or replace function orders.estoque_ia_contexto_texto(p_empresa text, p_descricao text, p_ncm text) returns jsonb
language sql stable security definer set search_path = orders, platform, public as $$
  with ref as (
    select v.descricao, lower(orders.fn_norm_desc(v.descricao)) as norm, f.id as familia_id, f.nome as familia,
           left(regexp_replace(coalesce(v.ncm, ''), '\D', '', 'g'), 4) as ncm4
    from orders.v_estoque_item v join platform.estoque_familia f on f.id = v.familia_id
    where v.empresa = p_empresa and f.material and f.ativo and not f.sistema and v.mesclado_em is null
  ), nc as (
    select familia_id, familia, count(*) n, sum(count(*)) over () tot from ref
    where ncm4 = left(regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g'), 4) and length(ncm4) = 4 group by 1, 2 order by 3 desc limit 1
  )
  select jsonb_build_object('n_cod_prod', 0, 'codigo', 'novo', 'descricao', p_descricao, 'ncm', p_ncm,
    'ncm_familia_id', (select familia_id from nc), 'ncm_familia', (select familia from nc), 'ncm_fatia', (select round(n::numeric / nullif(tot, 0), 2) from nc),
    'vizinhos', (select coalesce(jsonb_agg(jsonb_build_object('descricao', z.descricao, 'familia', z.familia, 'familia_id', z.familia_id)), '[]')
                 from (select * from ref order by similarity(norm, lower(orders.fn_norm_desc(p_descricao))) desc limit 3) z))
$$;

-- Famílias de material ativas com até 5 exemplos (a "definição" que vai para a IA).
create or replace function orders.estoque_ia_familias(p_empresa text) returns jsonb
language sql stable security definer set search_path = orders, platform, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'prefixo', f.prefixo, 'descricao', f.descricao,
           'exemplos', (select coalesce(jsonb_agg(x.descricao), '[]') from (
                          select v.descricao from orders.v_estoque_item v where v.empresa = f.empresa and v.familia_id = f.id and v.mesclado_em is null
                          order by v.n_mov desc nulls last limit 5) x)) order by f.nome), '[]')
  from platform.estoque_familia f
  where f.empresa = p_empresa and f.ativo and f.material and not f.sistema
$$;

revoke all on function orders.estoque_ia_contexto(text, bigint[]), orders.estoque_ia_contexto_texto(text, text, text), orders.estoque_ia_familias(text)
  from public, anon, authenticated;
grant execute on function orders.estoque_ia_contexto(text, bigint[]), orders.estoque_ia_contexto_texto(text, text, text), orders.estoque_ia_familias(text) to service_role;
