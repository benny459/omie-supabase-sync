# Dashboard 8 — Análise de Resultados

> BI executivo consolidado, 8 cards + 2 novos planejados (9 e 10). Recriado em 2026-07-02 via `rebuild_analise_resultados.py` (idempotente).

**ID:** 8 · **Collection:** Análise Financeira (id 6) · **Cards ativos:** 8 · **Filtros globais:** `mes_ref`, `janela_meses`

## Spec canônico

Ver [[../Sources/metabase-analise-resultados]] pra spec completa com SQL testado.

## Cards ativos (fase 1)

| # | Nome | Tipo |
|---:|---|---|
| 1 | KPIs (Receita · Custos · Fluxo · Break-even) | KPIs |
| 2 | Cash Flow Mensal (12m) | Combo/Line |
| 3 | Break-even Dinâmico (rolling 3m) | Line |
| 4 | Aging AR/AP | Bar |
| 5 | Folha % Receita | Line |
| 6 | Delta Inexplicado Diário | Line |
| 7 | MRR Contratado × Faturado (top gaps) | Table |
| 8 | Pareto Outras Saídas | Bar |

## Cards planejados (fase 2 — a criar)

- **Card 9 — Margem de Contribuição por Segmento** — decompõe custos variáveis (COGS Revenda, COGS MP, Insumos, Folha PJ, Cartão CS, Devoluções) por segmento (MRR, Projetos, Revenda, Avulsos, BOT/SW) via **matriz de atribuição fixa** documentada. Margem estimada (jun/26): MRR 60% · Projetos 61% · BOT/SW 92% · Revenda 1% · Avulsos 0%.
- **Card 10 — Simulador de Break-even por Mix** — input: receita esperada por segmento + custo fixo; output: contribuição total, break-even ponderado, folga/déficit, quanto de Projetos adicional pra fechar.

Matriz de atribuição resumida:
- COGS Revenda → 100% Revenda
- COGS MP → 85% Projetos + 10% Avulsos + 5% MRR
- Insumos → 80% MRR + 15% Projetos + 5% Avulsos
- Folha PJ → 50% MRR + 20% Projetos + 20% Avulsos + 5% Revenda + 5% BOT/SW
- Cartão CS técnicos → 50% MRR + 30% Projetos + 15% Avulsos + 5% Revenda

Ver spec completa em [[../Sources/metabase-analise-resultados]].

## Fonte de dados

- `finance.v_extratos_consolidado` (UNION extratos_cc + despesas_cartao_cs) — Cards 1, 2, 3, 5, 8
- `finance.pesquisa_titulos` — Cards 4, 7
- `finance.v_titulos_com_tipo_venda` — Card 7 (MRR gap)

## Descobertas-chave (2026-07-01)

- Saldo caiu R$ 389k → R$ 69k em 6 meses; operacional zero-a-zero (-R$ 20k/mês)
- Sem dívida bancária substancial; única real é parcelamento tributário (R$ 19k/mês)
- Grande parte da queda de saldo vem de aplicações/resgates financeiros não categorizados (ex: R$ 689k saindo 11/abr e voltando 12/abr)
- AP vencido REAL (excluindo legado <2025): R$ 1,05M
- **Regras de ouro:** piso receita R$ 700k/mês · folha ≤ 40% receita · reserva ≥ 45 dias saídas

## Impacto do import Cartão CS (2026-07-02)

Comparação antes/depois de trazer despesas Cartão CS pra `v_extratos_consolidado`:

| | Antes | Depois |
|---|---:|---:|
| Fluxo líquido jun/26 | +R$ 8k | **−R$ 24.569** |
| Break-even (rolling 3m) | R$ 612k | **R$ 746.440** |
| Folga vs receita | +R$ 28k | **−R$ 63.702** |
| % variável | ~34% | **57,2%** |

Benny operava com viés positivo de ~R$ 90k/mês. Break-even real é ~R$ 130k mais alto que percebido.

## Ver Também

- [[../Sources/metabase-analise-resultados]] — spec canônico completo com SQL
- [[../Sources/bi-decisao-plano-b]] — decisão de arquitetura BI
- [[00-Overview-Metabase]]
- [[../Base-Supabase/Views-Canonicas]] — `v_extratos_consolidado`, `v_titulos_com_tipo_venda`

## Tags
#metabase #dashboard #analise-resultados #bi
