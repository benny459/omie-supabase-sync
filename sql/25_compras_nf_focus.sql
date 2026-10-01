-- 25 — NF de entrada chegando pela Focus NFe → pedido de compra (01/10/2026).
--
-- orders.focus_recebidos (scripts/import_focus_recebidos.py) traz as NF-e
-- emitidas contra os nossos CNPJs. Aqui cada NF-e vira CANDIDATA a um pedido
-- de compra; quem confirma é a pessoa, na folha de recebimento ("NF chegou
-- pela Focus") — nada avança sozinho.
--
-- Como casa, em ordem de confiança:
--   1. xPed: o número do nosso pedido que o fornecedor pôs no item da NF
--      (pedido_compra no JSON completo — só existe depois da ciência). Aceita
--      "7167/7172/7178/" (vários pedidos) e os nossos "P0001".
--   2. Texto: "Pedido de Compra Nº 7094" / "PC 7094" nas informações
--      adicionais da NF.
--   3. Resumo (funciona sem o XML completo): CNPJ do emitente = fornecedor do
--      pedido, pedido ainda não recebido, incluído até 120 dias antes da NF,
--      pontuado pela diferença de valor.
-- Idempotente: (chave, pedido) é a chave; decisões (confirmado/descartado)
-- nunca são desfeitas por uma nova rodada.

create table if not exists compras.nf_vinculos (
  chave         text not null,
  pedido_id     bigint not null references compras.pedidos (id) on delete cascade,
  origem        text not null check (origem in ('xped', 'texto', 'resumo')),
  score         numeric not null default 0,
  motivo        text,
  status        text not null default 'sugerido' check (status in ('sugerido', 'confirmado', 'descartado')),
  decidido_por  text,
  decidido_em   timestamptz,
  created_at    timestamptz not null default now(),
  primary key (chave, pedido_id)
);
create index if not exists nf_vinculos_pedido_idx on compras.nf_vinculos (pedido_id) where status <> 'descartado';
alter table compras.nf_vinculos enable row level security;
grant all on compras.nf_vinculos to service_role;

create or replace function compras.casar_nfs_focus()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare n_ref int := 0; n_res int := 0;
begin
  -- NF-e autorizadas, com os números de pedido citados (itens + texto).
  create temp table _nf on commit drop as
  select f.chave, f.empresa, regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g') as cnpj_emit,
         f.emitente_nome, f.valor, f.emissao::date as emissao, f.numero,
         (select array_agg(distinct upper(t))
            from (select (regexp_matches(coalesce(i->>'pedido_compra', ''), '(P\d{4,}|\d{3,})', 'gi'))[1] as t
                    from jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) i) z
           where t is not null) as refs_item,
         (select array_agg(distinct upper(m[2]))
            from regexp_matches(coalesce(f.detalhe->'requisicao_nota_fiscal'->>'informacoes_adicionais_contribuinte', ''),
                                '(pedido de compra|pedido|ped\.?|pc)\s*(?:n[º°o.]*\s*)?[:#-]?\s*(P\d{4,}|\d{3,})', 'gi') as m) as refs_texto
    from orders.focus_recebidos f
   where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada');

  -- 1 e 2: referência explícita ao número do pedido.
  with ref as (
    select n.chave, 'xped'::text as origem, r as numero from _nf n, unnest(n.refs_item) r
    union
    select n.chave, 'texto', r from _nf n, unnest(n.refs_texto) r
  ), cand as (
    select distinct on (ref.chave, p.id) ref.chave, p.id as pedido_id, ref.origem,
           case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit then 1.0 else 0.7 end as score,
           case when ref.origem = 'xped' then 'Pedido citado no item da NF' else 'Pedido citado nas informações da NF' end
             || case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                     then ' · mesmo fornecedor' else ' · fornecedor diferente do pedido' end as motivo
      from ref join _nf n on n.chave = ref.chave
      join compras.pedidos p on p.empresa = n.empresa and upper(p.numero) = ref.numero and p.tipo = 'PC' and not p.cancelado
     order by ref.chave, p.id, ref.origem desc
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, origem, score, motivo from cand
  on conflict (chave, pedido_id) do update set
    origem = excluded.origem, score = greatest(compras.nf_vinculos.score, excluded.score), motivo = excluded.motivo
  where compras.nf_vinculos.status = 'sugerido';
  get diagnostics n_ref = row_count;

  -- 3: sem referência, pelo resumo (fornecedor + valor + data) — só para
  -- pedidos ainda não recebidos e NF que não casou por referência.
  with cand as (
    select n.chave, p.id as pedido_id,
           round(greatest(0.2, 0.9 - least(1, abs(p.valor_total - n.valor) / nullif(n.valor, 0)) * 2), 2) as score,
           'Mesmo fornecedor · valor ' ||
             case when abs(p.valor_total - n.valor) <= 0.05 then 'igual'
                  else to_char(abs(p.valor_total - n.valor) / nullif(n.valor, 0) * 100, 'FM990D0') || '% diferente' end
             || ' · pedido de ' || to_char(p.emissao, 'DD/MM/YY') as motivo,
           row_number() over (partition by n.chave order by abs(p.valor_total - n.valor), p.emissao desc) as rk
      from _nf n
      join compras.pedidos p on p.empresa = n.empresa and p.tipo = 'PC' and not p.cancelado and not p.omie_ausente
                            and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                            and p.etapa in ('10', '15', '40') and p.nf is null
                            and p.emissao between n.emissao - 120 and n.emissao + 5
     where not exists (select 1 from compras.nf_vinculos v where v.chave = n.chave and v.origem <> 'resumo')
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, 'resumo', score, motivo from cand where rk <= 5
  on conflict (chave, pedido_id) do nothing;
  get diagnostics n_res = row_count;

  return jsonb_build_object('nfs', (select count(*) from _nf), 'por_referencia', n_ref, 'por_resumo', n_res);
end $$;

-- NF-e candidatas de um pedido (folha de recebimento) — com os itens da NF
-- quando o XML completo existe.
create or replace function orders.compras_nfs_do_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', v.chave, 'origem', v.origem, 'score', v.score, 'motivo', v.motivo, 'status', v.status,
           'numero', f.numero, 'emissao', f.emissao, 'valor', f.valor, 'emitente', f.emitente_nome,
           'cnpj', f.emitente_doc, 'situacao', f.situacao, 'completa', f.completa,
           'outrosPedidos', (select coalesce(jsonb_agg(p2.numero), '[]'::jsonb) from compras.nf_vinculos v2
                               join compras.pedidos p2 on p2.id = v2.pedido_id
                              where v2.chave = v.chave and v2.pedido_id <> v.pedido_id and v2.status <> 'descartado'),
           'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                        'n', i->>'numero_item', 'cod', i->>'codigo_produto', 'desc', i->>'descricao',
                        'ncm', i->>'codigo_ncm', 'un', i->>'unidade_comercial',
                        'qtd', (i->>'quantidade_comercial')::numeric, 'vu', (i->>'valor_unitario_comercial')::numeric,
                        'total', (i->>'valor_bruto')::numeric, 'xped', i->>'pedido_compra')), '[]'::jsonb)
                       from jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) i)
         ) order by (v.status = 'confirmado') desc, v.score desc, f.emissao desc), '[]'::jsonb)
    from compras.nf_vinculos v
    join orders.focus_recebidos f on f.tipo = 'nfe' and f.chave = v.chave
   where v.pedido_id = p_id and v.status <> 'descartado'
