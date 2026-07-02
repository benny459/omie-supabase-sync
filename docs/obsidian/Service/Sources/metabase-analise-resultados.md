---
source_type: dashboard-spec
author: benny + claude
url_original: (Metabase 100.64.8.120:3000)
ingested_at: 2026-07-01
last_updated: 2026-07-02
---

# Metabase — Aba "Análise de Resultados"

> Dashboard completo de análise financeira WW/SafeWater. 8 cards. SQL testado no Supabase (jul/2026). Reflete análise de 2026 com retirada do sócio como custo fixo obrigatório.

## Atualização 2026-07-02 — fonte de dados

Cards 1, 2, 3, 5 e 8 agora leem de **`finance.v_extratos_consolidado`** (view que une `extratos_cc` do sync Omie + `despesas_cartao_cs` import manual jan-jun/2026 do Cartão Conta Simples).

- Antes: só `extratos_cc` → gastos do Cartão CS invisíveis (~R$ 30k/mês)
- Agora: view UNION → gastos do cartão aparecem categorizados corretamente
- **Card 6 (Delta Inexplicado) mantém `extratos_cc` direto** — depende do saldo running que só existe lá
- Cards 4 (Aging) e 7 (MRR) leem outras tabelas, não afetados

Nomes de coluna na view:
- `data` (era `data_lancamento_d`)
- `valor` (era `valor_documento`)
- `fornecedor` (era `raz_cliente`)
- `situacao` (view marca cs_import como 'Conciliado')
- `natureza`, `des_categoria`, `cod_categoria` — iguais

## Como usar este arquivo

1. No Metabase, criar novo Dashboard chamado **"Análise de Resultados"**
2. Para cada card abaixo: **+ New question → Native query → SQL (não GUI)**
3. Colar o SQL, escolher visualização indicada, adicionar filtros/parâmetros descritos
4. Salvar cada pergunta no Collection "Análise Financeira" (ou criar)
5. Adicionar cada card ao Dashboard, no layout sugerido no fim

## Filtros globais do dashboard (variáveis parametrizadas)

Adicionar como **Dashboard filters** que conectam a variáveis SQL `{{param_name}}`:

| Filtro | Tipo | Default | Uso |
|---|---|---|---|
| `mes_ref` | Date · Month Year | mês atual | KPIs e break-even do mês |
| `janela_meses` | Number | 12 | Rolling window pra trend |
| `empresa` | Text (opcional) | (all) | Se quiser filtrar SafeWater vs WW |

Sintaxe Metabase Native SQL: `[[AND empresa = {{empresa}}]]` (colchetes = opcional).

---

## Card 1 — KPIs do Mês (grid superior)

**Visualização:** 4 números grandes lado a lado (usar 4 perguntas separadas OU 1 pergunta com Number visualization e Multi-KPI)
**Filtro:** `mes_ref`

```sql
WITH parametros AS (SELECT {{mes_ref}}::date AS mes_ref),
mov_mes AS (
  SELECT
    SUM(CASE WHEN natureza='R'
             AND situacao='Conciliado'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE '%Obten%Empr%'
             THEN valor ELSE 0 END) receita_mes,
    SUM(CASE WHEN natureza='P'
             AND situacao='Conciliado'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE 'Empr%SAFE'
             AND des_categoria NOT ILIKE 'Empr%CDG'
             AND des_categoria NOT ILIKE 'Empr%WaterWorks'
             THEN valor ELSE 0 END) saida_mes
  FROM finance.v_extratos_consolidado
  WHERE data BETWEEN (SELECT mes_ref FROM parametros)
                 AND (SELECT (mes_ref + INTERVAL '1 month - 1 day')::date FROM parametros)
),
saldo_atual AS (
  -- Saldo running só existe em extratos_cc — não muda com cs_import
  SELECT SUM(saldo_fim)::numeric(14,2) saldo_hoje
  FROM (
    SELECT DISTINCT ON (cod_conta_corrente) cod_conta_corrente, saldo saldo_fim
    FROM finance.extratos_cc
    WHERE data_lancamento_d <= (SELECT (mes_ref + INTERVAL '1 month - 1 day')::date FROM parametros)
    ORDER BY cod_conta_corrente, data_lancamento_d DESC, cod_lancamento DESC
  ) x
)
SELECT
  m.receita_mes::numeric(14,2)     "Receita mês (R$)",
  m.saida_mes::numeric(14,2)       "Saídas mês (R$)",
  (m.receita_mes + m.saida_mes)::numeric(14,2) "Fluxo líquido (R$)",
  s.saldo_hoje                     "Saldo consolidado (R$)"
FROM mov_mes m, saldo_atual s;
```

