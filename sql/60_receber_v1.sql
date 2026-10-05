-- 60 — Títulos a Receber v1 (mockup "contas-a-receber-v1", 05/10/26).
--
-- Mesmo conceito do Pagar v3 (sql/58), do lado das entradas:
--   · data base Previsão × Vencimento (previsão = Omie, ajustada por
--     finance.previsao_override; conta nativa: finance.receber.previsao)
--   · situação de cobrança: cobrar / prometido / renegociado / boleto / NF / sem boleto
--   · histórico do cliente (12 meses de títulos R liquidados): pontualidade e atraso médio
--   · receber individual/lote (juros, multa, desconto, parcial), alterar previsão,
--     registrar cobrança, marcar renegociado, banco programado, conciliação de créditos
--
-- Baixa no MESMO livro (finance.baixas, natureza R, receber_id): conta nascida no
-- painel passa por finance.baixa_registrar (P4); conta vinda do Omie grava direto
-- com omie_status 'nao_enviado' — o trigger do P4 atualiza finance.receber.valor_pago
-- e a v_receber já mostra RECEBIDO. Nada é escrito no Omie (previsão ajustada fica
-- em previsao_override com omie_sincronizado_em nulo; boleto não é gerado aqui).
--
-- Valor que passa no banco por baixa = valor - desconto + juros + multa: é com ele
-- que um movimento do extrato fica "casado" (vale também para o Pagar, abaixo).

create table if not exists finance.receber_cobrancas (
  id            bigserial primary key,
  receber_id    uuid not null,
  empresa       text not null,
  cliente       text,
  canal         text not null,
  contato       text,
  nota          text,
  nova_previsao date,
  criado_por    text,
  criado_em     timestamptz not null default now()
);
create index if not exists receber_cobrancas_rec on finance.receber_cobrancas (receber_id, criado_em desc);
create table if not exists finance.receber_renegociacao (
  receber_id uuid primary key,
  motivo     text,
  criado_por text,
  criado_em  timestamptz not null default now()
);
alter table finance.receber_cobrancas    enable row level security;
alter table finance.receber_renegociacao enable row level security;
revoke all on finance.receber_cobrancas, finance.receber_renegociacao from anon, authenticated;
grant select, insert, update, delete on finance.receber_cobrancas, finance.receber_renegociacao to service_role;
grant usage, select on sequence finance.receber_cobrancas_id_seq to service_role;
alter table finance.pagar_lotes add column if not exists natureza char(1) not null default 'P';

