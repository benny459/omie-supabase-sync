# Dashboard 5 — Contas a Pagar SafeWater

**ID:** 5 · **Cards:** 16

## Cards

| ID | Nome |
|---:|---|
| 41 | Pontualidade Acumulada — A Pagar (Ano) |
| 56 | AP — Próximos 30 Dias (por Previsão) |
| 97 | A Pagar por Categoria × Projeto |
| 102 | Quantidade Aberto |
| 104 | Cobertura Mensal — Comprado × Emitido × Pago (A Pagar) |
| 118 | Detalhe de Títulos a Pagar |
| 126 | Vence nos Próximos 30 Dias |
| 132 | Despesas por Grupo |
| 141 | Total Aberto |
| 148 | A Pagar por Projeto |
| 150 | Última Atualização dos Dados |
| 152 | Total Pago |
| 161 | AP — Vence Amanhã |
| 163 | AP — Vence Hoje |
| 177 | AP — Esta Semana |
| 180 | Pontualidade Mensal — A Pagar |

## Fonte de dados

- `finance.pesquisa_titulos` filtrado por `natureza='P'` e `status<>'CANCELADO'`
- Cross-check com `finance.v_extratos_consolidado` (extratos_cc + despesas_cartao_cs)

## Ver Também

- [[00-Overview-Metabase]]
- [[Dash-4-Contas-a-Receber]] (espelho AR)
- [[../Sources/metabase-analise-resultados]] — spec do Card 3 (Cash Flow) usa AP

## Tags
#metabase #dashboard #ap #safewater
