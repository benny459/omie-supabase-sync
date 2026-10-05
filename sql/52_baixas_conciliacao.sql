-- 52 — Baixas nativas (pagar/receber) e conciliação bancária (OFX + manual). 05/10/26.
--
-- Até aqui a baixa de um título só existia quando o título do Omie era pago
-- lá. Para sair do Omie, o pagamento/recebimento passa a ser registado aqui:
--
--   finance.baixas          livro de baixas (nunca se apaga; estorno marca)
--   finance.pagar_previsto  + valor_pago / pago_em (derivados das baixas)
--   finance.receber         + valor_pago / pago_em (derivados das baixas)
--   finance.banco_movimentos  extrato importado (OFX); + ignorado/nome/checknum
--   finance.financeiro_audit  quem fez o quê
--
-- Regras:
--  * Só títulos NATIVOS se baixam aqui: pagar = previsão de PC do painel
--    (finance.pagar_previsto); receber = conta nascida no painel
--    (finance.receber origem 'painel'). Título do Omie continua a ser pago no Omie.
--  * Baixa parcial é permitida (soma das baixas ≤ valor do título).
--  * Pagar só se baixa em fase 'liberado' (pré-condição do ciclo de Compras),
--    salvo p_forcar com motivo (pagamento que já aconteceu no banco).
--  * NÃO se mexe em pagar_previsto.status: compras.gerar_previsoes faz upsert
--    com status='previsto' — um status 'pago' seria apagado. "Pago" é derivado
--    (valor_pago >= valor) e as views mostram PAGO/RECEBIDO.
--  * Conciliar = casar um movimento do extrato com 1..n títulos (split); cada
--    casamento é uma baixa com movimento_id. Desfazer = estornar essas baixas.

-- ── colunas novas (aditivas) ─────────────────────────────────────────────────
alter table finance.pagar_previsto
  add column if not exists valor_pago numeric not null default 0,
  add column if not exists pago_em date;

alter table finance.receber
  add column if not exists valor_pago numeric not null default 0,
  add column if not exists pago_em date;

alter table finance.banco_movimentos
  add column if not exists nome text,
  add column if not exists checknum text,
  add column if not exists fitid_original text,
  add column if not exists ignorado boolean not null default false,
  add column if not exists ignorado_motivo text,
  add column if not exists ignorado_por text,
  add column if not exists ignorado_em timestamptz;

create index if not exists banco_movimentos_conta_data on finance.banco_movimentos (empresa, cod_cc, data);

-- ── auditoria ────────────────────────────────────────────────────────────────
create table if not exists finance.financeiro_audit (
  id          bigserial primary key,
  em          timestamptz not null default now(),
  usuario     text,
  acao        text not null,
  entidade    text not null,
  entidade_id text,
  detalhe     jsonb
);
create index if not exists financeiro_audit_ent on finance.financeiro_audit (entidade, entidade_id, em desc);

-- ── livro de baixas ──────────────────────────────────────────────────────────
create table if not exists finance.baixas (
  id             bigserial primary key,
  empresa        text not null,
  natureza       char(1) not null check (natureza in ('P', 'R')),
  pagar_id       bigint references finance.pagar_previsto(id) on delete set null,
  receber_id     uuid references finance.receber(id) on delete set null,
  -- retrato do título no momento da baixa (sobrevive se a previsão for refeita)
  documento      text,
  contraparte    text,
  data           date not null,
  valor          numeric(14, 2) not null check (valor > 0),
  cod_cc         bigint,
  movimento_id   bigint references finance.banco_movimentos(id) on delete restrict,
  origem         text not null check (origem in ('manual', 'conciliacao')),
  forcada        boolean not null default false,
  observacao     text,
  criado_por     text,
  criado_em      timestamptz not null default now(),
  estornado_em   timestamptz,
  estornado_por  text,
  estorno_motivo text,
  check ((natureza = 'P' and receber_id is null) or (natureza = 'R' and pagar_id is null))
);
create index if not exists baixas_pagar on finance.baixas (pagar_id) where estornado_em is null;
create index if not exists baixas_receber on finance.baixas (receber_id) where estornado_em is null;
create index if not exists baixas_mov on finance.baixas (movimento_id) where estornado_em is null;

