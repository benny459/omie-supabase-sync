# index.md — Catálogo (Painel · Metabase · Base)

> Catálogo content-oriented. **Consultar primeiro** em query. Atualizar a cada página nova.

**Última atualização:** 2026-07-20 · **Status:** Estrutura completa (Painel + Metabase + Base) — Fase B iniciada

## Meta

- [[_schema]] — Convenções do vault (como o Claude opera)
- [[README]] — Intro humano
- [[index]] — (este) Catálogo
- [[log]] — Cronologia prefixada `[painel]/[metabase]/[base]/[meta]`

## Overview

- [[00-Overview-Ecossistema]] — Mapa macro (painel + metabase + base + fluxo de dados)

## Painel (painel.waterworks.com.br)

- [[Painel/00-Overview-Painel]] — v1.6.8, rotas, componentes, perms
- [[Painel/10-Avulsos]] — `/avulsos` — pipeline, alarmes, buckets
- [[Painel/11-Aguardando-Liberacao]] — overlay bloqueio manual (v1.6.5+)
- [[Painel/12-Faturamento]] — `/relatorios/faturamento` — dia-a-dia por categoria
- [[Painel/13-Daily-Avulsos]] — `/relatorios/avulsos-daily` — preview + Webex cron
- [[Painel/20-Projetos]] — `/projetos` + `/projetos/[codigo]/materiais`
- [[Painel/21-PCs]] — `/pcs` — aprovação + tracking
- [[Painel/22-Owner]] — `/owner` — visão executiva (stub)
- [[Painel/30-Configuracoes]] — `/configuracoes` + APIs admin

## Metabase (allka-01)

- [[Metabase/00-Overview-Metabase]] — v0.61.2.9, stack, migração, backup
- [[Metabase/01-Catalogo-Cards]] — índice de cards (190 ativos)
- [[Metabase/Dash-2-Visao-Geral-SafeWater]] — 133 cards, homepage
- [[Metabase/Dash-3-Faturamento]] — 7 cards, mesma taxonomia que [[Painel/12-Faturamento]]
- [[Metabase/Dash-4-Contas-a-Receber]] — 16 cards
- [[Metabase/Dash-5-Contas-a-Pagar]] — 16 cards
- [[Metabase/Dash-6-Contratos-CT]] — 6 cards, MRR
- [[Metabase/Dash-7-Margem-por-Projeto]] — 4 cards
- [[Metabase/Dash-8-Analise-Resultados]] — 8+2 cards, BI executivo

## Base Supabase (omie-data)

- [[Base-Supabase/00-Overview-Base]] — projeto, schemas, funções canônicas
- [[Base-Supabase/Views-Canonicas]] — as 19 views (com origem e consumidor)
- [[Base-Supabase/RLS-e-Permissoes]] — modelo de perms + policies

## Decisões e Análises (Sources — imutáveis)

- [[Sources/bi-decisao-plano-b]] — Decisão: bi.waterworks.com.br será rewrite Next.js sem Metabase em produção (2026-07-01)
- [[Sources/metabase-analise-resultados]] — Spec completo dos Cards 1-10 do dashboard 8 (2026-07-01, expandido 07-02)

## Convenção de log

`## [YYYY-MM-DD] [produto] tipo | título`

Produto: `painel` · `metabase` · `base` · `meta` (ou combinações `painel+base`)
Tipo: `setup` · `fix` · `feature` · `ux` · `decisao` · `analise` · `deliverable` · `migracao` · `plan` · `reorg`

Grep útil:
- Só painel: `grep '\[painel' log.md`
- Só metabase: `grep '\[metabase' log.md`

## Tags
#painel-waterworks #metabase #meta #index
