-- 146 · Cancelar pedido de compra DE VERDADE e Devolver material (08/10/26, pedido do Benny)
--
-- Até aqui "Cancelar pedido" na Operação › Projetos só gravava um rótulo de aprovação
-- (approval.approvals.status = CANCELAR_PEDIDO): o PC continuava na tabela, no
-- comprometido, na barra de budget, na margem real, no fluxo de caixa e ligado às
-- linhas da Lista de materiais. Agora:
--
-- CANCELAR (orders.compras_pc_cancelar)
--   · PC nascido no painel (compras.pedidos.origem = 'painel'): cancelado = true pelo
--     mesmo caminho do Compras (compras_cancelar) + histórico com o motivo.
--   · PC do Omie: o painel NUNCA escreve no Omie. Marca-se como cancelado no painel —
--     o mesmo mecanismo do "Excluir PC" (platform.excluded_pc), com tipo = 'cancelado' —
--     e o histórico do pedido avisa que é preciso cancelar também no Omie.
--   · Nos dois casos entra uma linha em platform.excluded_pc (tipo 'cancelado'): todas as
--     telas que já escondem PC excluído (lista de Projetos/Avulsos, comprometido, budget,
--     fluxo de caixa, regra de aprovação) passam a ignorá-lo sem mudar nada nelas.
--   · Linhas da Lista de materiais ligadas ao PC voltam a "sem PC" (vínculo direto pelo
--     item, pelo nº do PC ou pela RC) e ganham um comentário com o motivo — dá para gerar
--     um PC novo para elas pelos caminhos de sempre.
--   · Rastro em compras.pc_cancelamento (quem, quando, motivo, valor, linhas liberadas).
--     "Desfazer cancelamento" (só admin, na rota) volta tudo e religa as linhas que
--     continuam livres.
--
-- DEVOLVER MATERIAL (orders.compras_devolucao_registrar)
--   · O PC continua ATIVO. compras.devolucao (+ itens) guarda itens e quantidades
--     devolvidos, motivo e, se houver, a NF de devolução (nº/data). Situação do PC passa
--     a "Devolução" (total ou parcial).
--   · O valor devolvido sai da conta do projeto (comprometido, budget, margem, fluxo) —
--     o desconto é aplicado no servidor (lib/pc-ajustes.ts) a partir de
--     orders.compras_pcs_ajustes.
--   · Linhas da lista ligadas aos itens devolvidos voltam a "sem PC" pela quantidade
--     devolvida: quantidade inteira → a linha é desligada; parte → a linha fica com o que
--     ficou e nasce uma linha irmã "· repor (devolução PC n)" com a quantidade devolvida,
--     sem PC (a lista não aceita duas linhas com o mesmo item no mesmo equipamento).
--
-- Tudo security definer, execução só pelo service_role (rotas /api/pcs/ajuste).
-- Toda função que grava aceita p_simular: faz o trabalho e desfaz no fim (subtransação),
-- devolvendo o que teria acontecido — é o "dry-run" usado para conferir sem gravar.
-- Nada aqui chama o Omie.

-- ── PC escondido × PC cancelado ─────────────────────────────────────────────
alter table platform.excluded_pc add column if not exists tipo text not null default 'escondido';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'excluded_pc_tipo_chk') then
    alter table platform.excluded_pc add constraint excluded_pc_tipo_chk check (tipo in ('escondido', 'cancelado'));
  end if;
end $$;
comment on column platform.excluded_pc.tipo is
  'escondido = "Excluir PC" (volta pelo menu PCs escondidos) · cancelado = Cancelar pedido (volta só por "Desfazer cancelamento", admin; rastro em compras.pc_cancelamento)';

