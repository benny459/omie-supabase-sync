-- 13/10/26 (Benny) — Consulta de fornecedor em Compras: todos os pedidos feitos a ele, o que falta
-- chegar e o pagamento de cada um (pago, a vencer, atrasado, antecipado). compras_pagamentos ganha 'antecipado'.
create or replace function orders.compras_pagamentos(p_empresa text, p_fornecedor bigint, p_pedido_id bigint, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'compras', 'finance', 'public' as $function$
  with ped as (select id, numero from compras.pedidos where id = p_pedido_id),
  om as (
    select 'omie'::text origem, t.cod_titulo::text ref, nullif(trim(split_part(coalesce(t.numero_pedido, ''), ',', 1)), '') pc,
           coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela parc,
           t.emissao::date emissao, t.vencimento::date venc, coalesce(t.valor_documento, 0) valor,
           greatest(coalesce(t.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P'), 0)) pago,
           coalesce(t.pagamento::date, (select max(b.data) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P')) pago_em,
           t.status_titulo st, t.contraparte forn, t.codigo_cliente_fornecedor fcod,
           (t.codigo_categoria = '2.08.01' or coalesce(t.numero_documento, '') ilike '%-ANT') antec
      from finance.v_titulos_omie_bruto t
     where t.tipo = 'pagar' and t.empresa = p_empresa
       and coalesce(t.status_titulo, '') not in ('EXCLUIDO', 'CANCELADO')
       and (p_fornecedor is null or t.codigo_cliente_fornecedor = p_fornecedor)
       and (p_pedido_id is null or ltrim(nullif(trim(split_part(coalesce(t.numero_pedido, ''), ',', 1)), ''), '0') = (select ltrim(numero, '0') from ped))
       and (p_desde is null or t.vencimento::date >= p_desde)
  ),
  pa as (
    select 'painel'::text, v.pagar_id::text, coalesce(v.numero_pedido, (select numero from compras.pedidos where id = v.pedido_id)),
           coalesce(nullif(v.numero_documento_fiscal, ''), v.numero_documento), v.numero_parcela, v.emissao::date, v.vencimento::date,
           coalesce(v.valor_documento, 0), coalesce(v.valor_pago, 0), v.pago_em::date,
           case when v.quitado then 'PAGO' else v.status_titulo end, v.contraparte, v.codigo_cliente_fornecedor,
           (exists (select 1 from finance.pagar_previsto pp where pp.id::text = v.pagar_id::text and pp.antecipa_pedido_id is not null)
            or coalesce(v.numero_documento, '') ilike '%-ANT' or v.codigo_categoria = '2.08.01')
      from finance.v_pagar_previsto v
     where v.empresa = p_empresa and v.origem <> 'OMIE'
       and (p_fornecedor is null or v.codigo_cliente_fornecedor = p_fornecedor)
       and (p_pedido_id is null or v.pedido_id = p_pedido_id or ltrim(coalesce(v.numero_pedido, ''), '0') = (select ltrim(numero, '0') from ped))
       and (p_desde is null or v.vencimento::date >= p_desde)
  ),
  tudo as (select * from om union all select * from pa)
  select coalesce(jsonb_agg(jsonb_build_object(
      'origem', origem, 'ref', ref, 'pc', pc, 'pedidoId', (select p.id from compras.pedidos p where p.empresa = p_empresa and p.tipo = 'PC' and p.numero = ltrim(tudo.pc, '0') limit 1),
      'doc', doc, 'parcela', parc, 'emissao', emissao, 'vencimento', venc, 'valor', valor, 'pago', least(pago, valor), 'pagoEm', pago_em,
      'situacao', case when st in ('PAGO', 'LIQUIDADO') or pago >= valor - 0.01 then 'pago'
                       when pago > 0.01 then 'parcial'
                       when venc < current_date then 'atrasado' else 'a vencer' end,
      'fornecedor', forn, 'antecipado', coalesce(antec, false)) order by venc desc nulls last), '[]'::jsonb)
    from tudo
$function$;
grant execute on function orders.compras_pagamentos(text, bigint, bigint, date) to service_role;


-- Pedidos do fornecedor com a situação da entrega (o que falta chegar, por item)
create or replace function orders.compras_pedidos_fornecedor(p_empresa text, p_fornecedor bigint, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  with it as (
    select i.pedido_id, i.id, i.seq, i.descricao, i.unidade, i.qtd, compras.item_vu_total(i) vu,
           least(i.qtd, case when p.etapa in ('60', '80') then coalesce(nullif(i.qtd_recebida, 0), i.qtd)
                             else greatest(coalesce(i.qtd_recebida, 0),
                                           coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id), 0)) end) rec
      from compras.pedidos p join compras.itens i on i.pedido_id = p.id
     where p.empresa = p_empresa and p.fornecedor_cod = p_fornecedor and p.tipo = 'PC' and not p.cancelado
       and (p_desde is null or p.emissao >= p_desde)
  ), ag as (
    select pedido_id, sum(qtd * vu) tot, sum(rec * vu) rec_valor,
           jsonb_agg(jsonb_build_object('seq', seq, 'desc', descricao, 'un', unidade, 'qtd', qtd, 'rec', rec) order by seq)
             filter (where rec < qtd - 0.0001) faltam
      from it group by pedido_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'num', p.numero, 'emissao', p.emissao, 'previsao', p.previsao, 'etapa', p.etapa, 'aprov', p.aprov_status,
      'projeto', p.projeto_nome, 'comprador', p.comprador, 'valor', p.valor_total, 'origem', p.origem,
      'nf', nullif(p.nf, ''), 'faturado', p.dt_faturado, 'recebidoEm', p.dt_rec,
      'faltaValor', greatest(0, round(coalesce(ag.tot, 0) - coalesce(ag.rec_valor, 0), 2)),
      'faltam', coalesce(ag.faltam, '[]'::jsonb),
      'entrega', case when coalesce(ag.tot, 0) > 0 and coalesce(ag.rec_valor, 0) >= ag.tot - 0.01 then 'recebido'
                      when coalesce(ag.rec_valor, 0) > 0.01 then 'parcial'
                      when p.etapa = '40' or exists (select 1 from compras.nf_vinculos v where v.pedido_id = p.id and v.status = 'confirmado') then 'faturado'
                      when p.previsao < current_date then 'atrasado'
                      else 'aguardando' end)
    order by p.emissao desc, p.numero desc), '[]'::jsonb)
    from compras.pedidos p left join ag on ag.pedido_id = p.id
   where p.empresa = p_empresa and p.fornecedor_cod = p_fornecedor and p.tipo = 'PC' and not p.cancelado
     and (p_desde is null or p.emissao >= p_desde)
$function$;
grant execute on function orders.compras_pedidos_fornecedor(text, bigint, date) to service_role;
