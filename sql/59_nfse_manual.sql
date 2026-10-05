-- 59 — Controle de NFS-e emitida na prefeitura (05/10/2026)
--
-- Decisão do Benny: a NFS-e é rara e continua a ser emitida à mão no portal da
-- prefeitura, mas fica REGISTRADA no painel. Registrar uma NFS-e:
--   • liga a nota a uma ou mais OS (do Omie ou nativas do painel);
--   • guarda número, código de verificação, datas, valores, ISS/retenções e o
--     PDF/XML (bucket privado fat-documentos, pasta nfse-manual/);
--   • cria as parcelas em finance.receber pelo VALOR LÍQUIDO;
--   • marca a OS como faturada (nativa: vendas_marcar_faturado; Omie: só no
--     painel, pela carteira — nada é escrito no Omie);
--   • audita tudo em orders.fat_nfse_manual_hist.
--
-- Regra do líquido: o tomador retém ISS (quando "retido") e as retenções
-- federais (IR, PIS, COFINS, CSLL, INSS) e paga o resto; o contas a receber
-- nasce com valor_servicos − ISS retido − retenções. ISS não retido não abate.
-- As parcelas (vencimento, valor) vêm da tela — que as pré-preenche pela
-- condição da OS — e têm de somar o líquido. Com várias OS, cada parcela é
-- repartida entre as OS na proporção do valor de cada uma (numero_pedido = OS),
-- para a rentabilidade casar o recebido com cada OS.
--
-- Cancelar só sem baixa nas parcelas: apaga as parcelas e desfaz o faturado.
-- Guarda de duplicidade: o mesmo nº de NFS-e no mesmo município (e empresa)
-- não pode estar registrado duas vezes.
--
-- Nada aqui mexe em fat_config, numeração ou chaves de produção.

create table if not exists orders.fat_nfse_manual (
  id bigserial primary key,
  empresa text not null,
  municipio text not null,
  numero text not null,
  codigo_verificacao text,
  data_emissao date not null,
  competencia date,
  valor_servicos numeric(14,2) not null check (valor_servicos > 0),
  iss_retido boolean not null default false,
  valor_iss numeric(14,2) not null default 0,
  ret_ir numeric(14,2) not null default 0,
  ret_pis numeric(14,2) not null default 0,
  ret_cofins numeric(14,2) not null default 0,
  ret_csll numeric(14,2) not null default 0,
  ret_inss numeric(14,2) not null default 0,
  valor_liquido numeric(14,2) not null,
  tomador_codigo bigint,
  tomador_nome text,
  tomador_doc text,
  os jsonb not null,               -- [{chave, rotulo, valor, categoria, projeto}]
  os_chaves text[] not null,       -- 'os_omie:<codigo>' | 'venda:<id>'
  parcelas jsonb not null,         -- [{vencimento, valor}]
  receber_ids uuid[],
  pdf_path text,
  xml_path text,
  observacao text,
  status text not null default 'registrada' check (status in ('registrada', 'cancelada')),
  criado_por text,
  criado_em timestamptz not null default now(),
  cancelado_em timestamptz,
  cancelado_por text,
  cancelado_motivo text
);
create unique index if not exists fat_nfse_manual_unico
  on orders.fat_nfse_manual (empresa, lower(trim(municipio)), ltrim(trim(numero), '0'))
  where status = 'registrada';
create index if not exists fat_nfse_manual_os on orders.fat_nfse_manual using gin (os_chaves);
create index if not exists fat_nfse_manual_emp on orders.fat_nfse_manual (empresa, data_emissao desc);

create table if not exists orders.fat_nfse_manual_hist (
  id bigserial primary key,
  nfse_id bigint not null references orders.fat_nfse_manual(id) on delete cascade,
  acao text not null,
  por text,
  em timestamptz not null default now(),
  detalhe jsonb
);

alter table orders.fat_nfse_manual enable row level security;
alter table orders.fat_nfse_manual_hist enable row level security;
revoke all on orders.fat_nfse_manual, orders.fat_nfse_manual_hist from public, anon, authenticated;
grant all on orders.fat_nfse_manual, orders.fat_nfse_manual_hist to service_role;
grant usage, select on sequence orders.fat_nfse_manual_id_seq, orders.fat_nfse_manual_hist_id_seq to service_role;

