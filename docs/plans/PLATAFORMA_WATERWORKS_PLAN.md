# 🏢 Plataforma Waterworks — Plano Completo

> **Documento vivo.** Mantém-se atualizado ao longo do desenvolvimento.
> **Projeto:** App Next.js modular que unifica gestão operacional Waterworks
> **Criado:** 2026-04-21
> **Escopo:** Dashboards + Aprovações + Projetos + Vendas + Compras + Clientes + Admin
> **Supersedes:** `_OLD_APROVACOES_APP_PLAN.md` (integrado como Módulo Aprovações)

---

## 🎯 Visão

Criar uma **plataforma unificada de gestão** que:
- Consuma os dados Omie já disponíveis no Supabase (pipeline atual)
- Ofereça dashboards visuais configuráveis
- Substitua o SmartSuite com módulo de aprovações próprio
- Seja **extensível** — novos módulos, novas bases de dados, novas APIs
- Cresça conforme a Waterworks cresce, sem refactor grande

### Benefícios esperados

- 🎨 **UI moderna e customizada** (não genérica como Sheets ou SmartSuite)
- ⚡ **Performance** (dados vêm do Supabase direto)
- 💰 **Economia** (substituir SmartSuite + dashboards pagos)
- 🔐 **Controle** (segurança, permissões, auditoria próprios)
- 🧩 **Modular** (adicionar funcionalidades sem quebrar o resto)
- 📈 **Escalável** (stack moderna suporta crescimento)

---

## 🏗 Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  🏢 Plataforma Waterworks (Next.js 14 @ Vercel)                 │
│                                                                 │
│  📦 Módulos (cada um independente, expansível):                 │
│                                                                 │
│  ├─ 📊 /dashboard    → Visão 360 + KPIs + gráficos              │
│  ├─ 📈 /vendas       → CRM-lite, pipeline, top clientes         │
│  ├─ 🛒 /compras      → PCs, fornecedores, cotações              │
│  ├─ 🗂 /projetos     → Painel de projetos ativos + margem       │
│  ├─ ✅ /aprovacoes   → Substitui SmartSuite (PC approval)       │
│  ├─ 👥 /clientes     → CRM de clientes + histórico              │
│  └─ ⚙️ /admin        → Usuários, roles, integrações, config     │
│                                                                 │
│  Compartilhados:                                                │
│  • lib/supabase/   — client + server + types                   │
│  • lib/auth/       — middleware, roles, alçadas                │
│  • lib/datasource/ — camada p/ multi-source futuro             │
│  • components/ui/  — shadcn primitives                         │
│  • components/     — widgets reutilizáveis                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  🟢 Supabase Postgres (central)                                 │
│                                                                 │
│  Schemas do Omie (EXISTEM):                                     │
│  • sales.*     (PVs, OS, Contratos, Produtos, Etapas, Cat)      │
│  • orders.*    (PCs, NFe, Pedidos Compra, Recebimento)          │
│  • finance.*   (Contas Pagar/Receber, Clientes, Projetos, etc)  │
│                                                                 │
│  Schemas NOVOS:                                                 │
│  • approval.*  (approvals, comments, attachments, audit_log)    │
│  • platform.*  (user_preferences, saved_views, roles)           │
│  • analytics.* (views SQL pra KPIs e agregações)                │
│                                                                 │
│  Storage: attachments bucket                                    │
│  Auth: Supabase Auth com Google OAuth restrito @waterworks     │
│  Edge Functions: notify-webex, notify-email                     │
└─────────────────────────────────────────────────────────────────┘
           ▲
           │ GitHub Actions Python (já existe)
           │ 2x/dia Seg-Sex
           │
┌─────────────────────────────────────────────────────────────────┐
│  🏭 Omie ERP                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Extensibilidade multi-source (F4 futuro)

```
Supabase (hub) ←──── FDW ────── PostgreSQL externo
              ←──── FDW ────── MySQL externo
              ←── Edge Fn ───── APIs REST (SmartSuite, Webex, etc)
              ←─── GH Actions ── Python importers (padrão atual)
```

