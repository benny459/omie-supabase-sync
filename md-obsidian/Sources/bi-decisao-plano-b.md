---
source_type: decision
author: benny
url_original: (conversação)
ingested_at: 2026-07-01
---

# Decisão: bi.waterworks.com.br → Plano B (rewrite Next.js sem dependência de Metabase)

## Contexto

`bi.waterworks.com.br` já é um Next.js app separado na Vercel (não é proxy pro Metabase que roda no Mac Mini via Tailscale em `100.64.8.120:3000`). Hoje só tem tela de login (`WaterWorks BI — Business Intelligence — SafeWater (SF)`).

Metabase local no Mac Mini tem uma série de dashboards já preparados (visão geral SafeWater, faturamento, contas a pagar, etc).

## Decisão

**Enquanto**: continuar modelando dashboards no Metabase (é mais rápido pra iterar).
**No fim da modelagem**: executar **Plano B** — rewrite full-custom em Next.js, `bi.` lendo Supabase direto, sem Metabase em produção.

## Por quê

1. **Independência de infra remota** — sem depender do Mac Mini rodando 24/7
2. **UI totalmente customizável** — Metabase amarra visual
3. **Reusável em outros clientes** — bi. vira produto multi-tenant no futuro
4. **Agente IA financeiro nativo** — mais fácil integrar Claude com Supabase direto do que passar por Metabase API

## Arquitetura-alvo

| Camada | Ferramenta | Onde roda |
|---|---|---|
| Modelagem (rascunhar queries, iterar) | Metabase | Local (Docker on-demand) ou Mac Mini enquanto durar |
| Produção (BI que cliente vê) | `bi.waterworks.com.br` (Next.js) | Vercel, lê Supabase direto |
| "Botão sync" | Script one-shot que extrai SQL das questions do Metabase e scaffolda `.tsx` | Rodado manualmente na migração |
| Agente IA financeiro | Claude (Vercel AI SDK) + tool `execute_sql` sobre Supabase | Dentro do `bi.` |

Depois de portada, cada dashboard **não toca no Metabase nunca mais**. Mac Mini pode morrer sem impacto.

## Decisões pendentes (definir na hora do Plano B)

1. **Isolamento multi-cliente**: Supabase por cliente (mais simples/seguro) ou `tenant_id` em toda tabela (escala melhor)?
2. **Deploy por cliente**: `safewater.bi.waterworks.com.br` (subdomínio, branding próprio) ou `bi.waterworks.com.br/safewater` (path)?
3. **Dashboards genéricos vs específicos**: template reusado pra todo cliente, ou cada cliente inventa os seus?

## Agente IA — arquitetura preferida

**Hybrid**: RAG sobre catálogo de "métricas conhecidas" (DRE, contas a receber por vencimento, break-even, etc) primeiro; se não encontrar, gera SQL nova com schema Supabase no prompt. Vercel AI SDK + Anthropic (Opus pra análises complexas, Haiku 4.5 pra Q&A rápido).

## Tags
#painel-waterworks #bi #decisao #plano-b #metabase #ia
