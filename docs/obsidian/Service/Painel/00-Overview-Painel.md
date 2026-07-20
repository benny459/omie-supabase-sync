# Painel — Overview

> painel.waterworks.com.br · Next 16 · Vercel project `web` · versão **v1.6.8** (2026-07-20)

## O que é

Painel operacional dia-a-dia da WaterWorks. Cobre:
- **Vendas avulsas** (PVs/OSs sem projeto formal) — pipeline completo com alarmes
- **Projetos** (PJxxx) — pipeline projeto + cronograma + budget/materiais
- **Compras** (PCs) — aprovação, tracking Omie
- **Relatórios** — Faturamento (dia-a-dia por categoria) e Daily Avulsos (Webex)
- **Owner view** (agregada, chief-level)
- **Configurações** — user roles, tabelas admin

Usuários hoje: Benny (admin), Fernanda (aprovador vendas), Erick (comprador), Cristina (serviços).

## Estrutura de Rotas

Todas em `web/app/(app)/` (layout compartilhado com auth SSR + sidebar).

| Rota | Módulo | Página |
|---|---|---|
| `/avulsos` | Vendas avulsas | [[10-Avulsos]] |
| `/projetos`, `/projetos/[codigo]/materiais` | Projetos | [[20-Projetos]] |
| `/pcs` | Compras | [[21-PCs]] |
| `/relatorios/faturamento` | Relatório dia-a-dia | [[12-Faturamento]] |
| `/relatorios/avulsos-daily` | Daily Webex | [[13-Daily-Avulsos]] |
| `/owner` | Owner view | [[22-Owner]] |
| `/configuracoes`, `/configuracoes/tabelas` | Config | [[30-Configuracoes]] |

## Overlays / Features de comportamento

Estados/lógicas que atravessam múltiplas rotas:
- [[11-Aguardando-Liberacao]] — bloqueio manual em PV/OS avulsa quando cliente sem PC formal

## Componentes-chave

- `BoldAvulsosView` (4000+ linhas) — motor principal do /avulsos, /projetos e /pcs. Renderiza buckets, pipeline, alarmes, filtros.
- `GroupedModuleView` — camada mais fina do painel (contexto de módulo + PermissionsBadge)
- `FaturamentoView` — /relatorios/faturamento (KPIs por categoria + stack chart por dia)
- `AvulsosDailyView` — /relatorios/avulsos-daily (skeleton + Webex preview + chart 14d + tabela por seção)
- `FiltersBar` — filtros de facetas compartilhados
- `Pipeline` — rendering dos "dots" de estado (green/yellow/red/off) + overlays (ex: cadeado 🔒 do Aguardando Liberação)

## Sistema de Permissões

Ver [[Base-Supabase/RLS-e-Permissoes]] pro modelo canônico. TL;DR:

- `platform.user_profiles`: `is_admin`, `role`, `permissions` (JSONB legacy)
- `platform.user_module_roles`: por módulo × ação — `can_edit_pv`, `can_edit_rc`, `can_edit_pc`, `can_approve`, `can_edit_log`, `can_view_values`, `can_view_margin`, `can_release_pv` (novo v1.6.5), `approval_ceiling_brl`, `weekly_budget_brl`
- Helper: `web/lib/permissions.ts` — `canEdit()`, `canApprove()`, `canReleasePv()`, `canViewValues()`, `canApproveValue()`

## Reports Automatizados

- **Daily Webex** (Avulsos) — cron `0 11 * * 1-5` chama `/api/cron/avulsos-daily-send` → `computeReportCounts` + `sendMarkdownToWebex`. Snapshot cron `55 10 * * *` grava em `platform.avulsos_daily_snapshots` (usado no chart 14d).
- **Bug analyze** — cron `*/5 * * * *` (job interno de análise, ver `/api/cron/bug-analyze`).

## Deploy

```bash
cd web
npm run deploy   # bumpa patch + vercel --prod --yes
```

Script auto-bumpa `package.json` sem commit — bumps acumulados são consolidados em commit `chore:` esporádico.

Domain alias: `orders.allka.ai` também aponta pro mesmo Vercel project (migração futura pra Allka; hoje domínio principal segue sendo painel.waterworks.com.br).

## Ver Também

- [[00-Overview-Ecossistema]] — visão macro
- [[../Base-Supabase/Views-Canonicas]] — views que o painel consome
- [[../Metabase/00-Overview-Metabase]] — BI (irmão do painel, mesma base)

## Tags
#painel-waterworks #overview
