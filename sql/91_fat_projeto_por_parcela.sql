-- 06/10/26: faturar PV/OS de projeto por parcela do fechamento (CRM 2.6.641).
-- Aplicado no zodflkfdnjhtwcjutbjl como migrações p91 / p91b / p91c.
--  * vendas.parcelas: faturada_em + emissao_ref ('fat:<fat_emissoes.id>' | 'nfse:<fat_nfse_manual.id>')
--  * orders.fat_emissoes.venda_parcelas int[]: parcelas que a nota fatura (várias notas por origem)
--  * orders.vendas_marcar_faturado(p_id, p_doc): p_doc.parcelas marca só essas; documento só
--    vira "faturado" quando não sobra parcela; vendas_desfazer_faturado solta as parcelas da nota.
--  * vendas.espelhar: previsão no espelho = faturamento previsto da próxima parcela aberta.
--  * orders.fat_carteira: 'parcelas' (cronograma) e previsão = próxima parcela por faturar;
--    'nfse_registrada' só quando todas as parcelas estão faturadas.
--  * orders.fat_nfse_registrar: os[].parcelas → uma NFS-e por parcela; bloqueia parcela já faturada.
--  * orders.fat_nfse_prefill: 'parcelas_projeto' (com prazo = vencimento − faturamento previsto).
-- Os corpos completos ficam no banco (pg_get_functiondef); os patches foram feitos por
-- replace() no corpo existente, com verificação do padrão (falha se não encontrado).
alter table vendas.parcelas add column if not exists faturada_em timestamptz, add column if not exists emissao_ref text;
alter table orders.fat_emissoes add column if not exists venda_parcelas int[];
-- p91d: vendas_desfazer_faturado mantém o nº das notas quando ainda há parcela faturada.
-- p91e: fat_nfse_registrar — subconsulta usa p->'os' (a variável "os" colidia com a coluna fat_nfse_manual.os).
