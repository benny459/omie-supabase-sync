-- 78 (05/10/26): OS do Omie faturam pelo painel (recibo editável) + carteira mais leve.
--   orders.fat_os_omie_doc        → documento da OS do Omie (espelho) para a folha de emissão
--   orders.fat_receber_resumo     → reescrita: v_erp_vendas avaliada uma vez (era 6 s / 200 rótulos)
--   orders.fat_carteira           → OS do Omie com emite=true (recibo) e notas do painel (os_omie);
--                                   com busca, pré-filtro por número/cliente/descrição antes de montar.
-- Migrações: p78_fat_os_omie_doc, p78_fat_receber_resumo_rapido, p78_fat_carteira_os_recibo, p78_fat_emissoes_origem_os_omie.

create or replace function orders.fat_carteira(p_empresa text default 'SF', p_desde date default null, p_busca text default null)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
with
par as (select case when nullif(trim(coalesce(p_busca, '')), '') is not null then date '2000-01-01'
                    else coalesce(p_desde, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date) end as desde,
                nullif(lower(trim(coalesce(p_busca, ''))), '') as q),
-- p78: com busca, primeira palavra pré-filtra clientes e documentos (o filtro completo continua no fim)
w1 as (select '%' || split_part((select q from par), ' ', 1) || '%' as pat where (select q from par) is not null),
cli_q as materialized (
  select pe.codigo::text as cod from cadastros.pessoas pe, w1
   where pe.empresa = p_empresa
     and (lower(coalesce(pe.razao_social, '')) like w1.pat or lower(coalesce(pe.nome_fantasia, '')) like w1.pat)
  union
  select c.codigo_cliente_omie::text from finance.clientes c, w1
   where c.empresa = p_empresa
     and (lower(coalesce(c.razao_social, '')) like w1.pat or lower(coalesce(c.nome_fantasia, '')) like w1.pat)
),
cfg as (select coalesce((select tipo_os from orders.fat_config where empresa = p_empresa), 'recibo') as tipo_os),
ov as (select chave, previsao from orders.fat_previsao_override),
nsm as (
  select c as chave,
         jsonb_agg(jsonb_build_object('id', m.id, 'num', 'NFS-e ' || m.numero, 'valor', m.valor_servicos, 'status', 'autorizada',
           'data', m.data_emissao, 'ambiente', 'producao', 'fonte', 'prefeitura', 'nfse_manual', true,
           'pdf', m.pdf_path is not null, 'xml', m.xml_path is not null, 'municipio', m.municipio) order by m.id) as nfs
  from orders.fat_nfse_manual m, unnest(m.os_chaves) c
  where m.empresa = p_empresa and m.status = 'registrada'
  group by c
),
em as (
  select e.id, e.origem_tipo, e.origem_id, e.tipo, e.ambiente, e.status, e.numero, e.serie,
         e.valor_total, e.mensagem, e.created_at, e.autorizada_em, (e.xml_path is not null) tem_xml, (e.pdf_path is not null) tem_pdf
  from orders.fat_emissoes e
  where e.empresa = p_empresa and not coalesce(e.ensaio, false)
),
nfo as (
  select n.raw -> 'compl' ->> 'nIdPedido' as pid,
         jsonb_agg(jsonb_build_object('num', 'NF-e ' || (n.numero)::int, 'valor', n.valor_total, 'status', 'autorizada',
           'data', n.emissao, 'ambiente', 'producao', 'fonte', 'omie', 'nid', n.raw -> 'compl' ->> 'nIdNF', 'chave', n.raw -> 'compl' ->> 'cChaveNFe') order by n.emissao) as nfs
  from sales.nfe_saida n
  where n.empresa = p_empresa and not n.cancelada and n.raw -> 'compl' ->> 'nIdPedido' is not null
  group by 1
),
emg as (
  select e.origem_tipo, e.origem_id,
         jsonb_agg(jsonb_build_object('id', e.id, 'num', case e.tipo when 'nfe' then 'NF-e' when 'nfse' then 'NFS-e' else 'Recibo' end
           || coalesce(' ' || e.numero, ''), 'valor', e.valor_total, 'status', e.status, 'data', coalesce(e.autorizada_em, e.created_at)::date,
           'ambiente', e.ambiente, 'msg', e.mensagem, 'xml', e.tem_xml, 'pdf', e.tem_pdf, 'fonte', 'painel') order by e.id) as nfs
  from em e group by 1, 2
),
pv as (
  select p.codigo_pedido, p.numero_pedido, p.etapa, p.valor_total, p.num_pedido_cliente,
         to_date(nullif(p.d_inc, ''), 'DD/MM/YYYY') as emissao,
         orders.fat_data_br(p.data_previsao) as prev_orig,
         coalesce(pe.razao_social, c.razao_social) as cliente,
         nullif(trim(coalesce(pe.nome_fantasia, c.nome_fantasia, '')), '') as fantasia,
         regexp_replace(coalesce(pe.cnpj_cpf, pe.doc, ''), '\D', '', 'g') as doc,
         regexp_replace(coalesce(pe.cep, ''), '\D', '', 'g') as cep, pe.cidade_ibge,
         coalesce(nfo.nfs, '[]'::jsonb) as nfs_omie,
         coalesce(emg.nfs, '[]'::jsonb) as nfs_painel
  from sales.pedidos_venda p
  left join nfo on nfo.pid = p.codigo_pedido::text
  left join emg on emg.origem_tipo = 'pv_omie' and emg.origem_id = p.codigo_pedido::text
  left join cadastros.pessoas pe on pe.empresa = p.empresa and pe.codigo = p.codigo_cliente
  left join finance.clientes c on c.empresa = p.empresa and c.codigo_cliente_omie = p.codigo_cliente
  where p.empresa = p_empresa and p.codigo_pedido < 9000000000000
    and (p.etapa in ('10', '20', '50') or (p.etapa in ('60', '70') and nfo.pid is not null))
    and ((select q from par) is null
         or p.codigo_cliente::text in (select cod from cli_q)
         or ('pv' || p.numero_pedido) like (select pat from w1)
         or lower(coalesce(p.num_pedido_cliente, '')) like (select pat from w1))
),
pv_doc as (
  select jsonb_build_object(
    'chave', 'pv_omie:' || codigo_pedido, 'codigo', codigo_pedido, 'tipo', 'PV', 'rotulo', 'PV' || numero_pedido,
    'origem', 'Omie', 'etapa', etapa, 'cliente', coalesce(fantasia, cliente), 'fantasia', fantasia, 'razao', cliente,
    'oc', nullif(num_pedido_cliente, ''),
    'valor', valor_total, 'emissao', emissao,
    'previsao', coalesce(ov.previsao, prev_orig),
    'previsao_origem', case when ov.previsao is not null then 'painel' when prev_orig is not null then 'omie' end,
    'previsao_original', prev_orig,
    'faturado', least(valor_total, greatest(
        (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(nfs_omie || nfs_painel) x
          where x->>'status' = 'autorizada' and x->>'ambiente' = 'producao'),
        case when etapa in ('60', '70') then valor_total else 0 end)),
    'nfs', nfs_omie || nfs_painel,
    'pend', to_jsonb(array_remove(array[
        case when length(doc) not in (11, 14) then 'Cliente sem CNPJ/CPF no cadastro' end,
        case when length(cep) <> 8 then 'Cliente sem CEP válido' end,
        case when coalesce(cidade_ibge, '') = '' then 'Cliente sem município (IBGE)' end,
        case when coalesce(valor_total, 0) <= 0 then 'Valor zerado' end], null)),
    'emite', true) as d,
    etapa, emissao, nfs_omie, nfs_painel
  from pv
  left join ov on ov.chave = 'pv_omie:' || pv.codigo_pedido
),
os as (
  select o.codigo_os, max(o.numero_os) numero_os, max(o.etapa) etapa, max(o.codigo_cliente) codigo_cliente,
         sum(o.valor_total) valor, max(o.faturada) faturada, max(o.dt_fat_d) dt_fat, min(o.d_inc_d) emissao,
         max(orders.fat_data_br(o.dt_previsao)) prev_orig,
         max(o.num_recibo) num_recibo,
         string_agg(distinct nullif(o.descricao_servico, ''), ' · ') descricao,
         jsonb_agg(jsonb_build_object('desc', o.descricao_servico, 'qtd', o.quantidade, 'vt', o.valor_total) order by o.seq_item) itens
  from sales.ordens_servico o
  where o.empresa = p_empresa and coalesce(o.cancelada, 'N') <> 'S'
    and not (o.codigo_os ~ '^\d+$' and o.codigo_os::numeric >= 9000000000000)
    and ((coalesce(o.faturada, 'N') <> 'S' and o.etapa < '60') or o.dt_fat_d >= (select desde from par))
    and ((select q from par) is null
         or o.codigo_cliente in (select cod from cli_q)
         or ('os' || o.numero_os) like (select pat from w1)
         or lower(coalesce(o.descricao_servico, '')) like (select pat from w1))
  group by o.codigo_os
),
os_doc as (
  select jsonb_build_object(
    'chave', 'os_omie:' || os.codigo_os, 'codigo', os.codigo_os, 'tipo', 'OS', 'rotulo', 'OS' || os.numero_os,
    'origem', 'Omie', 'etapa', os.etapa,
    'cliente', coalesce(nullif(trim(coalesce(pe.nome_fantasia, c.nome_fantasia, '')), ''), pe.razao_social, c.razao_social),
    'fantasia', nullif(trim(coalesce(pe.nome_fantasia, c.nome_fantasia, '')), ''),
    'razao', coalesce(pe.razao_social, c.razao_social), 'oc', null,
    'valor', os.valor, 'emissao', os.emissao, 'descricao', left(os.descricao, 160), 'itens', os.itens,
    'previsao', coalesce(ov.previsao, os.prev_orig),
    'previsao_origem', case when ov.previsao is not null then 'painel' when os.prev_orig is not null then 'omie' end,
    'previsao_original', os.prev_orig,
    'faturado', case when os.faturada = 'S' or nsm.chave is not null then os.valor
                     else least(os.valor, (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(coalesce(eo.nfs, '[]'::jsonb)) x
                                           where x->>'status' = 'autorizada' and x->>'ambiente' = 'producao')) end,
    'nfs', (case when os.faturada = 'S' then jsonb_build_array(jsonb_build_object(
        'num', coalesce('Recibo ' || nullif(os.num_recibo, ''), 'Faturada no Omie'), 'valor', os.valor,
        'status', 'autorizada', 'data', os.dt_fat, 'ambiente', 'producao', 'fonte', 'omie')) else '[]'::jsonb end)
        || coalesce(nsm.nfs, '[]'::jsonb) || coalesce(eo.nfs, '[]'::jsonb),
    'nfse', true, 'nfse_registrada', nsm.chave is not null, 'aguarda_nfse', (select tipo_os from cfg) = 'nfse',
    'pend', to_jsonb(array_remove(array[
        case when coalesce(os.valor, 0) <= 0 then 'Valor zerado' end], null)),
    -- p78: OS do Omie faturam pelo painel (recibo editável); NFS-e da prefeitura segue em "Registrar NFS-e".
    'emite', os.faturada is distinct from 'S' and nsm.chave is null) as d,
    case when nsm.chave is not null or exists (select 1 from jsonb_array_elements(coalesce(eo.nfs, '[]'::jsonb)) x
                                               where x->>'status' = 'autorizada' and x->>'ambiente' = 'producao') then 'S' else os.faturada end as faturada,
    coalesce((select max((x->>'data')::date) from jsonb_array_elements(coalesce(nsm.nfs, '[]'::jsonb) || coalesce(eo.nfs, '[]'::jsonb)) x
              where x->>'status' = 'autorizada'), os.dt_fat) as dt_fat, os.etapa
  from os
  left join cadastros.pessoas pe on pe.empresa = p_empresa and pe.codigo::text = os.codigo_cliente
  left join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie::text = os.codigo_cliente
  left join nsm on nsm.chave = 'os_omie:' || os.codigo_os
  left join emg eo on eo.origem_tipo = 'os_omie' and eo.origem_id = os.codigo_os
  left join ov on ov.chave = 'os_omie:' || os.codigo_os
),
nat as (
  select v.*,
         (select coalesce(jsonb_agg(x), '[]'::jsonb) from emg, jsonb_array_elements(emg.nfs) x
           where emg.origem_tipo in ('pv', 'os', 'venda') and emg.origem_id = v.id::text)
           || coalesce((select n.nfs from nsm n where n.chave = 'venda:' || v.id), '[]'::jsonb) as nfs,
         exists (select 1 from nsm n where n.chave = 'venda:' || v.id) as nfse_reg,
         regexp_replace(coalesce(v.cliente_cnpj, pe.cnpj_cpf, ''), '\D', '', 'g') as doc,
         regexp_replace(coalesce(pe.cep, ''), '\D', '', 'g') as cep, pe.cidade_ibge,
         nullif(trim(coalesce(pe.nome_fantasia, '')), '') as fantasia,
         orders.fat_data_br(v.previsao::text) as prev_orig
  from vendas.documentos v
  left join cadastros.pessoas pe on pe.empresa = v.empresa and pe.codigo = v.cliente_codigo
  where v.empresa = p_empresa and v.status <> 'cancelado'
),
nat_doc as (
  select jsonb_build_object(
    'chave', 'venda:' || id, 'codigo', id, 'tipo', tipo, 'rotulo', tipo || numero,
    'proposta', nullif(proposta, ''), 'sem_proposta', proposta_dispensa_motivo,
    'origem', case when origem = 'crm' then 'CRM' else 'Painel' end, 'etapa', etapa,
    'cliente', coalesce(fantasia, cliente_nome), 'fantasia', fantasia, 'razao', cliente_nome,
    'oc', nullif(num_pedido_cliente, ''), 'valor', valor_total, 'emissao', emissao,
    'previsao', coalesce(ov.previsao, prev_orig),
    'previsao_origem', case when ov.previsao is not null then 'painel' when prev_orig is not null then 'documento' end,
    'previsao_original', prev_orig,
    'faturado', case when status = 'faturado' then valor_total else least(valor_total,
        (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(nfs) x
          where x->>'status' = 'autorizada' and x->>'ambiente' = 'producao')) end,
    'nfs', nfs,
    'pend', to_jsonb(array_remove(array[
        case when length(doc) not in (11, 14) then 'Cliente sem CNPJ/CPF no cadastro' end,
        case when length(cep) <> 8 then 'Cliente sem CEP válido' end,
        case when coalesce(cidade_ibge, '') = '' then 'Cliente sem município (IBGE)' end,
        case when coalesce(valor_total, 0) <= 0 then 'Valor zerado' end], null)),
    'emite', true, 'nfse', tipo = 'OS', 'nfse_registrada', nfse_reg, 'aguarda_nfse', tipo = 'OS' and (select tipo_os from cfg) = 'nfse') as d,
    status, dt_fat, emissao, nfs
  from nat
  left join ov on ov.chave = 'venda:' || nat.id
)
select jsonb_build_object(
  'desde', (select desde from par),
  'docs', coalesce((
    select jsonb_agg(d) from (
      select d from pv_doc
       where etapa in ('10', '20', '50')
          or exists (select 1 from jsonb_array_elements(nfs_omie || nfs_painel) x
                      where x->>'status' = 'autorizada' and (x->>'data')::date >= (select desde from par))
      union all
      select d from os_doc
       where (coalesce(faturada, 'N') <> 'S' and etapa < '60')
          or (faturada = 'S' and dt_fat >= (select desde from par))
      union all
      select d from nat_doc
       where status = 'aberto' or coalesce(dt_fat, emissao) >= (select desde from par)
    ) t
    where (select q from par) is null
       or not exists (select 1 from unnest(regexp_split_to_array((select q from par), '\s+')) w
                    where w <> '' and lower(concat_ws(' ', d->>'rotulo', d->>'cliente', d->>'razao', d->>'fantasia', d->>'oc', d->>'descricao', d->>'proposta'))
                          not like '%' || w || '%')), '[]'::jsonb),
  'busca', (select q from par)
);
$function$;

