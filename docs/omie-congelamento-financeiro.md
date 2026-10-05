# Congelamento da importação de títulos do Omie — 05/10/2026

Autorizado pelo Benny ("Pode congelar"). A equipe financeira não mexe mais no Omie.

## O que foi desligado
- `master_finance_diaria.yml`: passos 1 (Contas a Pagar), 2 (Contas a Receber),
  3 (Pesquisa Títulos) e 5 (Finance Cadastros) só rodam à mão
  (`if: github.event_name == 'workflow_dispatch'  # CONGELADO`).
  No agendamento roda só o passo 4 (Extratos CC) — OMIE-LEITURA-PERMITIDA
  (alimenta Omie Cash e o razão).
- `master_finance_full.yml`: `gh workflow disable master_finance_full.yml`
- `master_finance_semanal.yml`: `gh workflow disable master_finance_semanal.yml`

## Mantido
- pg_cron `omie-cash-banco` (:40 de hora em hora) e `razao-omie-arquivo` (23:50).
- Foto do estado antes do congelamento: `finance.snap_omie_titulos_20261005`,
  `finance.snap_omie_lanc_20261005`.

## Como religar
1. Apagar as linhas `if: github.event_name == 'workflow_dispatch'  # CONGELADO ...`
   em `master_finance_diaria.yml` e fazer push.
2. `gh workflow enable master_finance_full.yml`
3. `gh workflow enable master_finance_semanal.yml`

Rodar um passo congelado uma vez, à mão: `gh workflow run master_finance_diaria.yml`
(o dispatch executa todos os passos, inclusive os congelados).
