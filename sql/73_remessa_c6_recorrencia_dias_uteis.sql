-- 73 — (05/10/26) Contas a Pagar/Receber:
--   1. feriados + regra do dia útil (como o Omie): vencimento em fim de semana ou
--      feriado → previsão no próximo dia útil (títulos nativos, por gatilho);
--   2. recorrência nas contas lançadas à mão ("+ Nova conta"), em séries;
--   3. remessa de pagamentos C6 (arquivo do portal C6) e dados de pagamento do
--      fornecedor (chave PIX / banco-agência-conta).
-- Só acrescenta. Nada vai ao Omie.

-- ── 1. Feriados e dia útil ───────────────────────────────────────────────
create table if not exists cadastros.feriados (
  data date not null,
  nome text not null,
  abrangencia text not null default 'nacional',   -- nacional | SP (estadual) | município
  ativo boolean not null default true,
  atualizado_por text, atualizado_em timestamptz default now(),
  primary key (data, abrangencia)
);
alter table cadastros.feriados enable row level security;
revoke all on cadastros.feriados from anon, authenticated;
grant all on cadastros.feriados to service_role;

create or replace function finance.proximo_dia_util(p_d date)
returns date language sql stable security definer set search_path = finance, public as $$
  with recursive c(d, n) as (
    select p_d, 0
    union all
    select (c.d + 1)::date, c.n + 1 from c
     where c.n < 30
       and (extract(isodow from c.d) in (6, 7)
            or exists (select 1 from cadastros.feriados f where f.data = c.d and f.ativo))
  )
  select case when p_d is null then null else (select d from c order by n desc limit 1) end
$$;
grant execute on function finance.proximo_dia_util(date) to service_role, authenticated;

-- Previsão automática nos títulos nativos. Conta como "automática" a previsão
-- vazia, igual ao vencimento (o formulário manda assim por padrão) ou igual à
-- previsão calculada do vencimento antigo. Previsão escolhida à mão fica.
create or replace function finance.tg_previsao_dia_util()
returns trigger language plpgsql as $$
declare v_venc date; v_prev date; v_old_venc date; v_old_prev date;
begin
  -- Previsão reprogramada à mão (extras.previsao_manual) nunca é mexida pela regra.
  if coalesce((new.extras->>'previsao_manual')::boolean, false) then return new; end if;
  if tg_table_name = 'pagar_previsto' then
    v_venc := new.vencimento; v_prev := new.data_previsao;
    if tg_op = 'UPDATE' then v_old_venc := old.vencimento; v_old_prev := old.data_previsao; end if;
  else
    -- Títulos vindos do Omie ficam como o Omie mandou (a regra aplica-se na leitura).
    if coalesce(new.origem, '') = 'omie' then return new; end if;
    v_venc := new.vencimento; v_prev := new.previsao;
    if tg_op = 'UPDATE' then v_old_venc := old.vencimento; v_old_prev := old.previsao; end if;
  end if;
  if v_venc is null then return new; end if;
  if v_prev is null or v_prev = v_venc
     or (tg_op = 'UPDATE' and v_venc is distinct from v_old_venc
         and (v_old_prev is null or v_old_prev = v_old_venc or v_old_prev = finance.proximo_dia_util(v_old_venc))
         and v_prev is not distinct from v_old_prev) then
    v_prev := finance.proximo_dia_util(v_venc);
  end if;
  if tg_table_name = 'pagar_previsto' then new.data_previsao := v_prev; else new.previsao := v_prev; end if;
  return new;
end $$;

drop trigger if exists tg_previsao_dia_util on finance.pagar_previsto;
create trigger tg_previsao_dia_util before insert or update of vencimento, data_previsao on finance.pagar_previsto
  for each row execute function finance.tg_previsao_dia_util();
drop trigger if exists tg_previsao_dia_util on finance.receber;
create trigger tg_previsao_dia_util before insert or update of vencimento, previsao on finance.receber
  for each row execute function finance.tg_previsao_dia_util();

-- ── 2. Séries (recorrência) ─────────────────────────────────────────────
create table if not exists finance.titulo_series (
  id uuid primary key default gen_random_uuid(),
  natureza char(1) not null check (natureza in ('P', 'R')),
  empresa text not null,
  regra jsonb not null,          -- {freq, n, ate, sem_fim, dia_fixo, valor_modo, inicio}
  modelo jsonb not null,         -- campos de uma ocorrência (o payload da "+ Nova conta")
  criado_por text, criado_em timestamptz not null default now(),
  encerrada_em timestamptz, encerrada_por text
);
alter table finance.titulo_series enable row level security;
revoke all on finance.titulo_series from anon, authenticated;
grant all on finance.titulo_series to service_role;

alter table finance.pagar_previsto add column if not exists serie_id uuid references finance.titulo_series(id);
alter table finance.pagar_previsto add column if not exists serie_seq int;
alter table finance.receber add column if not exists serie_id uuid references finance.titulo_series(id);
alter table finance.receber add column if not exists serie_seq int;
create index if not exists pagar_previsto_serie_idx on finance.pagar_previsto (serie_id, serie_seq) where serie_id is not null;
create index if not exists receber_serie_idx on finance.receber (serie_id, serie_seq) where serie_id is not null;

