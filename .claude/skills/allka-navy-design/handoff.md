# Handoff: Painel WaterWorks — redesign Navy (Avulsos · Pedido → Lote → Item)

Repo alvo: `benny459/omie-supabase-sync` · app `web/` (Next 16 + Tailwind + Supabase).

## Overview
Redesign visual do painel (painel.waterworks.com.br / orders.allka.ai) com paleta navy + ciano, modos escuro e claro, e uma nova forma de ler o pipeline dos Avulsos: **cada PV/OS expande em lotes (RC → PC) e cada lote expande em itens do PC**, na mesma sequência de etapas `PV/OS → RC → PC → Aprovação → Materiais → Serviços → Saída`. Quatro visões sobre os mesmos dados: **Lista, Linha do tempo, Tabela (árvore), Kanban (raias)**.

> **Regra nº 1 deste handoff: o redesign é de APRESENTAÇÃO. Nenhuma regra de negócio muda.** Os mockups usam dados fictícios e KPIs ilustrativos. Toda contagem, cor de etapa, alarme, filtro e permissão deve vir da lógica que já existe (listada abaixo). Se um número do mock não tem fonte na lógica atual, ele NÃO entra — ou entra só depois de ser definido aqui.

## About the Design Files
Os `.dc.html` deste pacote são **referências de design em HTML** (protótipos com o visual e o comportamento pretendidos), não código de produção. A tarefa é **recriá-los dentro do `web/`** usando os padrões do repo: componentes React/TSX, Tailwind com os tokens `ww-*`, `next/font`, Supabase. Abra os arquivos direto no navegador (precisam do `support.js` ao lado).

| Arquivo | O que é |
|---|---|
| `Painel Navy.dc.html` | **Referência principal** — modo escuro, 4 visões com expansão 3 níveis + KPIs |
| `Painel Navy Light.dc.html` | Mesmo layout no modo claro |
| `Etapas por Visao.dc.html` | Exploração: o que cada etapa mostra (dicionário de campos em 1e, trilho 2a, linha do tempo 2b) |
| `Painel Redesign.dc.html` | Rodada anterior (tema claro neutro) — usar só como referência da **faixa de alarmes clicável** e do **drawer** do PV/OS |
| `Painel Allka SF.dc.html` / `… SF Light.dc.html` | **VERSÃO FINAL** — todas as telas, menu horizontal, cores Allka (logo/landing), fonte SF Pro |
| `Painel Allka Pipeline.dc.html` / `… Pipeline Light.dc.html` | Vendas avulsas (Pipeline) com cores Allka |
| `Painel Navy Telas Topo.dc.html` / `… Topo Light.dc.html` | Versão Navy anterior (só referência) |
| `Painel Navy Telas.dc.html` / `… Light.dc.html` | Mesmas telas com menu lateral (alternativa descartada, só referência) |
| `design_system/` | Design system **Allka Navy**: `styles.css` + `tokens/*.css` (escuro/claro), componentes React (`components/core`, `data`, `navigation`) com `.d.ts` e `.prompt.md`, `readme.md` com fundamentos, `SKILL.md` para usar no Claude Code |

## Menu — **horizontal** (escolhido)
Referência: `Painel Navy Telas Topo.dc.html` / `… Topo Light.dc.html` · componente `design_system/components/navigation/TopNav.jsx`.
- Linha 1 (card sticky): marca · **áreas em pills** · busca ⌘K ("Ir para tela, PV, PC…" — reaproveitar `GlobalSearch.tsx`) · configurações · avatar (email/versão/senha/sair do rodapé atual do AppSidebar vão para um menu no avatar).
- Linha 2: **abas dos módulos** da área ativa (ativa = sublinhado 2px `--ww-accent`). Pipeline mostra a dica "visão integrada".
- Substitui o `AppSidebar.tsx` (hover-expand). Manter `router.prefetch` das rotas e o estado `pendingHref` (spinner na aba clicada).
- Áreas/abas filtradas por `canViewArea` exatamente como hoje; área sem item visível não aparece.

