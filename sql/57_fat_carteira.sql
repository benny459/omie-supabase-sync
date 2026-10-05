-- 57 — Carteira de faturamento PV & OS (05/10/2026)
--
-- Uma linha por documento a faturar (ou faturado no período) para a tela
-- /faturamento no conceito "Faturamento PV & OS": PV (produto → NF-e) e OS
-- (serviço → NFS-e/recibo), do Omie ou nativos do painel. Só leitura.
--
--   faturado = soma das NF autorizadas ligadas ao documento (Omie + painel em
--              produção); PV em etapa 60/70 sem NF ligada conta como faturado
--              inteiro; OS do Omie faturada = valor inteiro.
--   nfs      = notas ligadas (Omie e painel, incluindo homologação — a tela
--              distingue pelo campo ambiente; ensaios ficam de fora).
--   pend     = pendências de cadastro que impedem emitir (barato, em SQL);
--              o pré-voo completo continua no botão Validar.

create or replace function orders.fat_carteira(p_empresa text default 'SF', p_desde date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
with
par as (select coalesce(p_desde, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date) as desde),
em as (
  select e.id, e.origem_tipo, e.origem_id, e.tipo, e.ambiente, e.status, e.numero, e.serie,
         e.valor_total, e.mensagem, e.created_at, e.autorizada_em, (e.xml_path is not null) tem_xml, (e.pdf_path is not null) tem_pdf
  from orders.fat_emissoes e
  where e.empresa = p_empresa and not coalesce(e.ensaio, false)
),
-- notas do Omie e do painel agregadas uma vez (o lookup por linha levava 30 s)
nfo as (
  select n.raw -> 'compl' ->> 'nIdPedido' as pid,
         jsonb_agg(jsonb_build_object('num', 'NF-e ' || (n.numero)::int, 'valor', n.valor_total, 'status', 'autorizada',
           'data', n.emissao, 'ambiente', 'producao', 'fonte', 'omie') order by n.emissao) as nfs
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
-- ── PV do Omie ──────────────────────────────────────────────────────────────
pv as (
  select p.codigo_pedido, p.numero_pedido, p.etapa, p.valor_total, p.num_pedido_cliente,
         to_date(nullif(p.d_inc, ''), 'DD/MM/YYYY') as emissao,
         coalesce(pe.razao_social, c.razao_social) as cliente,
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
),
pv_doc as (
  select jsonb_build_object(
    'chave', 'pv_omie:' || codigo_pedido, 'codigo', codigo_pedido, 'tipo', 'PV', 'rotulo', 'PV' || numero_pedido,
    'origem', 'Omie', 'etapa', etapa, 'cliente', cliente, 'oc', nullif(num_pedido_cliente, ''),
    'valor', valor_total, 'emissao', emissao,
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
),
-- ── OS do Omie (uma linha por item no espelho → agrega) ────────────────────
os as (
  select o.codigo_os, max(o.numero_os) numero_os, max(o.etapa) etapa, max(o.codigo_cliente) codigo_cliente,
         sum(o.valor_total) valor, max(o.faturada) faturada, max(o.dt_fat_d) dt_fat, min(o.d_inc_d) emissao,
         max(o.num_recibo) num_recibo,
         string_agg(distinct nullif(o.descricao_servico, ''), ' · ') descricao,
         jsonb_agg(jsonb_build_object('desc', o.descricao_servico, 'qtd', o.quantidade, 'vt', o.valor_total) order by o.seq_item) itens
  from sales.ordens_servico o
  where o.empresa = p_empresa and coalesce(o.cancelada, 'N') <> 'S'
    and ((coalesce(o.faturada, 'N') <> 'S' and o.etapa < '60') or o.dt_fat_d >= (select desde from par))
  group by o.codigo_os
),
os_doc as (
  select jsonb_build_object(
    'chave', 'os_omie:' || os.codigo_os, 'codigo', os.codigo_os, 'tipo', 'OS', 'rotulo', 'OS' || os.numero_os,
    'origem', 'Omie', 'etapa', os.etapa, 'cliente', coalesce(pe.razao_social, c.razao_social), 'oc', null,
    'valor', os.valor, 'emissao', os.emissao, 'descricao', left(os.descricao, 160), 'itens', os.itens,
    'faturado', case when os.faturada = 'S' then os.valor else 0 end,
    'nfs', case when os.faturada = 'S' then jsonb_build_array(jsonb_build_object(
        'num', coalesce('Recibo ' || nullif(os.num_recibo, ''), 'Faturada no Omie'), 'valor', os.valor,
        'status', 'autorizada', 'data', os.dt_fat, 'ambiente', 'producao', 'fonte', 'omie')) else '[]'::jsonb end,
    'pend', to_jsonb(array_remove(array[
        case when coalesce(os.valor, 0) <= 0 then 'Valor zerado' end], null)),
    'emite', false, 'emite_motivo', 'OS do Omie: emissão de NFS-e pelo painel ainda não disponível — fature no Omie') as d,
    os.faturada, os.dt_fat, os.etapa
  from os
  left join cadastros.pessoas pe on pe.empresa = p_empresa and pe.codigo::text = os.codigo_cliente
  left join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie::text = os.codigo_cliente
),
-- ── PV/OS nativos do painel ─────────────────────────────────────────────────
nat as (
  select v.*,
         (select coalesce(jsonb_agg(x), '[]'::jsonb) from emg, jsonb_array_elements(emg.nfs) x
           where emg.origem_tipo in ('pv', 'os', 'venda') and emg.origem_id = v.id::text) as nfs,
         regexp_replace(coalesce(v.cliente_cnpj, pe.cnpj_cpf, ''), '\D', '', 'g') as doc,
         regexp_replace(coalesce(pe.cep, ''), '\D', '', 'g') as cep, pe.cidade_ibge
  from vendas.documentos v
  left join cadastros.pessoas pe on pe.empresa = v.empresa and pe.codigo = v.cliente_codigo
  where v.empresa = p_empresa and v.status <> 'cancelado'
),
nat_doc as (
  select jsonb_build_object(
    'chave', 'venda:' || id, 'codigo', id, 'tipo', tipo, 'rotulo', tipo || numero,
    'origem', case when origem = 'crm' then 'CRM' else 'Painel' end, 'etapa', etapa, 'cliente', cliente_nome,
    'oc', nullif(num_pedido_cliente, ''), 'valor', valor_total, 'emissao', emissao,
    'faturado', case when status = 'faturado' then valor_total else least(valor_total,
        (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(nfs) x
          where x->>'status' = 'autorizada' and x->>'ambiente' = 'producao')) end,
    'nfs', nfs,
    'pend', to_jsonb(array_remove(array[
        case when length(doc) not in (11, 14) then 'Cliente sem CNPJ/CPF no cadastro' end,
        case when length(cep) <> 8 then 'Cliente sem CEP válido' end,
        case when coalesce(cidade_ibge, '') = '' then 'Cliente sem município (IBGE)' end,
        case when coalesce(valor_total, 0) <= 0 then 'Valor zerado' end], null)),
    'emite', true) as d,
    status, dt_fat, emissao, nfs
  from nat
)
select jsonb_build_object(
  'desde', (select desde from par),
  'docs', coalesce((
    select jsonb_agg(d) from (
      -- PV do Omie: em aberto (10/20/50) ou faturado no período
      select d from pv_doc
       where etapa in ('10', '20', '50')
          or exists (select 1 from jsonb_array_elements(nfs_omie || nfs_painel) x
                      where x->>'status' = 'autorizada' and (x->>'data')::date >= (select desde from par))
      union all
      -- OS do Omie: em aberto (sem faturar, etapa < 60) ou faturada no período
      select d from os_doc
       where (coalesce(faturada, 'N') <> 'S' and etapa < '60')
          or (faturada = 'S' and dt_fat >= (select desde from par))
      union all
      -- nativos: abertos ou faturados no período
      select d from nat_doc
       where status = 'aberto' or coalesce(dt_fat, emissao) >= (select desde from par)
    ) t), '[]'::jsonb)
);
$$;

grant execute on function orders.fat_carteira(text, date) to service_role;
revoke execute on function orders.fat_carteira(text, date) from public, anon, authenticated;
