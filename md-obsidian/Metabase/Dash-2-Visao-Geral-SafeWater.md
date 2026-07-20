# Dashboard 2 — Visão Geral SafeWater

> Dashboard homepage. Roll-up executivo com 133 cards em 6 tabs.

**ID:** 2 · **Collection:** Análise Financeira · **Cards:** 133 · **Homepage do Metabase**

## Estrutura em tabs

Não consegui enumerar todas as tabs por SQL de forma barata; ver no Metabase UI. Cards são distribuídos entre tabs (Faturamento, A Pagar, A Receber, Contratos, Operacional, etc).

## Cards de destaque

- **id 198** — "Gastos Operacionais por Técnico" (tab A Pagar) · agrupa `raz_cliente` do Omie decompondo categorias compostas (regex em `des_categoria`). Novo filtro global `Técnico` no dashboard. Introduzido 2026-07-04.

## Filtros globais

- `Período` (temporal)
- `Categoria` (por `codigo_categoria`)
- `Técnico` (por `raz_cliente`, string=) — adicionado 2026-07-04

## Histórico

- **2026-07-04:** Card 198 (Gastos Operacionais por Técnico) + filtro Técnico
- **2026-07-03/04:** Bug MBQL 2.0 field_id remap afetou 64 cards no total (10 detectados no sweep standalone, 64 via sweep com parâmetros aplicados). Fix em bulk. Ver [[../log|log]] 2026-07-02.

## Ver Também

- [[00-Overview-Metabase]]
- [[01-Catalogo-Cards]]

## Tags
#metabase #dashboard #safewater #stub
