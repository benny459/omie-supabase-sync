# Metabase — Overview

> BI executivo/financeiro self-hosted na Hetzner (allka-01). **v0.61.2.9** (fixado desde 2026-07-02).

## Onde vive

- **Servidor:** allka-01 (Hetzner CPX22, `188.245.161.139`)
- **Docker:** 2 containers
  - `metabase` — Metabase v0.61.2.9
  - `metabase-db` — Postgres 16 (metadata dos cards/dashboards/users)
- **Proxy:** Caddy (TLS + subdomain interno). Post-downgrade, sem workarounds (v0.61 tem Lato bundled — não precisa `replace { "</head>" ...}`).
- **Homepage:** dashboard id 2 — [[Dash-2-Visao-Geral-SafeWater]]

## Acesso

- **SSH:** `ssh root@188.245.161.139`
- **Postgres metadata:** `docker exec metabase-db psql -U metabase -d metabaseappdb`

## Dashboards (7 ativos + 1 sample)

| ID | Nome | Cards | Página |
|---:|---|---:|---|
| 1 | E-commerce Insights | 36 | (sample, ignorar) |
| **2** | Visão Geral — SafeWater | 133 | [[Dash-2-Visao-Geral-SafeWater]] |
| 3 | Faturamento — SafeWater | 7 | [[Dash-3-Faturamento]] |
| 4 | Contas a Receber — SafeWater | 16 | [[Dash-4-Contas-a-Receber]] |
| 5 | Contas a Pagar — SafeWater | 16 | [[Dash-5-Contas-a-Pagar]] |
| 6 | Contratos CT — SafeWater | 6 | [[Dash-6-Contratos-CT]] |
| 7 | Margem por Projeto — SafeWater | 4 | [[Dash-7-Margem-por-Projeto]] |
| **8** | Análise de Resultados | 8 | [[Dash-8-Analise-Resultados]] |
| **9** | Rentabilidade por Cliente *(novo 2026-07-20)* | 10 | [[../RENTABILIDADE-04-implementacao]] |

Total: 190 cards ativos (excluindo sample). Ver [[01-Catalogo-Cards]] pra catálogo compact.

## Bases de dados conectadas

- **Omie** — schema `sales.*`, `orders.*`, `finance.*`, `approval.*` (mesma base que o painel consome)
- **Operações** — schema separado (CRM propostas)
- **CRM (Propostas)** — Supabase project `epoazrnafevkirxhkmog` (host pooler `aws-0-sa-east-1.pooler.supabase.com`, user `bi_readonly.epoazrnafevkirxhkmog`)

Todas via user Postgres read-only.

## Função canônica de classificação

`public.cat_venda(codigo_categoria)` — mapeamento dos códigos Omie 1.01.XX pra rótulos humanos (Contratuais/Projetos/Revenda/Avulsos/BOT-SW/Outras). Usada por todos os dashboards de faturamento + adotada pelo [[../Painel/12-Faturamento|painel de Faturamento]] em 2026-07-17.

## Migração (histórico)

- **Origem:** Mac Mini com v0.61 (100.64.8.120:3000 via Tailscale)
- **Downgrade:** v0.62.3.5 (fresh Hetzner install) → v0.61.2.9 em 02-jul (motivo: telas incompatíveis; script `pin` no docker-compose)
- **Bug MBQL 2.0:** 64 cards com field_id remap quebrado (1261 date → 1261 numérico). Fix bulk `/tmp/bulk_fix.py` + preventivo em `import_to_hetzner.py`.
- **Bug tabs API:** v0.61 rejeita `tabs` em `PUT /api/dashboard/{id}` (ClassCastException) — fix `scripts/metabase-migration/fix_dashboard_tabs.py`
- **Análise de Resultados** recriada via `rebuild_analise_resultados.py` (idempotente)
- Ver detalhes completos no [[../log|log]] entrada 2026-07-02

## Backup

- **Script:** `/root/apps/metabase/backup.sh` (cron `0 3 * * *` — 03:05 UTC)
- **Local:** `/root/backups/metabase-daily-YYYYMMDD.sql.gz`
- **Rotação:** 14 dailies + 12 monthlies
- **Cloud:** rclone v1.74.3 instalado, cabo pro Cloudflare R2 bucket `allka-metabase-backups` — **remote `r2` ainda a configurar** em `~/.config/rclone/rclone.conf`
- **Rollback disponível:** `metabase-v062-defensive-20260702-1610.sql.gz` (pré-downgrade)

## Roadmap

- **bi.waterworks.com.br → Plano B:** Metabase permanece como ferramenta de modelagem/protótipo local; produção migra pra `bi.` Next.js quando estabilizar. Ver [[../Sources/bi-decisao-plano-b]].
- **Cards a criar:** 40 novos cards de CRM (Propostas) planejados
- **Novos cards recentes:** Card 9 (Margem por Segmento) + Card 10 (Simulador BE por Mix) — spec em [[../Sources/metabase-analise-resultados]], a criar no Metabase

## Scripts

Todos em `scripts/metabase-migration/`:
- `export_from_mac_mini.py` — export completo (cards, dashboards, collections, databases) pra JSON
- `bootstrap_hetzner.py` — cria admin + reconecta DBs no v0.61 fresh
- `import_to_hetzner.py` — importa JSON com remap de ids (patch MBQL v2 embutido desde 04-jul)
- `fix_dashboard_tabs.py` — workaround do bug tabs (v0.61)
- `rebuild_analise_resultados.py` — recria dashboard 8 idempotente
- `import_orphan_card.py` — reimportar card órfão
- Secrets: `scripts/metabase-migration/secrets/` (gitignored)

## Ver Também

- [[../00-Overview-Ecossistema]] — mapa macro (painel + metabase + base)
- [[../Base-Supabase/00-Overview-Base]] — dados que o Metabase consome
- [[../Sources/metabase-analise-resultados]] — spec Card 1-10 do dashboard 8
- [[../Sources/bi-decisao-plano-b]] — decisão bi.waterworks Plano B

## Tags
#metabase #overview #bi #hetzner
