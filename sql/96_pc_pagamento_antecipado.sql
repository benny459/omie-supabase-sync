-- 06/10/26 — Pagamento antecipado de PC (pedido do Benny).
-- O financeiro lança, a partir do PC, um título a pagar "antecipado" (Pix/depósito)
-- ligado ao pedido. É um título manual do painel (finance.pagar_manual_incluir):
-- aparece no Contas a Pagar, na remessa C6, no BI/fluxo e baixa pela conciliação.
-- Para não pagar duas vezes, as previsões do PC (parcelas ou NF) são abatidas pelo
-- valor já adiantado: a parcela coberta inteira fica 'coberto' (sai das telas/fluxo),
-- a parcial fica com o saldo (total − adiantado).

alter table finance.pagar_previsto add column if not exists antecipa_pedido_id bigint;
create index if not exists pagar_previsto_antecipa_idx on finance.pagar_previsto (antecipa_pedido_id) where antecipa_pedido_id is not null;

alter table finance.pagar_previsto drop constraint if exists pagar_previsto_status_check;
alter table finance.pagar_previsto add constraint pagar_previsto_status_check
  check (status = any (array['previsto', 'substituido', 'cancelado', 'coberto']));

-- Previsões do PC, agora abatidas pelos adiantamentos.
create or replace function compras.gerar_previsoes(p_id bigint)
 returns integer language plpgsql security definer set search_path to 'compras', 'public'
