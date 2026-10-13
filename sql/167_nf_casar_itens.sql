-- 13/10/26 (Benny) — Casar UMA NF com VÁRIOS pedidos de compra, escolhendo itens e quantidades de
-- cada um (parte de um pedido, parte de outro). Pedido que ainda não foi atendido por inteiro fica
-- marcado como parcial. A NF continua em "NF sem pedido" até a soma casada fechar o valor dela.

create table if not exists compras.nf_alocacoes (
  chave text not null,
  item_id bigint not null references compras.itens(id) on delete cascade,
  pedido_id bigint not null references compras.pedidos(id) on delete cascade,
  qtd numeric not null check (qtd > 0),
  valor numeric not null,
  por text, em timestamptz not null default now(),
  primary key (chave, item_id)
);
create index if not exists nf_alocacoes_pedido on compras.nf_alocacoes (pedido_id);
create index if not exists nf_alocacoes_item on compras.nf_alocacoes (item_id);
alter table compras.nf_alocacoes enable row level security;
grant all on compras.nf_alocacoes to service_role;

alter table compras.nf_vinculos add column if not exists valor numeric; -- parte da NF neste pedido (null = NF inteira, casamentos antigos)

-- valor por unidade do item, com desconto/IPI/ST rateados
create or replace function compras.item_vu_total(i compras.itens) returns numeric language sql immutable as $$
  select case when coalesce(i.qtd, 0) > 0
              then (i.qtd * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0) + coalesce(i.ipi, 0) + coalesce(i.st, 0)) / i.qtd
              else coalesce(i.valor_unit, 0) end
$$;

-- Itens dos pedidos escolhidos, com o que já entrou em outras NF e nesta
create or replace function orders.compras_itens_para_casar(p_ids bigint[], p_chave text)
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', i.id, 'pedidoId', p.id, 'num', p.numero, 'seq', i.seq, 'cod', i.produto_cod, 'desc', i.descricao, 'un', i.unidade,
      'qtd', i.qtd, 'vu', round(compras.item_vu_total(i), 4),
      'outras', coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id and a.chave <> coalesce(p_chave, '')), 0),
      'nesta', coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id and a.chave = coalesce(p_chave, '')), 0))
    order by p.numero, i.seq), '[]'::jsonb)
    from compras.pedidos p join compras.itens i on i.pedido_id = p.id
   where p.id = any(p_ids) and p.tipo = 'PC' and not p.cancelado
$function$;

-- Grava o casamento por itens. p_alocs: [{item_id, qtd}] — substitui a alocação desta NF.
create or replace function orders.compras_nf_casar_itens(p_chave text, p_alocs jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path to 'compras', 'public' as $function$
declare v_nf numeric; v_ped bigint; v_total numeric; r record;
begin
  select valor into v_nf from orders.focus_recebidos where tipo = 'nfe' and chave = p_chave;
  if v_nf is null then raise exception 'NF-e % não está na Focus', p_chave; end if;
  if jsonb_array_length(coalesce(p_alocs, '[]'::jsonb)) = 0 then raise exception 'Escolha pelo menos um item'; end if;
  -- valida: item de PC não cancelado e quantidade dentro do saldo
  for r in select i.id, i.pedido_id, i.qtd, i.descricao, (x->>'qtd')::numeric q,
                  coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id and a.chave <> p_chave), 0) outras
             from jsonb_array_elements(p_alocs) x join compras.itens i on i.id = (x->>'item_id')::bigint
             join compras.pedidos p on p.id = i.pedido_id and p.tipo = 'PC' and not p.cancelado loop
    if r.q is null or r.q <= 0 then raise exception 'Quantidade inválida em %', r.descricao; end if;
    if r.q > r.qtd - r.outras + 0.0001 then
      raise exception 'Item "%": % já foi para outras NF; o saldo é % (pedido %)', r.descricao, r.outras, r.qtd - r.outras, r.qtd;
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_alocs) x join compras.itens i on i.id = (x->>'item_id')::bigint) <> jsonb_array_length(p_alocs) then
    raise exception 'Item não encontrado';
  end if;
  delete from compras.nf_alocacoes where chave = p_chave;
  insert into compras.nf_alocacoes (chave, item_id, pedido_id, qtd, valor, por)
  select p_chave, i.id, i.pedido_id, (x->>'qtd')::numeric, round((x->>'qtd')::numeric * compras.item_vu_total(i), 2), p_por
    from jsonb_array_elements(p_alocs) x join compras.itens i on i.id = (x->>'item_id')::bigint;
  for v_ped in select distinct pedido_id from compras.nf_alocacoes where chave = p_chave loop
    perform compras.ligar_nf(p_chave, v_ped, p_por, 'casada por itens');
    update compras.nf_vinculos set valor = (select sum(valor) from compras.nf_alocacoes where chave = p_chave and pedido_id = v_ped)
     where chave = p_chave and pedido_id = v_ped;
  end loop;
  select sum(valor) into v_total from compras.nf_alocacoes where chave = p_chave;
  return jsonb_build_object('ok', true, 'casado', v_total, 'nf', v_nf, 'falta', round(v_nf - v_total, 2));
end $function$;

