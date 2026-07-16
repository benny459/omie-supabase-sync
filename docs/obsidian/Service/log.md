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

## [2026-07-02] migracao | Downgrade Hetzner Metabase v0.62.3.5 → v0.61.2.9 (mirror do Mac Mini)

- **Motivo:** telas do v0.62 na Hetzner não bateram com o Mac Mini (sidebar, home, fontes Lato removidas). "Mesmas telas + mesma configuração" só via mesma versão.
- **Estado antes:** 143 cards + 6 dashboards migrados em jun/2026 via API export/import (v0.61 Mac Mini → v0.62 Hetzner). Trabalho novo v0.62 de 01–02/jul (dashboard "Análise de Resultados" + import CS + view `finance.v_extratos_consolidado`) foi **descartado da UI** — as tabelas Supabase seguem intactas, dashboard será recriado depois em cima do v0.61.
- **Fluxo:**
  1. Backups defensivos: dump Postgres v0.62 + snapshot Caddyfile (`/root/backups/`).
  2. Export completo do Mac Mini (100.64.8.120:3000 via Tailscale) para JSON: 184 cards + 7 dashboards + 4 collections + 2 databases (schemas Omie/CRM).
  3. Pin `docker-compose.yml` em `metabase/metabase:v0.61.2.9`, drop+recreate `metabaseappdb`, migrations v0.61 do zero.
  4. Bootstrap admin + recreate DB connections (Omie + Operações) reusando senhas extraídas do v0.62 (Metabase sem `MB_ENCRYPTION_SECRET_KEY` → senhas em plain text em `metabase_database.details`).
  5. Import 148 cards + 6 dashboards SafeWater com remap de `database_id`, `collection_id`, `field_id` (1801 fields casados por `schema.table.column`).
  6. **Bug encontrado:** v0.61 rejeita `tabs` no `PUT /api/dashboard/{id}` (ClassCastException); dashboard "Visão Geral — SafeWater" ficou com 127 cards órfãos. Fix: enviar `tabs` + `dashcards` juntos via `PUT /api/dashboard/{id}/cards` (script `scripts/metabase-migration/fix_dashboard_tabs.py`).
  7. Homepage setada pra dashboard 2 via `custom-homepage-dashboard`.
  8. Caddyfile limpo: removido `order replace after encode`, `handle_path /caddy-fonts/*`, `handle_path /caddy-css/*`, bloco `replace { "</head>" ... }`. v0.61 tem Lato bundled — CSS custom não necessário.