as $function$
declare v compras.pedidos; n int := 0; v_tot int; f record; v_parc jsonb; v_origem text := 'pc';
        v_adi numeric; v_rest numeric; r record;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found or not (v.origem = 'painel' or v.editado_no_painel) or v.tipo <> 'PC' then
    delete from finance.pagar_previsto where pedido_id = p_id and status in ('previsto', 'coberto');
    return 0;
  end if;
  if v.cancelado then
    update finance.pagar_previsto set status = 'cancelado', updated_at = now() where pedido_id = p_id and status in ('previsto', 'coberto');
    return 0;
  end if;
  if v.aprov_status <> 'aprovado' then
    delete from finance.pagar_previsto where pedido_id = p_id and status in ('previsto', 'coberto');
    return 0;
  end if;
  select * into f from compras.fase_pagar(p_id);

  if exists (select 1 from finance.pagar_previsto where pedido_id = p_id and status = 'substituido') then
    update finance.pagar_previsto set fase = f.fase, parcial = f.parcial,
           valor_liberado = case when f.fase = 'liberado' then round(valor * f.prop, 2) end, updated_at = now()
     where pedido_id = p_id and status in ('substituido', 'previsto');
    return 0;
  end if;

  if f.tem_nf and exists (select 1 from compras.nf_vinculos where pedido_id = p_id and status = 'confirmado') then
    select jsonb_agg(x order by x->>'venc', x->>'nf') into v_parc from (
      select jsonb_build_object('venc', coalesce(nullif(d->>'data_vencimento', '')::date,
                                                 (select min(vencimento) from compras.parcelas where pedido_id = p_id),
                                                 (fr.emissao at time zone 'America/Sao_Paulo')::date),
                                'valor', coalesce(nullif(d->>'valor', '')::numeric, fr.valor),
                                'nf', coalesce(nullif(ltrim(fr.numero, '0'), ''), substr(fr.chave, 26, 9)), 'chave', fr.chave) as x
        from compras.nf_vinculos nv
        join orders.focus_recebidos fr on fr.tipo = 'nfe' and fr.chave = nv.chave
        cross join lateral jsonb_array_elements(
          case when jsonb_array_length(coalesce(fr.detalhe->'requisicao_nota_fiscal'->'duplicatas', '[]'::jsonb)) > 0
               then fr.detalhe->'requisicao_nota_fiscal'->'duplicatas' else '[{}]'::jsonb end) d
       where nv.pedido_id = p_id and nv.status = 'confirmado') z;
    v_origem := 'nf';
  end if;
  if v_parc is null then
    select jsonb_agg(jsonb_build_object('venc', x.vencimento, 'valor', x.valor, 'doc', x.tipo_doc, 'nf', nullif(v.nf, '')) order by x.n)
      into v_parc from compras.parcelas x where x.pedido_id = p_id;
    v_origem := 'pc';
  end if;
  v_tot := coalesce(jsonb_array_length(v_parc), 0);
  delete from finance.pagar_previsto where pedido_id = p_id and parcela_n > v_tot and status in ('previsto', 'coberto');
  if v_tot = 0 then return 0; end if;

  insert into finance.pagar_previsto as pp (empresa, pedido_id, pedido_numero, parcela_n, parcelas_total, vencimento, valor,
    tipo_doc, fornecedor_cod, fornecedor_nome, fornecedor_cnpj, categoria_cod, categoria_desc, projeto_cod, projeto_nome,
    conta_cod, conta_desc, status, fase, parcial, valor_liberado, nf_numero, nf_chave, origem_parcelas, updated_at)
  select v.empresa, v.id, v.numero, k::int, v_tot, (x->>'venc')::date, (x->>'valor')::numeric, coalesce(x->>'doc', 'Boleto'),
         v.fornecedor_cod, v.fornecedor_nome, v.fornecedor_cnpj, v.categoria_cod, v.categoria_desc, v.projeto_cod, v.projeto_nome,
         v.conta_cod, v.conta_desc, 'previsto', f.fase, f.parcial,
         case when f.fase = 'liberado' then round((x->>'valor')::numeric * f.prop, 2) end,
         x->>'nf', x->>'chave', v_origem, now()
    from jsonb_array_elements(v_parc) with ordinality t(x, k)
  on conflict (pedido_id, parcela_n) do update set
    pedido_numero = excluded.pedido_numero, parcelas_total = excluded.parcelas_total, vencimento = excluded.vencimento,
    valor = excluded.valor, tipo_doc = excluded.tipo_doc, fornecedor_cod = excluded.fornecedor_cod,
    fornecedor_nome = excluded.fornecedor_nome, fornecedor_cnpj = excluded.fornecedor_cnpj,
    categoria_cod = excluded.categoria_cod, categoria_desc = excluded.categoria_desc, projeto_cod = excluded.projeto_cod,
    projeto_nome = excluded.projeto_nome, conta_cod = excluded.conta_cod, conta_desc = excluded.conta_desc,
    status = 'previsto', fase = excluded.fase, parcial = excluded.parcial, valor_liberado = excluded.valor_liberado,
    nf_numero = excluded.nf_numero, nf_chave = excluded.nf_chave, origem_parcelas = excluded.origem_parcelas, updated_at = now()
  where pp.status <> 'substituido';
  get diagnostics n = row_count;

  -- Abatimento do pagamento antecipado (06/10/26): o que já foi adiantado cobre as
  -- primeiras parcelas; o resto fica previsto com o saldo.
  update finance.pagar_previsto set extras = nullif(coalesce(extras, '{}'::jsonb) - 'valor_original' - 'coberto_por_antecipacao', '{}'::jsonb)
   where pedido_id = p_id and status = 'previsto' and extras ?| array['valor_original', 'coberto_por_antecipacao'];
  select coalesce(sum(valor), 0) into v_adi from finance.pagar_previsto where antecipa_pedido_id = p_id and status <> 'cancelado';
  if v_adi > 0 then
    v_rest := v_adi;
    for r in select id, valor, valor_liberado from finance.pagar_previsto
              where pedido_id = p_id and status = 'previsto' order by parcela_n loop
      exit when v_rest <= 0;
      if r.valor <= v_rest then
        update finance.pagar_previsto set status = 'coberto', updated_at = now(),
               extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('valor_original', r.valor, 'coberto_por_antecipacao', r.valor)
         where id = r.id;
        v_rest := v_rest - r.valor;
      else
        update finance.pagar_previsto set valor = round(r.valor - v_rest, 2), updated_at = now(),
               valor_liberado = case when r.valor_liberado is not null then least(r.valor_liberado, round(r.valor - v_rest, 2)) end,
               extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('valor_original', r.valor, 'coberto_por_antecipacao', v_rest)
         where id = r.id;
        v_rest := 0;
      end if;
    end loop;
  end if;
  return n;