**Postgres Foreign Data Wrapper (FDW):** permite `SELECT` direto de bancos externos como se fossem tabelas locais. Elegante pra juntar dados sem copiar.

---

## 🎨 Stack tecnológica

### Core
| Camada | Tecnologia | Por quê |
|--------|-----------|---------|
| **Framework** | Next.js 14 (App Router) | Multi-módulo natural, SSR/SSG flexível |
| **Linguagem** | TypeScript | Refactor seguro em projetos grandes |
| **Hosting** | Vercel | Deploy auto do GitHub, CDN global |
| **Database** | Supabase (Postgres) | Já temos, inclui Auth + Storage + RLS |
| **Auth** | Supabase Auth + Google OAuth | Restringir ao domínio @waterworks |

### UI e componentes
| Camada | Tecnologia |
|--------|-----------|
| **Estilo** | Tailwind CSS |
| **Componentes** | shadcn/ui |
| **Tabelas** | Tanstack Table |
| **Formulários** | React Hook Form + Zod |
| **Gráficos** | Recharts + Tremor |
| **Ícones** | Lucide React |
| **Data fetching** | Tanstack Query (cache + refresh) |
| **Notificações** | sonner (toasts) |

### Dev tools
| Camada | Tecnologia |
|--------|-----------|
| **Linter** | ESLint + Prettier |
| **Types Supabase** | `supabase gen types typescript` |
| **E2E (futuro)** | Playwright |

---

## 📅 Roadmap em 4 fases

Cada fase **gera valor sozinha**. Pode parar entre fases.

### Fase 1 — Setup + Dashboard "Visão Water" (2-3 semanas)

**Entrega:** plataforma funcionando com login + dashboard executivo completo.

**Layout decidido: KPIs fixos no topo + 4 abas**

```
┌─────────────────────────────────────────────────────────────┐
│  🏢 Visão Water     [Período] [Empresa] [Projeto]  [🔍]     │
├─────────────────────────────────────────────────────────────┤
│  6 KPIs fixos (sticky): Vendas · Compras · Margem %         │
│                          Receber · Pagar · Saldo            │
├─────────────────────────────────────────────────────────────┤
│  [🎯 Margem Projetos] [💸 Fluxo Caixa] [📈 Vendas] [🔴 Inad.]│
├─────────────────────────────────────────────────────────────┤
│  ... conteúdo da aba selecionada ...                        │
└─────────────────────────────────────────────────────────────┘
```

#### Conteúdo das 4 abas

**🎯 Aba "Margem Projetos"**
- Gráfico barras: top 10 projetos por margem R$ e %
- Tabela completa: projeto, vendido, comprado, margem R$, margem %
- Ordenação + export CSV

**💸 Aba "Fluxo Caixa"**
- Gráfico área empilhada: Receber vs Pagar nas próximas 8 semanas
- Linha sobreposta: saldo projetado semanal
- Tabela: próximos 20 vencimentos (Receber+Pagar mesclados por data)

**📈 Aba "Vendas"**
- Linha temporal: vendas últimos 12 meses
- Barras horizontais: Top 10 clientes
- Pizza: vendas por projeto (ou por etapa)
- Tabela: top clientes com variação mês-a-mês

**🔴 Aba "Inadimplência"**
- Gráfico faixas (aging): 0-30d, 30-60d, 60-90d, 90+d
- Tabela: cliente, valor vencido, dias atraso, título
- Alertas: top 5 devedores

#### Checklist técnico

- [ ] **Setup Next.js 14** em `/app` dentro de `omie-supabase-sync/`
- [ ] Dependências: Supabase SSR, Tanstack Query + Table, shadcn, Tremor, Recharts
- [ ] **Supabase Auth** + Google OAuth restrito @waterworks.com.br
- [ ] Middleware de autenticação
- [ ] Layout base com sidebar + topbar
- [ ] Página `/login`
- [ ] **Views SQL `analytics.*`** (próximo bloco deste MD)
- [ ] Página `/dashboard/water` com 6 KPIs fixos + 4 abas
- [ ] FilterBar sticky (Período/Empresa/Projeto) afeta tudo
- [ ] Deploy no Vercel (Root Directory = `app`)