alter table finance.baixas           enable row level security;
alter table finance.financeiro_audit enable row level security;
revoke all on finance.baixas, finance.financeiro_audit from anon, authenticated;
grant select, insert, update on finance.baixas to service_role;
grant select, insert on finance.financeiro_audit to service_role;
grant usage, select on sequence finance.baixas_id_seq, finance.financeiro_audit_id_seq to service_role;

-- valor_pago / pago_em do título = soma das baixas ativas
create or replace function finance.baixas_recalcular(p_natureza char, p_pagar bigint, p_receber uuid)
returns void language plpgsql security definer set search_path = finance, public as $$
begin
  if p_natureza = 'P' and p_pagar is not null then
    update finance.pagar_previsto pp set
      valor_pago = coalesce((select sum(b.valor) from finance.baixas b where b.pagar_id = p_pagar and b.estornado_em is null), 0),
      pago_em    = (select max(b.data) from finance.baixas b where b.pagar_id = p_pagar and b.estornado_em is null)
     where pp.id = p_pagar;
  elsif p_natureza = 'R' and p_receber is not null then
    update finance.receber r set
      valor_pago = coalesce((select sum(b.valor) from finance.baixas b where b.receber_id = p_receber and b.estornado_em is null), 0),
      pago_em    = (select max(b.data) from finance.baixas b where b.receber_id = p_receber and b.estornado_em is null)
     where r.id = p_receber;
  end if;
end $$;

create or replace function finance.baixas_trg() returns trigger
language plpgsql security definer set search_path = finance, public as $$
begin
  perform finance.baixas_recalcular(new.natureza, new.pagar_id, new.receber_id);
  return new;
end $$;
drop trigger if exists baixas_recalc on finance.baixas;
create trigger baixas_recalc after insert or update on finance.baixas
  for each row execute function finance.baixas_trg();

-- conta a receber com baixa ativa não se apaga (estorne primeiro)
create or replace function finance.receber_protege_baixa() returns trigger
language plpgsql security definer set search_path = finance, public as $$
begin
  if exists (select 1 from finance.baixas b where b.receber_id = old.id and b.estornado_em is null) then
    raise exception 'Esta conta tem recebimento registado — estorne a baixa antes de excluir.';
  end if;
  return old;
end $$;
drop trigger if exists receber_protege_baixa on finance.receber;
create trigger receber_protege_baixa before delete on finance.receber
  for each row execute function finance.receber_protege_baixa();

-- ── títulos nativos em aberto (pagar + receber), com saldo ───────────────────
create or replace view finance.v_titulos_nativos as
select 'P'::char(1) as natureza, pp.id::text as titulo, pp.empresa,
       pp.fornecedor_nome as contraparte, regexp_replace(coalesce(pp.fornecedor_cnpj, ''), '\D', '', 'g') as cnpj,
       ('PC ' || pp.pedido_numero || ' · ' || pp.parcela_n || '/' || pp.parcelas_total) as documento,
       pp.nf_numero, pp.pedido_numero, pp.vencimento, pp.valor, pp.valor_pago,
       greatest(pp.valor - pp.valor_pago, 0) as saldo, pp.fase, pp.conta_cod as cod_cc
  from finance.pagar_previsto pp
 where pp.status = 'previsto'
union all
select 'R'::char(1), r.id::text, r.empresa,
       coalesce(r.cliente_razao, cli.razao_social, cli.nome_fantasia),
       regexp_replace(coalesce(r.cliente_cnpj, cli.cnpj_cpf, ''), '\D', '', 'g'),
       coalesce(nullif(r.numero_documento, ''), 'Conta a receber') || coalesce(' · ' || nullif(r.numero_parcela, ''), ''),
       r.numero_documento_fiscal, r.numero_pedido, r.vencimento, r.valor, r.valor_pago,
       greatest(r.valor - r.valor_pago, 0), null::text, r.id_conta_corrente
  from finance.receber r
  left join finance.clientes cli on cli.empresa = r.empresa and cli.codigo_cliente_omie = r.codigo_cliente_omie
  -- conta do painel já lançada também no Omie e lá recebida/cancelada: fica de fora
  left join finance.v_titulos_omie o on r.omie_codigo_lancamento is not null and o.natureza = 'R'
        and o.empresa = r.empresa and o.cod_titulo = r.omie_codigo_lancamento
 where r.origem = 'painel' and coalesce(o.status, '') not in ('RECEBIDO', 'CANCELADO', 'EXCLUIDO');