-- ── dados da tela ────────────────────────────────────────────────────────────
-- Linha (array): 0 ref 1 emp 2 venc 3 saldo 4 cliente 5 cat 6 proj 7 doc 8 parc 9 conta 10 cod_cc
-- 11 cod_titulo 12 boleto(bool) 13 nº boleto 14 nf 15 tipo 16 reneg(bool) 17 previsão ajustada (date)
-- 18 atraso médio 19 pontualidade % 20 nº títulos histórico 21 previsão 22 cnpj 23 origem (omie|painel)
-- 24 valor doc 25 cod cliente 26 nº cobranças 27 pedido 28 rótulo PV/OS (rentabilidade) 29 cadastro id 30 id (uuid)
create or replace function finance.receber_v1_dados(p_hoje date default null)
returns jsonb language sql stable security definer set search_path = finance, public as $$
with hoje as (select coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) d),
ab as (
  select r.* from finance.v_receber r
   where r.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO') and coalesce(r.val_aberto, r.valor_documento) > 0.004
),
hist as (
  select t.empresa, t.codigo_cliente_fornecedor cli, count(*) nh,
         round(100.0 * count(*) filter (where t.pagamento <= t.vencimento) / count(*)) pont,
         round(avg(t.pagamento - t.vencimento)) atr
    from finance.v_titulos_omie t, hoje h
   where t.natureza = 'R' and t.status_titulo = 'RECEBIDO' and t.pagamento between h.d - 365 and h.d
     and t.vencimento is not null
   group by 1, 2
),
pont30 as (
  select count(*) n, round(100.0 * count(*) filter (where t.pagamento is not null and t.pagamento <= t.vencimento) / nullif(count(*), 0)) pct
    from finance.v_titulos_omie t, hoje h
   where t.natureza = 'R' and t.vencimento between h.d - 30 and h.d - 1 and coalesce(t.status_titulo, '') not in ('CANCELADO', 'EXCLUIDO')
),
linhas as (
  select r.*, po.dt_previsao_nova pov,
         (tr.cod_titulo is not null or rr.receber_id is not null) reneg,
         hs.nh, hs.pont, hs.atr,
         (select count(*) from finance.receber_cobrancas c where c.receber_id = r.id) ncob,
         (select m.label from sales.mv_rentab_pvos m
           where m.empresa = r.empresa and m.numero::text = regexp_replace(coalesce(r.numero_pedido, ''), '\D', '', 'g')
           order by (m.label like 'OS%') = (r.tipo_documento in ('NFS', 'REC')) desc, m.emissao desc nulls last limit 1) rotulo,
         (select p.id from cadastros.pessoas p where p.empresa = r.empresa and p.codigo = r.codigo_cliente_fornecedor limit 1) pessoa
    from ab r
    left join finance.previsao_override po on po.cod_titulo = r.cod_titulo
    left join finance.titulo_renegociacao tr on tr.cod_titulo = r.cod_titulo
    left join finance.receber_renegociacao rr on rr.receber_id = r.id
    left join hist hs on hs.empresa = r.empresa and hs.cli = r.codigo_cliente_fornecedor
),
mov as (
  select m.cod_cc, max(m.data) filter (where m.origem = 'ofx') ofx_ultimo,
         count(*) filter (where not m.ignorado and m.valor > 0
                          and coalesce((select sum(b.valor - b.desconto + b.juros + b.multa) from finance.baixas b
                                         where b.movimento_id = m.id and b.estornado_em is null), 0) < m.valor - 0.004) pend
    from finance.banco_movimentos m group by 1
)
select jsonb_build_object(
  'hoje', (select d from hoje),
  'rows', coalesce((select jsonb_agg(jsonb_build_array(
      'r:' || l.id, l.empresa, l.vencimento, round(coalesce(l.val_aberto, l.valor_documento), 2),
      coalesce(nullif(l.contraparte, ''), l.contraparte_razao, '(sem nome)'), l.categoria, l.projeto, l.numero_documento, l.numero_parcela,
      l.conta_corrente, l.cod_cc, l.cod_titulo, coalesce(l.boleto_gerado, false) or coalesce(l.num_boleto, '') <> '',
      coalesce(nullif(l.num_boleto, ''), nullif(l.boleto_numero, '')), l.numero_documento_fiscal, l.tipo_documento, l.reneg,
      case when l.origem_registro = 'painel' and l.previsao is distinct from l.vencimento then l.previsao else l.pov end,
      l.atr, l.pont, l.nh, l.previsao, l.cnpj_cpf, l.origem_registro, l.valor_documento, l.codigo_cliente_fornecedor,
      l.ncob, l.numero_pedido, l.rotulo, l.pessoa, l.id) order by l.vencimento) from linhas l), '[]'::jsonb),
  'pont30', (select jsonb_build_object('n', n, 'pct', pct) from pont30),
  'banks', coalesce((select jsonb_agg(jsonb_build_array(s.empresa, s.cod_conta, s.conta, cc.tipo_conta_corrente, s.saldo,
      s.dt_ultimo, mv.ofx_ultimo, coalesce(mv.pend, 0)) order by s.empresa, s.saldo desc)
      from bi.saldo_por_conta(null) s
      join finance.contas_correntes cc on cc.empresa = s.empresa and cc.cod_cc = s.cod_conta and coalesce(cc.inativo, 'N') <> 'S'
      left join mov mv on mv.cod_cc = s.cod_conta), '[]'::jsonb),
  'prog', coalesce((select jsonb_object_agg(ref, cod_cc) from finance.pagar_programacao where ref like 'r:%'), '{}'::jsonb)
)
$$;