-- Data da k-ésima ocorrência (k = 1 é o primeiro vencimento).
create or replace function finance.serie_data(p_inicio date, p_freq text, p_k int, p_dia_fixo int)
returns date language plpgsql immutable as $$
declare m int; d date; ult int;
begin
  if p_freq = 'semanal' then return p_inicio + (p_k - 1) * 7; end if;
  m := case p_freq when 'mensal' then 1 when 'bimestral' then 2 when 'trimestral' then 3
                   when 'semestral' then 6 when 'anual' then 12 else 1 end;
  d := (date_trunc('month', p_inicio) + make_interval(months => (p_k - 1) * m))::date;
  ult := extract(day from (d + interval '1 month' - interval '1 day'))::int;
  return make_date(extract(year from d)::int, extract(month from d)::int,
                   least(coalesce(nullif(p_dia_fixo, 0), extract(day from p_inicio)::int), ult));
end $$;

-- Uma conta a receber lançada à mão (mesmos campos da rota /titulos/incluir).
create or replace function finance.receber_manual_incluir(p jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v_id uuid; v_emp text := upper(coalesce(p->>'empresa', 'SF'));
        v_ped text := nullif(trim(coalesce(p->>'numero_pedido', '')), ''); v_nf text := nullif(trim(coalesce(p->>'numero_documento_fiscal', '')), '');
        v_ch text := nullif(trim(coalesce(p->>'chave_nfe', '')), '');
begin
  if nullif(p->>'codigo_cliente_fornecedor', '') is null or coalesce((p->>'valor_documento')::numeric, 0) <= 0
     or nullif(p->>'data_vencimento', '') is null or nullif(p->>'codigo_categoria', '') is null
     or nullif(p->>'id_conta_corrente', '') is null then
    raise exception 'Campos obrigatórios: cliente, valor, vencimento, categoria e conta corrente';
  end if;
  insert into finance.receber (empresa, codigo_cliente_omie, numero_documento, numero_parcela, numero_pedido,
      numero_documento_fiscal, chave_nfe, emissao, vencimento, previsao, valor, codigo_categoria, codigo_projeto,
      id_conta_corrente, observacao, extras, origem, conferencia, created_by)
  values (v_emp, (p->>'codigo_cliente_fornecedor')::bigint, nullif(trim(coalesce(p->>'numero_documento', '')), ''),
      nullif(trim(coalesce(p->>'numero_parcela', '')), ''), v_ped, v_nf, v_ch,
      nullif(p->>'data_emissao', '')::date, (p->>'data_vencimento')::date, nullif(p->>'data_previsao', '')::date,
      round((p->>'valor_documento')::numeric, 2), p->>'codigo_categoria', nullif(p->>'codigo_projeto', ''),
      (p->>'id_conta_corrente')::bigint, nullif(trim(coalesce(p->>'observacao', '')), ''),
      nullif(p->'extras', 'null'::jsonb), 'painel', case when v_ped is not null or v_nf is not null or v_ch is not null then 'pendente' else 'so_painel' end,
      nullif(p->>'created_by', ''))
  returning id into v_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'incluir_conta_manual', 'receber', v_id::text, p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Cria uma ocorrência k da série (modelo = payload do formulário, já no formato da natureza).
create or replace function finance._serie_ocorrencia(s finance.titulo_series, p_k int, p_total int, p_usuario text)
returns text language plpgsql security definer set search_path = finance, public as $$
declare r jsonb := s.regra; m jsonb := s.modelo; v_venc date; v_val numeric; v_tot numeric; v_n int; v_id text; v_parc text;
begin
  v_venc := finance.serie_data((r->>'inicio')::date, r->>'freq', p_k, nullif(r->>'dia_fixo', '')::int);
  v_n := nullif(r->>'n', '')::int;
  if coalesce(r->>'valor_modo', 'por_ocorrencia') = 'dividir' and v_n is not null then
    v_tot := (r->>'valor_total')::numeric;
    v_val := round(v_tot / v_n, 2);
    if p_k = v_n then v_val := v_tot - v_val * (v_n - 1); end if;
  else
    v_val := (r->>'valor')::numeric;
  end if;
  v_parc := case when p_total is not null then p_k || '/' || p_total else p_k::text end;
  if s.natureza = 'P' then
    m := m || jsonb_build_object('vencimento', v_venc, 'previsao', null, 'valor', v_val, 'numero_parcela', v_parc);
    v_id := finance.pagar_manual_incluir(m, p_usuario)->>'id';
    update finance.pagar_previsto set serie_id = s.id, serie_seq = p_k where id = v_id::bigint;
  else
    m := m || jsonb_build_object('data_vencimento', v_venc, 'data_previsao', null, 'valor_documento', v_val, 'numero_parcela', v_parc);
    v_id := finance.receber_manual_incluir(m, p_usuario)->>'id';
    update finance.receber set serie_id = s.id, serie_seq = p_k where id = v_id::uuid;
  end if;
  return v_id;
end $$;

-- p = {natureza 'P'|'R', empresa, modelo{...}, regra{freq, inicio, n?, ate?, sem_fim?, dia_fixo?, valor_modo, valor?, valor_total?}}
create or replace function finance.serie_criar(p jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare s finance.titulo_series; r jsonb := p->'regra'; v_n int; v_k int := 0; v_ids text[] := '{}'; v_ate date; v_d date;
begin
  if coalesce(r->>'freq', '') not in ('semanal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual') then
    raise exception 'Frequência inválida';
  end if;
  if nullif(r->>'inicio', '') is null then raise exception 'Informe o primeiro vencimento'; end if;
  v_ate := nullif(r->>'ate', '')::date;
  v_n := nullif(r->>'n', '')::int;
  if coalesce((r->>'sem_fim')::boolean, false) then v_n := null; v_ate := null;
  elsif v_n is null and v_ate is null then raise exception 'Informe o nº de ocorrências, a data final ou "sem fim"';
  end if;
  if v_n is null and v_ate is not null then
    v_n := 0;
    loop v_d := finance.serie_data((r->>'inicio')::date, r->>'freq', v_n + 1, nullif(r->>'dia_fixo', '')::int);
         exit when v_d > v_ate or v_n >= 240; v_n := v_n + 1; end loop;
    if v_n = 0 then raise exception 'A data final é antes do primeiro vencimento'; end if;
    r := r || jsonb_build_object('n', v_n);
  end if;
  if v_n is not null and v_n > 240 then raise exception 'No máximo 240 ocorrências'; end if;
  if coalesce(r->>'valor_modo', 'por_ocorrencia') = 'dividir' and v_n is null then
    raise exception 'Dividir o total só funciona com nº de ocorrências ou data final';
  end if;
  insert into finance.titulo_series (natureza, empresa, regra, modelo, criado_por)
  values (p->>'natureza', upper(coalesce(p->>'empresa', 'SF')), r, p->'modelo', p_usuario) returning * into s;
  for v_k in 1 .. coalesce(v_n, 12) loop
    v_ids := v_ids || finance._serie_ocorrencia(s, v_k, v_n, p_usuario);
  end loop;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'criar_serie', case when s.natureza = 'P' then 'pagar' else 'receber' end, s.id::text, p);
  return jsonb_build_object('ok', true, 'serie_id', s.id, 'ids', to_jsonb(v_ids), 'n', coalesce(v_n, 12), 'sem_fim', v_n is null);
end $$;

-- Séries "sem fim": mantém sempre 12 ocorrências futuras em aberto (cron diário).
create or replace function finance.series_rolar()
returns int language plpgsql security definer set search_path = finance, public as $$
declare s finance.titulo_series; v_fut int; v_max int; v_novas int := 0; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for s in select * from finance.titulo_series where encerrada_em is null and coalesce((regra->>'sem_fim')::boolean, false) loop
    if s.natureza = 'P' then
      select count(*) filter (where vencimento >= v_hoje and status <> 'cancelado'), max(serie_seq) into v_fut, v_max
        from finance.pagar_previsto where serie_id = s.id;
    else
      select count(*) filter (where vencimento >= v_hoje), max(serie_seq) into v_fut, v_max
        from finance.receber where serie_id = s.id;
    end if;
    while coalesce(v_fut, 0) < 12 loop
      v_max := coalesce(v_max, 0) + 1;
      perform finance._serie_ocorrencia(s, v_max, null, 'cron:series_rolar');
      v_fut := coalesce(v_fut, 0) + 1; v_novas := v_novas + 1;
    end loop;
  end loop;
  return v_novas;
end $$;

-- Ocorrências de uma série com o que já foi pago.
create or replace function finance.serie_ocorrencias(p_serie uuid)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select jsonb_build_object('serie', to_jsonb(s), 'ocorrencias', coalesce((
    select jsonb_agg(o order by (o->>'seq')::int) from (
      select jsonb_build_object('id', p.id, 'seq', p.serie_seq, 'vencimento', p.vencimento, 'previsao', p.data_previsao,
             'valor', p.valor, 'cancelado', p.status = 'cancelado',
             'pago', exists (select 1 from finance.baixas b where b.pagar_id = p.id and b.estornado_em is null)) o
        from finance.pagar_previsto p where p.serie_id = s.id
      union all
      select jsonb_build_object('id', r.id, 'seq', r.serie_seq, 'vencimento', r.vencimento, 'previsao', r.previsao,
             'valor', r.valor, 'cancelado', false,
             'pago', exists (select 1 from finance.baixas b where b.receber_id = r.id and b.estornado_em is null)) o
        from finance.receber r where r.serie_id = s.id) z), '[]'::jsonb))
    from finance.titulo_series s where s.id = p_serie
$$;

-- Editar: escopo 'esta' | 'proximas' | 'todas'. Campos: valor, categoria, conta, projeto, obs, documento,
-- vencimento (só 'esta'). Ocorrências já pagas ficam como estão.
create or replace function finance.serie_editar(p_serie uuid, p_id text, p_escopo text, p_campos jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare s finance.titulo_series; v_seq int; v_ids text[]; v_alt int := 0; v_pul int := 0; i text;
begin
  select * into s from finance.titulo_series where id = p_serie;
  if not found then raise exception 'Série não encontrada'; end if;
  if p_escopo not in ('esta', 'proximas', 'todas') then raise exception 'Escopo inválido'; end if;
  if p_escopo <> 'esta' and p_campos ? 'vencimento' then raise exception 'Vencimento só se muda numa ocorrência (esta)'; end if;
  if s.natureza = 'P' then
    select serie_seq into v_seq from finance.pagar_previsto where id::text = p_id and serie_id = p_serie;
    select array_agg(id::text) into v_ids from finance.pagar_previsto
     where serie_id = p_serie and status <> 'cancelado'
       and (p_escopo = 'todas' or (p_escopo = 'esta' and id::text = p_id) or (p_escopo = 'proximas' and serie_seq >= v_seq));
    foreach i in array coalesce(v_ids, '{}') loop
      if exists (select 1 from finance.baixas where pagar_id = i::bigint and estornado_em is null) then v_pul := v_pul + 1; continue; end if;
      update finance.pagar_previsto set
        valor = coalesce((p_campos->>'valor')::numeric, valor),
        vencimento = coalesce((p_campos->>'vencimento')::date, vencimento),
        categoria_cod = coalesce(p_campos->>'categoria_cod', categoria_cod),
        categoria_desc = case when p_campos ? 'categoria_cod' then (select descricao from finance.categorias where empresa = s.empresa and codigo = p_campos->>'categoria_cod' limit 1) else categoria_desc end,
        conta_cod = coalesce((p_campos->>'conta_cod')::bigint, conta_cod),
        conta_desc = case when p_campos ? 'conta_cod' then (select descricao from finance.contas_correntes where empresa = s.empresa and cod_cc = (p_campos->>'conta_cod')::bigint limit 1) else conta_desc end,
        projeto_cod = case when p_campos ? 'projeto_cod' then nullif(p_campos->>'projeto_cod', '')::bigint else projeto_cod end,
        obs = case when p_campos ? 'obs' then nullif(p_campos->>'obs', '') else obs end,
        documento = case when p_campos ? 'documento' then nullif(p_campos->>'documento', '') else documento end,
        updated_at = now()
      where id = i::bigint;
      v_alt := v_alt + 1;
    end loop;
  else
    select serie_seq into v_seq from finance.receber where id::text = p_id and serie_id = p_serie;
    select array_agg(id::text) into v_ids from finance.receber
     where serie_id = p_serie and (p_escopo = 'todas' or (p_escopo = 'esta' and id::text = p_id) or (p_escopo = 'proximas' and serie_seq >= v_seq));
    foreach i in array coalesce(v_ids, '{}') loop
      if exists (select 1 from finance.baixas where receber_id = i::uuid and estornado_em is null) then v_pul := v_pul + 1; continue; end if;
      update finance.receber set
        valor = coalesce((p_campos->>'valor')::numeric, valor),
        vencimento = coalesce((p_campos->>'vencimento')::date, vencimento),
        codigo_categoria = coalesce(p_campos->>'categoria_cod', codigo_categoria),
        id_conta_corrente = coalesce((p_campos->>'conta_cod')::bigint, id_conta_corrente),
        codigo_projeto = case when p_campos ? 'projeto_cod' then nullif(p_campos->>'projeto_cod', '') else codigo_projeto end,
        observacao = case when p_campos ? 'obs' then nullif(p_campos->>'obs', '') else observacao end,
        numero_documento = case when p_campos ? 'documento' then nullif(p_campos->>'documento', '') else numero_documento end,
        updated_at = now()
      where id = i::uuid;
      v_alt := v_alt + 1;
    end loop;
  end if;
  if p_escopo in ('proximas', 'todas') and p_campos ? 'valor' then
    update finance.titulo_series set regra = regra || jsonb_build_object('valor', (p_campos->>'valor')::numeric) where id = p_serie;
  end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'editar_serie', case when s.natureza = 'P' then 'pagar' else 'receber' end, p_serie::text,
          jsonb_build_object('id', p_id, 'escopo', p_escopo, 'campos', p_campos, 'alteradas', v_alt, 'puladas', v_pul));
  return jsonb_build_object('ok', true, 'alteradas', v_alt, 'puladas_pagas', v_pul);
end $$;

-- Excluir a série: só se nenhuma ocorrência tem pagamento ativo (senão use "encerrar").
-- Encerrar: para de gerar e cancela/apaga as ocorrências em aberto sem pagamento.
create or replace function finance.serie_excluir(p_serie uuid, p_modo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare s finance.titulo_series; v_pagas int; v_n int := 0;
begin
  select * into s from finance.titulo_series where id = p_serie for update;
  if not found then raise exception 'Série não encontrada'; end if;
  if s.natureza = 'P' then
    select count(*) into v_pagas from finance.pagar_previsto p
     where p.serie_id = p_serie and exists (select 1 from finance.baixas b where b.pagar_id = p.id and b.estornado_em is null);
  else
    select count(*) into v_pagas from finance.receber r
     where r.serie_id = p_serie and exists (select 1 from finance.baixas b where b.receber_id = r.id and b.estornado_em is null);
  end if;
  if p_modo = 'excluir' and v_pagas > 0 then
    raise exception 'A série tem % ocorrência(s) paga(s) — estorne antes ou use "encerrar série"', v_pagas;
  end if;
  if s.natureza = 'P' then
    update finance.pagar_previsto p set status = 'cancelado', updated_at = now()
     where p.serie_id = p_serie and p.status <> 'cancelado'
       and not exists (select 1 from finance.baixas b where b.pagar_id = p.id and b.estornado_em is null);
    get diagnostics v_n = row_count;
  else
    delete from finance.receber r
     where r.serie_id = p_serie and coalesce(r.valor_pago, 0) = 0
       and not exists (select 1 from finance.baixas b where b.receber_id = r.id);
    get diagnostics v_n = row_count;
  end if;
  update finance.titulo_series set encerrada_em = now(), encerrada_por = p_usuario where id = p_serie;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, case when p_modo = 'excluir' then 'excluir_serie' else 'encerrar_serie' end,
          case when s.natureza = 'P' then 'pagar' else 'receber' end, p_serie::text, jsonb_build_object('removidas', v_n));
  return jsonb_build_object('ok', true, 'removidas', v_n, 'pagas_mantidas', v_pagas);
end $$;

-- ── 3. Dados de pagamento do fornecedor + remessa C6 ────────────────────
create table if not exists finance.bancos_ispb (
  compe text primary key, ispb text not null, nome text not null
);
alter table finance.bancos_ispb enable row level security;
revoke all on finance.bancos_ispb from anon, authenticated;
grant all on finance.bancos_ispb to service_role;
insert into finance.bancos_ispb (compe, ispb, nome) values
  ('001', '00000000', 'Banco do Brasil'), ('033', '90400888', 'Santander'), ('104', '00360305', 'Caixa Econômica Federal'),
  ('237', '60746948', 'Bradesco'), ('341', '60701190', 'Itaú Unibanco'), ('336', '31872495', 'C6 Bank'),
  ('260', '18236120', 'Nubank'), ('077', '00416968', 'Banco Inter'), ('756', '02038232', 'Sicoob'),
  ('748', '01181521', 'Sicredi'), ('208', '30306294', 'BTG Pactual'), ('323', '10573521', 'Mercado Pago'),
  ('290', '08561701', 'PagSeguro'), ('318', '61186680', 'Banco BMG'), ('070', '00000208', 'BRB'),
  ('422', '58160789', 'Safra'), ('041', '92702067', 'Banrisul'), ('197', '16501555', 'Stone'),
  ('212', '92894922', 'Banco Original'), ('380', '22896431', 'PicPay'), ('461', '19540550', 'Asaas')
on conflict (compe) do nothing;

create table if not exists cadastros.pessoas_pagamento (
  pessoa_id bigint primary key references cadastros.pessoas(id),
  pix_tipo text,          -- cpf_cnpj | email | telefone | aleatoria
  pix_chave text,
  banco_compe text, agencia text, conta text,
  conta_tipo text,        -- Conta Corrente | Conta Poupança | Conta Pagamento
  titular_nome text, titular_doc text,
  atualizado_por text, atualizado_em timestamptz default now()
);
alter table cadastros.pessoas_pagamento enable row level security;
revoke all on cadastros.pessoas_pagamento from anon, authenticated;
grant all on cadastros.pessoas_pagamento to service_role;

create table if not exists finance.remessas (
  id bigserial primary key,
  banco text not null default 'C6',
  modelo text not null,                 -- contas | salarios
  empresa text, cod_cc bigint,
  arquivo_path text, arquivo_nome text,
  n int not null, total numeric(14,2) not null,
  criado_por text, criado_em timestamptz not null default now(),
  cancelada_em timestamptz, cancelada_por text
);
create table if not exists finance.remessa_itens (
  remessa_id bigint not null references finance.remessas(id) on delete cascade,
  ref text not null,                    -- o:<cod_titulo> | p:<pagar_previsto.id>
  modalidade text not null,             -- PIX_CHAVE | PIX_CONTA | BOLETO | TED
  favorecido text, valor numeric(14,2) not null, data_pagamento date not null,
  linha jsonb,
  primary key (remessa_id, ref)
);
create index if not exists remessa_itens_ref_idx on finance.remessa_itens (ref);
alter table finance.remessas enable row level security;
alter table finance.remessa_itens enable row level security;
revoke all on finance.remessas, finance.remessa_itens from anon, authenticated;
grant all on finance.remessas, finance.remessa_itens to service_role;
grant usage, select on sequence finance.remessas_id_seq to service_role;

-- Prévia da remessa: dados de cada título para o arquivo do banco.
create or replace function finance.remessa_previa(p_refs text[])
returns jsonb language sql stable security definer set search_path = finance, public as $$
  with r as (select unnest(p_refs) ref),
  pb as (select cod_titulo, sum(valor) v from finance.baixas where natureza = 'P' and estornado_em is null and cod_titulo is not null group by 1),
  t as (
    select r.ref, o.empresa, o.vencimento venc, coalesce(po.dt_previsao_nova, o.previsao, finance.proximo_dia_util(o.vencimento)) prev,
           round(coalesce(o.val_aberto, o.valor_documento) - coalesce(pb.v, 0), 2) valor,
           o.contraparte favorecido, regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g') doc,
           o.codigo_cliente_fornecedor cod_forn, nullif(regexp_replace(coalesce(o.codigo_barras, ''), '\D', '', 'g'), '') barras,
           coalesce(nullif(o.numero_documento_fiscal, ''), o.numero_documento) documento, o.categoria cat, null::jsonb extras
      from r join finance.v_titulos_omie_bruto o on r.ref = 'o:' || o.cod_titulo
      left join finance.previsao_override po on po.cod_titulo = o.cod_titulo
      left join pb on pb.cod_titulo = o.cod_titulo
    union all
    select r.ref, p.empresa, p.vencimento, coalesce(pp.data_previsao, finance.proximo_dia_util(p.vencimento)), round(p.val_aberto, 2),
           p.contraparte, regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g'),
           p.codigo_cliente_fornecedor, nullif(regexp_replace(coalesce(pp.extras->>'codigo_barras', ''), '\D', '', 'g'), ''),
           coalesce(nullif(p.numero_documento_fiscal, ''), p.numero_documento), p.categoria, pp.extras
      from r join finance.v_pagar_previsto p on r.ref = 'p:' || p.pagar_id
      left join finance.pagar_previsto pp on pp.id = p.pagar_id
  ),
  pe as (
    select distinct on (t.ref) t.ref, pes.id pessoa_id, pg.pix_tipo, pg.pix_chave, pg.banco_compe, pg.agencia, pg.conta,
           pg.conta_tipo, pg.titular_nome, pg.titular_doc
      from t
      left join cadastros.pessoas pes on pes.empresa = t.empresa and pes.codigo = t.cod_forn and pes.mesclado_em is null
      left join cadastros.pessoas irm on irm.entidade_id = pes.entidade_id and pes.entidade_id is not null
      left join cadastros.pessoas_pagamento pg on pg.pessoa_id in (pes.id, irm.id)
     order by t.ref, (pg.pessoa_id = pes.id) desc nulls last, pg.atualizado_em desc nulls last
  ),
  env as (
    select distinct on (i.ref) i.ref, i.remessa_id, rm.criado_em
      from finance.remessa_itens i join finance.remessas rm on rm.id = i.remessa_id
     where rm.cancelada_em is null and i.ref = any(p_refs) order by i.ref, rm.criado_em desc
  )
  select jsonb_build_object(
    'hoje', (now() at time zone 'America/Sao_Paulo')::date,
    'titulos', coalesce(jsonb_agg(jsonb_build_object(
      'ref', t.ref, 'empresa', t.empresa, 'vencimento', t.venc, 'previsao', t.prev,
      'valor', t.valor, 'favorecido', t.favorecido, 'doc', t.doc, 'cod_forn', t.cod_forn, 'pessoa_id', pe.pessoa_id,
      'barras', t.barras, 'documento', t.documento, 'categoria', t.cat,
      'pix_tipo', coalesce(pe.pix_tipo, t.extras->>'pix_tipo'), 'pix_chave', coalesce(pe.pix_chave, t.extras->>'pix_chave'),
      'banco_compe', pe.banco_compe, 'banco_ispb', (select ispb from finance.bancos_ispb b where b.compe = lpad(pe.banco_compe, 3, '0')),
      'agencia', pe.agencia, 'conta', pe.conta, 'conta_tipo', pe.conta_tipo,
      'titular_nome', pe.titular_nome, 'titular_doc', pe.titular_doc,
      'enviado_remessa', env.remessa_id, 'enviado_em', env.criado_em)), '[]'::jsonb),
    'bancos', (select jsonb_agg(jsonb_build_object('compe', compe, 'ispb', ispb, 'nome', nome) order by nome) from finance.bancos_ispb))
  from t left join pe on pe.ref = t.ref left join env on env.ref = t.ref
$$;

-- Títulos marcados como enviados ao banco (para a tela do Pagar).
create or replace function finance.remessa_enviados(p_refs text[] default null)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_object_agg(ref, jsonb_build_object('id', remessa_id, 'banco', banco, 'em', criado_em, 'data', data_pagamento)), '{}'::jsonb)
    from (select distinct on (i.ref) i.ref, i.remessa_id, rm.banco, rm.criado_em, i.data_pagamento
            from finance.remessa_itens i join finance.remessas rm on rm.id = i.remessa_id
           where rm.cancelada_em is null and (p_refs is null or i.ref = any(p_refs))
           order by i.ref, rm.criado_em desc) z