revoke all on finance.v_titulos_nativos from anon, authenticated;
grant select on finance.v_titulos_nativos to service_role;

-- ── baixa manual / por conciliação ───────────────────────────────────────────
create or replace function finance.baixa_registrar(
  p_natureza text, p_titulo text, p_data date, p_valor numeric, p_cod_cc bigint,
  p_movimento_id bigint, p_obs text, p_usuario text, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare t record; v_id bigint; v_valor numeric := round(p_valor, 2);
begin
  if p_natureza not in ('P', 'R') then raise exception 'natureza inválida'; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Valor da baixa tem de ser positivo'; end if;
  if p_data is null then raise exception 'Data da baixa obrigatória'; end if;

  select * into t from finance.v_titulos_nativos where natureza = p_natureza and titulo = p_titulo;
  if not found then
    raise exception 'Título não encontrado entre os títulos do painel (os do Omie baixam-se no Omie)';
  end if;
  if p_natureza = 'P' then
    perform 1 from finance.pagar_previsto where id = p_titulo::bigint for update;
  else
    perform 1 from finance.receber where id = p_titulo::uuid for update;
  end if;
  if v_valor > t.saldo + 0.004 then
    raise exception 'Valor (%) maior que o saldo em aberto do título (%)', v_valor, t.saldo;
  end if;
  if p_natureza = 'P' and coalesce(t.fase, '') <> 'liberado' and not coalesce(p_forcar, false) then
    raise exception 'Título ainda não liberado para pagar (fase %). Para registar um pagamento que já aconteceu, use "forçar" com motivo.', coalesce(t.fase, '—');
  end if;
  if coalesce(p_forcar, false) and coalesce(trim(p_obs), '') = '' then
    raise exception 'Baixa forçada exige motivo (observação)';
  end if;

  insert into finance.baixas (empresa, natureza, pagar_id, receber_id, documento, contraparte, data, valor,
                              cod_cc, movimento_id, origem, forcada, observacao, criado_por)
  values (t.empresa, p_natureza,
          case when p_natureza = 'P' then p_titulo::bigint end,
          case when p_natureza = 'R' then p_titulo::uuid end,
          t.documento, t.contraparte, p_data, v_valor, coalesce(p_cod_cc, t.cod_cc), p_movimento_id,
          case when p_movimento_id is null then 'manual' else 'conciliacao' end,
          coalesce(p_forcar, false), nullif(trim(p_obs), ''), p_usuario)
  returning id into v_id;

  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'baixa', case when p_natureza = 'P' then 'pagar' else 'receber' end, p_titulo,
          jsonb_build_object('baixa_id', v_id, 'valor', v_valor, 'data', p_data, 'cod_cc', p_cod_cc,
                             'movimento_id', p_movimento_id, 'forcada', coalesce(p_forcar, false), 'obs', p_obs));
  return jsonb_build_object('ok', true, 'baixa_id', v_id, 'saldo', t.saldo - v_valor);
end $$;

create or replace function finance.baixa_estornar(p_baixa_id bigint, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare b finance.baixas;
begin
  select * into b from finance.baixas where id = p_baixa_id for update;
  if not found then raise exception 'Baixa % não encontrada', p_baixa_id; end if;
  if b.estornado_em is not null then raise exception 'Baixa já estornada'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Estorno exige motivo'; end if;
  update finance.baixas set estornado_em = now(), estornado_por = p_usuario, estorno_motivo = trim(p_motivo)
   where id = p_baixa_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'estorno', case when b.natureza = 'P' then 'pagar' else 'receber' end,
          coalesce(b.pagar_id::text, b.receber_id::text),
          jsonb_build_object('baixa_id', b.id, 'valor', b.valor, 'motivo', p_motivo, 'movimento_id', b.movimento_id));
  return jsonb_build_object('ok', true);
end $$;

