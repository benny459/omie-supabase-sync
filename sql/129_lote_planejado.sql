-- 08/10/26 — Agente de compras: lotes de compra na data certa (spec F).
--
-- O agente monta LOTES (um PC por fornecedor por data) a partir do comprar_ate de cada item
-- (sql/128). Lotes "proposto" são recalculados a cada carga e NÃO ficam aqui; só o que a
-- pessoa decide persiste: "agendado" (no dia o cron cria o PC e avisa), "gerado" (virou PC,
-- pedido_id) e "cancelado". Os itens de um lote agendado/gerado saem do recálculo; item que
-- ganha PC fora do lote sai dele (o cron e a tela conferem antes de gerar).
--
-- • compras.lote_planejado / compras.lote_planejado_item (spec)
-- • janela de consolidação por empresa (padrão 10 dias) na compras.config que já existe
--   (chave/valor, sql/51): chave 'agente_compras:<empresa>', valor {"janela_dias": N}.
--   (a spec sugeria platform.empresa_config, que não existe)
-- • orders.lotes_listar / orders.lotes_salvar / orders.lotes_do_dia: acesso pela API e
--   pelo cron (o schema compras não é exposto no PostgREST), só service_role.

create table if not exists compras.lote_planejado (
  id             uuid primary key default gen_random_uuid(),
  empresa        text not null,
  codigo_projeto bigint not null,
  fornecedor_norm text,
  fornecedor     text,                    -- nome como a lista mostra (exibição e busca do cadastro)
  data_base      date not null,           -- comprar_ate do 1º item quando o lote foi montado
  data_pedir     date not null,           -- efetiva (manual ou calculada)
  status         text not null default 'proposto' check (status in ('proposto','agendado','gerado','cancelado')),
  motivo         text,
  pedido_id      bigint,                  -- compras.pedidos quando gerado
  pedido_num     text,
  ultimo_aviso   text,                    -- o que o cron já avisou (lembrete/gerado/erro) — não repete
  criado_por     text,                    -- 'agente' | e-mail
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now()
);
create index if not exists lote_planejado_projeto on compras.lote_planejado (empresa, codigo_projeto);
create index if not exists lote_planejado_agenda on compras.lote_planejado (status, data_pedir) where status = 'agendado';

create table if not exists compras.lote_planejado_item (
  lote_id uuid references compras.lote_planejado on delete cascade,
  item_id uuid references approval.rc_projetos_itens on delete cascade,
  primary key (lote_id, item_id)
);
create index if not exists lote_planejado_item_item on compras.lote_planejado_item (item_id);

revoke all on compras.lote_planejado, compras.lote_planejado_item from public, anon, authenticated;
grant all on compras.lote_planejado, compras.lote_planejado_item to service_role;

-- Lotes persistidos de um projeto (agendado/gerado; cancelado só dos últimos 30 dias) + a janela.
create or replace function orders.lotes_listar(p_empresa text, p_projeto bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'janela', coalesce((select (c.valor->>'janela_dias')::int from compras.config c where c.chave = 'agente_compras:' || p_empresa), 10),
    'lotes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'fornecedor', l.fornecedor, 'fornecedor_norm', l.fornecedor_norm, 'data_base', l.data_base,
               'data_pedir', l.data_pedir, 'status', l.status, 'motivo', l.motivo, 'pedido_id', l.pedido_id, 'pedido_num', l.pedido_num,
               'criado_por', l.criado_por, 'atualizado_em', l.atualizado_em,
               'itens', coalesce((select jsonb_agg(i.item_id) from compras.lote_planejado_item i where i.lote_id = l.id), '[]'::jsonb))
             order by l.data_pedir)
        from compras.lote_planejado l
       where l.empresa = p_empresa and l.codigo_projeto = p_projeto
         and (l.status in ('agendado', 'gerado') or (l.status = 'cancelado' and l.atualizado_em > now() - interval '30 days'))), '[]'::jsonb))
$$;
revoke all on function orders.lotes_listar(text, bigint) from public, anon, authenticated;
grant execute on function orders.lotes_listar(text, bigint) to service_role;