### Grupos
| Grupo | Itens | Area (`canViewArea`) |
|---|---|---|
| **Pipeline** · visão integrada | Vendas avulsas, Projetos (Lista · Linha do tempo · Tabela · Kanban) | operacao |
| **Faturamento** | Faturamento dia a dia, Daily avulsos, Faturamento analítico, Margem por venda | vendas |
| **Compras** | Aprovação de PCs (ex-PCs Standalone), Pedidos PC/RC, Atribuir PC → Cliente, Compras × Cliente, Cadeia de compras | compras |
| **Estoque** | Estoque | erp |
| **Financeiro** | Visão financeira, Títulos a pagar/receber, Fluxo de caixa, Conciliação, Custo por cliente, Simples Nacional | financeiro (títulos: erp) |
| **BI** | Visão geral, Margem por projeto, Contratos CT | bi |
| **Sistema** | Configurações | — |
Rotas não mudam — só a navegação e os rótulos.

## Demais telas (mesma estrutura: header · filtros · KPIs · gráfico + painel lateral · árvore expansível)
| Tela | Árvore | KPIs / gráfico | Fonte real (não inventar) |
|---|---|---|---|
| **Projetos** | Projeto (PJ) → PV/OS → lote | Budget, Comprometido, Faturado, Etapas atrasadas · budget × comprometido por projeto · próximas etapas | `approval.v_pc_projetos`, `finance.projeto_etapas` (stage Cronograma), `finance.projeto_budget`, `finance.fluxo_financeiro` |
| **PCs Standalone** | PC → itens | Aguardando aprovação, teto por PC, teto semanal, atrasados · aprovado por semana · painel "Sua alçada" · toolbar de aprovação em lote | `approval.v_pc_pcs`, `orders.pedidos_compra`, `user_module_roles.approval_ceiling_brl/weekly_budget_brl`, `/api/approvals/set-status` (valida no servidor) |
| **Faturamento** | Dia → NF → PV/OS de origem | 6 KPIs por categoria · barras empilhadas por dia | `approval.v_faturamento_diario`, `public.cat_venda()` (Contratuais, Projetos, Revenda, Avulsos, BOT/SW, Outras) |
| **Daily avulsos** | Seção → AlarmKind → PV/OS | PVs abertos + 4 seções com Δ vs snapshot · linha 14d · prévia Webex | `computeReportCounts()` (mesma `computeBucketAlarms`), `platform.avulsos_daily_snapshots`, APIs `/api/relatorios/avulsos-daily*` |
| **Títulos a Pagar** | Vencimento (vencidos/hoje/amanhã/semana/30d) → fornecedor → título | Total aberto, vence hoje, semana, pontualidade · próximos 30 dias · comprado × emitido × pago | `finance.pesquisa_titulos` (natureza P, sem cancelados) — cards 41/56/104/141/161/163/177 do Metabase |
| **Fluxo de Caixa** | Semana → a receber/a pagar → título | Saldo hoje, entradas/saídas 30d, menor saldo · linha saldo × entradas × saídas | `finance.v_extratos_consolidado`, `pesquisa_titulos`, `fluxo_financeiro` (previstos de projeto) |
| **Margem por Projeto** | Projeto → origem (NFs, PCs, títulos) | Margem total, receita, custos, com prejuízo · margem % por projeto | `sales.faturamento_unificado`, `orders.pedidos_compra`, `finance.pesquisa_titulos`, `projeto_budget` (Dash 7) |
| **Estoque** | Família → produto → local | SKUs, valor, abaixo do mínimo, reservado p/ PVs | tabelas de `import_estoque.py` (`sql/14_schema_estoque.sql`) |
| **Configurações** | Usuário → módulo | usuários, aprovadores, último sync, workflows | `platform.user_profiles`, `user_module_roles`, `user_area_access`, `sales.sync_state`, `/api/admin/*` |
Telas ainda não desenhadas (Atribuir PC → Cliente, Compras × Cliente, ERP Vendas/Compras, Títulos a Receber, Financeiro, Conciliação, BI Visão Geral) seguem o mesmo esqueleto: KPIs do dashboard Metabase equivalente + árvore com a hierarquia natural dos dados.

**Áreas restritas** (`financeiro`, `erp`, `bi`): as telas continuam atrás de `canViewArea` — o menu só mostra o que o usuário pode ver.