$$;

revoke all on function finance.serie_criar(jsonb, text), finance.series_rolar(), finance.serie_ocorrencias(uuid),
  finance.serie_editar(uuid, text, text, jsonb, text), finance.serie_excluir(uuid, text, text),
  finance.receber_manual_incluir(jsonb, text), finance._serie_ocorrencia(finance.titulo_series, int, int, text),
  finance.remessa_previa(text[]), finance.remessa_enviados(text[]) from public, anon, authenticated;
grant execute on function finance.serie_criar(jsonb, text), finance.series_rolar(), finance.serie_ocorrencias(uuid),
  finance.serie_editar(uuid, text, text, jsonb, text), finance.serie_excluir(uuid, text, text),
  finance.receber_manual_incluir(jsonb, text), finance.remessa_previa(text[]), finance.remessa_enviados(text[]) to service_role;

-- Cron: séries sem fim rolam todo dia às 05:10.
select cron.schedule('series-rolar', '10 8 * * *', $c$select finance.series_rolar()$c$);

-- ── 4. Reprogramar previsão (vencimento é do documento; a previsão é nossa) ─
-- A previsão reprogramada à mão manda no fluxo de caixa, na agenda e nos KPIs e
-- nunca é sobrescrita pela regra do dia útil nem pela sincronização do Omie.
--   o:<cod_titulo>  → finance.previsao_override (o que o BI já lê)
--   p:<id>          → finance.pagar_previsto.data_previsao + extras.previsao_manual
-- p_data null = voltar à regra (próximo dia útil do vencimento / previsão do Omie).
create or replace function finance.pagar_reprogramar(p_refs text[], p_data date, p_obs text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v_ref text; v_de date; v_n int := 0; v_cod bigint; v_id bigint; v_venc date; v_omie date;
begin
  foreach v_ref in array p_refs loop
    if v_ref like 'o:%' then
      v_cod := substr(v_ref, 3)::bigint;
      select t.vencimento, t.previsao into v_venc, v_omie from finance.v_titulos_omie_bruto t where t.cod_titulo = v_cod limit 1;
      select coalesce((select dt_previsao_nova from finance.previsao_override where cod_titulo = v_cod), v_omie, finance.proximo_dia_util(v_venc)) into v_de;
      if p_data is null then
        delete from finance.previsao_override where cod_titulo = v_cod;
      else
        insert into finance.previsao_override (cod_titulo, dt_previsao_nova, observacao, atualizado_em)
        values (v_cod, p_data, nullif(trim(coalesce(p_obs, '')), ''), now())
        on conflict (cod_titulo) do update set dt_previsao_nova = excluded.dt_previsao_nova,
           observacao = coalesce(excluded.observacao, finance.previsao_override.observacao), atualizado_em = now();
      end if;
    elsif v_ref like 'p:%' then
      v_id := substr(v_ref, 3)::bigint;
      select data_previsao, vencimento into v_de, v_venc from finance.pagar_previsto where id = v_id for update;
      if not found then raise exception 'Título % não encontrado', v_ref; end if;
      if p_data is null then
        update finance.pagar_previsto set extras = coalesce(extras, '{}'::jsonb) - 'previsao_manual',
               data_previsao = finance.proximo_dia_util(vencimento), updated_at = now() where id = v_id;
      else
        update finance.pagar_previsto set extras = coalesce(extras, '{}'::jsonb) || '{"previsao_manual": true}'::jsonb,
               data_previsao = p_data, updated_at = now() where id = v_id;
      end if;
    else
      raise exception 'Referência inválida: %', v_ref;
    end if;
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, case when p_data is null then 'previsao_regra' else 'reprogramar_previsao' end, 'pagar', v_ref,
            jsonb_build_object('de', v_de, 'para', coalesce(p_data, case when v_ref like 'p:%' then finance.proximo_dia_util(v_venc) end), 'obs', p_obs));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- Previsão efetiva de cada título em aberto do Pagar (ref → [previsão, reprogramada?]).
