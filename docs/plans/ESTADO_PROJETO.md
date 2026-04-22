# 📋 Estado do Projeto — Omie → Supabase → Google Sheets

> **Documento vivo.** Atualizar a cada sessão de trabalho para preservar contexto.
> **Última atualização:** 2026-04-16 (sessão múltiplos horários)

---

## 🎯 Objetivo Geral

Migrar 3 módulos de dados do Omie ERP (Sales, Orders, Finance) da arquitetura antiga (100% Apps Script) para uma arquitetura moderna baseada em:

- **GitHub Actions (Python)** → pull do Omie, push no Supabase
- **Supabase (PostgreSQL)** → camada de armazenamento
- **Apps Script (Mirror)** → lê do Supabase, escreve nas abas do Sheets
- **Apps Script (OrquestradorPos)** → pós-import (SmartSuite, Webex)
- **Painel Web** → https://benny459.github.io/omie-supabase-sync/

---

## 🏗️ Arquitetura

```
┌───────────────────┐
│   Omie ERP API    │
└─────────┬─────────┘
          │ (Python importers)
          ▼
┌───────────────────┐        ┌─────────────────────┐
│   GitHub Actions  │───────▶│  Supabase Postgres  │
│ (cron schedules)  │        │  schemas:           │
└───────────────────┘        │   • sales.*         │
                             │   • orders.*        │
                             │   • finance.*       │
                             │   • sync_state      │
                             └──────────┬──────────┘
                                        │ (PostgREST)
                                        ▼
                             ┌─────────────────────┐
                             │   Apps Script Mirror│
                             │   (3 planilhas)     │
                             └──────────┬──────────┘
                                        │
                                        ▼
                             ┌─────────────────────┐
                             │ OrquestradorPos     │
                             │  • SmartSuite       │
                             │  • Webex relatórios │
                             └─────────────────────┘
```

---

## 📁 Estrutura de Arquivos

### Repositório GitHub: `omie-supabase-sync`
Local: `/Users/bennyalcalay/Downloads/Omie/omie-supabase-sync/`

```
omie-supabase-sync/
├── README.md
├── scripts/                      # Importers Python
│   ├── _common.py                # fetch_and_upsert_streaming() com MAX_SECONDS
│   ├── import_itens_vendidos.py
│   ├── import_etapas_pedidos.py
│   ├── import_pedidos_venda.py
│   ├── import_produtos.py
│   ├── import_servicos.py
│   ├── import_auxiliares.py
│   ├── import_orders_auxiliares.py
│   ├── import_pedidos_compra.py
│   ├── import_nfe_entrada.py
│   ├── import_recebimento_nfe.py
│   ├── import_contas_pagar.py    # streaming + FORCAR_FULL + DIAS_INCREMENTAL
│   ├── import_contas_receber.py  # streaming + FORCAR_FULL + DIAS_INCREMENTAL
│   ├── import_pesquisa_titulos.py
│   ├── import_extratos_cc.py
│   └── import_finance_cadastros.py
│
├── sql/                          # Schemas Postgres
│   ├── 02_schema_sales_extras.sql
│   ├── 03_schema_servicos.sql
│   ├── 04_schema_orders.sql
│   ├── 05_schema_finance.sql
│   ├── 05_schema_finance_v2.sql  # DROP+CREATE regenerado dos mappers
│   └── 06_fix_finance_columns.sql
│
└── .github/workflows/            # GitHub Actions
    ├── import_itens_vendidos.yml
    ├── import_etapas_pedidos.yml
    ├── import_pedidos_venda.yml
    ├── import_produtos.yml
    ├── import_servicos.yml
    ├── import_auxiliares.yml
    ├── master_sales_diaria.yml
    ├── master_sales_semanal.yml
    ├── master_orders_diaria.yml
    ├── master_orders_semanal.yml
    ├── master_finance_diaria.yml  # cron "30 4 * * 1-5", 180min
    ├── master_finance_full.yml    # cron "0 6 * * 0", 240min, FORCAR_FULL=true
    └── master_finance_semanal.yml
```

### Pasta Apps Script: `supabase_migration`
Local: `/Users/bennyalcalay/Downloads/Omie/supabase_migration/`

