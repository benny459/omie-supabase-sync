# Painel-WaterWorks — Overview

> **Versão atual (web):** v1.4.3 · **Repo:** github.com/benny459/omie-supabase-sync · **Stack:** Next 16.2.4 + Supabase SSR · **Domain:** [painel.waterworks.com.br](https://painel.waterworks.com.br)

## Visão Geral

Painel administrativo + pipeline de sincronização Omie ⇄ Supabase. Mono-repo com:
- **Web app** (`web/`) — Next 16, painel administrativo (dashboards, reconciliação, jobs)
- **Scripts** (`scripts/`) — pipeline ETL Omie → Supabase
- **Apps Script** (`apps-script/`) — código Google Apps Script (planilhas)
- **SQL** (`sql/`) — migrations + views

Domain `painel.waterworks.com.br` serve só o `web/` (Vercel project: `web`).

## Estrutura do Mono-repo

```
omie-supabase-sync/
├── web/              ← Next 16 painel administrativo (Vercel project "web")
│   ├── src/app/      ← App Router
│   ├── src/lib/      ← helpers, omieFetch, supabase clients
│   └── package.json  ← v1.4.3
├── scripts/          ← Node scripts pra sync Omie → Supabase
├── sql/              ← Migrations + views (approval.*, sales.*, orders.*)
├── apps-script/      ← Google Apps Script (relatórios em planilha)
├── docs/             ← Documentação (esta pasta inclusive)
└── cmds.sh           ← Atalhos
```

## Stack

| Camada | Tech |
|---|---|
| Frontend | Next.js 16.2.4 + React 19 |
| Auth | Supabase SSR (`@supabase/ssr`) |
| Sync | Node scripts em `scripts/` (cron interno ou agendado externamente) |
| Apps Script | Google Workspace (relatórios em Sheets) |
| Deploy | Vercel project `web` |

## Views Supabase Importantes

Geradas/mantidas pelos scripts ETL:

- `approval.v_pc_avulsos` — vendas avulsas pendentes (consumido pelo painel-vendas do waterworks-app)
- `approval.v_pc_completo_enriched` — enriched com etapa, projeto
- `sales.pedidos_venda` — pedidos
- `orders.etapas_faturamento` — etapas (Faturado, Executada, Cancelado, etc)

## Integrações

- **Omie API** — pull bi-direcional (pedidos, custom_fields, etapas)
- **WaterWorks app** → consome as views via `omieFetch` ([[13-Painel-de-Vendas-Omie no vault waterworks-app]])
- **Google Sheets** via Apps Script — relatórios automatizados

## Convenções

- **Mono-repo**: cada subpasta com seu próprio `package.json`
- **Web app** versionado independente das views/scripts
- **Migrations SQL** em `sql/` aplicadas via psql (não há runner unificado)

## Versões Recentes

- web v1.4.3 (atual)

## Próximos passos (Fase B)

- Documentar cada rota do painel (dashboards, reconciliação, etc)
- Detalhar pipeline de sync (scripts/)
- Documentar views Supabase (estrutura, queries, performance)
- Documentar apps-script

## Tags
#painel-waterworks #overview #omie #admin
