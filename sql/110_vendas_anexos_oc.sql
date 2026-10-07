-- 110 · OC do cliente e anexos no PV/OS (07/10/26, Benny via CRM).
--
-- "Quando insiro a ordem de compra do meu cliente, essa OC não aparece no card
-- do pedido de venda" + "anexos no CRM e no pedido de venda, entre eles o da OC".
--
-- 1) vendas.oc_cliente — nº da OC do cliente guardado NO PAINEL para PV/OS do
--    Omie (nunca escrevemos no Omie). Nativos gravam em vendas.documentos.
--    Ordem de leitura do nº: nativo (vendas.documentos) > painel (oc_cliente)
--    > Omie (sales.pedidos_venda.num_pedido_cliente; OS do Omie não tem campo).
-- 2) vendas.anexos — anexos por PV/OS (empresa + tipo + número, vale para
--    nativos e para os do Omie). Arquivo no bucket privado vendas-anexos
--    (arquivo_path) OU URL externa (url — p.ex. a OC que o CRM guarda no
--    storage dele, bucket oportunidade-anexos). Remover = apagar lógico.
-- 3) RPCs orders.vendas_oc_* / vendas_anexo* (security definer, só service_role),
--    como o resto do schema vendas (que não é exposto no PostgREST).
-- 4) vendas_da_proposta passa a devolver num_pedido_cliente e anexos.
--
-- O código degrada sem esta migração ("migração pendente"): o nº da OC do
-- Omie continua a aparecer (lido de sales.v_erp_vendas), sem anexos.

-- ── tabelas ──────────────────────────────────────────────────────────────────
create table if not exists vendas.oc_cliente (
  empresa            text not null,
  tipo               text not null check (tipo in ('PV', 'OS')),
  numero             text not null,
  num_pedido_cliente text not null,
  por                text,
  em                 timestamptz not null default now(),
  primary key (empresa, tipo, numero)
);

create table if not exists vendas.anexos (
  id            bigserial primary key,
  empresa       text not null,
  doc_tipo      text not null check (doc_tipo in ('PV', 'OS')),
  numero        text not null,
  documento_id  bigint references vendas.documentos(id) on delete set null,  -- só nativos
  nome          text not null,
  tipo          text not null default 'outro' check (tipo in ('oc_cliente', 'outro')),
  url           text,          -- link externo (CRM, Drive…)
  arquivo_path  text,          -- caminho no bucket vendas-anexos
  tamanho       bigint,
  mime          text,
  origem        text not null default 'painel' check (origem in ('painel', 'crm')),
  por           text,
  em            timestamptz not null default now(),
  removido_em   timestamptz,
  removido_por  text,
  check (url is not null or arquivo_path is not null)
);
create index if not exists vendas_anexos_doc on vendas.anexos (empresa, doc_tipo, numero) where removido_em is null;

alter table vendas.oc_cliente enable row level security;
alter table vendas.anexos     enable row level security;
-- Sem policies: só service_role (que ignora RLS) lê e grava, pelas RPCs abaixo.
grant all on vendas.oc_cliente, vendas.anexos to service_role;
grant usage, select on all sequences in schema vendas to service_role;

-- ── bucket ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendas-anexos', 'vendas-anexos', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.ms-excel', 'message/rfc822', 'application/vnd.ms-outlook',
  'text/plain', 'application/zip', 'application/xml', 'text/xml'])
on conflict (id) do nothing;

