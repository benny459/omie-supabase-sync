-- 06/10/26 — Aprovação automática de PCs avulsos pelo Agente IA.
-- Pedido do Benny: PC de Vendas avulsas (últimos 30 dias), pendente de
-- aprovação, com valor ≤ ao da RC que atende e condição de pagamento FATURADA
-- (prazo depois da NF) é aprovado sem passar pelo aprovador. Quem aprova fica
-- registrado como "Agente IA". Fonte única da regra: esta função — a rota, o
-- cron diário e o Cesar só chamam orders.compras_auto_aprov_candidatos.

-- Condição "faturada": paga depois do faturamento, todos os prazos ≥ 1 dia.
--   "Para N dia(s)" (N ≥ 1, com ou sem "(C)") e sequências "a/b/c" (todas ≥ 1).
--   NÃO: "A Vista…", "N Parcelas" (sem prazo), "Informar…", "0", vazio.
create or replace function compras.condicao_faturada(p_desc text)
returns boolean language sql immutable as $$
  select case
    when p_desc is null or btrim(p_desc) = '' then false
    when p_desc ilike '%vista%' or p_desc ilike '%antecip%' or p_desc ilike '%sinal%' then false
    when p_desc ~* '^\s*para\s+\d+\s+dias?(\s*\(c\))?\s*$'
      then (substring(p_desc from '\d+'))::int >= 1
    when p_desc ~ '^\s*\d+(\s*/\s*\d+)+(\s*\(C\))?\s*$'
      then not exists (select 1 from regexp_matches(p_desc, '\d+', 'g') m where m[1]::int < 1)
    else false
  end
$$;

create table if not exists compras.auto_aprovacao_log (
  id bigserial primary key,
  rodada uuid not null,
  quando timestamptz not null default now(),
  modo text not null check (modo in ('simulacao', 'aplicado')),
  origem_disparo text,              -- cron | manual:<email> | cesar:<email>
  empresa text, pc text, origem text, pedido_id bigint,
  fornecedor text, valor_pc numeric, valor_rc numeric, base text,
  condicao text, pv_os text, projeto text,
  decisao text not null,            -- aprovado | elegivel | pulado | falhou
  motivo text
);
create index if not exists auto_aprovacao_log_quando on compras.auto_aprovacao_log (quando desc);
grant select, insert on compras.auto_aprovacao_log to service_role;
grant usage, select on sequence compras.auto_aprovacao_log_id_seq to service_role;

-- Candidatos e decisão (não grava nada).
--   base 'itens': PC do painel — soma dos itens do PC × soma (valor unit. da RC × qtd do PC)
--                 dos itens de RC ligados a cada item (item sem RC = não elegível).
--   base 'venda': PC do Omie (sem vínculo por item) — total dos PCs da venda × total das RCs
--                 da venda, exatamente a comparação que a tela mostra ("Compra abaixo do RC").
create or replace function orders.compras_auto_aprov_candidatos(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  with linhas as (
    select v.empresa, coalesce(v.pc_numero, v.pc_numero_manual) as pc,
           array_agg(v.ncod_ped) as ncods,
           bool_and(coalesce(v.status, 'PENDENTE') not in ('APROVADO', 'APROVADO_FAT_DIRETO', 'NAO_APROVADO', 'CANCELAR_PEDIDO')) as pendente,
           max(v.valor_total) as valor_view, max(v.rc_custo_total_calc) as rc_venda, max(v.pc_custo_total_calc) as pc_venda,
           max(v._dt_inclusao_d) as incl, max(v.pv_os_label) as pv_os, max(v.projeto_nome) as projeto,
           max(v.nome_fornecedor) as forn_view, bool_or(v.rc_numero is not null) as tem_rc, max(v.pc_forma_pagamento) as forma_view
      from approval.v_pc_avulsos v
     where coalesce(v.pc_numero, v.pc_numero_manual) is not null
     group by 1, 2
  ), base as (
    select l.*, p.id as pedido_id, p.origem, p.numero, p.valor_total as valor_pc, p.fornecedor_nome, p.parcela_cod,
           p.aprov_status, p.cancelado, p.projeto_cod, p.emissao,
           coalesce((select f.descricao from finance.parcelas f where f.codigo = p.parcela_cod limit 1), l.forma_view) as condicao
      from linhas l
      left join lateral (select * from compras.pedidos p
                          where p.empresa = l.empresa and p.tipo = 'PC' and p.numero in (l.pc, l.pc || '-OMIE')
                          order by (p.pv_os is not distinct from l.pv_os) desc, (p.numero = l.pc) desc limit 1) p on true
  ), itens as (
    select b.pedido_id,
           sum(round(i.qtd * i.valor_unit - coalesce(i.desconto, 0), 2)) as pc_itens,
           sum(rc.valor_rc) as rc_itens,
           count(*) filter (where rc.valor_rc is null) as sem_rc
      from base b
      join compras.itens i on i.pedido_id = b.pedido_id
      left join lateral (select sum(ri.valor_unit * coalesce(l2.qtd, i.qtd)) as valor_rc
                           from compras.item_rc l2 join compras.itens ri on ri.id = l2.rc_item_id
                          where l2.pc_item_id = i.id) rc on true
     where b.origem = 'painel'
     group by b.pedido_id
  ), fluxo as (
    select b.pc as pc_fx, b.empresa as emp_fx, f.status as fluxo_status
      from base b
      left join lateral (select pc.ncod_proj from orders.pedidos_compra pc
                          where pc.empresa = b.empresa and ltrim(pc.cnumero, '0') = ltrim(b.pc, '0') limit 1) pc on true
      left join lateral (select f.status from approval.projeto_fluxo f
                          where f.empresa = b.empresa and f.codigo_projeto = coalesce(pc.ncod_proj, b.projeto_cod) limit 1) f on true
  ), dec as (
    select b.*, it.pc_itens, it.rc_itens, it.sem_rc, fx.fluxo_status,
           case when b.origem = 'painel' then 'itens' else 'venda' end as base_cmp,
           case when b.origem = 'painel' then coalesce(it.pc_itens, b.valor_pc) else b.pc_venda end as cmp_pc,
           case when b.origem = 'painel' then it.rc_itens else b.rc_venda end as cmp_rc,
           compras.condicao_faturada(b.condicao) as faturada
      from base b
      left join itens it on it.pedido_id = b.pedido_id
      left join fluxo fx on fx.pc_fx = b.pc and fx.emp_fx = b.empresa
     where coalesce(b.incl, b.emissao) >= current_date - p_dias
  ), motivo as (
    select d.*,
      case
        when not d.pendente then 'já decidido (aprovado/não aprovado)'
        when d.pedido_id is null then 'PC não encontrado em Compras'
        when d.cancelado then 'PC cancelado'
        when d.origem = 'painel' and d.aprov_status in ('aprovado', 'nao_aprovado') then 'já decidido em Compras'
        when coalesce(d.valor_pc, d.valor_view, 0) <= 0 then 'PC sem valor'
        when d.origem = 'painel' and coalesce(d.sem_rc, 1) > 0 then 'item do PC sem RC ligada'
        when d.origem <> 'painel' and not d.tem_rc then 'sem RC ligada'
        when coalesce(d.cmp_rc, 0) <= 0 then 'RC sem valor'
        when d.cmp_pc > d.cmp_rc + 0.005 then 'PC acima da RC'
        when not d.faturada then 'condição não é faturada (' || coalesce(d.condicao, 'sem condição') || ')'
        when d.fluxo_status is not null and d.fluxo_status <> 'aprovado' then 'fluxo do projeto não aprovado'
      end as motivo_pulo
      from dec d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'empresa', m.empresa, 'pc', m.pc, 'pedido_id', m.pedido_id, 'origem', m.origem, 'ncods', m.ncods,
           'fornecedor', coalesce(m.fornecedor_nome, m.forn_view), 'valor_pc', coalesce(m.valor_pc, m.valor_view),
           'cmp_pc', round(m.cmp_pc, 2), 'cmp_rc', round(m.cmp_rc, 2), 'base', m.base_cmp,
           'condicao', m.condicao, 'faturada', m.faturada, 'pv_os', m.pv_os, 'projeto', m.projeto,
           'incluido', coalesce(m.incl, m.emissao), 'pendente', m.pendente,
           'elegivel', m.motivo_pulo is null,
           'motivo', coalesce(m.motivo_pulo,
             format('PC R$ %s ≤ RC R$ %s%s · condição faturada %s',
                    to_char(m.cmp_pc, 'FM999G999G990D00'), to_char(m.cmp_rc, 'FM999G999G990D00'),
                    case when m.base_cmp = 'venda' then ' (total da venda ' || coalesce(m.pv_os, '') || ')' else '' end,
                    m.condicao))
         ) order by m.pc), '[]'::jsonb)
    into r
    from motivo m;
  return r;
