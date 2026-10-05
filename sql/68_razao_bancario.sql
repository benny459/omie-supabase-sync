-- 68 — Razão bancário nativo, Omie Cash como banco e conciliação automática (05/10/2026)
-- Aplicado no omie-data como p68_razao_bancario_1 … _5 (+ ajustes in-place descritos abaixo).
--
-- 1. finance.config (corte_financeiro, razao_nativo_ativo, conciliacao_auto) e finance.corte_financeiro().
-- 2. finance.razao_bancario: arquivo nativo das movimentações realizadas do Omie
--    (extratos_cc 2026+ e lancamentos_cc desde 2019, deduplicados por cod_lancamento);
--    finance.razao_importar_omie() (idempotente; cron diário razao-omie-arquivo 23:50).
-- 3. Omie Cash como banco: finance.contas_omie_cash; colunas novas em
--    finance.banco_movimentos (omie_cod_lancamento, omie_cod_titulo, omie_origem,
--    omie_situacao, conciliado_omie, categoria); finance.omie_cash_sincronizar(desde)
--    copia o extrato do Omie Cash (espelho) para o banco nativo. Movimento baixado
--    contra título do Omie (ou débito já classificado no Omie) entra como
--    conciliado_omie — liga, sem nova baixa. Créditos sem título ficam pendentes.
--    OMIE-LEITURA-PERMITIDA: depende do workflow master_finance_diaria (extrato).
--    Cron omie-cash-banco (:40 de hora em hora) = sincronizar + conciliação automática.
-- 4. Conciliação: conciliacao_painel ganhou estado 'omie', flag 'auto', pts_valor/pts_id
--    nas sugestões e exclui movimentos conciliado_omie; conciliar() recusa movimento
--    já baixado no Omie; finance.conciliacao_auto() aceita só: título único com valor
--    exato do saldo + CNPJ ou nº de documento (score >= 90) ou grupo do MESMO documento
--    com soma exata (score >= 90); melhor sugestão sem empate; um título por rodada.
--    Baixas automáticas: criado_por = 'auto' (desfazíveis na tela).
-- 5. BI nativo (não muda as telas atuais): finance.saldo_abertura, finance.saldo_omie_em,
--    finance.v_razao_nativo (antes do corte = arquivo; depois = banco_movimentos
--    desdobrado pelas baixas + baixas sem extrato), bi.dre_resumida_nativo,
--    bi.saldo_por_conta_nativo, bi.conferencia_corte(meses) → tela /bi/conferencia-corte.

create table if not exists finance.config (
  chave text primary key, valor jsonb not null,
  atualizado_em timestamptz not null default now(), atualizado_por text
);
alter table finance.config enable row level security;
revoke all on finance.config from anon, authenticated;
grant all on finance.config to service_role;
insert into finance.config (chave, valor, atualizado_por) values
  ('corte_financeiro', jsonb_build_object('data', '2026-10-05'), 'p68'),
  ('razao_nativo_ativo', jsonb_build_object('ativo', false), 'p68'),
  ('conciliacao_auto', jsonb_build_object('ativa', true, 'score_min', 90, 'score_min_grupo', 90), 'p68')
on conflict (chave) do nothing;

create or replace function finance.corte_financeiro() returns date
language sql stable set search_path = '' as $$
  select coalesce((select (valor->>'data')::date from finance.config where chave = 'corte_financeiro'), current_date)
$$;

create table if not exists finance.razao_bancario (
  id bigserial primary key, empresa text not null, cod_cc bigint not null, data date not null,
  valor numeric(14,2) not null, natureza char(1) not null check (natureza in ('R','P')),
  origem text not null check (origem in ('omie_extrato','omie_lancamento')),
  omie_cod_lancamento bigint not null, omie_cod_titulo bigint, omie_origem text, omie_situacao text,
  tipo_documento text, documento text, nosso_numero text, contraparte text, doc_contraparte text,
  cod_categoria text, des_categoria text, projeto text, historico text, saldo_omie numeric(14,2),
  importado_em timestamptz not null default now(),
  unique (empresa, cod_cc, omie_cod_lancamento)
);
create index if not exists razao_bancario_data on finance.razao_bancario (empresa, cod_cc, data);
create index if not exists razao_bancario_cat on finance.razao_bancario (data, cod_categoria);
alter table finance.razao_bancario enable row level security;
revoke all on finance.razao_bancario from anon, authenticated;
grant all on finance.razao_bancario to service_role;
grant usage, select on sequence finance.razao_bancario_id_seq to service_role;

