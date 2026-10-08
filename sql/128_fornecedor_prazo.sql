-- 08/10/26 — Planejamento de compras por item (spec E).
--
-- • compras.fornecedor_prazo: prazo de entrega MANUAL por fornecedor (o "⏱ Prazos por
--   fornecedor" da lista de materiais). Vazio = vale o histórico.
-- • compras.v_fornecedor_prazo: por fornecedor, o histórico (média pedido → NF do catálogo
--   de compras, orders.mv_catalogo_compra), o manual e o prazo usado (manual → histórico → 15).
-- • compras.prazo_fornecedor(empresa, fornecedor) → (prazo_dias, fonte 'manual'|'historico'|'estimado').
-- • approval.v_rc_projetos_itens ganha, NO FIM (mesmas colunas, mesma ordem antes):
--     prazo_efetivo  = manual do fornecedor → cat_entrega_dias do item → histórico do fornecedor → 15
--     prazo_fonte    = 'manual' | 'item' | 'historico' | 'estimado'
--     prazo_estimado = true quando caiu nos 15 dias
--     comprar_ate    = data_necessaria − prazo_efetivo − 3 (folga, lib/sinal-entrega FOLGA_ENTREGA_DIAS)
--   (o manual vem antes do prazo do item: ajustar o prazo de um fornecedor muda todos os
--    itens dele — é o que a lista mostra, lib/planejamento-compras.ts)
-- • orders.fornecedor_prazo_listar / _definir: acesso pela API (o schema compras não é
--   exposto no PostgREST), só service_role.

create table if not exists compras.fornecedor_prazo (
  empresa         text not null,
  fornecedor_norm text not null,          -- approval._norm_item(nome do fornecedor)
  nome            text,                   -- como foi digitado/mostrado (só exibição)
  prazo_dias      int  not null check (prazo_dias >= 0),
  atualizado_em   timestamptz default now(),
  atualizado_por  text,
  primary key (empresa, fornecedor_norm)
);
revoke all on compras.fornecedor_prazo from public, anon, authenticated;
grant all on compras.fornecedor_prazo to service_role;

create or replace view compras.v_fornecedor_prazo as
with hist as (
  select m.empresa, approval._norm_item(m.fornecedor) as fornecedor_norm, min(m.fornecedor) as nome,
         round(avg(m.entrega_dias))::int as historico, count(*)::int as n_itens
    from orders.mv_catalogo_compra m
   where m.fornecedor is not null and m.entrega_dias is not null
   group by 1, 2
)
select coalesce(h.empresa, p.empresa)                 as empresa,
       coalesce(h.fornecedor_norm, p.fornecedor_norm) as fornecedor_norm,
       coalesce(p.nome, h.nome)                       as nome,
       h.historico,
       p.prazo_dias                                   as manual,
       coalesce(p.prazo_dias, h.historico, 15)        as prazo_dias,
       case when p.prazo_dias is not null then 'manual'
            when h.historico is not null then 'historico'
            else 'estimado' end                       as fonte,
       h.n_itens,
       p.atualizado_em, p.atualizado_por
  from hist h
  full join compras.fornecedor_prazo p on p.empresa = h.empresa and p.fornecedor_norm = h.fornecedor_norm
 where coalesce(h.fornecedor_norm, p.fornecedor_norm) <> '';
revoke all on compras.v_fornecedor_prazo from public, anon, authenticated;
grant select on compras.v_fornecedor_prazo to service_role;

create or replace function compras.prazo_fornecedor(p_empresa text, p_fornecedor text,
                                                    out prazo_dias int, out fonte text)
language sql stable set search_path = '' as $$
  select coalesce((select v.prazo_dias from compras.v_fornecedor_prazo v
                    where v.empresa = p_empresa and v.fornecedor_norm = approval._norm_item(p_fornecedor)), 15),
         coalesce((select v.fonte from compras.v_fornecedor_prazo v
                    where v.empresa = p_empresa and v.fornecedor_norm = approval._norm_item(p_fornecedor)), 'estimado')
$$;
revoke all on function compras.prazo_fornecedor(text, text) from public, anon, authenticated;
grant execute on function compras.prazo_fornecedor(text, text) to service_role;

-- A view da lista: as mesmas colunas, na mesma ordem, e as novas no fim.
create or replace view approval.v_rc_projetos_itens as
 WITH pc_status AS (
   SELECT DISTINCT ON (v.empresa, (COALESCE(v.pc_numero, v.pc_numero_manual))) v.empresa,
     COALESCE(v.pc_numero, v.pc_numero_manual) AS pc_key, v.pc_etapa_texto, v.mt_status_fornecimento, v.dt_previsao,
     v.nova_prev_materiais, v.mt_data_recebimento_nf, v.nome_fornecedor, v.valor_total, v.pc_forma_pagamento,
     v.prazo_entrega_dias, v.dt_inclusao
   FROM approval.v_pc_completo_enriched v
   WHERE v.pc_numero IS NOT NULL OR v.pc_numero_manual IS NOT NULL
   ORDER BY v.empresa, (COALESCE(v.pc_numero, v.pc_numero_manual)), v.mt_data_recebimento_nf DESC NULLS LAST)
 SELECT i.id, i.empresa, i.codigo_projeto, i.equipamento, i.item, i.qtd, i.modelo, i.observacao, i.pc_numero,
   s.mt_status_fornecimento AS status_fornec, s.pc_etapa_texto, s.pc_etapa_texto AS pc_etapa_code, s.dt_previsao,
   s.nova_prev_materiais, s.mt_data_recebimento_nf::text AS mt_data_recebimento_nf, s.nome_fornecedor,
   s.valor_total AS pc_valor_total, s.pc_forma_pagamento, s.prazo_entrega_dias, s.dt_inclusao AS pc_dt_inclusao,
   i.criado_em, i.criado_por, i.atualizado_em, i.atualizado_por, i.cat_ncod_prod, i.cat_codigo, i.cat_valor_unit,
   i.cat_fornecedor, i.cat_entrega_dias, i.cat_fat_dias, i.un, i.data_necessaria, i.rc_item_id, i.pc_item_id,
   i.vinculo_via, i.vinculo_score,
   -- 08/10/26 (sql/128)
   pz.prazo_efetivo,
   pz.prazo_fonte,
   (pz.prazo_fonte = 'estimado') AS prazo_estimado,
   (i.data_necessaria - pz.prazo_efetivo - 3) AS comprar_ate
 FROM approval.rc_projetos_itens i
 LEFT JOIN pc_status s ON s.empresa = i.empresa AND s.pc_key = i.pc_numero
 LEFT JOIN compras.v_fornecedor_prazo fp ON fp.empresa = i.empresa AND fp.fornecedor_norm = approval._norm_item(i.cat_fornecedor)
 CROSS JOIN LATERAL (
   SELECT COALESCE(fp.manual, NULLIF(i.cat_entrega_dias, 0)::int, fp.historico, 15) AS prazo_efetivo,
          CASE WHEN fp.manual IS NOT NULL THEN 'manual'
               WHEN NULLIF(i.cat_entrega_dias, 0) IS NOT NULL THEN 'item'
               WHEN fp.historico IS NOT NULL THEN 'historico'
               ELSE 'estimado' END AS prazo_fonte
 ) pz;

-- Acesso pela API (service_role) — o schema compras não é exposto no PostgREST.
create or replace function orders.fornecedor_prazo_listar(p_empresa text)
returns table (fornecedor_norm text, nome text, historico int, manual int, prazo_dias int, fonte text,
               n_itens int, atualizado_em timestamptz, atualizado_por text)
language sql stable security definer set search_path = '' as $$
  select v.fornecedor_norm, v.nome, v.historico, v.manual, v.prazo_dias, v.fonte, v.n_itens, v.atualizado_em, v.atualizado_por
    from compras.v_fornecedor_prazo v where v.empresa = p_empresa
$$;
revoke all on function orders.fornecedor_prazo_listar(text) from public, anon, authenticated;
grant execute on function orders.fornecedor_prazo_listar(text) to service_role;

create or replace function orders.fornecedor_prazo_definir(p_empresa text, p_fornecedor text, p_prazo int, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text := approval._norm_item(p_fornecedor);
begin
  if k = '' then raise exception 'fornecedor vazio'; end if;
  if p_prazo is null then
    delete from compras.fornecedor_prazo where empresa = p_empresa and fornecedor_norm = k;
  else
    if p_prazo < 0 or p_prazo > 365 then raise exception 'prazo fora do intervalo (0 a 365 dias)'; end if;
    insert into compras.fornecedor_prazo (empresa, fornecedor_norm, nome, prazo_dias, atualizado_em, atualizado_por)
    values (p_empresa, k, p_fornecedor, p_prazo, now(), p_por)
    on conflict (empresa, fornecedor_norm) do update
      set prazo_dias = excluded.prazo_dias, nome = excluded.nome, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
  end if;
  return (select to_jsonb(r) from compras.prazo_fornecedor(p_empresa, p_fornecedor) r);
end $$;
revoke all on function orders.fornecedor_prazo_definir(text, text, int, text) from public, anon, authenticated;
grant execute on function orders.fornecedor_prazo_definir(text, text, int, text) to service_role;

notify pgrst, 'reload schema';
