-- 141 — Provisionado × Real (08/10/26, Benny — financeiro-fluxo-v3-SPEC, P1)
-- Recorrência sem documento é PROVISIONADA (valor estimado); vira REAL quando
-- tem NF / boleto / chave — ou quando o financeiro confirma no painel com o nº do
-- documento e o valor real. A confirmação nunca escreve no Omie: título do Omie
-- usa a sobreposição titulo_ajustes (reaplicada a cada sync); título do painel
-- muda direto em pagar_previsto. Desfazer volta ao estado anterior.

create table if not exists finance.provisao_confirmacoes (
  id            bigserial primary key,
  empresa       text not null,
  cod_titulo    bigint,
  pagar_id      bigint references finance.pagar_previsto(id),
  serie_ref     text,
  tipo_doc      text not null check (tipo_doc in ('NFSE', 'NFE', 'BOL', 'REC', 'DAS')),
  numero_doc    text not null,
  codigo_barras text, chave_nfe text,
  valor_prov    numeric(15,2) not null,
  valor_real    numeric(15,2) not null,
  venc_prov     date, venc_real date,
  escopo        text not null default 'esta' check (escopo in ('esta', 'proximas', 'media')),
  motivo        text,
  -- estado anterior para o desfazer: {"<cod_titulo|pagar_id>": {...}} desta e das próximas mexidas
  antes         jsonb not null default '{}'::jsonb,
  criado_por    text, criado_em timestamptz not null default now(),
  desfeito_em   timestamptz, desfeito_por text,
  check ((cod_titulo is not null) <> (pagar_id is not null))
);
create unique index if not exists provisao_conf_omie_uq on finance.provisao_confirmacoes (empresa, cod_titulo) where desfeito_em is null and cod_titulo is not null;
create unique index if not exists provisao_conf_painel_uq on finance.provisao_confirmacoes (pagar_id) where desfeito_em is null and pagar_id is not null;
alter table finance.provisao_confirmacoes enable row level security;
revoke all on finance.provisao_confirmacoes from anon, authenticated;
grant all on finance.provisao_confirmacoes to service_role;
grant usage, select on sequence finance.provisao_confirmacoes_id_seq to service_role;

alter table finance.pagar_previsto add column if not exists valor_estimado boolean not null default false;
insert into finance.config (chave, valor, atualizado_por) values ('provisao_tolerancia', '{"pct":10}', 'p141') on conflict do nothing;

-- sobreposição do Omie passa a aceitar código de barras e chave da NF-e
create or replace function finance._ajuste_campos(p jsonb)
returns jsonb language sql immutable
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v)
   where k in ('valor', 'vencimento', 'cod_categoria', 'cod_cc', 'cod_projeto', 'observacao', 'documento', 'nf', 'emissao', 'codigo_barras', 'chave_nfe')
$$;

create or replace function finance.tg_titulo_ajuste_reaplica()
returns trigger language plpgsql security definer set search_path to 'finance', 'public'
as $function$
declare a finance.titulo_ajustes; d numeric; v numeric; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into a from finance.titulo_ajustes where empresa = new.empresa and cod_titulo = new.cod_titulo;
  if not found then return new; end if;
  if a.novo ? 'valor' then
    v := (a.novo->>'valor')::numeric;
    if new.valor_titulo is distinct from v then
      d := v - coalesce(new.valor_titulo, 0);
      new.valor_titulo := v;
      if coalesce(new.val_aberto, 0) > 0 then new.val_aberto := greatest(new.val_aberto + d, 0); end if;
    end if;
  end if;
  if a.novo ? 'vencimento' then
    new.dt_vencimento := to_char((a.novo->>'vencimento')::date, 'DD/MM/YYYY');
    new.dt_previsao   := to_char((a.novo->>'vencimento')::date, 'DD/MM/YYYY');
    if new.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO') then
      new.status := case when (a.novo->>'vencimento')::date < hoje then 'ATRASADO'
                         when (a.novo->>'vencimento')::date = hoje then 'VENCE HOJE' else 'A VENCER' end;
    end if;
  end if;
  if a.novo ? 'cod_categoria' then new.cod_categoria := a.novo->>'cod_categoria'; end if;
  if a.novo ? 'cod_cc'        then new.cod_cc        := (a.novo->>'cod_cc')::bigint; end if;
  if a.novo ? 'cod_projeto'   then new.cod_projeto   := nullif(a.novo->>'cod_projeto', ''); end if;
  if a.novo ? 'observacao'    then new.observacao    := nullif(a.novo->>'observacao', ''); end if;
  if a.novo ? 'documento'     then new.num_titulo    := nullif(a.novo->>'documento', ''); end if;
  if a.novo ? 'nf'            then new.num_doc_fiscal := nullif(a.novo->>'nf', ''); end if;
  if a.novo ? 'emissao'       then new.dt_emissao    := case when nullif(a.novo->>'emissao', '') is null then null
                                                             else to_char((a.novo->>'emissao')::date, 'DD/MM/YYYY') end; end if;
  if a.novo ? 'codigo_barras' then new.codigo_barras := nullif(a.novo->>'codigo_barras', ''); end if;
  if a.novo ? 'chave_nfe'     then new.chave_nfe     := nullif(a.novo->>'chave_nfe', ''); end if;
  return new;
