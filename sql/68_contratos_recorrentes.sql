-- 68 — Contratos recorrentes (05/10/2026)
--
-- Benny: "em Faturamento uma aba de contratos recorrentes. Puxe já todos os
-- contratos recorrentes, veja quando é que tem que faturar. Vamos organizar
-- uma tela para isso."
--
-- Fonte inicial: espelho do Omie sales.contratos_servico (ListarContratos,
-- sincronizado em 02/10) + histórico de OS de contrato em sales.ordens_servico
-- (numero_contrato + cliente). Depois da importação o contrato vive aqui
-- (vendas.contratos); o Omie não é mais lido de forma contínua — só pelo botão
-- "Reler do Omie" (transição, só leitura do espelho).
--
-- Faturar competência = cria a OS nativa (vendas.documentos, contrato_id) com
-- os itens do contrato; a OS segue pelo motor de faturamento (recibo) ou pelo
-- registro de NFS-e da prefeitura (sql/59). Trava: uma competência por contrato.
-- Aplicado como migrations p68_contratos_*.

create table if not exists vendas.contratos (
  id                   bigserial primary key,
  empresa              text not null default 'SF',
  numero               text not null,
  omie_codigo          bigint,
  cliente_codigo       bigint,
  cliente_nome         text,
  cliente_doc          text,
  projeto_codigo       text,
  categoria_codigo     text,
  cc_codigo            text,
  status               text not null default 'ativo' check (status in ('rascunho','ativo','suspenso','encerrado')),
  vig_inicio           date,
  vig_fim              date,
  periodicidade_meses  int not null default 1 check (periodicidade_meses in (1,2,3,4,6,12)),
  dia_faturamento      int not null default 1 check (dia_faturamento between 1 and 31),
  fatura_mes_seguinte  boolean not null default true,   -- competência M fatura no mês M+1
  valor_periodo        numeric(15,2) not null default 0,
  condicao_codigo      text,
  tipo_documento       text check (tipo_documento in ('recibo','nfse','nfe')),  -- null = config da empresa
  indice_reajuste      text,
  data_base_reajuste   date,
  proximo_reajuste     date,
  observacoes          text,
  origem               text not null default 'painel' check (origem in ('omie','painel')),
  editado_no_painel    boolean not null default false,
  omie_situacao        text,
  criado_por           text,
  criado_em            timestamptz not null default now(),
  atualizado_por       text,
  atualizado_em        timestamptz not null default now()
);
create unique index if not exists contratos_omie_uq on vendas.contratos (empresa, omie_codigo) where omie_codigo is not null;
create index if not exists contratos_cli_ix on vendas.contratos (empresa, cliente_codigo);

create table if not exists vendas.contrato_itens (
  id               bigserial primary key,
  contrato_id      bigint not null references vendas.contratos(id) on delete cascade,
  seq              int not null,
  servico_codigo   text,
  lc116            text,
  cod_serv_munic   text,
  descricao        text not null,
  quantidade       numeric(15,4) not null default 1,
  valor_unitario   numeric(15,2) not null default 0,
  valor_total      numeric(15,2) generated always as (round(quantidade * valor_unitario, 2)) stored,
  aliq_iss         numeric(6,2),
  retem_iss        boolean not null default false
);
create index if not exists contrato_itens_ix on vendas.contrato_itens (contrato_id, seq);

create table if not exists vendas.contrato_competencias (
  id                bigserial primary key,
  contrato_id       bigint not null references vendas.contratos(id) on delete cascade,
  competencia       date not null check (extract(day from competencia) = 1),
  status            text not null default 'gerado' check (status in ('gerado','faturado','cancelado')),
  origem            text not null default 'painel' check (origem in ('omie','painel')),
  venda_id          bigint,          -- vendas.documentos (OS nativa)
  documento_rotulo  text,            -- OS4835
  omie_os_codigo    text,
  valor             numeric(15,2),
  data_faturamento  date,
  recibo            text,
  criado_por        text,
  criado_em         timestamptz not null default now(),
  cancelado_motivo  text
);
create unique index if not exists contrato_comp_uq on vendas.contrato_competencias (contrato_id, competencia) where status <> 'cancelado';

create table if not exists vendas.contrato_reajustes (
  id             bigserial primary key,
  contrato_id    bigint not null references vendas.contratos(id) on delete cascade,
  vigente_desde  date not null,
  valor_anterior numeric(15,2),
  valor_novo     numeric(15,2) not null,
  indice         text,
  percentual     numeric(8,4),
  observacao     text,
  origem         text not null default 'painel',
  por            text,
  em             timestamptz not null default now()
);

create table if not exists vendas.contrato_hist (
  id          bigserial primary key,
  contrato_id bigint not null references vendas.contratos(id) on delete cascade,
  por         text,
  acao        text not null,
  detalhe     jsonb,
  em          timestamptz not null default now()
);