-- Atendimento dos pedidos com casamento por itens: total, já em NF e se ainda falta
create or replace function orders.compras_atendimento()
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'total', x.total, 'atendido', x.atendido, 'parcial', x.parcial)), '[]'::jsonb)
    from (select p.id, p.valor_total total,
                 (select sum(a.valor) from compras.nf_alocacoes a where a.pedido_id = p.id) atendido,
                 exists (select 1 from compras.itens i where i.pedido_id = p.id
                          and coalesce((select sum(a.qtd) from compras.nf_alocacoes a where a.item_id = i.id), 0) < i.qtd - 0.0001) parcial
            from compras.pedidos p
           where exists (select 1 from compras.nf_alocacoes a where a.pedido_id = p.id) and not p.cancelado) x
$function$;

grant execute on function orders.compras_itens_para_casar(bigint[], text) to service_role;
grant execute on function orders.compras_nf_casar_itens(text, jsonb, text) to service_role;
grant execute on function orders.compras_atendimento() to service_role;

-- NF sai de "sem pedido" só quando a soma casada fecha o valor (casamento antigo sem valor = NF inteira)
do $$
declare d text;
begin
  d := pg_get_viewdef('compras.v_nf_sem_pedido'::regclass, true);
  d := replace(d, $a$NOT (EXISTS ( SELECT 1
           FROM compras.nf_vinculos c
          WHERE c.chave = f.chave AND c.status = 'confirmado'::text))$a$,
    $a$COALESCE(( SELECT sum(COALESCE(c.valor, f.valor)) FROM compras.nf_vinculos c
          WHERE c.chave = f.chave AND c.status = 'confirmado'::text), 0::numeric) < (f.valor - 0.05)$a$);
  if d not like '%sum(COALESCE(c.valor, f.valor))%' then raise exception 'view não trocada'; end if;
  execute 'create or replace view compras.v_nf_sem_pedido as ' || d;
end $$;

-- a caixa mostra quanto da NF já foi casado e com quais pedidos
create or replace function orders.compras_nfs_sem_pedido(p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', f.chave, 'numero', coalesce(nullif(ltrim(f.numero, '0'), ''), substr(f.chave, 26, 9)),
           'emissao', f.emissao, 'chegou', f.primeiro_visto, 'valor', f.valor, 'emitente', f.emitente_nome, 'cnpj', f.emitente_doc,
           'completa', f.completa,
           'casado', (select coalesce(sum(coalesce(c.valor, f.valor)), 0) from compras.nf_vinculos c where c.chave = f.chave and c.status = 'confirmado'),
           'casadoCom', (select coalesce(jsonb_agg(jsonb_build_object('pedidoId', p.id, 'num', p.numero, 'valor', c.valor)), '[]'::jsonb)
                           from compras.nf_vinculos c join compras.pedidos p on p.id = c.pedido_id where c.chave = f.chave and c.status = 'confirmado'),
           'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('pedidoId', p.id, 'num', p.numero, 'forn', p.fornecedor_nome,
                                 'valor', p.valor_total, 'emissao', p.emissao, 'aprov', p.aprov_status, 'etapa', p.etapa,
                                 'origem', p.origem, 'score', v.score, 'motivo', v.motivo) order by v.score desc), '[]'::jsonb)
                           from compras.nf_vinculos v join compras.pedidos p on p.id = v.pedido_id
                          where v.chave = f.chave and v.status = 'sugerido' and not p.cancelado and p.etapa in ('10', '15', '35', '40'))
         ) order by f.emissao desc), '[]'::jsonb)
    from compras.v_nf_sem_pedido f where f.empresa = p_empresa
$function$;

-- Pedidos para casar: do mesmo fornecedor (CNPJ) ou pela busca, com o que falta entrar em NF
create or replace function orders.compras_pcs_para_casar(p_cnpj text, p_q text, p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path to 'compras', 'public' as $function$
  select coalesce(jsonb_agg(x order by x->>'emissao' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', p.id, 'num', p.numero, 'forn', p.fornecedor_nome, 'valor', p.valor_total, 'emissao', p.emissao,
             'proj', p.projeto_nome, 'aprov', p.aprov_status, 'etapa', p.etapa, 'origem', p.origem,
             'atendido', (select coalesce(sum(a.valor), 0) from compras.nf_alocacoes a where a.pedido_id = p.id)) x
      from compras.pedidos p
     where p.tipo = 'PC' and not p.cancelado and p.empresa = p_empresa
       and (case when coalesce(trim(p_q), '') <> ''
                 then (p.numero = ltrim(trim(p_q), '0') or p.fornecedor_nome ilike '%' || trim(p_q) || '%'
                       or regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = regexp_replace(p_q, '\D', '', 'g'))
                 else regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g')
                      and p.emissao >= current_date - 400 end)
     limit 40) s
$function$;
grant execute on function orders.compras_pcs_para_casar(text, text, text) to service_role;

-- desfazer o casamento de um pedido apaga também a distribuição por itens dele
do $$ declare d text; begin
  d := pg_get_functiondef('orders.compras_nf_descasar(text,bigint,text)'::regprocedure);
  d := replace(d, $a$  update compras.nf_vinculos set status = 'descartado', decidido_por = p_por, decidido_em = now()
   where chave = p_chave and pedido_id = p_pedido;$a$, $a$  update compras.nf_vinculos set status = 'descartado', decidido_por = p_por, decidido_em = now()
   where chave = p_chave and pedido_id = p_pedido;
  delete from compras.nf_alocacoes where chave = p_chave and pedido_id = p_pedido; -- 13/10/26: casamento por itens$a$);
  if d not like '%nf_alocacoes%' then raise exception 'nao trocou'; end if;
  execute d; end $$;