#### Views SQL necessárias (schema `analytics`)

```sql
CREATE SCHEMA IF NOT EXISTS analytics;

-- KPIs agregados (parametrizados por data/empresas no lado do app)
CREATE VIEW analytics.v_vendas AS
SELECT empresa, codigo_projeto, codigo_cliente,
       valor_total, d_inc::date AS data
FROM sales.pedidos_venda;

CREATE VIEW analytics.v_compras AS
SELECT empresa, ncod_proj AS codigo_projeto,
       valor_total, d_inc::date AS data
FROM orders.pedidos_compra;

CREATE VIEW analytics.v_receber_aberto AS
SELECT empresa, codigo_projeto, codigo_cliente_fornecedor,
       (valor_documento - COALESCE(valor_pago,0)) AS valor_aberto,
       data_vencimento,
       CASE WHEN data_vencimento < CURRENT_DATE THEN CURRENT_DATE - data_vencimento ELSE 0 END AS dias_atraso
FROM finance.contas_receber
WHERE COALESCE(status_titulo,'') NOT IN ('LIQUIDADO','CANCELADO');

CREATE VIEW analytics.v_pagar_aberto AS
SELECT empresa, codigo_projeto, codigo_cliente_fornecedor,
       (valor_documento - COALESCE(valor_pago,0)) AS valor_aberto,
       data_vencimento
FROM finance.contas_pagar
WHERE COALESCE(status_titulo,'') NOT IN ('LIQUIDADO','CANCELADO');

-- Margem bruta por projeto
CREATE VIEW analytics.v_margem_projeto AS
SELECT
  COALESCE(pv.codigo_projeto, pc.codigo_projeto) AS codigo_projeto,
  COALESCE(pv.empresa, pc.empresa) AS empresa,
  SUM(pv.valor_total) AS vendido,
  SUM(pc.valor_total) AS comprado,
  (COALESCE(SUM(pv.valor_total),0) - COALESCE(SUM(pc.valor_total),0)) AS margem_abs,
  CASE WHEN SUM(pv.valor_total) > 0
    THEN (COALESCE(SUM(pv.valor_total),0) - COALESCE(SUM(pc.valor_total),0)) / SUM(pv.valor_total) * 100
    ELSE 0 END AS margem_pct
FROM analytics.v_vendas pv
FULL OUTER JOIN analytics.v_compras pc
  ON pc.codigo_projeto = pv.codigo_projeto AND pc.empresa = pv.empresa
GROUP BY 1, 2;

-- Vendas mensais (últimos 12 meses)
CREATE VIEW analytics.v_vendas_mensal AS
SELECT empresa,
       date_trunc('month', data)::date AS mes,
       SUM(valor_total) AS total
FROM analytics.v_vendas
WHERE data >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY 1, 2;

-- Top clientes por período (será filtrado no app)
CREATE VIEW analytics.v_top_clientes AS
SELECT empresa, codigo_cliente,
       SUM(valor_total) AS total_vendido,
       COUNT(*) AS num_pedidos,
       MAX(data) AS ultima_compra
FROM analytics.v_vendas
GROUP BY 1, 2;

-- Inadimplência (aging bucket)
CREATE VIEW analytics.v_inadimplencia AS
SELECT empresa, codigo_cliente_fornecedor AS codigo_cliente,
       SUM(valor_aberto) AS valor_vencido,
       MAX(dias_atraso) AS dias_max_atraso,
       CASE
         WHEN MAX(dias_atraso) <= 30  THEN '0-30'
         WHEN MAX(dias_atraso) <= 60  THEN '30-60'
         WHEN MAX(dias_atraso) <= 90  THEN '60-90'
         ELSE '90+'
       END AS faixa
FROM analytics.v_receber_aberto
WHERE dias_atraso > 0
GROUP BY 1, 2;
```

### Fase 2 — Mais Dashboards (2-3 semanas)

**Entrega:** 4 dashboards principais.