-- Ações: agendar (cria lote com itens) · mover (nova data_pedir) · cancelar · gerado (pedido)
--        · aviso (marca o que o cron avisou) · janela (config da empresa).
create or replace function orders.lotes_salvar(p jsonb, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a text := p->>'acao';
  v_id uuid;
  v_emp text := coalesce(p->>'empresa', 'SF');
  v_n int;
begin
  if a = 'janela' then
    if (p->>'janela')::int is null or (p->>'janela')::int not between 0 and 60 then
      raise exception 'janela entre 0 e 60 dias';
    end if;
    insert into compras.config (chave, valor, updated_by, updated_at)
    values ('agente_compras:' || v_emp, jsonb_build_object('janela_dias', (p->>'janela')::int), p_por, now())
    on conflict (chave) do update
      set valor = coalesce(compras.config.valor, '{}'::jsonb) || jsonb_build_object('janela_dias', (p->>'janela')::int),
          updated_by = p_por, updated_at = now();
    return jsonb_build_object('ok', true, 'janela', (p->>'janela')::int);
  end if;

  if a = 'agendar' then
    if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then raise exception 'lote sem itens'; end if;
    -- item já em outro lote agendado/gerado não entra duas vezes
    select count(*) into v_n
      from compras.lote_planejado_item li join compras.lote_planejado l on l.id = li.lote_id
     where l.status in ('agendado', 'gerado') and li.item_id in (select (x)::uuid from jsonb_array_elements_text(p->'itens') x);
    if v_n > 0 then raise exception '% item(ns) deste lote já estão em outro lote agendado ou gerado — recarregue', v_n; end if;
    insert into compras.lote_planejado (empresa, codigo_projeto, fornecedor_norm, fornecedor, data_base, data_pedir, status, motivo, criado_por, atualizado_em)
    values (v_emp, (p->>'codigo_projeto')::bigint, nullif(approval._norm_item(p->>'fornecedor'), ''), nullif(p->>'fornecedor', ''),
            (p->>'data_base')::date, (p->>'data_pedir')::date, 'agendado', p->>'motivo', p_por, now())
    returning id into v_id;
    insert into compras.lote_planejado_item (lote_id, item_id)
    select v_id, (x)::uuid from jsonb_array_elements_text(p->'itens') x
     where exists (select 1 from approval.rc_projetos_itens r where r.id = (x)::uuid
                     and r.empresa = v_emp and r.codigo_projeto = (p->>'codigo_projeto')::bigint);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  v_id := (p->>'id')::uuid;
  if v_id is null then raise exception 'lote obrigatório'; end if;
  if a = 'mover' then
    update compras.lote_planejado set data_pedir = (p->>'data')::date, ultimo_aviso = null, atualizado_em = now()
     where id = v_id and status = 'agendado';
  elsif a = 'cancelar' then
    update compras.lote_planejado set status = 'cancelado', atualizado_em = now() where id = v_id and status = 'agendado';
  elsif a = 'gerado' then
    update compras.lote_planejado set status = 'gerado', pedido_id = nullif(p->>'pedido_id', '')::bigint,
           pedido_num = nullif(p->>'pedido_num', ''), atualizado_em = now()
     where id = v_id and status in ('agendado', 'proposto');
  elsif a = 'aviso' then
    update compras.lote_planejado set ultimo_aviso = p->>'aviso', atualizado_em = now() where id = v_id;
  elsif a = 'tirar_itens' then
    delete from compras.lote_planejado_item where lote_id = v_id
       and item_id in (select (x)::uuid from jsonb_array_elements_text(p->'itens') x);
  else
    raise exception 'acao inválida: %', a;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function orders.lotes_salvar(jsonb, text) from public, anon, authenticated;
grant execute on function orders.lotes_salvar(jsonb, text) to service_role;

-- Para o cron: lotes agendados com data de pedir até p_ate (inclusive) e os projetos com
-- itens sem PC e com comprar_ate (para os lembretes de lotes propostos atrasados).
create or replace function orders.lotes_do_dia(p_ate date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'agendados', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'empresa', l.empresa, 'codigo_projeto', l.codigo_projeto,
               'fornecedor', l.fornecedor, 'data_base', l.data_base, 'data_pedir', l.data_pedir, 'motivo', l.motivo,
               'ultimo_aviso', l.ultimo_aviso, 'criado_por', l.criado_por,
               'itens', coalesce((select jsonb_agg(i.item_id) from compras.lote_planejado_item i where i.lote_id = l.id), '[]'::jsonb)))
        from compras.lote_planejado l where l.status = 'agendado' and l.data_pedir <= p_ate), '[]'::jsonb),
    'projetos', coalesce((
      select jsonb_agg(distinct jsonb_build_object('empresa', v.empresa, 'codigo_projeto', v.codigo_projeto))
        from approval.v_rc_projetos_itens v
       where v.comprar_ate is not null and v.comprar_ate <= p_ate + 7
         and v.pc_numero is null and v.pc_item_id is null), '[]'::jsonb))
$$;
revoke all on function orders.lotes_do_dia(date) from public, anon, authenticated;
grant execute on function orders.lotes_do_dia(date) to service_role;

notify pgrst, 'reload schema';
