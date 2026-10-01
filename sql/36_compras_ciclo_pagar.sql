-- 36 — Ciclo real do contas a pagar a partir de Compras (decisão do Benny, 01/10/2026).
--
-- "Só pago o que recebi e conferi." Uma fase por parcela de cada pedido de
-- compra do painel (finance.pagar_previsto vira a conta a pagar do painel):
--   previsto                → PC aprovado, NF ainda não chegou (parcelas do PC)
--   aguardando_recebimento  → NF casada com o PC aprovado (Faturado); parcelas
--                             passam a ser as DUPLICATAS da NF — não pagável
--   aguardando_conferencia  → PC Recebido — não pagável
--   liberado                → PC Conferido — só agora pagável
-- Recebimento parcial: continua bloqueado e marcado "parcial"; se o pedido for
-- conferido com recebimento parcial, libera só a proporção recebida
-- (valor_liberado).
-- PC pendente / não aprovado não gera conta a pagar (sai a previsão).
-- O mesmo débito nunca aparece duas vezes: quando o título do Omie da mesma NF
-- chega (fornecedor + nº da NF), a linha do painel vira 'substituido' e o
-- título do Omie herda a fase (orders.compras_fases_pagar → rota de títulos).

alter table finance.pagar_previsto add column if not exists fase text not null default 'previsto';
alter table finance.pagar_previsto drop constraint if exists pagar_previsto_fase_check;
alter table finance.pagar_previsto add constraint pagar_previsto_fase_check
  check (fase in ('previsto', 'aguardando_recebimento', 'aguardando_conferencia', 'liberado'));
alter table finance.pagar_previsto add column if not exists parcial boolean not null default false;
alter table finance.pagar_previsto add column if not exists valor_liberado numeric;
alter table finance.pagar_previsto add column if not exists nf_numero text;
alter table finance.pagar_previsto add column if not exists nf_chave text;
alter table finance.pagar_previsto add column if not exists origem_parcelas text not null default 'pc';

-- Fase + parcial + proporção liberada de um pedido.
create or replace function compras.fase_pagar(p_id bigint)
returns table (fase text, parcial boolean, prop numeric, tem_nf boolean)
language sql stable security definer set search_path = compras, public as $$
  with p as (select * from compras.pedidos where id = p_id),
  it as (select sum(qtd * valor_unit) as tot, sum(least(coalesce(qtd_recebida, 0), qtd) * valor_unit) as rec,
                bool_or(coalesce(qtd_recebida, 0) > 0) as algum, bool_and(coalesce(qtd_recebida, 0) >= qtd) as todos
           from compras.itens where pedido_id = p_id),
  nf as (select exists (select 1 from compras.nf_vinculos where pedido_id = p_id and status = 'confirmado')
                or coalesce((select nf from p), '') <> '' as tem)
  select case when p.etapa = '80' then 'liberado'
              when p.etapa = '60' then 'aguardando_conferencia'
              when p.etapa = '40' and nf.tem then 'aguardando_recebimento'
              else 'previsto' end,
         coalesce(it.algum and not it.todos, false),
         case when p.etapa = '80' and it.algum and not it.todos and it.tot > 0 then round(it.rec / it.tot, 6) else 1 end,
         nf.tem
    from p, it, nf
$$;

