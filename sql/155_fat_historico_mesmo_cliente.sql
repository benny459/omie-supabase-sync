-- 155 · Últimos faturamentos: só documentos do MESMO cliente — 09/10/26
-- Benny (PV1979, CLINICA NEFROLOGICA BETA, 55.931.914/0001-68): "está trazendo os
-- últimos faturamentos, mas não pertencem a esse cliente claramente".
--
-- Causa (versão do sql/70): os títulos eram filtrados pelo CNPJ completo (certo),
-- mas os ITENS de cada faturamento eram buscados só pelo NÚMERO:
--   • v_titulos_omie_bruto.numero_pedido é o MESMO campo que num_os
--     (p.num_os AS numero_pedido) → todo título de PV (operacao 11) virava "OS";
--   • os itens vinham de sales.ordens_servico where numero_os = num_os — a OS
--     com esse número é de OUTRO cliente (PV1758 → OS1758 "SERVIÇO BOT…" de
--     50.567.288/0007-44; PV1399 → OS1399 "VISITA CONTRATUAL…" de
--     00.235.344/0001-80). Em SF eram 1.414 PVs nessa situação.
--   • títulos sem número de documento (NFE/BOL com num_titulo nulo) caíam todos
--     no mesmo grupo e somavam valores de faturamentos diferentes
--     (R$ 38.052,77 = 1.469,44 de 2026 + 36.583,33 de 2025).
-- Correção:
--   • um faturamento = a NF (cod_nf) ou o PV/OS (cod_os) ou o documento ou o
--     próprio título — nunca "sem número" agrupado;
--   • PV × OS pela operação do Omie (01 = OS, 11 = PV) e pelo vínculo real;
--   • itens pelo código interno do Omie (codigo_os / codigo_pedido = cod_os) e,
--     sem ele, pelo número SÓ quando o codigo_cliente do PV/OS é o do título
--     (cujo CNPJ é o pedido). Sem vínculo seguro → sem itens.
--   • parcelas soltas (RPTR/MANR sem PV/OS) só quando não há faturamento de PV/OS;
--   • cada entrada leva 'cliente_doc' (dígitos) para a API conferir.
-- Só leitura. service_role.

