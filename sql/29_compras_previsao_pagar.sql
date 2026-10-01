-- 29 — Previsão de contas a pagar a partir dos pedidos de compra do painel
--      (01/10/2026, pedido do Benny). Mesmo padrão do receber (sql/20):
--
--   · finance.pagar_previsto: uma linha por parcela de cada pedido de compra
--     que nasceu no painel. Refeita sempre que o pedido muda
--     (compras.gerar_previsoes, chamada pelas rotas /api/compras/* depois de
--     salvar/aprovar/receber/cancelar). Pedido cancelado → previsões
--     'cancelado'.
--   · Quando a conta a pagar REAL chega (título do Omie em
--     finance.pesquisa_titulos, mesmo fornecedor e a NF do pedido), as
--     previsões do pedido viram 'substituido' — não duplicam no fluxo.
--   · Aparece em /financeiro/pagar como "Previsto (PC nnnn)" e no fluxo de
--     caixa (bi.fluxo_caixa_titulos ganha um ramo union all; cod_titulo
--     negativo = previsão).

create table if not exists finance.pagar_previsto (
  id              bigserial primary key,
  empresa         text not null,
  pedido_id       bigint not null,
  pedido_numero   text not null,
  parcela_n       int not null,
  parcelas_total  int not null,
  vencimento      date,
  valor           numeric not null default 0,
  tipo_doc        text,
  fornecedor_cod  bigint,
  fornecedor_nome text,
  fornecedor_cnpj text,
  categoria_cod   text,
  categoria_desc  text,
  projeto_cod     bigint,
  projeto_nome    text,
  conta_cod       bigint,
  conta_desc      text,
  status          text not null default 'previsto' check (status in ('previsto', 'substituido', 'cancelado')),
  substituido_por text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (pedido_id, parcela_n)
);
create index if not exists pagar_previsto_venc_idx on finance.pagar_previsto (vencimento) where status = 'previsto';
alter table finance.pagar_previsto enable row level security;
revoke all on finance.pagar_previsto from anon, authenticated;
grant all on finance.pagar_previsto to service_role;
grant usage, select on sequence finance.pagar_previsto_id_seq to service_role;

-- Refaz as previsões de UM pedido a partir das parcelas dele.
create or replace function compras.gerar_previsoes(p_id bigint)
returns int language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; n int := 0; v_tot int;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found or v.origem <> 'painel' or v.tipo <> 'PC' then
    delete from finance.pagar_previsto where pedido_id = p_id and status = 'previsto';
    return 0;
  end if;
  if v.cancelado then
    update finance.pagar_previsto set status = 'cancelado', updated_at = now() where pedido_id = p_id and status = 'previsto';
    return 0;
  end if;
  -- substituída não volta: a conta real já está no Omie
  if exists (select 1 from finance.pagar_previsto where pedido_id = p_id and status = 'substituido') then return 0; end if;
  select count(*) into v_tot from compras.parcelas where pedido_id = p_id;
  delete from finance.pagar_previsto where pedido_id = p_id and parcela_n > v_tot;
  insert into finance.pagar_previsto as pp (empresa, pedido_id, pedido_numero, parcela_n, parcelas_total, vencimento, valor,
    tipo_doc, fornecedor_cod, fornecedor_nome, fornecedor_cnpj, categoria_cod, categoria_desc, projeto_cod, projeto_nome,
    conta_cod, conta_desc, status, updated_at)
  select v.empresa, v.id, v.numero, x.n, v_tot, x.vencimento, x.valor, x.tipo_doc, v.fornecedor_cod, v.fornecedor_nome,
         v.fornecedor_cnpj, v.categoria_cod, v.categoria_desc, v.projeto_cod, v.projeto_nome, v.conta_cod, v.conta_desc,
         'previsto', now()
    from compras.parcelas x where x.pedido_id = p_id
  on conflict (pedido_id, parcela_n) do update set
    pedido_numero = excluded.pedido_numero, parcelas_total = excluded.parcelas_total, vencimento = excluded.vencimento,
    valor = excluded.valor, tipo_doc = excluded.tipo_doc, fornecedor_cod = excluded.fornecedor_cod,
    fornecedor_nome = excluded.fornecedor_nome, fornecedor_cnpj = excluded.fornecedor_cnpj,
    categoria_cod = excluded.categoria_cod, categoria_desc = excluded.categoria_desc, projeto_cod = excluded.projeto_cod,
    projeto_nome = excluded.projeto_nome, conta_cod = excluded.conta_cod, conta_desc = excluded.conta_desc,
    status = 'previsto', updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Substitui previsões cuja conta a pagar real já existe no Omie: mesmo
-- fornecedor e o número de uma das NF do pedido no documento fiscal.
create or replace function compras.conciliar_previsoes()
returns int language plpgsql security definer set search_path = compras, public as $$
declare n int;
begin
  with achou as (
    select pp.pedido_id, string_agg(distinct pt.cod_titulo::text, ', ') as titulos
      from finance.pagar_previsto pp
      join compras.pedidos p on p.id = pp.pedido_id and p.nf is not null
      join finance.pesquisa_titulos pt on pt.natureza = 'P' and pt.empresa = pp.empresa
            and pt.cod_cliente = pp.fornecedor_cod and pt.status <> 'CANCELADO'
            and ltrim(regexp_replace(coalesce(pt.num_doc_fiscal, ''), '\D', '', 'g'), '0') = any (
                  select ltrim(regexp_replace(t, '\D', '', 'g'), '0') from unnest(string_to_array(p.nf, ',')) t)
     where pp.status = 'previsto'
     group by 1
  )
  update finance.pagar_previsto pp set status = 'substituido', substituido_por = a.titulos, updated_at = now()
    from achou a where pp.pedido_id = a.pedido_id and pp.status = 'previsto';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function orders.compras_gerar_previsoes(p_id bigint)
returns int language sql security definer set search_path = compras, public as $$ select compras.gerar_previsoes(p_id) $$;
create or replace function orders.compras_conciliar_previsoes()
returns int language sql security definer set search_path = compras, public as $$ select compras.conciliar_previsoes() $$;

-- Linhas no formato da tela de Contas a Pagar (mesmos nomes da v_titulos_omie).
create or replace view finance.v_pagar_previsto as
select -pp.id as codigo_lancamento_omie, pp.empresa, pp.fornecedor_nome as contraparte, pp.fornecedor_nome as contraparte_razao,
       pp.fornecedor_cnpj as cnpj_cpf, pp.fornecedor_cod as codigo_cliente_fornecedor, pp.vencimento, pp.vencimento as previsao,
       null::date as emissao, pp.valor as valor_documento, 0::numeric as valor_pago, pp.valor as val_aberto,
       'PREVISTO'::text as status_titulo, ('PC ' || pp.pedido_numero) as numero_documento,
       (pp.parcela_n || '/' || pp.parcelas_total) as numero_parcela, null::text as numero_documento_fiscal,
       pp.pedido_numero as numero_pedido, pp.categoria_desc as categoria, pp.categoria_cod as codigo_categoria,
       pp.projeto_nome as projeto, pp.projeto_cod as codigo_projeto, pp.conta_desc as conta_corrente, pp.conta_cod as cod_cc,
       ('Previsto (PC ' || pp.pedido_numero || ')') as observacao, 'PC'::text as origem, pp.tipo_doc as tipo_documento,
       true as em_aberto, (pp.vencimento - current_date) as dias_para_vencer, pp.pedido_id, pp.status
  from finance.pagar_previsto pp
 where pp.status = 'previsto';
revoke all on finance.v_pagar_previsto from anon, authenticated;
grant select on finance.v_pagar_previsto to service_role;

-- Fluxo de caixa: previsões entram como títulos a pagar (cod_titulo negativo).
do $$
declare d text; antes text := '   order by 9, m.val_aberto desc';
begin
  d := pg_get_functiondef('bi.fluxo_caixa_titulos(integer,text[],text[],boolean,integer)'::regprocedure);
  if position('finance.pagar_previsto' in d) > 0 then return; end if;
  if position(antes in d) = 0 then raise exception 'fluxo_caixa_titulos mudou — revisar o ramo de previsões'; end if;
  d := replace(d, antes, $u$
  union all
  select (-pp.id)::bigint, pp.empresa::text, 'P'::text,
         bi.limpa_texto(coalesce(pp.fornecedor_nome, '(?)'))::text,
         bi.limpa_texto(coalesce(pp.categoria_desc, pp.categoria_cod, ''))::text,
         ('PC ' || pp.pedido_numero || ' ' || pp.parcela_n || '/' || pp.parcelas_total)::text,
         ('Previsto (PC ' || pp.pedido_numero || ')')::text,
         pp.vencimento, pp.vencimento, pp.vencimento, false, false,
         pp.vencimento < current_date,
         case when pp.vencimento < current_date then (current_date - pp.vencimento)::integer end,
         case when pp.vencimento >= current_date then null
              when current_date - pp.vencimento <= 15 then '1-15d' when current_date - pp.vencimento <= 30 then '16-30d'
              when current_date - pp.vencimento <= 60 then '31-60d' when current_date - pp.vencimento <= 90 then '61-90d'
              else '90d+' end::text,
         pp.valor::numeric, null::timestamptz, false, null::text, false, null::timestamptz, null::text
    from finance.pagar_previsto pp
    cross join (select coalesce(p_ano, extract(year from current_date)::integer) as ano) cfg2
   where pp.status = 'previsto' and pp.empresa = any(p_emp_pagar)
     and case when p_so_atrasados then pp.vencimento < current_date
                   and pp.vencimento >= make_date(cfg2.ano, 1, 1) and pp.vencimento < make_date(cfg2.ano + 1, 1, 1)
              else pp.vencimento between current_date and current_date + greatest(p_dias, 1) end
   order by 9, 16 desc$u$);
  execute d;
end $$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or n.nspname = 'compras' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
