# Spec — Dashboard "Rentabilidade por Cliente" (Metabase, consolidado)

> **Cole este arquivo no Claude Code do repo `omie-supabase-sync` (scripts de migração do Metabase).**
> Objetivo: unificar **Faturamento (Omie)** + **Compras (painel)** + **Custo técnico e Despesas (app.waterworks)** num único dashboard de rentabilidade por cliente, filtrável por projeto e técnico.
> É o topo do projeto **Rentabilidade por Cliente**. Contribuições parciais: [[../Painel/RENTABILIDADE-02-painel-waterworks]] e app.waterworks (`RENTABILIDADE-01-app-waterworks` no vault do app).

---

## O elo entre as bases

**Cada cliente tem 1 código Omie único.** É a chave que casa os três mundos:

| Base | Coluna-chave |
|---|---|
| Omie / painel (`omie-data`, `zodflkfdnjhtwcjutbjl`) | `codigo_cliente` |
| app.waterworks (`WW main`, `tfwsakurlgkfnccoovyl`) | `customers.omie_codigo_cliente` |

---

## Arquitetura — Metabase acessando os dois bancos

O Metabase já conecta em múltiplos Postgres read-only (Omie + CRM — ver [[00-Overview-Metabase]]). Adicionar o **WW main como 3ª conexão**:

1. **Nova database no Metabase:** `WaterWorks App (WW main)` apontando para `tfwsakurlgkfnccoovyl`, user `bi_readonly` com `SELECT` só na view `v_custo_por_cliente` (criada pelo spec do app.waterworks).
2. **Limitação conhecida:** o Metabase **não faz JOIN nativo entre databases diferentes** dentro de uma pergunta. Duas saídas possíveis — escolher **A** (recomendada):

   **A) Tabela-ponte materializada em `omie-data` (recomendada).**
   Um job leve (cron nos `scripts/`) lê `v_custo_por_cliente` do WW main e faz `UPSERT` numa tabela `bi.custo_cliente_snapshot` dentro de `omie-data`, chaveada por `(omie_codigo_cliente, technician_id, periodo_mes)`. Assim **todo o JOIN acontece dentro de uma base só** e o Metabase fica simples e rápido.

   **B) Cross-database via modelos/perguntas separadas + combinação no dashboard.**
   Sem sync, mas depende de recursos limitados de junção do Metabase e fica frágil. Só se não quiser o job.

3. Com a opção **A**, criar a view final de consolidação em `omie-data`:

```sql
-- bi.v_rentabilidade_cliente
-- Junta receita+compras (já na base) com custo importado (snapshot).
CREATE OR REPLACE VIEW bi.v_rentabilidade_cliente AS
SELECT
  rc.codigo_cliente,
  rc.cliente_nome,
  rc.codigo_projeto,
  rc.tipo_venda,                         -- cat_venda(): Contratuais/Projetos/Avulsos/...
  rc.periodo_mes,
  rc.faturamento,
  rc.total_compras,
  COALESCE(cc.despesas_empresa, 0)  AS despesas,
  COALESCE(cc.custo_mao_obra, 0)    AS custo_mao_obra,
  cc.technician_id,
  cc.technician_nome,
  rc.faturamento
    - rc.total_compras
    - COALESCE(cc.despesas_empresa,0)
    - COALESCE(cc.custo_mao_obra,0)      AS rentabilidade,
  CASE WHEN rc.faturamento > 0 THEN
    (rc.faturamento - rc.total_compras - COALESCE(cc.despesas_empresa,0) - COALESCE(cc.custo_mao_obra,0))
    / rc.faturamento
  END                                    AS margem
FROM sales.v_cliente_receita_compras rc          -- do spec do painel (item 4)
LEFT JOIN bi.custo_cliente_snapshot cc
  ON cc.omie_codigo_cliente = rc.codigo_cliente
 AND cc.periodo_mes         = rc.periodo_mes;
```

> Se o painel **não** criar `v_cliente_receita_compras`, montar a receita direto de `sales.faturamento_unificado` + `v_compras_por_cliente` aqui.

