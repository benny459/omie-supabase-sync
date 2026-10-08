-- 141 · Prazo de entrega ajustado POR ITEM na lista de materiais (08/10/26, Benny:
-- "marcar o prazo médio considerado em dias de chegada dos itens da lista … deixar o compras
-- alterar e mostrar aonde houve alteração").
--
-- • approval.rc_projetos_itens ganha o prazo manual do item e quem/quando mudou:
--     prazo_dias_manual  dias (0–365); nulo = vale o automático
--     prazo_por          quem ajustou (nome ou e-mail)
--     prazo_em           quando
-- • approval.v_rc_projetos_itens: as MESMAS colunas na MESMA ordem (sql/128); muda só a
--   precedência do prazo efetivo e entram colunas novas NO FIM.
--     prazo_efetivo = manual do ITEM → manual do fornecedor (⏱ Prazos por fornecedor)
--                     → cat_entrega_dias do item → histórico do fornecedor → 15 (estimado)
--     prazo_fonte   = 'item_manual' | 'manual' | 'item' | 'historico' | 'estimado'
--     comprar_ate   = data_necessaria − prazo_efetivo − 3 (folga, lib/sinal-entrega FOLGA_ENTREGA_DIAS)
--   colunas novas: prazo_dias_manual, prazo_por, prazo_em, prazo_auto (o prazo sem o ajuste
--   do item — o valor riscado na tela) e prazo_auto_fonte.
--   A tela calcula o mesmo em web/lib/planejamento-compras.ts (prazoEfetivo).
--
-- Só colunas novas, todas nulas: nada muda para quem não ajusta o prazo do item.
-- A tela funciona sem esta migração (o prazo aparece, a edição fica desligada).
--
-- NÃO APLICADA — aplicar só depois do "aprovado" do Benny (preview em localhost).

alter table approval.rc_projetos_itens
  add column if not exists prazo_dias_manual int,
  add column if not exists prazo_por         text,
  add column if not exists prazo_em          timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rc_projetos_itens_prazo_manual_chk') then
    alter table approval.rc_projetos_itens
      add constraint rc_projetos_itens_prazo_manual_chk
      check (prazo_dias_manual is null or prazo_dias_manual between 0 and 365);
  end if;
end $$;

comment on column approval.rc_projetos_itens.prazo_dias_manual is
  'Prazo de entrega (dias) ajustado à mão para ESTE item na lista de materiais; vence o do fornecedor e o do catálogo. Nulo = automático.';

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
   -- 08/10/26 (sql/128; precedência com o manual do item desde a sql/141)
   COALESCE(i.prazo_dias_manual, pz.prazo_auto) AS prazo_efetivo,
   CASE WHEN i.prazo_dias_manual IS NOT NULL THEN 'item_manual' ELSE pz.prazo_auto_fonte END AS prazo_fonte,
   (i.prazo_dias_manual IS NULL AND pz.prazo_auto_fonte = 'estimado') AS prazo_estimado,
   (i.data_necessaria - COALESCE(i.prazo_dias_manual, pz.prazo_auto) - 3) AS comprar_ate,
   -- 08/10/26 (sql/141)
   i.prazo_dias_manual,
   i.prazo_por,
   i.prazo_em,
   pz.prazo_auto,
   pz.prazo_auto_fonte
 FROM approval.rc_projetos_itens i
 LEFT JOIN pc_status s ON s.empresa = i.empresa AND s.pc_key = i.pc_numero
 LEFT JOIN compras.v_fornecedor_prazo fp ON fp.empresa = i.empresa AND fp.fornecedor_norm = approval._norm_item(i.cat_fornecedor)
 CROSS JOIN LATERAL (
   SELECT COALESCE(fp.manual, NULLIF(i.cat_entrega_dias, 0)::int, fp.historico, 15) AS prazo_auto,
          CASE WHEN fp.manual IS NOT NULL THEN 'manual'
               WHEN NULLIF(i.cat_entrega_dias, 0) IS NOT NULL THEN 'item'
               WHEN fp.historico IS NOT NULL THEN 'historico'
               ELSE 'estimado' END AS prazo_auto_fonte
 ) pz;

notify pgrst, 'reload schema';
