-- 172 (15/10/26, Benny): o CRM nunca pode casar proposta com OS/PV de CONTRATO.
-- crm_erp_pedidos passa a mandar `contrato` = approval.v_venda_sinais.venda_contrato
-- (OS com nº de contrato cadastrado em sales.contratos_servico / vendas.contratos,
-- não OPS…; documento nativo com contrato_id). Aditiva: só uma chave nova no JSON.
-- Caso: OPS1509261356 (venda de carvão) ficou ligada sozinha à OS 4844, a OS
-- mensal do contrato 27390791.16 da Santa Casa de Piracicaba.
create or replace function orders.crm_erp_pedidos(p_empresa text, p_desde date default null,
  p_texto text default null, p_cliente bigint default null, p_limite int default 5000)
returns jsonb language sql stable security definer set search_path = '' as $$
  with pv as (
    select 'PV'::text tipo, v.codigo_pedido::bigint codigo_pedido, coalesce(v.numero_pedido, '') numero_pedido,
           v.codigo_cliente::bigint codigo_cliente, coalesce(v.valor_total, 0)::numeric valor_total,
           orders._crm_data(v.data_previsao) data_previsao, orders._crm_data(v.d_inc) data_emissao,
           coalesce(v.etapa, '') etapa, coalesce(v.codigo_parcela, '') codigo_parcela,
           v.numero_contrato, v.num_pedido_cliente numero_pedido_cliente,
           null::text obs_venda, v.dados_adicionais_nf,
           exists (select 1 from sales.etapas_pedidos e where e.empresa = v.empresa and e.codigo_pedido = v.codigo_pedido and e.cancelado = 'S') cancelada
      from sales.pedidos_venda v where v.empresa = p_empresa
  ), os as (
    select 'OS'::text, o.codigo_os::bigint, max(coalesce(o.numero_os, '')), (max(o.codigo_cliente) filter (where o.codigo_cliente ~ '^\d+$'))::bigint,
           max(coalesce(o.valor_total, 0))::numeric, orders._crm_data(max(o.dt_previsao)),
           coalesce(max(o.d_inc_d), orders._crm_data(max(o.d_inc))), max(coalesce(o.etapa, '')), max(coalesce(o.codigo_parcela, '')),
           max(o.numero_contrato), null::text, null::text, null::text, bool_or(o.cancelada = 'S')
      from sales.ordens_servico o where o.empresa = p_empresa and o.codigo_os ~ '^\d+$'
     group by o.codigo_os
  ), todos as (select * from pv union all select * from os)
  select coalesce(jsonb_agg(jsonb_build_object(
      'tipo', t.tipo, 'codigo_pedido', t.codigo_pedido, 'numero_pedido', t.numero_pedido,
      'codigo_cliente', t.codigo_cliente, 'valor_total', t.valor_total,
      'data_previsao', t.data_previsao, 'data_emissao', t.data_emissao, 'etapa', t.etapa,
      'codigo_parcela', t.codigo_parcela, 'parcela_descricao', fp.descricao,
      'numero_contrato', t.numero_contrato, 'numero_pedido_cliente', t.numero_pedido_cliente,
      'obs_venda', t.obs_venda, 'dados_adicionais_nf', t.dados_adicionais_nf,
      'cliente_nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social), 'cliente_cnpj', regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g'),
      'cancelada', t.cancelada,
      'contrato', coalesce(sx.contrato, false)) order by t.data_emissao desc nulls last), '[]'::jsonb)
    from (select * from todos t
           where (p_desde is null or t.data_emissao >= p_desde)
             and (p_cliente is null or t.codigo_cliente = p_cliente)
             and (p_texto is null or concat_ws(' | ', t.numero_contrato, t.numero_pedido_cliente, t.dados_adicionais_nf) ilike '%' || p_texto || '%')
           order by t.data_emissao desc nulls last limit greatest(1, least(p_limite, 20000))) t
    left join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie = t.codigo_cliente
    left join finance.parcelas fp on fp.codigo = t.codigo_parcela
    left join approval.v_venda_sinais sx on sx.empresa = p_empresa and sx.pv_os_label = t.tipo || t.numero_pedido
$$;
