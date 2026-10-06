-- 06/10/26: parcelas do fechamento de projeto (CRM 2.6.641) trazem nome do evento
-- e data prevista de faturamento. vendas_salvar passa a gravá-los (aplicado via
-- replace no corpo da função — ver migração p90 no banco).
alter table vendas.parcelas add column if not exists descricao text, add column if not exists faturamento_previsto date;
