# Rentabilidade por Cliente — Implementação (2026-07-20)

> Consolidação Faturamento × Compras × Custo Técnico × Despesas por cliente. Overview: [[Sources/RENTABILIDADE-00-Visao-Geral|RENTABILIDADE-00]] (no vault do waterworks-app). Este arquivo documenta o que foi implementado nas 3 pontas neste sprint.

## Arquitetura entregue

```
     WW main (tfwsakurlgkfnccoovyl)              omie-data (zodflkfdnjhtwcjutbjl)
     ─────────────────────────────               ───────────────────────────────
                                                 sales.faturamento_unificado  (receita, canônico)
                                                          │
                                                          ▼
     bi.v_custo_por_cliente                       sales.v_cliente_receita_compras  ◀── approval.v_compras_por_cliente
     (cliente × técnico × mês)                    (receita + compras JÁ juntas na mesma base)
              │                                            │
              │  cron 06:15 SP daily                       │
              │  scripts/sync-custo-cliente/sync.sh        │
              │  (allka-01, extrai via Metabase creds)     │
              ▼                                            ▼
     bi.custo_cliente_snapshot ──────────►  bi.v_rentabilidade_cliente
                                                          │
                                                          ▼
                                              Metabase: "Rentabilidade por Cliente" (10 cards)
```

## O que ficou onde

### DB waterworks-os (`tfwsakurlgkfnccoovyl`)
- Nova view: **`bi.v_custo_por_cliente`** (agregação cliente × técnico × mês)
- Sentinels de bucket: `-1 EMPRESA · -2 COMERCIAL · -3 OUTROS · -4 AVULSO_NAO_VINC · -9 NAO_ATRIBUIDO`
- Regras: despesa aprovada = `Aprovado`/`Aprovado Parcial`, valor coberto = `valor − valor_a_descontar`
- Custo MO = `(checkout - checkin) × tecnico_valor_hora vigente`
- GRANT `bi_readonly` (Metabase-ready)

### DB omie-data (`zodflkfdnjhtwcjutbjl`)
- Nova view: **`approval.v_compras_por_cliente`** — PCs `status='APROVADO'`, taxonomia via [[Base-Supabase/Views-Canonicas|cat_venda]]
- Nova view: **`sales.v_cliente_receita_compras`** — pré-consolida receita + compras na mesma base
- Novo schema: **`bi`**
- Nova tabela: **`bi.custo_cliente_snapshot`** (populada pelo cron)
- Nova view: **`bi.v_rentabilidade_cliente`** — consolidação final
- GRANTs: `bi_readonly` (Metabase read) + `waterworks_bi` (Metabase write só no snapshot)
- Sentinel adicional: `-10 COMPRAS COMPARTILHADAS` (PCs sem PV origem)

### Servidor allka-01 (Metabase host)
- Novo script: `/root/apps/sync-custo-cliente/sync.sh` — Bash + Docker postgres:16
- Extrai creds direto do Metabase Postgres (`metabase_database.details::jsonb`, plain text — sem `MB_ENCRYPTION_SECRET_KEY`)
- Cron: `15 9 * * * /root/apps/sync-custo-cliente/sync.sh` (09:15 UTC = 06:15 SP)
- Log: `/var/log/sync-custo-cliente.log`
- Volume: 3.342 linhas atualmente (jul/2026)

### Repo omie-supabase-sync
- Novo script: `scripts/metabase-migration/rebuild_rentabilidade_cliente.py` — cria dashboard idempotente

### Metabase (metabase.waterworks.com.br)
- Dashboard novo: **"Rentabilidade por Cliente"** (via script Python)
- 10 cards: 4 KPIs + tabela detalhe + top prejuízo + tipo venda + ranking margem + tendência mensal + card órfãos
- 5 filtros: `mes_inicio`, `mes_fim`, `tipo_venda`, `codigo_projeto`, `tecnico`
- Collection: "Análise Financeira" (id 6)

## Achados reveladores

Primeira rodada da consolidação (últimos 6 meses):

| Dimensão | Achado |
|---|---|
| **Custos por bucket** | R$ 115k atribuídos a 47 clientes reais; R$ 36k EMPRESA overhead; R$ 11k AVULSO_NAO_VINC (53 nomes); R$ 8k em customers sem link Omie |
| **Compras** | **100% dos R$ 283k caem em `-10 COMPARTILHADAS`** — nenhum PC hoje é atribuído a cliente direto (via PV) |
| **Link Omie** | 58 dos 130 customers app (~44%) sem `omie_codigo_cliente` cadastrado |
| **valor_hora** | Só 10 técnicos com cadastro — demais têm `custo_mao_obra=NULL` no dashboard |
| **Fuzzy match nomes** | 121 nomes distintos em `cliente_avulso_nome`, só 57 batem exato com `customers.nome` — hospitais com variação (ex: "AC CAMARGO" vs "A C CAMARGO") |

## Evolução futura (v2)

- **Compras via PV** → PCs criados via PV origem naturalmente pegam `pv_cliente_codigo`, saem do bucket -10
- **Rateio via `contratos_servico`** — quando projeto guarda-chuva (`47_CONTRATUAL`, `43_ESTOQUE`) tem contratos ativos, ratear proporcionalmente
- **Fuzzy match no `cliente_avulso_nome`** — sugestão automática de vínculo na tela do waterworks-app
- **Auxiliares no custo MO** — hoje só `lider_id`; parsear `service_orders.auxiliares` (CSV text) pra distribuir horas
- **Tela de vínculo Omie** (spec 01 amplificado, ainda pendente) — reduz os 58 customers sem link direto

## Ver Também

- [[Base-Supabase/Views-Canonicas]] — mapa completo (com as 4 views novas)
- [[Metabase/00-Overview-Metabase]] — dashboard novo listado
- [[Painel/12-Faturamento]] — mesma taxonomia (`cat_venda`)
- [[log]] — entradas 2026-07-20 `[metabase+base]`

## Tags
#rentabilidade #metabase #base #consolidado #entrega