- [ ] `/dashboard/vendas` — Ticket médio, Top clientes, Vendas por projeto, Funil de PVs
- [ ] `/dashboard/compras` — PCs pendentes, Top fornecedores, Prazo médio entrega
- [ ] `/dashboard/projetos` — Margem por projeto (Receita − Custo), Status, Etapas
- [ ] `/dashboard/operacional` — PVs por etapa, OS em andamento, NFe recebidas
- [ ] Filtros dinâmicos compartilhados (data, empresa, projeto)
- [ ] Drill-down: clica em gráfico → vai pra lista detalhada
- [ ] Export CSV

### Fase 3 — Módulo Aprovações (2-3 semanas)

**Entrega:** substituto completo do SmartSuite.

Conforme planejado no `_OLD_APROVACOES_APP_PLAN.md`, agora como módulo:

- [ ] Schema SQL `approval.*` (approvals, comments, attachments, audit_log, user_roles, alcadas)
- [ ] Views `v_pc_completo`, `v_pc_pendentes`
- [ ] Página `/aprovacoes` com lista filtrável
- [ ] Página `/aprovacoes/[pc]` com detalhes + ações
- [ ] Cross-reference PC ↔ PV/OS
- [ ] Histórico/auditoria (trigger SQL automático)
- [ ] Anexos via Supabase Storage
- [ ] Notificações Webex/email via Edge Function
- [ ] Alçada por categoria/projeto (decidido)
- [ ] Migração dos dados históricos do SmartSuite

### Fase 4 — Multi-source + Features avançadas (2-3 semanas)

**Entrega:** capacidade de integrar outros dados.

- [ ] **Foreign Data Wrappers** no Supabase pra bases PostgreSQL/MySQL externas
- [ ] **Edge Functions** proxy pra APIs REST externas
- [ ] **Plugin system**: novo módulo sem mexer no core
- [ ] **Views customizadas salvas por usuário** (filtros persistidos)
- [ ] **Dashboards configuráveis drag-and-drop** (opcional)
- [ ] **Relatórios agendados** (Webex/email)
- [ ] **Busca global** (Cmd+K style)

---

## 🔐 Autenticação e Permissões

### Setup inicial
- **Supabase Auth** com provedor Google OAuth
- **Restrição de domínio**: só @waterworks.com.br pode logar
- Configuração no Google Cloud Console + Supabase Auth Settings

### Roles
| Role | Permissões |
|------|-----------|
| `visualizador` | Lê tudo |
| `analista` | Lê + comenta + anexa |
| `aprovador` | + aprova dentro da alçada |
| `admin` | Tudo + gerencia users e alçadas |

### Alçadas (decidido: por categoria/projeto)
```sql
approval.alcadas:
  - user_id, categoria, projeto, valor_max
```

Exemplo:
```
joao@waterworks.com.br
  • Categoria "Materiais Elétricos" → até R$ 50.000
  • Projeto "40_VS"                → qualquer valor
```

---

## 🗄 Schemas Postgres novos

### `approval.*` (módulo aprovações)
- `approvals` — estado atual de cada PC
- `comments` — thread de discussão
- `attachments` — metadados de arquivos
- `audit_log` — trilha completa
- `user_roles` — permissões
- `alcadas` — alçada por categoria/projeto

### `platform.*` (compartilhado)
- `user_preferences` — tema, config pessoal
- `saved_views` — filtros salvos como favoritos
- `notifications` — fila de notificações

### `analytics.*` (views SQL pra dashboards)
- `v_financeiro_mensal` — contas por mês
- `v_vendas_por_cliente` — agregação por cliente
- `v_margem_por_projeto` — receita − custo por projeto
- etc.

(Detalhes SQL completos na Fase 2/3)

---

## 📦 Estrutura de pastas (monorepo)