## Fidelity
**Alta fidelidade** para cores, tipografia, raios, sombras, hierarquia e interações de expandir. **Conteúdo/números são placeholders** — ver "Mapeamento de lógica".

---

## Mapeamento de lógica (NÃO perder)

### Fonte dos dados
- **Pedido (nível 1)** = bucket por `pv_os_label` das rows de `approval.v_pc_avulsos` (o mesmo agrupamento do `BoldAvulsosView`). Campos de PV vêm repetidos em todas as rows (window functions) — use `rows[0]`.
- **Lote (nível 2)** = cada row do bucket (1 row = 1 RC/PC). Chave: `ncod_ped` (ou `pc_numero_manual` / RC manual).
- **Item (nível 3)** = **`orders.pedidos_compra`** (1 row por item, PK `empresa, ncod_ped, ncod_item`). Join por `empresa + ncod_ped`. Campos: `cproduto`, `cdescricao`, `cunidade`, `nqtde`, `nval_unit`, `nval_tot`, **`nqtde_rec`** (recebimento parcial por item — já existe!), `ddt_previsao`, `ddata_recebimento`, `cnumero_nf`.
  - Carregar **sob demanda** ao expandir o lote (1 query por `ncod_ped`, cache por sessão). Não pesa o load inicial.
  - Lote sem PC (RC-only) não tem itens Omie → mostrar a linha do RC (`rc_descricao`, `rc_qtd`, `rc_custo`).

### Estado das etapas (cores dos segmentos / bolinhas)
Reusar **exatamente** as regras do `Pipeline` atual (docs `md-obsidian/Painel/10-Avulsos.md`) — green/yellow/red/off → no novo tema: ciano / âmbar / coral / slate.
- Etapas de lote (RC, PC, Aprovação, Materiais) são calculadas **por row** e agregadas no pedido com a mesma regra do dot atual (ex.: Aprovação GREEN só se todos os PCs aprovados; `isApproved()` de `lib/columns.ts`).
- PV/OS, Serviços e Saída são **do pedido** → aparecem só no nível 1 (no nível 2/3 ficam neutras/cinzas).
- `tipo_omie === "Serviços"` → sem etapas de compra (mesma guarda de `computeBucketAlarms`).
- Cadeado 🔒 "Aguardando Liberação" continua sobreposto no segmento PV/OS (`LiberacaoToggle`, `platform.pv_liberacao_status`).

### Alarmes → chips do pedido
Os chips à direita de cada pedido (ex.: "2/3 aprovados", "entrega atrasada", "limite vencido") devem ser **derivados de `computeBucketAlarms()` em `web/lib/alarmes.ts`** — a fonte única. Mapeamento sugerido:
| AlarmKind | Chip | Tom |
|---|---|---|
| `venda` | Venda em atraso | coral |
| `pvos_incompl`, `sem_projeto` | PV incompleto / Sem projeto | coral |
| `aguarda_liberacao` / `retido_cliente` | Aguard. liberação / Retido no cliente | âmbar |
| `sem_rc`, `sem_pc` | Sem RC / Sem PC | coral |
| `compra` | Compra em atraso | âmbar |
| `defas_omie` | Defasado Omie | âmbar |
| `aprov_bloq` / `aprov_pend` | Aprov. bloqueada / pendente | coral / âmbar |
| `sem_vinculo`, `agend_vazio`, `agend_venc` | Serviços | âmbar |
| `pode_faturar` | Pode faturar | ciano |
Chips de **progresso** ("2/3 PCs", "1/3 recebidos") são contagens sobre as rows do bucket — informativos, não alarmes.
**Regra global mantida:** PV encerrada (`pv_dt_fat` ∨ `pv_num_nfe` ∨ etapa Faturado/Cancelado) → nenhum alarme.

