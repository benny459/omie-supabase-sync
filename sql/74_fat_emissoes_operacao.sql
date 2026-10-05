-- p74 (05/10/26): NF-e não-venda (devolução de compra, simples remessa, conserto)
alter table orders.fat_emissoes add column if not exists operacao jsonb;
comment on column orders.fat_emissoes.operacao is 'NF-e não-venda (05/10/26): {tipo: devolucao|remessa|conserto, nf_ref:{chave,numero,serie,emitente_doc,emissao}, motivo, projeto_codigo, projeto_nome, cliente_projeto, gera_cobranca}';
create index if not exists fat_emissoes_operacao_tipo on orders.fat_emissoes ((operacao->>'tipo')) where operacao is not null;
