-- 140 — Fluxo de Caixa do Financeiro (08/10/26, Benny — financeiro-fluxo-v3-SPEC.md, P2)
-- Aba /financeiro/fluxo: fluxo POR EMPRESA com os bancos escolhidos unificados.
-- Uma chamada traz tudo e a tela monta dia/semana/mês, saldo, cenários e zoom
-- no navegador (sem nova chamada). Nada escreve no Omie.
--  · realizado  = finance.v_razao_nativo (o que de facto entrou/saiu da conta)
--  · a pagar    = títulos do Omie em aberto (com titulo_ajustes) + contas do painel
--  · a receber  = títulos em aberto + competências futuras de vendas.contratos
--                 ainda não faturadas (provisionado)
--  · recebíveis vencidos ficam FORA do Base (só a alavanca "recuperar vencidos")
--  · provisionado (P1, leitura): recorrência do Omie (RPTP) sem NF/boleto/chave,
--    série do painel sem NF/documento, competência de contrato a faturar

-- ── grupos (prefixo da categoria → grupo do fluxo), editável ──
create table if not exists finance.fluxo_grupos (
  prefixo   text primary key,
  grupo     text not null,
  natureza  char(1) not null check (natureza in ('E', 'S', '*'))
);
insert into finance.fluxo_grupos (prefixo, grupo, natureza) values
  ('0.01',    'Transferência', '*'),
  ('2.10.97', 'Intercompany', '*'), ('2.10.98', 'Intercompany', '*'), ('1.04.04', 'Intercompany', '*'),
  ('2.03',    'Pessoal e PJ', 'S'),
  ('2.01',    'Fornecedores e matéria-prima', 'S'), ('2.08', 'Fornecedores e matéria-prima', 'S'),
  ('2.06',    'Impostos e guias', 'S'),
  ('2.04.90', 'Locação de veículos', 'S'),
  ('2.07',    'Financeiras', 'S'), ('2.10', 'Financeiras', 'S'), ('2.11', 'Financeiras', 'S'),
  ('2',       'Administrativo e consumo', 'S'),
  ('1.01.01', 'Contratos recorrentes', 'E'), ('1.01.98', 'Contratos recorrentes', 'E'),
  ('1.01',    'Faturamento OS / vendas', 'E'),
  ('1',       'Outras entradas', 'E')
on conflict (prefixo) do nothing;
alter table finance.fluxo_grupos enable row level security;
grant all on finance.fluxo_grupos to service_role;

create or replace function finance.fluxo_grupo(p_cat text, p_nat char)
returns text language sql stable set search_path to 'finance', 'public'
as $$
  select coalesce(
    (select g.grupo from finance.fluxo_grupos g
      where coalesce(p_cat, '') like g.prefixo || '%' and (g.natureza = '*' or g.natureza = p_nat)
      order by length(g.prefixo) desc limit 1),
    case when p_nat = 'E' then 'Outras entradas' else 'Administrativo e consumo' end)
$$;

-- conta padrão de cada empresa (título sem conta entra por ela)
insert into finance.config (chave, valor, atualizado_por)
values ('conta_padrao_fluxo', '{"CD":2252413873,"SF":9854117787,"WW":2180831804}', 'p140')
on conflict do nothing;

-- ── previsto × realizado: foto diária do que está previsto (sem inventar o passado) ──
create table if not exists finance.fluxo_snapshot (
  dia date not null, ref text not null, empresa text, natureza char(1), data_prevista date not null,
  valor numeric(15,2) not null, provisionado boolean not null default false,
  primary key (dia, ref)
);
alter table finance.fluxo_snapshot enable row level security;
grant all on finance.fluxo_snapshot to service_role;