end $function$;

-- Mudou um adiantamento (criado, valor alterado, cancelado ou excluído) → recalcula as previsões do PC.
create or replace function finance.tg_antecipado_recalcula() returns trigger
language plpgsql security definer set search_path to 'finance', 'public' as $$
begin
  if tg_op = 'DELETE' then perform compras.gerar_previsoes(old.antecipa_pedido_id); return null; end if;
  if tg_op = 'UPDATE' and old.antecipa_pedido_id is not null and old.antecipa_pedido_id is distinct from new.antecipa_pedido_id then
    perform compras.gerar_previsoes(old.antecipa_pedido_id);
  end if;
  if new.antecipa_pedido_id is not null then perform compras.gerar_previsoes(new.antecipa_pedido_id); end if;
  return null;
end $$;
drop trigger if exists antecipado_recalcula on finance.pagar_previsto;
drop trigger if exists antecipado_recalcula_ins on finance.pagar_previsto;
drop trigger if exists antecipado_recalcula_upd on finance.pagar_previsto;
drop trigger if exists antecipado_recalcula_del on finance.pagar_previsto;
create trigger antecipado_recalcula_ins after insert on finance.pagar_previsto
  for each row when (new.antecipa_pedido_id is not null) execute function finance.tg_antecipado_recalcula();
create trigger antecipado_recalcula_upd after update of status, valor, antecipa_pedido_id on finance.pagar_previsto
  for each row when (coalesce(new.antecipa_pedido_id, old.antecipa_pedido_id) is not null) execute function finance.tg_antecipado_recalcula();
create trigger antecipado_recalcula_del after delete on finance.pagar_previsto
  for each row when (old.antecipa_pedido_id is not null) execute function finance.tg_antecipado_recalcula();

