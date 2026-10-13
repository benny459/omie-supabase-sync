-- 13/10/26 (Benny) — Consulta de fornecedor: procurar também por nota fiscal, nº do PC ou item
-- (descrição/código nosso ou do fornecedor), com ou sem fornecedor escolhido. Sempre só pedidos de compra.

-- Pedidos (com entrega e itens que faltam). p_fornecedor e p_busca opcionais; precisa de pelo menos um.
create or replace function orders.compras_consulta_pedidos(p_empresa text, p_fornecedor bigint, p_desde date, p_busca text)
returns jsonb language plpgsql stable security definer set search_path to 'compras', 'orders', 'public' as $function$
declare b text := nullif(trim(coalesce(p_busca, '')), ''); dig text; r jsonb;
begin
  if p_fornecedor is null and (b is null or length(b) < 2) then return '[]'::jsonb; end if;
  dig := case when b ~ '^[\d\s./-]+$' then ltrim(regexp_replace(b, '\D', '', 'g'), '0') end;
  with base as (
    select p.* from compras.pedidos p
     where p.empresa = p_empresa and p.tipo = 'PC' and not p.cancelado
       and (p_fornecedor is null or p.fornecedor_cod = p_fornecedor)
       and (p_desde is null or p.emissao >= p_desde)
  ), m as (
    select id pedido_id, null::text bate from base where b is null
    union all
    -- nº do PC
    select id, 'PC ' || numero from base where dig is not null and dig <> '' and ltrim(numero, '0') = dig
    union all
    -- NF: no pedido, na chave do pedido, nas NFs casadas e nas notas gravadas
    select id, 'NF ' || dig from base where dig is not null and dig <> '' and (
             ltrim(coalesce(nf, ''), '0') = dig or (length(chave_nfe) = 44 and ltrim(substr(chave_nfe, 26, 9), '0') = dig)
             or exists (select 1 from compras.nf_vinculos v where v.pedido_id = base.id and v.status = 'confirmado' and ltrim(substr(v.chave, 26, 9), '0') = dig)
             or exists (select 1 from orders.nf_entrada_itens e where e.pedido_id = base.id and ltrim(substr(e.chave, 26, 9), '0') = dig))
    union all
    -- chave de 44 dígitos colada inteira
    select id, 'NF ' || ltrim(substr(regexp_replace(b, '\D', '', 'g'), 26, 9), '0') from base
     where length(regexp_replace(coalesce(b, ''), '\D', '', 'g')) = 44 and (chave_nfe = regexp_replace(b, '\D', '', 'g')
             or exists (select 1 from compras.nf_vinculos v where v.pedido_id = base.id and v.chave = regexp_replace(b, '\D', '', 'g'))
             or exists (select 1 from orders.nf_entrada_itens e where e.pedido_id = base.id and e.chave = regexp_replace(b, '\D', '', 'g')))
    union all
    -- item do pedido: descrição ou nosso código
    select i.pedido_id, 'item: ' || i.descricao from base join compras.itens i on i.pedido_id = base.id
     where b is not null and length(b) >= 3 and (i.descricao ilike '%' || b || '%' or i.produto_cod ilike '%' || b || '%')
    union all
    -- item como o fornecedor escreveu na NF (código ou nome dele)
    select e.pedido_id, 'na NF: ' || coalesce(e.cod_forn || ' · ', '') || e.desc_forn from base join orders.nf_entrada_itens e on e.pedido_id = base.id
     where b is not null and length(b) >= 3 and (e.desc_forn ilike '%' || b || '%' or e.cod_forn ilike '%' || b || '%')
  ), sel as (
    select pedido_id, (array_agg(bate order by bate) filter (where bate is not null))[1:3] bate from m group by pedido_id
  ), it as (
    select i.pedido_id, i.seq, i.descricao, i.unidade, i.qtd, compras.item_vu_total(i) vu,
           least(i.qtd, case when p.etapa in ('60', '80') then coalesce(nullif(i.qtd_recebida, 0), i.qtd)
                             else greatest(coalesce(i.qtd_recebida, 0),
                                           coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id), 0)) end) rec
      from sel join compras.pedidos p on p.id = sel.pedido_id join compras.itens i on i.pedido_id = p.id
  ), ag as (
    select pedido_id, sum(qtd * vu) tot, sum(rec * vu) rec_valor,
           jsonb_agg(jsonb_build_object('seq', seq, 'desc', descricao, 'un', unidade, 'qtd', qtd, 'rec', rec) order by seq)
             filter (where rec < qtd - 0.0001) faltam
      from it group by pedido_id
  )
  select coalesce(jsonb_agg(x order by x->>'emissao' desc, (x->>'num') desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
      'id', p.id, 'num', p.numero, 'emissao', p.emissao, 'previsao', p.previsao, 'etapa', p.etapa, 'aprov', p.aprov_status,
      'projeto', p.projeto_nome, 'comprador', p.comprador, 'valor', p.valor_total, 'origem', p.origem,
      'fornecedor', p.fornecedor_nome, 'fornecedorCod', p.fornecedor_cod,
      'nf', coalesce(nullif(p.nf, ''), (select string_agg(distinct ltrim(substr(v.chave, 26, 9), '0'), ', ') from compras.nf_vinculos v where v.pedido_id = p.id and v.status = 'confirmado')),
      'faturado', p.dt_faturado, 'recebidoEm', p.dt_rec, 'bate', to_jsonb(sel.bate),
      'faltaValor', greatest(0, round(coalesce(ag.tot, 0) - coalesce(ag.rec_valor, 0), 2)),
      'faltam', coalesce(ag.faltam, '[]'::jsonb),
      'entrega', case when coalesce(ag.tot, 0) > 0 and coalesce(ag.rec_valor, 0) >= ag.tot - 0.01 then 'recebido'
                      when coalesce(ag.rec_valor, 0) > 0.01 then 'parcial'
                      when p.etapa = '40' or exists (select 1 from compras.nf_vinculos v where v.pedido_id = p.id and v.status = 'confirmado') then 'faturado'
                      when p.previsao < current_date then 'atrasado'
                      else 'aguardando' end) x
      from sel join compras.pedidos p on p.id = sel.pedido_id left join ag on ag.pedido_id = p.id
     order by p.emissao desc limit 300) s;
  return r;
