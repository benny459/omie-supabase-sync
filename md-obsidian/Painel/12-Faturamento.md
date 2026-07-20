# /relatorios/faturamento — Faturamento Dia-a-Dia

> Relatório de OS+PV faturados por dia, categorizados via `codigo_categoria` Omie. Fonte canônica alinhada com [[../Metabase/Dash-8-Analise-Resultados|Metabase]].

## Rota e componente

- **Rota:** `/relatorios/faturamento`
- **Componente:** `FaturamentoView`
- **API:** `GET /api/relatorios/faturamento?from=YYYY-MM-DD&to=YYYY-MM-DD`
- **View DB:** `approval.v_faturamento_diario` (ver [[../Base-Supabase/Views-Canonicas]])

## Categorias

Herda taxonomia canônica do Metabase (função `public.cat_venda(codigo_categoria)`):

| `codigo_categoria` | Categoria |
|---|---|
| `1.01.01` | **Contratuais** (MRR contratual) |
| `1.01.02` | **Projetos** (faturamento de projeto PJxxx) |
| `1.01.03` | **Revenda** (mercadoria — PVs) |
| `1.01.97` | **Avulsos** (OS avulsa — 40_VS/41_VP) |
| `1.01.98` | **BOT/SW** (recorrente BOT/SW) |
| outros | **Outras** (fallback) |

## UI

- **Controles de período:** Mês corrente / -1 / -2 / -3 mês + custom (De/Até)
- **6 KPIs** — um por categoria, tone visual próprio (emerald, teal, violet, amber, cyan, slate)
- **Stacked bar chart** — dia-a-dia com 12 segmentos (6 categorias × 2 tipos PV/OS). Cores separam PV (frio) de OS (quente). Legenda com toggle por segmento.
- **Tabela por dia** — colunas: Dia · NFs · Total · 12 segmentos coloridos

## Histórico

- **v1.6.4 (2026-07-17)** — reescrita completa. Antes: usava `numero_contrato <> ''` como sinal de "Contrato" (falso positivo — o campo guarda OPS interno). Agora: `public.cat_venda(codigo_categoria)`. Ver commit `56c8941` e [[../../log|log]].

## Ver Também

- [[../Base-Supabase/Views-Canonicas]] — `v_faturamento_diario`, `sales.faturamento_unificado`, `public.cat_venda`
- [[../Metabase/Dash-8-Analise-Resultados]] — mesmo modelo aplicado no BI
- [[10-Avulsos]] — outra visão da mesma base (operacional)

## Tags
#painel-waterworks #relatorios #faturamento #modulo
