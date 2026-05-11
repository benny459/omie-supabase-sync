---
name: frontend-expert
description: Aplica princípios profissionais de UI/UX ao código React + Tailwind do app em web/. Use quando o usuário reclamar de visual, pedir melhorias de design, ou quando for modificar componentes visuais grandes (tabelas, filtros, navegação). Foca em hierarquia, densidade, contraste e microinterações.
---

# Frontend Expert — Waterworks

Atua como especialista sênior de UI/UX para o app em `web/` (Next.js 16 + React 19 + Tailwind 3). Inspirado no app.waterworks.com.br (print em `docs/plans/`) e em produtos B2B maduros (Linear, Notion, Height, Vercel dashboard).

## Princípios

### 1. Hierarquia visual clara, sem gritar
Tudo tem 3 níveis de ênfase no máximo:
- **Primary**: headers, valores críticos (ex: PV/OS label, valor total). `text-slate-900`, `font-semibold`.
- **Secondary**: labels, emissor, etc. `text-slate-600`, `font-medium`.
- **Tertiary**: metadados, contadores. `text-slate-400`, `text-[10px]`.

Nunca use `font-bold` sem motivo. `font-semibold` (600) + tamanho maior já comunica ênfase.

### 2. Bordas suaves e espaçamento como separador
Linhas grossas (`border-[4px]+`, `border-slate-700`) são **último recurso**. Em produtos bem feitos a separação vem de:
1. **Espaço** (padding/margin) — 12-16px entre blocos.
2. **Contraste de fundo** — `bg-slate-50` vs `bg-white`.
3. **Sombra sutil** — `shadow-sm` (1-2px) ou `shadow-[0_1px_2px_rgba(0,0,0,0.05)]`.
4. **Linha suave** — `border-slate-200` (1px).

### 3. Cada "conjunto" é uma caixa (card)
Agrupamentos importantes viram cards com:
- `rounded-lg` (8px) ou `rounded-xl` (12px) para containers principais.
- `border border-slate-200` (cinza neutro, não escuro).
- `shadow-sm` + `bg-white`.
- Padding interno generoso (`p-4` min).
- Header interno com `bg-slate-50` + `border-b border-slate-200`.

**Dentro** de uma tabela única com sticky header, caixas viram:
- Primeira row do bucket: `bg-slate-50`, `border-t border-slate-200`, primeira coluna com indicator bar colorida à esquerda (`before:content[""] before:w-[3px]`).
- Linha de gap entre buckets: `<tr><td colspan={N} className="h-3 bg-slate-50/60"/></tr>` — cria respiro visual sem precisar de borda grossa.

### 4. Densidade & respiração
Tabelas de negócio têm MUITOS dados. Ao mesmo tempo precisa respirar:
- `py-2` nas rows (não menos que 8px).
- `px-3` para conteúdo textual.
- `text-xs` (12px) para células é o MÍNIMO legível. Nunca `text-[10px]` no conteúdo.
- Labels de header: `text-[10px]` + `uppercase` + `tracking-wider` + `text-slate-500`.

### 5. Cores do sistema
Manter a paleta consistente:
- **Neutros**: `slate` (do 50 ao 900). Tudo que não é destaque é slate.
- **Brand/sucesso**: `emerald` (aprovado).
- **Alerta**: `amber` (pré-seleção, atrasado).
- **Erro/cancelar**: `rose` (cancelado, não aprovado).
- **Info**: `sky` (aprovado fat. direto, filtros ativos).
- **Roxo**: `violet` (rejeitado validade, projeto).

Status pills **sempre** cor sólida + texto branco, exceto "leves" (ex: N/A, rejeitado validade) que usam tom claro (bg-100/200) + texto escuro.

### 6. Microinterações obrigatórias
- Hover em row: `hover:bg-slate-50/70` + `cursor-pointer` + `transition-colors`.
- Botões: `transition` + hover state (cor ou brightness).
- Dropdowns: `shadow-xl` + `rounded-lg` + `animate-in fade-in-0 slide-in-from-top-1`.
- Skeletons durante loading, nunca espaço em branco puro.

### 7. Sticky header & primeira coluna
Em tabelas densas com muitas colunas:
- Header: `sticky top-0 z-20 bg-white` com `shadow-[0_1px_0_0_theme(colors.slate.200)]` (não usa border-bottom, que quebra sticky).
- Primeira coluna: `sticky left-0 z-10` + `shadow-[2px_0_0_theme(colors.slate.200)]` (sombra em vez de borda).
- Fundo da sticky col precisa **bater** com o fundo da row naquele contexto (branco, slate-50 para summary, slate-100 para hover).

### 8. Fonte San Francisco / Inter
Sistema stack: `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`. Numeros sempre `tabular-nums` em colunas de valor.

### 9. Filtros dinâmicos (padrão app.waterworks)
Referência: print em `docs/plans/` (Chamados).

Layout recomendado:
```
┌─ Summary cards (5-6): Todos / Aprovados / Pendentes / Não Aprovados ─┐
│  Grandes, com ícone + número grande + label pequena embaixo.         │
└──────────────────────────────────────────────────────────────────────┘

┌─ Facets em colunas: Empresa | Status | Tipo | Categoria | Fornecedor ┐
│  Cada facet: lista com valor + badge colorida com contagem.           │
│  Clicar adiciona/remove ao filtro. Múltipla seleção com toggle.       │
└──────────────────────────────────────────────────────────────────────┘
```

Cada facet-item:
- `px-3 py-1.5` + `rounded-md` + `hover:bg-slate-50`.
- Badge de contagem: `rounded-full px-2 py-0.5 text-[10px] font-semibold`.
- Badge colorida por tone (mesma do status): counts importantes em tone vivo, menores em slate.
- Ativo: ring + bg da cor correspondente.

### 10. Sidebar retrátil
Estado **persistente** em `localStorage`. Colapsada em mobile por default. Width: `220px` aberta / `60px` fechada. Transição `duration-200 ease-out` só no `width`. Ícones sempre visíveis; labels somem com `opacity-0 w-0` para permitir animação do container.

## Quando aplicar

Use este skill sempre que o usuário:
- Reclamar do visual ("mal", "feio", "pouco visível", "não vejo diferença").
- Pedir explicitamente melhorias de design.
- Referenciar um print de outro produto como inspiração.
- Solicitar uma feature de UI nova (filtros, menus, modais, etc).

## Arquivos chave do app

- `web/app/globals.css` — fonte base, reset.
- `web/tailwind.config.ts` — content paths + safelist + paleta brand.
- `web/components/GroupedModuleView.tsx` — tabela principal (bucket por PV/OS).
- `web/components/AppSidebar.tsx` — menu lateral retrátil.
- `web/lib/columns.ts` — definição de grupos de colunas e STATUS_META (cores).

## Anti-padrões comuns

- ❌ `border-[6px]+` como separador entre blocos. Use gap row + bg contrast.
- ❌ Emojis no meio de labels de UI densa (distrai). OK em badges de status grandes (Smart-like).
- ❌ `font-bold` + `text-base` em tudo. Use peso para hierarquia.
- ❌ `hover:bg-blue-500` sem transition. Sempre `transition-colors` ou `transition`.
- ❌ Bordas com tom escuro (`border-slate-500+`) — parece retrô. Usa `slate-200/300`.
- ❌ Sticky col/header com bg que não bate (glitch visual no scroll).