-- ── receber (individual, lote ou por crédito do extrato) ─────────────────────
-- p_itens: [{id (uuid), valor, cod_cc, desconto?, juros?, multa?, obs?}]
create or replace function finance.receber_v1_baixar(
  p_itens jsonb, p_data date, p_obs text, p_usuario text, p_lote boolean default false, p_movimento_id bigint default null)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare i jsonb; v_id uuid; v_val numeric; v_lote bigint; v_bx bigint; v_n int := 0; v_tot numeric := 0;
        rr record; v_ja numeric; m finance.banco_movimentos; v_soma numeric := 0; v_obs text; r jsonb;
        v_desc numeric; v_jur numeric; v_mul numeric; v_cc bigint;
begin
  if p_data is null then raise exception 'Data do recebimento obrigatória'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'Nenhum título'; end if;
  if p_movimento_id is not null then
    select * into m from finance.banco_movimentos where id = p_movimento_id for update;
    if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
    if m.ignorado then raise exception 'Movimento está ignorado — reative antes'; end if;
    if m.valor <= 0 then raise exception 'Movimento de saída não recebe título a receber'; end if;
    select coalesce(sum(valor - desconto + juros + multa), 0) into v_ja from finance.baixas where movimento_id = m.id and estornado_em is null;
    for i in select * from jsonb_array_elements(p_itens) loop
      v_soma := v_soma + round((i->>'valor')::numeric, 2) - coalesce((i->>'desconto')::numeric, 0)
                + coalesce((i->>'juros')::numeric, 0) + coalesce((i->>'multa')::numeric, 0);
    end loop;
    if v_ja + v_soma > m.valor + 0.004 then
      raise exception 'Soma dos títulos (%) passa o valor do crédito (% já usado de %)', v_soma, v_ja, m.valor;
    end if;
  end if;
  if p_lote then
    insert into finance.pagar_lotes (data, observacao, criado_por, natureza) values (p_data, nullif(trim(p_obs), ''), p_usuario, 'R')
    returning id into v_lote;
  end if;

  for i in select * from jsonb_array_elements(p_itens) loop
    v_id := (i->>'id')::uuid; v_val := round((i->>'valor')::numeric, 2);
    v_desc := coalesce((i->>'desconto')::numeric, 0); v_jur := coalesce((i->>'juros')::numeric, 0); v_mul := coalesce((i->>'multa')::numeric, 0);
    v_cc := coalesce((i->>'cod_cc')::bigint, m.cod_cc);
    v_obs := nullif(trim(concat_ws(' · ', nullif(trim(i->>'obs'), ''), nullif(trim(p_obs), ''),
                     case when p_movimento_id is not null then 'OFX: ' || coalesce(m.memo, m.nome, m.fitid) end)), '');
    if v_val is null or v_val <= 0 then raise exception 'Valor inválido'; end if;
    if v_cc is null then raise exception 'Escolha o banco do recebimento'; end if;
    perform pg_advisory_xact_lock(hashtext('r:' || v_id));
    select r.empresa, r.origem_registro, coalesce(nullif(r.contraparte, ''), r.contraparte_razao) contraparte,
           coalesce(nullif(r.numero_documento, ''), 'Conta a receber') || coalesce(' · ' || nullif(r.numero_parcela, ''), '') documento,
           round(coalesce(r.val_aberto, r.valor_documento), 2) saldo, r.status_titulo
      into rr from finance.v_receber r where r.id = v_id;
    if not found or rr.status_titulo not in ('A VENCER', 'VENCE HOJE', 'ATRASADO') then raise exception 'Conta a receber não está em aberto'; end if;
    if v_val > rr.saldo + 0.004 then raise exception 'Valor (%) maior que o saldo em aberto (%) de %', v_val, rr.saldo, rr.contraparte; end if;

    if rr.origem_registro = 'painel' then
      r := finance.baixa_registrar('R', v_id::text, p_data, v_val, v_cc, p_movimento_id, v_obs, p_usuario, false);
      v_bx := (r->>'baixa_id')::bigint;
      update finance.baixas set desconto = v_desc, juros = v_jur, multa = v_mul, lote_id = v_lote,
             origem = case when v_lote is not null then 'lote' else origem end where id = v_bx;
    else
      insert into finance.baixas (empresa, natureza, receber_id, documento, contraparte, data, valor, cod_cc, movimento_id,
                                  origem, forcada, observacao, criado_por, desconto, juros, multa, lote_id, omie_status)
      values (rr.empresa, 'R', v_id, rr.documento, rr.contraparte, p_data, v_val, v_cc, p_movimento_id,
              case when p_movimento_id is not null then 'conciliacao' when v_lote is not null then 'lote' else 'manual' end,
              false, v_obs, p_usuario, v_desc, v_jur, v_mul, v_lote, 'nao_enviado')
      returning id into v_bx;
      insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
      values (p_usuario, 'baixa', 'receber', v_id::text,
              jsonb_build_object('baixa_id', v_bx, 'valor', v_val, 'data', p_data, 'cod_cc', v_cc, 'movimento_id', p_movimento_id,
                                 'lote_id', v_lote, 'juros', v_jur, 'multa', v_mul, 'desconto', v_desc, 'obs', v_obs, 'origem_titulo', 'omie'));
    end if;
    v_n := v_n + 1; v_tot := v_tot + v_val;
  end loop;

  if v_lote is not null then update finance.pagar_lotes set n = v_n, total = v_tot where id = v_lote; end if;
  if p_movimento_id is not null then
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, 'conciliar', 'movimento', p_movimento_id::text, jsonb_build_object('itens', p_itens, 'valor', m.valor));
  end if;
  return jsonb_build_object('ok', true, 'baixas', v_n, 'total', v_tot, 'lote_id', v_lote);
