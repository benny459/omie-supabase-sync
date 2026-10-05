-- 80 — Editar títulos no painel (05/10/26).
--
-- Antes só se editava série recorrente criada no painel (sql/72 serie_editar).
-- Título vindo do Omie (a maioria, inclusive as recorrências do Omie) e conta
-- avulsa do painel não tinham edição nenhuma.
--
--  • finance.titulo_ajustes — sobreposição nativa por título do Omie: guarda o
--    valor ORIGINAL (orig) e o que foi ajustado (novo). O ajuste é gravado em
--    finance.pesquisa_titulos (espelho do Omie, import congelado), por isso BI,
--    fluxo de caixa, conciliação, remessa e fichas veem-no sem mudar nada.
--    O gatilho tg_titulo_ajuste_reaplica mantém o ajuste mesmo que um sync
--    volte a gravar a linha com os valores do Omie. Nada é escrito no Omie.
--  • titulo_ajustar / titulo_desfazer_ajuste — escopo 'esta' ou 'proximas'
--    (mesma recorrência do Omie: cod_tit_repet).
--  • pagar_editar  — conta do painel (manual ou previsão de PC; PC exige motivo).
--  • receber_editar — conta a receber (Omie → titulo_ajustar; painel → direto).
-- Valor nunca abaixo do que já foi pago (Omie + baixas do painel).

create table if not exists finance.titulo_ajustes (
  empresa      text   not null,
  cod_titulo   bigint not null,
  natureza     text   not null,
  orig         jsonb  not null,
  novo         jsonb  not null default '{}'::jsonb,
  motivo       text,
  criado_por   text,
  criado_em    timestamptz not null default now(),
  alterado_por text,
  alterado_em  timestamptz not null default now(),
  primary key (empresa, cod_titulo)
);
alter table finance.titulo_ajustes enable row level security;
revoke all on finance.titulo_ajustes from anon, authenticated;
grant all on finance.titulo_ajustes to service_role;

-- Reaplica o ajuste em qualquer INSERT/UPDATE da linha do Omie.
create or replace function finance.tg_titulo_ajuste_reaplica()
returns trigger language plpgsql security definer set search_path to 'finance', 'public' as $$
declare a finance.titulo_ajustes; d numeric; v numeric; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into a from finance.titulo_ajustes where empresa = new.empresa and cod_titulo = new.cod_titulo;
  if not found then return new; end if;
  if a.novo ? 'valor' then
    v := (a.novo->>'valor')::numeric;
    -- valor que chegou é o do Omie (ou o anterior ao ajuste): realinha o aberto pela diferença
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
  return new;
end $$;

drop trigger if exists tg_titulo_ajuste_reaplica on finance.pesquisa_titulos;
create trigger tg_titulo_ajuste_reaplica before insert or update on finance.pesquisa_titulos
  for each row execute function finance.tg_titulo_ajuste_reaplica();

-- Espelha a linha do Omie (já ajustada) na conta a receber de origem 'omie'
-- (o mesmo que conciliar_receber_omie faz no cron, só que na hora).
create or replace function finance._receber_espelhar(p_empresa text, p_cod bigint)
returns void language sql security definer set search_path to 'finance', 'public' as $$
  update finance.receber x set
    vencimento = p.dt_vencimento_d, previsao = p.dt_previsao_d, valor = coalesce(p.valor_titulo, 0),
    codigo_categoria = p.cod_categoria, codigo_projeto = p.cod_projeto, id_conta_corrente = p.cod_cc,
    observacao = p.observacao, numero_documento = p.num_titulo
  from finance.pesquisa_titulos p
  where x.origem = 'omie' and p.natureza = 'R' and p.empresa = x.empresa and p.cod_titulo = x.omie_codigo_lancamento
    and x.empresa = p_empresa and x.omie_codigo_lancamento = p_cod
$$;

-- Normaliza os campos aceitos para o ajuste de título do Omie.
create or replace function finance._ajuste_campos(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v)
   where k in ('valor', 'vencimento', 'cod_categoria', 'cod_cc', 'cod_projeto', 'observacao', 'documento')
$$;