create or replace function finance.pagar_v3_previsoes(p_refs text[] default null)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_object_agg(ref, jsonb_build_array(prev, man)), '{}'::jsonb) from (
    select 'o:' || t.cod_titulo ref,
           coalesce(po.dt_previsao_nova, t.previsao, finance.proximo_dia_util(t.vencimento)) prev,
           po.cod_titulo is not null man
      from finance.v_titulos_omie_bruto t
      left join finance.previsao_override po on po.cod_titulo = t.cod_titulo
     where t.tipo = 'pagar' and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
       and (p_refs is null or 'o:' || t.cod_titulo = any(p_refs))
    union all
    select 'p:' || p.id, coalesce(p.data_previsao, finance.proximo_dia_util(p.vencimento)),
           coalesce((p.extras->>'previsao_manual')::boolean, false)
      from finance.pagar_previsto p
     where p.status <> 'cancelado' and (p_refs is null or 'p:' || p.id = any(p_refs))
  ) z
$$;

-- Histórico de reprogramação de um título (para a gaveta).
create or replace function finance.previsao_historico(p_ref text)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('em', em, 'por', usuario, 'acao', acao, 'de', detalhe->>'de',
                                               'para', detalhe->>'para', 'obs', detalhe->>'obs') order by em desc), '[]'::jsonb)
    from (select * from finance.financeiro_audit
           where entidade = 'pagar' and entidade_id = p_ref and acao in ('reprogramar_previsao', 'previsao_regra')
           order by em desc limit 10) a