### Filtros (faltam no mock Navy — obrigatórios)
Manter **100% das facetas do `FiltersBar`** atual, reestilizadas:
Status PV · Aprovação PC · Tipo Omie · Status Serviços (`ww_os_status`) · Etapa Venda (`pv_etapa_texto`) · Entrega (`nova_prev_materiais` + `mt_status_fornecimento`) · **Alarmes Ativos** (multi) · texto livre · projeto/fornecedor/categoria/vendedor.
Além disso, adicionar acima das visões a **faixa de grupos de alarme clicável** (Vendas / Compras / Aprovações / Serviços / Faturamento com contagem) — ver `Painel Redesign.dc.html`. Clicar = aplicar o filtro "Alarmes Ativos" do grupo. As contagens devem bater com o Daily Webex (`computeReportCounts`), pois usam a mesma função.

### KPIs do topo (o mock é ilustrativo — usar estas definições)
| Card no mock | Definição real | Fonte |
|---|---|---|
| Carteira em aberto | Σ `pv_valor_total` dos buckets **não encerrados** (respeitando filtros ativos) · subtítulo: nº pedidos · nº lotes | v_pc_avulsos |
| Aprovação de PCs (donut) | rows com PC agrupadas por `status`: aprovados (`isApproved`) · pendentes (`PENDENTE`,`PRE_SELECAO`) · bloqueados (`NAO_APROVADO`,`REJEITADO_VALIDADE`) · sem PC (bucket com `sem_pc`) | v_pc_avulsos + `STATUS_META` |
| Recebimento semanal | Σ valor dos PCs com `mt_data_recebimento_nf` na semana (últimas 6 semanas) | v_pc_avulsos (ou `orders.recebimento_nfe.dt_rec`) |
| Itens por status | Itens de `orders.pedidos_compra` dos PCs visíveis: Recebido (`nqtde_rec ≥ nqtde`) · Parcial (`0 < nqtde_rec < nqtde`) · A receber (PC aprovado, `nqtde_rec = 0`) · Aguarda aprovação · Sem PC | pedidos_compra |
Se algum KPI não for desejado, remover — não inventar métrica nova sem fonte.

### Permissões (manter)
- `canViewValues(user, modulo)` = false → todo R$ vira `R$ •••••` (usar `formatCell` de `lib/columns.ts`), inclusive KPIs de valor.
- `canViewMargin` = false → esconder M.B.
- Ações inline (aprovar, editar nova previsão, liberar PV) continuam atrás de `canApprove`/`canApproveValue` (teto + semanal no server), `canEdit(…, "log")`, `canReleasePv`.
- Áreas restritas (`financeiro`, `erp`, `bi`) seguem só com concessão explícita.

### Edição inline
As colunas `editable` de `lib/columns.ts` (ex.: `*Nova Prev. Materiais` com `trackHistory`, `*RC.*`, `PC #`, Status de aprovação, Justificativa) continuam editáveis **no nível do lote** (Tabela e drawer). Usar `EditableCell`/`EditableStatusCell` existentes, só reestilizados.

---

## Screens / Views

### Layout geral (1 página — `/avulsos`, e o mesmo motor em `/projetos` e `/pcs`)
- Página: padding 22px 28px 48px; fundo escuro `radial-gradient(1200px 600px at 20% -10%, #123262, transparent 60%), linear-gradient(180deg, #0a1a36, #071226)`.
- **Header** (card 18px radius): logo 32px (gradiente `#2ad4e6→#1e7fd6`), pills de módulo (ativa: borda `#2ad4e6`, texto `#6fe7f3`, glow `0 0 12px rgba(42,212,230,.25)`), seletor de mês à direita. Na implementação: manter o `AppSidebar` existente OU migrar os módulos para essas pills — decidir com o time; áreas/permissões iguais.
- **KPIs**: grid `repeat(auto-fit,minmax(260px,1fr))`, gap 16. Card "Carteira" é o hero (gradiente `160deg #1a3a72→#10264c`), demais cards padrão.
- **Faixa de alarmes + FiltersBar** (adicionar — ver acima).
- **Container das visões** (card 20px radius): cabeçalho com título, dica da visão, seletor segmentado (Lista · Linha do tempo · Tabela · Kanban), botões Expandir tudo / Recolher.

