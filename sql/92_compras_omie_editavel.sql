-- 92 · PC/RC vindos do Omie passam a ser editáveis no painel (06/10/26)
--
-- Decisão do Benny: o Omie não é mais usado; os pedidos que vieram de lá são
-- nossos e podem ser corrigidos aqui (nada volta ao Omie).
--
-- 1) compras.pedidos ganha editado_no_painel / editado_em / editado_por.
-- 2) orders.compras_salvar deixa de recusar origem='omie': grava, marca
--    editado_no_painel e registra o antes/depois no histórico.
-- 3) compras.espelhar_omie(id): reescreve o espelho bruto do Omie
--    (orders.pedidos_compra) com os valores editados — todas as telas que leem
--    o espelho (Operação/aprovação, BI, catálogo de compras) passam a ver a
--    edição sem mexer em cada view.
-- 4) Proteção: gatilho em orders.pedidos_compra ignora qualquer escrita de
--    importação (upsert/delete do Omie, "sincronizar PC", workflows) nas linhas
--    de um pedido editado no painel. Só compras.espelhar_omie escreve nelas.
--    compras.conciliar_omie também pula os editados.
-- 5) Contas a pagar previsto: PC do Omie editado segue o mesmo caminho do PC
--    nativo (compras.gerar_previsoes). Se já houver título do Omie com a mesma
--    NF, a previsão é marcada "substituída" (compras.conciliar_previsoes), sem
--    duplicar.

alter table compras.pedidos
  add column if not exists editado_no_painel boolean not null default false,
  add column if not exists editado_em timestamptz,
  add column if not exists editado_por text;
create index if not exists pedidos_omie_editado_idx on compras.pedidos (empresa, omie_ncod_ped) where editado_no_painel;

-- 3) espelho bruto ← pedido editado
create or replace function compras.espelhar_omie(p_id bigint) returns integer
language plpgsql security definer set search_path to 'compras', 'public' as $$
declare v compras.pedidos; n int; v_frete numeric; v_seguro numeric; v_outras numeric;
begin
  select * into v from compras.pedidos where id = p_id;
  if not found or v.origem <> 'omie' or v.omie_ncod_ped is null then return 0; end if;
  perform set_config('compras.espelho_painel', '1', true);
  v_frete := nullif(v.frete->>'valor', '')::numeric;
  v_seguro := nullif(v.frete->>'seguro', '')::numeric;
  v_outras := nullif(v.frete->>'outras', '')::numeric;

  create temp table if not exists _pc_old (like orders.pedidos_compra) on commit drop;
  delete from _pc_old;
  insert into _pc_old select * from orders.pedidos_compra where empresa = v.empresa and ncod_ped = v.omie_ncod_ped;
  delete from orders.pedidos_compra where empresa = v.empresa and ncod_ped = v.omie_ncod_ped;

  insert into orders.pedidos_compra
  select (jsonb_populate_record(null::orders.pedidos_compra,
           coalesce(to_jsonb(o), to_jsonb(h), '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'empresa', v.empresa, 'ncod_ped', v.omie_ncod_ped,
             'cnumero', regexp_replace(v.numero, '-OMIE$', ''),
             'ccod_categ', v.categoria_cod, 'ncod_for', v.fornecedor_cod, 'ccontato', v.contato,
             'ccod_parc', v.parcela_cod, 'ddt_previsao', to_char(v.previsao, 'DD/MM/YYYY'),
             'ncod_cc', v.conta_cod, 'ncod_compr', v.comprador_cod, 'ncod_proj', v.projeto_cod,
             'cnum_pedido', v.num_pedido_fornecedor, 'ccontrato', v.contrato, 'cobs', v.obs, 'cobs_int', v.obs_int,
             'ntotal_pedido', v.valor_total,
             'ncod_item', coalesce(i.omie_ncod_item, -i.id), 'ncod_prod', i.ncod_prod,
             'cproduto', i.produto_cod, 'cdescricao', i.descricao, 'cunidade', i.unidade,
             'nqtde', i.qtd, 'nval_unit', i.valor_unit, 'ndesconto', i.desconto,
             'nvalor_ipi', i.ipi, 'nvalor_st', i.st, 'cncm', i.ncm, 'loc_estoque', i.local_estoque,
             'nval_merc', round(i.qtd * i.valor_unit, 2),
             'nval_tot', round(i.qtd * i.valor_unit - coalesce(i.desconto, 0) + coalesce(i.ipi, 0) + coalesce(i.st, 0), 2),
             'synced_at', now()))
           || jsonb_build_object(
             'nfrete', case when i.seq = 1 then coalesce(v_frete, 0) else 0 end,
             'nseguro', case when i.seq = 1 then coalesce(v_seguro, 0) else 0 end,
             'ndespesas', case when i.seq = 1 then coalesce(v_outras, 0) else 0 end))).*
    from compras.itens i
    left join _pc_old o on o.ncod_item = i.omie_ncod_item
    left join lateral (select * from _pc_old limit 1) h on true
   where i.pedido_id = p_id
   order by i.seq;
  get diagnostics n = row_count;
  perform set_config('compras.espelho_painel', '', true);
  return n;