alter table vendas.documentos
  add column if not exists contrato_id bigint,
  add column if not exists contrato_competencia date;

alter table vendas.contratos enable row level security;
alter table vendas.contrato_itens enable row level security;
alter table vendas.contrato_competencias enable row level security;
alter table vendas.contrato_reajustes enable row level security;
alter table vendas.contrato_hist enable row level security;
revoke all on vendas.contratos, vendas.contrato_itens, vendas.contrato_competencias, vendas.contrato_reajustes, vendas.contrato_hist from public, anon, authenticated;
grant all on vendas.contratos, vendas.contrato_itens, vendas.contrato_competencias, vendas.contrato_reajustes, vendas.contrato_hist to service_role;
grant usage, select on all sequences in schema vendas to service_role;

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function vendas.dt_br(t text) returns date language sql immutable as $$
  select case when t ~ '^\d{2}/\d{2}/\d{4}$' then to_date(t, 'DD/MM/YYYY') end $$;

-- "REFERENTE AO MES: SETEMBRO/2026", "Ref. Julho/2025", "REF. OUTUBRO / 2022" → 2026-09-01
create or replace function vendas.mes_referencia(t text) returns date language plpgsql immutable as $$
declare m text[]; nomes text[] := array['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  k int; s text;
begin
  if t is null then return null; end if;
  s := upper(translate(t, 'áàâãäéêèíóôõöúüçÁÀÂÃÄÉÊÈÍÓÔÕÖÚÜÇ', 'aaaaaeeeiooooucAAAAAEEEIOOOOUC'));
  m := regexp_match(s, '\m(?:REFERENTE|REF|MES|COMPETENCIA)\M[^0-9|]*(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*[/ -]?\s*(\d{4}|\d{2})');
  if m is null then return null; end if;
  k := array_position(nomes, m[1]);
  if k is null then return null; end if;
  return make_date(case when length(m[2]) = 2 then 2000 + m[2]::int else m[2]::int end, k, 1);
exception when others then return null;
end $$;

-- texto do item sem o "REFERENTE …/AAAA" do mês anterior
create or replace function vendas.sem_referencia(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(t, ''), '\m(REFERENTE|REF)\M\.?[^|]*', '', 'gi'), '\|{3,}', '||', 'g'), ' |') $$;

create or replace function vendas.nome_mes(d date) returns text language sql immutable as $$
  select (array['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'])[extract(month from d)::int]
         || '/' || extract(year from d)::int $$;

create or replace function vendas.contrato_log(p_id bigint, p_por text, p_acao text, p_det jsonb) returns void
language sql as $$ insert into vendas.contrato_hist (contrato_id, por, acao, detalhe) values (p_id, p_por, p_acao, p_det) $$;

-- ── Importação do espelho do Omie (idempotente) ────────────────────────────
create or replace function orders.contratos_importar_omie(p_por text default 'importacao')
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare
  r record; c vendas.contratos; v_id bigint; n_ctr int := 0; n_novos int := 0; n_comp int := 0; n_reaj int := 0;
  v_cli record; v_status text; v_per int; seg int; tot int; v_ult record; v_base date; v_cond text;