-- ── leitura ──────────────────────────────────────────────────────────────────
-- Nº da OC de um PV/OS e de onde veio.
create or replace function vendas.oc_de(p_empresa text, p_tipo text, p_numero text)
returns table (num_pedido_cliente text, origem text, oc_omie text, documento_id bigint)
language sql stable security definer set search_path = vendas, public as $$
  with nat as (
    select d.id, nullif(trim(d.num_pedido_cliente), '') oc from vendas.documentos d
     where d.empresa = p_empresa and d.tipo = p_tipo and d.numero = p_numero and d.status <> 'cancelado'
     order by d.id desc limit 1
  ), ov as (
    select nullif(trim(o.num_pedido_cliente), '') oc from vendas.oc_cliente o
     where o.empresa = p_empresa and o.tipo = p_tipo and o.numero = p_numero
  ), om as (
    select nullif(trim(max(p.num_pedido_cliente)), '') oc from sales.pedidos_venda p
     where p_tipo = 'PV' and p.empresa = p_empresa and p.numero_pedido = p_numero
       and p.codigo_pedido < 9000000000000
  )
  select case when exists (select 1 from nat) then (select oc from nat)
              else coalesce((select oc from ov), (select oc from om)) end,
         case when exists (select 1 from nat) then (case when (select oc from nat) is null then null else 'painel' end)
              when (select oc from ov) is not null then 'painel'
              when (select oc from om) is not null then 'omie' end,
         (select oc from om),
         (select id from nat)
$$;

create or replace function vendas.anexos_json(p_empresa text, p_tipo text, p_numero text)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'nome', a.nome, 'tipo', a.tipo, 'url', a.url, 'arquivo_path', a.arquivo_path,
           'tamanho', a.tamanho, 'mime', a.mime, 'origem', a.origem, 'por', a.por, 'em', a.em) order by a.em), '[]')
    from vendas.anexos a
   where a.empresa = p_empresa and a.doc_tipo = p_tipo and a.numero = p_numero and a.removido_em is null
$$;

-- Um PV/OS: OC + anexos (a tela de detalhe e o acao:"oc" do CRM).
create or replace function orders.vendas_oc_doc(p_empresa text, p_tipo text, p_numero text)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select jsonb_build_object(
    'empresa', p_empresa, 'tipo', p_tipo, 'numero', p_numero, 'label', p_tipo || p_numero,
    'num_pedido_cliente', o.num_pedido_cliente, 'oc_origem', o.origem, 'oc_omie', o.oc_omie,
    'documento_id', o.documento_id, 'nativo', o.documento_id is not null,
    'existe', o.documento_id is not null or exists (
      select 1 from sales.v_erp_vendas v where v.empresa = p_empresa and v.tipo = p_tipo and v.numero = p_numero),
    'anexos', vendas.anexos_json(p_empresa, p_tipo, p_numero))
  from vendas.oc_de(p_empresa, p_tipo, p_numero) o
$$;

-- Vários PV/OS de uma vez (cards de Avulsos, carteira do Faturamento):
-- p_labels = ['PV1968','OS4886', …] → [{label, num_pedido_cliente, oc_origem, anexos, anexos_oc}]
create or replace function orders.vendas_oc_resumo(p_empresa text, p_labels text[])
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  with l as (
    select distinct upper(x) label from unnest(p_labels) x where x ~* '^(PV|OS)\d+$'
  ), nat as (
    select distinct on (d.tipo, d.numero) d.tipo || d.numero label, nullif(trim(d.num_pedido_cliente), '') oc
      from vendas.documentos d
     where d.empresa = p_empresa and d.status <> 'cancelado' and d.tipo || d.numero in (select label from l)
     order by d.tipo, d.numero, d.id desc
  ), ov as (
    select o.tipo || o.numero label, nullif(trim(o.num_pedido_cliente), '') oc
      from vendas.oc_cliente o where o.empresa = p_empresa and o.tipo || o.numero in (select label from l)
  ), om as (
    select 'PV' || p.numero_pedido label, nullif(trim(max(p.num_pedido_cliente)), '') oc
      from sales.pedidos_venda p
     where p.empresa = p_empresa and p.codigo_pedido < 9000000000000 and 'PV' || p.numero_pedido in (select label from l)
     group by 1
  ), cont as (
    select a.doc_tipo || a.numero label, count(*) n, count(*) filter (where a.tipo = 'oc_cliente') n_oc
      from vendas.anexos a where a.empresa = p_empresa and a.removido_em is null
       and a.doc_tipo || a.numero in (select label from l)
     group by 1
  ), r as (
    select l.label,
           case when nat.label is not null then nat.oc else coalesce(ov.oc, om.oc) end oc,
           case when nat.label is not null then (case when nat.oc is null then null else 'painel' end)
                when ov.oc is not null then 'painel' when om.oc is not null then 'omie' end origem,
           coalesce(c.n, 0) n, coalesce(c.n_oc, 0) n_oc
      from l left join nat using (label) left join ov using (label) left join om using (label) left join cont c using (label)
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'num_pedido_cliente', oc, 'oc_origem', origem,
           'anexos', n, 'anexos_oc', n_oc)) filter (where oc is not null or n > 0), '[]')
    from r