$$;

revoke all on function finance.pagar_reprogramar(text[], date, text, text), finance.pagar_v3_previsoes(text[]),
  finance.previsao_historico(text) from public, anon, authenticated;
grant execute on function finance.pagar_reprogramar(text[], date, text, text), finance.pagar_v3_previsoes(text[]),
  finance.previsao_historico(text) to service_role;

-- Receber: a previsão alterada à mão nas contas do painel fica marcada como manual.
create or replace function finance.receber_v1_previsao(p_ids uuid[], p_data date, p_obs text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v uuid; rr record; n int := 0;
begin
  if p_data is null then raise exception 'Informe a nova previsão'; end if;
  foreach v in array p_ids loop
    select r.id, r.origem, r.omie_codigo_lancamento, r.previsao into rr from finance.receber r where r.id = v;
    if not found then raise exception 'Conta % não encontrada', v; end if;
    if rr.origem = 'painel' or rr.omie_codigo_lancamento is null then
      update finance.receber set previsao = p_data, extras = coalesce(extras, '{}'::jsonb) || '{"previsao_manual": true}'::jsonb,
             updated_at = now() where id = v;
    else
      insert into finance.previsao_override (cod_titulo, dt_previsao_nova, observacao, atualizado_em)
      values (rr.omie_codigo_lancamento, p_data, nullif(trim(p_obs), ''), now())
      on conflict (cod_titulo) do update set dt_previsao_nova = excluded.dt_previsao_nova,
         observacao = coalesce(excluded.observacao, finance.previsao_override.observacao), atualizado_em = now();
    end if;
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, 'previsao', 'receber', v::text, jsonb_build_object('de', rr.previsao, 'para', p_data, 'obs', p_obs));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

