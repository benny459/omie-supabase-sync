-- 72 — Carteira de faturamento: nome fantasia, data de emissão e previsão de
-- faturamento (05/10/26, pedido do Benny).
--
-- A previsão vem do Omie (sales.pedidos_venda.data_previsao /
-- sales.ordens_servico.dt_previsao, texto DD/MM/AAAA), do PV/OS nativo
-- (vendas.documentos.previsao) ou de uma correção feita no painel, que vence
-- as outras. O Omie nunca é escrito.

create table if not exists orders.fat_previsao_override (
  chave      text primary key,          -- 'pv_omie:<cod>' | 'os_omie:<cod>' | 'venda:<id>'
  previsao   date not null,
  por_email  text,
  em         timestamptz not null default now()
);
create table if not exists orders.fat_previsao_hist (
  id         bigserial primary key,
  chave      text not null,
  antes      date,
  depois     date,
  por_email  text,
  em         timestamptz not null default now()
);
alter table orders.fat_previsao_override enable row level security;
alter table orders.fat_previsao_hist enable row level security;
revoke all on orders.fat_previsao_override, orders.fat_previsao_hist from anon, authenticated;
grant all on orders.fat_previsao_override, orders.fat_previsao_hist to service_role;
grant usage, select on sequence orders.fat_previsao_hist_id_seq to service_role;

-- p_data null = volta para a previsão original (Omie / documento).
create or replace function orders.fat_previsao_definir(p_chave text, p_data date, p_por text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_antes date;
begin
  if p_chave is null or p_chave !~ '^(pv_omie|os_omie|venda):[0-9A-Za-z_-]+$' then
    raise exception 'chave inválida';
  end if;
  select previsao into v_antes from orders.fat_previsao_override where chave = p_chave;
  if p_data is null then
    delete from orders.fat_previsao_override where chave = p_chave;
  else
    insert into orders.fat_previsao_override (chave, previsao, por_email, em)
    values (p_chave, p_data, p_por, now())
    on conflict (chave) do update set previsao = excluded.previsao, por_email = excluded.por_email, em = now();
  end if;
  insert into orders.fat_previsao_hist (chave, antes, depois, por_email) values (p_chave, v_antes, p_data, p_por);
  return jsonb_build_object('chave', p_chave, 'antes', v_antes, 'depois', p_data);
end $$;
revoke all on function orders.fat_previsao_definir(text, date, text) from public, anon, authenticated;
grant execute on function orders.fat_previsao_definir(text, date, text) to service_role;

create or replace function orders.fat_data_br(p text) returns date
language sql immutable as $$
  select case when p ~ '^\d{2}/\d{2}/\d{4}$' then to_date(p, 'DD/MM/YYYY')
              when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date end
$$;

-- fat_carteira: + 'fantasia', 'razao', 'previsao', 'previsao_origem' em cada documento.
-- p_busca: com texto, procura em todos os períodos (abertos + faturados a qualquer data).
drop function if exists orders.fat_carteira(text, date);
CREATE OR REPLACE FUNCTION orders.fat_carteira(p_empresa text DEFAULT 'SF'::text, p_desde date DEFAULT NULL::date, p_busca text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
par as (select case when nullif(trim(coalesce(p_busca, '')), '') is not null then date '2000-01-01'
                    else coalesce(p_desde, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date) end as desde,
                nullif(lower(trim(coalesce(p_busca, ''))), '') as q),
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
    'faturado', case when os.faturada = 'S' or nsm.chave is not null then os.valor else 0 end,
    'nfs', (case when os.faturada = 'S' then jsonb_build_array(jsonb_build_object(
        'num', coalesce('Recibo ' || nullif(os.num_recibo, ''), 'Faturada no Omie'), 'valor', os.valor,
        'status', 'autorizada', 'data', os.dt_fat, 'ambiente', 'producao', 'fonte', 'omie')) else '[]'::jsonb end)
        || coalesce(nsm.nfs, '[]'::jsonb),
    'nfse', true, 'nfse_registrada', nsm.chave is not null, 'aguarda_nfse', (select tipo_os from cfg) = 'nfse',
    'pend', to_jsonb(array_remove(array[
        case when coalesce(os.valor, 0) <= 0 then 'Valor zerado' end], null)),
    'emite', false, 'emite_motivo', 'OS do Omie: emita a NFS-e na prefeitura e registre-a aqui (Registrar NFS-e) — ou fature o recibo no Omie') as d,
    case when nsm.chave is not null then 'S' else os.faturada end as faturada,
    coalesce((select max((x->>'data')::date) from jsonb_array_elements(nsm.nfs) x), os.dt_fat) as dt_fat, os.etapa
  from os
  left join cadastros.pessoas pe on pe.empresa = p_empresa and pe.codigo::text = os.codigo_cliente
  left join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie::text = os.codigo_cliente
  left join nsm on nsm.chave = 'os_omie:' || os.codigo_os
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

revoke all on function orders.fat_carteira(text, date, text) from public, anon, authenticated;
grant execute on function orders.fat_carteira(text, date, text) to service_role;

-- Contas a receber por PV/OS da carteira (aplicado como p72_fat_previsao_5_receber_resumo).
-- Ver a definição em orders.fat_receber_resumo(text, text[]): mesma resolução PV × OS de sales.rentab_cadeia.

create or replace function orders.fat_cliente_doc(p_empresa text, p_codigo bigint)
returns jsonb language sql stable security definer set search_path to '' as $$
  select to_jsonb(x) from (
    select razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, email, logradouro, numero, complemento,
           bairro, cidade, uf, cidade_ibge, cep, telefone
      from cadastros.pessoas where empresa = p_empresa and codigo = p_codigo limit 1) x
$$;
revoke all on function orders.fat_cliente_doc(text, bigint) from public, anon, authenticated;
grant execute on function orders.fat_cliente_doc(text, bigint) to service_role;
