-- 06/10/26: projeto emitido por evento do fechamento (CRM 2.6.647) cria vários PV/OS
-- por proposta. vendas.documentos.evento + trava de duplicado em vendas_salvar passa a
-- ser (proposta, tipo, evento) quando o CRM manda "evento"; sem evento, igual a antes.
-- Aplicado como migração p94 (replace no corpo de orders.vendas_salvar).
alter table vendas.documentos add column if not exists evento text;
