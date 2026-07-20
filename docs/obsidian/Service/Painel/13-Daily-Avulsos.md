# /relatorios/avulsos-daily — Daily Avulsos + Webex

> Preview + envio automático do report diário de vendas avulsas via Webex. Snapshot histórico + chart 14d de evolução.

## Rota e componente

- **Rota:** `/relatorios/avulsos-daily`
- **Componente:** `AvulsosDailyView`
- **API report:** `GET /api/relatorios/avulsos-daily` — computa counts atuais + delta vs snapshot anterior
- **API send:** `POST /api/relatorios/avulsos-daily/send` — envia markdown pra Webex
- **API snapshot:** `POST /api/relatorios/avulsos-daily/snapshot` — grava snapshot manual
- **API PNG chart:** `GET /api/relatorios/avulsos-daily/chart.png` — imagem 1200×630 do chart 14d (usada no Webex + standalone)
- **Helper:** `web/lib/avulsos-report.ts` — `computeReportCounts()`, `computeBuckets()`, tipos, detectores

## Estrutura do report

Ordem visual da página (atualizada v1.6.4):

1. **Header** — botões Atualizar / Copiar markdown / Enviar ao Webex / PDF completo
2. **Skeleton** (durante loading) — nunca mais tela branca
3. **Prévia Webex** (bloco verde 👀) — markdown renderizado como o Webex vai mostrar. Confere antes de enviar.
4. **Chart evolução 14d** — SVG multi-linha com toggle por série
5. **Total PVs abertos** + comparativo com dia anterior
6. **4 seções expandíveis** — VENDAS / COMPRAS / SERVIÇOS / FATURAMENTO
7. **Markdown bruto** (`<details>` colapsado) — o texto exato enviado à API Webex

## Seções + AlarmKinds

| Seção | AlarmKinds | Owner |
|---|---|---|
| 🛍️ **VENDAS** | `pvos_incompl`, `sem_projeto`, `aguarda_liberacao` 🔒 (v1.6.5+), `venda` | Fernanda |
| 📦 **COMPRAS** | `sem_rc`, `aprov_pend`, `sem_pc`, `compra`, `defas_omie` | Fernanda (RC/aprov) / Erick (PC/logística) |
| 🛠️ **SERVIÇOS** | `sem_vinculo`, `agend_vazio`, `agend_venc` | Cristina |
| 💵 **FATURAMENTO** | `pode_faturar` | Fernanda |

## Snapshot histórico

- **Tabela:** `platform.avulsos_daily_snapshots`
- **Colunas:** `snapshot_date` (PK), `counts` (jsonb), `vals` (jsonb), `total_pvs`, `captured_at`
- **Cron snapshot:** `55 10 * * *` UTC (= 07:55 SP) — grava counts do dia
- **Cron envio:** `0 11 * * 1-5` UTC (= 08:00 SP, seg-sex) — chama `/api/cron/avulsos-daily-send`

## Delta

Cada linha do report mostra delta count vs último snapshot (ex: `📈 +2`, `📉 -6`, `=`). Delta = `count_hoje - count_snapshot_anterior`. `null` se não há histórico (dia 1).

## PDF completo

Botão "PDF completo" abre a mesma página em modo print (`window.print()` + CSS `@media print`). Cada seção quebra página. Detalhes de PVs expandidos automaticamente. Também acessível via `/relatorios/avulsos-daily?print=1` (auto-triggera print dialog).

## Fixes recentes (v1.6.4)

- **REPORT_COLS faltava colunas** — `projeto_nome` esquecida no SELECT → `sem_projeto` inflava de 3 pra 42. Também `pv_num_nfe`, `pv_etapa_texto`, `servicos_os_numero`. Fix em `web/lib/avulsos-report.ts`.
- **UX:** skeleton + timeout 55s + revalidação ao voltar pra aba + prévia Webex renderizada.

## Ver Também

- [[10-Avulsos]] — painel operacional que alimenta este report
- [[11-Aguardando-Liberacao]] — nova linha em VENDAS
- [[../Base-Supabase/Views-Canonicas]] — `v_pc_avulsos` (fonte do computeReportCounts)

## Tags
#painel-waterworks #relatorios #webex #daily