### Lista
Cartão por pedido: `grid 22px 104px 1.3fr 240px 1.7fr 120px`, gap 16, padding 14/18.
Colunas: chevron · id + tipo/nº lotes · cliente + previsão limite · **trilho de 7 segmentos** (altura 7, radius 4, gap 4; verde com glow `0 0 8px rgba(42,212,230,.55)`) · chips · valor.
Expandido: mini-tabela de lotes `86px 1.3fr 1.1fr 1fr 1.3fr 110px` (Lote · RC · PC/fornecedor · Aprovação · Materiais com barra · Valor PC). Lote expandido: itens `1.6fr 150px 1.4fr 90px` (descrição+código · qtd×unit · barra de recebimento + status · rec/qtd un).

### Linha do tempo
Coluna fixa 320px + trilha. Eixo: semanas, **hoje** destacado em ciano, **previsão limite do PV** como linha coral.
- Pedido: faixa emissão→limite (fundo), preenchimento até hoje (ciano; coral se limite vencido), losango do serviço (`nova_prev_servicos`).
- Lote: marcos RC criada (círculo vazado) · PC emitido `dt_inclusao` (quadrado azul) · Aprovado `aprovado_em` (quadrado ciano) · previsão original `dt_previsao` (círculo vazado) · nova previsão `nova_prev_materiais` (círculo âmbar) · recebido `mt_data_recebimento_nf` (círculo ciano cheio). Segmentos tracejados = aguardando.
- Item: `ddata_recebimento` e o restante previsto (`nqtde - nqtde_rec` un até `ddt_previsao`/nova previsão).
- Histórico de nova previsão: `custom_fields.s4b87bk9_hist` pode virar marcos extras.

### Tabela (árvore)
Grid `minmax(280px,1.6fr) 110px minmax(150px,1.1fr) 110px 150px 130px minmax(160px,1.2fr) 90px`. Cabeçalho duplo: grupos coloridos RC · PC (2) · Aprovação · Materiais (3). Linhas: pedido (bg `#132a52`, totais agregados), lote (indent 42px, `#10254a`), item (indent 70px, `#0e2143`). Totais do pedido = soma dos lotes. Os demais grupos de `lib/columns.ts` (PV/OS, Serviços, Saída, Fórmulas) ficam acessíveis como grupos recolhíveis (ver `Etapas por Visao` 1c) — preferência salva em `ui-prefs.ts → columnGroups`.

### Kanban (raias)
Grid `270px repeat(4,1fr)`. Colunas por **estado do lote**: Compra (sem PC) · Aprovação (PC não aprovado) · Materiais (aprovado, não recebido) · Recebido. Uma raia por pedido; recolhida mostra contagem + valor por coluna; aberta mostra cartões de lote (clicáveis → itens). Kanban é **leitura** (sem drag) — o estado do lote é derivado dos dados, não movido à mão.

## Interactions & Behavior
- Expandir/recolher: chevron SVG 12px rotaciona 0°→90° (`transition: transform .15s`). Clique na linha inteira. Estado por visão (`a:`/`b:`/`c:`/`d:` + `pv_os_label` [+ índice do lote]).
- Expandir tudo / Recolher: afeta todas as visões.
- Itens carregam ao expandir o lote (skeleton de 2–3 linhas enquanto busca).
- Hover de linha: `rgba(255,255,255,.025)` (escuro) / `rgba(40,70,130,.035)` (claro).
- Clique no id do pedido abre o **drawer** existente (`DetailDrawer`) com o trilho 2c.
- Sync / comentários / cadeado / excluir: mesmas ações de hoje no cabeçalho do pedido.
- Visão escolhida + grupos abertos persistem em `ui-prefs` (estender `UiPrefs` com `avulsosView`).

## State Management
- `view: 'lista'|'tempo'|'tabela'|'kanban'`
- `expanded: Record<string, boolean>`
- `itemsByPc: Record<ncod_ped, Item[]>` (cache, fetch on expand)
- Filtros: estado atual do `FiltersBar` (sem mudança)
- Tema: classe `.dark` no `<html>` (já suportada por `globals.css`)

## Design Tokens
> **Valores finais:** use `design_system/tokens/*.css` (cores Allka: tinta `#0B1220`, acento `#2F6BFF`/`#5C8BFF`, segmentos do logo `#4C67C9 → #5C8BFF → #6CCBFF`, tracinho `#3F4655`, laranja `#FF6B4A`; fonte SF Pro). As tabelas abaixo são da rodada Navy e ficam só como histórico.