```
omie-supabase-sync/                # repo existente
├── scripts/                       # Python Omie→Supabase (existente)
├── .github/workflows/              # Actions (existente)
├── docs/                           # Painel web HTML (existente)
├── sql/                            # Schemas existentes
│
└── app/                            # 🆕 Next.js 14 aqui
    ├── app/
    │   ├── (auth)/
    │   │   └── login/page.tsx
    │   ├── (app)/
    │   │   ├── layout.tsx          # Sidebar + topbar + auth
    │   │   ├── dashboard/
    │   │   │   ├── page.tsx        # Home/overview
    │   │   │   ├── financeiro/page.tsx
    │   │   │   ├── vendas/page.tsx
    │   │   │   ├── compras/page.tsx
    │   │   │   ├── projetos/page.tsx
    │   │   │   └── operacional/page.tsx
    │   │   ├── aprovacoes/
    │   │   │   ├── page.tsx
    │   │   │   └── [pc]/page.tsx
    │   │   ├── vendas/page.tsx
    │   │   ├── compras/page.tsx
    │   │   ├── projetos/page.tsx
    │   │   ├── clientes/page.tsx
    │   │   └── admin/
    │   │       ├── usuarios/page.tsx
    │   │       ├── alcadas/page.tsx
    │   │       └── integracoes/page.tsx
    │   └── api/
    │       └── webhooks/
    ├── components/
    │   ├── ui/                     # shadcn primitives
    │   ├── dashboard/              # widgets reutilizáveis
    │   │   ├── kpi-card.tsx
    │   │   ├── line-chart.tsx
    │   │   ├── bar-chart.tsx
    │   │   └── data-table.tsx
    │   ├── sidebar.tsx
    │   ├── topbar.tsx
    │   └── user-menu.tsx
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts
    │   │   ├── server.ts
    │   │   ├── middleware.ts
    │   │   └── types.ts
    │   ├── auth/
    │   │   ├── permissions.ts
    │   │   └── roles.ts
    │   ├── datasource/             # 🆕 camada multi-source futura
    │   │   ├── omie.ts
    │   │   ├── fdw.ts
    │   │   └── registry.ts
    │   └── utils.ts
    ├── supabase/
    │   ├── migrations/             # SQL migrations
    │   └── functions/              # Edge functions
    ├── .env.local
    ├── .env.example
    ├── next.config.js
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── package.json
    └── README.md
```

---

## 💰 Custos mensais estimados

| Item | Plano | Custo |
|------|-------|------|
| Supabase | Pro (500MB → 8GB, daily backups) | **$25/mês** |
| Vercel | Pro (se precisar de build minutes extra) | $0-$20/mês |
| Domínio | `plataforma.waterworks.com.br` | ~R$40/ano |
| **Total** | | **~R$150-250/mês** |

Comparar com SmartSuite (potencialmente $50-200/mês/user × N users) → **economia significativa**.

---

## 🔧 Variáveis de ambiente necessárias

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx  # só server

# Auth (Supabase configura, mas precisamos dos secrets do Google)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Integrações
WEBEX_TOKEN=xxx
WEBEX_ROOM_ID=xxx

# Email (opcional, Resend)
RESEND_API_KEY=re_xxx

