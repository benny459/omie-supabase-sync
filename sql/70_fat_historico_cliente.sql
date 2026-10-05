-- 70 · Nova emissão: últimos faturamentos do cliente ("usar como modelo") — 05/10/26
-- Benny: "ao selecionar um cliente, mostra os últimos faturamentos, porque às
-- vezes vou fazer um faturamento igualzinho ao anterior … mesma modalidade".
--
-- orders.fat_historico_cliente(empresa, cnpj/cpf, lim) → jsonb[] com o que o
-- formulário precisa para copiar: data, tipo, número, valor, itens, parcelas
-- (com o prazo em dias desde a emissão, para recalcular a partir de hoje),
-- forma (tipo de documento do título), conta corrente, categoria, projeto,
-- vendedor, OC/pedido. Fontes:
--   • emissões do painel autorizadas (orders.fat_emissoes) + as parcelas que
--     criaram em finance.receber;
--   • histórico do Omie: títulos a receber (finance.v_titulos_omie_bruto,
--     natureza R) agrupados por documento, itens da OS (sales.ordens_servico)
--     ou do PV (sales.itens_vendidos).
-- Só leitura. service_role.

create or replace function orders.fat_historico_cliente(p_empresa text, p_doc text, p_lim int default 10)
returns jsonb
language sql stable security definer
set search_path = public, orders, finance, sales
as $$
with doc as (select regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') d),
-- ── Omie: um faturamento = um documento (tipo + número) com as suas parcelas
omie as (
  select t.empresa, t.tipo_documento, t.numero_documento,
         min(t.emissao) as emissao,
         sum(coalesce(t.valor_documento, 0)) as valor,
         max(t.num_doc_fiscal) as num_doc_fiscal,
         max(t.codigo_categoria) as categoria_codigo, max(t.categoria) as categoria,
         max(t.cod_cc) as conta_codigo, max(t.conta_corrente) as conta,
         max(t.codigo_projeto) as projeto_codigo, max(t.projeto) as projeto,
         max(t.cod_vendedor) as vendedor_codigo,
         max(t.numero_pedido) as numero_pedido, max(t.num_os) as num_os,
         max(t.num_contrato) as num_contrato,
         bool_or(coalesce(t.ret_iss, 'N') = 'S') as retem_iss,
         sum(coalesce(t.valor_iss, 0)) as valor_iss,
         jsonb_agg(jsonb_build_object(
           'numero', t.numero_parcela, 'vencimento', t.vencimento, 'valor', t.valor_documento,
           'dias', (t.vencimento - t.emissao), 'forma', t.tipo_documento)
           order by t.vencimento) as parcelas
  from finance.v_titulos_omie_bruto t, doc
  where t.natureza = 'R' and t.empresa = p_empresa and doc.d <> ''
    and regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g') = doc.d
    and coalesce(t.status_titulo, '') not ilike 'CANCEL%'
  group by t.empresa, t.tipo_documento, t.numero_documento
),
omie_top as (select * from omie order by emissao desc nulls last limit greatest(p_lim, 1)),
omie_j as (
  select o.emissao,
    jsonb_build_object(
      'fonte', 'omie',
      'emissao', o.emissao,
      'tipo', case when o.num_os is not null and o.num_os <> '' then 'OS'
                   when o.numero_pedido is not null and o.numero_pedido <> '' then 'PV' else o.tipo_documento end,
      'documento', o.tipo_documento || ' ' || o.numero_documento,
      'numero_fiscal', o.num_doc_fiscal,
      'origem', case when coalesce(o.num_os, '') <> '' then 'OS' || o.num_os
                     when coalesce(o.numero_pedido, '') <> '' then 'PV' || o.numero_pedido end,
      'valor', o.valor,
      'categoria_codigo', o.categoria_codigo, 'categoria', o.categoria,
      'conta_codigo', o.conta_codigo, 'conta', o.conta,
      'projeto_codigo', o.projeto_codigo, 'projeto', o.projeto,
      'vendedor_codigo', o.vendedor_codigo, 'contrato', o.num_contrato,
      'retem_iss', o.retem_iss, 'valor_iss', o.valor_iss,
      'forma', o.tipo_documento,
      'parcelas', o.parcelas,
      'itens', coalesce(
        case when coalesce(o.num_os, '') <> '' then (
          select jsonb_agg(jsonb_build_object('codigo', s.codigo_servico, 'descricao', s.descricao_servico,
                   'quantidade', s.quantidade, 'valor_unitario', s.valor_unitario, 'unidade', 'UN') order by s.seq_item)
          from sales.ordens_servico s where s.empresa = o.empresa and s.numero_os = o.num_os)
        when coalesce(o.numero_pedido, '') <> '' then (
          select jsonb_agg(jsonb_build_object('codigo', i.codigo_produto, 'descricao', i.descricao, 'ncm', i.ncm,
                   'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'unidade', i.unidade) order by i.codigo_item)
          from sales.itens_vendidos i where i.empresa = o.empresa and i.numero_pedido = o.numero_pedido)
        end, '[]'::jsonb)
    ) as j
  from omie_top o
),
-- ── Painel: emissões autorizadas (produção) para o mesmo documento
painel as (
  select coalesce(e.autorizada_em, e.created_at)::date as emissao,
    jsonb_build_object(
      'fonte', 'painel',
      'emissao', coalesce(e.autorizada_em, e.created_at)::date,
      'tipo', case e.tipo when 'nfe' then 'PV' else 'OS' end,
      'documento', case e.tipo when 'nfe' then 'NF-e ' when 'recibo' then 'REC ' else 'NFS-e ' end || coalesce(e.numero::text, ''),
      'numero_fiscal', e.numero,
      'origem', e.origem_rotulo,
      'valor', e.valor_total,
      'itens', coalesce(e.itens, '[]'::jsonb),
      'condicao', e.condicao,
      'categoria_codigo', (select max(r.codigo_categoria) from finance.receber r where r.id = any(e.receber_ids)),
      'conta_codigo', (select max(r.id_conta_corrente) from finance.receber r where r.id = any(e.receber_ids)),
      'projeto_codigo', (select max(r.codigo_projeto) from finance.receber r where r.id = any(e.receber_ids)),
      'parcelas', coalesce((
        select jsonb_agg(jsonb_build_object('numero', r.numero_parcela, 'vencimento', r.vencimento, 'valor', r.valor,
                 'dias', (r.vencimento - r.emissao), 'forma', r.extras->>'forma') order by r.vencimento)
        from finance.receber r where r.id = any(e.receber_ids)), '[]'::jsonb)
    ) as j
  from orders.fat_emissoes e, doc
  where e.empresa = p_empresa and e.status = 'autorizada' and e.ambiente = 'producao' and doc.d <> ''
    and regexp_replace(coalesce(nullif(e.cliente->>'cnpj', ''), e.cliente->>'cpf', ''), '\D', '', 'g') = doc.d
  order by e.created_at desc
  limit greatest(p_lim, 1)
)
select coalesce(jsonb_agg(x.j order by x.emissao desc nulls last), '[]'::jsonb)
from (
  select * from (select emissao, j from omie_j union all select emissao, j from painel) u
  order by emissao desc nulls last limit greatest(p_lim, 1)
) x;
$$;

revoke all on function orders.fat_historico_cliente(text, text, int) from public, anon, authenticated;
grant execute on function orders.fat_historico_cliente(text, text, int) to service_role;

-- p70b: protocolo de autorização (painel de transmissão da Nova emissão).
alter table orders.fat_emissoes add column if not exists protocolo text;