Implementar trocando os valores de `--color-ww-*` em `web/app/globals.css` (`:root` claro, `.dark` escuro) e adicionando tokens de estado ao `tailwind.config.ts`.

**Escuro**
| token | valor |
|---|---|
| bg | `#071226` (+ gradientes acima) |
| panel (card) | `linear-gradient(180deg,#152d55,#10244a)` |
| panel-2 (linha/lote) | `#10254a` · sub `#0c1f40` · item `#0e2143` |
| border | `rgba(120,170,255,.14)` · sutil `.08` |
| text | `#eaf2ff` · muted `#8ea3c9` · faint `#6f86ad` · secondary `#b9c8e6` |
| ok / ciano | `#2ad4e6` · texto `#6fe7f3` · bg `rgba(42,212,230,.14)` · glow `0 0 8px rgba(42,212,230,.55)` |
| atenção / âmbar | `#f3b64e` · texto `#f7c978` · bg `rgba(243,182,78,.15)` |
| crítico / coral | `#ff7b8b` · texto `#ffa0ab` · bg `rgba(255,123,139,.15)` |
| info / azul | `#5b8def` · texto `#9db8f7` |
| off | `#2a3f66` |
| sombra card | `0 12px 32px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06)` |

**Claro**
| token | valor |
|---|---|
| bg | `linear-gradient(180deg,#e3e9f3,#d3dcea)` |
| panel | `linear-gradient(180deg,#ffffff,#f5f8fc)` · linha `#ffffff` · sub `#f3f6fb` · item `#f8fafd` |
| border | `rgba(40,70,130,.14)` |
| text | `#15213b` · muted `#5a6b8c` · faint `#7384a3` · secondary `#3d4d6b` |
| ciano texto | `#0b8ea0` (chevron/hoje `#0b97ab`) · âmbar texto `#a86a0c` · coral texto `#c43a4d` · azul texto `#2f5fcf` |
| hero card | mantém navy `#1a3a72→#10264c` com texto `#eaf2ff` |
| sombra card | `0 12px 32px rgba(30,50,90,.10)` |

**Tipografia** — padrão definido (docs/design-bundle.md): SF Pro via system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif`; **`font-variant-numeric: tabular-nums`** em todo valor/coluna numérica; sem `font-mono` (exceto badges técnicos). Escala usada: 28 (KPI hero) · 17 (título seção) · 14 (cliente/valor) · 13–13.5 (corpo/ids) · 12–12.5 (secundário) · 11–11.5 (chips/labels) · 10–10.5 (eixo/legendas). Pesos 500/600/700 (hierarquia por peso+tamanho, não bold em tudo).

**Raios** — card 18–20 · linha/lote 11–14 · chip 999 · barra 3–4 · botão 9. **Espaçamento** — gaps 4/6/8/10/14/16/18.

## Assets
Nenhum asset novo. Logo: `web/public/logo-waterworks.svg` existente (o "W" em gradiente do mock é placeholder). Ícones do menu: os SVG de `AppSidebar.tsx`.

## Ordem sugerida de implementação
0. Copiar `design_system/SKILL.md` + `readme.md` para `.claude/skills/allka-navy-design/` no repo, para o Claude Code seguir o sistema.
1. Tokens: portar `design_system/tokens/colors.css` + `effects.css` para `web/app/globals.css` (`:root` claro, `.dark` escuro) e expor no `tailwind.config.ts` — as telas atuais já mudam de cara sem tocar lógica.
2. Faixa de alarmes + FiltersBar reestilizados (contagens via `computeBucketAlarms`).
3. Componente `PedidoTree` (Lista) com expansão lote → itens (`orders.pedidos_compra` on demand).
4. Tabela árvore reusando `EditableCell`.
5. Linha do tempo e Kanban (somente leitura).
6. KPIs conforme definições acima.
7. Validar: contagens de alarme idênticas ao Daily Webex; `canViewValues=false` mascara tudo; PV encerrada sem chips.