create or replace function finance.titulo_ajustar(p_empresa text, p_cod bigint, p_campos jsonb, p_escopo text,
                                                   p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $$
declare t finance.pesquisa_titulos; x finance.pesquisa_titulos; c jsonb := finance._ajuste_campos(p_campos);
        cx jsonb; pago numeric; v numeric; n_alt int := 0; n_pul int := 0; antes jsonb;
begin
  if c = '{}'::jsonb then raise exception 'Nada para alterar'; end if;
  if coalesce(p_escopo, 'esta') not in ('esta', 'proximas') then raise exception 'Escopo inválido'; end if;
  select * into t from finance.pesquisa_titulos where empresa = p_empresa and cod_titulo = p_cod;
  if not found then raise exception 'Título do Omie não encontrado'; end if;
  if t.status not in ('A VENCER', 'VENCE HOJE', 'ATRASADO') then raise exception 'Só se ajusta título em aberto (está %)', t.status; end if;
  if c ? 'valor' and coalesce((c->>'valor')::numeric, 0) <= 0 then raise exception 'Valor tem de ser maior que zero'; end if;

  for x in
    select * from finance.pesquisa_titulos p
     where p.empresa = t.empresa and p.natureza = t.natureza
       and (p.cod_titulo = t.cod_titulo
            or (p_escopo = 'proximas' and t.cod_tit_repet is not null and p.cod_tit_repet = t.cod_tit_repet
                and p.dt_vencimento_d > t.dt_vencimento_d and p.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')))
     order by p.dt_vencimento_d
  loop
    cx := case when x.cod_titulo = t.cod_titulo then c else c - 'vencimento' end;
    if cx = '{}'::jsonb then continue; end if;
    if cx ? 'valor' then
      v := (cx->>'valor')::numeric;
      pago := coalesce(x.val_pago, 0) + coalesce((select sum(b.valor) from finance.baixas b
               where b.cod_titulo = x.cod_titulo and b.empresa = x.empresa and b.estornado_em is null), 0);
      if v < pago - 0.004 then
        if x.cod_titulo = t.cod_titulo then
          raise exception 'Valor (%) abaixo do que já foi pago (%)', to_char(v, 'FM999G999G990D00'), to_char(pago, 'FM999G999G990D00');
        end if;
        n_pul := n_pul + 1; continue;
      end if;
    end if;
    antes := jsonb_build_object('valor', x.valor_titulo, 'vencimento', x.dt_vencimento_d, 'previsao', x.dt_previsao_d,
              'cod_categoria', x.cod_categoria, 'cod_cc', x.cod_cc, 'cod_projeto', x.cod_projeto,
              'observacao', x.observacao, 'documento', x.num_titulo, 'status', x.status);
    insert into finance.titulo_ajustes (empresa, cod_titulo, natureza, orig, novo, motivo, criado_por, alterado_por)
    values (x.empresa, x.cod_titulo, x.natureza, antes, cx, nullif(trim(coalesce(p_motivo, '')), ''), p_usuario, p_usuario)
    on conflict (empresa, cod_titulo) do update
       set novo = finance.titulo_ajustes.novo || excluded.novo,
           motivo = coalesce(excluded.motivo, finance.titulo_ajustes.motivo),
           alterado_por = excluded.alterado_por, alterado_em = now();
    update finance.pesquisa_titulos set valor_titulo = valor_titulo where empresa = x.empresa and cod_titulo = x.cod_titulo;
    if x.natureza = 'R' then perform finance._receber_espelhar(x.empresa, x.cod_titulo); end if;
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, 'ajustar_titulo', case when x.natureza = 'P' then 'pagar' else 'receber' end, x.cod_titulo::text,
            jsonb_build_object('empresa', x.empresa, 'campos', cx, 'antes', antes, 'escopo', p_escopo,
                               'origem', t.cod_titulo, 'motivo', p_motivo));
    n_alt := n_alt + 1;
  end loop;
  return jsonb_build_object('ok', true, 'alterados', n_alt, 'pulados_pagos', n_pul);
end $$;

create or replace function finance.titulo_desfazer_ajuste(p_empresa text, p_cod bigint, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $$
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
    -- volta o status que o Omie tinha (se o título continua em aberto)
    status        = case when a.novo ? 'vencimento' and status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
                         and a.orig ? 'status' then a.orig->>'status' else status end,
    cod_categoria = case when a.novo ? 'cod_categoria' then a.orig->>'cod_categoria' else cod_categoria end,
    cod_cc        = case when a.novo ? 'cod_cc' then (a.orig->>'cod_cc')::bigint else cod_cc end,
    cod_projeto   = case when a.novo ? 'cod_projeto' then a.orig->>'cod_projeto' else cod_projeto end,
    observacao    = case when a.novo ? 'observacao' then a.orig->>'observacao' else observacao end,
    num_titulo    = case when a.novo ? 'documento' then a.orig->>'documento' else num_titulo end
  where empresa = p_empresa and cod_titulo = p_cod;
  if a.natureza = 'R' then perform finance._receber_espelhar(p_empresa, p_cod); end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'desfazer_ajuste_titulo', case when a.natureza = 'P' then 'pagar' else 'receber' end, p_cod::text,
          jsonb_build_object('empresa', p_empresa, 'orig', a.orig, 'novo', a.novo));
  return jsonb_build_object('ok', true);
end $$;

-- Conta a pagar do painel (manual ou previsão de PC). Previsão fica em pagar_reprogramar.
create or replace function finance.pagar_editar(p_id bigint, p_campos jsonb, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $$
declare r finance.pagar_previsto; c jsonb := coalesce(p_campos, '{}'::jsonb); v numeric; pago numeric; pc boolean;
begin
  select * into r from finance.pagar_previsto where id = p_id for update;
  if not found or r.status <> 'previsto' then raise exception 'Conta não encontrada ou já substituída/cancelada'; end if;
  pc := r.pedido_id is not null and coalesce(r.origem_titulo, '') <> 'manual';
  if pc and c ? 'fornecedor_cod' then raise exception 'Fornecedor de previsão de PC muda-se no pedido de compra'; end if;
  if c ? 'valor' then
    v := (c->>'valor')::numeric;
    if coalesce(v, 0) <= 0 then raise exception 'Valor tem de ser maior que zero'; end if;
    pago := greatest(coalesce(r.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b
              where b.pagar_id = r.id and b.estornado_em is null), 0));
    if v < pago - 0.004 then
      raise exception 'Valor (%) abaixo do que já foi pago (%)', to_char(v, 'FM999G999G990D00'), to_char(pago, 'FM999G999G990D00');
    end if;
    if pc and abs(v - r.valor) > 0.004 and length(trim(coalesce(p_motivo, ''))) < 5 then
      raise exception 'Previsão de PC: diga o motivo para mudar o valor (o total deixa de bater com o pedido)';
    end if;
  end if;
  update finance.pagar_previsto set
    valor          = coalesce((c->>'valor')::numeric, valor),
    vencimento     = coalesce((c->>'vencimento')::date, vencimento),
    categoria_cod  = case when c ? 'categoria_cod' then nullif(c->>'categoria_cod', '') else categoria_cod end,
    categoria_desc = case when c ? 'categoria_cod' then (select descricao from finance.categorias where empresa = r.empresa and codigo = c->>'categoria_cod' limit 1) else categoria_desc end,
    conta_cod      = case when c ? 'conta_cod' then nullif(c->>'conta_cod', '')::bigint else conta_cod end,
    conta_desc     = case when c ? 'conta_cod' then (select descricao from finance.contas_correntes where empresa = r.empresa and cod_cc = nullif(c->>'conta_cod', '')::bigint limit 1) else conta_desc end,
    projeto_cod    = case when c ? 'projeto_cod' then nullif(c->>'projeto_cod', '')::bigint else projeto_cod end,
    projeto_nome   = case when c ? 'projeto_cod' then (select nome from finance.projetos where empresa = r.empresa and codigo = nullif(c->>'projeto_cod', '')::bigint limit 1) else projeto_nome end,
    fornecedor_cod = case when c ? 'fornecedor_cod' then nullif(c->>'fornecedor_cod', '')::bigint else fornecedor_cod end,
    fornecedor_nome = case when c ? 'fornecedor_cod' then coalesce((select coalesce(nullif(nome_fantasia, ''), razao_social) from finance.clientes where empresa = r.empresa and codigo_cliente_omie = nullif(c->>'fornecedor_cod', '')::bigint limit 1), fornecedor_nome) else fornecedor_nome end,
    fornecedor_cnpj = case when c ? 'fornecedor_cod' then coalesce((select cnpj_cpf from finance.clientes where empresa = r.empresa and codigo_cliente_omie = nullif(c->>'fornecedor_cod', '')::bigint limit 1), fornecedor_cnpj) else fornecedor_cnpj end,
    documento      = case when c ? 'documento' then nullif(c->>'documento', '') else documento end,
    obs            = case when c ? 'obs' then nullif(c->>'obs', '') else obs end,
    extras         = case when pc and c ? 'valor' and abs((c->>'valor')::numeric - r.valor) > 0.004
                          then coalesce(extras, '{}'::jsonb) || jsonb_build_object('valor_ajustado',
                               jsonb_build_object('orig', coalesce(extras->'valor_ajustado'->'orig', to_jsonb(r.valor)), 'motivo', p_motivo, 'por', p_usuario, 'em', now()))
                          else extras end,
    updated_at     = now()
  where id = p_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'editar_conta', 'pagar', p_id::text,
          jsonb_build_object('campos', c, 'motivo', p_motivo, 'pc', pc,
                             'antes', jsonb_build_object('valor', r.valor, 'vencimento', r.vencimento, 'categoria_cod', r.categoria_cod,
                               'conta_cod', r.conta_cod, 'projeto_cod', r.projeto_cod, 'fornecedor_cod', r.fornecedor_cod,
                               'documento', r.documento, 'obs', r.obs)));
  return jsonb_build_object('ok', true);
end $$;

-- Conta a receber: do Omie → ajuste sobreposto; do painel → edita direto.
create or replace function finance.receber_editar(p_id uuid, p_campos jsonb, p_escopo text, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $$
declare r finance.receber; c jsonb := coalesce(p_campos, '{}'::jsonb); v numeric; pago numeric;
begin
  select * into r from finance.receber where id = p_id for update;
  if not found then raise exception 'Conta não encontrada'; end if;
  if r.origem = 'omie' and r.omie_codigo_lancamento is not null then
    return finance.titulo_ajustar(r.empresa, r.omie_codigo_lancamento,
      jsonb_strip_nulls(jsonb_build_object(
        'valor', c->'valor', 'vencimento', c->'vencimento', 'cod_categoria', c->'categoria_cod',
        'cod_cc', c->'conta_cod', 'cod_projeto', c->'projeto_cod', 'observacao', c->'obs', 'documento', c->'documento')),
      p_escopo, p_motivo, p_usuario);
  end if;
  if c ? 'valor' then
    v := (c->>'valor')::numeric;
    if coalesce(v, 0) <= 0 then raise exception 'Valor tem de ser maior que zero'; end if;
    pago := greatest(coalesce(r.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b
              where b.receber_id = r.id and b.estornado_em is null), 0));
    if v < pago - 0.004 then
      raise exception 'Valor (%) abaixo do que já foi recebido (%)', to_char(v, 'FM999G999G990D00'), to_char(pago, 'FM999G999G990D00');
    end if;
  end if;
  update finance.receber set
    valor               = coalesce((c->>'valor')::numeric, valor),
    vencimento          = coalesce((c->>'vencimento')::date, vencimento),
    codigo_categoria    = case when c ? 'categoria_cod' then nullif(c->>'categoria_cod', '') else codigo_categoria end,
    id_conta_corrente   = case when c ? 'conta_cod' then nullif(c->>'conta_cod', '')::bigint else id_conta_corrente end,
    codigo_projeto      = case when c ? 'projeto_cod' then nullif(c->>'projeto_cod', '') else codigo_projeto end,
    codigo_cliente_omie = case when c ? 'cliente_cod' then nullif(c->>'cliente_cod', '')::bigint else codigo_cliente_omie end,
    cliente_razao       = case when c ? 'cliente_cod' then coalesce((select razao_social from finance.clientes where empresa = r.empresa and codigo_cliente_omie = nullif(c->>'cliente_cod', '')::bigint limit 1), cliente_razao) else cliente_razao end,
    cliente_cnpj        = case when c ? 'cliente_cod' then coalesce((select cnpj_cpf from finance.clientes where empresa = r.empresa and codigo_cliente_omie = nullif(c->>'cliente_cod', '')::bigint limit 1), cliente_cnpj) else cliente_cnpj end,
    numero_documento    = case when c ? 'documento' then nullif(c->>'documento', '') else numero_documento end,
    observacao          = case when c ? 'obs' then nullif(c->>'obs', '') else observacao end
  where id = p_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'editar_conta', 'receber', p_id::text,
          jsonb_build_object('campos', c, 'motivo', p_motivo,
                             'antes', jsonb_build_object('valor', r.valor, 'vencimento', r.vencimento, 'categoria_cod', r.codigo_categoria,
                               'conta_cod', r.id_conta_corrente, 'projeto_cod', r.codigo_projeto, 'cliente_cod', r.codigo_cliente_omie,
                               'documento', r.numero_documento, 'obs', r.observacao)));
  return jsonb_build_object('ok', true, 'alterados', 1);
