-- 07/10/26 (Benny): Contas a pagar / a receber só mostravam o que está em
-- aberto — faltava ver, de forma clara, o que já foi PAGO / RECEBIDO.
-- Uma consulta por período (data do pagamento), juntando Omie e painel.

-- PAGOS: títulos pagos no Omie + baixas feitas no painel (a baixa do painel
-- manda: o título que tem baixa no painel não aparece duas vezes).
create or replace function finance.pagar_pagos(p_de date, p_ate date, p_lim int default 3000)
returns jsonb language sql stable security definer set search_path to 'finance', 'public'
as $$
with bx as (
  select 'b:' || b.id ref, 'painel' origem, b.empresa emp,
         coalesce(nullif(b.contraparte, ''), t.contraparte, pp.fornecedor_nome, '(sem nome)') forn,
         coalesce(t.categoria, pp.categoria_desc) cat, b.documento doc, coalesce(t.numero_parcela::text, pp.parcela_n || '/' || pp.parcelas_total) parc,
         coalesce(t.vencimento, pp.vencimento)::date venc, b.data::date pago_em,
         coalesce(t.valor_documento, pp.valor)::numeric valor_doc,
         round((b.valor - coalesce(b.desconto, 0) + coalesce(b.juros, 0) + coalesce(b.multa, 0))::numeric, 2) valor_pago,
         coalesce(b.juros, 0) + coalesce(b.multa, 0) juros, coalesce(b.desconto, 0) desconto,
         cc.descricao conta, b.cod_titulo, b.lote_id, b.origem forma
    from finance.baixas b
    left join finance.v_titulos_omie_bruto t on t.cod_titulo = b.cod_titulo and t.tipo = 'pagar'
    left join finance.pagar_previsto pp on pp.id = b.pagar_id
    left join finance.contas_correntes cc on cc.cod_cc = b.cod_cc
   where b.natureza = 'P' and b.estornado_em is null and b.data between p_de and p_ate
),
om as (
  select 'o:' || t.cod_titulo ref, 'omie' origem, t.empresa emp, coalesce(nullif(t.contraparte, ''), t.contraparte_razao, '(sem nome)') forn,
         t.categoria cat, coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela::text parc,
         t.vencimento::date venc, t.pagamento::date pago_em, t.valor_documento::numeric valor_doc,
         round(coalesce(nullif(t.valor_pago, 0), t.val_pago, t.valor_documento)::numeric, 2) valor_pago,
         coalesce(t.juros, 0) + coalesce(t.multa, 0) juros, coalesce(t.desconto, 0) desconto,
         t.conta_corrente conta, t.cod_titulo, null::bigint lote_id, 'omie' forma
    from finance.v_titulos_omie_bruto t
   where t.tipo = 'pagar' and t.status_titulo in ('PAGO', 'LIQUIDADO') and t.pagamento between p_de and p_ate
     and not exists (select 1 from finance.baixas b where b.cod_titulo = t.cod_titulo and b.natureza = 'P' and b.estornado_em is null)
)
select coalesce(jsonb_agg(to_jsonb(z) order by z.pago_em desc, z.valor_pago desc), '[]'::jsonb)
  from (select * from bx union all select * from om order by pago_em desc limit greatest(1, least(coalesce(p_lim, 3000), 10000))) z
$$;

-- RECEBIDOS: v_receber_bruto já junta Omie e o recebido no painel.
create or replace function finance.receber_recebidos(p_de date, p_ate date, p_lim int default 3000)
returns jsonb language sql stable security definer set search_path to 'finance', 'public'
as $$
select coalesce(jsonb_agg(to_jsonb(z) order by z.pago_em desc, z.valor_pago desc), '[]'::jsonb) from (
  select 'r:' || r.id ref, case when coalesce(r.valor_pago_painel, 0) > 0 then 'painel' else 'omie' end origem, r.empresa emp,
         coalesce(nullif(r.contraparte, ''), r.contraparte_razao, '(sem nome)') forn, r.categoria cat,
         coalesce(nullif(r.numero_documento_fiscal, ''), nullif(r.numero_documento, '')) doc, r.numero_parcela::text parc,
         r.vencimento::date venc, coalesce(r.pago_em_painel::date, r.pagamento::date) pago_em, r.valor_documento::numeric valor_doc,
         round(coalesce(nullif(r.valor_pago_painel, 0), nullif(r.valor_pago, 0), r.val_pago, r.valor_documento)::numeric, 2) valor_pago,
         coalesce(r.juros, 0) + coalesce(r.multa, 0) juros, coalesce(r.desconto, 0) desconto, r.conta_corrente conta,
         r.numero_pedido pedido, r.projeto proj
    from finance.v_receber_bruto r
   where (r.status_titulo in ('RECEBIDO', 'LIQUIDADO') or coalesce(r.valor_pago_painel, 0) > 0)
     and coalesce(r.pago_em_painel::date, r.pagamento::date) between p_de and p_ate
   order by 9 desc limit greatest(1, least(coalesce(p_lim, 3000), 10000))) z
$$;
