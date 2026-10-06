-- 06/10/26 (Benny): conta a pagar com nº documento ou NF obrigatório (validação na rota),
-- "Gerar nº" único por empresa, emissão vazia = data do lançamento e código de barras do boleto.
-- Aplicado como migração p96:
--  · finance.doc_seq + finance.pagar_gerar_documento(empresa) → 'PG-SF-AAMM-000001'
--  · finance.pagar_manual_incluir: emissao default = hoje (America/Sao_Paulo);
--    p.codigo_barras (só dígitos) gravado em extras.codigo_barras (o arquivo C6 já lê dali)
--  · finance.pagar_codigo_barras_salvar(id, barras, usuario) — edição
--  · finance.pagar_detalhe_doc(ref) — emissão e código de barras para a gaveta
create table if not exists finance.doc_seq (empresa text primary key, ultimo bigint not null default 0);