**Config Metabase:**
- Visualization: **Table** (ou Number com 4 perguntas separadas para KPI board)
- Formatação: BRL currency, 2 decimais
- Conditional formatting: Fluxo Líquido — vermelho se < 0, verde se > 50k

---

## Card 2 — Cash Flow Mensal por Grupo (12 meses)

**Visualização:** Bar chart empilhado (stacked bar) OU line chart multi-series
**Filtro:** `janela_meses` (default 12)

```sql
WITH mov AS (
  SELECT
    date_trunc('month', data)::date mes,
    CASE
      WHEN natureza='R' AND des_categoria ILIKE 'Clientes -%' THEN '01_receita_clientes'
      WHEN natureza='R' AND (des_categoria ILIKE '%Projetos%' OR des_categoria='Receita BOT e SW') THEN '02_receita_projetos'
      WHEN natureza='R' AND des_categoria = 'Adiantamento de Clientes' THEN '03_adto_clientes'
      WHEN natureza='R' AND des_categoria NOT ILIKE '%Transfer%' AND des_categoria NOT ILIKE '%Obten%Empr%' THEN '04_outras_entradas'
      WHEN natureza='P' AND des_categoria = 'Antecipação / Distribuição de Lucro' THEN '10_retirada_socio'
      WHEN natureza='P' AND des_categoria IN ('Serviços Prestados PJ','Empréstimo') THEN '11_folha_PJ'
      WHEN natureza='P' AND des_categoria IN ('Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário') THEN '12_folha_CLT'
      WHEN natureza='P' AND des_categoria IN ('Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete','Compras Material em Garantia','Custo dos Serviços Prestados') THEN '13_COGS'
      WHEN natureza='P' AND des_categoria = 'Simples Nacional (DAS)' THEN '14_DAS_corrente'
      WHEN natureza='P' AND des_categoria IN ('Parcelamento Impostos','Parcelamento de Impostos') THEN '15_divida_tributaria'
      WHEN natureza='P' AND des_categoria IN ('Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível') THEN '16_frota'
      -- NOVO: categorias do Cartão CS (import manual)
      WHEN natureza='P' AND des_categoria IN ('Combustível por Km','Outros Meios de Transporte','Reserva de Hotel') THEN '16_frota'
      WHEN natureza='P' AND des_categoria IN ('Despesa Extra com Refeição') THEN '12_folha_CLT'
      WHEN natureza='P' AND des_categoria IN ('Ferramentas de trabalho','Correios') THEN '19_outras_saidas'
      WHEN natureza='P' AND des_categoria = 'Locação de Sistemas' THEN '18_admin_fixo'
      WHEN natureza='P' AND des_categoria IN ('Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas') THEN '17_juridico'
      WHEN natureza='P' AND des_categoria IN ('Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio') THEN '18_admin_fixo'
      WHEN natureza='P' AND des_categoria NOT ILIKE '%Transfer%' AND des_categoria NOT ILIKE 'Empr%SAFE' AND des_categoria NOT ILIKE 'Empr%CDG' AND des_categoria NOT ILIKE 'Empr%WaterWorks' THEN '19_outras_saidas'
      ELSE NULL END grupo,
    valor
  FROM finance.v_extratos_consolidado
  WHERE data >= CURRENT_DATE - ({{janela_meses}}||' months')::interval
    AND situacao='Conciliado'
)
SELECT mes, grupo, SUM(valor)::numeric(14,2) valor
FROM mov WHERE grupo IS NOT NULL
GROUP BY 1,2 ORDER BY 1,2;
```

**Config Metabase:**
- Visualization: **Bar** (stacked) — X: mes · Y: valor · series: grupo
- Cores: Entradas (grupos `0X`) em verde/azul, Saídas (`1X`) em vermelho/laranja
- Drill-through: clicar em barra abre lista de lançamentos da categoria/mês

---

## Card 3 — Break-even Dinâmico (rolling 3 meses)

**Visualização:** Table 1 linha + Text card com fórmula
**Filtro:** `mes_ref`

