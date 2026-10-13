-- 13/10/26 (Benny) — Compras vê se a compra foi paga, sem acesso ao Contas a Pagar: títulos do
-- pedido ou do fornecedor (Omie + painel), com valor, vencimento, quanto foi pago e quando.
-- Omie: pago = status PAGO/LIQUIDADO ou baixas no painel cobrindo o valor. Excluídos/cancelados ficam fora.
create or replace function orders.compras_pagamentos(p_empresa text, p_fornecedor bigint, p_pedido_id bigint, p_desde date default null)
returns jsonb language sql stable security definer set search_path to 'compras', 'finance', 'public' as $function$
  with ped as (select id, numero from compras.pedidos where id = p_pedido_id),
  om as (
    select 'omie'::text origem, t.cod_titulo::text ref, nullif(trim(split_part(coalesce(t.numero_pedido, ''), ',', 1)), '') pc,
           coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela parc,
           t.emissao::date emissao, t.vencimento::date venc, coalesce(t.valor_documento, 0) valor,
           greatest(coalesce(t.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P'), 0)) pago,
           coalesce(t.pagamento::date, (select max(b.data) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P')) pago_em,
           t.status_titulo st, t.contraparte forn, t.codigo_cliente_fornecedor fcod
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
           case when v.quitado then 'PAGO' else v.status_titulo end, v.contraparte, v.codigo_cliente_fornecedor
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
      'fornecedor', forn) order by venc desc nulls last), '[]'::jsonb)
    from tudo
$function$;
grant execute on function orders.compras_pagamentos(text, bigint, bigint, date) to service_role;