-- Refaz as contas a pagar do painel de UM pedido.
create or replace function compras.gerar_previsoes(p_id bigint)
returns int language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; n int := 0; v_tot int; f record; v_parc jsonb; v_origem text := 'pc';
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
  -- só pedido APROVADO vira conta a pagar (nem previsão)
  if v.aprov_status <> 'aprovado' then
    delete from finance.pagar_previsto where pedido_id = p_id and status = 'previsto';
    return 0;
  end if;
  select * into f from compras.fase_pagar(p_id);

  -- substituída pelo título do Omie: não volta, mas a fase acompanha o pedido
  if exists (select 1 from finance.pagar_previsto where pedido_id = p_id and status = 'substituido') then
    update finance.pagar_previsto set fase = f.fase, parcial = f.parcial,
           valor_liberado = case when f.fase = 'liberado' then round(valor * f.prop, 2) end, updated_at = now()
     where pedido_id = p_id and status in ('substituido', 'previsto');
    return 0;
  end if;

  -- parcelas: duplicatas das NF casadas (conta real) ou, sem NF, as do pedido
  if f.tem_nf and exists (select 1 from compras.nf_vinculos where pedido_id = p_id and status = 'confirmado') then
    select jsonb_agg(x order by x->>'venc', x->>'nf') into v_parc from (
      select jsonb_build_object('venc', coalesce(nullif(d->>'data_vencimento', '')::date,
                                                 (select min(vencimento) from compras.parcelas where pedido_id = p_id),
                                                 (fr.emissao at time zone 'America/Sao_Paulo')::date),
                                'valor', coalesce(nullif(d->>'valor', '')::numeric, fr.valor),
                                'nf', coalesce(nullif(ltrim(fr.numero, '0'), ''), substr(fr.chave, 26, 9)), 'chave', fr.chave) as x
        from compras.nf_vinculos nv
        join orders.focus_recebidos fr on fr.tipo = 'nfe' and fr.chave = nv.chave
        cross join lateral jsonb_array_elements(
          case when jsonb_array_length(coalesce(fr.detalhe->'requisicao_nota_fiscal'->'duplicatas', '[]'::jsonb)) > 0
               then fr.detalhe->'requisicao_nota_fiscal'->'duplicatas' else '[{}]'::jsonb end) d
       where nv.pedido_id = p_id and nv.status = 'confirmado') z;
    v_origem := 'nf';
  end if;
  if v_parc is null then
    select jsonb_agg(jsonb_build_object('venc', x.vencimento, 'valor', x.valor, 'doc', x.tipo_doc, 'nf', nullif(v.nf, '')) order by x.n)
      into v_parc from compras.parcelas x where x.pedido_id = p_id;
    v_origem := 'pc';
  end if;
  v_tot := coalesce(jsonb_array_length(v_parc), 0);
  delete from finance.pagar_previsto where pedido_id = p_id and parcela_n > v_tot and status = 'previsto';
  if v_tot = 0 then return 0; end if;

  insert into finance.pagar_previsto as pp (empresa, pedido_id, pedido_numero, parcela_n, parcelas_total, vencimento, valor,
    tipo_doc, fornecedor_cod, fornecedor_nome, fornecedor_cnpj, categoria_cod, categoria_desc, projeto_cod, projeto_nome,
    conta_cod, conta_desc, status, fase, parcial, valor_liberado, nf_numero, nf_chave, origem_parcelas, updated_at)
  select v.empresa, v.id, v.numero, k::int, v_tot, (x->>'venc')::date, (x->>'valor')::numeric, coalesce(x->>'doc', 'Boleto'),
         v.fornecedor_cod, v.fornecedor_nome, v.fornecedor_cnpj, v.categoria_cod, v.categoria_desc, v.projeto_cod, v.projeto_nome,
         v.conta_cod, v.conta_desc, 'previsto', f.fase, f.parcial,
         case when f.fase = 'liberado' then round((x->>'valor')::numeric * f.prop, 2) end,
         x->>'nf', x->>'chave', v_origem, now()
    from jsonb_array_elements(v_parc) with ordinality t(x, k)
  on conflict (pedido_id, parcela_n) do update set
    pedido_numero = excluded.pedido_numero, parcelas_total = excluded.parcelas_total, vencimento = excluded.vencimento,
    valor = excluded.valor, tipo_doc = excluded.tipo_doc, fornecedor_cod = excluded.fornecedor_cod,
    fornecedor_nome = excluded.fornecedor_nome, fornecedor_cnpj = excluded.fornecedor_cnpj,
    categoria_cod = excluded.categoria_cod, categoria_desc = excluded.categoria_desc, projeto_cod = excluded.projeto_cod,
    projeto_nome = excluded.projeto_nome, conta_cod = excluded.conta_cod, conta_desc = excluded.conta_desc,
    status = 'previsto', fase = excluded.fase, parcial = excluded.parcial, valor_liberado = excluded.valor_liberado,
    nf_numero = excluded.nf_numero, nf_chave = excluded.nf_chave, origem_parcelas = excluded.origem_parcelas, updated_at = now()
  where pp.status <> 'substituido';
  get diagnostics n = row_count;
  return n;
end $$;