end $$;

-- nova previsão de recebimento (Omie: previsao_override · painel: a própria conta)
create or replace function finance.receber_v1_previsao(p_ids uuid[], p_data date, p_obs text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v uuid; rr record; n int := 0;
begin
  if p_data is null then raise exception 'Informe a nova previsão'; end if;
  foreach v in array p_ids loop
    select r.id, r.origem, r.omie_codigo_lancamento, r.previsao into rr from finance.receber r where r.id = v;
    if not found then raise exception 'Conta % não encontrada', v; end if;
    if rr.origem = 'painel' or rr.omie_codigo_lancamento is null then
      update finance.receber set previsao = p_data, updated_at = now() where id = v;
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

-- renegociado (Omie: titulo_renegociacao, a tabela que as outras telas já leem · painel: receber_renegociacao)
create or replace function finance.receber_v1_renegociar(p_ids uuid[], p_motivo text, p_usuario text, p_desfazer boolean default false)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v uuid; rr record; n int := 0;
begin
  foreach v in array p_ids loop
    select r.id, r.origem, r.omie_codigo_lancamento into rr from finance.receber r where r.id = v;
    if not found then raise exception 'Conta % não encontrada', v; end if;
    if p_desfazer then
      delete from finance.receber_renegociacao where receber_id = v;
      if rr.omie_codigo_lancamento is not null then delete from finance.titulo_renegociacao where cod_titulo = rr.omie_codigo_lancamento; end if;
    elsif rr.omie_codigo_lancamento is not null and rr.origem <> 'painel' then
      insert into finance.titulo_renegociacao (cod_titulo, motivo, criado_em, criado_por)
      values (rr.omie_codigo_lancamento, nullif(trim(p_motivo), ''), now(), p_usuario) on conflict (cod_titulo) do nothing;
    else
      insert into finance.receber_renegociacao (receber_id, motivo, criado_por) values (v, nullif(trim(p_motivo), ''), p_usuario)
      on conflict (receber_id) do nothing;
    end if;
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, case when p_desfazer then 'desfazer_renegociacao' else 'renegociar' end, 'receber', v::text, jsonb_build_object('motivo', p_motivo));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- cobrança registada (canal + contato + nota), opcionalmente com nova previsão
create or replace function finance.receber_v1_cobranca(p_ids uuid[], p_canal text, p_contato text, p_nota text, p_nova_prev date, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v uuid; n int := 0;
begin
  if coalesce(trim(p_canal), '') = '' then raise exception 'Informe o canal'; end if;
  foreach v in array p_ids loop
    insert into finance.receber_cobrancas (receber_id, empresa, cliente, canal, contato, nota, nova_previsao, criado_por)
    select r.id, r.empresa, coalesce(nullif(r.contraparte, ''), r.contraparte_razao), trim(p_canal), nullif(trim(p_contato), ''),
           nullif(trim(p_nota), ''), p_nova_prev, p_usuario
      from finance.v_receber r where r.id = v;
    if not found then raise exception 'Conta % não encontrada', v; end if;
    n := n + 1;
  end loop;
  if p_nova_prev is not null then perform finance.receber_v1_previsao(p_ids, p_nova_prev, 'Cobrança: ' || coalesce(p_nota, p_canal), p_usuario); end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'cobranca', 'receber', array_to_string(p_ids, ','), jsonb_build_object('canal', p_canal, 'contato', p_contato, 'nota', p_nota, 'nova_previsao', p_nova_prev));
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- histórico de cobranças de uma conta
create or replace function finance.receber_v1_cobrancas_de(p_id uuid)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('em', c.criado_em, 'canal', c.canal, 'contato', c.contato, 'nota', c.nota,
         'nova_previsao', c.nova_previsao, 'por', c.criado_por) order by c.criado_em desc), '[]'::jsonb)
    from finance.receber_cobrancas c where c.receber_id = p_id