end $$;

-- ref → ajuste (para a tela mostrar "valor ajustado (orig. R$ X)").
create or replace function finance.titulo_ajustes_mapa(p_natureza text)
returns jsonb language sql stable security definer set search_path to 'finance', 'public' as $$
  select coalesce(jsonb_object_agg(ref, j), '{}'::jsonb) from (
    select case when p_natureza = 'P' then 'o:' || a.cod_titulo
                else 'r:' || (select x.id from finance.receber x where x.empresa = a.empresa and x.omie_codigo_lancamento = a.cod_titulo limit 1) end ref,
           jsonb_build_object('orig', a.orig, 'novo', a.novo, 'motivo', a.motivo, 'por', a.alterado_por, 'em', a.alterado_em,
                              'serie', (select p.cod_tit_repet from finance.pesquisa_titulos p where p.empresa = a.empresa and p.cod_titulo = a.cod_titulo)) j
      from finance.titulo_ajustes a where a.natureza = p_natureza
  ) z where ref is not null
$$;

revoke all on function finance.titulo_ajustar(text, bigint, jsonb, text, text, text),
                       finance.titulo_desfazer_ajuste(text, bigint, text),
                       finance.pagar_editar(bigint, jsonb, text, text),
                       finance.receber_editar(uuid, jsonb, text, text, text),
                       finance.titulo_ajustes_mapa(text),
                       finance._receber_espelhar(text, bigint)
  from public, anon, authenticated;