-- baixas de um título (para o modal)
create or replace function finance.baixas_do_titulo(p_natureza text, p_titulo text)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select jsonb_build_object(
    'titulo', (select to_jsonb(t) from finance.v_titulos_nativos t where t.natureza = p_natureza and t.titulo = p_titulo),
    'baixas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'data', b.data, 'valor', b.valor, 'cod_cc', b.cod_cc, 'conta', cc.descricao,
        'origem', b.origem, 'forcada', b.forcada, 'observacao', b.observacao, 'criado_por', b.criado_por,
        'criado_em', b.criado_em, 'estornado_em', b.estornado_em, 'estornado_por', b.estornado_por,
        'estorno_motivo', b.estorno_motivo, 'movimento_id', b.movimento_id, 'memo', m.memo) order by b.criado_em)
      from finance.baixas b
      left join finance.contas_correntes cc on cc.empresa = b.empresa and cc.cod_cc = b.cod_cc
      left join finance.banco_movimentos m on m.id = b.movimento_id
     where (p_natureza = 'P' and b.pagar_id = p_titulo::bigint)
        or (p_natureza = 'R' and b.receber_id::text = p_titulo)), '[]'::jsonb))
$$;

-- ── extrato: importar movimentos (o parse do OFX é feito na rota) ───────────
create or replace function finance.ofx_importar(
  p_empresa text, p_cod_cc bigint, p_banco text, p_conta text, p_arquivo text, p_usuario text, p_movs jsonb)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare n_novos int; n_total int := jsonb_array_length(coalesce(p_movs, '[]'::jsonb));
begin
  if not exists (select 1 from finance.contas_correntes where empresa = p_empresa and cod_cc = p_cod_cc) then
    raise exception 'Conta corrente % / % não existe', p_empresa, p_cod_cc;
  end if;
  with ins as (
    insert into finance.banco_movimentos (empresa, cod_cc, banco, conta_banco, fitid, fitid_original, data, valor, tipo,
                                          memo, nome, refnum, checknum, origem, arquivo, importado_por, importado_em)
    select p_empresa, p_cod_cc, p_banco, p_conta, m->>'fitid', m->>'fitid_original', (m->>'data')::date,
           (m->>'valor')::numeric, m->>'tipo', m->>'memo', m->>'nome', m->>'refnum', m->>'checknum',
           'ofx', p_arquivo, p_usuario, now()
      from jsonb_array_elements(p_movs) m
    on conflict (empresa, cod_cc, fitid) do nothing
    returning 1)
  select count(*) into n_novos from ins;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'ofx_importar', 'conta', p_empresa || ':' || p_cod_cc,
          jsonb_build_object('arquivo', p_arquivo, 'novos', n_novos, 'duplicados', n_total - n_novos));
  return jsonb_build_object('novos', n_novos, 'duplicados', n_total - n_novos, 'total', n_total);
end $$;

-- ── conciliação ──────────────────────────────────────────────────────────────
create or replace function finance.conciliar(p_movimento_id bigint, p_itens jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare m finance.banco_movimentos; v_nat char(1); v_ja numeric; v_soma numeric := 0; i jsonb; n int := 0;
begin
  select * into m from finance.banco_movimentos where id = p_movimento_id for update;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  if m.ignorado then raise exception 'Movimento está marcado como ignorado — reative antes'; end if;
  v_nat := case when m.valor < 0 then 'P' else 'R' end;
  select coalesce(sum(valor), 0) into v_ja from finance.baixas where movimento_id = m.id and estornado_em is null;
  for i in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if coalesce(i->>'natureza', v_nat) <> v_nat then
      raise exception 'Movimento de % não casa com título a %', case when v_nat = 'P' then 'saída' else 'entrada' end,
        case when v_nat = 'P' then 'receber' else 'pagar' end;
    end if;
    v_soma := v_soma + round((i->>'valor')::numeric, 2);
  end loop;
  if v_soma <= 0 then raise exception 'Nada para conciliar'; end if;
  if v_ja + v_soma > abs(m.valor) + 0.004 then
    raise exception 'Soma dos títulos (%) passa o valor do movimento (% já usado de %)', v_soma, v_ja, abs(m.valor);
  end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    if m.empresa <> (select empresa from finance.v_titulos_nativos where natureza = v_nat and titulo = i->>'titulo') then
      raise exception 'Título % é de outra empresa', i->>'titulo';
    end if;
    perform finance.baixa_registrar(v_nat, i->>'titulo', m.data, (i->>'valor')::numeric, m.cod_cc, m.id,
                                    coalesce(i->>'obs', 'Conciliação: ' || coalesce(m.memo, m.nome, m.fitid)),
                                    p_usuario, coalesce((i->>'forcar')::boolean, false));
    n := n + 1;
  end loop;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'conciliar', 'movimento', m.id::text, jsonb_build_object('itens', p_itens, 'valor', m.valor));
  return jsonb_build_object('ok', true, 'baixas', n, 'restante', abs(m.valor) - v_ja - v_soma);