-- Lança o pagamento antecipado de um PC.
-- p: { pedido_id, valor, data (YYYY-MM-DD), forma ('PIX'|'TED'), conta_cod, categoria_cod?, obs?,
--      pix_tipo?, pix_chave?, banco_compe?, agencia?, conta?, forcar? }
create or replace function compras.antecipar_pc(p jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'compras', 'public' as $$
declare v compras.pedidos; v_valor numeric := round(nullif(p->>'valor', '')::numeric, 2); v_data date := nullif(p->>'data', '')::date;
        v_ja numeric; v_n int; v_doc text; v_forma text := upper(coalesce(nullif(p->>'forma', ''), 'PIX')); r jsonb; v_tid bigint;
begin
  select * into v from compras.pedidos where id = (p->>'pedido_id')::bigint;
  if not found or v.tipo <> 'PC' then raise exception 'Pedido de compra não encontrado'; end if;
  if v.cancelado then raise exception 'PC % está cancelado', v.numero; end if;
  if coalesce(v.aprov_status, '') <> 'aprovado' and coalesce((p->>'forcar')::boolean, false) is not true then
    raise exception 'PC % ainda não está aprovado — aprove antes de antecipar o pagamento', v.numero;
  end if;
  if v.fornecedor_cod is null then raise exception 'PC % sem fornecedor cadastrado', v.numero; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor do adiantamento'; end if;
  if v_data is null then raise exception 'Informe a data do pagamento'; end if;
  if v_forma not in ('PIX', 'TED') then raise exception 'Forma deve ser PIX ou TED/depósito'; end if;
  select coalesce(sum(valor), 0), count(*) into v_ja, v_n from finance.pagar_previsto where antecipa_pedido_id = v.id and status <> 'cancelado';
  if v_ja + v_valor > coalesce(v.valor_total, 0) + 0.01 then
    raise exception 'Adiantamento passa do valor do PC (PC R$ %, já adiantado R$ %)', v.valor_total, v_ja;
  end if;
  v_doc := 'PC ' || v.numero || '-ANT' || case when v_n > 0 then '-' || (v_n + 1) else '' end;

  r := finance.pagar_manual_incluir(jsonb_build_object(
    'empresa', v.empresa, 'fornecedor_cod', v.fornecedor_cod, 'valor', v_valor, 'vencimento', v_data, 'previsao', v_data,
    'categoria_cod', coalesce(nullif(p->>'categoria_cod', ''), v.categoria_cod),
    'conta_cod', coalesce(nullif(p->>'conta_cod', '')::bigint, v.conta_cod),
    'projeto_cod', v.projeto_cod, 'tipo_doc', v_forma, 'documento', v_doc,
    'obs', concat_ws(' · ', 'Pagamento antecipado do PC ' || v.numero, nullif(p->>'obs', '')),
    'extras', jsonb_strip_nulls(jsonb_build_object('antecipado', true, 'pedido_id', v.id, 'pedido_numero', v.numero,
      'numero_pedido', v.numero, 'forma', v_forma, 'pix_tipo', nullif(p->>'pix_tipo', ''), 'pix_chave', nullif(p->>'pix_chave', ''),
      'banco_compe', nullif(p->>'banco_compe', ''), 'agencia', nullif(p->>'agencia', ''), 'conta', nullif(p->>'conta', ''),
      'pv_os', nullif(coalesce(v.pv_os_painel, v.pv_os), '')))), p_usuario);
  v_tid := (r->>'id')::bigint;
  update finance.pagar_previsto set antecipa_pedido_id = v.id, pedido_numero = v.numero where id = v_tid;  -- dispara o recálculo das previsões
  insert into compras.historico (pedido_id, texto, por)
  values (v.id, format('Pagamento antecipado de R$ %s lançado (%s, título %s, %s em %s)',
                       to_char(v_valor, 'FM999G999G990D00'), v_doc, v_tid, v_forma, to_char(v_data, 'DD/MM/YYYY')), p_usuario);
  return jsonb_build_object('ok', true, 'titulo_id', v_tid, 'documento', v_doc, 'ja_adiantado', v_ja + v_valor, 'total_pc', v.valor_total);
end $$;

-- Antecipações por PC (para o selo do cartão e o diálogo).
create or replace function compras.antecipados(p_ids bigint[] default null)
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $$
  select coalesce(jsonb_object_agg(pid, x), '{}'::jsonb) from (
    select pp.antecipa_pedido_id pid, jsonb_build_object(
             'valor', sum(pp.valor), 'qtd', count(*),
             'pago', bool_and(coalesce(vp.quitado, false) or coalesce(vp.val_aberto, pp.valor) <= 0.01),
             'titulos', jsonb_agg(jsonb_build_object('id', pp.id, 'documento', pp.documento, 'valor', pp.valor, 'vencimento', pp.vencimento,
                                  'pago', coalesce(vp.quitado, false) or coalesce(vp.val_aberto, pp.valor) <= 0.01) order by pp.id)) x
      from finance.pagar_previsto pp
      left join finance.v_pagar_previsto vp on vp.pagar_id = pp.id
     where pp.antecipa_pedido_id is not null and pp.status <> 'cancelado'
       and (p_ids is null or pp.antecipa_pedido_id = any(p_ids))
     group by 1) z
$$;

-- Wrappers no schema exposto (compras não está no PostgREST).
create or replace function orders.compras_antecipar(p jsonb, p_usuario text) returns jsonb
  language sql security definer set search_path to 'orders', 'public' as $$ select compras.antecipar_pc(p, p_usuario) $$;
create or replace function orders.compras_antecipados(p_ids bigint[] default null) returns jsonb
  language sql stable security definer set search_path to 'orders', 'public' as $$ select compras.antecipados(p_ids) $$;
revoke all on function compras.antecipar_pc(jsonb, text), compras.antecipados(bigint[]),
  orders.compras_antecipar(jsonb, text), orders.compras_antecipados(bigint[]) from public, anon, authenticated;
grant execute on function orders.compras_antecipar(jsonb, text), orders.compras_antecipados(bigint[]) to service_role;