# Observabilidade (opcional)
SENTRY_DSN=xxx
```

---

## 🚀 PROMPT PARA CLAUDE CODE — Fase 1 (Visão Water)

Copie e cole na próxima sessão do Claude Code:

````
Estou construindo a Plataforma Waterworks — app Next.js 14 modular que
unifica dashboards + aprovações + outras ferramentas operacionais em torno
dos dados Omie já disponíveis no Supabase.

CONTEXTO COMPLETO:
Leia /Users/bennyalcalay/Downloads/Omie/PLATAFORMA_WATERWORKS_PLAN.md
Tem arquitetura, stack, módulos, roadmap em 4 fases, estrutura de pastas
e views SQL necessárias.

MONOREPO:
App vive em `/app` DENTRO do repo `omie-supabase-sync` (não criar repo novo).
Caminho: /Users/bennyalcalay/Downloads/Omie/omie-supabase-sync/

DECISÕES JÁ TOMADAS:
- Stack: Next.js 14 + TS + Tailwind + shadcn/ui + Supabase + Recharts/Tremor
- Auth: Supabase Auth + Google OAuth restrito @waterworks.com.br
- Deploy: Vercel, Root Directory = "app"
- Supabase é hub central (já tem schemas sales.*, orders.*, finance.*)
- Módulos futuros: Aprovações (F3), Vendas, Compras, Clientes, Admin
- Layout do dashboard: KPIs fixos sticky + 4 abas

TAREFA DESTA SESSÃO — FASE 1 (Setup + Dashboard Visão Water):

╔═══════════════════════════════════════════════════════════════╗
║ OBJETIVO DA F1: entregar /dashboard/water FUNCIONANDO com:    ║
║   - 6 KPIs fixos no topo (sticky)                             ║
║   - 4 abas: Margem Projetos, Fluxo Caixa, Vendas, Inadimp.    ║
║   - FilterBar global (Período, Empresa, Projeto)              ║
║   - Dados REAIS do Supabase (usando views analytics.*)        ║
║   - Login funcionando + deploy Vercel                         ║
╚═══════════════════════════════════════════════════════════════╝

PARTE A — Views SQL (1º passo, ANTES de codar app)

Criar schema `analytics` com as views descritas no MD (seção "Views SQL
necessárias"). Pode criar um arquivo `sql/07_schema_analytics.sql` no
repo e pedir pro user rodar no Supabase Studio.

Views a criar:
  • analytics.v_vendas
  • analytics.v_compras
  • analytics.v_receber_aberto
  • analytics.v_pagar_aberto
  • analytics.v_margem_projeto
  • analytics.v_vendas_mensal
  • analytics.v_top_clientes
  • analytics.v_inadimplencia

Copie o SQL EXATAMENTE do PLATAFORMA_WATERWORKS_PLAN.md (não reinvente).

PARTE B — Setup Next.js

1. cd /Users/bennyalcalay/Downloads/Omie/omie-supabase-sync/ && mkdir -p app && cd app
2. npx create-next-app@latest . --typescript --tailwind --app --src-dir=false --import-alias "@/*" --no-eslint
3. Instalar:
   npm install @supabase/ssr @supabase/supabase-js @tanstack/react-table @tanstack/react-query recharts lucide-react sonner date-fns
4. Tremor: npm install @tremor/react
5. shadcn/ui init: npx shadcn@latest init (neutral, slate)
6. shadcn components: npx shadcn@latest add button card input table form select dropdown-menu dialog tabs badge skeleton popover calendar
7. lib/supabase/{client,server,middleware}.ts
8. middleware.ts na raiz (redirect p/ /login)

PARTE C — Layout base

1. app/(auth)/login/page.tsx com Google OAuth
2. app/(app)/layout.tsx:
   - Sidebar: Dashboard, Vendas, Compras, Projetos, Aprovações, Clientes, Admin
   - Topbar com user dropdown + logout
3. app/(app)/dashboard/water/page.tsx ← ESSA É A ESTRELA DA F1

Outros itens da sidebar podem ser stub "Em construção" nessa fase.

PARTE D — Dashboard Visão Water (core da F1)

Arquivo: app/(app)/dashboard/water/page.tsx

Estrutura:

```tsx
<PageWrapper>
  <FilterBar />  {/* período, empresa, projeto — usa URL query params */}
  <KpiBar>
    {/* 6 KPI cards sticky */}
  </KpiBar>
  <Tabs>
    <TabsList>
      <TabsTrigger value="margem">🎯 Margem Projetos</TabsTrigger>
      <TabsTrigger value="caixa">💸 Fluxo Caixa</TabsTrigger>
      <TabsTrigger value="vendas">📈 Vendas</TabsTrigger>
      <TabsTrigger value="inadimp">🔴 Inadimplência</TabsTrigger>
    </TabsList>
    <TabsContent value="margem"><MargemProjetosTab /></TabsContent>
    <TabsContent value="caixa"><FluxoCaixaTab /></TabsContent>
    <TabsContent value="vendas"><VendasTab /></TabsContent>
    <TabsContent value="inadimp"><InadimplenciaTab /></TabsContent>
  </Tabs>
