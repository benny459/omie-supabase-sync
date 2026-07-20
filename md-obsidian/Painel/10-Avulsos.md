# /avulsos — Vendas Avulsas

> Pipeline completo dos PV/OS avulsos (sem projeto formal PJxxx). Onde vive a maior densidade de operação diária. Fonte: [[../Base-Supabase/Views-Canonicas|approval.v_pc_avulsos]].

## O que é

Vendas avulsas = PV/OS **sem** projeto `PJxxx` (Projetos). Cobrem:
- `40_VS` — Venda de Serviços (OS avulsa)
- `41_VP` — Venda de Produtos (PV avulso — revenda de mercadoria)
- Cliente pediu, precisa faturar, ciclo curto

Cada PV/OS agrupa 1+ rows na view (uma por RC/PC). O painel agrega isso em **buckets** por `pv_os_label` e mostra pipeline horizontal com dots de estado.

## Componente principal

`BoldAvulsosView.tsx` (~5000 linhas, modo `modulo="avulsos"`). Também roda em `/projetos` e `/pcs` — mesmo motor, comportamento condicional.

## Buckets + Pipeline

Cada bucket = um `pv_os_label` (`PV1789`, `OS4587`, ...). Renderiza:

- **Header:** número, tipo (Mercantil/Serviços/Mix), cliente, projeto, contador de items, botões de ação (sync, comentários, cadeado 🔓/🔒 quando aplicável)
- **Alarmes (tags):** minitags visuais mostrando alarmes ativos do bucket (rose, violeta, âmbar, cyan, emerald por grupo)
- **Pipeline (dots):** 6-7 estágios com estado green/yellow/red/off + badge de desvio (`-Nd`, `+N×`) acima
- **Totais (RC/PC/PV):** valores agregados + M.B.

### Stages do pipeline

Ordem (2026-07+):

`PV/OS → [Cronograma (só /projetos) →] RC → PC → Aprovação → Materiais → [Serviços (só avulsos) →] Saída`

Regras resumidas:
- **PV/OS:** RED sem cadastro (tipo/cliente/dt limite). YELLOW se dt limite passou. GREEN caso contrário.
- **RC:** GREEN se alguma row tem número + custo; YELLOW se incompleto; RED se nenhum RC.
- **PC:** GREEN se algum PC completo; YELLOW se incompleto; RED se nenhum.
- **Aprovação:** GREEN se todos PCs aprovados; YELLOW pendente; RED bloqueado.
- **Materiais (Logística):** GREEN todos recebidos; YELLOW parcial; RED nenhum. Badge `-Nd` no pior atraso.
- **Serviços (só Mix/Serviços):** GREEN concluído; YELLOW em execução; RED sem previsão.
- **Saída:** GREEN se `pv_dt_fat && pv_num_nfe`; RED caso contrário.

## Alarmes

`AlarmKind` (13 hoje). Cada alarme mora num grupo:

| Grupo | Cor | Alarmes |
|---|---|---|
| Vendas | rose | `pvos_incompl`, `sem_projeto`, `aguarda_liberacao` 🔒 (âmbar), `venda` |
| Compras | violet | `compra`, `sem_rc`, `sem_pc`, `defas_omie` |
| Aprovações | amber | `aprov_bloq`, `aprov_pend` |
| Serviços | cyan | `sem_vinculo`, `agend_vazio`, `agend_venc` |
| Faturamento | emerald | `pode_faturar` |

Alarmes são **bucket-level** (`computeBucketAlarms(rows, todayMs, liberacaoSet?)`). Semântica: "Sem PC" só flaga se o PV inteiro não tem NENHUM PC (não flaga rows RC-only).

**Regra global:** PV encerrado (`dt_fat`, `num_nfe` ou etapa=Faturado/Cancelado) → NENHUM alarme dispara. Zero histórico. Essa regra também é o que faz o [[11-Aguardando-Liberacao]] sumir automaticamente ao faturar.

## Filtros / Facetas

`FiltersBar` compartilhado. Facets:
- Por Status PV, Por Aprovação PC, Por Tipo Omie
- Por Status Serviços (`ww_os_status`)
- Por Etapa Venda (`pv_etapa_texto`)
- Por Entrega (`nova_prev_materiais` + `mt_status_fornecimento`)
- **Alarmes Ativos** (dropdown multi-select — união entre alarmes ativos)
- Texto livre + filtro por projeto/fornecedor/categoria/vendedor

## Coluna "Etapa Venda" (`pv_etapa_texto`)

Vem do Omie. Valores comuns: `Aberto`, `Faturar`, `Faturado`, `Cancelado`, `Aguardando fornecedor`.

## Ações rápidas no bucket

- **Sync agora** (ícone 🔄) — sincroniza PV/OS + PCs do Omie sob demanda
- **Comentários** (obs) — abre popover de comentários (`platform.pv_os_comentarios` — tabela paralela)
- **Cadeado 🔓/🔒** — [[11-Aguardando-Liberacao]] toggle (só Fernanda + admin)
- **Excluir** (lixeira) — admin only, envia pra `platform.excluded_pv_os` (some do painel, mantém histórico)

## Ver Também

- [[11-Aguardando-Liberacao]] — overlay de bloqueio manual
- [[12-Faturamento]] — relatório dia-a-dia (consome a mesma base)
- [[13-Daily-Avulsos]] — envio automático Webex
- [[../Base-Supabase/Views-Canonicas]] — v_pc_avulsos structure

## Tags
#painel-waterworks #avulsos #modulo