$$;

-- ── escrita ──────────────────────────────────────────────────────────────────
-- Define (ou limpa, com p_oc vazio) o nº da OC. Nativo: no documento (+ espelho
-- + histórico). Omie: em vendas.oc_cliente — o Omie não é tocado.
create or replace function orders.vendas_oc_definir(p_empresa text, p_tipo text, p_numero text, p_oc text, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare v_id bigint; v_oc text := nullif(trim(coalesce(p_oc, '')), ''); v_ant text;
begin
  if p_tipo not in ('PV', 'OS') then raise exception 'tipo deve ser PV ou OS'; end if;
  select id, num_pedido_cliente into v_id, v_ant from vendas.documentos
   where empresa = p_empresa and tipo = p_tipo and numero = p_numero and status <> 'cancelado'
   order by id desc limit 1;
  if v_id is not null then
    if v_ant is distinct from v_oc then
      update vendas.documentos set num_pedido_cliente = v_oc, atualizado_por = p_por, atualizado_em = now() where id = v_id;
      insert into vendas.historico (documento_id, por, acao, detalhe)
      values (v_id, p_por, 'oc_cliente', jsonb_build_object('de', v_ant, 'para', v_oc));
      perform vendas.espelhar(v_id);
    end if;
  else
    if not exists (select 1 from sales.v_erp_vendas v where v.empresa = p_empresa and v.tipo = p_tipo and v.numero = p_numero) then
      raise exception '% % não encontrado na empresa %', p_tipo, p_numero, p_empresa;
    end if;
    if v_oc is null then
      delete from vendas.oc_cliente where empresa = p_empresa and tipo = p_tipo and numero = p_numero;
    else
      insert into vendas.oc_cliente (empresa, tipo, numero, num_pedido_cliente, por, em)
      values (p_empresa, p_tipo, p_numero, v_oc, p_por, now())
      on conflict (empresa, tipo, numero) do update set num_pedido_cliente = excluded.num_pedido_cliente, por = excluded.por, em = now();
    end if;
  end if;
  return orders.vendas_oc_doc(p_empresa, p_tipo, p_numero);
end $$;

-- Inclui um anexo. p = {empresa, tipo (PV|OS), numero, nome, url?, arquivo_path?,
-- anexo_tipo ('oc_cliente'|'outro'), tamanho?, mime?, origem ('painel'|'crm'), por}.
-- Idempotente pela URL/caminho: o mesmo link no mesmo PV/OS não duplica.
create or replace function orders.vendas_anexo_incluir(p jsonb)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare
  v_emp text := upper(coalesce(nullif(p ->> 'empresa', ''), 'SF'));
  v_tipo text := upper(coalesce(p ->> 'tipo', ''));
  v_num text := trim(coalesce(p ->> 'numero', ''));
  v_url text := nullif(trim(coalesce(p ->> 'url', '')), '');
  v_path text := nullif(trim(coalesce(p ->> 'arquivo_path', '')), '');
  v_atipo text := case when p ->> 'anexo_tipo' = 'oc_cliente' then 'oc_cliente' else 'outro' end;
  v_nome text := nullif(trim(coalesce(p ->> 'nome', '')), '');
  v_doc bigint; r vendas.anexos;
begin
  if v_tipo not in ('PV', 'OS') then raise exception 'tipo deve ser PV ou OS'; end if;
  if v_num = '' then raise exception 'número do PV/OS obrigatório'; end if;
  if v_url is null and v_path is null then raise exception 'anexo sem url nem arquivo'; end if;
  if v_url is not null and v_url !~* '^https?://' then raise exception 'url inválida: %', v_url; end if;
  select id into v_doc from vendas.documentos
   where empresa = v_emp and tipo = v_tipo and numero = v_num and status <> 'cancelado' order by id desc limit 1;
  if v_doc is null and not exists (select 1 from sales.v_erp_vendas v where v.empresa = v_emp and v.tipo = v_tipo and v.numero = v_num) then
    raise exception '% % não encontrado na empresa %', v_tipo, v_num, v_emp;
  end if;
  select * into r from vendas.anexos a
   where a.empresa = v_emp and a.doc_tipo = v_tipo and a.numero = v_num and a.removido_em is null
     and (a.url = v_url or a.arquivo_path = v_path) limit 1;
  if found then
    if r.tipo <> v_atipo and v_atipo = 'oc_cliente' then update vendas.anexos set tipo = v_atipo where id = r.id returning * into r; end if;
  else
    insert into vendas.anexos (empresa, doc_tipo, numero, documento_id, nome, tipo, url, arquivo_path, tamanho, mime, origem, por)
    values (v_emp, v_tipo, v_num, v_doc,
            coalesce(v_nome, regexp_replace(coalesce(v_path, v_url), '^.*/', '')), v_atipo, v_url, v_path,
            nullif(p ->> 'tamanho', '')::bigint, nullif(p ->> 'mime', ''),
            case when p ->> 'origem' = 'crm' then 'crm' else 'painel' end, nullif(p ->> 'por', ''))
    returning * into r;
    if v_doc is not null then
      insert into vendas.historico (documento_id, por, acao, detalhe)
      values (v_doc, r.por, 'anexo', jsonb_build_object('id', r.id, 'nome', r.nome, 'tipo', r.tipo));
    end if;
  end if;
  return to_jsonb(r);
end $$;

-- Remove (lógico). Devolve o anexo (o caminho, para a rota apagar o arquivo).
create or replace function orders.vendas_anexo_remover(p_id bigint, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare r vendas.anexos;
begin
  update vendas.anexos set removido_em = now(), removido_por = p_por
   where id = p_id and removido_em is null returning * into r;
  if not found then raise exception 'Anexo % não encontrado', p_id; end if;
  if r.documento_id is not null then
    insert into vendas.historico (documento_id, por, acao, detalhe)
    values (r.documento_id, p_por, 'anexo_removido', jsonb_build_object('id', r.id, 'nome', r.nome));
  end if;
  return to_jsonb(r);
end $$;

-- ── CRM: PV/OS da proposta com OC e anexos ───────────────────────────────────
create or replace function orders.vendas_da_proposta(p_empresa text, p_proposta text)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'numero', numero, 'label', tipo || numero,
                  'codigo', codigo, 'status', status, 'valor_total', valor_total,
                  'num_pedido_cliente', nullif(trim(num_pedido_cliente), ''),
                  'anexos', vendas.anexos_json(empresa, tipo, numero)) order by id), '[]')
  from vendas.documentos where empresa = p_empresa and proposta = p_proposta and status <> 'cancelado'
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'vendas.oc_de(text,text,text)', 'vendas.anexos_json(text,text,text)',
    'orders.vendas_oc_doc(text,text,text)', 'orders.vendas_oc_resumo(text,text[])',
    'orders.vendas_oc_definir(text,text,text,text,text)', 'orders.vendas_anexo_incluir(jsonb)',
    'orders.vendas_anexo_remover(bigint,text)', 'orders.vendas_da_proposta(text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