alter table finance.banco_movimentos
  add column if not exists omie_cod_lancamento bigint, add column if not exists omie_cod_titulo bigint,
  add column if not exists omie_origem text, add column if not exists omie_situacao text,
  add column if not exists conciliado_omie boolean not null default false, add column if not exists categoria text;
create unique index if not exists banco_movimentos_omie_lanc
  on finance.banco_movimentos (empresa, cod_cc, omie_cod_lancamento) where omie_cod_lancamento is not null;

create table if not exists finance.contas_omie_cash (
  empresa text not null, cod_cc bigint not null, descricao text, ativo boolean not null default true,
  primary key (empresa, cod_cc)
);
alter table finance.contas_omie_cash enable row level security;
revoke all on finance.contas_omie_cash from anon, authenticated;
grant all on finance.contas_omie_cash to service_role;
insert into finance.contas_omie_cash (empresa, cod_cc, descricao)
select empresa, cod_cc, descricao from finance.contas_correntes
 where codigo_banco = '450' and tipo_conta_corrente = 'CC' and coalesce(inativo, 'N') <> 'S'
on conflict do nothing;

create table if not exists finance.saldo_abertura (
  empresa text not null, cod_cc bigint not null, data date not null, saldo numeric(14,2) not null,
  fonte text not null default 'omie', atualizado_em timestamptz not null default now(), atualizado_por text,
  primary key (empresa, cod_cc)
);
alter table finance.saldo_abertura enable row level security;
revoke all on finance.saldo_abertura from anon, authenticated;
grant all on finance.saldo_abertura to service_role;

-- Funções: as definições vigentes estão no banco (pg_get_functiondef). Para
-- reproduzir noutro ambiente, exportar:
--   finance.razao_importar_omie(), finance.omie_cash_sincronizar(date),
--   finance.conciliacao_painel(text,bigint,date,date), finance.conciliar(bigint,jsonb,text),
--   finance.conciliacao_auto(text,bigint,date,date), finance.saldo_omie_em(text,bigint,date),
--   bi.dre_resumida_nativo(date,date,text[]), bi.saldo_por_conta_nativo(text[]),
--   bi.conferencia_corte(int,text[]) e a view finance.v_razao_nativo
-- (texto integral das migrações p68_razao_bancario_1..5 no histórico do Supabase).

select cron.schedule('omie-cash-banco', '40 * * * *',
  $$select finance.omie_cash_sincronizar(least(finance.corte_financeiro(), current_date - 7)); select finance.conciliacao_auto(null, null, current_date - 60, current_date + 1);$$);
select cron.schedule('razao-omie-arquivo', '50 23 * * *', $$select finance.razao_importar_omie();$$);

-- 6 (p68_razao_bancario_6_extratos_regras) — extrato de qualquer banco:
--   finance.extrato_importacoes (registo por arquivo: período, saldos do arquivo, novos/duplicados, avisos),
--   finance.extrato_contas_map (banco+agência+conta → conta do painel, "lembrar"),
--   finance.extrato_csv_mapas (mapa de colunas de CSV/XLSX por conta),
--   finance.conciliacao_regras ("contém X" → ignorar | lançar com categoria; por empresa/conta/natureza/valor máx.),
--   finance.extrato_previa(empresa, cod_cc, ini, fim, fitids, saldo_abertura) → duplicados, lacuna, sobreposição, saldo emenda,
--   finance.movimento_lancar(mov, categoria, descricao, usuario) → título nativo (pagar manual / receber painel) + conciliação,
--   finance.regras_aplicar(empresa, cod_cc, de, ate) — roda na importação e no cron omie-cash-banco,
--   ofx_importar grava origem 'csv' quando o FITID é de planilha.
-- conciliacao_painel: baixas de 'auto' e 'regra' aparecem como automáticas.
select cron.unschedule('omie-cash-banco');
select cron.schedule('omie-cash-banco', '40 * * * *',
  $$select finance.omie_cash_sincronizar(least(finance.corte_financeiro(), current_date - 7)); select finance.regras_aplicar(null, null, current_date - 60, current_date + 1); select finance.conciliacao_auto(null, null, current_date - 60, current_date + 1);$$);
