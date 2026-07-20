# Base Supabase — Overview

> Projeto `omie-data` (`zodflkfdnjhtwcjutbjl`) — base canônica. Fonte pra Painel e Metabase.

## Projeto

- **Ref:** `zodflkfdnjhtwcjutbjl`
- **Nome:** `omie-data`
- **Região:** `sa-east-1`
- **Postgres:** 17.6.1 (managed)
- **Host:** `db.zodflkfdnjhtwcjutbjl.supabase.co`

## Schemas ativos (por número de tabelas)

| Schema | Tabelas | Descrição |
|---|---:|---|
| `public` | 41 | Funções utilitárias + tabelas soltas (histórico) |
| `finance` | 29 | Títulos AR/AP, projetos financeiros, extratos, categorias |
| `approval` | 22 | Views de aprovação — `v_pc_*`, `v_faturamento_diario`, etc |
| `orders` | 11 | Pedidos de compra + etapas |
| `sales` | 10 | Pedidos de venda, ordens de serviço, faturamento unificado |
| `platform` | 9 | Overlay/config do painel (perms, snapshots, exclusões, liberação) |
| `rpa` | 8 | Automação RPA (integrações externas) |
| `ww_os_remote` | 3 | Bridge com app /servicos (outro repo) |
| `cron` | 2 | Cron jobs internos |
| `rh` | 1 | RH |

## O que alimenta cada produto

```
Omie API ──sync scripts──▶ sales.*, orders.*, finance.*
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
                approval.*   (SQL raw)  platform.*
                (views)                   (overlay)
                    │                        │
                    ▼                        ▼
              Painel + Metabase       Só Painel
```

## Tabelas platform.* (overlay do painel)

Estas tabelas são **do painel** — não vêm do Omie, são estado gerenciado pelo próprio painel:

- `user_profiles` — users + role + `is_admin` + `permissions` (jsonb legacy)
- `user_module_roles` — perms granulares por módulo × ação (ver [[RLS-e-Permissoes]])
- `pv_liberacao_status` — overlay [[../Painel/11-Aguardando-Liberacao|Aguardando Liberação]]
- `excluded_pv_os` — PV/OS excluídos manualmente do painel
- `avulsos_daily_snapshots` — histórico do [[../Painel/13-Daily-Avulsos|daily Webex]]
- `fetch_omie_log` — audit dos syncs manuais
- `scheduler_log` — audit de cron interno
- `workflow_schedule` — jobs agendados
- `approvers` — legado (perm de aprovador)

## Views canônicas

Ver [[Views-Canonicas]] pra lista completa (19 views). Destaques:

- `approval.v_pc_avulsos` — motor do painel /avulsos + daily Webex
- `approval.v_faturamento_diario` — /relatorios/faturamento
- `approval.v_pc_projetos` / `v_pc_pcs` — /projetos, /pcs
- `sales.faturamento_unificado` — UNION OS+PV faturados (Metabase + painel)
- `finance.v_extratos_consolidado` — cash flow (Metabase dashboard 8)
- `finance.v_titulos_com_tipo_venda` — MRR analysis

## Funções canônicas

- `public.cat_venda(codigo_categoria)` — taxonomia oficial de segmento de venda. Ver [[Views-Canonicas]] + [[../Painel/12-Faturamento]] + [[../Metabase/Dash-8-Analise-Resultados]]
- `approval.try_parse_br_date(text)` — parse defensivo DD/MM/YYYY
- `public.parse_ddmmyyyy(text)` — variação
- `public.is_admin()` — helper RLS (checa `platform.user_profiles.is_admin`)

## Access

- **MCP:** `mcp__claude_ai_Supabase__*` ferramentas via Anthropic (execute_sql, apply_migration, list_tables, get_logs, etc)
- **Painel (web):** `supaServer()` + `supaAdmin()` em `web/lib/`
- **Metabase:** conexão Postgres read-only via user `bi_readonly`
- **Direct psql:** conectar via `db.zodflkfdnjhtwcjutbjl.supabase.co` (necessita pooler pra prod)

## Ver Também

- [[Views-Canonicas]] — as 19 views (com origem e consumidor)
- [[RLS-e-Permissoes]] — modelo de perms + policies
- [[../00-Overview-Ecossistema]]

## Tags
#supabase #base #schemas #overview