```sql
WITH periodo AS (
  SELECT
    ({{mes_ref}}::date - INTERVAL '2 months')::date ini,
    (({{mes_ref}}::date + INTERVAL '1 month - 1 day'))::date fim
),
mov AS (
  SELECT valor, natureza, des_categoria, fonte
  FROM finance.v_extratos_consolidado, periodo
  WHERE data BETWEEN periodo.ini AND periodo.fim
    AND situacao = 'Conciliado'
    AND des_categoria NOT ILIKE '%Transfer%'
    AND des_categoria NOT ILIKE '%Obten%Empr%'
    AND des_categoria NOT ILIKE 'Empr%SAFE'
    AND des_categoria NOT ILIKE 'Empr%CDG'
    AND des_categoria NOT ILIKE 'Empr%WaterWorks'
),
totais AS (
  SELECT
    SUM(CASE WHEN natureza='R' THEN valor ELSE 0 END)/3.0 receita_mes,
    -- FIXO OBRIGATÓRIO: retirada + folha CLT + admin + jurídico + frota + DAS + parcelamento
    -- IMPORTANTE: cs_import (Cartão Conta Simples de técnicos) SEMPRE variável, mesmo que categoria bata (Pedágio/Estacionamento de rota são variáveis, ≠ MAESTRO fixo)
    SUM(CASE WHEN natureza='P' AND fonte != 'cs_import' AND des_categoria IN (
      'Antecipação / Distribuição de Lucro',
      'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição',
      'Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
      'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
      'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
      'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
      'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio'
    ) THEN -valor ELSE 0 END)/3.0 fixo_mes,
    -- VARIÁVEL: COGS + folha PJ + Cartão CS todo + outras
    SUM(CASE WHEN natureza='P' AND (
      fonte = 'cs_import'   -- Cartão CS de técnicos: sempre variável (custo por operação)
      OR des_categoria IN ('Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete',
                        'Compras Material em Garantia','Custo dos Serviços Prestados',
                        'Serviços Prestados PJ','Empréstimo',
                        'Devoluções de Vendas de Mercadoria','Devoluções de Vendas de Serviços Prestados',
                        'Adiantamento a Fornecedores')
      OR (des_categoria IS NOT NULL AND des_categoria NOT IN (
        'Antecipação / Distribuição de Lucro',
        'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição',
        'Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
        'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
        'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
        'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
        'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio'
      ))
    ) THEN -valor ELSE 0 END)/3.0 variavel_mes
  FROM mov
)
SELECT
  receita_mes::numeric(14,2) "Receita média (3m)",
  fixo_mes::numeric(14,2) "Custo Fixo (R$/mês)",
  variavel_mes::numeric(14,2) "Custo Variável (R$/mês)",
  (variavel_mes/NULLIF(receita_mes,0)*100)::numeric(5,1) "% Variável",
  (fixo_mes / NULLIF(1 - variavel_mes/NULLIF(receita_mes,0), 0))::numeric(14,2) "Break-even (R$/mês)",
  (receita_mes - fixo_mes / NULLIF(1 - variavel_mes/NULLIF(receita_mes,0), 0))::numeric(14,2) "Folga (R$/mês)"
FROM totais;
```

**Config Metabase:**
- Visualization: **Table** (1 linha), letras grandes
- Conditional: "Folga" > 0 verde, < 0 vermelho
- **Text card ao lado** com fórmula em Markdown:
  ```
  # Fórmula
  Break-even = **Fixo ÷ (1 − %Variável)**
  Folga = Receita − Break-even
  ```

---

## Card 4 — Aging AR e AP

**Visualização:** Horizontal bar chart, 2 series (R e P)