-- ── dados do fluxo ──
create or replace function finance.fluxo_caixa_dados(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path to 'finance', 'public'
as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
pad as (select valor v from finance.config where chave = 'conta_padrao_fluxo'),
contas as (
  select s.empresa, s.cod_conta id, s.conta nome, round(s.saldo::numeric, 2) saldo
    from bi.saldo_por_conta(null) s
    join finance.contas_correntes cc on cc.empresa = s.empresa and cc.cod_cc = s.cod_conta and coalesce(cc.inativo, 'N') <> 'S'
),
-- realizado
raz as (
  select r.empresa, r.cod_cc, r.data, abs(r.valor) valor, case when r.natureza = 'R' then 'E' else 'S' end nat,
         r.cod_categoria, r.des_categoria, r.contraparte, r.documento, r.ref, r.fonte
    from finance.v_razao_nativo r, hoje h
   where r.data between p_de and h.d and r.valor <> 0
),
tr as (select * from raz where coalesce(cod_categoria, '') like '0.01%'),
grp as (select distinct cod_categoria c, nat n from raz),
grp2 as (select c, n, finance.fluxo_grupo(c, n) g from grp),
raz2 as (
  select x.*, g.g grupo,
         case when coalesce(x.cod_categoria, '') like '0.01%' then
           (select y.cod_cc from tr y
             where y.empresa = x.empresa and y.data = x.data and y.nat <> x.nat and y.cod_cc <> x.cod_cc
               and abs(y.valor - x.valor) < 0.01 limit 1) end par
    from raz x left join grp2 g on g.c is not distinct from x.cod_categoria and g.n = x.nat
),
pb as (select cod_titulo, sum(valor) v from finance.baixas where cod_titulo is not null and estornado_em is null group by 1),
-- a pagar do Omie
pag_o as (
  select 'o:' || t.cod_titulo ref, t.empresa, nullif(regexp_replace(coalesce(t.cod_cc::text, ''), '\D', '', 'g'), '')::bigint cod_cc,
         coalesce(po.dt_previsao_nova, t.previsao::date, t.vencimento::date) data,
         round((coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0))::numeric, 2) valor,
         t.codigo_categoria cat, coalesce(nullif(t.contraparte, ''), t.contraparte_razao, '(sem nome)') contraparte,
         coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc,
         (t.origem = 'RPTP' and coalesce(t.numero_documento_fiscal, '') = '' and coalesce(t.codigo_barras, '') = '' and coalesce(t.chave_nfe, '') = '') prov
    from finance.v_titulos_omie_bruto t
    left join pb on pb.cod_titulo = t.cod_titulo
    left join finance.previsao_override po on po.cod_titulo = t.cod_titulo
   where t.tipo = 'pagar' and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
),
-- a pagar do painel (manual, séries, previsão de PC)
pag_p as (
  select 'p:' || v.pagar_id ref, v.empresa, nullif(regexp_replace(coalesce(v.cod_cc::text, ''), '\D', '', 'g'), '')::bigint cod_cc, coalesce(v.previsao::date, v.vencimento::date) data,
         round(v.val_aberto::numeric, 2) valor, v.codigo_categoria cat, coalesce(nullif(v.contraparte, ''), '(sem nome)') contraparte,
         coalesce(nullif(v.numero_documento_fiscal, ''), nullif(v.numero_documento, '')) doc,
         (pp.serie_id is not null and coalesce(pp.nf_numero, '') = '' and coalesce(pp.documento, '') = '') prov
    from finance.v_pagar_previsto v join finance.pagar_previsto pp on pp.id = v.pagar_id
   where not coalesce(v.quitado, false) and v.val_aberto > 0.004
),
pag as (
  select x.*, finance.fluxo_grupo(x.cat, 'S') grupo from (select * from pag_o union all select * from pag_p) x, hoje h
   where x.valor > 0.004 and x.data <= p_ate and x.data >= h.d - 60   -- vencidos: só os últimos 60 dias (como o card da Pagar)
),
-- a receber
rec as (
  select 'r:' || r.id ref, r.empresa, nullif(regexp_replace(coalesce(r.cod_cc::text, ''), '\D', '', 'g'), '')::bigint cod_cc,
         coalesce(po.dt_previsao_nova, r.previsao::date, r.vencimento::date) data,
         round(coalesce(r.val_aberto, r.valor_documento)::numeric, 2) valor, r.codigo_categoria cat,
         coalesce(nullif(r.contraparte, ''), r.contraparte_razao, '(sem nome)') contraparte,
         coalesce(nullif(r.numero_documento_fiscal, ''), nullif(r.numero_documento, '')) doc
    from finance.v_receber_bruto r
    left join finance.previsao_override po on po.cod_titulo = r.cod_titulo
   where r.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO') and coalesce(r.val_aberto, r.valor_documento) > 0.004
),
-- competências futuras dos contratos ativos ainda não faturadas (provisionado)
meses as (select generate_series(date_trunc('month', (select d from hoje)), date_trunc('month', p_ate), interval '1 month')::date m),
contr as (
  select c.id, c.empresa, nullif(regexp_replace(coalesce(c.cc_codigo::text, ''), '\D', '', 'g'), '')::bigint cc_codigo, c.categoria_codigo, c.cliente_nome, c.numero, c.valor_periodo, ms.m comp,
         (make_date(extract(year from ms.m + (case when c.fatura_mes_seguinte then interval '1 month' else interval '0' end))::int,
                    extract(month from ms.m + (case when c.fatura_mes_seguinte then interval '1 month' else interval '0' end))::int,
                    least(greatest(coalesce(c.dia_faturamento, 1), 1), 28))
          + coalesce(nullif(regexp_replace(coalesce(c.condicao_codigo, ''), '\D', '', 'g'), '')::int, 0)) data
    from vendas.contratos c cross join meses ms
   where c.status = 'ativo' and coalesce(c.valor_periodo, 0) > 0
     and (c.vig_inicio is null or ms.m >= date_trunc('month', c.vig_inicio))
     and (c.vig_fim is null or ms.m <= c.vig_fim)
     and (c.vig_inicio is null or ((extract(year from ms.m) * 12 + extract(month from ms.m))
          - (extract(year from c.vig_inicio) * 12 + extract(month from c.vig_inicio)))::int % greatest(coalesce(c.periodicidade_meses, 1), 1) = 0)
     and not exists (select 1 from vendas.contrato_competencias cc
                      where cc.contrato_id = c.id and cc.competencia = ms.m and cc.status <> 'cancelado')
)
select jsonb_build_object(
  'hoje', (select d from hoje),
  'conta_padrao', coalesce((select v from pad), '{}'::jsonb),
  'snapshot', exists (select 1 from finance.fluxo_snapshot limit 1),
  'contas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'emp', c.empresa, 'nome', c.nome, 'saldo', c.saldo) order by c.empresa, c.saldo desc) from contas c), '[]'::jsonb),
  -- lançamentos: [emp, nat, grupo, data, valor, status(R realizado|A aberto), conta, contraparte, prov, doc, transf, par, ref]
  'lancs', (
    select coalesce(jsonb_agg(jsonb_build_array(emp, nat, grupo, data, valor, st, conta, contraparte, prov, doc, transf, par, ref)), '[]'::jsonb) from (
      select r.empresa emp, r.nat, case when r.grupo = 'Transferência' then 'Transferência' else r.grupo end grupo, r.data, r.valor, 'R' st,
             r.cod_cc conta, coalesce(nullif(r.contraparte, ''), r.des_categoria, r.fonte) contraparte, false prov, r.documento doc,
             (r.grupo = 'Transferência') transf, r.par, null::text ref
        from raz2 r
      union all
      select p.empresa, 'S', p.grupo, p.data, p.valor, 'A', p.cod_cc, p.contraparte, p.prov, p.doc, p.grupo = 'Transferência', null, p.ref from pag p
      union all
      select r.empresa, 'E', finance.fluxo_grupo(r.cat, 'E'), r.data, r.valor, 'A', r.cod_cc, r.contraparte, false, r.doc, false, null, r.ref
        from rec r, hoje h where r.data >= h.d and r.data <= p_ate
      union all
      select c.empresa, 'E', 'Contratos recorrentes', c.data, round(c.valor_periodo::numeric, 2), 'A', c.cc_codigo, c.cliente_nome || ' · ' || c.numero,
             true, null, false, null, 'c:' || c.id || ':' || c.comp
        from contr c, hoje h where c.data >= h.d and c.data <= p_ate
    ) z),
  -- recebíveis vencidos (fora do Base): [emp, grupo, data, valor, conta, contraparte, doc, ref]
  'rec_venc', (
    select coalesce(jsonb_agg(jsonb_build_array(r.empresa, finance.fluxo_grupo(r.cat, 'E'), r.data, r.valor, r.cod_cc, r.contraparte, r.doc, r.ref)), '[]'::jsonb)
      from rec r, hoje h where r.data < h.d and r.data >= h.d - 180)
)
$$;