-- ── Rastro do cancelamento ──────────────────────────────────────────────────
create table if not exists compras.pc_cancelamento (
  id             bigserial primary key,
  empresa        text not null,
  numero         text not null,
  pedido_id      bigint references compras.pedidos (id) on delete set null,
  origem         text not null check (origem in ('painel', 'omie', 'sem_cadastro')),
  codigo_projeto bigint,
  fornecedor     text,
  valor          numeric,
  motivo         text not null check (length(trim(motivo)) > 0),
  por            text,
  por_uid        uuid,
  em             timestamptz not null default now(),
  linhas         jsonb not null default '[]'::jsonb,   -- linhas da lista liberadas (para religar no desfazer)
  desfeito_por   text,
  desfeito_em    timestamptz
);
create unique index if not exists pc_cancelamento_ativo_uq on compras.pc_cancelamento (empresa, numero) where desfeito_em is null;
create index if not exists pc_cancelamento_projeto_idx on compras.pc_cancelamento (empresa, codigo_projeto);

-- ── Devoluções de material ──────────────────────────────────────────────────
create table if not exists compras.devolucao (
  id             bigserial primary key,
  empresa        text not null,
  numero         text not null,
  pedido_id      bigint not null references compras.pedidos (id) on delete cascade,
  codigo_projeto bigint,
  tipo           text not null check (tipo in ('total', 'parcial')),
  motivo         text not null check (length(trim(motivo)) > 0),
  nf_numero      text,
  nf_data        date,
  valor          numeric not null default 0,
  por            text,
  por_uid        uuid,
  em             timestamptz not null default now(),
  linhas         jsonb not null default '[]'::jsonb,
  desfeito_por   text,
  desfeito_em    timestamptz
);
create index if not exists devolucao_pc_idx on compras.devolucao (empresa, numero) where desfeito_em is null;
create index if not exists devolucao_projeto_idx on compras.devolucao (empresa, codigo_projeto);

create table if not exists compras.devolucao_itens (
  devolucao_id bigint not null references compras.devolucao (id) on delete cascade,
  pc_item_id   bigint not null references compras.itens (id) on delete cascade,
  produto_cod  text,
  descricao    text,
  unidade      text,
  qtd          numeric not null check (qtd > 0),
  valor_unit   numeric not null default 0,   -- líquido (desconto/IPI/ST rateados)
  valor        numeric not null default 0,
  primary key (devolucao_id, pc_item_id)
);
create index if not exists devolucao_itens_item_idx on compras.devolucao_itens (pc_item_id);

revoke all on compras.pc_cancelamento, compras.devolucao, compras.devolucao_itens from public, anon, authenticated;
grant all on compras.pc_cancelamento, compras.devolucao, compras.devolucao_itens to service_role;
grant usage, select on sequence compras.pc_cancelamento_id_seq, compras.devolucao_id_seq to service_role;

-- valor líquido de um item de PC (mesma conta de approval._projeto_pc_itens)
create or replace function compras._valor_item(i compras.itens) returns numeric
language sql immutable as $$
  select round(coalesce(i.qtd, 0) * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0) + coalesce(i.ipi, 0) + coalesce(i.st, 0), 2)
$$;

-- tira um nº de PC de "7262, 7300" sem mexer nos outros
create or replace function compras._tirar_pc(p_lista text, p_numero text) returns text
language sql immutable as $$
  select nullif(array_to_string(array(
    select x from unnest(string_to_array(regexp_replace(coalesce(p_lista, ''), '\s', '', 'g'), ',')) x
     where x <> '' and x <> p_numero), ', '), '')
$$;

-- comentário de sistema na linha da lista (aparece no 💬 da linha)
create or replace function compras._nota_lista(p_lista_id uuid, p_texto text, p_por text, p_origem text) returns void
language sql as $$
  insert into approval.rc_projetos_itens_comentarios (item_id, autor, texto, origem)
  values (p_lista_id, coalesce(nullif(trim(p_por), ''), 'sistema'), p_texto, p_origem)
$$;