```sql
WITH abertos AS (
  SELECT
    natureza,
    COALESCE(t.val_aberto, t.valor_titulo - COALESCE(t.val_pago,0)) val_aberto,
    COALESCE(pv.dt_previsao_nova, t.dt_previsao_d, t.dt_vencimento_d) dt_alvo
  FROM finance.pesquisa_titulos t
  LEFT JOIN finance.previsao_override pv ON pv.cod_titulo = t.cod_titulo
  WHERE (t.dt_cancelamento IS NULL OR t.dt_cancelamento='')
    AND (t.liquidado IS NULL OR t.liquidado != 'S')
    AND COALESCE(t.val_aberto, t.valor_titulo - COALESCE(t.val_pago,0)) > 0
    AND (t.dt_vencimento_d IS NULL OR t.dt_vencimento_d >= DATE '2025-01-01')
)
SELECT
  natureza "Tipo",
  CASE
    WHEN dt_alvo IS NULL THEN '00 · sem_data'
    WHEN dt_alvo < CURRENT_DATE - 30 THEN '01 · Vencido 30+ dias'
    WHEN dt_alvo < CURRENT_DATE      THEN '02 · Vencido até 30d'
    WHEN dt_alvo <= CURRENT_DATE + 30 THEN '03 · Vence 30d'
    WHEN dt_alvo <= CURRENT_DATE + 60 THEN '04 · Vence 60d'
    WHEN dt_alvo <= CURRENT_DATE + 90 THEN '05 · Vence 90d'
    WHEN dt_alvo <= (CURRENT_DATE + INTERVAL '6 months')::date THEN '06 · Vence 6m'
    ELSE '07 · +6m' END bucket,
  SUM(val_aberto)::numeric(14,2) valor,
  COUNT(*) n_titulos
FROM abertos
WHERE natureza IN ('R','P')
GROUP BY 1,2 ORDER BY 1,2;
```

**Config Metabase:**
- Visualization: **Bar** horizontal, X=valor, Y=bucket, Series=Tipo (R/P)
- Alerta visual: vermelho para "01·Vencido 30+" e "02·Vencido até 30d"
- Drill-through: clicar mostra os títulos do bucket

---

## Card 5 — Folha Total como % da Receita (rolling 3m)

**Visualização:** Line chart com gauge / linha meta em 40%

```sql
WITH meses AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '11 months')::date,
    CURRENT_DATE::date,
    '1 month'
  )::date mes
),
mov AS (
  SELECT
    date_trunc('month', data)::date mes,
    SUM(CASE WHEN natureza='R'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE '%Obten%Empr%'
             THEN valor ELSE 0 END) receita,
    SUM(CASE WHEN natureza='P' AND des_categoria = 'Antecipação / Distribuição de Lucro'
             THEN -valor ELSE 0 END) retirada,
    SUM(CASE WHEN natureza='P' AND des_categoria IN ('Serviços Prestados PJ','Empréstimo')
             THEN -valor ELSE 0 END) folha_pj,
    SUM(CASE WHEN natureza='P' AND des_categoria IN ('Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário')
             THEN -valor ELSE 0 END) folha_clt
  FROM finance.v_extratos_consolidado
  WHERE situacao='Conciliado'
    AND data >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY 1
)
SELECT
  m.mes,
  COALESCE(mov.receita,0)::numeric(14,2)  receita,
  COALESCE(mov.retirada,0)::numeric(14,2) retirada_benny,
  COALESCE(mov.folha_pj,0)::numeric(14,2) folha_pj,
  COALESCE(mov.folha_clt,0)::numeric(14,2) folha_clt,
  (COALESCE(mov.retirada,0) + COALESCE(mov.folha_pj,0) + COALESCE(mov.folha_clt,0))::numeric(14,2) folha_total,
  ROUND(
    (COALESCE(mov.retirada,0) + COALESCE(mov.folha_pj,0) + COALESCE(mov.folha_clt,0))
    / NULLIF(mov.receita,0) * 100, 1
  ) pct_receita
FROM meses m LEFT JOIN mov USING (mes)
ORDER BY m.mes;
```

**Config Metabase:**
- Visualization: **Combo** — Bar (folha_pj + folha_clt + retirada) empilhado + Line (pct_receita) no eixo secundário
- Goal line: 40% (linha vermelha horizontal)
- Alerta: se pct > 45% → destaque vermelho

---

## Card 6 — Delta Inexplicado Diário (o card do "sumidouro")

**Visualização:** Table com condicional + drill-through