- **CRM (Propostas) conectado** logo depois da migração inicial (host `aws-0-sa-east-1.pooler.supabase.com`, user `bi_readonly.epoazrnafevkirxhkmog`); card "Pipeline CRM por Status" (id novo=188) reimportado via `import_orphan_card.py`, dashcard broken (card 115, DB=Operações) removido e arquivado. Os 40 cards adicionais planejados ainda a criar.
- **Dashboard "Análise de Resultados" recriado** — 8 cards + 2 filtros globais (`mes_ref`, `janela_meses`), collection "Análise Financeira" (id=6), dashboard id=8. Script `scripts/metabase-migration/rebuild_analise_resultados.py` (idempotente). Todas as queries leem `finance.v_extratos_consolidado` conforme atualização de 02-jul.
- **Backup automático instalado** — `/root/apps/metabase/backup.sh` roda daily 03:05 (cron). Rotação: 14 dailies + 12 monthlies em `/root/backups/`. rclone v1.74.3 instalado. Upload pro Cloudflare R2 (bucket `allka-metabase-backups`) já cabeado no script — ativa sozinho quando o remote `r2` for configurado em `~/.config/rclone/rclone.conf`.
- **[2026-07-04] Novo card "Gastos Operacionais por Técnico"** (id=198) no tab A Pagar do dashboard 2. Agrupa por `raz_cliente` do Omie, decompondo categorias compostas ("Pedágio (19%); Combustível (61%); ..." → 1 linha por categoria com valor rateado via regex `regexp_matches(des_categoria, '([^;()]+?) \(([0-9,\.]+)%\)', 'g')`). Whitelist categorias operacionais (Pedágio, Estacionamento, Combustível, Vale Refeição/Transporte, Refeição, Ferramentas, Correios, Reserva de Hotel). Blacklist regex `!~*` exclui LTDA/LIMITADA/EIRELI/LOCADORA/COMERCIO/INDUSTRIA/CONSTRUCAO/CONDOMINIO/FUNDACAO/SECRETARIA/S\.A\.` + exige espaço no nome. Novo filtro global `Técnico` (string/=) adicionado ao dashboard 2. Card responde a `Período`, `Categoria`, `Técnico`. Nota: Elias Vieira aparece 2× no Omie (com/sem "DOS SANTOS") — limpeza de dados no Omie desejável.
- **Bug MBQL 2.0 field_id remap (fix 2026-07-03/04)** — inicialmente 10 cards apresentavam "Houve um problema ao exibir este gráfico" no sweep standalone; após sweep via endpoint do dashboard (com parâmetros aplicados como o UI faz), descobertos **64 cards** afetados no total. Causa: `remap_in_place` do `import_to_hetzner.py` só tratava MBQL v1 (`['field', <id>, opts]`); v0.61 card_schema ≥ 22 usa MBQL 2.0 em template-tag dimensions (`['field', <opts_dict>, <id>]` — id na posição 2). Field 1261 do Mac (`finance.pesquisa_titulos.dt_vencimento_d`, date) apontava pro field 1261 do Hetzner (`finance.pesquisa_titulos.desconto`, numérico) → erro em runtime nas queries com filtro `periodo=thisyear`. **Fix em bulk:** `/tmp/bulk_fix.py` (64/64 patched) + patch preventivo em `import_to_hetzner.py`, `fix_dashboard_tabs.py` e `fix_broken_cards.py`. **Verificação final:** sweep via `POST /api/dashboard/{did}/dashcard/{dcid}/card/{cid}/query` em todos os 7 dashboards (184 dashcards, 38 parâmetros distintos) — **0 falhas**.
- **Não migrado:** Sample Database (E-commerce Insights) — v0.61 recria automaticamente se quiser.
- **Scripts versionados:** `scripts/metabase-migration/{export_from_mac_mini,bootstrap_hetzner,import_to_hetzner,fix_dashboard_tabs}.py`. Secrets em `scripts/metabase-migration/secrets/` (gitignored).
- **Rollback:** dumps em `/root/backups/metabase-v062-defensive-20260702-1610.sql.gz` e `metabase-pre-downgrade-20260702-1511.sql.gz` no allka-01.

## [2026-07-02] plan | Análise de resultados avançada — margem por segmento + simulador BE

- Spec atualizado em [[Sources/metabase-analise-resultados]] com **Card 9** e **Card 10** (novos):
  - **Card 9 — Margem de Contribuição por Segmento**: distribui custos variáveis (COGS, folha PJ, Cartão CS, devoluções) por segmento de receita (MRR, Projetos, Revenda, Avulsos, BOT/SW) usando **matriz de atribuição fixa** (documentada). Calcula margem % por segmento.
  - **Card 10 — Simulador de Break-even por Mix**: user digita receita esperada de cada segmento + custo fixo, retorna contribuição total, break-even ponderado, folga/déficit, e quanto precisa ADICIONAL em Projetos pra fechar.
- Matriz de atribuição (base pra ambos cards):
  - COGS Revenda → 100% Revenda
  - COGS MP → 85% Projetos + 10% Avulsos + 5% MRR
  - Insumos → 80% MRR + 15% Projetos + 5% Avulsos
  - Folha PJ → 50% MRR + 20% Projetos + 20% Avulsos + 5% Revenda + 5% BOT/SW
  - Cartão CS técnicos → 50% MRR + 30% Projetos + 15% Avulsos + 5% Revenda
  - (etc — ver spec completa)
- Margens de contribuição estimadas (jun/26, referência): **MRR 60% · Projetos 61% · BOT/SW 92% · Revenda 1% · Avulsos 0%**
- Fase 2 renomeada como Fase 3 (cards 11-15) — sem alteração de conteúdo.
- **Layout do dashboard atualizado** — nova seção "Análise por Segmento e Simulação" entre AR/AP aging e Delta Inexplicado.
- **Próximo passo:** criar Card 9 e Card 10 no Metabase (via script rebuild ou manual) — mesmas queries do spec, testar valores em ambiente antes de commitar.

## Tags
#painel-waterworks #meta #log