end $function$;
grant execute on function orders.compras_consulta_pedidos(text, bigint, date, text) to service_role;

-- Títulos a pagar só dos pedidos informados (Omie pelo nº do PC + painel pelo pedido)
create or replace function orders.compras_pagamentos_dos_pedidos(p_empresa text, p_ids bigint[])
returns jsonb language sql stable security definer set search_path to 'compras', 'finance', 'public' as $function$
  with ped as (select id, ltrim(numero, '0') num, fornecedor_cod forn from compras.pedidos where id = any(p_ids) and empresa = p_empresa),
  om as (
    select 'omie'::text origem, t.cod_titulo::text ref, ped.num pc, ped.id pid,
           coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela parc,
           t.emissao::date emissao, t.vencimento::date venc, coalesce(t.valor_documento, 0) valor,
           greatest(coalesce(t.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P'), 0)) pago,
           coalesce(t.pagamento::date, (select max(b.data) from finance.baixas b where b.cod_titulo = t.cod_titulo and b.estornado_em is null and b.natureza = 'P')) pago_em,
           t.status_titulo st, t.contraparte forn,
           (t.codigo_categoria = '2.08.01' or coalesce(t.numero_documento, '') ilike '%-ANT') antec
      from finance.v_titulos_omie_bruto t
      join ped on ped.num = ltrim(nullif(trim(split_part(coalesce(t.numero_pedido, ''), ',', 1)), ''), '0')
     where t.tipo = 'pagar' and t.empresa = p_empresa and coalesce(t.status_titulo, '') not in ('EXCLUIDO', 'CANCELADO')
       and t.codigo_cliente_fornecedor in (select forn from ped) -- usa o índice por fornecedor
  ),
  pa as (
    select 'painel'::text, v.pagar_id::text, ped.num, ped.id,
           coalesce(nullif(v.numero_documento_fiscal, ''), v.numero_documento), v.numero_parcela, v.emissao::date, v.vencimento::date,
           coalesce(v.valor_documento, 0), coalesce(v.valor_pago, 0), v.pago_em::date,
           case when v.quitado then 'PAGO' else v.status_titulo end, v.contraparte,
           (exists (select 1 from finance.pagar_previsto pp where pp.id::text = v.pagar_id::text and pp.antecipa_pedido_id is not null)
            or coalesce(v.numero_documento, '') ilike '%-ANT' or v.codigo_categoria = '2.08.01')
      from finance.v_pagar_previsto v
      join ped on ped.id = v.pedido_id or ped.num = ltrim(coalesce(v.numero_pedido, ''), '0')
     where v.empresa = p_empresa and v.origem <> 'OMIE'
       and (v.pedido_id in (select id from ped) or ltrim(coalesce(v.numero_pedido, ''), '0') in (select num from ped))
  ),
  tudo as (select * from om union all select * from pa)
  select coalesce(jsonb_agg(jsonb_build_object(
      'origem', origem, 'ref', ref, 'pc', pc, 'pedidoId', pid,
      'doc', doc, 'parcela', parc, 'emissao', emissao, 'vencimento', venc, 'valor', valor, 'pago', least(pago, valor), 'pagoEm', pago_em,
      'situacao', case when st in ('PAGO', 'LIQUIDADO') or pago >= valor - 0.01 then 'pago'
                       when pago > 0.01 then 'parcial'
                       when venc < current_date then 'atrasado' else 'a vencer' end,
      'fornecedor', forn, 'antecipado', coalesce(antec, false)) order by venc desc nulls last), '[]'::jsonb)
    from tudo
$function$;
grant execute on function orders.compras_pagamentos_dos_pedidos(text, bigint[]) to service_role;