$$;

-- baixas do receber (hoje, ou todas as de contas do Omie ainda não lançadas lá)
create or replace function finance.receber_v1_baixas(p_desde timestamptz, p_so_omie_pendente boolean default false)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'empresa', b.empresa, 'receber_id', b.receber_id, 'cod_titulo', r.omie_codigo_lancamento, 'documento', b.documento,
    'contraparte', b.contraparte, 'data', b.data, 'valor', b.valor, 'desconto', b.desconto, 'juros', b.juros, 'multa', b.multa,
    'cod_cc', b.cod_cc, 'conta', cc.descricao, 'origem', b.origem, 'observacao', b.observacao, 'lote_id', b.lote_id,
    'omie_status', b.omie_status, 'movimento_id', b.movimento_id, 'criado_por', b.criado_por, 'criado_em', b.criado_em)
    order by b.criado_em desc), '[]'::jsonb)
    from finance.baixas b
    left join finance.receber r on r.id = b.receber_id
    left join finance.contas_correntes cc on cc.empresa = b.empresa and cc.cod_cc = b.cod_cc
   where b.natureza = 'R' and b.estornado_em is null
     and (case when p_so_omie_pendente then b.omie_status = 'nao_enviado' else b.criado_em >= p_desde end)
$$;

-- movimentos de uma conta: "casado" = soma do que passou no banco (valor - desconto + juros + multa)
create or replace function finance.pagar_v3_movimentos(p_cod_cc bigint, p_de date)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'empresa', m.empresa, 'data', m.data, 'valor', m.valor, 'memo', coalesce(m.memo, m.nome), 'arquivo', m.arquivo,
    'importado_em', m.importado_em, 'ignorado', m.ignorado, 'motivo', m.ignorado_motivo,
    'casado', coalesce(x.casado, 0), 'baixas', coalesce(x.baixas, '[]'::jsonb)) order by m.data desc, m.id), '[]'::jsonb)
    from finance.banco_movimentos m
    left join lateral (
      select sum(b.valor - b.desconto + b.juros + b.multa) casado,
             jsonb_agg(jsonb_build_object('id', b.id, 'contraparte', b.contraparte, 'empresa', b.empresa,
             'documento', b.documento, 'valor', b.valor, 'juros', b.juros + b.multa, 'ref',
             case when b.cod_titulo is not null then 'o:' || b.cod_titulo when b.pagar_id is not null then 'p:' || b.pagar_id
                  when b.receber_id is not null then 'r:' || b.receber_id end)) baixas
        from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null) x on true
   where m.cod_cc = p_cod_cc and m.data >= p_de
$$;

do $$ declare f text; begin
  foreach f in array array[
    'finance.receber_v1_dados(date)', 'finance.receber_v1_baixar(jsonb, date, text, text, boolean, bigint)',
    'finance.receber_v1_previsao(uuid[], date, text, text)', 'finance.receber_v1_renegociar(uuid[], text, text, boolean)',
    'finance.receber_v1_cobranca(uuid[], text, text, text, date, text)', 'finance.receber_v1_cobrancas_de(uuid)',
    'finance.receber_v1_baixas(timestamptz, boolean)', 'finance.pagar_v3_movimentos(bigint, date)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
