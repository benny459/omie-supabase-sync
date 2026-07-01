# log.md — Cronologia Painel-WaterWorks

> Append-only. `## [YYYY-MM-DD] tipo | título`.

---

## [2026-06-27] setup | Vault inicializado (Fase A skeleton)

- Estrutura criada: `docs/obsidian/Service/` (vault) + `md-obsidian/` (backup) + `scripts/sync-vault.sh`
- Templates: _schema, index, log, README, 00-Overview
- Pattern: Karpathy LLM-maintained wiki (ver [[Sources/karpathy-knowledge-base-pattern]] no vault waterworks-app)
- .gitignore atualizado: ignora `Service/.obsidian/`, `.trash/`, `.DS_Store`
- Próximo (Fase B): aprofundar cada módulo do app

## [2026-07-01] decisao | bi.waterworks.com.br → Plano B (rewrite Next.js sem Metabase em prod)

- Metabase permanece como ferramenta de modelagem local; produção migra pra `bi.` Next.js quando estabilizar
- Ver [[Sources/bi-decisao-plano-b]]
- Arquitetura-alvo: `bi.` lê Supabase direto + agente IA financeiro nativo (Vercel AI SDK + Claude)

## [2026-07-01] analise | Análise financeira profunda WW/SafeWater — 2026 YTD

- Correções aplicadas na análise (feedback do Benny): retirada de sócio é fixo obrigatório; categoria 2.03.97 é folha PJ (não empréstimo); transferências intercompany devem ser ignoradas
- Descobertas-chave:
  - Saldo caiu R$ 389k → R$ 69k em 6 meses, MAS operacional está no zero-a-zero (-R$ 20k/mês)
  - Não há dívida bancária substancial; única dívida real é parcelamento tributário (R$ 19k/mês)
  - Grande parte da queda de saldo vem de aplicações/resgates financeiros não categorizados (ex: R$ 689k saindo 11/abr e voltando 12/abr)
  - MRR contratado R$ 1.51M vs faturado R$ 438k = gap gigante; top-1 Fundação Antonio Prudente sub-cobra R$ 22k/mês
  - AP vencido REAL (excluindo legado <2025): R$ 1,05M
- Regras de ouro: piso receita R$ 700k/mês · folha ≤ 40% receita · reserva ≥ 45 dias saídas

## [2026-07-01] deliverable | Dashboard Metabase "Análise de Resultados" (8 cards)

- Spec completo em [[Sources/metabase-analise-resultados]]
- 8 cards com SQL testado no Supabase: KPIs · Cash flow mensal · Break-even dinâmico · Aging AR/AP · Folha % receita · Delta inexplicado diário · MRR gap · Pareto outras saídas
- Filtros globais: mes_ref, janela_meses
- Layout proposto + próximas iterações (Fase 2)

## Tags
#painel-waterworks #meta #log
