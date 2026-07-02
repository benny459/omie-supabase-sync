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

## [2026-07-02] deliverable | Import Cartão Conta Simples (jan-jun/2026) + view consolidada

- **Nova tabela** `finance.despesas_cartao_cs`: 4.125 registros importados (jan-jun/2026, R$ 193.543,10)
- Fontes combinadas: `Conta Simples.xlsx` (jan → 17/05) + `Transações_cartões...xlsx` (18/05 → 30/06)
- Categorização: `Categoria Final` do CS (validada) + learner com fallback regex pras 10 categorias Omie
- Nomes técnicos: nomenclatura Omie oficial (16 fornecedores)
- **Nova view** `finance.v_extratos_consolidado`: UNION extratos_cc + despesas_cartao_cs pra queries de BI
- Cards 1, 2, 3, 5, 8 do dashboard atualizados pra usar a view
- **A partir de 2026-07:** dados vêm via integração app.waterworks ↔ Conta Simples (não usar este import manual daqui em diante)

### Impacto imediato nas análises

Descoberta chave — antes o Cartão CS tinha só R$ 20 de saídas visíveis em 6 meses. Agora aparece R$ 193k de compras categorizadas.

| | Antes | Depois |
|---|---:|---:|
| Fluxo líquido jun/26 | +R$ 8k | **−R$ 24.569** |
| Break-even (rolling 3m) | R$ 612k | **R$ 746.440** |
| Folga vs receita | +R$ 28k | **−R$ 63.702** |
| % variável | ~34% | **57,2%** |

O Benny estava operando com viés positivo de ~R$ 90k/mês. Break-even real é ~R$ 130k mais alto que o percebido.

## Tags
#painel-waterworks #meta #log