-- Substitui a linha do painel quando o título real chega do Omie: mesmo
-- fornecedor (código ou CNPJ) e o nº de uma NF do pedido no documento fiscal.
create or replace function compras.conciliar_previsoes()
returns int language plpgsql security definer set search_path = compras, public as $$
declare n int;
begin
  with achou as (
    select pp.pedido_id, string_agg(distinct pt.cod_titulo::text, ', ') as titulos
      from finance.pagar_previsto pp
      join compras.pedidos p on p.id = pp.pedido_id and coalesce(p.nf, '') <> ''
      join finance.pesquisa_titulos pt on pt.natureza = 'P' and pt.empresa = pp.empresa and pt.status <> 'CANCELADO'
            and (pt.cod_cliente = pp.fornecedor_cod
                 or (regexp_replace(coalesce(pp.fornecedor_cnpj, ''), '\D', '', 'g') <> ''
                     and regexp_replace(coalesce(pt.cpf_cnpj_cliente, ''), '\D', '', 'g') = regexp_replace(pp.fornecedor_cnpj, '\D', '', 'g')))
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

-- Refaz tudo (pedidos do painel são poucos): chamado pela tela de Compras e
-- pela de Contas a Pagar, e depois do casamento de NFs.
create or replace function compras.atualizar_pagar()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare r record; n int := 0;
begin
  for r in select id from compras.pedidos p
            where p.origem = 'painel' and p.tipo = 'PC'
              and (p.aprov_status = 'aprovado' or exists (select 1 from finance.pagar_previsto pp where pp.pedido_id = p.id and pp.status = 'previsto'))
  loop
    n := n + compras.gerar_previsoes(r.id);
  end loop;
  return jsonb_build_object('linhas', n, 'substituidas', compras.conciliar_previsoes());
end $$;
create or replace function orders.compras_atualizar_pagar()
returns jsonb language sql security definer set search_path = compras, public as $$ select compras.atualizar_pagar() $$;
create or replace function orders.compras_conciliar_previsoes()
returns int language sql security definer set search_path = compras, public as $$ select (compras.atualizar_pagar()->>'substituidas')::int $$;

-- Fases por NF para o título do Omie herdar (cnpj + nº da NF / chave).
create or replace function orders.compras_fases_pagar()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'cnpj', regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g'),
           'nf', ltrim(regexp_replace(t, '\D', '', 'g'), '0'),
           'fase', f.fase, 'parcial', f.parcial, 'prop', f.prop, 'pedido', p.numero)), '[]'::jsonb)
    from compras.pedidos p
    cross join lateral unnest(string_to_array(p.nf, ',')) t
    cross join lateral compras.fase_pagar(p.id) f
   where p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado'
     and coalesce(p.nf, '') <> '' and regexp_replace(t, '\D', '', 'g') <> ''
$$;

-- Contas a pagar do pedido (aba Parcelas da folha do pedido).
create or replace function orders.compras_pagar_do_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('n', parcela_n, 'total', parcelas_total, 'venc', vencimento, 'valor', valor,
           'fase', fase, 'parcial', parcial, 'liberado', valor_liberado, 'nf', nf_numero, 'status', status,
           'omie', substituido_por, 'origem', origem_parcelas) order by parcela_n), '[]'::jsonb)
    from finance.pagar_previsto where pedido_id = p_id and status in ('previsto', 'substituido')
$$;

-- Linhas no formato da tela de Contas a Pagar.
drop view if exists finance.v_pagar_previsto;
create view finance.v_pagar_previsto as
select -pp.id as codigo_lancamento_omie, pp.empresa, pp.fornecedor_nome as contraparte, pp.fornecedor_nome as contraparte_razao,
       pp.fornecedor_cnpj as cnpj_cpf, pp.fornecedor_cod as codigo_cliente_fornecedor, pp.vencimento, pp.vencimento as previsao,
       null::date as emissao, pp.valor as valor_documento, 0::numeric as valor_pago, pp.valor as val_aberto,
       case pp.fase when 'previsto' then 'PREVISTO' when 'aguardando_recebimento' then 'AGUARD_RECEB'
                    when 'aguardando_conferencia' then 'AGUARD_CONF' else 'LIBERADO' end as status_titulo,
       ('PC ' || pp.pedido_numero) as numero_documento,
       (pp.parcela_n || '/' || pp.parcelas_total) as numero_parcela, pp.nf_numero as numero_documento_fiscal,
       pp.pedido_numero as numero_pedido, pp.categoria_desc as categoria, pp.categoria_cod as codigo_categoria,
       pp.projeto_nome as projeto, pp.projeto_cod as codigo_projeto, pp.conta_desc as conta_corrente, pp.conta_cod as cod_cc,
       (case pp.fase when 'previsto' then 'Previsto' when 'aguardando_recebimento' then 'NF ' || coalesce(pp.nf_numero, '') || ' — aguardando recebimento'
                     when 'aguardando_conferencia' then 'Aguardando conferência' else 'Liberado para pagar' end
        || ' (PC ' || pp.pedido_numero || ')' || case when pp.parcial then ' · parcial' else '' end) as observacao,
       'PC'::text as origem, pp.tipo_doc as tipo_documento,
       true as em_aberto, (pp.vencimento - current_date) as dias_para_vencer, pp.pedido_id, pp.status,
       pp.fase, pp.parcial, pp.valor_liberado, pp.nf_chave as chave_nfe
  from finance.pagar_previsto pp
 where pp.status = 'previsto';
revoke all on finance.v_pagar_previsto from anon, authenticated;
grant select on finance.v_pagar_previsto to service_role;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname in ('compras_atualizar_pagar', 'compras_conciliar_previsoes', 'compras_fases_pagar', 'compras_pagar_do_pedido'))
               or (n.nspname = 'compras' and p.proname in ('fase_pagar', 'gerar_previsoes', 'conciliar_previsoes', 'atualizar_pagar')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Reprocessa o que já existe (pendentes perdem a previsão; aprovados ganham fase).
select compras.atualizar_pagar();