-- ── Pré-preenchimento: dados das OS escolhidas ─────────────────────────────
create or replace function orders.fat_nfse_prefill(p_empresa text, p_chaves text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k text; tipo text; idt text; r jsonb := '[]'::jsonb; o jsonb; v record; mun text;
begin
  foreach k in array coalesce(p_chaves, '{}') loop
    tipo := split_part(k, ':', 1); idt := split_part(k, ':', 2);
    o := null;
    if tipo = 'os_omie' then
      select jsonb_build_object(
          'chave', k, 'rotulo', 'OS' || max(s.numero_os), 'valor', sum(s.valor_total),
          'cliente_codigo', max(s.codigo_cliente),
          'categoria', max(s.codigo_categoria), 'projeto', max(s.codigo_projeto),
          'condicao', max(s.codigo_parcela),
          'parcelas_dias', case
              when max(s.codigo_parcela) ~ '^A\d+$' then jsonb_build_array(substr(max(s.codigo_parcela), 2)::int)
              else jsonb_build_array(0) end,
          'iss_retido', bool_or(coalesce(s.retem_iss, 'N') = 'S'),
          'valor_iss', coalesce(sum(s.valor_iss), 0),
          'ret_inss', coalesce(sum(case when coalesce(s.retem_inss, 'N') = 'S' then s.valor_inss else 0 end), 0),
          'aberta', bool_and(coalesce(s.faturada, 'N') <> 'S' and coalesce(s.cancelada, 'N') <> 'S'),
          'descricao', left(string_agg(distinct nullif(s.descricao_servico, ''), ' · '), 300))
        into o
        from sales.ordens_servico s
       where s.empresa = p_empresa and s.codigo_os = idt
      having count(*) > 0;
    elsif tipo = 'venda' and idt ~ '^\d+$' then
      select jsonb_build_object(
          'chave', k, 'rotulo', d.tipo || d.numero, 'valor', d.valor_total,
          'cliente_codigo', d.cliente_codigo::text, 'cliente_nome', d.cliente_nome, 'cliente_doc', d.cliente_cnpj,
          'categoria', d.categoria_codigo, 'projeto', d.projeto_codigo,
          'condicao', d.condicao_descricao,
          'parcelas_dias', coalesce((select jsonb_agg(coalesce(p.dias, 0) order by p.numero) from vendas.parcelas p where p.documento_id = d.id), jsonb_build_array(0)),
          'parcelas_pct', (select jsonb_agg(p.percentual order by p.numero) from vendas.parcelas p where p.documento_id = d.id),
          'iss_retido', false, 'valor_iss', 0, 'ret_inss', 0,
          'aberta', d.status = 'aberto', 'tipo_doc', d.tipo, 'descricao', left(d.observacoes, 300))
        into o
        from vendas.documentos d
       where d.id = idt::bigint and d.empresa = p_empresa;
    end if;
    if o is null then
      r := r || jsonb_build_array(jsonb_build_object('chave', k, 'erro', 'OS não encontrada'));
      continue;
    end if;
    -- cliente pelo cadastro mestre
    select pe.codigo, pe.razao_social, regexp_replace(coalesce(pe.cnpj_cpf, pe.doc, ''), '\D', '', 'g') as doc
      into v from cadastros.pessoas pe
     where pe.empresa = p_empresa and pe.codigo::text = o->>'cliente_codigo' limit 1;
    if found then
      o := o || jsonb_build_object('cliente_codigo', v.codigo, 'cliente_nome', coalesce(o->>'cliente_nome', v.razao_social),
                                   'cliente_doc', coalesce(nullif(o->>'cliente_doc', ''), v.doc));
    end if;
    o := o || jsonb_build_object('ja_registrada', (
      select jsonb_agg(jsonb_build_object('id', m.id, 'numero', m.numero, 'municipio', m.municipio))
        from orders.fat_nfse_manual m where m.status = 'registrada' and m.empresa = p_empresa and k = any(m.os_chaves)));
    r := r || jsonb_build_array(o);
  end loop;
  select m.municipio into mun from orders.fat_nfse_manual m where m.empresa = p_empresa order by m.id desc limit 1;
  return jsonb_build_object('os', r, 'municipio_padrao', coalesce(mun, case when p_empresa = 'SF' then 'Barueri' end));
end $$;

-- ── Registrar ──────────────────────────────────────────────────────────────
create or replace function orders.fat_nfse_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  emp text := p->>'empresa';
  num text := nullif(trim(p->>'numero'), '');
  mun text := nullif(trim(p->>'municipio'), '');
  vs numeric := round(coalesce((p->>'valor_servicos')::numeric, 0), 2);
  iss_ret boolean := coalesce((p->>'iss_retido')::boolean, false);
  viss numeric := round(coalesce((p->>'valor_iss')::numeric, 0), 2);
  rir numeric := round(coalesce((p->>'ret_ir')::numeric, 0), 2);
  rpis numeric := round(coalesce((p->>'ret_pis')::numeric, 0), 2);
  rcof numeric := round(coalesce((p->>'ret_cofins')::numeric, 0), 2);
  rcsll numeric := round(coalesce((p->>'ret_csll')::numeric, 0), 2);
  rinss numeric := round(coalesce((p->>'ret_inss')::numeric, 0), 2);
  liq numeric; soma numeric; tot_os numeric;
  os jsonb := coalesce(p->'os', '[]'::jsonb);
  ps jsonb := coalesce(p->'parcelas', '[]'::jsonb);
  chaves text[]; ch text; o jsonb; pc jsonb; i int; j int; n int; nos int;
  v numeric; acum numeric; nid bigint; ids uuid[] := '{}'; rid uuid;
  tom_cod bigint := nullif(p->'tomador'->>'codigo', '')::bigint;
  tom_nome text := nullif(p->'tomador'->>'nome', '');
  tom_doc text := nullif(regexp_replace(coalesce(p->'tomador'->>'doc', ''), '\D', '', 'g'), '');
  por text := coalesce(p->>'por', 'painel');
  emis date := (p->>'data_emissao')::date;
  d record;
begin
  if emp is null then raise exception 'Empresa não informada'; end if;
  if num is null then raise exception 'Informe o número da NFS-e'; end if;
  if mun is null then raise exception 'Informe o município (prefeitura) da NFS-e'; end if;
  if emis is null then raise exception 'Informe a data de emissão'; end if;
  if vs <= 0 then raise exception 'Valor dos serviços tem de ser maior que zero'; end if;
  if jsonb_array_length(os) = 0 then raise exception 'Escolha pelo menos uma OS'; end if;
  if jsonb_array_length(ps) = 0 then raise exception 'Informe pelo menos uma parcela'; end if;
  if least(viss, rir, rpis, rcof, rcsll, rinss) < 0 then raise exception 'Valores de ISS/retenções não podem ser negativos'; end if;
  liq := vs - case when iss_ret then viss else 0 end - rir - rpis - rcof - rcsll - rinss;
  if liq <= 0 then raise exception 'Valor líquido (serviços − retenções) ficou % — confira as retenções', liq; end if;
  select coalesce(sum(round((x->>'valor')::numeric, 2)), 0) into soma from jsonb_array_elements(ps) x;
  if abs(soma - liq) > 0.01 then
    raise exception 'As parcelas somam % mas o líquido a receber é %', soma, liq;
  end if;
  if exists (select 1 from jsonb_array_elements(ps) x where (x->>'vencimento') is null or round((x->>'valor')::numeric, 2) <= 0) then
    raise exception 'Cada parcela precisa de vencimento e valor maior que zero';
  end if;

  select array_agg(x->>'chave'), coalesce(sum((x->>'valor')::numeric), 0) into chaves, tot_os from jsonb_array_elements(os) x;
  if exists (select 1 from unnest(chaves) c where c is null or c !~ '^(os_omie|venda):') then raise exception 'OS inválida'; end if;
  if tot_os <= 0 then raise exception 'As OS escolhidas não têm valor'; end if;
  -- cada OS só pode estar numa NFS-e registrada
  select m.numero, c into d from orders.fat_nfse_manual m, unnest(m.os_chaves) c
   where m.status = 'registrada' and m.empresa = emp and c = any(chaves) limit 1;
  if found then raise exception 'A OS já tem a NFS-e % registrada', d.numero; end if;
  -- OS nativas: têm de ser OS em aberto
  foreach ch in array chaves loop
    if ch like 'venda:%' then
      select * into d from vendas.documentos where id = split_part(ch, ':', 2)::bigint and empresa = emp;
      if not found then raise exception 'OS % não encontrada', ch; end if;
      if d.status <> 'aberto' then raise exception '% não está em aberto (%)', d.tipo || d.numero, d.status; end if;
    end if;
  end loop;

  begin
    insert into orders.fat_nfse_manual (empresa, municipio, numero, codigo_verificacao, data_emissao, competencia,
      valor_servicos, iss_retido, valor_iss, ret_ir, ret_pis, ret_cofins, ret_csll, ret_inss, valor_liquido,
      tomador_codigo, tomador_nome, tomador_doc, os, os_chaves, parcelas, pdf_path, xml_path, observacao, criado_por)
    values (emp, mun, num, nullif(trim(p->>'codigo_verificacao'), ''), emis, nullif(p->>'competencia', '')::date,
      vs, iss_ret, viss, rir, rpis, rcof, rcsll, rinss, liq,
      tom_cod, tom_nome, tom_doc, os, chaves, ps, nullif(p->>'pdf_path', ''), nullif(p->>'xml_path', ''), nullif(trim(p->>'observacao'), ''), por)
    returning id into nid;
  exception when unique_violation then
    raise exception 'A NFS-e % de % já está registrada no painel', num, mun;
  end;

  -- contas a receber: cada parcela repartida pelas OS (proporcional ao valor)
  n := jsonb_array_length(ps); nos := jsonb_array_length(os);
  for i in 0 .. n - 1 loop
    pc := ps -> i; acum := 0;
    for j in 0 .. nos - 1 loop
      o := os -> j;
      if j = nos - 1 then v := round((pc->>'valor')::numeric, 2) - acum;
      else v := round(round((pc->>'valor')::numeric, 2) * (o->>'valor')::numeric / tot_os, 2); acum := acum + v; end if;
      if v <= 0 then continue; end if;
      insert into finance.receber (empresa, codigo_cliente_omie, cliente_cnpj, cliente_razao, numero_documento, numero_parcela,
        numero_pedido, numero_documento_fiscal, emissao, vencimento, previsao, valor, codigo_categoria, codigo_projeto,
        observacao, origem, conferencia, created_by, extras)
      values (emp, case when tom_cod < 90000000000 then tom_cod end, tom_doc, tom_nome, 'NFS-e ' || num, (i + 1) || '/' || n,
        o->>'rotulo', num, emis, (pc->>'vencimento')::date, (pc->>'vencimento')::date, v,
        nullif(o->>'categoria', ''), nullif(o->>'projeto', ''),
        'NFS-e ' || num || ' (' || mun || ') registrada no painel', 'painel', 'so_painel', por,
        jsonb_build_object('nfse_manual_id', nid, 'tipo', 'nfse_manual', 'os_chave', o->>'chave', 'ambiente', 'producao'))
      returning id into rid;
      ids := ids || rid;
    end loop;
  end loop;
  update orders.fat_nfse_manual set receber_ids = ids where id = nid;

  -- OS nativas ficam faturadas (as do Omie ficam faturadas só na carteira do painel)
  foreach ch in array chaves loop
    if ch like 'venda:%' then
      perform orders.vendas_marcar_faturado(split_part(ch, ':', 2)::bigint,
        jsonb_build_object('tipo', 'nfse', 'numero', num, 'ambiente', 'producao', 'nfse_manual_id', nid, 'municipio', mun));
    end if;
  end loop;

  insert into orders.fat_nfse_manual_hist (nfse_id, acao, por, detalhe)
  values (nid, 'registrada', por, jsonb_build_object('numero', num, 'municipio', mun, 'valor_servicos', vs, 'liquido', liq,
          'os', chaves, 'parcelas', ps, 'receber_ids', to_jsonb(ids)));
  return (select to_jsonb(m) from orders.fat_nfse_manual m where m.id = nid);
end $$;

-- ── Cancelar (estorno do registro) ─────────────────────────────────────────
create or replace function orders.fat_nfse_cancelar(p_id bigint, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m orders.fat_nfse_manual; ch text;
begin
  select * into m from orders.fat_nfse_manual where id = p_id for update;
  if not found then raise exception 'Registro % não encontrado', p_id; end if;
  if m.status <> 'registrada' then raise exception 'Registro já cancelado'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  if exists (select 1 from finance.baixas b where b.receber_id = any(coalesce(m.receber_ids, '{}')) and b.estornado_em is null)
     or exists (select 1 from finance.receber r where r.id = any(coalesce(m.receber_ids, '{}')) and coalesce(r.valor_pago, 0) > 0) then
    raise exception 'Há parcela com baixa (recebimento) — estorne a baixa antes de cancelar o registro';
  end if;
  delete from finance.receber where id = any(coalesce(m.receber_ids, '{}')) and origem = 'painel';
  foreach ch in array m.os_chaves loop
    if ch like 'venda:%' then
      perform orders.vendas_desfazer_faturado(split_part(ch, ':', 2)::bigint,
        jsonb_build_object('tipo', 'nfse', 'numero', m.numero, 'ambiente', 'producao', 'nfse_manual_id', m.id, 'cancelado', true));
    end if;
  end loop;
  update orders.fat_nfse_manual set status = 'cancelada', cancelado_em = now(), cancelado_por = p_por,
         cancelado_motivo = trim(p_motivo), receber_ids = null where id = p_id;
  insert into orders.fat_nfse_manual_hist (nfse_id, acao, por, detalhe)
  values (p_id, 'cancelada', p_por, jsonb_build_object('motivo', trim(p_motivo), 'receber_removidos', to_jsonb(m.receber_ids)));
  return (select to_jsonb(x) from orders.fat_nfse_manual x where x.id = p_id);
end $$;

-- ── Lista ──────────────────────────────────────────────────────────────────
create or replace function orders.fat_nfse_lista(p_empresa text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.data_emissao desc, m.id desc), '[]'::jsonb)
    from (select * from orders.fat_nfse_manual where empresa = p_empresa order by id desc limit 500) m;
$$;

grant execute on function orders.fat_nfse_prefill(text, text[]), orders.fat_nfse_registrar(jsonb),
  orders.fat_nfse_cancelar(bigint, text, text), orders.fat_nfse_lista(text) to service_role;
revoke execute on function orders.fat_nfse_prefill(text, text[]), orders.fat_nfse_registrar(jsonb),
  orders.fat_nfse_cancelar(bigint, text, text), orders.fat_nfse_lista(text) from public, anon, authenticated;

-- ── Carteira (sql/57) passa a ver as NFS-e registradas ─────────────────────
create or replace function orders.fat_carteira(p_empresa text default 'SF', p_desde date default null)
returns jsonb language sql stable security definer set search_path = '' as $$
with
par as (select coalesce(p_desde, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date) as desde),
cfg as (select coalesce((select tipo_os from orders.fat_config where empresa = p_empresa), 'recibo') as tipo_os),
-- NFS-e emitidas na prefeitura e registradas no painel (sql/59)
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
    -- p59b: o espelho das OS nativas (codigo ≥ 9e12) já entra como nativo; não duplicar
    and not (o.codigo_os ~ '^\d+$' and o.codigo_os::numeric >= 9000000000000)
    and ((coalesce(o.faturada, 'N') <> 'S' and o.etapa < '60') or o.dt_fat_d >= (select desde from par))
  group by o.codigo_os
),
os_doc as (
  select jsonb_build_object(
    'chave', 'os_omie:' || os.codigo_os, 'codigo', os.codigo_os, 'tipo', 'OS', 'rotulo', 'OS' || os.numero_os,
    'origem', 'Omie', 'etapa', os.etapa, 'cliente', coalesce(pe.razao_social, c.razao_social), 'oc', null,
    'valor', os.valor, 'emissao', os.emissao, 'descricao', left(os.descricao, 160), 'itens', os.itens,
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
),
-- ── PV/OS nativos do painel ─────────────────────────────────────────────────
nat as (
  select v.*,
         (select coalesce(jsonb_agg(x), '[]'::jsonb) from emg, jsonb_array_elements(emg.nfs) x
           where emg.origem_tipo in ('pv', 'os', 'venda') and emg.origem_id = v.id::text)
           || coalesce((select n.nfs from nsm n where n.chave = 'venda:' || v.id), '[]'::jsonb) as nfs,
         exists (select 1 from nsm n where n.chave = 'venda:' || v.id) as nfse_reg,
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
    'emite', true, 'nfse', tipo = 'OS', 'nfse_registrada', nfse_reg, 'aguarda_nfse', tipo = 'OS' and (select tipo_os from cfg) = 'nfse') as d,
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
