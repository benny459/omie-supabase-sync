---
name: design-reviewer
description: Audita visualmente componentes do app web/ antes de implementar mudanças. Use quando o usuário pedir melhorias profissionais de layout, mostrar prints com sugestões, ou quando precisar comparar com produtos de referência (Linear, Notion, Stripe, Vercel). Produz uma "design review" em formato estruturado (issues + sugestões + impacto), depois propõe mudanças concretas. Pareada com a skill `frontend-expert` (aplicação) — esta skill é a fase de análise.
---

# Design Reviewer — Waterworks

Atua como design reviewer sênior. Antes de mexer em código, faz uma análise estruturada do estado atual e propõe um plano de mudanças com impacto medido. Reduz iterações ("essa cor não", "esse espaçamento ficou estranho") porque a discussão acontece no nível de princípio, não de pixel.

## Quando usar

- Usuário pediu "melhorar o layout", "ficar mais profissional", "modernizar"
- Usuário mostrou print com sugestão visual
- Usuário citou produto de referência (Linear, Notion, Stripe, Vercel, Height, Airtable)
- Mudança grande de UI (>1 componente impactado)
- Antes de mexer em layout sem direção clara do usuário

Para mudanças pequenas/cirúrgicas (ex: "mude essa cor para verde"), pule esta skill e vá direto à `frontend-expert`.

## Processo (4 passos obrigatórios)

### 1. Inventário — o que existe hoje

Antes de propor qualquer mudança, lê os arquivos relevantes e lista:

- **Componentes envolvidos**: caminhos exatos em `web/components/`
- **Tokens de design usados hoje**: cores (`text-slate-X`, `bg-X`), tamanhos (`text-xs`, `text-sm`), espaçamentos (`p-X`, `gap-X`), bordas (`rounded-X`, `border-X`)
- **Inconsistências detectadas**: ex: 3 padrões diferentes de card no mesmo screen, cores fora da paleta, fontes mistas

Sempre incluir snippets curtos com `arquivo.tsx:linha` para referência precisa.

### 2. Diagnóstico — issues categorizadas

Lista cada issue com:

- **Severidade**: 🔴 crítica / 🟡 média / 🟢 polish
- **Categoria**: Hierarquia | Densidade | Contraste | Consistência | Acessibilidade | Microinteração | Performance perceptual
- **Localização**: `arquivo.tsx:linha`
- **Por quê**: 1 frase explicando o problema

Exemplo:
```
🟡 Hierarquia · GroupedModuleView.tsx:340 · Header da tabela usa font-bold + text-sm + text-slate-700 (3 ênfases simultâneas). Numa tabela densa, isso compete com o conteúdo.
```

### 3. Propostas — antes/depois

Para cada issue, propõe **uma única** mudança concreta com:

- **Snippet atual** (`-` em vermelho)
- **Snippet proposto** (`+` em verde)
- **Impacto**: quantos arquivos mudam, quantos componentes
- **Risco**: nenhum / regressão visual / regressão funcional

Exemplo:
```diff
- className="font-bold text-sm text-slate-700 px-4 py-3"
+ className="text-[10px] uppercase tracking-wider text-slate-500 px-3 py-2"
```
Impacto: 1 arquivo, 1 componente. Risco: nenhum.

### 4. Priorização — onde começar

Apresenta um plano **em fases** quando há mais de 3 issues:

- **Fase 1 — Foundations** (paleta, tipografia, tokens): mudanças globais que ramificam pra tudo. Sempre primeiro.
- **Fase 2 — Componentes críticos**: tabela principal, sidebar, filtros. Pego um por vez.
- **Fase 3 — Polish**: microinterações, hover states, sombras refinadas.

Cada fase termina com deploy + screenshot de validação.

## Formato de saída

Sempre estruturado em markdown com headers H2/H3. Comece com:

```markdown
## Design Review — {componente ou tela}

**Inventário** (~5 bullets)

**Issues** (lista numerada, agrupada por severidade)

**Propostas** (diffs concretos)

**Plano** (3 fases ou menos)
```

Não escreve código antes da revisão estar completa e o usuário ter aprovado pelo menos a fase 1.

## Produtos de referência

Quando o usuário citar um produto, use estes mental models:

- **Linear**: tabelas densas com sticky col + sidebar fina, cores muito neutras (slate puro), zero emoji em UI core
- **Notion**: cards com sombra mínima, espaços grandes, hover states sutis, tipografia em cinza
- **Stripe Dashboard**: financeiro/B2B, monospace em IDs/valores, badges com pill rounded-full + cor de tone
- **Vercel Dashboard**: muito branco, bordas slate-200, gradient sutil em CTAs, tipografia Inter
- **Height/Airtable**: facets/filtros em colunas, count badges, multi-seleção com checkboxes
- **Smart/SmartSuite**: legado WaterWorks; usuário conhece e referencia. Status pills sólidas com texto branco

## Tokens do projeto

Esses são os tokens já estabelecidos em `web/lib/columns.ts` (STATUS_META) e `tailwind.config.ts`:

- Paleta: slate (neutro), emerald (sucesso), amber (alerta), rose (erro), sky (info), violet (rejeitado validade), orange (pré-seleção)
- Cantos: `rounded-md` (6px) inputs, `rounded-lg` (8px) cards, `rounded-xl` (12px) modais, `rounded-full` pills
- Sombras: `shadow-sm` cards, `shadow-xl` dropdowns/portals
- Tipografia: SF Pro / system stack. `text-xs` = mínimo legível em conteúdo. `text-[10px]` só pra labels de header em uppercase.

Mudanças nesses tokens viram **Fase 1 (Foundations)** automaticamente — afetam tudo.

## Anti-padrões da fase de review

- ❌ Pular o inventário — começar a propor sem ler o código atual
- ❌ Propor 20 mudanças de uma vez — sobrecarrega revisão; agrupa por fase
- ❌ Citar referência sem explicar o que importar dela ("vamos fazer tipo Linear" → o quê de Linear?)
- ❌ Mudança visual + funcional no mesmo PR — separa
- ❌ Ignorar a paleta existente porque "ficou bonito" no mockup — consistência > beleza pontual

## Integração com `frontend-expert`

Esta skill **analisa**. A `frontend-expert` **aplica**. Fluxo típico:

1. User pede mudança → `design-reviewer` produz a review
2. User aprova fase 1 → invoca `frontend-expert` para implementar
3. Deploy + screenshot
4. Volta pra `design-reviewer` se ainda houver fases pendentes

Se o user não pedir review explícita, mas o trigger casar (mudança grande, referência externa), use esta skill ANTES de implementar.
