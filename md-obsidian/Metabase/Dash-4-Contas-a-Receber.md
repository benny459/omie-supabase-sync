# Dashboard 4 — Contas a Receber SafeWater

**ID:** 4 · **Cards:** 16

## Cards

| ID | Nome |
|---:|---|
| 47 | Pontualidade Mensal — A Receber |
| 48 | A Receber por Categoria |
| 52 | A Vencer |
| 60 | AR — Vence Hoje |
| 65 | Total em Atraso |
| 70 | Top Devedores |
| 86 | AR — Vence Amanhã |
| 109 | AR — Esta Semana |
| 120 | AR — Próximos 30 Dias (por Previsão de Pagamento) |
| 134 | Aging — A Receber |
| 150 | Última Atualização dos Dados |
| 156 | Detalhe de Títulos a Receber |
| 158 | Pontualidade Acumulada — A Receber (Ano) |
| 168 | Saldo Total Aberto |
| 181 | Quantidade de Títulos Abertos |
| 186 | Evolução Mensal (Emitido vs Recebido) |

## Fonte de dados

- `finance.pesquisa_titulos` filtrado por `natureza='R'` e `status<>'CANCELADO'`
- Aging calculado sobre `dt_vencimento_d` e `dt_pagamento_d`

## Nota AR real (2026-07-01)

Análise concluiu: **AP vencido REAL** (excluindo legado <2025) = R$ 1,05M. Filtragem por data de emissão >= 2025-01-01 é essencial pra evitar ruído histórico.

## Ver Também

- [[00-Overview-Metabase]]
- [[Dash-5-Contas-a-Pagar]] (espelho AP)

## Tags
#metabase #dashboard #ar #safewater