end $$;
revoke all on function orders.compras_auto_aprov_candidatos(int) from public, anon, authenticated;
grant execute on function orders.compras_auto_aprov_candidatos(int) to service_role;

create or replace function orders.compras_auto_aprov_log(p jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into compras.auto_aprovacao_log (rodada, modo, origem_disparo, empresa, pc, origem, pedido_id, fornecedor,
         valor_pc, valor_rc, base, condicao, pv_os, projeto, decisao, motivo)
  select (x->>'rodada')::uuid, x->>'modo', x->>'disparo', x->>'empresa', x->>'pc', x->>'origem', (x->>'pedido_id')::bigint,
         x->>'fornecedor', (x->>'cmp_pc')::numeric, (x->>'cmp_rc')::numeric, x->>'base', x->>'condicao', x->>'pv_os',
         x->>'projeto', x->>'decisao', x->>'motivo'
    from jsonb_array_elements(p) x
$$;
revoke all on function orders.compras_auto_aprov_log(jsonb) from public, anon, authenticated;
grant execute on function orders.compras_auto_aprov_log(jsonb) to service_role;

-- PC do Omie: grava a aprovação nas linhas da venda em approval.approvals (o mesmo
-- que /api/approvals/set-status faz) e espelha em compras.pedidos. Nada vai ao Omie.
create or replace function orders.compras_auto_aprov_omie(p_empresa text, p_ncods bigint[], p_valor numeric, p_por text)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update approval.approvals set status = 'APROVADO', aprovador_email = p_por, aprovado_em = now(),
         valor_aprovado = p_valor, aprovador_id = null, updated_at = now(), updated_by = p_por
   where empresa = p_empresa and ncod_ped = any (p_ncods)
     and coalesce(status, 'PENDENTE') not in ('APROVADO', 'APROVADO_FAT_DIRETO', 'NAO_APROVADO', 'CANCELAR_PEDIDO');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function orders.compras_auto_aprov_omie(text, bigint[], numeric, text) from public, anon, authenticated;
grant execute on function orders.compras_auto_aprov_omie(text, bigint[], numeric, text) to service_role;

create or replace function orders.compras_auto_aprov_ultimas(p_limite int default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(l) order by l.quando desc), '[]'::jsonb)
    from (select * from compras.auto_aprovacao_log order by quando desc limit p_limite) l
$$;
revoke all on function orders.compras_auto_aprov_ultimas(int) from public, anon, authenticated;
grant execute on function orders.compras_auto_aprov_ultimas(int) to service_role;
