-- p76 (05/10/26): forma de recebimento no PV/OS nativo; vendas_salvar grava forma_recebimento e condicao_descricao (vinda do CRM)
alter table vendas.documentos add column if not exists forma_recebimento text;
-- vendas_salvar: condicao_descricao = coalesce(formas_pagamento.descricao, p->>'condicao_descricao', atual); forma_recebimento = coalesce(upper(p->>'forma_recebimento'), atual) — aplicado via replace no corpo (migração p76_vendas_forma_recebimento)