-- Linhas da lista ligadas a um PC (opcional: só a um item dele).
--   via 'item'   → rc_projetos_itens.pc_item_id
--   via 'rc'     → a RC da linha foi atendida por este item (compras.item_rc)
--   via 'numero' → vínculo antigo só pelo nº do PC (casado por código quando há item)
create or replace function compras._linhas_do_pc(p_empresa text, p_pedido bigint, p_numero text, p_item bigint default null)
returns table (lista_id uuid, via text, qtd numeric, pc_item_id bigint)
language sql stable as $$
  with its as (select i.* from compras.itens i where i.pedido_id = p_pedido and (p_item is null or i.id = p_item))
  select l.id, 'item', l.qtd, l.pc_item_id
    from approval.rc_projetos_itens l join its on its.id = l.pc_item_id
   where l.empresa = p_empresa
  union
  select l.id, 'rc', l.qtd, ir.pc_item_id
    from approval.rc_projetos_itens l join compras.item_rc ir on ir.rc_item_id = l.rc_item_id
    join its on its.id = ir.pc_item_id
   where l.empresa = p_empresa and l.pc_item_id is null
  union
  select l.id, 'numero', l.qtd, (select its.id from its
                                   where p_item is not null or lower(trim(its.produto_cod)) = lower(trim(l.cat_codigo)) limit 1)
    from approval.rc_projetos_itens l
   where l.empresa = p_empresa and l.pc_item_id is null and l.rc_item_id is null
     and p_numero = any (string_to_array(regexp_replace(coalesce(l.pc_numero, ''), '\s', '', 'g'), ','))
     and (p_item is null
          or exists (select 1 from its where lower(trim(its.produto_cod)) = lower(trim(l.cat_codigo)))
          or (select count(*) from compras.itens i2 where i2.pedido_id = p_pedido) = 1)
$$;