```
supabase_migration/
├── SupabaseClient.gs              # supaSelect() — cliente HTTP para PostgREST
├── GitHubActions.gs               # workflow_dispatch via API
├── DashboardConfig.gs             # Dashboard — SALES ONLY (filtra SALES_MODULOS)
│
├── SheetsMirror.gs                # Sales — mirrorTudo() chama atualizarDashboard()
├── SheetsMirror_Orders.gs         # Orders
├── SheetsMirror_Finance.gs        # Finance — com filtros de data (a_partir_de, ate)
│
├── OrquestradorPos.gs             # Sales: mirror → smartsuite → webex
├── OrquestradorPos_Orders.gs      # Orders: mirror → smartsuite → webex
└── OrquestradorPos_Finance.gs     # Finance: mirror → pagar/receber → clientes → webex
```

### Documentação
```
/Users/bennyalcalay/Downloads/Omie/
├── MAPA_INTERLIGACOES.md          # Interligações entre tabelas
├── MAPA_INTERLIGACOES.pdf         # PDF com diagramas visuais
└── ESTADO_PROJETO.md              # ESTE ARQUIVO — documento vivo
```

---

## 🔗 URLs e Recursos

| Recurso | URL |
|---------|-----|
| Painel Web | https://benny459.github.io/omie-supabase-sync/ |
| Repo GitHub | (privado) `omie-supabase-sync` |
| Supabase | (conforme `.env`) |
| Planilha Sales | (URL compartilhada pelo usuário) |
| Planilha Orders | (URL compartilhada pelo usuário) |
| Planilha Finance | (URL compartilhada pelo usuário) |

---

## 🧩 Padrões Técnicos Implementados

### 1. Streaming UPSERT (`_common.py`)

```python
def fetch_and_upsert_streaming(endpoint, mapper, supa_table, pk, ...):
    # Faz fetch página por página
    # UPSERT a cada 500 rows (não acumula tudo em memória)
    # MAX_SECONDS interrompe grácilmente se passar do limite
    # Garante que dados já baixados são preservados mesmo se cancelar
```

**Usado em:** `import_contas_pagar.py`, `import_contas_receber.py`, `import_pesquisa_titulos.py`

### 2. Modos de Execução

| Modo | Variável de Ambiente | Comportamento |
|------|---------------------|---------------|
| **Incremental** | `FORCAR_FULL=false` + `DIAS_INCREMENTAL=90` | Últimos N dias (default 90) |
| **Full** | `FORCAR_FULL=true` | Reimporta tudo desde o início |

### 3. Smart Mirror (skip inteligente)

O Apps Script verifica `sync_state.last_sync_at` no Supabase e compara com `MIRROR_TS` armazenado em `ScriptProperties`. Se timestamp do Supabase == local, pula o espelhamento (economiza tempo e quotas).

### 4. Filtros no Mirror Finance

`SheetsMirror_Finance.gs` suporta filtros de data por tabela:
- `a_partir_de`: data inicial (DD/MM/YYYY)
- `ate`: data final (DD/MM/YYYY)
- Conversão para ISO e comparação cliente-side (no Apps Script)

### 5. Dashboard Sales-Only

`DashboardConfig.gs` usa `SALES_MODULOS` para filtrar apenas módulos relevantes:

```javascript
var SALES_MODULOS = [
  'itens_vendidos', 'etapas_pedidos', 'pedidos_venda',
  'ordens_servico', 'contratos_servico', 'produtos',
  'formas_pagamento', 'categorias'
];
```

`mirrorTudo()` chama `atualizarDashboard()` ao final.

---

## ⚙️ Schedules Atuais (GitHub Actions)

Cada workflow **diária** tem **2 slots fixos** (editáveis via painel web).
Workflows semanais/FULL continuam com **1 slot**.

