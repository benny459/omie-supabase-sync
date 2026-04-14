-- Fix: adicionar colunas faltantes nos importers Finance
ALTER TABLE finance.contas_pagar ADD COLUMN IF NOT EXISTS categorias_rateio TEXT;
ALTER TABLE finance.contas_receber ADD COLUMN IF NOT EXISTS boleto_dt_emissao TEXT;
ALTER TABLE finance.contas_receber ADD COLUMN IF NOT EXISTS boleto_cod_banco TEXT;
ALTER TABLE finance.contas_receber ADD COLUMN IF NOT EXISTS boleto_agencia TEXT;
ALTER TABLE finance.contas_receber ADD COLUMN IF NOT EXISTS boleto_conta TEXT;
ALTER TABLE finance.contas_receber ADD COLUMN IF NOT EXISTS boleto_carteira TEXT;
ALTER TABLE finance.clientes ADD COLUMN IF NOT EXISTS cidade_ibge TEXT;
ALTER TABLE finance.clientes ADD COLUMN IF NOT EXISTS pessoa_fisica TEXT;
ALTER TABLE finance.clientes ADD COLUMN IF NOT EXISTS optante_simples TEXT;
ALTER TABLE finance.clientes ADD COLUMN IF NOT EXISTS produtor_rural TEXT;
ALTER TABLE finance.categorias ADD COLUMN IF NOT EXISTS categoria_superior TEXT;
ALTER TABLE finance.projetos ADD COLUMN IF NOT EXISTS cod_int TEXT;
ALTER TABLE finance.contas_correntes ADD COLUMN IF NOT EXISTS cod_cc_int TEXT;
ALTER TABLE finance.empresas ADD COLUMN IF NOT EXISTS alteracao_data TEXT;
ALTER TABLE finance.empresas ADD COLUMN IF NOT EXISTS inclusao_data TEXT;
ALTER TABLE finance.lancamentos_cc ADD COLUMN IF NOT EXISTS categorias TEXT;
ALTER TABLE finance.parcelas ADD COLUMN IF NOT EXISTS n_parcelas NUMERIC;
ALTER TABLE finance.bancos ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE finance.dre ADD COLUMN IF NOT EXISTS codigo_dre TEXT;
ALTER TABLE finance.dre ADD COLUMN IF NOT EXISTS descricao_dre TEXT;
ALTER TABLE finance.dre ADD COLUMN IF NOT EXISTS nivel_dre TEXT;
ALTER TABLE finance.dre ADD COLUMN IF NOT EXISTS sinal_dre TEXT;
ALTER TABLE finance.dre ADD COLUMN IF NOT EXISTS natureza_dre TEXT;

SELECT 'ALL FIXES APPLIED' as status;