insert into cadastros.feriados (data, nome, abrangencia, ativo) values
('2025-01-01', 'Confraternização Universal', 'nacional', true),
('2025-04-21', 'Tiradentes', 'nacional', true),
('2025-05-01', 'Dia do Trabalho', 'nacional', true),
('2025-09-07', 'Independência', 'nacional', true),
('2025-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2025-11-02', 'Finados', 'nacional', true),
('2025-11-15', 'Proclamação da República', 'nacional', true),
('2025-11-20', 'Consciência Negra', 'nacional', true),
('2025-12-25', 'Natal', 'nacional', true),
('2025-03-03', 'Carnaval (segunda)', 'nacional', true),
('2025-03-04', 'Carnaval (terça)', 'nacional', true),
('2025-04-18', 'Sexta-feira Santa', 'nacional', true),
('2025-06-19', 'Corpus Christi', 'nacional', true),
('2025-07-09', 'Revolução Constitucionalista', 'SP', true),
('2025-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2025-03-26', 'Aniversário de Barueri', 'Barueri', false),
('2026-01-01', 'Confraternização Universal', 'nacional', true),
('2026-04-21', 'Tiradentes', 'nacional', true),
('2026-05-01', 'Dia do Trabalho', 'nacional', true),
('2026-09-07', 'Independência', 'nacional', true),
('2026-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2026-11-02', 'Finados', 'nacional', true),
('2026-11-15', 'Proclamação da República', 'nacional', true),
('2026-11-20', 'Consciência Negra', 'nacional', true),
('2026-12-25', 'Natal', 'nacional', true),
('2026-02-16', 'Carnaval (segunda)', 'nacional', true),
('2026-02-17', 'Carnaval (terça)', 'nacional', true),
('2026-04-03', 'Sexta-feira Santa', 'nacional', true),
('2026-06-04', 'Corpus Christi', 'nacional', true),
('2026-07-09', 'Revolução Constitucionalista', 'SP', true),
('2026-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2026-03-26', 'Aniversário de Barueri', 'Barueri', false),
('2027-01-01', 'Confraternização Universal', 'nacional', true),
('2027-04-21', 'Tiradentes', 'nacional', true),
('2027-05-01', 'Dia do Trabalho', 'nacional', true),
('2027-09-07', 'Independência', 'nacional', true),
('2027-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2027-11-02', 'Finados', 'nacional', true),
('2027-11-15', 'Proclamação da República', 'nacional', true),
('2027-11-20', 'Consciência Negra', 'nacional', true),
('2027-12-25', 'Natal', 'nacional', true),
('2027-02-08', 'Carnaval (segunda)', 'nacional', true),
('2027-02-09', 'Carnaval (terça)', 'nacional', true),
('2027-03-26', 'Sexta-feira Santa', 'nacional', true),
('2027-05-27', 'Corpus Christi', 'nacional', true),
('2027-07-09', 'Revolução Constitucionalista', 'SP', true),
('2027-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2027-03-26', 'Aniversário de Barueri', 'Barueri', false),
('2028-01-01', 'Confraternização Universal', 'nacional', true),
('2028-04-21', 'Tiradentes', 'nacional', true),
('2028-05-01', 'Dia do Trabalho', 'nacional', true),
('2028-09-07', 'Independência', 'nacional', true),
('2028-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2028-11-02', 'Finados', 'nacional', true),
('2028-11-15', 'Proclamação da República', 'nacional', true),
('2028-11-20', 'Consciência Negra', 'nacional', true),
('2028-12-25', 'Natal', 'nacional', true),
('2028-02-28', 'Carnaval (segunda)', 'nacional', true),
('2028-02-29', 'Carnaval (terça)', 'nacional', true),
('2028-04-14', 'Sexta-feira Santa', 'nacional', true),
('2028-06-15', 'Corpus Christi', 'nacional', true),
('2028-07-09', 'Revolução Constitucionalista', 'SP', true),
('2028-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2028-03-26', 'Aniversário de Barueri', 'Barueri', false),
('2029-01-01', 'Confraternização Universal', 'nacional', true),
('2029-04-21', 'Tiradentes', 'nacional', true),
('2029-05-01', 'Dia do Trabalho', 'nacional', true),
('2029-09-07', 'Independência', 'nacional', true),
('2029-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2029-11-02', 'Finados', 'nacional', true),
('2029-11-15', 'Proclamação da República', 'nacional', true),
('2029-11-20', 'Consciência Negra', 'nacional', true),
('2029-12-25', 'Natal', 'nacional', true),
('2029-02-12', 'Carnaval (segunda)', 'nacional', true),
('2029-02-13', 'Carnaval (terça)', 'nacional', true),
('2029-03-30', 'Sexta-feira Santa', 'nacional', true),
('2029-05-31', 'Corpus Christi', 'nacional', true),
('2029-07-09', 'Revolução Constitucionalista', 'SP', true),
('2029-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2029-03-26', 'Aniversário de Barueri', 'Barueri', false),
('2030-01-01', 'Confraternização Universal', 'nacional', true),
('2030-04-21', 'Tiradentes', 'nacional', true),
('2030-05-01', 'Dia do Trabalho', 'nacional', true),
('2030-09-07', 'Independência', 'nacional', true),
('2030-10-12', 'Nossa Senhora Aparecida', 'nacional', true),
('2030-11-02', 'Finados', 'nacional', true),
('2030-11-15', 'Proclamação da República', 'nacional', true),
('2030-11-20', 'Consciência Negra', 'nacional', true),
('2030-12-25', 'Natal', 'nacional', true),
('2030-03-04', 'Carnaval (segunda)', 'nacional', true),
('2030-03-05', 'Carnaval (terça)', 'nacional', true),
('2030-04-19', 'Sexta-feira Santa', 'nacional', true),
('2030-06-20', 'Corpus Christi', 'nacional', true),
('2030-07-09', 'Revolução Constitucionalista', 'SP', true),
('2030-01-25', 'Aniversário de São Paulo', 'São Paulo', false),
('2030-03-26', 'Aniversário de Barueri', 'Barueri', false)
on conflict (data, abrangencia) do nothing;
