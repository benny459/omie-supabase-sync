-- P-COMPRAS (05/10/2026, autorizado pelo Benny): compras não importam mais nada do Omie.
-- RC e PC nascem só no painel; NF de entrada vem da Focus (import_focus_recebidos).
-- O espelho (orders.pedidos_compra / recebimento_nfe / nfe_entrada / requisicoes_compra)
-- e compras.pedidos com origem='omie' ficam como histórico congelado (só leitura nas telas).
--
-- Desligados aqui (pg_cron, projeto omie-data zodflkfdnjhtwcjutbjl):
select cron.unschedule('capturar-rcs-omie');      -- era: '5 * * * *'      SELECT approval.rc_pipeline()
select cron.unschedule('conciliar-compras-omie'); -- era: '25,55 * * * *'  SELECT compras.conciliar_omie()
--
-- Para religar:
--   select cron.schedule('capturar-rcs-omie',      '5 * * * *',     'SELECT approval.rc_pipeline()');
--   select cron.schedule('conciliar-compras-omie', '25,55 * * * *', 'SELECT compras.conciliar_omie()');
--
-- Workflows do GitHub (mesmo commit): import_requisicoes.yml e master_orders_diaria.yml sem agenda
-- (só workflow_dispatch); master_orders_semanal.yml passo 2 (PCs) só à mão; sync_quick.yml passo 2
-- (PCs) desligado; /api/pcs/force-sync devolve 410 (religar com COMPRAS_OMIE_IMPORT=on).