-- ───────────────────────── p78_fat_emissoes_origem_os_omie
alter table orders.fat_emissoes drop constraint if exists fat_emissoes_origem_tipo_check;
alter table orders.fat_emissoes add constraint fat_emissoes_origem_tipo_check
  check (origem_tipo = any (array['pv','os','venda','manual','teste','pv_omie','os_omie']));

-- ───────────────────────── p78_fat_os_omie_doc
create or replace function orders.fat_os_omie_doc(p_empresa text, p_codigo text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
with o as (
  select * from sales.ordens_servico
   where empresa = p_empresa and codigo_os = p_codigo and coalesce(cancelada, 'N') <> 'S'
),
h as (
  select max(numero_os) numero_os, max(etapa) etapa, max(codigo_cliente) codigo_cliente,
         sum(valor_total) valor_total, max(dt_previsao) dt_previsao, max(codigo_categoria) codigo_categoria,
         max(codigo_projeto) codigo_projeto, max(codigo_cc) codigo_cc, max(codigo_parcela) codigo_parcela,
         max(qtd_parcelas) qtd_parcelas, max(codigo_vendedor) codigo_vendedor, max(faturada) faturada,
         max(num_recibo) num_recibo, max(numero_contrato) numero_contrato, min(d_inc_d) emissao,
         bool_or(coalesce(retem_iss, 'N') = 'S') retem_iss, sum(coalesce(valor_iss, 0)) valor_iss,
         bool_or(coalesce(retem_inss, 'N') = 'S') retem_inss, sum(coalesce(valor_inss, 0)) valor_inss,
         string_agg(coalesce(descricao_servico, ''), ' ') texto
  from o
),
-- "DADOS BANCÁRIOS: BRADESCO /AGENCIA: 0368/ C/C: 266910-2" no texto da OS → conta nativa
banco as (
  select ltrim(regexp_replace(substring(upper(h.texto) from 'AG[EÊ]NCIA:?\s*([0-9X\-]+)'), '\D', '', 'g'), '0') ag,
         ltrim(regexp_replace(substring(upper(h.texto) from 'C/?C:?\s*([0-9\-]+)'), '\D', '', 'g'), '0') cc
  from h
),
conta_txt as (
  select c.cod_cc from finance.contas_correntes c, banco b
   where c.empresa = p_empresa and coalesce(c.inativo, 'N') <> 'S' and b.cc <> ''
     and ltrim(regexp_replace(coalesce(c.numero_conta_corrente, ''), '\D', '', 'g'), '0') = b.cc
     and (b.ag = '' or ltrim(regexp_replace(coalesce(c.codigo_agencia, ''), '\D', '', 'g'), '0') = b.ag)
   order by (c.descricao ilike 'aplica%'), c.cod_cc
   limit 1
)
select case when (select numero_os from h) is null then null else jsonb_build_object(
  'os', (select to_jsonb(h) - 'texto' from h),
  'conta_texto', (select cod_cc from conta_txt),
  'itens', coalesce((select jsonb_agg(jsonb_build_object(
      'seq', o.seq_item, 'codigo', o.codigo_servico, 'descricao', o.descricao_servico,
      'quantidade', o.quantidade, 'valor_unitario', o.valor_unitario, 'valor_total', o.valor_total,
      'aliq_iss', o.aliq_iss) order by o.seq_item) from o), '[]'::jsonb),
  'cliente', (select to_jsonb(pe) from cadastros.pessoas pe, h
               where pe.empresa = p_empresa and pe.codigo::text = h.codigo_cliente),
  'cliente_omie', (select to_jsonb(c) from finance.clientes c, h
               where c.empresa = p_empresa and c.codigo_cliente_omie::text = h.codigo_cliente),
  'condicao', (select fp.descricao from sales.formas_pagamento fp, h where fp.empresa = p_empresa and fp.codigo = h.codigo_parcela),
  'parcelas_dias', (select jsonb_agg(x.dias order by x.numero)
      from h, vendas.parcelas_da_condicao(p_empresa, h.codigo_parcela, nullif(h.qtd_parcelas, '')::numeric::int, current_date, h.valor_total) x),
  'nfse_registrada', exists (select 1 from orders.fat_nfse_manual m
      where m.empresa = p_empresa and m.status = 'registrada' and ('os_omie:' || p_codigo) = any(m.os_chaves)),
  'emissao_painel', (select jsonb_build_object('id', e.id, 'status', e.status, 'numero', e.numero, 'tipo', e.tipo)
      from orders.fat_emissoes e where e.empresa = p_empresa and e.origem_tipo = 'os_omie' and e.origem_id = p_codigo
        and not coalesce(e.ensaio, false) and e.ambiente = 'producao' and e.status in ('processando', 'autorizada') limit 1)
) end
$function$;
revoke all on function orders.fat_os_omie_doc(text, text) from public, anon, authenticated;
grant execute on function orders.fat_os_omie_doc(text, text) to service_role;

-- ───────────────────────── p78_fat_receber_resumo_rapido
create or replace function orders.fat_receber_resumo(p_empresa text, p_labels text[])
 returns jsonb language sql stable security definer set search_path to ''
as $function$
with
lbl as materialized (select distinct upper(l) as label from unnest(p_labels) l where l ~* '^(PV|OS)\d+$'),
num as materialized (select distinct substring(label from 3) as n from lbl),
-- v_erp_vendas é cara: avalia uma vez só, já restrita aos números pedidos (p78, 05/10/26)
ev as materialized (
  select e.label, e.tipo, e.numero, e.nf, e.emissao
    from sales.v_erp_vendas e
   where e.empresa = p_empresa and not coalesce(e.cancelado, false)
     and (e.numero in (select n from num) or e.label in (select label from lbl))
),
vr as materialized (
  select v.*, coalesce(nullif(v.numero_pedido, ''), nullif(v.num_os, '')) as kn
    from finance.v_receber v
   where v.empresa = p_empresa
     and upper(coalesce(v.status_titulo, '')) <> 'CANCELADO'
     and (coalesce(nullif(v.numero_pedido, ''), nullif(v.num_os, '')) in (select n from num)
          or upper(coalesce(nullif(v.numero_pedido, ''), nullif(v.num_os, ''))) in (select label from lbl))
),
rec as (
  select x.label, v.num_parcela, v.vencimento, v.valor_documento,
         greatest(coalesce(v.valor_pago, 0), coalesce(v.valor_pago_painel, 0)) as recebido,
         coalesce(v.pago_em_painel, v.pagamento) as pago_em,
         v.status_titulo, v.tipo_documento, v.conta_corrente,
         coalesce(v.num_doc_fiscal, v.numero_documento_fiscal) as nf, v.origem_registro
    from vr v
    left join ev pv on pv.tipo = 'PV' and pv.numero = v.kn
    left join ev os on os.tipo = 'OS' and os.numero = v.kn
   cross join lateral (select case
            when v.kn ~* '^(PV|OS)\d+$' then upper(v.kn)
            when pv.label is not null and (os.label is null
                 or ltrim(coalesce(v.num_doc_fiscal, ''), '0') = ltrim(coalesce(pv.nf, ''), '0')) then pv.label
            when os.label is not null then os.label end as label) x
    left join ev e on e.label = x.label
   where x.label in (select label from lbl)
     and (v.emissao is null or e.emissao is null or v.emissao >= e.emissao - 60)
),
pz as (
  select 'PV' || p.numero_pedido as label, p.codigo_parcela as cod from sales.pedidos_venda p
   where p.empresa = p_empresa and p.numero_pedido in (select n from num)
  union all
  select distinct 'OS' || o.numero_os, o.codigo_parcela from sales.ordens_servico o
   where o.empresa = p_empresa and o.numero_os in (select n from num)
  union all
  select d.tipo || d.numero, d.condicao_codigo from vendas.documentos d
   where d.empresa = p_empresa and d.tipo || d.numero in (select label from lbl)
),
pzd as (
  select label, min(case when cod ~ '^A\d+$' then substring(cod from 2)::int when cod in ('000', 'A') then 0 end) as prazo_dias
    from pz where label in (select label from lbl) group by 1
)
select coalesce(jsonb_object_agg(l.label, jsonb_build_object(
  'n', coalesce(r.n, 0), 'rec_n', coalesce(r.rec_n, 0), 'total', coalesce(r.total, 0), 'recebido', coalesce(r.recebido, 0),
  'prox_venc', r.prox_venc, 'prox_valor', r.prox_valor, 'vencidas', coalesce(r.vencidas, 0), 'venc_antigo', r.venc_antigo,
  'ult_receb', r.ult_receb, 'prazo_dias', pzd.prazo_dias,
  'parcelas', coalesce(r.parcelas, '[]'::jsonb))), '{}'::jsonb)
from lbl l
left join pzd on pzd.label = l.label
left join lateral (
  select count(*) n,
         count(*) filter (where recebido >= valor_documento - 0.01) rec_n,
         sum(valor_documento) total, sum(least(recebido, valor_documento)) recebido,
         min(vencimento) filter (where recebido < valor_documento - 0.01) prox_venc,
         (array_agg(valor_documento - recebido order by vencimento) filter (where recebido < valor_documento - 0.01))[1] prox_valor,
         count(*) filter (where recebido < valor_documento - 0.01 and vencimento < current_date) vencidas,
         min(vencimento) filter (where recebido < valor_documento - 0.01 and vencimento < current_date) venc_antigo,
         max(pago_em) filter (where recebido > 0) ult_receb,
         jsonb_agg(jsonb_build_object('parcela', num_parcela, 'vencimento', vencimento, 'valor', valor_documento, 'recebido', recebido,
           'pago_em', pago_em, 'status', status_titulo, 'forma', tipo_documento, 'conta', conta_corrente, 'nf', nf,
           'origem', origem_registro) order by vencimento) parcelas
    from rec where rec.label = l.label
) r on true;
$function$;
