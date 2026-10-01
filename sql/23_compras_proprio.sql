-- 23 — Compras no painel: requisições e pedidos de compra com fonte da verdade
--      NOSSA (schema compras), espelhando o Omie sem duplicar (01/10/2026).
--
-- Mesma estratégia das contas a receber (sql/20):
--   · compras.pedidos é onde a compra vive. Requisição (RC) e pedido (PC) são a
--     mesma entidade em etapas diferentes: 20 Requisição → 10 Pedido → 15
--     Aprovação → 40 Faturado pelo fornecedor → 60 Recebido → 80 Conferido
--     (as etapas da operação 21 "Compra de Produto" do Omie).
--   · O que existe no Omie entra por compras.conciliar_omie() a partir do
--     espelho orders.pedidos_compra (1 linha por item) + NF de entrada
--     (orders.recebimento_nfe → 40/60/80). Idempotente: a chave é
--     (empresa, omie_ncod_ped); rodar de novo não duplica.
--   · Desde 01/10/2026 o pedido de compra NASCE E VIVE no painel — não vai ao
--     Omie (decisão do Benny). Numeração própria "P0001…": o cNumero do Omie é
--     só dígitos, então nunca colide. O espelho do Omie fica como histórico.
--   · Requisição ⇄ Pedido (o Omie não tem): compras.item_rc liga item do pedido
--     a item da requisição, N:N, com atendimento parcial.
--
-- O schema compras NÃO está exposto no PostgREST (o projeto é partilhado com o
-- ALLKA e a lista de schemas expostos é configurada no Dashboard). O painel
-- fala com ele só por funções orders.compras_* (security definer, execução só
-- pelo service_role), chamadas pelas rotas /api/compras/*.

create schema if not exists compras;
revoke all on schema compras from public, anon, authenticated;

create sequence if not exists compras.seq_numero_painel;

-- ── Tabelas ─────────────────────────────────────────────────────────────────
create table if not exists compras.pedidos (
  id                    bigserial primary key,
  empresa               text not null default 'SF',
  tipo                  text not null check (tipo in ('RC', 'PC')),
  numero                text not null,
  etapa                 text not null default '10' check (etapa in ('20','10','15','40','60','80')),
  etapa_omie            text,        -- derivada do espelho (só origem omie)
  etapa_manual          text,        -- avanço feito no painel; a efetiva é a maior das duas
  cancelado             boolean not null default false,
  fornecedor_cod        bigint,
  fornecedor_nome       text,
  fornecedor_cnpj       text,
  categoria_cod         text,
  categoria_desc        text,
  comprador             text,
  comprador_cod         bigint,
  projeto_cod           bigint,
  projeto_nome          text,
  conta_cod             bigint,
  conta_desc            text,
  parcela_cod           text,
  emissao               date,
  previsao              date,
  contato               text,
  num_pedido_fornecedor text,
  contrato              text,
  obs                   text,
  obs_int               text,
  pv_os                 text,        -- venda de origem (PV1960 / OS4831)
  pv_cliente            text,
  nf                    text,
  chave_nfe             text,
  dt_faturado           date,
  dt_rec                date,
  aprov_status          text not null default 'nao_solicitada'
                        check (aprov_status in ('na','nao_solicitada','aguardando','aprovado','nao_aprovado')),
  aprov_por             text,
  aprov_em              timestamptz,
  aprov_valor           numeric,
  frete                 jsonb not null default '{}'::jsonb,
  valor_total           numeric not null default 0,
  origem                text not null check (origem in ('painel', 'omie')),
  omie_ncod_ped         bigint,
  omie_sync_status      text,        -- 'espelho' (veio do Omie); null no painel
  omie_ausente          boolean not null default false,  -- saiu do espelho
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            text,
  unique (empresa, omie_ncod_ped),
  unique (empresa, numero)
);
create index if not exists pedidos_etapa_idx   on compras.pedidos (etapa) where not cancelado;
create index if not exists pedidos_emissao_idx on compras.pedidos (emissao desc);

create table if not exists compras.itens (
  id             bigserial primary key,
  pedido_id      bigint not null references compras.pedidos (id) on delete cascade,
  seq            int not null default 1,
  produto_cod    text,
  ncod_prod      bigint,
  descricao      text not null default '',
  unidade        text default 'UN',
  qtd            numeric not null default 0,
  valor_unit     numeric not null default 0,
  desconto       numeric not null default 0,   -- R$ do item
  ipi            numeric not null default 0,   -- R$ do item
  st             numeric not null default 0,   -- R$ do item
  ncm            text,
  local_estoque  text,
  obs            text,
  qtd_recebida   numeric,
  omie_ncod_item bigint,
  unique (pedido_id, omie_ncod_item)
);
create index if not exists itens_pedido_idx on compras.itens (pedido_id);
create index if not exists itens_produto_idx on compras.itens (produto_cod);

-- Item do pedido ⇄ item da requisição (N:N, parcial). qtd = quanto deste item
-- do pedido atende aquela linha da requisição.
create table if not exists compras.item_rc (
  pc_item_id bigint not null references compras.itens (id) on delete cascade,
  rc_item_id bigint not null references compras.itens (id) on delete cascade,
  qtd        numeric not null default 0,
  primary key (pc_item_id, rc_item_id)
);
create index if not exists item_rc_rc_idx on compras.item_rc (rc_item_id);

create table if not exists compras.parcelas (
  pedido_id  bigint not null references compras.pedidos (id) on delete cascade,
  n          int not null,
  vencimento date,
  valor      numeric not null default 0,
  tipo_doc   text default 'Boleto',
  primary key (pedido_id, n)
);

create table if not exists compras.departamentos (
  pedido_id    bigint not null references compras.pedidos (id) on delete cascade,
  departamento text not null,
  perc         numeric not null default 0,
  primary key (pedido_id, departamento)
);

create table if not exists compras.historico (
  id        bigserial primary key,
  pedido_id bigint not null references compras.pedidos (id) on delete cascade,
  em        timestamptz not null default now(),
  texto     text not null,
  por       text
);
create index if not exists historico_pedido_idx on compras.historico (pedido_id, em);

-- Cadastros do Omie que o espelho ainda não tinha (sync read-only em
-- scripts/import_cadastros_compras.py).
create table if not exists compras.cad_departamentos (
  empresa   text not null,
  codigo    text not null,
  descricao text not null,
  inativo   boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (empresa, codigo)
);
create table if not exists compras.cad_compradores (
  empresa   text not null,
  codigo    bigint not null,
  nome      text not null,
  synced_at timestamptz not null default now(),
  primary key (empresa, codigo)
);

alter table compras.pedidos           enable row level security;
alter table compras.itens             enable row level security;
alter table compras.item_rc           enable row level security;
alter table compras.parcelas          enable row level security;
alter table compras.departamentos     enable row level security;
alter table compras.historico         enable row level security;
alter table compras.cad_departamentos enable row level security;
alter table compras.cad_compradores   enable row level security;
grant usage on schema compras to service_role;
grant all on all tables in schema compras to service_role;
grant all on all sequences in schema compras to service_role;

-- ── Auxiliares ──────────────────────────────────────────────────────────────
-- Ordem das etapas (a de Requisição vem antes da de Pedido).
create or replace function compras.etapa_ordem(e text) returns int
language sql immutable as $$
  select coalesce(array_position(array['20','10','15','40','60','80'], e), 0)
$$;

create or replace function compras.etapa_max(a text, b text) returns text
language sql immutable as $$
  select case when b is null then a when a is null then b
              when compras.etapa_ordem(b) > compras.etapa_ordem(a) then b else a end
$$;

-- Dias de vencimento de uma condição de parcelas do Omie, pela descrição:
-- "A Vista" → {0}; "Para 28 dias" → {28}; "A Vista/30/60" → {0,30,60};
-- "30/60/90 (C)" → {30,60,90}; "6 Parcelas" → {30,60,…,180}.
create or replace function compras.parcela_dias(descricao text) returns int[]
language plpgsql immutable as $$
declare d text := lower(coalesce(descricao, '')); n int; out int[] := '{}';
begin
  if d = '' or d ~ 'informar' then return array[0]; end if;
  if d ~ '^\s*a vista\s*$' then return array[0]; end if;
  if d ~ '^\s*para \d+' then return array[(regexp_match(d, '(\d+)'))[1]::int]; end if;
  if d ~ '^\s*\d+\s+parcelas?' then
    n := (regexp_match(d, '(\d+)'))[1]::int;
    if n <= 1 then return array[30]; end if;
    for i in 1..least(n, 60) loop out := out || (30 * i); end loop;
    return out;
  end if;
  if d ~ '/' then
    select array_agg(case when t ~ 'vista' then 0 else (regexp_match(t, '(\d+)'))[1]::int end order by o)
      into out
      from unnest(string_to_array(regexp_replace(d, '\(.*\)', '', 'g'), '/')) with ordinality as x(t, o)
     where t ~ '\d' or t ~ 'vista';
    return coalesce(out, array[0]);
  end if;
  return array[0];
end $$;

create or replace function compras.add_hist(p_pedido bigint, p_texto text, p_por text)
returns void language sql as $$
  insert into compras.historico (pedido_id, texto, por) values (p_pedido, p_texto, p_por)
$$;

-- ── Conciliação com o espelho do Omie ───────────────────────────────────────
create or replace function compras.conciliar_omie()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v_novos int := 0; v_atual int := 0; v_itens int := 0; v_aus int := 0; v_hist int := 0;
begin
  create temp table _src on commit drop as
  with cab as (
    select distinct on (p.empresa, p.ncod_ped) p.*
      from orders.pedidos_compra p
     order by p.empresa, p.ncod_ped, p.ncod_item
  ),
  rec as (
    select empresa, id_pedido,
           max(etapa) filter (where etapa in ('40','60','80')) as etapa,
           string_agg(distinct nullif(num_nfe, ''), ', ') as nf,
           min(nullif(chave_nfe, '')) as chave,
           max(to_date(nullif(dt_rec, ''), 'DD/MM/YYYY')) filter (where recebido = 'S') as dt_rec,
           max(to_date(nullif(dt_fat, ''), 'DD/MM/YYYY')) as dt_fat
      from orders.recebimento_nfe
     where id_pedido is not null
     group by 1, 2
  ),
  tot as (
    select empresa, ncod_ped,
           sum(coalesce(nfrete, 0)) as frete, sum(coalesce(nseguro, 0)) as seguro,
           sum(coalesce(ndespesas, 0)) as outras,
           sum(coalesce(nqtde, 0) * coalesce(nval_unit, 0) - coalesce(ndesconto, 0)
               + coalesce(nvalor_ipi, 0) + coalesce(nvalor_st, 0)) as itens
      from orders.pedidos_compra group by 1, 2
  )
  select c.empresa, c.ncod_ped,
         case when c.cetapa = '20' then 'RC' else 'PC' end as tipo,
         c.cnumero as numero,
         coalesce(r.etapa, case when c.cetapa in ('10','15','20') then c.cetapa else '10' end) as etapa_omie,
         nullif(c.ncod_for, 0) as fornecedor_cod,
         replace(nullif(coalesce(nullif(k.razao_social, ''), k.nome_fantasia), ''), '&amp;', '&') as fornecedor_nome,
         nullif(k.cnpj_cpf, '') as fornecedor_cnpj,
         nullif(c.ccod_categ, '') as categoria_cod, cat.descricao as categoria_desc,
         coalesce(nullif(a.comprador, ''), cc.nome) as comprador, nullif(c.ncod_compr, 0) as comprador_cod,
         nullif(c.ncod_proj, 0) as projeto_cod, pj.nome as projeto_nome,
         nullif(c.ncod_cc, 0) as conta_cod, ccr.descricao as conta_desc,
         nullif(c.ccod_parc, '') as parcela_cod,
         to_date(nullif(c.dinc_data, ''), 'DD/MM/YYYY') as emissao,
         to_date(nullif(c.ddt_previsao, ''), 'DD/MM/YYYY') as previsao,
         nullif(c.ccontato, '') as contato, nullif(c.cnum_pedido, '') as num_pedido_fornecedor,
         nullif(c.ccontrato, '') as contrato, nullif(c.cobs, '') as obs, nullif(c.cobs_int, '') as obs_int,
         coalesce(nullif(a.pv_os_label, ''),
                  (select upper(m[1]) || m[2] from regexp_match(coalesce(c.cobs_int, '') || ' ' || coalesce(c.cobs, ''),
                                                               '(PV|OS)\s*0*(\d{3,})', 'i') as m)) as pv_os,
         r.nf, r.chave as chave_nfe, r.dt_fat as dt_faturado, r.dt_rec,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then 'aprovado'
              when a.status in ('NAO_APROVADO','REJEITADO_VALIDADE') then 'nao_aprovado'
              when a.status in ('PENDENTE','PRE_SELECAO') then 'aguardando'
              when c.cetapa = '20' then 'na'
              else 'nao_solicitada' end as aprov_status,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then coalesce(a.aprovador_email, 'Omie') end as aprov_por,
         case when a.status in ('APROVADO','APROVADO_FAT_DIRETO') then a.aprovado_em end as aprov_em,
         a.valor_aprovado as aprov_valor,
         jsonb_strip_nulls(jsonb_build_object(
           'tipo', '9 - Sem Ocorrência de Transporte',
           'valor', nullif(t.frete, 0), 'seguro', nullif(t.seguro, 0), 'outras', nullif(t.outras, 0))) as frete,
         coalesce(nullif(c.ntotal_pedido, 0), t.itens + t.frete + t.seguro + t.outras, 0) as valor_total
    from cab c
    left join rec r              on r.empresa = c.empresa and r.id_pedido = c.ncod_ped
    left join tot t              on t.empresa = c.empresa and t.ncod_ped = c.ncod_ped
    left join approval.approvals a on a.empresa = c.empresa and a.ncod_ped = c.ncod_ped
    left join finance.clientes k on k.empresa = c.empresa and k.codigo_cliente_omie = c.ncod_for
    left join finance.categorias cat on cat.empresa = c.empresa and cat.codigo = c.ccod_categ
    left join compras.cad_compradores cc on cc.empresa = c.empresa and cc.codigo = c.ncod_compr
    left join finance.projetos pj on pj.empresa = c.empresa and pj.codigo = c.ncod_proj
    left join finance.contas_correntes ccr on ccr.empresa = c.empresa and ccr.cod_cc = c.ncod_cc;

  -- Cliente da venda de origem (PV/OS) — à parte: a view de vendas é pesada
  -- para entrar no join de cada pedido.
  alter table _src add column pv_cliente text;
  update _src s set pv_cliente = v.cliente
    from (select distinct on (empresa, label) empresa, label, cliente
            from sales.v_erp_vendas where label is not null order by empresa, label) v
   where v.empresa = s.empresa and v.label = s.pv_os;

  -- Histórico das mudanças de etapa vindas do Omie (antes do upsert, para ver o valor velho).
  insert into compras.historico (pedido_id, texto, por)
  select p.id, 'Omie: ' || coalesce(ef_old.desc_etapa, p.etapa_omie) || ' → ' || coalesce(ef_new.desc_etapa, s.etapa_omie), 'sync Omie'
    from _src s
    join compras.pedidos p on p.empresa = s.empresa and p.omie_ncod_ped = s.ncod_ped and p.origem = 'omie'
    left join orders.etapas_faturamento ef_old on ef_old.empresa = 'SF' and ef_old.cod_operacao = '21' and ef_old.cod_etapa = p.etapa_omie
    left join orders.etapas_faturamento ef_new on ef_new.empresa = 'SF' and ef_new.cod_operacao = '21' and ef_new.cod_etapa = s.etapa_omie
   where p.etapa_omie is distinct from s.etapa_omie;
  get diagnostics v_hist = row_count;

  with up as (
    insert into compras.pedidos as p (
      empresa, tipo, numero, etapa, etapa_omie, fornecedor_cod, fornecedor_nome, fornecedor_cnpj,
      categoria_cod, categoria_desc, comprador, comprador_cod, projeto_cod, projeto_nome,
      conta_cod, conta_desc, parcela_cod, emissao, previsao, contato, num_pedido_fornecedor, contrato,
      obs, obs_int, pv_os, pv_cliente, nf, chave_nfe, dt_faturado, dt_rec,
      aprov_status, aprov_por, aprov_em, aprov_valor, frete, valor_total,
      origem, omie_ncod_ped, omie_sync_status, omie_ausente, updated_by)
    select s.empresa, s.tipo, s.numero, s.etapa_omie, s.etapa_omie, s.fornecedor_cod, s.fornecedor_nome, s.fornecedor_cnpj,
           s.categoria_cod, s.categoria_desc, s.comprador, s.comprador_cod, s.projeto_cod, s.projeto_nome,
           s.conta_cod, s.conta_desc, s.parcela_cod, s.emissao, s.previsao, s.contato, s.num_pedido_fornecedor, s.contrato,
           s.obs, s.obs_int, s.pv_os, s.pv_cliente, s.nf, s.chave_nfe, s.dt_faturado, s.dt_rec,
           s.aprov_status, s.aprov_por, s.aprov_em, s.aprov_valor, s.frete, s.valor_total,
           'omie', s.ncod_ped, 'espelho', false, 'sync Omie'
      from _src s
    on conflict (empresa, omie_ncod_ped) do update set
      tipo = excluded.tipo, numero = excluded.numero,
      etapa = compras.etapa_max(excluded.etapa_omie, p.etapa_manual),
      etapa_omie = excluded.etapa_omie,
      fornecedor_cod = excluded.fornecedor_cod, fornecedor_nome = excluded.fornecedor_nome,
      fornecedor_cnpj = excluded.fornecedor_cnpj, categoria_cod = excluded.categoria_cod,
      categoria_desc = excluded.categoria_desc, comprador = excluded.comprador,
      comprador_cod = excluded.comprador_cod, projeto_cod = excluded.projeto_cod,
      projeto_nome = excluded.projeto_nome, conta_cod = excluded.conta_cod, conta_desc = excluded.conta_desc,
      parcela_cod = excluded.parcela_cod, emissao = excluded.emissao, previsao = excluded.previsao,
      contato = excluded.contato, num_pedido_fornecedor = excluded.num_pedido_fornecedor,
      contrato = excluded.contrato, obs = excluded.obs, obs_int = excluded.obs_int,
      pv_os = excluded.pv_os, pv_cliente = excluded.pv_cliente,
      -- NF registrada no painel (Focus/manual) não é apagada por um espelho sem NF
      nf = coalesce(excluded.nf, p.nf), chave_nfe = coalesce(excluded.chave_nfe, p.chave_nfe),
      dt_faturado = coalesce(excluded.dt_faturado, p.dt_faturado), dt_rec = coalesce(excluded.dt_rec, p.dt_rec),
      aprov_status = excluded.aprov_status, aprov_por = excluded.aprov_por, aprov_em = excluded.aprov_em,
      aprov_valor = excluded.aprov_valor, frete = excluded.frete, valor_total = excluded.valor_total,
      omie_ausente = false, updated_at = now(), updated_by = 'sync Omie'
    where p.origem = 'omie'
      -- só regrava o que mudou (o sync roda a cada 30 min sobre ~5 mil pedidos)
      and (p.tipo, p.numero, p.etapa_omie, p.fornecedor_cod, p.fornecedor_nome, p.categoria_cod, p.comprador,
           p.projeto_cod, p.projeto_nome, p.conta_cod, p.parcela_cod, p.emissao, p.previsao, p.contato,
           p.num_pedido_fornecedor, p.contrato, p.obs, p.obs_int, p.pv_os, p.pv_cliente, p.nf, p.chave_nfe,
           p.dt_faturado, p.dt_rec, p.aprov_status, p.aprov_em, p.valor_total, p.frete, p.omie_ausente)
          is distinct from
          (excluded.tipo, excluded.numero, excluded.etapa_omie, excluded.fornecedor_cod, excluded.fornecedor_nome,
           excluded.categoria_cod, excluded.comprador, excluded.projeto_cod, excluded.projeto_nome, excluded.conta_cod,
           excluded.parcela_cod, excluded.emissao, excluded.previsao, excluded.contato, excluded.num_pedido_fornecedor,
           excluded.contrato, excluded.obs, excluded.obs_int, excluded.pv_os, excluded.pv_cliente,
           coalesce(excluded.nf, p.nf), coalesce(excluded.chave_nfe, p.chave_nfe),
           coalesce(excluded.dt_faturado, p.dt_faturado), coalesce(excluded.dt_rec, p.dt_rec),
           excluded.aprov_status, excluded.aprov_em, excluded.valor_total, excluded.frete, false)
    returning (xmax = 0) as novo, p.id
  )
  select count(*) filter (where novo), count(*) filter (where not novo) into v_novos, v_atual from up;

  insert into compras.historico (pedido_id, texto, por)
  select p.id, 'Importado do Omie', 'sync Omie' from compras.pedidos p
   where p.origem = 'omie' and not exists (select 1 from compras.historico h where h.pedido_id = p.id);

  -- Itens: upsert por (pedido, nCodItem) e remove o que saiu do Omie.
  with it as (
    select p.id as pedido_id, c.ncod_item,
           row_number() over (partition by c.empresa, c.ncod_ped order by c.ncod_item) as seq,
           nullif(c.cproduto, '') as produto_cod, nullif(c.ncod_prod, 0) as ncod_prod,
           replace(replace(replace(coalesce(c.cdescricao, ''), '&quot;', '"'), '&amp;', '&'), '&apos;', '''') as descricao,
           nullif(c.cunidade, '') as unidade, coalesce(c.nqtde, 0) as qtd, coalesce(c.nval_unit, 0) as valor_unit,
           coalesce(c.ndesconto, 0) as desconto, coalesce(c.nvalor_ipi, 0) as ipi, coalesce(c.nvalor_st, 0) as st,
           nullif(c.cncm, '') as ncm, nullif(c.loc_estoque, '') as local_estoque, nullif(c.nqtde_rec, 0) as qtd_recebida
      from orders.pedidos_compra c
      join compras.pedidos p on p.empresa = c.empresa and p.omie_ncod_ped = c.ncod_ped and p.origem = 'omie'
     where c.ncod_item is not null
  ), ins as (
    insert into compras.itens as i (pedido_id, omie_ncod_item, seq, produto_cod, ncod_prod, descricao, unidade,
                                    qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, qtd_recebida)
    select pedido_id, ncod_item, seq, produto_cod, ncod_prod, descricao, unidade,
           qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, qtd_recebida from it
    on conflict (pedido_id, omie_ncod_item) do update set
      seq = excluded.seq, produto_cod = excluded.produto_cod, ncod_prod = excluded.ncod_prod,
      descricao = excluded.descricao, unidade = excluded.unidade, qtd = excluded.qtd,
      valor_unit = excluded.valor_unit, desconto = excluded.desconto, ipi = excluded.ipi, st = excluded.st,
      ncm = excluded.ncm, local_estoque = excluded.local_estoque,
      qtd_recebida = nullif(greatest(coalesce(excluded.qtd_recebida, 0), coalesce(i.qtd_recebida, 0)), 0)
    where (i.seq, i.produto_cod, i.descricao, i.qtd, i.valor_unit, i.desconto, i.ipi, i.st, i.qtd_recebida, i.ncm, i.local_estoque)
          is distinct from (excluded.seq, excluded.produto_cod, excluded.descricao, excluded.qtd, excluded.valor_unit,
                            excluded.desconto, excluded.ipi, excluded.st,
                            nullif(greatest(coalesce(excluded.qtd_recebida, 0), coalesce(i.qtd_recebida, 0)), 0),
                            excluded.ncm, excluded.local_estoque)
    returning 1
  )
  select count(*) into v_itens from ins;

  delete from compras.itens i
   using compras.pedidos p
   where i.pedido_id = p.id and p.origem = 'omie' and i.omie_ncod_item is not null
     and not exists (select 1 from orders.pedidos_compra c
                      where c.empresa = p.empresa and c.ncod_ped = p.omie_ncod_ped and c.ncod_item = i.omie_ncod_item);

  update compras.pedidos p set omie_ausente = true, updated_at = now()
   where p.origem = 'omie' and not p.omie_ausente
     and not exists (select 1 from _src s where s.empresa = p.empresa and s.ncod_ped = p.omie_ncod_ped);
  get diagnostics v_aus = row_count;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'itens_gravados', v_itens,
                            'ausentes', v_aus, 'historico', v_hist);
end $$;

-- ── API do painel (orders.compras_*) ────────────────────────────────────────
-- Security definer, execução só pelo service_role: as rotas /api/compras/*
-- validam sessão e permissão antes de chamar.

-- Lista (cabeçalhos + o que o Kanban/Tabela precisam). p_desde filtra pela
-- inclusão; o que nasceu no painel vem sempre.
create or replace function orders.compras_lista(p_desde date default null)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  with base as (
    select p.* from compras.pedidos p
     where not p.cancelado and not p.omie_ausente
       and (p_desde is null or p.origem = 'painel' or p.emissao is null or p.emissao >= p_desde)
  ),
  it as (
    select i.pedido_id, count(*) as n,
           left(string_agg(i.descricao || ' ' || coalesce(i.produto_cod, ''), ' | ' order by i.seq), 300) as busca
      from compras.itens i join base b on b.id = i.pedido_id group by 1
  ),
  rcs_do_pc as (
    select pi.pedido_id, array_agg(distinct rp.numero) as rcs
      from compras.item_rc l
      join compras.itens pi on pi.id = l.pc_item_id
      join compras.itens ri on ri.id = l.rc_item_id
      join compras.pedidos rp on rp.id = ri.pedido_id
     group by 1
  ),
  cob_item as (
    select ri.pedido_id, ri.id, ri.qtd,
           coalesce(sum(l.qtd) filter (where pp.id is not null), 0) as cov
      from compras.itens ri
      join base rp on rp.id = ri.pedido_id and rp.tipo = 'RC'
      left join compras.item_rc l on l.rc_item_id = ri.id
      left join compras.itens pi on pi.id = l.pc_item_id
      left join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
     group by 1, 2, 3
  ),
  cob as (
    select pedido_id, count(*) as total, count(*) filter (where qtd > 0 and cov >= qtd) as done
      from cob_item group by 1
  ),
  cob_pcs as (
    select ri.pedido_id, array_agg(distinct pp.numero) as pcs
      from compras.item_rc l
      join compras.itens ri on ri.id = l.rc_item_id
      join compras.itens pi on pi.id = l.pc_item_id
      join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'tipo', b.tipo, 'num', b.numero, 'etapa', b.etapa, 'emp', b.empresa,
    'forn', b.fornecedor_nome, 'fornCod', b.fornecedor_cod, 'cnpj', b.fornecedor_cnpj,
    'proj', b.projeto_nome, 'emissao', b.emissao, 'previsao', b.previsao,
    'cat', b.categoria_desc, 'comprador', b.comprador, 'contato', b.contato,
    'parc', b.parcela_cod, 'conta', b.conta_desc, 'numForn', b.num_pedido_fornecedor,
    'contrato', b.contrato, 'nf', b.nf, 'dtRec', b.dt_rec, 'dtFat', b.dt_faturado,
    'pv', b.pv_os, 'pvCliente', b.pv_cliente, 'obsInt', left(b.obs_int, 200),
    'valor', round(b.valor_total, 2), 'nItens', coalesce(it.n, 0), 'busca', it.busca,
    'aprov', b.aprov_status, 'aprovPor', b.aprov_por, 'aprovEm', b.aprov_em,
    'origem', b.origem, 'sync', b.omie_sync_status,
    'rcs', r.rcs,
    'cobDone', case when b.tipo = 'RC' then coalesce(c.done, 0) end,
    'cobTotal', case when b.tipo = 'RC' then coalesce(c.total, 0) end,
    'cobPcs', cp.pcs
  )) order by b.emissao desc nulls last, b.id desc), '[]'::jsonb)
    from base b
    left join it on it.pedido_id = b.id
    left join rcs_do_pc r on r.pedido_id = b.id
    left join cob c on c.pedido_id = b.id
    left join cob_pcs cp on cp.pedido_id = b.id
$$;

-- Um pedido completo (para a folha de incluir/alterar).
create or replace function orders.compras_pedido(p_id bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object(
    'id', p.id, 'tipo', p.tipo, 'num', p.numero, 'etapa', p.etapa, 'emp', p.empresa,
    'etapaOmie', p.etapa_omie, 'cancelado', p.cancelado,
    'forn', p.fornecedor_nome, 'fornCod', p.fornecedor_cod, 'cnpj', p.fornecedor_cnpj,
    'catCod', p.categoria_cod, 'cat', p.categoria_desc, 'comprador', p.comprador, 'compradorCod', p.comprador_cod,
    'projCod', p.projeto_cod, 'proj', p.projeto_nome, 'contaCod', p.conta_cod, 'conta', p.conta_desc,
    'parc', p.parcela_cod, 'emissao', p.emissao, 'previsao', p.previsao, 'contato', p.contato,
    'numForn', p.num_pedido_fornecedor, 'contrato', p.contrato, 'obs', p.obs, 'obsInt', p.obs_int,
    'pv', p.pv_os, 'pvCliente', p.pv_cliente, 'nf', p.nf, 'chave', p.chave_nfe,
    'dtFat', p.dt_faturado, 'dtRec', p.dt_rec,
    'aprov', p.aprov_status, 'aprovPor', p.aprov_por, 'aprovEm', p.aprov_em, 'aprovValor', p.aprov_valor,
    'frete', p.frete, 'valor', p.valor_total, 'origem', p.origem, 'ncodPed', p.omie_ncod_ped,
    'sync', p.omie_sync_status,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'seq', i.seq, 'cod', i.produto_cod, 'ncodProd', i.ncod_prod, 'desc', i.descricao,
        'un', i.unidade, 'qtd', i.qtd, 'vu', i.valor_unit, 'desc0', i.desconto, 'ipi', i.ipi, 'st', i.st,
        'ncm', i.ncm, 'local', i.local_estoque, 'obs', i.obs, 'rec', i.qtd_recebida,
        -- item de pedido: a que linha de requisição atende
        'rc', (select jsonb_build_object('itemId', ri.id, 'num', rp.numero, 'idx', ri.seq, 'desc', ri.descricao, 'qtd', ri.qtd)
                 from compras.item_rc l join compras.itens ri on ri.id = l.rc_item_id
                 join compras.pedidos rp on rp.id = ri.pedido_id
                where l.pc_item_id = i.id limit 1),
        -- item de requisição: quanto já está em pedidos (sem contar cancelados)
        'cov', (select coalesce(sum(l.qtd), 0) from compras.item_rc l
                  join compras.itens pi on pi.id = l.pc_item_id
                  join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                 where l.rc_item_id = i.id)
      ) order by i.seq, i.id) from compras.itens i where i.pedido_id = p.id), '[]'::jsonb),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'venc', x.vencimento, 'valor', x.valor, 'doc', x.tipo_doc) order by x.n)
                            from compras.parcelas x where x.pedido_id = p.id), '[]'::jsonb),
    'deptos', coalesce((select jsonb_agg(jsonb_build_object('nome', d.departamento, 'perc', d.perc) order by d.departamento)
                          from compras.departamentos d where d.pedido_id = p.id), '[]'::jsonb),
    'hist', coalesce((select jsonb_agg(jsonb_build_object('t', h.texto, 'em', h.em, 'por', h.por) order by h.em, h.id)
                        from compras.historico h where h.pedido_id = p.id), '[]'::jsonb)
  )
  from compras.pedidos p where p.id = p_id
$$;

-- Itens de requisições em aberto (picker "Puxar itens de requisições").
create or replace function orders.compras_rcs_abertas(p_q text default null)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  with it as (
    select rp.id as rc_id, rp.numero, rp.projeto_nome, rp.pv_os, rp.pv_cliente, rp.emissao, rp.comprador,
           ri.id, ri.seq, ri.produto_cod, ri.descricao, ri.unidade, ri.qtd, ri.valor_unit, ri.ncm,
           coalesce((select sum(l.qtd) from compras.item_rc l
                       join compras.itens pi on pi.id = l.pc_item_id
                       join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                      where l.rc_item_id = ri.id), 0) as cov
      from compras.pedidos rp join compras.itens ri on ri.pedido_id = rp.id
     where rp.tipo = 'RC' and not rp.cancelado and not rp.omie_ausente and rp.etapa = '20'
  ),
  rc as (
    select rc_id, numero, projeto_nome, pv_os, pv_cliente, emissao, comprador,
           bool_and(qtd > 0 and cov >= qtd) as atendida,
           string_agg(numero || ' ' || coalesce(projeto_nome, '') || ' ' || coalesce(pv_os, '') || ' ' ||
                      coalesce(pv_cliente, '') || ' ' || descricao || ' ' || coalesce(produto_cod, ''), ' ') as hay,
           jsonb_agg(jsonb_build_object('id', id, 'seq', seq, 'cod', produto_cod, 'desc', descricao, 'un', unidade,
                                        'qtd', qtd, 'vu', valor_unit, 'ncm', ncm, 'cov', cov) order by seq, id) as itens
      from it group by 1, 2, 3, 4, 5, 6, 7
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', rc_id, 'num', numero, 'proj', projeto_nome, 'pv', pv_os,
                                               'pvCliente', pv_cliente, 'emissao', emissao, 'comprador', comprador,
                                               'itens', itens) order by emissao desc nulls last, rc_id desc), '[]'::jsonb)
    from rc
   where not atendida and (coalesce(p_q, '') = '' or lower(hay) like '%' || lower(p_q) || '%')
$$;

-- Gravar (incluir/alterar) — só o que nasceu no painel.
create or replace function orders.compras_salvar(p jsonb, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_ped compras.pedidos;
  v_tipo text := coalesce(p->>'tipo', 'PC');
  v_novo boolean := v_id is null;
  v_it jsonb; v_item_id bigint; v_keep bigint[] := '{}'; v_seq int := 0;
  v_merc numeric := 0; v_frete jsonb := coalesce(p->'frete', '{}'::jsonb); v_total numeric;
begin
  if v_tipo not in ('RC', 'PC') then raise exception 'tipo inválido'; end if;
  if not v_novo then
    select * into v_ped from compras.pedidos where id = v_id for update;
    if not found then raise exception 'Pedido % não existe', v_id; end if;
    if v_ped.origem <> 'painel' then
      raise exception 'Pedido importado do Omie (histórico): só leitura';
    end if;
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_merc := v_merc + coalesce((v_it->>'qtd')::numeric, 0) * coalesce((v_it->>'vu')::numeric, 0)
              - coalesce((v_it->>'desc0')::numeric, 0) + coalesce((v_it->>'ipi')::numeric, 0) + coalesce((v_it->>'st')::numeric, 0);
  end loop;
  v_total := round(v_merc + coalesce((v_frete->>'valor')::numeric, 0) + coalesce((v_frete->>'seguro')::numeric, 0)
                   + coalesce((v_frete->>'outras')::numeric, 0), 2);

  if v_novo then
    insert into compras.pedidos (empresa, tipo, numero, etapa, origem, omie_sync_status, aprov_status, created_by, emissao)
    values (coalesce(p->>'emp', 'SF'), v_tipo, 'P' || lpad(nextval('compras.seq_numero_painel')::text, 4, '0'),
            case when v_tipo = 'RC' then '20' else '10' end, 'painel', null,
            case when v_tipo = 'RC' then 'na' else 'nao_solicitada' end, p_uid,
            (now() at time zone 'America/Sao_Paulo')::date)
    returning * into v_ped;
    v_id := v_ped.id;
    perform compras.add_hist(v_id, case when v_tipo = 'RC' then 'Requisição incluída no painel' else 'Pedido incluído no painel' end, p_por);
    if p->>'origemDe' is not null then perform compras.add_hist(v_id, p->>'origemDe', p_por); end if;
  else
    perform compras.add_hist(v_id, coalesce(p->>'histTexto', 'Alterado'), p_por);
  end if;

  update compras.pedidos set
    tipo = v_tipo,
    fornecedor_cod = nullif(p->>'fornCod', '')::bigint, fornecedor_nome = nullif(p->>'forn', ''),
    fornecedor_cnpj = nullif(p->>'cnpj', ''),
    categoria_cod = nullif(p->>'catCod', ''), categoria_desc = nullif(p->>'cat', ''),
    comprador = nullif(p->>'comprador', ''), comprador_cod = nullif(p->>'compradorCod', '')::bigint,
    projeto_cod = nullif(p->>'projCod', '')::bigint, projeto_nome = nullif(p->>'proj', ''),
    conta_cod = nullif(p->>'contaCod', '')::bigint, conta_desc = nullif(p->>'conta', ''),
    parcela_cod = nullif(p->>'parc', ''),
    previsao = nullif(p->>'previsao', '')::date,
    contato = nullif(p->>'contato', ''), num_pedido_fornecedor = nullif(p->>'numForn', ''),
    contrato = nullif(p->>'contrato', ''), obs = nullif(p->>'obs', ''), obs_int = nullif(p->>'obsInt', ''),
    pv_os = nullif(p->>'pv', ''), pv_cliente = nullif(p->>'pvCliente', ''),
    frete = v_frete, valor_total = v_total,
    -- avanço pedido junto com o salvar (ex.: "Salvar e solicitar aprovação")
    etapa = coalesce(nullif(p->>'novaEtapa', ''), etapa),
    aprov_status = case when p->>'novaAprov' = 'aguardando' and v_tipo = 'PC' then 'aguardando'
                        when v_tipo = 'RC' then 'na'
                        when aprov_status = 'na' then 'nao_solicitada' else aprov_status end,
    updated_at = now(), updated_by = p_por
  where id = v_id;
  if p->>'novaEtapa' is not null and p->>'novaEtapa' <> coalesce(v_ped.etapa, '') and not v_novo then
    perform compras.add_hist(v_id, 'Etapa → ' || (p->>'novaEtapa'), p_por);
  end if;
  if p->>'novaAprov' = 'aguardando' then perform compras.add_hist(v_id, 'Aprovação solicitada', p_por); end if;

  -- Itens: atualiza os que vieram com id, cria os novos, apaga os que saíram.
  for v_it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    v_item_id := nullif(v_it->>'id', '')::bigint;
    if v_item_id is not null and exists (select 1 from compras.itens where id = v_item_id and pedido_id = v_id) then
      update compras.itens set seq = v_seq, produto_cod = nullif(v_it->>'cod', ''),
        ncod_prod = nullif(v_it->>'ncodProd', '')::bigint, descricao = coalesce(v_it->>'desc', ''),
        unidade = coalesce(nullif(v_it->>'un', ''), 'UN'), qtd = coalesce((v_it->>'qtd')::numeric, 0),
        valor_unit = coalesce((v_it->>'vu')::numeric, 0), desconto = coalesce((v_it->>'desc0')::numeric, 0),
        ipi = coalesce((v_it->>'ipi')::numeric, 0), st = coalesce((v_it->>'st')::numeric, 0),
        ncm = nullif(v_it->>'ncm', ''), local_estoque = nullif(v_it->>'local', ''), obs = nullif(v_it->>'obs', '')
      where id = v_item_id;
    else
      insert into compras.itens (pedido_id, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit,
                                 desconto, ipi, st, ncm, local_estoque, obs)
      values (v_id, v_seq, nullif(v_it->>'cod', ''), nullif(v_it->>'ncodProd', '')::bigint, coalesce(v_it->>'desc', ''),
              coalesce(nullif(v_it->>'un', ''), 'UN'), coalesce((v_it->>'qtd')::numeric, 0),
              coalesce((v_it->>'vu')::numeric, 0), coalesce((v_it->>'desc0')::numeric, 0),
              coalesce((v_it->>'ipi')::numeric, 0), coalesce((v_it->>'st')::numeric, 0),
              nullif(v_it->>'ncm', ''), nullif(v_it->>'local', ''), nullif(v_it->>'obs', ''))
      returning id into v_item_id;
    end if;
    v_keep := v_keep || v_item_id;
    -- vínculo com a requisição (só pedido de compra)
    delete from compras.item_rc where pc_item_id = v_item_id;
    if v_tipo = 'PC' and nullif(v_it->'rc'->>'itemId', '') is not null then
      insert into compras.item_rc (pc_item_id, rc_item_id, qtd)
      select v_item_id, ri.id, coalesce((v_it->>'qtd')::numeric, 0)
        from compras.itens ri join compras.pedidos rp on rp.id = ri.pedido_id
       where ri.id = (v_it->'rc'->>'itemId')::bigint and rp.tipo = 'RC';
    end if;
  end loop;
  delete from compras.itens where pedido_id = v_id and not (id = any (v_keep));

  delete from compras.parcelas where pedido_id = v_id;
  insert into compras.parcelas (pedido_id, n, vencimento, valor, tipo_doc)
  select v_id, row_number() over (), nullif(x->>'venc', '')::date, coalesce((x->>'valor')::numeric, 0), coalesce(x->>'doc', 'Boleto')
    from jsonb_array_elements(case when v_tipo = 'PC' then coalesce(p->'parcelas', '[]'::jsonb) else '[]'::jsonb end) x;

  delete from compras.departamentos where pedido_id = v_id;
  insert into compras.departamentos (pedido_id, departamento, perc)
  select v_id, x->>'nome', sum(coalesce((x->>'perc')::numeric, 0))
    from jsonb_array_elements(case when v_tipo = 'PC' then coalesce(p->'deptos', '[]'::jsonb) else '[]'::jsonb end) x
   where coalesce(x->>'nome', '') <> '' group by 2;

  return jsonb_build_object('id', v_id, 'num', (select numero from compras.pedidos where id = v_id));
end $$;

-- Mudar de etapa. No painel é a etapa; no Omie vira etapa_manual (a efetiva é
-- a maior entre ela e a do Omie — o sync não desfaz o que se avançou aqui).
create or replace function orders.compras_mover(p_id bigint, p_etapa text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; v_nova text;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if compras.etapa_ordem(p_etapa) = 0 then raise exception 'Etapa inválida'; end if;
  if v.origem = 'painel' then
    update compras.pedidos set etapa = p_etapa,
      tipo = case when p_etapa <> '20' then 'PC' else tipo end,
      aprov_status = case when p_etapa = '15' and aprov_status in ('nao_solicitada', 'na') then 'aguardando' else aprov_status end,
      dt_rec = case when p_etapa in ('60','80') then coalesce(dt_rec, (now() at time zone 'America/Sao_Paulo')::date) else dt_rec end,
      updated_at = now(), updated_by = p_por
    where id = p_id returning etapa into v_nova;
  else
    update compras.pedidos set etapa_manual = p_etapa, etapa = compras.etapa_max(etapa_omie, p_etapa),
      updated_at = now(), updated_by = p_por
    where id = p_id returning etapa into v_nova;
  end if;
  perform compras.add_hist(p_id, 'Etapa: ' || v.etapa || ' → ' || v_nova, p_por);
  return jsonb_build_object('id', p_id, 'etapa', v_nova);
end $$;

-- Aprovação. Pedido do painel: grava aqui. Pedido do Omie: a rota já gravou em
-- approval.approvals (set-status, com alçada) e aqui só se espelha.
create or replace function orders.compras_aprovar(p_ids bigint[], p_status text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare n int;
begin
  if p_status not in ('aprovado', 'aguardando', 'nao_aprovado', 'nao_solicitada') then raise exception 'status inválido'; end if;
  update compras.pedidos set
    aprov_status = p_status,
    aprov_por = case when p_status = 'aprovado' then p_por end,
    aprov_em = case when p_status = 'aprovado' then now() end,
    aprov_valor = case when p_status = 'aprovado' then valor_total end,
    etapa = case when origem = 'painel' and p_status in ('aprovado', 'aguardando') and etapa = '10' then '15' else etapa end,
    updated_at = now(), updated_by = p_por
  where id = any (p_ids) and tipo = 'PC' and not cancelado;
  get diagnostics n = row_count;
  insert into compras.historico (pedido_id, texto, por)
  select id, case p_status when 'aprovado' then 'Aprovado' when 'aguardando' then 'Aprovação solicitada'
                           when 'nao_aprovado' then 'Não aprovado' else 'Aprovação retirada' end, p_por
    from compras.pedidos where id = any (p_ids) and tipo = 'PC';
  return jsonb_build_object('alterados', n);
end $$;

-- Recebimento: NF (digitada ou vinda da Focus) + quantidades recebidas.
create or replace function orders.compras_receber(p_id bigint, p_nf text, p_chave text, p_dt date,
                                                  p_qtds jsonb, p_final boolean, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; v_parcial boolean; v_etapa text;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  -- Pedido do painel só recebe aprovado; o histórico do Omie não usava a
  -- aprovação de forma consistente, então ali a trava não se aplica.
  if v.origem = 'painel' and v.aprov_status <> 'aprovado' then
    raise exception 'Pedido ainda não aprovado — aprove antes de receber';
  end if;
  if coalesce(trim(p_nf), '') = '' then raise exception 'Informe o número da NF-e'; end if;
  update compras.itens i set qtd_recebida = coalesce((x->>'qtd')::numeric, 0)
    from jsonb_array_elements(coalesce(p_qtds, '[]'::jsonb)) x
   where i.pedido_id = p_id and i.id = (x->>'id')::bigint;
  select bool_or(coalesce(qtd_recebida, 0) < qtd) into v_parcial from compras.itens where pedido_id = p_id;
  v_etapa := case when p_final and not coalesce(v_parcial, false) then '60' else '40' end;
  -- Pedido vindo do Omie avança pela etapa_manual (o sync não a desfaz).
  update compras.pedidos set nf = trim(p_nf), chave_nfe = nullif(trim(coalesce(p_chave, '')), ''),
    etapa = case when origem = 'omie' then compras.etapa_max(etapa_omie, v_etapa) else v_etapa end,
    etapa_manual = case when origem = 'omie' then v_etapa else etapa_manual end,
    dt_faturado = coalesce(dt_faturado, p_dt),
    dt_rec = case when v_etapa = '60' then p_dt else dt_rec end,
    updated_at = now(), updated_by = p_por
  where id = p_id;
  perform compras.add_hist(p_id, case when v_etapa = '60' then 'Recebido' else 'Faturado pelo fornecedor' end
                                 || ' · NF-e ' || trim(p_nf) || case when v_parcial then ' (parcial)' else '' end, p_por);
  return jsonb_build_object('id', p_id, 'etapa', v_etapa, 'parcial', coalesce(v_parcial, false));
end $$;

create or replace function orders.compras_cancelar(p_id bigint, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if v.origem <> 'painel' then raise exception 'Pedido importado do Omie (histórico): só leitura'; end if;
  update compras.pedidos set cancelado = true, updated_at = now(), updated_by = p_por where id = p_id;
  perform compras.add_hist(p_id, 'Cancelado', p_por);
  return jsonb_build_object('id', p_id, 'cancelado', true);
end $$;

-- Exclusão definitiva (só painel; usada para limpar testes).
create or replace function orders.compras_excluir(p_id bigint)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare n int;
begin
  delete from compras.pedidos where id = p_id and origem = 'painel';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Só se exclui o que nasceu no painel'; end if;
  return jsonb_build_object('excluido', p_id);
end $$;

create or replace function orders.compras_duplicar(p_id bigint, p_por text, p_uid uuid default null)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos; v_novo bigint;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  insert into compras.pedidos (empresa, tipo, numero, etapa, fornecedor_cod, fornecedor_nome, fornecedor_cnpj,
    categoria_cod, categoria_desc, comprador, comprador_cod, projeto_cod, projeto_nome, conta_cod, conta_desc,
    parcela_cod, emissao, previsao, contato, contrato, obs, obs_int, pv_os, pv_cliente, aprov_status,
    frete, valor_total, origem, omie_sync_status, created_by, updated_by)
  values (v.empresa, v.tipo, 'P' || lpad(nextval('compras.seq_numero_painel')::text, 4, '0'),
    case when v.tipo = 'RC' then '20' else '10' end, v.fornecedor_cod, v.fornecedor_nome, v.fornecedor_cnpj,
    v.categoria_cod, v.categoria_desc, v.comprador, v.comprador_cod, v.projeto_cod, v.projeto_nome, v.conta_cod, v.conta_desc,
    v.parcela_cod, (now() at time zone 'America/Sao_Paulo')::date, v.previsao, v.contato, v.contrato, v.obs, v.obs_int,
    v.pv_os, v.pv_cliente, case when v.tipo = 'RC' then 'na' else 'nao_solicitada' end,
    v.frete, v.valor_total, 'painel', null, p_uid, p_por)
  returning id into v_novo;
  insert into compras.itens (pedido_id, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit,
                             desconto, ipi, st, ncm, local_estoque, obs)
  select v_novo, seq, produto_cod, ncod_prod, descricao, unidade, qtd, valor_unit, desconto, ipi, st, ncm, local_estoque, obs
    from compras.itens where pedido_id = p_id;
  insert into compras.parcelas (pedido_id, n, vencimento, valor, tipo_doc)
  select v_novo, n, vencimento, valor, tipo_doc from compras.parcelas where pedido_id = p_id;
  insert into compras.departamentos (pedido_id, departamento, perc)
  select v_novo, departamento, perc from compras.departamentos where pedido_id = p_id;
  perform compras.add_hist(v_novo, 'Duplicado do ' || v.numero, p_por);
  return jsonb_build_object('id', v_novo, 'num', (select numero from compras.pedidos where id = v_novo));
end $$;

-- Histórico de preço de um produto: últimas compras (pedidos, não requisições).
create or replace function orders.compras_historico_preco(p_cod text, p_lim int default 25)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('n', x.numero, 'd', x.emissao, 'f', x.fornecedor_nome,
                                               'q', x.qtd, 'vu', x.valor_unit, 'id', x.pedido_id)
                            order by x.emissao desc nulls last, x.pedido_id desc), '[]'::jsonb)
    from (select p.numero, p.emissao, p.fornecedor_nome, i.qtd, i.valor_unit, p.id as pedido_id
            from compras.itens i join compras.pedidos p on p.id = i.pedido_id
           where i.produto_cod = p_cod and p.tipo = 'PC' and not p.cancelado and i.valor_unit > 0
           order by p.emissao desc nulls last, p.id desc limit greatest(1, least(p_lim, 100))) x
$$;

-- Cadastros para os seletores.
create or replace function orders.compras_refs(p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object(
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('cod', c.codigo, 'desc', c.descricao) order by u.n desc nulls last, c.codigo), '[]')
                     from finance.categorias c
                     left join (select ccod_categ, count(distinct ncod_ped) n from orders.pedidos_compra where empresa = p_empresa group by 1) u
                       on u.ccod_categ = c.codigo
                    where c.empresa = p_empresa and c.codigo like '2.%' and coalesce(c.totalizadora, 'N') <> 'S'
                      and coalesce(c.conta_inativa, 'N') <> 'S'),
    'parcelas', (select coalesce(jsonb_agg(jsonb_build_object('cod', codigo, 'desc', descricao, 'dias', compras.parcela_dias(descricao))
                                           order by case when codigo = '000' then 0 else 1 end, n_parcelas, codigo), '[]')
                   from finance.parcelas where codigo <> '999'),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('cod', cod_cc, 'desc', descricao) order by descricao), '[]')
                 from finance.contas_correntes where empresa = p_empresa and coalesce(inativo, 'N') <> 'S'),
    'compradores', (select coalesce(jsonb_agg(distinct jsonb_build_object('cod', cod, 'nome', nome)), '[]') from (
                      select codigo as cod, nome from compras.cad_compradores where empresa = p_empresa
                      union select null, comprador from compras.pedidos where comprador is not null and empresa = p_empresa
                    ) z where nome is not null),
    'departamentos', (select coalesce(jsonb_agg(jsonb_build_object('cod', codigo, 'desc', descricao) order by descricao), '[]')
                        from compras.cad_departamentos where empresa = p_empresa and not inativo),
    'locais', (select coalesce(jsonb_agg(jsonb_build_object('cod', loc, 'n', n) order by n desc), '[]') from (
                 select loc_estoque as loc, count(*) n from orders.pedidos_compra
                  where empresa = p_empresa and coalesce(loc_estoque, '0') <> '0' group by 1) z),
    'projetos', (select coalesce(jsonb_agg(jsonb_build_object('cod', codigo, 'nome', nome) order by nome), '[]')
                   from finance.projetos where empresa = p_empresa and coalesce(inativo, 'N') <> 'S')
  )
$$;

-- Fornecedores (busca por nome/fantasia/CNPJ) com a sugestão do último pedido.
create or replace function orders.compras_buscar_fornecedores(p_q text, p_lim int default 12, p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path = compras, public as $$
  with f as (
    select k.codigo_cliente_omie as cod,
           replace(coalesce(nullif(k.razao_social, ''), k.nome_fantasia), '&amp;', '&') as nome,
           nullif(k.nome_fantasia, '') as fantasia, nullif(k.cnpj_cpf, '') as cnpj,
           coalesce(k.tags, '') ilike '%transport%' as transp
      from finance.clientes k
     where k.empresa = p_empresa and coalesce(k.inativo, 'N') <> 'S'
       and (coalesce(k.tags, '') ilike '%fornecedor%' or coalesce(k.tags, '') ilike '%transport%')
       and (coalesce(p_q, '') = ''
            or k.razao_social ilike '%' || p_q || '%' or k.nome_fantasia ilike '%' || p_q || '%'
            or (regexp_replace(p_q, '\D', '', 'g') <> '' and regexp_replace(coalesce(k.cnpj_cpf, ''), '\D', '', 'g')
                  like '%' || regexp_replace(p_q, '\D', '', 'g') || '%'))
  ),
  ult as (
    select distinct on (fornecedor_cod) fornecedor_cod, categoria_cod, categoria_desc, contato, parcela_cod,
           count(*) over (partition by fornecedor_cod) as n
      from compras.pedidos where tipo = 'PC' and fornecedor_cod in (select cod from f)
     order by fornecedor_cod, emissao desc nulls last, id desc
  )
  select coalesce(jsonb_agg(x.j order by x.n desc nulls last, x.nome), '[]'::jsonb) from (
    select jsonb_strip_nulls(jsonb_build_object('cod', f.cod, 'nome', f.nome, 'fantasia', f.fantasia,
             'cnpj', f.cnpj, 'transp', f.transp, 'n', u.n, 'ultCatCod', u.categoria_cod, 'ultCat', u.categoria_desc,
             'ultContato', u.contato, 'ultParc', u.parcela_cod)) as j, u.n, f.nome
      from f left join ult u on u.fornecedor_cod = f.cod
     order by u.n desc nulls last, f.nome
     limit greatest(1, least(p_lim, 50))) x
$$;

-- ── Permissões das funções da API ───────────────────────────────────────────
do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or n.nspname = 'compras' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Conciliação a cada 30 min (depois do sync de pedidos de compra).
select cron.schedule('conciliar-compras-omie', '25,55 * * * *', 'SELECT compras.conciliar_omie()');
