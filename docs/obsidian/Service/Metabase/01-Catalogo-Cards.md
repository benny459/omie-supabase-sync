# Metabase — Catálogo de Cards

> Índice ranger dos 190 cards ativos (fora o sample E-commerce Insights). Cards duplicados 150 ("Última Atualização") aparecem em vários dashboards — é um card compartilhado.

## Por dashboard

- [[Dash-2-Visao-Geral-SafeWater]] — 133 cards
- [[Dash-3-Faturamento]] — 7 cards
- [[Dash-4-Contas-a-Receber]] — 16 cards
- [[Dash-5-Contas-a-Pagar]] — 16 cards
- [[Dash-6-Contratos-CT]] — 6 cards
- [[Dash-7-Margem-por-Projeto]] — 4 cards
- [[Dash-8-Analise-Resultados]] — 8 cards

## Cards frequentemente referenciados

- **id 150** — "Última Atualização dos Dados" (aparece em 5 dashboards)
- **id 82** — "Total Faturado — Mês Atual" — usa `sales.faturamento_unificado` + filtro `codigo_categoria`
- **id 116** — "Faturamento Mensal por Categoria" — SQL de referência da taxonomia [[../Base-Supabase/Views-Canonicas|cat_venda]]
- **id 123** — "Detalhe de Faturamento" — enriched com fantasia/CNPJ
- **id 137** — "Faturamento Acumulado por Categoria" — usa `finance.v_titulos_com_tipo_venda`
- **id 198** — "Gastos Operacionais por Técnico" (2026-07-04) — regex parser em `des_categoria`

## Como listar direto do Metabase

```bash
ssh root@188.245.161.139
docker exec metabase-db psql -U metabase -d metabaseappdb -t -A -F'|' -c \
  "SELECT id, name FROM report_card WHERE archived = false ORDER BY id;"
```

Pra ver SQL de um card específico:

```sql
SELECT dataset_query::text FROM report_card WHERE id = 116;
```

## Ver Também

- [[00-Overview-Metabase]]

## Tags
#metabase #catalogo #cards