---

## Dashboard — cards e filtros

**Novo dashboard:** `Rentabilidade por Cliente — SafeWater` (seguir padrão dos dashboards 3/7/8, ver [[01-Catalogo-Cards]]). Criar via script idempotente no estilo de `rebuild_analise_resultados.py`.

### Filtros do topo (parâmetros do dashboard)
| Filtro | Campo | Tipo |
|---|---|---|
| Período | `periodo_mes` | date range |
| Projeto | `codigo_projeto` | dropdown (inclui "Todos") |
| Tipo | `tipo_venda` | dropdown (Contrato/Projeto/Avulso...) |
| Técnico | `technician_nome` | dropdown |

### Cards
1. **KPIs (4 números):** Faturamento · Custo Técnico+Despesas · Compras · Rentabilidade (com margem %).
2. **Tabela por cliente** — colunas: Cliente · Tipo · Faturamento · Custo Téc. · Despesas · Compras · Rentabilidade · Margem% (barra colorida verde/vermelho). Ordenar por rentabilidade desc.
3. **Top clientes com prejuízo** — filtro `rentabilidade < 0` (espelha o card 173 do [[Dash-7-Margem-por-Projeto]]).
4. **Rentabilidade por tipo de venda** — barras: Contrato vs Projeto vs Avulso (mostra onde o avulso corrói margem).
5. **Última atualização dos dados** — timestamp do snapshot (igual card 150 do Dash 7).

### Gráficos comparativos (importantes — comparação entre clientes)
6. **Faturamento × Custos por cliente (barras agrupadas)** — por cliente, uma barra de Faturamento e outra de Custos empilhados (Compras + Custo técnico + Despesas). Deixa visível na hora quando os custos passam a receita (prejuízo). Metabase: bar chart, série faturamento vs série custo, dimensão = cliente.
7. **Ranking de margem % (barras divergentes)** — clientes ordenados por `margem`, barras positivas (verde) à direita e negativas (vermelho) à esquerda de um zero central. Card tabular/bar ordenado desc.
8. **Composição de custo por cliente (barra 100% empilhada)** — cada cliente = 1 barra dividida em Compras / Custo técnico / Despesas, mostrando para onde vai o dinheiro. Bom pra achar cliente com compra desproporcional.
9. **Tendência de rentabilidade mês a mês (linha)** — série temporal de `rentabilidade` por `periodo_mes`, respeitando o filtro de cliente selecionado. Detecta cliente que está piorando ao longo do tempo.

Todos os gráficos herdam os mesmos filtros do topo (período/projeto/tipo/técnico).

Layout de referência: ver os 2 mockups aprovados — (a) KPIs + tabela com margem colorida; (b) 4 gráficos comparativos (barras faturamento×custo, ranking de margem divergente, composição de custo, linha de tendência).

---

## Entregáveis

1. Conexão `WW main` read-only no Metabase.
2. (Opção A) Cron `scripts/sync-custo-cliente.*` → `bi.custo_cliente_snapshot` + view `bi.v_rentabilidade_cliente`.
3. Script idempotente que cria o dashboard `Rentabilidade por Cliente`.
4. Atualizar [[00-Overview-Metabase]] (lista de dashboards + bases conectadas) + [[01-Catalogo-Cards]] + append em `log.md` (prefixo `[metabase]`).

## Checklist de aceite

- [ ] Todo cliente com Omie aparece com faturamento, custo, compras e rentabilidade.
- [ ] Filtros projeto/tipo/técnico afetam todos os cards.
- [ ] Clientes com avulso deficitário aparecem em "Top prejuízo".
- [ ] Snapshot atualiza no cron e "Última atualização" reflete.
- [ ] Números batem com as prévias de cada plataforma para o mesmo período.

## Ver Também
- [[Dash-7-Margem-por-Projeto]] — margem por projeto (base parcial deste)
- [[Dash-3-Faturamento]] — fonte de receita
- [[../Base-Supabase/Views-Canonicas]] — views e `cat_venda`

## Tags
#metabase #rentabilidade #dashboard #consolidado #spec