grant execute on function finance.titulo_ajustar(text, bigint, jsonb, text, text, text),
                          finance.titulo_desfazer_ajuste(text, bigint, text),
                          finance.pagar_editar(bigint, jsonb, text, text),
                          finance.receber_editar(uuid, jsonb, text, text, text),
                          finance.titulo_ajustes_mapa(text)
  to service_role;

-- Dados do título para o modal "Editar" (pagar 'o:'/'p:', receber 'r:').
create or replace function finance.titulo_para_editar(p_ref text)
returns jsonb language plpgsql stable security definer set search_path to 'finance', 'public' as $$
declare k text := split_part(p_ref, ':', 1); v text := split_part(p_ref, ':', 2); j jsonb;
        p finance.pesquisa_titulos; pp finance.pagar_previsto; rc finance.receber; a finance.titulo_ajustes;
begin
  if k = 'p' then
    select * into pp from finance.pagar_previsto where id = v::bigint and status = 'previsto';
    if not found then return null; end if;
    return jsonb_build_object('ref', p_ref, 'natureza', 'P', 'empresa', pp.empresa,
      'origem', case when pp.pedido_id is not null and coalesce(pp.origem_titulo, '') <> 'manual' then 'pc' else 'manual' end,
      'pc', pp.pedido_numero, 'valor', pp.valor,
      'pago', greatest(coalesce(pp.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b where b.pagar_id = pp.id and b.estornado_em is null), 0)),
      'vencimento', pp.vencimento, 'previsao', coalesce(pp.data_previsao, pp.vencimento),
      'categoria_cod', pp.categoria_cod, 'conta_cod', pp.conta_cod, 'projeto_cod', pp.projeto_cod,
      'contraparte_cod', pp.fornecedor_cod, 'contraparte_nome', pp.fornecedor_nome,
      'documento', pp.documento, 'obs', pp.obs,
      'serie', case when pp.serie_id is not null then jsonb_build_object('tipo', 'painel', 'id', pp.serie_id,
                 'proximas', (select count(*) from finance.pagar_previsto x where x.serie_id = pp.serie_id and x.status = 'previsto' and x.serie_seq > pp.serie_seq)) end,
      'ajuste', case when pp.extras ? 'valor_ajustado' then jsonb_build_object('orig', jsonb_build_object('valor', pp.extras->'valor_ajustado'->'orig'),
                 'motivo', pp.extras->'valor_ajustado'->>'motivo', 'por', pp.extras->'valor_ajustado'->>'por') end);
  end if;
  if k = 'r' then
    select * into rc from finance.receber where id = v::uuid;
    if not found then return null; end if;
    if rc.origem <> 'omie' or rc.omie_codigo_lancamento is null then
      return jsonb_build_object('ref', p_ref, 'natureza', 'R', 'empresa', rc.empresa, 'origem', 'manual',
        'valor', rc.valor,
        'pago', greatest(coalesce(rc.valor_pago, 0), coalesce((select sum(b.valor) from finance.baixas b where b.receber_id = rc.id and b.estornado_em is null), 0)),
        'vencimento', rc.vencimento, 'previsao', coalesce(rc.previsao, rc.vencimento),
        'categoria_cod', rc.codigo_categoria, 'conta_cod', rc.id_conta_corrente, 'projeto_cod', rc.codigo_projeto,
        'contraparte_cod', rc.codigo_cliente_omie, 'contraparte_nome', rc.cliente_razao,
        'documento', rc.numero_documento, 'obs', rc.observacao,
        'serie', case when rc.serie_id is not null then jsonb_build_object('tipo', 'painel', 'id', rc.serie_id,
                   'proximas', (select count(*) from finance.receber x where x.serie_id = rc.serie_id and x.serie_seq > rc.serie_seq)) end);
    end if;
    select * into p from finance.pesquisa_titulos where empresa = rc.empresa and cod_titulo = rc.omie_codigo_lancamento;
  elsif k = 'o' then
    select * into p from finance.pesquisa_titulos where cod_titulo = v::bigint and natureza = 'P' limit 1;
  else
    return null;
  end if;
  if p.cod_titulo is null then return null; end if;
  select * into a from finance.titulo_ajustes where empresa = p.empresa and cod_titulo = p.cod_titulo;
  return jsonb_build_object('ref', p_ref, 'natureza', p.natureza, 'empresa', p.empresa, 'origem', 'omie', 'cod_titulo', p.cod_titulo,
    'valor', p.valor_titulo,
    'pago', coalesce(p.val_pago, 0) + coalesce((select sum(b.valor) from finance.baixas b where b.cod_titulo = p.cod_titulo and b.empresa = p.empresa and b.estornado_em is null), 0),
    'vencimento', p.dt_vencimento_d, 'previsao', coalesce((select o.dt_previsao_nova from finance.previsao_override o where o.cod_titulo = p.cod_titulo), p.dt_previsao_d),
    'categoria_cod', p.cod_categoria, 'conta_cod', p.cod_cc, 'projeto_cod', p.cod_projeto,
    'contraparte_cod', p.cod_cliente, 'contraparte_nome', (select coalesce(nullif(c.nome_fantasia, ''), c.razao_social) from finance.clientes c where c.empresa = p.empresa and c.codigo_cliente_omie = p.cod_cliente limit 1),
    'documento', coalesce(nullif(p.num_doc_fiscal, ''), p.num_titulo), 'obs', p.observacao, 'aberto', p.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO'),
    'serie', case when p.cod_tit_repet is not null and p.cod_tit_repet <> 0 then jsonb_build_object('tipo', 'omie', 'id', p.cod_tit_repet,
               'proximas', (select count(*) from finance.pesquisa_titulos x where x.empresa = p.empresa and x.cod_tit_repet = p.cod_tit_repet
                              and x.dt_vencimento_d > p.dt_vencimento_d and x.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO'))) end,
    'ajuste', case when a.cod_titulo is not null then jsonb_build_object('orig', a.orig, 'novo', a.novo, 'motivo', a.motivo, 'por', a.alterado_por, 'em', a.alterado_em) end);
end $$;
revoke all on function finance.titulo_para_editar(text) from public, anon, authenticated;
grant execute on function finance.titulo_para_editar(text) to service_role;