-- ── Cancelar ────────────────────────────────────────────────────────────────
create or replace function orders.compras_pc_cancelar(p_empresa text, p_numero text, p_motivo text, p_por text,
                                                     p_uid uuid default null, p_codigo_projeto bigint default null,
                                                     p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare
  v compras.pedidos; v_origem text; v_num text := trim(p_numero); v_emp text := upper(trim(p_empresa));
  v_linhas jsonb := '[]'::jsonb; r record; v_res jsonb;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento'; end if;
  if v_num = '' then raise exception 'Nº do PC obrigatório'; end if;
  if exists (select 1 from compras.pc_cancelamento where empresa = v_emp and numero = v_num and desfeito_em is null) then
    raise exception 'O PC % já está cancelado', v_num;
  end if;
  select * into v from compras.pedidos where empresa = v_emp and numero = v_num and tipo = 'PC';
  v_origem := case when not found then 'sem_cadastro' else v.origem end;

  begin
    if v_origem = 'painel' then
      if v.cancelado then raise exception 'O PC % já está cancelado no Compras', v_num; end if;
      update compras.pedidos set cancelado = true, updated_at = now(), updated_by = p_por where id = v.id;
      perform compras.add_hist(v.id, 'Cancelado: ' || trim(p_motivo), p_por);
    elsif v_origem = 'omie' then
      perform compras.add_hist(v.id, 'Cancelado no painel (o painel não escreve no Omie — cancele também no Omie): ' || trim(p_motivo), p_por);
    end if;

    -- some de todas as telas que já respeitam o "Excluir PC"
    insert into platform.excluded_pc (empresa, pc_numero, motivo, excluded_at, excluded_by, tipo)
    values (v_emp, v_num, 'Cancelado: ' || trim(p_motivo), now(), p_uid, 'cancelado')
    on conflict (empresa, pc_numero) do update
      set tipo = 'cancelado', motivo = excluded.motivo, excluded_at = now(), excluded_by = excluded.excluded_by;

    -- linhas da lista voltam a "sem PC"
    if v.id is not null then
      for r in select distinct on (x.lista_id) x.*, l.pc_numero, l.rc_item_id, l.vinculo_via
                 from compras._linhas_do_pc(v_emp, v.id, v_num) x join approval.rc_projetos_itens l on l.id = x.lista_id
      loop
        if r.via = 'rc' and v_origem = 'painel' then
          null;  -- a RC continua; o PC cancelado já não conta (todas as consultas filtram "not cancelado")
        else
          update approval.rc_projetos_itens
             set pc_item_id = null, pc_numero = compras._tirar_pc(pc_numero, v_num),
                 vinculo_via = null, vinculo_score = null, vinculo_em = null, atualizado_por = p_por
           where id = r.lista_id;
        end if;
        perform compras._nota_lista(r.lista_id, 'PC ' || v_num || ' cancelado — a linha voltou a "sem PC". Motivo: ' || trim(p_motivo), p_por, 'pc_cancelado');
        v_linhas := v_linhas || jsonb_build_object('lista_id', r.lista_id, 'via', r.via, 'pc_item_id', r.pc_item_id,
                                                   'pc_numero', r.pc_numero, 'vinculo_via', r.vinculo_via);
      end loop;
    end if;

    insert into compras.pc_cancelamento (empresa, numero, pedido_id, origem, codigo_projeto, fornecedor, valor, motivo, por, por_uid, linhas)
    values (v_emp, v_num, v.id, v_origem, coalesce(p_codigo_projeto, v.projeto_cod), v.fornecedor_nome, v.valor_total,
            trim(p_motivo), p_por, p_uid, v_linhas);

    v_res := jsonb_build_object('numero', v_num, 'origem', v_origem, 'pedido_id', v.id, 'valor', v.valor_total,
                                'linhas_liberadas', jsonb_array_length(v_linhas), 'linhas', v_linhas,
                                'cancelar_no_omie', v_origem = 'omie', 'simulado', p_simular);
    if p_simular then raise exception using errcode = 'P0001', message = '__simulado__'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = '__simulado__' then return v_res; end if;
    raise;
  end;
  return v_res;
end $$;

create or replace function orders.compras_pc_cancelar_desfazer(p_empresa text, p_numero text, p_por text, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare c compras.pc_cancelamento; x jsonb; n int := 0; k int; v_res jsonb; v_emp text := upper(trim(p_empresa));
begin
  select * into c from compras.pc_cancelamento where empresa = v_emp and numero = trim(p_numero) and desfeito_em is null;
  if not found then raise exception 'O PC % não está cancelado no painel', p_numero; end if;
  begin
    if c.origem = 'painel' and c.pedido_id is not null then
      update compras.pedidos set cancelado = false, updated_at = now(), updated_by = p_por where id = c.pedido_id;
    end if;
    if c.pedido_id is not null then perform compras.add_hist(c.pedido_id, 'Cancelamento desfeito', p_por); end if;
    delete from platform.excluded_pc where empresa = c.empresa and pc_numero = c.numero and tipo = 'cancelado';
    -- religa as linhas que continuam livres
    for x in select * from jsonb_array_elements(c.linhas) loop
      k := 0;
      if x ->> 'via' = 'item' then
        update approval.rc_projetos_itens set pc_item_id = (x ->> 'pc_item_id')::bigint, pc_numero = coalesce(x ->> 'pc_numero', c.numero),
               vinculo_via = coalesce(x ->> 'vinculo_via', 'manual'), vinculo_em = now(), atualizado_por = p_por
         where id = (x ->> 'lista_id')::uuid and pc_item_id is null and rc_item_id is null;
        get diagnostics k = row_count;
      elsif x ->> 'via' = 'numero' then
        update approval.rc_projetos_itens set pc_numero = coalesce(x ->> 'pc_numero', c.numero), atualizado_por = p_por
         where id = (x ->> 'lista_id')::uuid and pc_item_id is null and rc_item_id is null and nullif(trim(pc_numero), '') is null;
        get diagnostics k = row_count;
      end if;
      if k > 0 or x ->> 'via' = 'rc' then n := n + 1; end if;
      perform compras._nota_lista((x ->> 'lista_id')::uuid, 'Cancelamento do PC ' || c.numero || ' desfeito', p_por, 'pc_cancelado');
    end loop;
    update compras.pc_cancelamento set desfeito_por = p_por, desfeito_em = now() where id = c.id;
    v_res := jsonb_build_object('numero', c.numero, 'linhas_religadas', n, 'simulado', p_simular);
    if p_simular then raise exception using errcode = 'P0001', message = '__simulado__'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = '__simulado__' then return v_res; end if;
    raise;
  end;
  return v_res;
end $$;

-- ── Devolver material ───────────────────────────────────────────────────────
-- p = { empresa, numero, motivo, nf_numero?, nf_data?, codigo_projeto?, itens: [{ pc_item_id, qtd }] }
create or replace function orders.compras_devolucao_registrar(p jsonb, p_por text, p_uid uuid default null, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare
  v compras.pedidos; v_emp text := upper(trim(p ->> 'empresa')); v_num text := trim(p ->> 'numero');
  v_motivo text := trim(coalesce(p ->> 'motivo', '')); v_id bigint; it jsonb; i compras.itens;
  v_qtd numeric; v_ja numeric; v_vu numeric; v_total numeric := 0; v_tipo text; v_linhas jsonb := '[]'::jsonb;
  r record; v_resta numeric; v_lib numeric; v_novo uuid; v_txt text; v_res jsonb; v_desc text := '';
  v_copia jsonb; v_cols text;
begin
  if v_motivo = '' then raise exception 'Informe o motivo da devolução'; end if;
  select * into v from compras.pedidos where empresa = v_emp and numero = v_num and tipo = 'PC';
  if not found then raise exception 'PC % não encontrado no Compras', v_num; end if;
  if v.cancelado or exists (select 1 from compras.pc_cancelamento where empresa = v_emp and numero = v_num and desfeito_em is null) then
    raise exception 'O PC % está cancelado — não há o que devolver', v_num;
  end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb)) = 0 then raise exception 'Escolha os itens devolvidos'; end if;

  begin
    insert into compras.devolucao (empresa, numero, pedido_id, codigo_projeto, tipo, motivo, nf_numero, nf_data, por, por_uid)
    values (v_emp, v_num, v.id, coalesce(nullif(p ->> 'codigo_projeto', '')::bigint, v.projeto_cod), 'parcial', v_motivo,
            nullif(trim(p ->> 'nf_numero'), ''), nullif(p ->> 'nf_data', '')::date, p_por, p_uid)
    returning id into v_id;

    for it in select * from jsonb_array_elements(p -> 'itens') loop
      v_qtd := coalesce(nullif(it ->> 'qtd', '')::numeric, 0);
      continue when v_qtd <= 0;
      select * into i from compras.itens where id = (it ->> 'pc_item_id')::bigint and pedido_id = v.id;
      if not found then raise exception 'Item % não é do PC %', it ->> 'pc_item_id', v_num; end if;
      select coalesce(sum(di.qtd), 0) into v_ja from compras.devolucao_itens di join compras.devolucao d on d.id = di.devolucao_id
       where di.pc_item_id = i.id and d.desfeito_em is null and d.id <> v_id;
      if v_qtd > coalesce(i.qtd, 0) - v_ja + 1e-9 then
        raise exception '"%" — devolver % de %, mas só restam % no pedido', i.descricao, v_qtd, i.qtd, coalesce(i.qtd, 0) - v_ja;
      end if;
      v_vu := case when coalesce(i.qtd, 0) > 0 then compras._valor_item(i) / i.qtd else 0 end;
      insert into compras.devolucao_itens (devolucao_id, pc_item_id, produto_cod, descricao, unidade, qtd, valor_unit, valor)
      values (v_id, i.id, i.produto_cod, i.descricao, i.unidade, v_qtd, round(v_vu, 4), round(v_vu * v_qtd, 2));
      v_total := v_total + round(v_vu * v_qtd, 2);
      v_desc := v_desc || case when v_desc = '' then '' else '; ' end || trim(to_char(v_qtd, 'FM999999990.###')) || ' × ' || coalesce(i.descricao, '');

      -- linhas da lista deste item: libera a quantidade devolvida
      v_resta := v_qtd;
      for r in select distinct on (x.lista_id) x.*, l.item, l.qtd lqtd, l.pc_numero, l.rc_item_id, l.vinculo_via, l.pc_item_id l_pc_item
                 from compras._linhas_do_pc(v_emp, v.id, v_num, i.id) x join approval.rc_projetos_itens l on l.id = x.lista_id
                order by x.lista_id
      loop
        exit when v_resta <= 0;
        v_lib := least(coalesce(r.lqtd, v_resta), v_resta);
        if coalesce(r.lqtd, 0) <= v_lib + 1e-9 then
          -- a linha inteira volta a "sem PC"
          update approval.rc_projetos_itens
             set pc_item_id = null, rc_item_id = case when r.via = 'rc' then null else rc_item_id end,
                 pc_numero = compras._tirar_pc(pc_numero, v_num), vinculo_via = null, vinculo_score = null, vinculo_em = null,
                 atualizado_por = p_por
           where id = r.lista_id;
          v_txt := 'Devolução do PC ' || v_num || ': ' || trim(to_char(v_lib, 'FM999999990.###')) || ' devolvido(s) — a linha voltou a "sem PC". Motivo: ' || v_motivo;
          v_linhas := v_linhas || jsonb_build_object('lista_id', r.lista_id, 'acao', 'desligada', 'via', r.via, 'qtd', v_lib,
                                                     'pc_item_id', r.l_pc_item, 'rc_item_id', r.rc_item_id, 'pc_numero', r.pc_numero, 'vinculo_via', r.vinculo_via);
          perform compras._nota_lista(r.lista_id, v_txt, p_por, 'pc_devolucao');
        else
          -- parte: a linha fica com o que ficou e nasce a irmã com o devolvido, sem PC
          update approval.rc_projetos_itens set qtd = qtd - v_lib, atualizado_por = p_por where id = r.lista_id;
          v_novo := gen_random_uuid();
          -- cópia da linha com as colunas que existirem (menos as geradas, ex.: item_norm)
          select to_jsonb(l) || jsonb_build_object(
                   'id', v_novo, 'item', l.item || ' · repor (devolução PC ' || v_num || ' #' || v_id || ')', 'qtd', v_lib,
                   'pc_item_id', null, 'rc_item_id', null, 'pc_numero', null, 'vinculo_via', null, 'vinculo_score', null, 'vinculo_em', null,
                   'criado_em', now(), 'criado_por', p_por, 'atualizado_em', now(), 'atualizado_por', p_por)
            into v_copia from approval.rc_projetos_itens l where l.id = r.lista_id;
          if v_cols is null then
            select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
              from information_schema.columns
             where table_schema = 'approval' and table_name = 'rc_projetos_itens' and is_generated = 'NEVER';
          end if;
          execute format('insert into approval.rc_projetos_itens (%1$s) select %1$s from jsonb_populate_record(null::approval.rc_projetos_itens, $1)', v_cols)
            using v_copia;
          v_linhas := v_linhas || jsonb_build_object('lista_id', r.lista_id, 'acao', 'dividida', 'via', r.via, 'qtd', v_lib, 'nova_id', v_novo);
          perform compras._nota_lista(r.lista_id, 'Devolução do PC ' || v_num || ': ' || trim(to_char(v_lib, 'FM999999990.###'))
                  || ' devolvido(s) — essa quantidade foi para uma linha nova "repor", sem PC. Motivo: ' || v_motivo, p_por, 'pc_devolucao');
          perform compras._nota_lista(v_novo, 'Linha criada pela devolução do PC ' || v_num || ' (' || trim(to_char(v_lib, 'FM999999990.###'))
                  || ' devolvido(s)) — sem PC, pronta para um pedido novo. Motivo: ' || v_motivo, p_por, 'pc_devolucao');
        end if;
        v_resta := v_resta - v_lib;
      end loop;
    end loop;

    if v_total = 0 and not exists (select 1 from compras.devolucao_itens where devolucao_id = v_id) then
      raise exception 'Informe a quantidade devolvida de pelo menos um item';
    end if;
    -- total = todos os itens do PC devolvidos por inteiro (somando as devoluções anteriores)
    v_tipo := case when not exists (
                select 1 from compras.itens ii where ii.pedido_id = v.id and coalesce(ii.qtd, 0) >
                  (select coalesce(sum(di.qtd), 0) from compras.devolucao_itens di join compras.devolucao d on d.id = di.devolucao_id
                    where di.pc_item_id = ii.id and d.desfeito_em is null) + 1e-9)
              then 'total' else 'parcial' end;
    update compras.devolucao set tipo = v_tipo, valor = v_total, linhas = v_linhas where id = v_id;
    perform compras.add_hist(v.id, 'Devolução ' || v_tipo || ' de material: ' || v_desc || ' (R$ ' || replace(to_char(v_total, 'FM9999999990.00'), '.', ',') || ')'
            || coalesce(' · NF de devolução ' || nullif(trim(p ->> 'nf_numero'), ''), '') || ' — ' || v_motivo, p_por);

    v_res := jsonb_build_object('id', v_id, 'numero', v_num, 'tipo', v_tipo, 'valor', v_total, 'origem', v.origem,
                                'linhas', v_linhas, 'linhas_liberadas', jsonb_array_length(v_linhas), 'simulado', p_simular);
    if p_simular then raise exception using errcode = 'P0001', message = '__simulado__'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = '__simulado__' then return v_res; end if;
    raise;
  end;
  return v_res;
end $$;

create or replace function orders.compras_devolucao_desfazer(p_id bigint, p_por text, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare d compras.devolucao; x jsonb; v_res jsonb;
begin
  select * into d from compras.devolucao where id = p_id and desfeito_em is null;
  if not found then raise exception 'Devolução % não existe ou já foi desfeita', p_id; end if;
  begin
    for x in select * from jsonb_array_elements(d.linhas) loop
      if x ->> 'acao' = 'dividida' then
        -- devolve a quantidade à linha original e apaga a irmã se ninguém a usou
        if exists (select 1 from approval.rc_projetos_itens where id = (x ->> 'nova_id')::uuid
                    and pc_item_id is null and rc_item_id is null and nullif(trim(pc_numero), '') is null) then
          delete from approval.rc_projetos_itens where id = (x ->> 'nova_id')::uuid;
          update approval.rc_projetos_itens set qtd = qtd + (x ->> 'qtd')::numeric, atualizado_por = p_por where id = (x ->> 'lista_id')::uuid;
        end if;
      else
        update approval.rc_projetos_itens
           set pc_item_id = nullif(x ->> 'pc_item_id', '')::bigint, rc_item_id = coalesce(rc_item_id, nullif(x ->> 'rc_item_id', '')::bigint),
               pc_numero = coalesce(x ->> 'pc_numero', pc_numero), vinculo_via = x ->> 'vinculo_via', vinculo_em = now(), atualizado_por = p_por
         where id = (x ->> 'lista_id')::uuid and pc_item_id is null and rc_item_id is null;
      end if;
      perform compras._nota_lista((x ->> 'lista_id')::uuid, 'Devolução do PC ' || d.numero || ' desfeita', p_por, 'pc_devolucao');
    end loop;
    update compras.devolucao set desfeito_por = p_por, desfeito_em = now() where id = d.id;
    perform compras.add_hist(d.pedido_id, 'Devolução desfeita (R$ ' || replace(to_char(d.valor, 'FM9999999990.00'), '.', ',') || ')', p_por);
    v_res := jsonb_build_object('id', d.id, 'numero', d.numero, 'simulado', p_simular);
    if p_simular then raise exception using errcode = 'P0001', message = '__simulado__'; end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = '__simulado__' then return v_res; end if;
    raise;
  end;
  return v_res;
end $$;

-- ── Leitura ─────────────────────────────────────────────────────────────────
-- Cancelamentos e devoluções ativos dos PCs dados (ou do projeto). Usado pelas contas
-- do projeto (lib/pc-ajustes.ts), pela seção "Cancelados / devolvidos" e por /api/list/rows.
create or replace function orders.compras_pcs_ajustes(p_empresa text default null, p_numeros text[] default null,
                                                     p_projeto bigint default null, p_historico boolean default false)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object(
    'cancelados', coalesce((
      select jsonb_agg(jsonb_build_object('empresa', c.empresa, 'numero', c.numero, 'origem', c.origem, 'pedido_id', c.pedido_id,
               'fornecedor', c.fornecedor, 'valor', c.valor, 'motivo', c.motivo, 'por', c.por, 'em', c.em,
               'codigo_projeto', c.codigo_projeto, 'linhas', jsonb_array_length(c.linhas),
               'desfeito_por', c.desfeito_por, 'desfeito_em', c.desfeito_em) order by c.em desc)
        from compras.pc_cancelamento c
       where (p_historico or c.desfeito_em is null)
         and (p_empresa is null or c.empresa = upper(p_empresa))
         and (p_numeros is null or c.numero = any (p_numeros))
         and (p_projeto is null or c.codigo_projeto = p_projeto
              or exists (select 1 from compras.pedidos pp where pp.id = c.pedido_id and pp.projeto_cod = p_projeto))), '[]'::jsonb),
    'devolucoes', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'empresa', d.empresa, 'numero', d.numero, 'pedido_id', d.pedido_id,
               'tipo', d.tipo, 'valor', d.valor, 'motivo', d.motivo, 'nf_numero', d.nf_numero, 'nf_data', d.nf_data,
               'por', d.por, 'em', d.em, 'codigo_projeto', d.codigo_projeto, 'linhas', jsonb_array_length(d.linhas),
               'fornecedor', p.fornecedor_nome, 'valor_pc', p.valor_total, 'origem', p.origem, 'nf_entrada', p.nf, 'chave_entrada', p.chave_nfe,
               'desfeito_por', d.desfeito_por, 'desfeito_em', d.desfeito_em,
               'itens', (select coalesce(jsonb_agg(jsonb_build_object('pc_item_id', di.pc_item_id, 'cod', di.produto_cod, 'desc', di.descricao,
                                  'un', di.unidade, 'qtd', di.qtd, 'vu', di.valor_unit, 'valor', di.valor)), '[]'::jsonb)
                           from compras.devolucao_itens di where di.devolucao_id = d.id)) order by d.em desc)
        from compras.devolucao d join compras.pedidos p on p.id = d.pedido_id
       where (p_historico or d.desfeito_em is null)
         and (p_empresa is null or d.empresa = upper(p_empresa))
         and (p_numeros is null or d.numero = any (p_numeros))
         and (p_projeto is null or d.codigo_projeto = p_projeto or p.projeto_cod = p_projeto)), '[]'::jsonb))