```sql
WITH saldos_diarios AS (
  SELECT
    data_lancamento_d dia,
    cod_conta_corrente,
    descricao_cc,
    saldo,
    cod_lancamento,
    ROW_NUMBER() OVER (
      PARTITION BY cod_conta_corrente, data_lancamento_d
      ORDER BY cod_lancamento DESC
    ) rn
  FROM finance.extratos_cc
  WHERE data_lancamento_d >= CURRENT_DATE - INTERVAL '6 months'
),
saldo_por_dia AS (
  SELECT dia, SUM(saldo) saldo_consolidado
  FROM saldos_diarios WHERE rn=1
  GROUP BY dia
),
mov_por_dia AS (
  SELECT
    data_lancamento_d dia,
    SUM(CASE WHEN situacao='Conciliado' THEN valor_documento ELSE 0 END) conciliado,
    SUM(CASE WHEN situacao='Previsto'   THEN valor_documento ELSE 0 END) previsto,
    SUM(CASE WHEN situacao='Não conciliado' THEN valor_documento ELSE 0 END) nao_conc
  FROM finance.extratos_cc
  WHERE data_lancamento_d >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1
)
SELECT
  s.dia,
  s.saldo_consolidado::numeric(14,2)                                                    "Saldo fim dia",
  (s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia))::numeric(14,2) "Δ Real",
  m.conciliado::numeric(14,2)                                                           "Δ Conciliado",
  m.previsto::numeric(14,2)                                                             "Δ Previsto",
  m.nao_conc::numeric(14,2)                                                             "Δ Não Conc",
  (
    (s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia))
    - m.conciliado - COALESCE(m.previsto,0)
  )::numeric(14,2)                                                                       "Δ INEXPLICADO"
FROM saldo_por_dia s LEFT JOIN mov_por_dia m ON s.dia = m.dia
WHERE ABS(COALESCE(
  (s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia))
  - m.conciliado - COALESCE(m.previsto,0)
, 0)) > 1000
ORDER BY ABS((s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia))
             - m.conciliado - COALESCE(m.previsto,0)) DESC
LIMIT 50;
```

**Config Metabase:**
- Visualization: **Table**
- Conditional formatting em "Δ INEXPLICADO": vermelho se ABS > 50k
- Sort default: pela coluna "Δ INEXPLICADO" descendente
- Drill-through: clicar em dia → abre Card 6b (lançamentos do dia)

**Card 6b — Lançamentos do dia (drill)**

```sql
SELECT
  data_lancamento_d dia,
  descricao_cc conta,
  situacao,
  natureza,
  COALESCE(NULLIF(des_categoria,''),'(sem)') categoria,
  raz_cliente,
  valor_documento::numeric(14,2) valor,
  saldo::numeric(14,2) saldo_apos,
  observacoes
FROM finance.extratos_cc
WHERE data_lancamento_d = {{dia}}
ORDER BY cod_lancamento;
```

---

## Card 7 — MRR Contratado × Faturado (top gaps)

**Visualização:** Table com barras horizontais no gap

```sql
WITH contratos_ativos AS (
  SELECT
    codigo_contrato,
    numero_contrato,
    codigo_cliente,
    situacao,
    SUM(vlr_tot_mes) vlr_mes_contrato
  FROM sales.contratos_servico
  WHERE (vig_final = '' OR vig_final IS NULL
         OR to_date(vig_final,'DD/MM/YYYY') > CURRENT_DATE)
  GROUP BY 1,2,3,4
),
os_fat_3m AS (
  SELECT
    numero_contrato,
    (SUM(valor_total)/3.0) fat_mes_medio
  FROM sales.ordens_servico
  WHERE dt_fat_d >= CURRENT_DATE - INTERVAL '3 months'
    AND (cancelada IS NULL OR cancelada IN ('','N'))
  GROUP BY 1
)
SELECT
  c.numero_contrato "Contrato",
  cli.razao_social "Cliente",
  c.situacao,
  c.vlr_mes_contrato::numeric(12,2) "Contratado (R$/mês)",
  COALESCE(os.fat_mes_medio,0)::numeric(12,2) "Faturado 3m médio",
  (c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0))::numeric(12,2) "Gap R$",
  CASE WHEN c.vlr_mes_contrato > 0
    THEN ROUND(((c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0))/c.vlr_mes_contrato)*100,1)
    ELSE NULL END "Gap %"
FROM contratos_ativos c
LEFT JOIN os_fat_3m os ON os.numero_contrato = c.numero_contrato
LEFT JOIN finance.clientes cli ON cli.codigo_cliente_omie = c.codigo_cliente::bigint
WHERE c.vlr_mes_contrato > 500
  AND (c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0)) > 0
ORDER BY 6 DESC
LIMIT 30;
```

**Config Metabase:**
- Visualization: **Table**
- Mini-bar chart in "Gap R$" column
- Conditional: "Gap %" > 50% → vermelho, 20-50% → laranja
- Objetivo: renegociar/rever cobrança dos top 5

---

## Card 8 — Pareto "Outras Saídas" (a gordura oculta)

**Visualização:** Bar horizontal, top 30

