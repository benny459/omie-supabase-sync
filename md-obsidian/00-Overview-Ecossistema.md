# Ecossistema — Omie 2 / Painel WaterWorks / Metabase

> Repo `omie-supabase-sync` cobre 3 produtos que compartilham a mesma base Supabase (`omie-data` — projeto `zodflkfdnjhtwcjutbjl`).

## Os 3 Produtos

| Produto | O que é | Onde vive | Deploy | Vault |
|---|---|---|---|---|
| **Painel** | painel.waterworks.com.br — Next 16, painel operacional dia-a-dia (vendas, compras, aprovações, relatórios) | `web/` no repo | Vercel project `web` (via `npm run deploy`) | [[Painel/00-Overview-Painel]] |
| **Metabase** | metabase.waterworks — self-hosted na Hetzner (allka-01), BI executivo/financeiro, dashboards + cards SQL | Container Docker em `188.245.161.139` | Manual via SSH + backup diário 03:05 UTC | [[Metabase/00-Overview-Metabase]] |
| **Base Supabase** | `omie-data` — dados canônicos (Omie sync + overlay platform + views) que alimentam AMBOS | Supabase managed | Migrations via MCP `apply_migration` | [[Base-Supabase/00-Overview-Base]] |

## Estrutura do Mono-repo

```
omie-supabase-sync/
├── web/                    ← Painel (Next 16, Vercel "web")
│   ├── app/(app)/          ← rotas: /avulsos, /projetos, /pcs, /relatorios, /configuracoes, /owner
│   ├── components/         ← BoldAvulsosView (bucket + alarmes), FaturamentoView, AvulsosDailyView, ...
│   ├── lib/                ← helpers, supabase clients, permissions, avulsos-report
│   └── package.json        ← v1.6.8
├── scripts/                ← Sync Omie → Supabase (cron externo) + migração Metabase
│   └── metabase-migration/ ← scripts idempotentes de migração/rebuild Metabase
├── sql/                    ← migrations históricas (approval.*, sales.*, orders.*)
├── apps-script/            ← Google Apps Script (relatórios em Sheets)
└── docs/                   ← este vault + specs antigos
```

Domínio `painel.waterworks.com.br` = Vercel `web` (alias). Metabase acessível internamente ou via IP + subdomain interno.

## Stack por Produto

### Painel
- Next.js 16.2.4 + React 19
- Auth: Supabase SSR (`@supabase/ssr`)
- UI: componentes custom + Tailwind
- Reports: Webex API (daily Avulsos) + Google Apps Script (relatórios em Sheets)

### Metabase
- Metabase v0.61.2.9 (fixado — v0.62 rejeitado pelas telas incompatíveis; downgrade em 02-jul)
- Postgres 16 (metadata) — container `metabase-db`
- Caddy (reverse proxy) — TLS + rewrite `custom-homepage-dashboard`
- Backup: `backup.sh` daily 03:05 + rclone pra Cloudflare R2 (bucket `allka-metabase-backups`, remote a configurar)

### Base Supabase
- Postgres 17 (managed) — projeto `zodflkfdnjhtwcjutbjl` região `sa-east-1`
- Schemas: `sales`, `finance`, `orders`, `approval`, `platform`, `rpa`, `ww_os_remote`
- Views canônicas em [[Base-Supabase/Views-Canonicas]]
- RLS + permissões em [[Base-Supabase/RLS-e-Permissoes]]

## Fluxo de Dados

```
Omie API ──sync scripts──▶ sales.* / finance.* / orders.*
                               │
                               ├──▶ Views canônicas (approval.v_pc_avulsos, v_faturamento_diario, ...)
                               │        │
                               │        ├──▶ Painel (Next) — dashboards operacionais + Webex daily
                               │        └──▶ Metabase — dashboards executivos + análise financeira
                               │
                               └──▶ platform.* (overlay/config — pv_liberacao_status, excluded_pv_os,
                                    user_module_roles, avulsos_daily_snapshots)
```

## Versões Atuais

- **Painel:** v1.6.8 (2026-07-20)
- **Metabase:** v0.61.2.9 (fixado desde 2026-07-02)
- **Base:** Supabase Postgres 17.6 (managed, auto-updates de patch)

## Convenções

- Mono-repo: cada subpasta com seu próprio `package.json`
- Painel versionado independente (bump patch via `npm run deploy`)
- Migrations SQL: hoje via `mcp__supabase__apply_migration` (não há runner unificado antigo em `sql/`, é histórico)
- Vault: LLM-maintained wiki (Karpathy) — Claude opera via [[_schema]]

## Ver Também

- [[_schema]] — Como o Claude opera o vault
- [[index]] — Catálogo completo
- [[log]] — Cronologia (prefixada `[painel]/[metabase]/[base]`)

## Tags
#painel-waterworks #metabase #ecossistema #overview