end $function$;

-- "antes" do ajuste guarda também código de barras e chave (para o desfazer)
do $$
declare d text;
begin
  d := pg_get_functiondef('finance.titulo_ajustar'::regproc);
  if position('''codigo_barras'', x.codigo_barras' in d) = 0 then
    if position('''nf'', x.num_doc_fiscal, ''emissao'', x.dt_emissao_d,' in d) = 0 then raise exception 'titulo_ajustar: trecho não encontrado'; end if;
    d := replace(d, '''nf'', x.num_doc_fiscal, ''emissao'', x.dt_emissao_d,',
                    '''nf'', x.num_doc_fiscal, ''emissao'', x.dt_emissao_d, ''codigo_barras'', x.codigo_barras, ''chave_nfe'', x.chave_nfe,');
    execute d;
  end if;
end $$;

-- desfazer ajuste devolve também NF, emissão, código de barras e chave
create or replace function finance.titulo_desfazer_ajuste(p_empresa text, p_cod bigint, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public'
as $function$
declare a finance.titulo_ajustes; t finance.pesquisa_titulos; d numeric := 0;
begin
  select * into a from finance.titulo_ajustes where empresa = p_empresa and cod_titulo = p_cod;
  if not found then raise exception 'Este título não tem ajuste'; end if;
  select * into t from finance.pesquisa_titulos where empresa = p_empresa and cod_titulo = p_cod;
  delete from finance.titulo_ajustes where empresa = p_empresa and cod_titulo = p_cod;
  if a.novo ? 'valor' then d := (a.orig->>'valor')::numeric - coalesce(t.valor_titulo, 0); end if;
  update finance.pesquisa_titulos set
    valor_titulo  = case when a.novo ? 'valor' then (a.orig->>'valor')::numeric else valor_titulo end,
    val_aberto    = case when a.novo ? 'valor' and coalesce(val_aberto, 0) > 0 then greatest(val_aberto + d, 0) else val_aberto end,
    dt_vencimento = case when a.novo ? 'vencimento' then to_char((a.orig->>'vencimento')::date, 'DD/MM/YYYY') else dt_vencimento end,
    dt_previsao   = case when a.novo ? 'vencimento' then to_char((a.orig->>'previsao')::date, 'DD/MM/YYYY') else dt_previsao end,
    status        = case when a.novo ? 'vencimento' and status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
                         and a.orig ? 'status' then a.orig->>'status' else status end,
    cod_categoria = case when a.novo ? 'cod_categoria' then a.orig->>'cod_categoria' else cod_categoria end,
    cod_cc        = case when a.novo ? 'cod_cc' then (a.orig->>'cod_cc')::bigint else cod_cc end,
    cod_projeto   = case when a.novo ? 'cod_projeto' then a.orig->>'cod_projeto' else cod_projeto end,
    observacao    = case when a.novo ? 'observacao' then a.orig->>'observacao' else observacao end,
    num_titulo    = case when a.novo ? 'documento' then a.orig->>'documento' else num_titulo end,
    num_doc_fiscal = case when a.novo ? 'nf' then a.orig->>'nf' else num_doc_fiscal end,
    dt_emissao    = case when a.novo ? 'emissao' then to_char((a.orig->>'emissao')::date, 'DD/MM/YYYY') else dt_emissao end,
    codigo_barras = case when a.novo ? 'codigo_barras' then a.orig->>'codigo_barras' else codigo_barras end,
    chave_nfe     = case when a.novo ? 'chave_nfe' then a.orig->>'chave_nfe' else chave_nfe end
  where empresa = p_empresa and cod_titulo = p_cod;
  if a.natureza = 'R' then perform finance._receber_espelhar(p_empresa, p_cod); end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'desfazer_ajuste_titulo', case when a.natureza = 'P' then 'pagar' else 'receber' end, p_cod::text,
          jsonb_build_object('empresa', p_empresa, 'orig', a.orig, 'novo', a.novo));
  return jsonb_build_object('ok', true);
end $function$;

-- ── natureza do valor ──
create or replace function finance.natureza_valor_omie(t finance.pesquisa_titulos) returns text
language sql stable set search_path to 'finance', 'public' as $$
  select case when t.origem = 'RPTP'
               and coalesce(t.num_doc_fiscal, '') = '' and coalesce(t.codigo_barras, '') = '' and coalesce(t.chave_nfe, '') = ''
               and not exists (select 1 from finance.provisao_confirmacoes c
                                where c.empresa = t.empresa and c.cod_titulo = t.cod_titulo and c.desfeito_em is null)
              then 'provisionado' else 'real' end $$;

create or replace function finance.natureza_valor_painel(p finance.pagar_previsto) returns text
language sql stable set search_path to 'finance', 'public' as $$
  select case when coalesce(p.origem_titulo, '') <> 'pc'
               and (p.valor_estimado or (p.serie_id is not null and coalesce(p.nf_numero, '') = '' and coalesce(p.extras->>'codigo_barras', '') = ''))
               and not exists (select 1 from finance.provisao_confirmacoes c where c.pagar_id = p.id and c.desfeito_em is null)
              then 'provisionado' else 'real' end $$;

-- ── provisões em aberto (para a Títulos a Pagar): ref → natureza, série, último real, média dos 3 últimos ──
create or replace function finance.pagar_provisoes() returns jsonb
language sql stable security definer set search_path to 'finance', 'public'
as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
om as (
  select t.*, finance.natureza_valor_omie(t) nat
    from finance.pesquisa_titulos t, hoje h
   where t.natureza = 'P' and t.origem = 'RPTP' and t.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
     and t.dt_vencimento_d between h.d - 180 and h.d + 120
),
om_reais as (
  -- documentos reais por série: pagos ou com NF (mais recentes primeiro)
  select r.empresa, r.cod_tit_repet, r.num_doc_fiscal, r.dt_vencimento_d, coalesce(nullif(r.val_pago, 0), r.valor_titulo) v,
         row_number() over (partition by r.empresa, r.cod_tit_repet order by r.dt_vencimento_d desc) n
    from finance.pesquisa_titulos r
   where r.natureza = 'P' and r.origem = 'RPTP' and coalesce(r.cod_tit_repet, 0) <> 0
     and (r.status in ('PAGO', 'LIQUIDADO') or coalesce(r.num_doc_fiscal, '') <> '')
     and (r.empresa, r.cod_tit_repet) in (select empresa, cod_tit_repet from om)
),
conf as (select * from finance.provisao_confirmacoes where desfeito_em is null),
pp as (
  select p.*, finance.natureza_valor_painel(p) nat from finance.pagar_previsto p
   where p.status = 'previsto' and coalesce(p.origem_titulo, '') <> 'pc' and (p.serie_id is not null or p.valor_estimado)
),
pp_reais as (
  select r.serie_id, r.nf_numero, r.vencimento, coalesce(nullif(r.valor_pago, 0), r.valor) v,
         row_number() over (partition by r.serie_id order by r.vencimento desc) n
    from finance.pagar_previsto r
   where r.serie_id is not null and (coalesce(r.nf_numero, '') <> '' or coalesce(r.valor_pago, 0) > 0)
     and r.serie_id in (select serie_id from pp)
)
select coalesce(jsonb_object_agg(ref, info), '{}'::jsonb) from (
  select 'o:' || o.cod_titulo ref, jsonb_build_object(
           'nat', o.nat, 'serie', o.cod_tit_repet::text,
           'ult', (select jsonb_build_object('nf', r.num_doc_fiscal, 'data', r.dt_vencimento_d) from om_reais r
                    where r.empresa = o.empresa and r.cod_tit_repet = o.cod_tit_repet and r.n = 1),
           'media3', (select round(avg(r.v), 2) from om_reais r where r.empresa = o.empresa and r.cod_tit_repet = o.cod_tit_repet and r.n <= 3),
           'conf', (select jsonb_build_object('id', c.id, 'doc', c.tipo_doc || ' ' || c.numero_doc, 'valor_prov', c.valor_prov, 'em', c.criado_em)
                      from conf c where c.empresa = o.empresa and c.cod_titulo = o.cod_titulo)) info
    from om o
  union all
  select 'p:' || p.id, jsonb_build_object(
           'nat', p.nat, 'serie', p.serie_id::text,
           'ult', (select jsonb_build_object('nf', r.nf_numero, 'data', r.vencimento) from pp_reais r where r.serie_id = p.serie_id and r.n = 1),
           'media3', (select round(avg(r.v), 2) from pp_reais r where r.serie_id = p.serie_id and r.n <= 3),
           'conf', (select jsonb_build_object('id', c.id, 'doc', c.tipo_doc || ' ' || c.numero_doc, 'valor_prov', c.valor_prov, 'em', c.criado_em)
                      from conf c where c.pagar_id = p.id))
    from pp p
) z
$$;

-- ── confirmar ──
create or replace function finance.provisao_confirmar(p jsonb, p_usuario text) returns jsonb
language plpgsql security definer set search_path to 'finance', 'public'
as $$
declare
  v_emp text := p->>'empresa';
  v_cod bigint := nullif(p->>'cod_titulo', '')::bigint;
  v_pid bigint := nullif(p->>'pagar_id', '')::bigint;
  v_tipo text := upper(coalesce(p->>'tipo_doc', ''));
  v_num text := nullif(trim(coalesce(p->>'numero_doc', '')), '');
  v_val numeric := round((p->>'valor_real')::numeric, 2);
  v_venc date := nullif(p->>'venc_real', '')::date;
  v_bar text := nullif(regexp_replace(coalesce(p->>'codigo_barras', ''), '\D', '', 'g'), '');
  v_chave text := nullif(regexp_replace(coalesce(p->>'chave_nfe', ''), '\D', '', 'g'), '');
  v_esc text := coalesce(nullif(p->>'escopo', ''), 'esta');
  v_mot text := nullif(trim(coalesce(p->>'motivo', '')), '');
  v_tol numeric := coalesce((select (valor->>'pct')::numeric from finance.config where chave = 'provisao_tolerancia'), 10);
  t finance.pesquisa_titulos; r finance.pagar_previsto; x record;
  v_prov numeric; v_vprov date; v_serie text; v_novo numeric; antes jsonb := '{}'::jsonb; c jsonb; v_id bigint; n_prox int := 0;
begin
  if v_num is null then raise exception 'Informe o nº do documento'; end if;
  if v_tipo not in ('NFSE', 'NFE', 'BOL', 'REC', 'DAS') then raise exception 'Tipo de documento inválido'; end if;
  if coalesce(v_val, 0) <= 0 then raise exception 'Valor real inválido'; end if;
  if v_esc not in ('esta', 'proximas', 'media') then raise exception 'Escopo inválido'; end if;
  -- 44/47/48 dígitos = código de barras / linha digitável; chave de NF-e = 44
  if v_bar is not null and length(v_bar) = 44 and v_chave is null and v_tipo = 'NFE' then v_chave := v_bar; v_bar := null; end if;
  if v_bar is not null and length(v_bar) not in (44, 47, 48) then raise exception 'Código de barras deve ter 44, 47 ou 48 dígitos'; end if;
  if v_chave is not null and length(v_chave) <> 44 then raise exception 'Chave da NF-e deve ter 44 dígitos'; end if;

  if v_cod is not null then
    select * into t from finance.pesquisa_titulos where empresa = v_emp and cod_titulo = v_cod and natureza = 'P' for update;
    if not found then raise exception 'Título do Omie não encontrado'; end if;
    if t.status not in ('A VENCER', 'VENCE HOJE', 'ATRASADO') then raise exception 'O título não está em aberto (%)', t.status; end if;
    if finance.natureza_valor_omie(t) <> 'provisionado' then raise exception 'Este título já é real (tem documento ou já foi confirmado)'; end if;
    v_prov := t.valor_titulo; v_vprov := t.dt_vencimento_d; v_serie := nullif(t.cod_tit_repet, 0)::text;
  else
    select * into r from finance.pagar_previsto where id = v_pid for update;
    if not found or r.status <> 'previsto' then raise exception 'Conta do painel não encontrada ou já substituída'; end if;
    if finance.natureza_valor_painel(r) <> 'provisionado' then raise exception 'Esta conta já é real (tem documento ou já foi confirmada)'; end if;
    v_emp := r.empresa; v_prov := r.valor; v_vprov := r.vencimento; v_serie := r.serie_id::text;
  end if;
  if v_prov > 0 and abs(v_val - v_prov) / v_prov * 100 > v_tol and v_mot is null then
    raise exception 'Diferença acima de % por cento da provisão — informe o motivo', v_tol;
  end if;

  if v_cod is not null then
    -- estado anterior (para o desfazer): a sobreposição que já existia, se havia
    antes := jsonb_build_object(v_cod::text, coalesce((select jsonb_build_object('orig', a.orig, 'novo', a.novo, 'motivo', a.motivo)
                                                         from finance.titulo_ajustes a where a.empresa = v_emp and a.cod_titulo = v_cod), 'null'::jsonb));
    c := jsonb_strip_nulls(jsonb_build_object('nf', v_num,
           'valor', case when abs(v_val - v_prov) > 0.004 then v_val end,
           'vencimento', case when v_venc is not null and v_venc <> v_vprov then v_venc end,
           'codigo_barras', v_bar, 'chave_nfe', v_chave));
    perform finance.titulo_ajustar(v_emp, v_cod, c, 'esta', coalesce(v_mot, 'Confirmação de provisão: ' || v_tipo || ' ' || v_num), p_usuario);
  else
    antes := jsonb_build_object(v_pid::text, jsonb_build_object('valor', r.valor, 'vencimento', r.vencimento, 'nf_numero', r.nf_numero,
               'codigo_barras', r.extras->>'codigo_barras', 'valor_estimado', r.valor_estimado));
    update finance.pagar_previsto set
      valor = v_val, vencimento = coalesce(v_venc, vencimento), nf_numero = v_num, valor_estimado = false,
      extras = case when v_bar is not null then coalesce(extras, '{}'::jsonb) || jsonb_build_object('codigo_barras', v_bar) else extras end,
      nf_chave = coalesce(v_chave, nf_chave), updated_at = now()
    where id = v_pid;
  end if;

  -- escopo da diferença: só as próximas ocorrências da série AINDA provisionadas
  if v_esc <> 'esta' and abs(v_val - v_prov) > 0.004 and v_serie is not null then
    if v_esc = 'media' then
      if v_cod is not null then
        select round(avg(v), 2) into v_novo from (
          select v_val v union all
          (select coalesce(nullif(z.val_pago, 0), z.valor_titulo) from finance.pesquisa_titulos z
            where z.empresa = v_emp and z.cod_tit_repet = t.cod_tit_repet and z.cod_titulo <> v_cod
              and (z.status in ('PAGO', 'LIQUIDADO') or coalesce(z.num_doc_fiscal, '') <> '')
            order by z.dt_vencimento_d desc limit 2)) m;
      else
        select round(avg(v), 2) into v_novo from (
          select v_val v union all
          (select coalesce(nullif(z.valor_pago, 0), z.valor) from finance.pagar_previsto z
            where z.serie_id = r.serie_id and z.id <> v_pid and (coalesce(z.nf_numero, '') <> '' or coalesce(z.valor_pago, 0) > 0)
            order by z.vencimento desc limit 2)) m;
      end if;
    else
      v_novo := v_val;
    end if;
    if v_cod is not null then
      for x in select z.* from finance.pesquisa_titulos z
                where z.empresa = v_emp and z.natureza = 'P' and z.cod_tit_repet = t.cod_tit_repet and z.cod_titulo <> v_cod
                  and z.dt_vencimento_d > t.dt_vencimento_d and z.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
                  and finance.natureza_valor_omie(z) = 'provisionado'
      loop
        antes := antes || jsonb_build_object(x.cod_titulo::text, coalesce((select jsonb_build_object('orig', a.orig, 'novo', a.novo, 'motivo', a.motivo)
                   from finance.titulo_ajustes a where a.empresa = v_emp and a.cod_titulo = x.cod_titulo), 'null'::jsonb));
        perform finance.titulo_ajustar(v_emp, x.cod_titulo, jsonb_build_object('valor', v_novo), 'esta',
                  'Provisão ajustada pela confirmação de ' || v_tipo || ' ' || v_num, p_usuario);
        n_prox := n_prox + 1;
      end loop;
    else
      for x in select z.* from finance.pagar_previsto z
                where z.serie_id = r.serie_id and z.id <> v_pid and z.status = 'previsto' and z.vencimento > r.vencimento
                  and finance.natureza_valor_painel(z) = 'provisionado'
      loop
        antes := antes || jsonb_build_object(x.id::text, jsonb_build_object('valor', x.valor, 'vencimento', x.vencimento, 'nf_numero', x.nf_numero,
                   'codigo_barras', x.extras->>'codigo_barras', 'valor_estimado', x.valor_estimado));
        update finance.pagar_previsto set valor = v_novo, updated_at = now() where id = x.id;
        n_prox := n_prox + 1;
      end loop;
    end if;
  end if;

  insert into finance.provisao_confirmacoes (empresa, cod_titulo, pagar_id, serie_ref, tipo_doc, numero_doc, codigo_barras, chave_nfe,
                                             valor_prov, valor_real, venc_prov, venc_real, escopo, motivo, antes, criado_por)
  values (v_emp, v_cod, v_pid, v_serie, v_tipo, v_num, v_bar, v_chave, v_prov, v_val, v_vprov, coalesce(v_venc, v_vprov), v_esc, v_mot, antes, p_usuario)
  returning id into v_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'provisao_confirmar', 'pagar', coalesce(v_cod::text, 'p:' || v_pid),
          jsonb_build_object('id', v_id, 'empresa', v_emp, 'doc', v_tipo || ' ' || v_num, 'valor_prov', v_prov, 'valor_real', v_val,
                             'escopo', v_esc, 'proximas', n_prox, 'motivo', v_mot));
  return jsonb_build_object('ok', true, 'id', v_id, 'proximas', n_prox, 'valor_proximas', v_novo);
end $$;

-- ── desfazer ──
create or replace function finance.provisao_desfazer(p_id bigint, p_usuario text) returns jsonb
language plpgsql security definer set search_path to 'finance', 'public'
as $$
declare c finance.provisao_confirmacoes; k text; e jsonb;
begin
  select * into c from finance.provisao_confirmacoes where id = p_id for update;
  if not found or c.desfeito_em is not null then raise exception 'Confirmação não encontrada ou já desfeita'; end if;
  if c.cod_titulo is not null then
    if exists (select 1 from finance.baixas b where b.cod_titulo = c.cod_titulo and b.empresa = c.empresa and b.estornado_em is null)
       or exists (select 1 from finance.pesquisa_titulos t where t.empresa = c.empresa and t.cod_titulo = c.cod_titulo and t.status in ('PAGO', 'LIQUIDADO'))
      then raise exception 'O título já foi baixado — estorne a baixa antes de desfazer'; end if;
    for k, e in select * from jsonb_each(c.antes) loop
      if exists (select 1 from finance.titulo_ajustes a where a.empresa = c.empresa and a.cod_titulo = k::bigint) then
        perform finance.titulo_desfazer_ajuste(c.empresa, k::bigint, p_usuario);
      end if;
      if e <> 'null'::jsonb then   -- havia sobreposição antes: volta a ela
        insert into finance.titulo_ajustes (empresa, cod_titulo, natureza, orig, novo, motivo, criado_por, alterado_por)
        values (c.empresa, k::bigint, 'P', e->'orig', e->'novo', e->>'motivo', p_usuario, p_usuario);
        update finance.pesquisa_titulos set valor_titulo = valor_titulo where empresa = c.empresa and cod_titulo = k::bigint;
      end if;
    end loop;
  else
    if exists (select 1 from finance.baixas b where b.pagar_id = c.pagar_id and b.estornado_em is null)
      then raise exception 'A conta já foi baixada — estorne a baixa antes de desfazer'; end if;
    for k, e in select * from jsonb_each(c.antes) loop
      update finance.pagar_previsto set
        valor = (e->>'valor')::numeric, vencimento = (e->>'vencimento')::date, nf_numero = e->>'nf_numero',
        valor_estimado = coalesce((e->>'valor_estimado')::boolean, valor_estimado),
        extras = case when e->>'codigo_barras' is null then coalesce(extras, '{}'::jsonb) - 'codigo_barras'
                      else coalesce(extras, '{}'::jsonb) || jsonb_build_object('codigo_barras', e->>'codigo_barras') end,
        updated_at = now()
      where id = k::bigint;
    end loop;
  end if;
  update finance.provisao_confirmacoes set desfeito_em = now(), desfeito_por = p_usuario where id = p_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'provisao_desfazer', 'pagar', coalesce(c.cod_titulo::text, 'p:' || c.pagar_id), jsonb_build_object('id', p_id));
  return jsonb_build_object('ok', true);
end $$;