```sql
WITH grandes AS (
  SELECT unnest(ARRAY[
    'Antecipação / Distribuição de Lucro',
    'Serviços Prestados PJ','Empréstimo',
    'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
    'Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete','Compras Material em Garantia','Custo dos Serviços Prestados',
    'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
    'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
    'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
    'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio',
    'Devoluções de Vendas de Mercadoria','Devoluções de Vendas de Serviços Prestados',
    'Adiantamento a Fornecedores',
    'Entrada de Transferência','Saída de Transferência',
    'Empréstimo para SAFE','Empréstimo para CDG','Empréstimo para WaterWorks',
    'Obtenção de Empréstimo (SAFE)','Obtenção de Empréstimo'
  ]) c
)
SELECT
  COALESCE(NULLIF(des_categoria,''),'(sem_categoria)') "Categoria",
  COUNT(*) "Lançamentos",
  SUM(-valor)::numeric(14,2) "Total 6m (R$)",
  (SUM(-valor)/6.0)::numeric(12,2) "Média R$/mês"
FROM finance.v_extratos_consolidado
WHERE data >= CURRENT_DATE - INTERVAL '6 months'
  AND situacao = 'Conciliado'
  AND natureza='P'
  AND COALESCE(NULLIF(des_categoria,''),'(sem_categoria)') NOT IN (SELECT c FROM grandes)
GROUP BY 1
ORDER BY 3 DESC
LIMIT 30;
```

**Config Metabase:**
- Visualization: **Bar** horizontal, X=Total 6m, Y=Categoria
- Drill-through: clicar em barra → lista de lançamentos daquela categoria

---

## Layout do Dashboard "Análise de Resultados"

```
┌─────────────────────────────────────────────────────────────┐
│  FILTRO GLOBAL: mes_ref [Junho 2026 ▼]  janela_meses [12]  │
├────────────────┬────────────────┬────────────────┬─────────┤
│  Receita mês   │  Saídas mês    │  Fluxo líq.    │  Saldo  │
│  Card 1a       │  Card 1b       │  Card 1c       │  Card 1d│
├────────────────┴────────────────┴────────────────┴─────────┤
│                                                              │
│  Card 2 — Cash Flow Mensal (bar stacked, 12 meses)          │
│                                                              │
├──────────────────────────────┬──────────────────────────────┤
│  Card 3 — Break-even         │  Card 5 — Folha % Receita    │
│  (número + fórmula)          │  (line + goal 40%)           │
├──────────────────────────────┼──────────────────────────────┤
│  Card 4 — Aging AR × AP      │  Card 7 — MRR Gap top 30     │
│  (bar horizontal)            │  (tabela + barras)           │
├──────────────────────────────┴──────────────────────────────┤
│                                                              │
│  Card 6 — Delta Inexplicado Diário (tabela, drill-through)  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Card 8 — Pareto "Outras Saídas" (bar horizontal top 30)    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Interpretação de referência (jun/2026)

Guardar como Text card no rodapé do dashboard, atualização manual:

- **Receita mês jun/26:** R$ 666k · **Saídas:** R$ 658k · **Fluxo:** +R$ 8k (positivo mas magro)
- **Break-even estimado:** ~R$ 612k (folga real ~R$ 50k)
- **Saldo consolidado hoje:** R$ 69-238k dependendo do critério
- **AR vencido REAL:** R$ 887k (venc 30+d) + R$ 159k (venc 30d) = **R$ 1,05M em atraso**
- **Delta inexplicado maior:** ±R$ 689k em 11-12 abril = aplicação/resgate financeiro sem categorização
- **MRR gap top-1:** Fundação Antonio Prudente (contrato 15263), sub-cobra R$ 22k/mês (67% gap)

## Próximas iterações (Fase 2 do dashboard)

Cards adicionais que valem quando este estabilizar:

- **Card 9 — Fluxo de caixa previsto próximos 90 dias** (AR previsto − AP a vencer)
- **Card 10 — Concentração de clientes** (Pareto de receita — quem representa 80%)
- **Card 11 — Ciclo de conversão de caixa** (DSO − DPO)
- **Card 12 — Comparativo YoY por mês** (2024 vs 2025 vs 2026)

## Automação da criação (opcional)

Se quiser evitar cola manual: gerar API key no Metabase (Settings > Admin > Authentication > API Keys), passar aqui, e o Claude cria as 8 perguntas + dashboard via `POST /api/card` e `POST /api/dashboard`.

## Tags
#painel-waterworks #metabase #financeiro #dashboard #analise-resultados