$$;

-- PC pelo número, com o quanto de cada item já foi devolvido (modal de devolução)
create or replace function orders.compras_pc_por_numero(p_empresa text, p_numero text)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select orders.compras_pedido(p.id) || jsonb_build_object(
           'devolvido', coalesce((select jsonb_object_agg(x.pc_item_id::text, x.q) from (
               select di.pc_item_id, sum(di.qtd) q from compras.devolucao_itens di join compras.devolucao d on d.id = di.devolucao_id
                where d.pedido_id = p.id and d.desfeito_em is null group by di.pc_item_id) x), '{}'::jsonb),
           'valorItem', coalesce((select jsonb_object_agg(i.id::text, compras._valor_item(i)) from compras.itens i where i.pedido_id = p.id), '{}'::jsonb),
           'cancelamento', (select to_jsonb(c) - 'linhas' from compras.pc_cancelamento c
                             where c.empresa = p.empresa and c.numero = p.numero and c.desfeito_em is null))
    from compras.pedidos p
   where p.empresa = upper(trim(p_empresa)) and p.numero = trim(p_numero) and p.tipo = 'PC'
   limit 1
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'orders.compras_pc_cancelar(text, text, text, text, uuid, bigint, boolean)',
    'orders.compras_pc_cancelar_desfazer(text, text, text, boolean)',
    'orders.compras_devolucao_registrar(jsonb, text, uuid, boolean)',
    'orders.compras_devolucao_desfazer(bigint, text, boolean)',
    'orders.compras_pcs_ajustes(text, text[], bigint, boolean)',
    'orders.compras_pc_por_numero(text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'compras._valor_item(compras.itens)', 'compras._tirar_pc(text, text)', 'compras._nota_lista(uuid, text, text, text)',
    'compras._linhas_do_pc(text, bigint, text, bigint)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