begin
  for r in
    select s.empresa, s.codigo_contrato::bigint omie_codigo, min(s.numero_contrato) numero, min(s.codigo_cliente) codigo_cliente,
           min(s.situacao) situacao, min(s.vig_inicial) vig_inicial, min(s.vig_final) vig_final, min(s.tipo_faturamento) tipo_fat,
           min(s.dia_faturamento) dia_fat, max(s.vlr_tot_mes) vlr, min(s.codigo_categoria) cat, min(s.codigo_cc) cc, min(s.codigo_projeto) proj
      from sales.contratos_servico s
     where s.codigo_contrato ~ '^\d+$'
     group by s.empresa, s.codigo_contrato
  loop
    v_status := case r.situacao when '10' then 'ativo' when '00' then 'rascunho' when '90' then 'suspenso' when '99' then 'encerrado' else 'ativo' end;
    v_per := case r.tipo_fat when '01' then 1 when '02' then 2 when '03' then 3 when '04' then 4 when '06' then 6 when '12' then 12 else 1 end;
    select codigo_cliente_omie, coalesce(nullif(razao_social,''), nome_fantasia) nome, cnpj_cpf into v_cli
      from finance.clientes where empresa = r.empresa and codigo_cliente_omie::text = r.codigo_cliente;

    select * into c from vendas.contratos where empresa = r.empresa and omie_codigo = r.omie_codigo;
    if not found then
      insert into vendas.contratos (empresa, numero, omie_codigo, origem, criado_por, atualizado_por)
      values (r.empresa, coalesce(r.numero, 'CTR' || r.omie_codigo), r.omie_codigo, 'omie', p_por, p_por) returning * into c;
      n_novos := n_novos + 1;
    end if;
    v_id := c.id;
    n_ctr := n_ctr + 1;

    if not c.editado_no_painel then
      update vendas.contratos set
        numero = coalesce(r.numero, numero), cliente_codigo = nullif(r.codigo_cliente,'')::bigint,
        cliente_nome = v_cli.nome, cliente_doc = v_cli.cnpj_cpf,
        projeto_codigo = r.proj, categoria_codigo = r.cat, cc_codigo = r.cc,
        status = v_status, omie_situacao = r.situacao,
        vig_inicio = vendas.dt_br(r.vig_inicial), vig_fim = vendas.dt_br(r.vig_final),
        periodicidade_meses = v_per, dia_faturamento = greatest(1, least(31, coalesce(nullif(r.dia_fat,'')::int, 1))),
        valor_periodo = coalesce(r.vlr, 0), atualizado_em = now()
      where id = v_id;
      delete from vendas.contrato_itens where contrato_id = v_id;
      insert into vendas.contrato_itens (contrato_id, seq, servico_codigo, lc116, cod_serv_munic, descricao, quantidade, valor_unitario, aliq_iss, retem_iss)
      select v_id, s.seq, s.codigo_servico, s.cod_lc116, s.cod_serv_munic,
             coalesce(nullif(vendas.sem_referencia(replace(s.descricao_completa, '&apos;', '''')), ''), 'Serviço do contrato ' || coalesce(r.numero, '')),
             coalesce(s.quantidade, 1), coalesce(s.valor_unitario, s.valor_total, 0), s.aliq_iss, upper(coalesce(s.retem_iss,'N')) = 'S'
        from sales.contratos_servico s where s.empresa = r.empresa and s.codigo_contrato = r.omie_codigo::text order by s.seq;
    end if;

    -- histórico: OS do Omie deste contrato (mesmo nº e mesmo cliente), uma por competência
    with os as (
      select o.codigo_os, min(o.numero_os) numero_os, min(o.dt_fat) dt_fat, min(o.d_inc) d_inc, max(o.faturada) faturada,
             max(o.cancelada) cancelada, min(o.num_recibo) recibo, max(o.valor_total) valor, min(o.codigo_parcela) parcela,
             string_agg(o.descricao_servico, ' ') descr
        from sales.ordens_servico o
       where o.empresa = r.empresa and o.numero_contrato = r.numero and o.codigo_cliente = r.codigo_cliente
       group by o.codigo_os
    ), comp as (
      select os.*, coalesce(vendas.mes_referencia(os.descr),
               (date_trunc('month', coalesce(vendas.dt_br(os.dt_fat), vendas.dt_br(os.d_inc))) - interval '1 month')::date) competencia,
             coalesce(vendas.dt_br(os.dt_fat), vendas.dt_br(os.d_inc)) data_fat
        from os where coalesce(os.cancelada, 'N') <> 'S'
    ), uma as (
      select distinct on (competencia) * from comp where competencia is not null order by competencia, data_fat
    )
    insert into vendas.contrato_competencias (contrato_id, competencia, status, origem, documento_rotulo, omie_os_codigo, valor, data_faturamento, recibo, criado_por)
    select v_id, u.competencia, case when u.faturada = 'S' then 'faturado' else 'gerado' end, 'omie', 'OS' || u.numero_os, u.codigo_os,
           u.valor, u.data_fat, u.recibo, p_por
      from uma u
    on conflict (contrato_id, competencia) where status <> 'cancelado' do update
      set status = case when excluded.status = 'faturado' then 'faturado' else vendas.contrato_competencias.status end,
          data_faturamento = coalesce(vendas.contrato_competencias.data_faturamento, excluded.data_faturamento),
          recibo = coalesce(vendas.contrato_competencias.recibo, excluded.recibo)
      where vendas.contrato_competencias.origem = 'omie';
    get diagnostics tot = row_count; n_comp := n_comp + tot;

    if not c.editado_no_painel then
      -- faturamento no mês seguinte? (maioria do histórico: competência = mês anterior à data da OS)
      select count(*) filter (where competencia < date_trunc('month', data_faturamento)), count(*) into seg, tot
        from (select * from vendas.contrato_competencias where contrato_id = v_id and data_faturamento is not null
               order by competencia desc limit 12) h;
      -- condição: a última usada nas OS do contrato
      select o.codigo_parcela into v_cond from sales.ordens_servico o
       where o.empresa = r.empresa and o.numero_contrato = r.numero and o.codigo_cliente = r.codigo_cliente and o.codigo_parcela is not null
       order by vendas.dt_br(o.d_inc) desc nulls last limit 1;
      update vendas.contratos set fatura_mes_seguinte = case when tot = 0 then true else seg * 2 >= tot end,
             condicao_codigo = coalesce(v_cond, condicao_codigo)
       where id = v_id;

      -- reajustes vistos no histórico: o valor mudou e o novo valor se repetiu na
      -- competência seguinte (ou é a última) — mês quebrado/proporcional não conta
      v_base := null;
      for v_ult in
        select competencia, valor, ant, prox from (
          select competencia, valor, lag(valor) over w ant, lag(valor, 2) over w ant2, lead(valor) over w prox
            from vendas.contrato_competencias where contrato_id = v_id and status <> 'cancelado' and valor > 0
          window w as (order by competencia)) z
         where ant is not null and abs(valor - ant) > 0.009 and (prox is null or abs(prox - valor) <= 0.009)
           and (ant2 is null or abs(valor - ant2) > 0.009)
         order by competencia
      loop
        insert into vendas.contrato_reajustes (contrato_id, vigente_desde, valor_anterior, valor_novo, percentual, origem, observacao, por)
        select v_id, v_ult.competencia, v_ult.ant, v_ult.valor, round((v_ult.valor / nullif(v_ult.ant, 0) - 1) * 100, 4), 'omie',
               'Inferido do histórico de OS do Omie', p_por
         where not exists (select 1 from vendas.contrato_reajustes x where x.contrato_id = v_id and x.vigente_desde = v_ult.competencia);
        get diagnostics tot = row_count; n_reaj := n_reaj + tot;
        v_base := v_ult.competencia;
      end loop;
      if v_base is not null then
        update vendas.contratos set data_base_reajuste = v_base,
               proximo_reajuste = (v_base + interval '12 months')::date
         where id = v_id and (data_base_reajuste is null or data_base_reajuste < v_base);
      end if;
    end if;
  end loop;

  return jsonb_build_object('contratos', n_ctr, 'novos', n_novos, 'competencias', n_comp, 'reajustes', n_reaj);
end $$;

-- ── Agenda: competências devidas e situação do mês ──────────────────────────
-- Para cada contrato: competências até o mês de referência (âncora no início da
-- vigência, a cada N meses), dentro da vigência; a data de faturamento é o
-- dia_faturamento do mês da competência (+1 mês se fatura_mes_seguinte).
create or replace function vendas.contrato_competencias_devidas(c vendas.contratos, p_ate date, p_meses_atras int default 3)
returns table (competencia date, data_prevista date) language sql stable as $$
  with base as (
    select date_trunc('month', coalesce(c.vig_inicio, date '2020-01-01'))::date ancora,
           date_trunc('month', p_ate)::date ate_mes
  ), meses as (
    select generate_series(greatest((select ancora from base), ((select ate_mes from base) - make_interval(months => p_meses_atras + 1))::date),
                           (select ate_mes from base), interval '1 month')::date m
  )
  select m.m,
         (date_trunc('month', m.m + case when c.fatura_mes_seguinte then interval '1 month' else interval '0' end)::date
           + (least(c.dia_faturamento, extract(day from (date_trunc('month', m.m + case when c.fatura_mes_seguinte then interval '1 month' else interval '0' end) + interval '1 month - 1 day'))::int) - 1))::date
    from meses m, base b
   where ((extract(year from m.m) * 12 + extract(month from m.m)) - (extract(year from b.ancora) * 12 + extract(month from b.ancora)))::int % c.periodicidade_meses = 0
     and (c.vig_inicio is null or m.m >= date_trunc('month', c.vig_inicio))
     and (c.vig_fim is null or m.m <= c.vig_fim)
$$;

create or replace function orders.contratos_painel(p_empresa text default 'SF', p_hoje date default null)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  with hoje as (select coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) d),
  ctr as (
    select c.*, (select d from hoje) hoje from vendas.contratos c where c.empresa = upper(p_empresa)
  ),
  comps as (
    select c.id contrato_id, dv.competencia, dv.data_prevista,
           cc.id comp_id, cc.status comp_status, cc.documento_rotulo, cc.venda_id, cc.origem comp_origem, cc.data_faturamento,
           d.status doc_status
      from ctr c
      cross join lateral vendas.contrato_competencias_devidas(c, (c.hoje + interval '2 months')::date, 4) dv
      left join vendas.contrato_competencias cc on cc.contrato_id = c.id and cc.competencia = dv.competencia and cc.status <> 'cancelado'
      left join vendas.documentos d on d.id = cc.venda_id
     where c.status = 'ativo'
  ),
  st as (
    select x.*, case
        when x.comp_id is not null and (x.comp_status = 'faturado' or x.doc_status = 'faturado') then 'faturado'
        when x.comp_id is not null then 'gerado'
        when x.data_prevista < (select d from hoje) then 'atrasado'
        when x.data_prevista < (date_trunc('month', (select d from hoje)) + interval '1 month')::date then 'a_faturar'
        else 'futuro' end situacao
      from comps x
  ),
  por_ctr as (
    select c.id,
      jsonb_build_object(
        'id', c.id, 'empresa', c.empresa, 'numero', c.numero, 'omie_codigo', c.omie_codigo, 'cliente_codigo', c.cliente_codigo,
        'cliente', c.cliente_nome, 'cliente_doc', c.cliente_doc, 'projeto', c.projeto_codigo,
        'projeto_nome', (select p.nome from finance.projetos p where p.empresa = c.empresa and p.codigo::text = c.projeto_codigo limit 1),
        'status', c.status, 'vig_inicio', c.vig_inicio, 'vig_fim', c.vig_fim, 'periodicidade', c.periodicidade_meses,
        'dia', c.dia_faturamento, 'mes_seguinte', c.fatura_mes_seguinte, 'valor', c.valor_periodo,
        'mensal', round(c.valor_periodo / c.periodicidade_meses, 2), 'condicao', c.condicao_codigo,
        'condicao_desc', (select f.descricao from sales.formas_pagamento f where f.empresa = c.empresa and f.codigo = c.condicao_codigo limit 1),
        'tipo_documento', c.tipo_documento, 'indice', c.indice_reajuste, 'data_base_reajuste', c.data_base_reajuste,
        'proximo_reajuste', c.proximo_reajuste, 'origem', c.origem, 'observacoes', c.observacoes,
        'reajuste_proximo', c.status = 'ativo' and c.proximo_reajuste is not null and c.proximo_reajuste <= c.hoje + 30,
        'vencendo', c.status = 'ativo' and c.vig_fim is not null and c.vig_fim between c.hoje and c.hoje + 60,
        'vencido', c.status = 'ativo' and c.vig_fim is not null and c.vig_fim < c.hoje,
        'competencias', coalesce((select jsonb_agg(jsonb_build_object('competencia', s.competencia, 'data_prevista', s.data_prevista,
             'situacao', s.situacao, 'documento', s.documento_rotulo, 'venda_id', s.venda_id, 'comp_id', s.comp_id) order by s.competencia)
           from st s where s.contrato_id = c.id), '[]'::jsonb),
        'atrasadas', (select count(*) from st s where s.contrato_id = c.id and s.situacao = 'atrasado'),
        'mes', (select s.situacao from st s where s.contrato_id = c.id
                 and s.data_prevista >= date_trunc('month', c.hoje) and s.data_prevista < date_trunc('month', c.hoje) + interval '1 month'
                 order by s.competencia desc limit 1),
        'mes_data', (select s.data_prevista from st s where s.contrato_id = c.id
                 and s.data_prevista >= date_trunc('month', c.hoje) and s.data_prevista < date_trunc('month', c.hoje) + interval '1 month'
                 order by s.competencia desc limit 1),
        'mes_competencia', (select s.competencia from st s where s.contrato_id = c.id
                 and s.data_prevista >= date_trunc('month', c.hoje) and s.data_prevista < date_trunc('month', c.hoje) + interval '1 month'
                 order by s.competencia desc limit 1),
        'proxima', (select min(s.data_prevista) from st s where s.contrato_id = c.id and s.situacao in ('a_faturar','futuro','atrasado')),
        'ultima_faturada', (select max(cc.competencia) from vendas.contrato_competencias cc where cc.contrato_id = c.id and cc.status <> 'cancelado')
      ) j
    from ctr c
  )
  select jsonb_build_object(
    'hoje', (select d from hoje),
    'contratos', coalesce((select jsonb_agg(j order by (j->>'status') = 'ativo' desc, j->>'cliente', j->>'numero') from por_ctr), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'ativos', (select count(*) from ctr where status = 'ativo'),
      'mrr', (select coalesce(sum(round(valor_periodo / periodicidade_meses, 2)), 0) from ctr where status = 'ativo'),
      'a_faturar_mes_qtd', (select count(*) from st where situacao in ('a_faturar','atrasado')
                             and data_prevista < date_trunc('month', (select d from hoje)) + interval '1 month'),
      'a_faturar_mes_valor', (select coalesce(sum(c.valor_periodo), 0) from st s join ctr c on c.id = s.contrato_id
                               where s.situacao in ('a_faturar','atrasado') and s.data_prevista < date_trunc('month', (select d from hoje)) + interval '1 month'),
      'atrasados_qtd', (select count(*) from st where situacao = 'atrasado'),
      'atrasados_valor', (select coalesce(sum(c.valor_periodo), 0) from st s join ctr c on c.id = s.contrato_id where s.situacao = 'atrasado'),
      'faturados_mes_qtd', (select count(*) from st where situacao in ('faturado','gerado')
                             and data_prevista >= date_trunc('month', (select d from hoje)) and data_prevista < date_trunc('month', (select d from hoje)) + interval '1 month'),
      'reajustes', (select count(*) from ctr where status = 'ativo' and proximo_reajuste is not null and proximo_reajuste <= hoje + 30),
      'vencendo', (select count(*) from ctr where status = 'ativo' and vig_fim between hoje and hoje + 60),
      'vencidos', (select count(*) from ctr where status = 'ativo' and vig_fim < hoje)
    ))
$$;

-- ── Detalhe de um contrato ──────────────────────────────────────────────────
create or replace function orders.contrato_detalhe(p_id bigint)
returns jsonb language sql stable security definer set search_path = vendas, public as $$
  select jsonb_build_object(
    'contrato', to_jsonb(c),
    'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.seq) from vendas.contrato_itens i where i.contrato_id = c.id), '[]'::jsonb),
    'historico_faturas', coalesce((select jsonb_agg(jsonb_build_object('id', cc.id, 'competencia', cc.competencia, 'status',
         case when d.status = 'faturado' then 'faturado' when d.status = 'cancelado' then 'cancelado' else cc.status end,
         'origem', cc.origem, 'documento', cc.documento_rotulo, 'venda_id', cc.venda_id, 'valor', coalesce(d.valor_total, cc.valor),
         'data', coalesce(d.dt_fat, cc.data_faturamento), 'recibo', cc.recibo) order by cc.competencia desc)
       from vendas.contrato_competencias cc left join vendas.documentos d on d.id = cc.venda_id
      where cc.contrato_id = c.id and cc.status <> 'cancelado'), '[]'::jsonb),
    'reajustes', coalesce((select jsonb_agg(to_jsonb(r) order by r.vigente_desde desc) from vendas.contrato_reajustes r where r.contrato_id = c.id), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('por', h.por, 'acao', h.acao, 'detalhe', h.detalhe, 'em', h.em) order by h.em desc)
       from (select * from vendas.contrato_hist h where h.contrato_id = c.id order by em desc limit 40) h), '[]'::jsonb)
  ) from vendas.contratos c where c.id = p_id $$;

-- ── Faturar uma competência: cria a OS nativa com os itens do contrato ──────
create or replace function orders.contrato_faturar(p_id bigint, p_competencia date, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare c vendas.contratos; comp date := date_trunc('month', p_competencia)::date; v jsonb; d jsonb; ja record; v_itens jsonb; v_desc text;
begin
  select * into c from vendas.contratos where id = p_id for update;
  if not found then raise exception 'Contrato % não encontrado', p_id; end if;
  if c.status <> 'ativo' then raise exception 'Contrato % está %: não fatura', c.numero, c.status; end if;
  if c.vig_inicio is not null and comp < date_trunc('month', c.vig_inicio) then raise exception 'Competência % antes do início da vigência', to_char(comp, 'MM/YYYY'); end if;
  if c.vig_fim is not null and comp > c.vig_fim then raise exception 'Competência % depois do fim da vigência (%)', to_char(comp, 'MM/YYYY'), to_char(c.vig_fim, 'DD/MM/YYYY'); end if;
  if c.cliente_codigo is null then raise exception 'Contrato % sem cliente', c.numero; end if;
  select cc.documento_rotulo, cc.origem into ja from vendas.contrato_competencias cc
   where cc.contrato_id = c.id and cc.competencia = comp and cc.status <> 'cancelado';
  if found then raise exception 'Competência % do contrato % já faturada (%)', to_char(comp, 'MM/YYYY'), c.numero, coalesce(ja.documento_rotulo, ja.origem); end if;

  v_desc := 'REFERENTE AO MÊS DE ' || vendas.nome_mes(comp);
  select jsonb_agg(jsonb_build_object('descricao', i.descricao || ' || ' || v_desc, 'codigo', i.servico_codigo,
           'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'unidade', 'UN',
           'fiscal', jsonb_strip_nulls(jsonb_build_object('lc116', i.lc116, 'mun', i.cod_serv_munic, 'aliq_iss', i.aliq_iss, 'retem_iss', i.retem_iss)))
         order by i.seq) into v_itens
    from vendas.contrato_itens i where i.contrato_id = c.id;
  if v_itens is null then raise exception 'Contrato % sem itens', c.numero; end if;

  v := jsonb_build_object('empresa', c.empresa, 'tipo', 'OS', 'cliente_codigo', c.cliente_codigo, 'cliente_nome', c.cliente_nome,
         'cliente_cnpj', c.cliente_doc, 'projeto_codigo', c.projeto_codigo, 'categoria_codigo', c.categoria_codigo,
         'condicao_codigo', c.condicao_codigo, 'num_pedido_cliente', c.numero,
         'observacoes', 'Contrato ' || c.numero || ' — competência ' || to_char(comp, 'MM/YYYY'),
         'obs_nf', 'Contrato ' || c.numero || ' · ' || v_desc, 'itens', v_itens);
  d := orders.vendas_salvar(v, p_por);
  update vendas.documentos set contrato_id = c.id, contrato_competencia = comp,
         proposta_dispensa_motivo = 'Contrato recorrente ' || c.numero || ' — competência ' || to_char(comp, 'MM/YYYY'),
         proposta_dispensa_por = p_por, proposta_dispensa_em = now()
   where id = (d->>'id')::bigint;
  insert into vendas.historico (documento_id, por, acao, detalhe)
  values ((d->>'id')::bigint, p_por, 'contrato', jsonb_build_object('contrato', c.numero, 'competencia', comp));

  insert into vendas.contrato_competencias (contrato_id, competencia, status, origem, venda_id, documento_rotulo, valor, criado_por)
  values (c.id, comp, 'gerado', 'painel', (d->>'id')::bigint, d->>'label', (d->>'valor_total')::numeric, p_por);
  perform vendas.contrato_log(c.id, p_por, 'faturar', jsonb_build_object('competencia', comp, 'documento', d->>'label', 'valor', d->'valor_total'));
  return d || jsonb_build_object('competencia', comp, 'contrato', c.numero);
end $$;

-- Desfaz uma competência gerada no painel (cancela a OS se ainda não faturada)
create or replace function orders.contrato_desfazer(p_comp_id bigint, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare cc vendas.contrato_competencias; d vendas.documentos;
begin
  select * into cc from vendas.contrato_competencias where id = p_comp_id for update;
  if not found then raise exception 'Competência não encontrada'; end if;
  if cc.status = 'cancelado' then raise exception 'Já desfeita'; end if;
  if cc.origem = 'omie' then raise exception 'Competência faturada no Omie: não se desfaz pelo painel'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo'; end if;
  if cc.venda_id is not null then
    select * into d from vendas.documentos where id = cc.venda_id;
    if d.status = 'faturado' then raise exception '% já está faturada: cancele a nota/recibo antes', d.tipo || d.numero; end if;
    if d.status = 'aberto' then perform orders.vendas_cancelar(d.id, 'Competência do contrato desfeita: ' || trim(p_motivo), p_por); end if;
  end if;
  update vendas.contrato_competencias set status = 'cancelado', cancelado_motivo = trim(p_motivo) where id = cc.id;
  perform vendas.contrato_log(cc.contrato_id, p_por, 'desfazer', jsonb_build_object('competencia', cc.competencia, 'motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- ── Salvar (novo/editar), status e reajuste ────────────────────────────────
create or replace function orders.contrato_salvar(p jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare v_id bigint := nullif(p->>'id','')::bigint; c vendas.contratos; v_cli record; it jsonb; k int := 0; v_num text; emp text := upper(coalesce(nullif(p->>'empresa',''), 'SF'));
begin
  if nullif(p->>'cliente_codigo','') is null then raise exception 'Escolha o cliente'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'O contrato precisa de pelo menos um item'; end if;
  select codigo_cliente_omie, coalesce(nullif(razao_social,''), nome_fantasia) nome, cnpj_cpf into v_cli
    from finance.clientes where empresa = emp and codigo_cliente_omie = (p->>'cliente_codigo')::bigint;
  if v_id is null then
    v_num := nullif(trim(p->>'numero'), '');
    if v_num is null then v_num := 'CT' || (orders.cad_aux_sugestao('projetos', emp)->>'CT'); end if;
    if exists (select 1 from vendas.contratos where empresa = emp and upper(numero) = upper(v_num)) then
      raise exception 'Já existe contrato % nesta empresa', v_num;
    end if;
    insert into vendas.contratos (empresa, numero, origem, criado_por, atualizado_por) values (emp, v_num, 'painel', p_por, p_por) returning * into c;
  else
    select * into c from vendas.contratos where id = v_id for update;
    if not found then raise exception 'Contrato não encontrado'; end if;
  end if;
  update vendas.contratos set
    numero = coalesce(nullif(trim(p->>'numero'), ''), numero),
    cliente_codigo = (p->>'cliente_codigo')::bigint, cliente_nome = coalesce(v_cli.nome, nullif(p->>'cliente_nome',''), cliente_nome),
    cliente_doc = coalesce(v_cli.cnpj_cpf, cliente_doc),
    projeto_codigo = nullif(p->>'projeto_codigo',''), categoria_codigo = nullif(p->>'categoria_codigo',''),
    vig_inicio = nullif(p->>'vig_inicio','')::date, vig_fim = nullif(p->>'vig_fim','')::date,
    periodicidade_meses = coalesce(nullif(p->>'periodicidade_meses','')::int, periodicidade_meses),
    dia_faturamento = coalesce(nullif(p->>'dia_faturamento','')::int, dia_faturamento),
    fatura_mes_seguinte = coalesce((p->>'fatura_mes_seguinte')::boolean, fatura_mes_seguinte),
    condicao_codigo = nullif(p->>'condicao_codigo',''), tipo_documento = nullif(p->>'tipo_documento',''),
    indice_reajuste = nullif(p->>'indice_reajuste',''), proximo_reajuste = nullif(p->>'proximo_reajuste','')::date,
    observacoes = nullif(p->>'observacoes',''),
    status = coalesce(nullif(p->>'status',''), status),
    editado_no_painel = true, atualizado_por = p_por, atualizado_em = now()
  where id = c.id;
  delete from vendas.contrato_itens where contrato_id = c.id;
  for it in select * from jsonb_array_elements(p->'itens') loop
    k := k + 1;
    if coalesce(trim(it->>'descricao'), '') = '' then raise exception 'Item % sem descrição', k; end if;
    insert into vendas.contrato_itens (contrato_id, seq, servico_codigo, lc116, cod_serv_munic, descricao, quantidade, valor_unitario, aliq_iss, retem_iss)
    values (c.id, k, nullif(it->>'servico_codigo',''), nullif(it->>'lc116',''), nullif(it->>'cod_serv_munic',''), trim(it->>'descricao'),
            coalesce(nullif(it->>'quantidade','')::numeric, 1), coalesce(nullif(it->>'valor_unitario','')::numeric, 0),
            nullif(it->>'aliq_iss','')::numeric, coalesce((it->>'retem_iss')::boolean, false));
  end loop;
  update vendas.contratos set valor_periodo = (select coalesce(sum(valor_total), 0) from vendas.contrato_itens where contrato_id = c.id)
   where id = c.id returning * into c;
  perform vendas.contrato_log(c.id, p_por, case when v_id is null then 'criado' else 'editado' end,
                              jsonb_build_object('valor', c.valor_periodo, 'itens', k, 'status', c.status));
  return jsonb_build_object('id', c.id, 'numero', c.numero, 'valor', c.valor_periodo);
end $$;

create or replace function orders.contrato_status(p_id bigint, p_status text, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare c vendas.contratos;
begin
  if p_status not in ('ativo','suspenso','encerrado') then raise exception 'Status inválido'; end if;
  if p_status <> 'ativo' and length(trim(coalesce(p_motivo,''))) < 5 then raise exception 'Informe o motivo'; end if;
  update vendas.contratos set status = p_status, editado_no_painel = true, atualizado_por = p_por, atualizado_em = now()
   where id = p_id returning * into c;
  if not found then raise exception 'Contrato não encontrado'; end if;
  perform vendas.contrato_log(c.id, p_por, 'status', jsonb_build_object('status', p_status, 'motivo', p_motivo));
  return jsonb_build_object('id', c.id, 'status', c.status);
end $$;

create or replace function orders.contrato_reajustar(p_id bigint, p_vigente_desde date, p_valor_novo numeric, p_indice text, p_obs text, p_por text)
returns jsonb language plpgsql security definer set search_path = vendas, public as $$
declare c vendas.contratos; fator numeric;
begin
  select * into c from vendas.contratos where id = p_id for update;
  if not found then raise exception 'Contrato não encontrado'; end if;
  if p_valor_novo is null or p_valor_novo <= 0 then raise exception 'Informe o novo valor do período'; end if;
  if c.valor_periodo <= 0 then raise exception 'Contrato sem valor atual'; end if;
  fator := p_valor_novo / c.valor_periodo;
  insert into vendas.contrato_reajustes (contrato_id, vigente_desde, valor_anterior, valor_novo, indice, percentual, observacao, por)
  values (c.id, date_trunc('month', p_vigente_desde)::date, c.valor_periodo, p_valor_novo, nullif(p_indice,''), round((fator - 1) * 100, 4), nullif(p_obs,''), p_por);
  -- reajuste proporcional em todos os itens (o total fecha no novo valor)
  update vendas.contrato_itens set valor_unitario = round(valor_unitario * fator, 2) where contrato_id = c.id;
  update vendas.contratos set valor_periodo = (select coalesce(sum(valor_total), 0) from vendas.contrato_itens where contrato_id = c.id),
         indice_reajuste = coalesce(nullif(p_indice,''), indice_reajuste),
         data_base_reajuste = date_trunc('month', p_vigente_desde)::date,
         proximo_reajuste = (date_trunc('month', p_vigente_desde) + interval '12 months')::date,
         editado_no_painel = true, atualizado_por = p_por, atualizado_em = now()
   where id = c.id returning * into c;
  perform vendas.contrato_log(c.id, p_por, 'reajuste', jsonb_build_object('desde', p_vigente_desde, 'valor', p_valor_novo, 'indice', p_indice));
  return jsonb_build_object('id', c.id, 'valor', c.valor_periodo);
end $$;

do $$ declare f text; begin
  foreach f in array array['orders.contratos_importar_omie(text)','orders.contratos_painel(text, date)','orders.contrato_detalhe(bigint)',
    'orders.contrato_faturar(bigint, date, text)','orders.contrato_desfazer(bigint, text, text)','orders.contrato_salvar(jsonb, text)',
    'orders.contrato_status(bigint, text, text, text)','orders.contrato_reajustar(bigint, date, numeric, text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