| Workflow | Slots | Cron UTC | BRT | Frequência |
|----------|-------|----------|-----|------------|
| `master_sales_diaria` | **2** | `0 8 * * 1-5` / `0 20 * * 1-5` | 05:00 / 17:00 | Seg-Sex |
| `master_sales_semanal` | 1 | (atual) | — | Semanal |
| `master_orders_diaria` | **2** | `0 9 * * 1-5` / `0 21 * * 1-5` | 06:00 / 18:00 | Seg-Sex |
| `master_orders_semanal` | 1 | (atual) | — | Semanal |
| `master_finance_diaria` | **2** | `0 10 * * 1-5` / `0 22 * * 1-5` | 07:00 / 19:00 | Seg-Sex (180min) |
| `master_finance_full` | 1 | `0 6 * * 0` | — | Dom (240min) |
| `master_finance_semanal` | 1 | (atual) | — | Semanal |

> ℹ️ Os valores do **Slot #1** acima refletem a última configuração feita pelo usuário via painel web.
> O **Slot #2** foi adicionado com offset de **+12h** como sugestão (editável via painel).

### Como funciona o sistema de 2 slots

- YAML de cada master diária tem `schedule:` com **2 linhas `- cron:`** (slot #1 e slot #2)
- Painel web renderiza **2 cards** por workflow diária (ex: "🚀 Sales Diária · #1" e "🚀 Sales Diária · #2")
- Editar horário → grava no slot correspondente (substitui a N-ésima ocorrência de `cron:` no YAML via regex contador)
- GitHub Actions dispara ambos os slots automaticamente

---

## 🔁 Integrações SmartSuite

Documentadas no PDF `MAPA_INTERLIGACOES.pdf`. Tabelas compartilhadas entre Sales e Orders:
- Vendas Avulsas
- Projetos Ativos

---

## ✅ Concluído

- [x] Streaming UPSERT com preservação de dados em interrupção
- [x] Imports Finance com FORCAR_FULL + DIAS_INCREMENTAL
- [x] `master_finance_diaria.yml` com timeout de 180min
- [x] `master_finance_full.yml` domingo 06:00 UTC
- [x] SQL regenerado (`05_schema_finance_v2.sql` com DROP+CREATE)
- [x] Smart Mirror para Finance com filtros de data
- [x] Bancos table: removido `empresa` (tabela global)
- [x] PesquisaTitulos: filtro `01/01/2025` até `31/12/2027` (evita limite 10M cells)
- [x] Dashboard centralizado na planilha Sales (Opção B)
- [x] Dashboard mostra SÓ dados do Sales (filtrado via `SALES_MODULOS`)
- [x] `mirrorTudo()` chama `atualizarDashboard()` ao final
- [x] OrquestradorPos_Finance com 4 steps
- [x] PDF `MAPA_INTERLIGACOES.pdf` com diagramas (dependency, data flow, SmartSuite)
- [x] **Múltiplos horários por solução** (Opção A — 2 slots fixos)
  - YAMLs com 2 `- cron:` em cada master diária (sales/orders/finance)
  - Painel web com `extractCrons()` + renderização dinâmica de N cards
  - `saveSchedule()` substitui a N-ésima ocorrência via regex contador

---

## ⏭️ Pendente

### 🟡 Outras pendências conhecidas

- [x] **Push das alterações de múltiplos horários** (3 YAMLs + index.html) — commit `b6911ff`
- [ ] **Testar no painel em produção**: abrir https://benny459.github.io/omie-supabase-sync/ e validar que aparecem 2 cards por workflow diária
- [ ] Validar se Sales pós-import completo atualizou o Dashboard corretamente
- [ ] Revisar se há campos novos no Omie que não estão mapeados
- [ ] Considerar alerta em caso de erro nos workflows (email/Webex)

---

## 🐛 Histórico de Problemas e Soluções

| Problema | Causa | Solução |
|----------|-------|---------|
| PGRST204 `categorias_rateio` | Mapper Python tinha coluna que não existia no SQL | Regenerou SQL (`05_schema_finance_v2.sql`) |
| 42P10 ON CONFLICT | PK do UPSERT não batia com PK da tabela | Corrigido nos aux tables |
| Finance Diária timeout 60min | Volume de dados grande | Aumentado para 180min + streaming |
| PesquisaTitulos hit 10M cells | Limite do Sheets para a planilha inteira | Filtro por data `01/01/2025` – `31/12/2027` |
| Filtro data não funcionava (DD/MM/YYYY) | Supabase esperava ISO | Client-side filter com `_parseDataBR_()` |
| Bancos `column empresa does not exist` | Tabela é global (sem empresa) | Removido `empresa` do mapper e query |
| PDF com sobreposição | Layout de labels | Corrigido posicionamento, aumentada altura |
| Dashboard Sales não atualizava pós-import | `atualizarDashboard()` não era chamado | Adicionado em `mirrorTudo()` |
| Dashboard mostrava Orders+Finance | Dashboard central pegava tudo | Filtro `SALES_MODULOS` no `DashboardConfig.gs` |

---

## 💬 Mensagens-Chave do Usuário

1. "Gostreaia de poder ter a opção de sioncronizar mais de um horário para cada solução" ← ✅ (Opção A — 2 slots fixos)
2. "Pode adotar o que for mais seguro e cômodo" ← ✅ (optei pela Opção A)
3. "Se inicar uma nova sessão perdemos a evolução aqui?" ← resolvido via este doc
4. "Vamos simplificar com B... mas preciso que o Dashboard do Sales só mostre dados do Sales" ← ✅
5. "O filtro na pratica nao funcionou... apesar de estar escrito.. estamos puxando tudo" ← ✅
6. "Nao gosto desta abordagem porque se decidir 10000 linhas noa sei quais datas" ← ✅

---

## 🔐 Garantias de Continuidade

**Você NÃO perde progresso ao iniciar nova sessão** porque:

1. ✅ Todo código está salvo em disco (`/Users/bennyalcalay/Downloads/Omie/`)
2. ✅ Tudo versionado no git (repo `omie-supabase-sync`)
3. ✅ Este documento (`ESTADO_PROJETO.md`) mantém o contexto essencial
4. ✅ O PDF `MAPA_INTERLIGACOES.pdf` documenta a arquitetura visual

**O que se perde em nova sessão:**
- Contexto conversacional (últimas frases trocadas)
- Estado mental compartilhado ("estávamos no meio disso…")

**Mitigação:** Manter este arquivo sempre atualizado no final de cada sessão.

---

## 📝 Como Atualizar Este Documento

Ao final de cada sessão, atualize:

1. **Data** no topo (`Última atualização`)
2. **Seção "Concluído"** (marcar tarefas com `[x]`)
3. **Seção "Pendente"** (mover/adicionar itens)
4. **Seção "Histórico de Problemas"** (novos bugs + fixes)
5. **Seção "Mensagens-Chave"** (citações importantes)

---

## 🚀 Próxima Sessão — Comece Por Aqui

1. Ler a seção **"⏭️ Pendente"**
2. Se as alterações de múltiplos horários ainda não foram enviadas: `cd omie-supabase-sync && git status` para ver os 4 arquivos modificados (3 YAMLs + index.html), depois `git commit + push`
3. Validar no painel web: https://benny459.github.io/omie-supabase-sync/ (aba Sales/Orders/Finance → seção "Agenda automática" deve mostrar 2 cards por diária)
4. Atualizar este documento com resultado de cada teste

---

## 📦 Arquivos Modificados Nesta Sessão (commit `b6911ff`)

| Arquivo | Mudança |
|---------|---------|
| `.github/workflows/master_sales_diaria.yml` | Slot #1 `0 8 * * 1-5` + Slot #2 `0 20 * * 1-5` |
| `.github/workflows/master_orders_diaria.yml` | Slot #1 `0 9 * * 1-5` + Slot #2 `0 21 * * 1-5` |
| `.github/workflows/master_finance_diaria.yml` | Slot #1 `0 10 * * 1-5` + Slot #2 `0 22 * * 1-5` |
| `docs/index.html` | `extractCrons()`, renderização dinâmica, `saveSchedule()` com slot index |
| `ESTADO_PROJETO.md` | Este documento (não versionado no repo) |

> ⚠️ No rebase houve conflito: o remote tinha horários mais recentes configurados pelo usuário (via painel).
> Resolução: remote virou **Slot #1**, e **Slot #2** foi adicionado com offset +12h.

---

**Fim do documento. Boa continuação! 🎯**