$$;

-- Confirmar ou descartar uma candidata. Confirmar NÃO move a etapa sozinho:
-- a folha chama compras_receber com o número e a chave da NF.
create or replace function orders.compras_nf_decidir(p_chave text, p_pedido bigint, p_status text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
begin
  if p_status not in ('confirmado', 'descartado', 'sugerido') then raise exception 'status inválido'; end if;
  update compras.nf_vinculos set status = p_status, decidido_por = p_por, decidido_em = now()
   where chave = p_chave and pedido_id = p_pedido;
  if not found then raise exception 'Vínculo não existe'; end if;
  perform compras.add_hist(p_pedido, case p_status when 'confirmado' then 'NF-e ' || right(p_chave, 9) || ' (Focus) confirmada'
                                                    when 'descartado' then 'NF-e ' || right(p_chave, 9) || ' (Focus) descartada'
                                                    else 'NF-e ' || right(p_chave, 9) || ' (Focus) volta a sugerida' end, p_por);
  return jsonb_build_object('ok', true);
end $$;

create or replace function orders.compras_casar_nfs()
returns jsonb language sql security definer set search_path = compras, public as $$
  select compras.casar_nfs_focus()
$$;

-- Resumo por pedido para a lista (Kanban/Tabela): quantas NF sugeridas.
create or replace function orders.compras_nfs_sugeridas()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  -- só pedidos que ainda esperam NF (não recebidos e sem essa chave já lançada)
  select coalesce(jsonb_object_agg(pedido_id, n), '{}'::jsonb)
    from (select v.pedido_id, count(*) n
            from compras.nf_vinculos v join compras.pedidos p on p.id = v.pedido_id
           where v.status = 'sugerido' and p.etapa in ('10', '15', '40') and not p.cancelado
             and p.chave_nfe is distinct from v.chave
           group by 1) z
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or (n.nspname = 'compras') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