</PageWrapper>
```

KPIs (6):
  1. 💰 Vendas       — SUM analytics.v_vendas (filtrado)
  2. 🛒 Compras      — SUM analytics.v_compras
  3. 📊 Margem %     — (Vendas - Compras) / Vendas * 100
  4. 💵 Receber Aberto — SUM analytics.v_receber_aberto
  5. 💳 Pagar Aberto   — SUM analytics.v_pagar_aberto
  6. 🏦 Saldo Projetado — Receber - Pagar

Cada KPI card: valor grande + variação vs período anterior (seta + %).

Aba "Margem Projetos":
  • Top 10 bar chart (recharts) — margem_abs por projeto
  • Tabela completa com Tanstack Table (todos os projetos)
  • Colunas: projeto, vendido, comprado, margem R$, margem %
  • Sort por coluna, export CSV

Aba "Fluxo Caixa":
  • Área empilhada (recharts) — Receber (verde) vs Pagar (vermelho) por semana
  • Janela: próximas 8 semanas
  • Linha sobreposta: saldo acumulado
  • Tabela: próximos 20 vencimentos ordenados por data

Aba "Vendas":
  • Line chart: vendas por mês (últimos 12) — analytics.v_vendas_mensal
  • Bar chart horizontal: Top 10 clientes — analytics.v_top_clientes
  • Pizza: vendas por projeto (top 5 + "outros")

Aba "Inadimplência":
  • Bar chart: aging (0-30, 30-60, 60-90, 90+)
  • Tabela: cliente | valor vencido | dias atraso
  • Alert banner: top 5 devedores

FILTROS GLOBAIS (FilterBar):
  • Período: preset (Este mês | Trimestre | Ano | Custom) — persiste em URL ?periodo=
  • Empresa: multi-select SF/CD/WW — ?empresas=SF,CD
  • Projeto: dropdown com todos os codigo_projeto distintos

Todos os filtros se aplicam a TODAS as abas simultaneamente.

PARTE E — Deploy

1. git push origin main (depois de confirmar que local funciona)
2. Vercel: New Project → omie-supabase-sync → Root Directory "app"
3. Env vars:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
4. Deploy e compartilhar URL

REGRAS IMPORTANTES:
- Pergunte antes de mudanças grandes ou decisões arquiteturais
- NÃO mexa em nada fora da pasta /app (exceto criar o SQL em /sql)
- Server Components por default; Client só onde precisa interação (tabs, filters, tables interativas)
- Use Tremor pra cards/KPIs, Recharts pra gráficos customizados, shadcn pra resto
- Formato R$ em tudo que é dinheiro (Intl.NumberFormat('pt-BR'))
- Loading skeletons enquanto dados carregam
- Se der dúvida sobre campo/coluna do schema, veja /Users/bennyalcalay/Downloads/Omie/MAPA_INTERLIGACOES.md

QUANDO TERMINAR:
  ✅ Views SQL criadas e rodando no Supabase
  ✅ `npm run dev` → login funciona
  ✅ /dashboard/water mostra 6 KPIs REAIS + 4 abas funcionando
  ✅ FilterBar atualiza dados quando muda período/empresa/projeto
  ✅ Deploy Vercel OK, acessível via URL
  ✅ Marcar Fase 1 como ✅ no PLATAFORMA_WATERWORKS_PLAN.md

Pode começar pela Parte A (Views SQL)?
````

---

## 📌 Status

| Fase | Status |
|------|:------:|
| F1 — Setup + Dashboard Financeiro | ⏸ aguardando início |
| F2 — Mais Dashboards | ⏸ |
| F3 — Módulo Aprovações | ⏸ |
| F4 — Multi-source | ⏸ |

---

## 📚 Referências

- [Next.js 14 Docs](https://nextjs.org/docs)
- [Supabase SSR com Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [shadcn/ui](https://ui.shadcn.com)
- [Tremor Dashboards](https://www.tremor.so)
- [Recharts](https://recharts.org)
- [Tanstack Table](https://tanstack.com/table)
- [Postgres FDW](https://supabase.com/docs/guides/database/extensions/foreign-data-wrappers)

---

**Fim do plano.** Documento vivo — atualizar ao longo do desenvolvimento. 🎯