end $$;

-- 4) proteção do espelho
create or replace function compras.tg_espelho_protegido() returns trigger
language plpgsql security definer set search_path to 'compras', 'public' as $$
declare r record;
begin
  if coalesce(current_setting('compras.espelho_painel', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  if exists (select 1 from compras.pedidos p
              where p.editado_no_painel and p.empresa = r.empresa and p.omie_ncod_ped = r.ncod_ped) then
    return null;  -- importação do Omie não sobrescreve pedido editado no painel
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists espelho_protegido on orders.pedidos_compra;
create trigger espelho_protegido before insert or update or delete on orders.pedidos_compra
  for each row execute function compras.tg_espelho_protegido();

-- 2) + 5) + guardas: remendos textuais idempotentes nas funções existentes
do $$
declare d text; a text; b text;
begin
  -- compras_salvar: aceita origem='omie', marca e registra antes/depois, reespelha
  d := pg_get_functiondef('orders.compras_salvar'::regproc);
  if position('editado_no_painel' in d) = 0 then
    a := $x$    if v_ped.origem <> 'painel' then
      raise exception 'Pedido importado do Omie (histórico): só leitura';
    end if;$x$;
    b := $x$    if v_ped.origem = 'omie' then
      perform compras.add_hist(v_id, 'Editado no painel (veio do Omie) · antes: '
        || coalesce(v_ped.fornecedor_nome, 'sem fornecedor') || ' · R$ ' || to_char(coalesce(v_ped.valor_total, 0), 'FM999G999G990D00')
        || ' · previsão ' || coalesce(to_char(v_ped.previsao, 'DD/MM/YYYY'), '—')
        || ' · ' || (select count(*) from compras.itens where pedido_id = v_id) || ' item(ns)', p_por);
    elsif v_ped.origem <> 'painel' then
      raise exception 'Pedido de origem % não pode ser editado', v_ped.origem;
    end if;$x$;
    if position(a in d) = 0 then raise exception 'compras_salvar: trecho da trava não encontrado'; end if;
    d := replace(d, a, b);
    a := $x$  return jsonb_build_object('id', v_id, 'num', (select numero from compras.pedidos where id = v_id));$x$;
    b := $x$  if not v_novo and v_ped.origem = 'omie' then
    update compras.pedidos set editado_no_painel = true, editado_em = now(), editado_por = p_por where id = v_id;
    select * into v_atual from compras.pedidos where id = v_id;
    perform compras.add_hist(v_id, 'Depois: ' || coalesce(v_atual.fornecedor_nome, 'sem fornecedor')
      || ' · R$ ' || to_char(coalesce(v_atual.valor_total, 0), 'FM999G999G990D00')
      || ' · previsão ' || coalesce(to_char(v_atual.previsao, 'DD/MM/YYYY'), '—')
      || ' · ' || (select count(*) from compras.itens where pedido_id = v_id) || ' item(ns)', p_por);
    perform compras.espelhar_omie(v_id);
  end if;
  return jsonb_build_object('id', v_id, 'num', (select numero from compras.pedidos where id = v_id));$x$;
    if position(a in d) = 0 then raise exception 'compras_salvar: return não encontrado'; end if;
    d := replace(d, a, b);
    execute d;
  end if;

  -- conciliar_omie: pula pedidos editados no painel
  d := pg_get_functiondef('compras.conciliar_omie'::regproc);
  if position('editado_no_painel' in d) = 0 then
    a := $x$    where p.origem = 'omie'
      and (p.tipo, p.numero$x$;
    if position(a in d) = 0 then raise exception 'conciliar_omie: upsert não encontrado'; end if;
    d := replace(d, a, $x$    where p.origem = 'omie' and not p.editado_no_painel
      and (p.tipo, p.numero$x$);
    a := $x$p.omie_ncod_ped = c.ncod_ped and p.origem = 'omie'
     where c.ncod_item is not null$x$;
    if position(a in d) = 0 then raise exception 'conciliar_omie: itens não encontrado'; end if;
    d := replace(d, a, $x$p.omie_ncod_ped = c.ncod_ped and p.origem = 'omie' and not p.editado_no_painel
     where c.ncod_item is not null$x$);
    a := $x$where i.pedido_id = p.id and p.origem = 'omie' and i.omie_ncod_item is not null$x$;
    if position(a in d) = 0 then raise exception 'conciliar_omie: delete não encontrado'; end if;
    d := replace(d, a, $x$where i.pedido_id = p.id and p.origem = 'omie' and not p.editado_no_painel and i.omie_ncod_item is not null$x$);
    a := $x$where p.origem = 'omie' and not p.omie_ausente$x$;
    if position(a in d) = 0 then raise exception 'conciliar_omie: ausente não encontrado'; end if;
    d := replace(d, a, $x$where p.origem = 'omie' and not p.omie_ausente and not p.editado_no_painel$x$);
    execute d;
  end if;

  -- gerar_previsoes: PC do Omie editado segue o caminho do nativo
  d := pg_get_functiondef('compras.gerar_previsoes'::regproc);
  if position('editado_no_painel' in d) = 0 then
    a := $x$if not found or v.origem <> 'painel' or v.tipo <> 'PC' then$x$;
    if position(a in d) = 0 then raise exception 'gerar_previsoes: guarda não encontrada'; end if;
    d := replace(d, a, $x$if not found or not (v.origem = 'painel' or v.editado_no_painel) or v.tipo <> 'PC' then$x$);
    execute d;
  end if;
  d := pg_get_functiondef('compras.atualizar_pagar'::regproc);
  if position('editado_no_painel' in d) = 0 then
    a := $x$where p.origem = 'painel' and p.tipo = 'PC'$x$;
    if position(a in d) = 0 then raise exception 'atualizar_pagar: filtro não encontrado'; end if;
    d := replace(d, a, $x$where (p.origem = 'painel' or p.editado_no_painel) and p.tipo = 'PC'$x$);
    execute d;
  end if;

  -- folha e cartão mostram "editado no painel"
  d := pg_get_functiondef('orders.compras_pedido'::regproc);
  if position('editadoPainel' in d) = 0 then
    a := $x$'origem', p.origem, 'ncodPed', p.omie_ncod_ped,$x$;
    if position(a in d) = 0 then raise exception 'compras_pedido: origem não encontrado'; end if;
    d := replace(d, a, $x$'origem', p.origem, 'ncodPed', p.omie_ncod_ped, 'editadoPainel', p.editado_no_painel, 'editadoEm', p.editado_em, 'editadoPor', p.editado_por,$x$);
    execute d;
  end if;
end $$;

-- p92b: valores do histórico no formato brasileiro (1009,49)
do $$
declare d text;
begin
  d := pg_get_functiondef('orders.compras_salvar'::regproc);
  d := replace(d, $x$to_char(coalesce(v_ped.valor_total, 0), 'FM999G999G990D00')$x$, $x$replace(to_char(coalesce(v_ped.valor_total, 0), 'FM999999990.00'), '.', ',')$x$);
  d := replace(d, $x$to_char(coalesce(v_atual.valor_total, 0), 'FM999G999G990D00')$x$, $x$replace(to_char(coalesce(v_atual.valor_total, 0), 'FM999999990.00'), '.', ',')$x$);
  execute d;
end $$;