end $$;

create or replace function finance.conciliacao_desfazer(p_movimento_id bigint, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare b record; n int := 0;
begin
  for b in select id from finance.baixas where movimento_id = p_movimento_id and estornado_em is null loop
    perform finance.baixa_estornar(b.id, coalesce(nullif(trim(p_motivo), ''), 'Conciliação desfeita'), p_usuario);
    n := n + 1;
  end loop;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'desfazer_conciliacao', 'movimento', p_movimento_id::text, jsonb_build_object('estornos', n, 'motivo', p_motivo));
  return jsonb_build_object('ok', true, 'estornos', n);
end $$;

create or replace function finance.movimento_ignorar(p_movimento_id bigint, p_ignorar boolean, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
begin
  if p_ignorar and exists (select 1 from finance.baixas where movimento_id = p_movimento_id and estornado_em is null) then
    raise exception 'Movimento já conciliado — desfaça antes de ignorar';
  end if;
  if p_ignorar and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo (ex.: tarifa, transferência entre contas)'; end if;
  update finance.banco_movimentos set ignorado = p_ignorar,
         ignorado_motivo = case when p_ignorar then trim(p_motivo) end,
         ignorado_por = case when p_ignorar then p_usuario end,
         ignorado_em = case when p_ignorar then now() end
   where id = p_movimento_id;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, case when p_ignorar then 'ignorar' else 'reativar' end, 'movimento', p_movimento_id::text,
          jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- Movimentos de uma conta/período com o que já está casado + sugestões + títulos
-- em aberto para casamento manual. Sugestão: mesmo sinal, valor igual ao saldo
-- (ou ao valor) do título, vencimento a ±3 dias, CNPJ ou nº do documento no memo.
create or replace function finance.conciliacao_painel(p_empresa text, p_cod_cc bigint, p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = finance, public as $$
with movs as (
  select m.*,
         coalesce((select sum(b.valor) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0) as casado,
         upper(coalesce(m.memo, '') || ' ' || coalesce(m.nome, '')) as texto,
         regexp_replace(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''), '\D', '', 'g') as digitos
    from finance.banco_movimentos m
   where m.empresa = p_empresa and m.cod_cc = p_cod_cc and m.data between p_de and p_ate
),
abertos as (
  select * from finance.v_titulos_nativos t where t.empresa = p_empresa and t.saldo > 0
),
cand as (
  select m.id as movimento_id, t.natureza, t.titulo, t.contraparte, t.documento, t.vencimento, t.saldo, t.valor, t.fase,
         (case when abs(abs(m.valor) - m.casado - t.saldo) < 0.005 then 50
               when abs(abs(m.valor) - m.casado - t.valor) < 0.005 then 40 else 0 end) as pts_valor,
         (case when t.vencimento is not null and abs(m.data - t.vencimento) <= 3 then 30
               when t.vencimento is not null and abs(m.data - t.vencimento) <= 10 then 10 else 0 end)
       + (case when length(t.cnpj) >= 8 and position(left(t.cnpj, 8) in m.digitos) > 0 then 20 else 0 end)
       + (case when (length(ltrim(regexp_replace(coalesce(t.nf_numero, ''), '\D', '', 'g'), '0')) >= 3
                      and m.texto ~ ('(^|\D)0*' || ltrim(regexp_replace(t.nf_numero, '\D', '', 'g'), '0') || '(\D|$)'))
                 or (length(regexp_replace(coalesce(t.pedido_numero, ''), '\D', '', 'g')) >= 3
                      and m.texto ~ ('(^|\D)' || regexp_replace(t.pedido_numero, '\D', '', 'g') || '(\D|$)'))
               then 20 else 0 end) as pts_extra
    from movs m
    join abertos t on t.natureza = case when m.valor < 0 then 'P' else 'R' end
   where not m.ignorado and m.casado < abs(m.valor) - 0.004
),
sug as (
  select movimento_id, jsonb_agg(jsonb_build_object('natureza', natureza, 'titulo', titulo, 'contraparte', contraparte,
           'documento', documento, 'vencimento', vencimento, 'saldo', saldo, 'fase', fase, 'score', score)
           order by score desc, vencimento) filter (where rk <= 5) as sugestoes
    -- sem valor batendo não é sugestão (casar por partes é "à mão")
    from (select c.*, c.pts_valor + c.pts_extra as score,
                 row_number() over (partition by movimento_id order by c.pts_valor + c.pts_extra desc, vencimento) rk
            from cand c where c.pts_valor > 0 and c.pts_valor + c.pts_extra >= 50) z
   group by movimento_id
)
select jsonb_build_object(
  'movimentos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'data', m.data, 'valor', m.valor, 'tipo', m.tipo, 'memo', m.memo, 'nome', m.nome, 'fitid', m.fitid,
      'checknum', m.checknum, 'arquivo', m.arquivo, 'casado', m.casado, 'ignorado', m.ignorado, 'ignorado_motivo', m.ignorado_motivo,
      'estado', case when m.ignorado then 'ignorado'
                     when m.casado >= abs(m.valor) - 0.004 then 'conciliado'
                     when m.casado > 0 then 'parcial' else 'pendente' end,
      'baixas', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'natureza', b.natureza,
                    'titulo', coalesce(b.pagar_id::text, b.receber_id::text), 'documento', b.documento,
                    'contraparte', b.contraparte, 'valor', b.valor) order by b.id)
                  from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), '[]'::jsonb),
      'sugestoes', coalesce(s.sugestoes, '[]'::jsonb)) order by m.data, m.id)
    from movs m left join sug s on s.movimento_id = m.id), '[]'::jsonb),
  'titulos', coalesce((select jsonb_agg(to_jsonb(t) order by t.vencimento nulls last) from abertos t), '[]'::jsonb)
)
$$;