create or replace function orders.fat_historico_cliente(p_empresa text, p_doc text, p_lim int default 10)
returns jsonb
language sql stable security definer
set search_path = public, orders, finance, sales
as $$
with doc as (select regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') d),
tit as (
  select t.*,
    case when t.cod_nf is not null then 'nf:' || t.cod_nf::text
         when t.cod_os is not null then 'os:' || t.cod_os::text
         when coalesce(t.numero_documento, '') <> '' then 'doc:' || coalesce(t.tipo_documento, '') || ':' || t.numero_documento
         else 'tit:' || t.cod_titulo::text end as chave
  from finance.v_titulos_omie_bruto t, doc
  where t.natureza = 'R' and t.empresa = p_empresa and length(doc.d) >= 11
    and regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g') = doc.d
    and coalesce(t.status_titulo, '') not ilike 'CANCEL%'
),
-- ── Omie: um faturamento = uma NF / um PV-OS / um documento / um título
omie as (
  select t.empresa, t.chave,
         min(t.emissao) as emissao,
         sum(coalesce(t.valor_documento, 0)) as valor,
         max(t.tipo_documento) as tipo_documento,
         max(t.numero_documento) as numero_documento,
         max(t.num_doc_fiscal) as num_doc_fiscal,
         max(t.codigo_categoria) as categoria_codigo, max(t.categoria) as categoria,
         max(t.cod_cc) as conta_codigo, max(t.conta_corrente) as conta,
         max(t.codigo_projeto) as projeto_codigo, max(t.projeto) as projeto,
         max(t.cod_vendedor) as vendedor_codigo,
         max(t.num_os) as num_os, max(t.cod_os) as cod_os, max(t.operacao) as operacao,
         max(t.cod_cliente) as cod_cliente,
         max(t.num_contrato) as num_contrato,
         bool_or(coalesce(t.ret_iss, 'N') = 'S') as retem_iss,
         sum(coalesce(t.valor_iss, 0)) as valor_iss,
         jsonb_agg(jsonb_build_object(
           'numero', t.numero_parcela, 'vencimento', t.vencimento, 'valor', t.valor_documento,
           'dias', (t.vencimento - t.emissao), 'forma', t.tipo_documento)
           order by t.vencimento) as parcelas
  from tit t
  group by t.empresa, t.chave
),
-- Títulos soltos (parcelas de repetição RPTR / lançamento manual, sem PV/OS) não
-- são faturamentos: só entram se o cliente não tem nenhum faturamento de PV/OS
-- (ex.: CD, onde quase tudo é MANR).
omie_top as (
  select * from omie o
  where o.cod_os is not null or not exists (select 1 from omie o2 where o2.cod_os is not null)
  order by emissao desc nulls last limit greatest(p_lim, 1)),
-- PV ou OS (e os itens), sempre do mesmo cliente do título
omie_k as (
  select o.*,
    case when o.operacao = '01' then 'OS' when o.operacao = '11' then 'PV'
         when exists (select 1 from sales.ordens_servico s where s.empresa = o.empresa and s.codigo_os::text = o.cod_os::text) then 'OS'
         when exists (select 1 from sales.itens_vendidos i where i.empresa = o.empresa and i.codigo_pedido::text = o.cod_os::text) then 'PV'
    end as kind
  from omie_top o
),
omie_j as (
  select o.emissao,
    jsonb_build_object(
      'fonte', 'omie',
      'cliente_doc', (select d from doc),
      'emissao', o.emissao,
      'tipo', coalesce(case when coalesce(o.num_os, '') <> '' then o.kind end, o.tipo_documento),
      'documento', case
        when coalesce(o.numero_documento, '') <> '' then coalesce(o.tipo_documento, '') || ' ' || o.numero_documento
        when coalesce(o.num_doc_fiscal, '') <> '' then coalesce(o.tipo_documento, '') || ' NF ' || ltrim(o.num_doc_fiscal, '0')
        else o.tipo_documento end,
      'numero_fiscal', o.num_doc_fiscal,
      'origem', case when o.kind is not null and coalesce(o.num_os, '') <> '' then o.kind || o.num_os end,
      'valor', o.valor,
      'categoria_codigo', o.categoria_codigo, 'categoria', o.categoria,
      'conta_codigo', o.conta_codigo, 'conta', o.conta,
      'projeto_codigo', o.projeto_codigo, 'projeto', o.projeto,
      'vendedor_codigo', o.vendedor_codigo, 'contrato', o.num_contrato,
      'retem_iss', o.retem_iss, 'valor_iss', o.valor_iss,
      'forma', o.tipo_documento,
      'parcelas', o.parcelas,
      'itens', coalesce(
        case when o.kind = 'OS' then (
          select jsonb_agg(jsonb_build_object('codigo', s.codigo_servico, 'descricao', s.descricao_servico,
                   'quantidade', s.quantidade, 'valor_unitario', s.valor_unitario, 'unidade', 'UN') order by s.seq_item)
          from sales.ordens_servico s
          where s.empresa = o.empresa and s.codigo_cliente::text = o.cod_cliente::text
            and (s.codigo_os::text = o.cod_os::text
                 or (not exists (select 1 from sales.ordens_servico s2 where s2.empresa = o.empresa and s2.codigo_os::text = o.cod_os::text)
                     and coalesce(o.num_os, '') <> '' and s.numero_os = o.num_os)))
        when o.kind = 'PV' then (
          select jsonb_agg(jsonb_build_object('codigo', i.codigo_produto, 'descricao', i.descricao, 'ncm', i.ncm,
                   'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'unidade', i.unidade) order by i.codigo_item)
          from sales.itens_vendidos i
          where i.empresa = o.empresa and i.codigo_cliente::text = o.cod_cliente::text
            and (i.codigo_pedido::text = o.cod_os::text
                 or (not exists (select 1 from sales.itens_vendidos i2 where i2.empresa = o.empresa and i2.codigo_pedido::text = o.cod_os::text)
                     and coalesce(o.num_os, '') <> '' and i.numero_pedido = o.num_os)))
        end, '[]'::jsonb)
    ) as j
  from omie_k o
),
-- ── Painel: emissões autorizadas (produção) para o mesmo CNPJ/CPF
painel as (
  select coalesce(e.autorizada_em, e.created_at)::date as emissao,
    jsonb_build_object(
      'fonte', 'painel',
      'cliente_doc', doc.d,
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
  where e.empresa = p_empresa and e.status = 'autorizada' and e.ambiente = 'producao' and length(doc.d) >= 11
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
