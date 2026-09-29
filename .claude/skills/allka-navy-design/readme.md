# Allka Navy — Design System

Design system do **Painel WaterWorks** (painel.waterworks.com.br · alias orders.allka.ai), parte da plataforma **ALLKA** (CRM, Field Service, Compras, Finance, RH, BI).

**Fontes:** repo GitHub `benny459/omie-supabase-sync` (pasta `web/`: `app/globals.css`, `tailwind.config.ts`, `components/AppSidebar.tsx`, `BoldAvulsosView.tsx`, `lib/columns.ts`, `lib/alarmes.ts`, `lib/permissions.ts`; docs `docs/design-bundle.md`, `md-obsidian/Painel/*`) + referência visual navy/ciano enviada pelo usuário (dashboard "Personal Finance", só inspiração de cor e cards).

## Contexto do produto
Painel operacional diário: Vendas avulsas (PV/OS), Projetos (PJ), PCs standalone, relatórios (Faturamento, Daily Webex), ERP (títulos, estoque), Financeiro e BI. Dados vêm do Omie sincronizado no Supabase. Usuários: admin, aprovador, comprador, viewer — permissões por módulo e área.

## CONTENT FUNDAMENTALS
- **Português do Brasil**, operacional e curto. Sentence case em títulos ("Vendas avulsas", "Pedidos · lotes · itens").
- Separador **·** para metadados: "Mix · 3 lotes · limite 10/10".
- Códigos do Omie sempre visíveis e literais: `PV1820`, `OS4587`, `PC 12080`, `RC4119`, `PJ041`, `43_ESTOQUE`.
- Estados como rótulos de ação/fato: "Aprovado", "Pendente", "Parcial", "Aguarda aprov.", "Sem PC", "Pode faturar". Deltas: "−4d", "+2 vs ontem", "6/12 un".
- Dinheiro: `R$ 92.300` na linha; `R$ 61,4k` / `R$ 1,84 mi` em KPIs. Datas `dd/mm`.
- Segunda pessoa implícita e neutra ("Seu teto por PC"). Sem exclamações.
- **Emoji:** só onde o produto já usa — 🔒 (Aguardando Liberação) e os ícones de seção do Daily Webex (🛍️ 📦 🛠️ 💵). Nunca decorativo.

## VISUAL FOUNDATIONS
- **Modos:** escuro (padrão, navy `#071226`) e claro (`#d8e0ec`), trocados pela classe `.dark` — mesma convenção do `globals.css` atual.
- **Cor (oficial Allka, da landing allka.ai):** tinta `#0B1220`, acento azul `#2F6BFF` (escuro `#5C8BFF`), gradiente de marca `#1B2F7A → #2F6BFF → #3BB8FF`, navy `#12275F`, laranja `#FF6B4A`. Estados: ok=céu `#3BB8FF`, warn=`#F5C542`, crit=`#FF6B4A`, info=`#5C8BFF`, violet=`#9A82FF`. Cores por área: fin `#3BB8FF`, ops `#19C6A6`, crm `#9A82FF`, cadastros `#FF8F73`, RH `#F5C542`, IA `#6CCBFF`.
- **Fundo:** gradiente radial suave no topo-esquerda + linear vertical. Sem imagens, texturas ou ilustrações.
- **Cards:** raio 16–20, borda 1px azul translúcida, sombra longa e difusa + fio de luz `inset 0 1px 0 rgba(255,255,255,.06)`. Painéis com gradiente vertical sutil. Um card **hero** navy por tela (mantém navy no modo claro).
- **Glow:** só no ciano (barras/segmentos OK, botão primário, chip ativo) — `0 0 8px rgba(42,212,230,.55)`.
- **Tipografia:** Apple **San Francisco (SF Pro)** via system stack — escolhido pelo usuário; títulos/KPIs 700, corpo 500/600, `tabular-nums` em valores. Sem webfont (fallback Segoe UI/Roboto fora da Apple).
- **Árvore 3 níveis:** Pedido → Lote → Item com fundos `row-l0/l1/l2`, indent 26px, bordas sólida (nível 0) e tracejada (1–2). Chevron SVG gira 90°.
- **Pipeline:** trilho de 7 segmentos (7px, raio 4, gap 4).
- **Pills:** raio 999, fundo soft (14–16% alpha) + texto do tom.
- **Hover:** fundo `--ww-row-hover`; sem translação. **Press:** nenhum efeito extra. **Transições:** 150ms, só transform/box-shadow.
- **Transparência/blur:** sem blur; transparência só em bordas e fundos soft.
- **Layout:** navegação **horizontal** (TopNav sticky: áreas em pills + abas de módulos); SidebarNav 244px como alternativa; página padding 22/28; grids `auto-fit minmax()`; tabelas largas rolam dentro do próprio card.

## ICONOGRAPHY
Ícones de linha 24×24, `stroke-width 1.8`, round caps/joins, `currentColor` — os mesmos paths definidos inline em `web/components/AppSidebar.tsx` (não há icon font nem sprite no repo). Reusar esses paths; para ícones novos, Lucide tem o mesmo traço (substituição a confirmar). Unicode só para ↗ (link externo) e ☀/☾ (tema). Logo Allka (vertical com slogan "All knowledge ahead") em `assets/allka-logo-vertical-slogan.png`. O motivo do logo — **segmentos de progresso `#4C67C9 → #5C8BFF → #6CCBFF` + tracinhos cinza `#3F4655` para o que falta** — é o mesmo do PipelineRail: etapas feitas em azul/céu, pendentes em cinza. O logo WaterWorks (`web/public/logo-waterworks.svg`) não foi copiado; no painel do tenant a marca aparece em texto.

## Index
- `styles.css` → `tokens/colors.css`, `typography.css`, `spacing.css`, `effects.css`, `base.css`
- `components/core/` — Button, Chevron, StatusPill, FilterChip, SegmentedControl, ProgressBar (+ `tones.js`)
- `components/data/` — Panel, KpiCard, PipelineRail, TreeTable
- `components/navigation/` — **TopNav (padrão)**, SidebarNav (alternativa)
- `guidelines/` — cards de fundação (cores, tipo, espaço, raios, elevação, pipeline, árvore)
- `ui_kits/painel/` — Vendas avulsas clicável
- Protótipos completos: `Painel Navy*.dc.html`, `Painel Navy Telas*.dc.html`, `Etapas por Visão.dc.html`
- Handoff: `design_handoff_painel_navy/`
- `SKILL.md`

### Intentional additions
Os componentes foram extraídos dos protótipos deste projeto (o repo usa Tailwind inline, sem biblioteca de componentes própria): cada um corresponde a um padrão recorrente do BoldAvulsosView/FiltersBar/AppSidebar redesenhado.

### Mapeamento para o código
Tokens `--ww-*` substituem/estendem `--color-ww-*` de `web/app/globals.css` (`:root` claro, `.dark` escuro). Regras de negócio **não mudam** — ver handoff.