-- só o servidor (service_role) chama estas funções
do $$ declare f text; begin
  foreach f in array array[
    'finance.baixas_recalcular(char, bigint, uuid)', 'finance.baixas_trg()', 'finance.receber_protege_baixa()',
    'finance.baixa_registrar(text, text, date, numeric, bigint, bigint, text, text, boolean)',
    'finance.baixa_estornar(bigint, text, text)', 'finance.baixas_do_titulo(text, text)',
    'finance.ofx_importar(text, bigint, text, text, text, text, jsonb)',
    'finance.conciliar(bigint, jsonb, text)', 'finance.conciliacao_desfazer(bigint, text, text)',
    'finance.movimento_ignorar(bigint, boolean, text, text)', 'finance.conciliacao_painel(text, bigint, date, date)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── views das telas: baixa nativa aparece como PAGO / RECEBIDO ───────────────
create or replace view finance.v_pagar_previsto as
 SELECT (- id) AS codigo_lancamento_omie,
    empresa,
    fornecedor_nome AS contraparte,
    fornecedor_nome AS contraparte_razao,
    fornecedor_cnpj AS cnpj_cpf,
    fornecedor_cod AS codigo_cliente_fornecedor,
    vencimento,
    vencimento AS previsao,
    NULL::date AS emissao,
    valor AS valor_documento,
    valor_pago AS valor_pago,
    greatest(valor - valor_pago, 0) AS val_aberto,
        CASE
            WHEN valor > 0 AND valor_pago >= valor THEN 'PAGO'::text
            WHEN fase = 'previsto'::text THEN 'PREVISTO'::text
            WHEN fase = 'aguardando_recebimento'::text THEN 'AGUARD_RECEB'::text
            WHEN fase = 'aguardando_conferencia'::text THEN 'AGUARD_CONF'::text
            ELSE 'LIBERADO'::text
        END AS status_titulo,
    ('PC '::text || pedido_numero) AS numero_documento,
    ((parcela_n || '/'::text) || parcelas_total) AS numero_parcela,
    nf_numero AS numero_documento_fiscal,
    pedido_numero AS numero_pedido,
    categoria_desc AS categoria,
    categoria_cod AS codigo_categoria,
    projeto_nome AS projeto,
    projeto_cod AS codigo_projeto,
    conta_desc AS conta_corrente,
    conta_cod AS cod_cc,
    (((((
        CASE fase
            WHEN 'previsto'::text THEN 'Previsto'::text
            WHEN 'aguardando_recebimento'::text THEN (('NF '::text || COALESCE(nf_numero, ''::text)) || ' — aguardando recebimento'::text)
            WHEN 'aguardando_conferencia'::text THEN 'Aguardando conferência'::text
            ELSE 'Liberado para pagar'::text
        END || ' (PC '::text) || pedido_numero) || ')'::text) ||
        CASE
            WHEN parcial THEN ' · parcial'::text
            ELSE ''::text
        END) ||
        CASE
            WHEN valor_pago > 0 AND valor_pago < valor THEN ' · pago ' || to_char(valor_pago, 'FM999G999G990D00')
            WHEN valor > 0 AND valor_pago >= valor THEN ' · pago em ' || to_char(pago_em, 'DD/MM/YYYY')
            ELSE ''::text
        END) AS observacao,
    'PC'::text AS origem,
    tipo_doc AS tipo_documento,
    NOT (valor > 0 AND valor_pago >= valor) AS em_aberto,
    (vencimento - CURRENT_DATE) AS dias_para_vencer,
    pedido_id,
    status,
    fase,
    parcial,
    valor_liberado,
    nf_chave AS chave_nfe,
    id AS pagar_id,
    pago_em,
    (valor > 0 AND valor_pago >= valor) AS quitado
   FROM finance.pagar_previsto pp
  WHERE (status = 'previsto'::text);

-- v_receber: igual à anterior; só muda quando há baixa nativa (r.valor_pago > 0)
-- — aí o recebido/saldo/status vêm do painel. Sem baixa nativa, o resultado é
-- idêntico ao de antes.
create or replace view finance.v_receber as
 SELECT r.id,
    r.origem AS origem_registro,
    r.conferencia,
    r.divergencias,
    r.conferido_em,
    r.created_by,
    r.omie_codigo_lancamento IS NOT NULL AND o.cod_titulo IS NULL AS omie_ausente,
    r.empresa,
    'R'::text AS natureza,
    'receber'::text AS tipo,
    r.omie_codigo_lancamento AS cod_titulo,
    r.omie_codigo_lancamento AS codigo_lancamento_omie,
    o.cod_int_titulo,
    o.cod_tit_repet,
    r.numero_documento AS num_titulo,
    r.numero_documento,
    r.numero_parcela AS num_parcela,
    r.numero_parcela,
    r.numero_documento_fiscal AS num_doc_fiscal,
    r.numero_documento_fiscal,
    o.num_boleto,
    o.boleto_numero,
    COALESCE(o.boleto_gerado, false) AS boleto_gerado,
    o.codigo_barras,
    o.nsu,
    r.chave_nfe,
    o.num_contrato,
    o.cod_contrato,
    r.numero_pedido AS num_os,
    r.numero_pedido,
    o.cod_os,
    o.cod_nf,
    r.codigo_cliente_omie AS cod_cliente,
    r.codigo_cliente_omie AS codigo_cliente_fornecedor,
    COALESCE(NULLIF(cli.nome_fantasia, ''::text), cli.razao_social, r.cliente_razao) AS contraparte,
    COALESCE(cli.razao_social, r.cliente_razao) AS contraparte_razao,
    COALESCE(r.cliente_cnpj, cli.cnpj_cpf) AS cnpj_cpf,
    o.cod_vendedor,
    o.cod_comprador,
    o.dt_registro,
    r.emissao,
    r.vencimento,
    r.previsao,
    o.pagamento,
    o.dt_cancelamento,
    r.valor AS valor_titulo,
    r.valor AS valor_documento,
    o.val_liquido,
    GREATEST(COALESCE(o.val_pago, 0::numeric), r.valor_pago) AS val_pago,
    GREATEST(COALESCE(o.val_pago, 0::numeric), r.valor_pago) AS valor_pago,
        CASE
            WHEN r.valor_pago > 0 THEN GREATEST(r.valor - r.valor_pago, 0::numeric)
            WHEN o.cod_titulo IS NOT NULL THEN o.val_aberto
            ELSE r.valor
        END AS val_aberto,
    o.juros,
    o.multa,
    o.desconto,
    o.valor_ir,
    o.ret_ir,
    o.valor_pis,
    o.ret_pis,
    o.valor_cofins,
    o.ret_cofins,
    o.valor_csll,
    o.ret_csll,
    o.valor_inss,
    o.ret_inss,
    o.valor_iss,
    o.ret_iss,
    r.codigo_categoria AS cod_categoria,
    r.codigo_categoria,
    cat.descricao AS categoria,
    o.categorias_rateio,
    COALESCE(o.tem_rateio, false) AS tem_rateio,
    o.grupo_despesa,
    r.codigo_projeto AS cod_projeto,
    r.codigo_projeto,
    proj.nome AS projeto,
    r.id_conta_corrente AS cod_cc,
    cc.descricao AS conta_corrente,
    o.operacao,
    o.origem,
    o.tipo_documento,
        CASE
            WHEN r.valor > 0 AND r.valor_pago >= r.valor AND COALESCE(o.status, ''::text) <> 'CANCELADO'::text THEN 'RECEBIDO'::text
            ELSE COALESCE(o.status,
                CASE
                    WHEN r.vencimento < CURRENT_DATE THEN 'ATRASADO'::text
                    WHEN r.vencimento = CURRENT_DATE THEN 'VENCE HOJE'::text
                    ELSE 'A VENCER'::text
                END)
        END AS status,
        CASE
            WHEN r.valor > 0 AND r.valor_pago >= r.valor AND COALESCE(o.status, ''::text) <> 'CANCELADO'::text THEN 'RECEBIDO'::text
            ELSE COALESCE(o.status,
                CASE
                    WHEN r.vencimento < CURRENT_DATE THEN 'ATRASADO'::text
                    WHEN r.vencimento = CURRENT_DATE THEN 'VENCE HOJE'::text
                    ELSE 'A VENCER'::text
                END)
        END AS status_titulo,
    o.liquidado,
    o.status_pago_d,
    r.observacao,
    o.info_d_inc,
    o.info_h_inc,
    o.info_u_inc,
    o.info_d_alt,
    o.info_h_alt,
    o.info_u_alt,
    COALESCE(o.synced_at, r.updated_at) AS synced_at,
        CASE
            WHEN r.valor > 0 AND r.valor_pago >= r.valor THEN false
            WHEN o.cod_titulo IS NOT NULL THEN o.em_aberto
            ELSE true
        END AS em_aberto,
    r.vencimento - CURRENT_DATE AS dias_para_vencer,
    r.valor_pago AS valor_pago_painel,
    r.pago_em AS pago_em_painel
   FROM finance.receber r
     LEFT JOIN finance.v_titulos_omie o ON o.natureza = 'R'::text AND o.empresa = r.empresa AND o.cod_titulo = r.omie_codigo_lancamento
     LEFT JOIN finance.clientes cli ON cli.empresa = r.empresa AND cli.codigo_cliente_omie = r.codigo_cliente_omie
     LEFT JOIN finance.categorias cat ON cat.empresa = r.empresa AND cat.codigo = r.codigo_categoria
     LEFT JOIN finance.projetos proj ON proj.empresa = r.empresa AND proj.codigo::text = r.codigo_projeto
     LEFT JOIN finance.contas_correntes cc ON cc.empresa = r.empresa AND cc.cod_cc = r.id_conta_corrente;

-- permissões finas novas (catálogo espelhado; padrão = só administradores)
insert into platform.permissoes_catalogo (chave, modulo, rotulo, descricao, ordem) values
  ('financeiro.baixar',    'financeiro', 'Baixar / estornar título',       'Registar pagamento ou recebimento de título do painel', 330),
  ('financeiro.conciliar', 'financeiro', 'Conciliação bancária',           'Importar extrato OFX e casar com títulos',              340)
on conflict (chave) do nothing;