create or replace function finance.fluxo_snapshot_gravar() returns int
language plpgsql security definer set search_path to 'finance', 'public'
as $$
declare h date := (now() at time zone 'America/Sao_Paulo')::date; j jsonb; n int;
begin
  j := finance.fluxo_caixa_dados(h, h + 180);
  insert into finance.fluxo_snapshot (dia, ref, empresa, natureza, data_prevista, valor, provisionado)
  select h, x->>12, x->>0, x->>1, (x->>3)::date, (x->>4)::numeric, (x->>8)::boolean
    from jsonb_array_elements(j->'lancs') x
   where x->>5 = 'A' and x->>12 is not null
  on conflict (dia, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── cenários e linhas de simulação ──
create table if not exists finance.fluxo_cenarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null, cor text not null,
  alavancas jsonb not null default '{}'::jsonb,   -- {atraso, inad, rec, recDias, desp, prov, post}
  eventos bigint[] not null default '{}',
  empresas text[], compartilhado boolean not null default false,
  criado_por text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table if not exists finance.fluxo_eventos (
  id bigserial primary key,
  descricao text not null, natureza char(1) not null check (natureza in ('E', 'S')),
  valor numeric(15,2) not null check (valor > 0), data date not null,
  repeticoes int not null default 1 check (repeticoes between 1 and 36),
  empresa text not null, conta_id bigint, categoria text,
  virou_titulo jsonb,
  criado_por text, criado_em timestamptz not null default now()
);
alter table finance.fluxo_cenarios enable row level security;
alter table finance.fluxo_eventos enable row level security;
grant all on finance.fluxo_cenarios, finance.fluxo_eventos to service_role;
grant usage, select on sequence finance.fluxo_eventos_id_seq to service_role;

-- foto diária às 23:55 (Brasília = 02:55 UTC)
select cron.schedule('fluxo-snapshot-diario', '55 2 * * *', 'select finance.fluxo_snapshot_gravar()')
 where not exists (select 1 from cron.job where jobname = 'fluxo-snapshot-diario');
