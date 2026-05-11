# Design Bundle — Painel Waterworks (página Vendas Avulsas)

> **Como usar**: copie este arquivo inteiro e cole no claude.ai/design (ou similar). Anexe **2-3 screenshots** das telas atuais junto. Use o prompt do final.

---

## Contexto do produto

App B2B interno (Waterworks) para aprovação de Pedidos de Compra (PCs).
Stack: **Next.js 16 (App Router) + React 19 + Tailwind 3 + TypeScript**.
URL: https://painel.waterworks.com.br

**Usuários** (~20 internos, passam o dia no app):
- `admin` — pode tudo
- `aprovador` — aprova/rejeita
- `comprador` — edita PV/OS, RC, PC, logística (não aprova)
- `viewer` — só leitura

**3 páginas principais** com mesmo layout (tabela única agrupada por PV/OS):
- `/avulsos` — Vendas avulsas
- `/projetos` — Projetos PJ
- `/pcs` — PCs Standalone (sem venda atrelada)

**Volume**: ~1.700-3.000 linhas por página; tabela com **6 grupos colapsáveis** de colunas (PV/OS, RC, PC, Aprovação, Logística, Fórmulas). Cada bucket de PV/OS pode ter N linhas (1 por item).

**Dados**: Omie (ERP) → Supabase Postgres → views derivadas → app.

---

## Paleta e tokens (Tailwind)

```ts
// Status pills usadas globalmente:
APROVADO              bg-emerald-600 text-white  ring-emerald-700
APROVADO_FAT_DIRETO   bg-sky-500     text-white  ring-sky-600
PRE_SELECAO           bg-orange-400  text-white  ring-orange-500
PENDENTE              bg-slate-200   text-slate-800 ring-slate-300
NAO_APROVADO          bg-violet-700  text-white  ring-violet-800
REJEITADO_VALIDADE    bg-violet-200  text-violet-900 ring-violet-300
CANCELAR_PEDIDO       bg-rose-500    text-white  ring-rose-600
N_A                   bg-slate-300   text-slate-800 ring-slate-400

// Tints dos grupos de colunas (fundo claro nas células):
PV/OS · Omie     bg-violet-50/70  border-violet-300
RC               bg-amber-50/70   border-amber-300
PC (Omie)        bg-blue-50/60    border-blue-300
Aprovação        bg-emerald-50/70 border-emerald-300
Logística        bg-cyan-50/70    border-cyan-300
Fórmulas/Meta    bg-slate-50      border-slate-300

// Cards de summary (filtros) — TONE_MAP por status:
slate / emerald / rose / amber / orange / violet
cada um com: ring-{tone}-300 / text-{tone}-900 / bg-{tone}-100 + text-{tone}-700 (icon)
```

**Tipografia**: SF Pro (system stack `-apple-system, BlinkMacSystemFont, Inter, ...`). `tabular-nums` em colunas de valor.

**Cantos**: `rounded-md` inputs / `rounded-lg` cards / `rounded-xl` modais e summary cards / `rounded-full` pills.

**Sombras**: `shadow-sm` cards normais / `shadow-md` no hover / `shadow-xl` em dropdowns/portals.

---

## Estrutura visual (atual)

```
┌──── Header (logo + última sync) ────────────────────────────────────┐
│                                                                      │
│ ┌──── Título h1 + contagem ──────────────────────────────┐           │
│ │ Vendas Avulsas                                          │           │
│ │ 1.783 de 1.783 registros em 32 PV/OS                    │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Permissions Badge ─────────────────────────────────┐           │
│ │ [Comprador] Você pode editar: PV/OS · RC · PC · Log    │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Summary Cards (5) ─────────────────────────────────┐           │
│ │ [Todos] [Aprovados] [Não Aprovados] [Pendentes] [Atras]│           │
│ │   1.000      473            39            488     115   │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Filter Bar ────────────────────────────────────────┐           │
│ │ [🔍 search...]  [Projeto▼] [Tipo▼] [Etapa▼] [Categ▼]   │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Group toggles (chips) ─────────────────────────────┐           │
│ │ ▼PV/OS·Omie 12  ▼RC 7  ▼PC 12  ▼Aprovação 6  ▶Log 4   │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Tabela única (sticky header + sticky 1ª col) ─────┐           │
│ │ HEADER em camadas: linha 1 = grupos com tint;         │           │
│ │ linha 2 = colunas individuais (label uppercase 10px)   │           │
│ │                                                          │           │
│ │ ROWS agrupadas por PV/OS:                               │           │
│ │   Primeira row do bucket: bg leve (slate-50) com       │           │
│ │      toggle ± + contador (N PCs)                       │           │
│ │   Demais rows: bg-white                                  │           │
│ │   Gap entre buckets: 12px de altura cinza               │           │
│ │                                                          │           │
│ │ CÉLULA editável: bg-yellow-50 + border-dashed-amber    │           │
│ │ STATUS pill (dropdown): cor sólida + texto branco       │           │
│ │                                                          │           │
│ │ Última col com checkbox para batch select (se aprov.)  │           │
│ └─────────────────────────────────────────────────────────┘           │
│                                                                      │
│ ┌──── Toolbar batch (sticky top, aparece se selecionar) ┐           │
│ │ N selecionados · [✓ Aprovar] [✓ Fat. Direto] [✗] [🗑]  │           │
│ └─────────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Anti-padrões a evitar (lições já aprendidas)

- ❌ `border-[4px]+` ou `border-slate-700` como separador entre blocos. Use **gap row + bg contrast**.
- ❌ Emojis no meio de labels de UI densa (distrai). Tolerados apenas em badges grandes de status.
- ❌ `font-bold` em tudo. Use peso (semibold = 600) **+ tamanho** para hierarquia.
- ❌ `hover:bg-X-500` sem `transition-colors`.
- ❌ Bordas com tom escuro (`border-slate-500+`) — parece retrô. Use `slate-200/300`.
- ❌ Sticky col com bg que não bate com o fundo da row (glitch no scroll).
- ❌ `text-[10px]` em conteúdo (só em labels uppercase de header).
- ❌ Mexer em status visuais sem manter as 8 status existentes intactas.

---

## Restrições

- Manter as **8 status pills** (cores e nomes inalterados, só pode redesenhar a forma da pill em si).
- Manter os **6 grupos de colunas** com a mesma estrutura de tint.
- Manter as **células editáveis amarelas** como signal de editabilidade (mas o estilo pode evoluir).
- Manter compatibilidade com **dark mode futuro** (não usar cores fixas como `#000`).
- Frontend é Next.js + Tailwind — propostas em **React + classes Tailwind**, não estilos inline nem CSS Modules.

---

## ARQUIVOS RELEVANTES

### `web/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  safelist: [
    "bg-emerald-600", "ring-emerald-700",
    "bg-sky-500", "ring-sky-600",
    "bg-orange-400", "ring-orange-500",
    "bg-slate-200", "ring-slate-300", "text-slate-800",
    "bg-violet-700", "ring-violet-800",
    "bg-violet-200", "ring-violet-300", "text-violet-900",
    "bg-rose-500", "ring-rose-600",
    "bg-slate-300", "ring-slate-400",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#eff8ff",
          100: "#dbeefe",
          500: "#1e88e5",
          600: "#1976d2",
          700: "#1565c0",
        },
      },
    },
  },
} satisfies Config;
```

### `web/lib/columns.ts` (paleta + grupos + STATUS_META)

```ts
export type Column = {
  key: string;
  label: string;
  format?: "text" | "number" | "money" | "date" | "datetime" | "bool" | "pct" | "days" | "status" | "mono";
  width?: string;
  align?: "left" | "right" | "center";
  editable?: "date" | "text" | "number" | "money" | "status" | "textarea";
  editableField?: string; // "rc_numero" ou "custom:<slug>"
};

export type Group = {
  key: string;
  label: string;
  tint: string;          // ex: "bg-amber-50/70"
  border: string;        // ex: "border-amber-300"
  defaultOpen: boolean;
  columns: Column[];
};

export const GROUP_PV_OS: Group = {
  key: "pvos", label: "PV/OS · Omie",
  tint: "bg-violet-50/70", border: "border-violet-300", defaultOpen: true,
  columns: [
    { key: "pv_os_label",         label: "V.PV / OS",              format: "mono" },
    { key: "pv_emissao",          label: "V.Emissão_Omie",          format: "date" },
    { key: "tipo_omie",           label: "V.Tipo_Omie" },
    { key: "pv_cliente_fantasia", label: "V.Cliente_Omie" },
    { key: "projeto_nome",        label: "V.Projeto_Omie" },
    { key: "pv_data_previsao",    label: "V.Previsão Limite_Omie", format: "date" },
    { key: "pv_valor_total",      label: "V.Valor_Omie",            format: "money", align: "right" },
    { key: "pv_etapa_texto",      label: "V.Etapa Venda_Omie" },
    { key: "pv_dt_fat",           label: "V.Data de Faturamento",   format: "date" },
    { key: "pv_num_nfe",          label: "V.NF saída",              format: "mono" },
    { key: "nova_prev_materiais", label: "*V.Nova Prev. Materiais", format: "date", editable: "date", editableField: "custom:s4b87bk9" },
    { key: "nova_prev_servicos",  label: "*V.Nova Prev. Serviços",  format: "date", editable: "date", editableField: "custom:s242fb18ba" },
  ],
};

export const GROUP_APROVACAO: Group = {
  key: "aprovacao", label: "Aprovação",
  tint: "bg-emerald-50/70", border: "border-emerald-300", defaultOpen: true,
  columns: [
    { key: "status_label",     label: "Status", format: "status", editable: "status", editableField: "status" },
    { key: "aprovador_email",  label: "Aprovador" },
    { key: "aprovado_em",      label: "Aprovado em", format: "datetime" },
    { key: "valor_aprovado",   label: "Valor Aprovado (F)", format: "money", align: "right" },
    { key: "aprovar_ate_calc", label: "Aprovar até (F)", format: "date" },
    { key: "justificativa",    label: "Justificativa", editable: "textarea", editableField: "justificativa" },
  ],
};

export const GROUP_RC: Group = {
  key: "rc", label: "RC (Requisição) — manual · Excel · fórmulas",
  tint: "bg-amber-50/70", border: "border-amber-300", defaultOpen: true,
  columns: [
    { key: "rc_numero",           label: "*RC.Numero",       format: "mono",  editable: "number", editableField: "rc_numero" },
    { key: "rc_descricao",        label: "*RC.Descrição",                     editable: "text",   editableField: "rc_descricao" },
    { key: "rc_qtd",              label: "*RC.Qtd",          format: "number", align: "right", editable: "number", editableField: "custom:rc_qtd" },
    { key: "rc_custo",            label: "*RC.Custo Unit.",  format: "money", align: "right", editable: "money", editableField: "rc_custo" },
    { key: "rc_custo_total_calc", label: "RC.Custo total (F)", format: "money", align: "right" },
    { key: "dif_pct_pc_rc",       label: "RC.Dif % PC/RC (F)", format: "pct",   align: "right" },
    { key: "rc_pc_vs_rc",         label: "RC.PC vs RC (F)" },
  ],
};

export const GROUP_PC_OMIE: Group = {
  key: "pc", label: "PC (Omie) — # editável",
  tint: "bg-blue-50/60", border: "border-blue-300", defaultOpen: true,
  columns: [
    { key: "pc_numero",           label: "PC #",               format: "mono", editable: "text", editableField: "pc_numero_manual" },
    { key: "pc_projeto_alert",    label: "PC.Projeto" },
    { key: "pc_etapa_texto",      label: "Etapa PC" },
    { key: "codigo_categoria",    label: "Categoria" },
    { key: "contato_fornecedor",  label: "Fornecedor" },
    { key: "dt_previsao",         label: "Previsão PC", format: "date" },
    { key: "prazo_entrega_dias",  label: "Prazo entrega", format: "days", align: "right" },
    { key: "pc_forma_pagamento",  label: "Forma Pagamento" },
    { key: "dt_inclusao",         label: "Criado em",   format: "date" },
    { key: "qtd_itens",           label: "Itens",       format: "number", align: "right" },
    { key: "valor_total",         label: "Valor PC",    format: "money", align: "right" },
    { key: "pc_custo_total_calc", label: "PC.Custo total (F)", format: "money", align: "right" },
  ],
};

export const GROUP_LOGISTICA: Group = {
  key: "log", label: "Logística / NFe Entrada",
  tint: "bg-cyan-50/70", border: "border-cyan-300", defaultOpen: false,
  columns: [
    { key: "mt_status_fornecimento", label: "Status Fornec" },
    { key: "mt_data_emissao_nf",     label: "Emissão NF", format: "date" },
    { key: "mt_data_recebimento_nf", label: "Recebto NF", format: "date" },
    { key: "mt_nf_fornecedor",       label: "NF Fornec #", format: "mono" },
  ],
};

export const GROUP_EXTRAS: Group = {
  key: "extras", label: "Fórmulas & Metadata",
  tint: "bg-slate-50", border: "border-slate-300", defaultOpen: false,
  columns: [
    { key: "prazo_entrega_dias", label: "Prazo Entr.", format: "days", align: "right" },
    { key: "aprovar_ate_calc",   label: "Aprov. até calc", format: "date" },
    { key: "dias_para_aprovar",  label: "Dias p/ Aprov.", format: "days", align: "right" },
    { key: "dias_prazo_pv",      label: "Dias Prazo PV", format: "days", align: "right" },
    { key: "status_atraso_pv",   label: "Atraso?" },
    { key: "dif_rc_pc",          label: "Dif RC→PC", format: "money", align: "right" },
    { key: "source",             label: "Fonte" },
    { key: "imported_at",        label: "Importado", format: "datetime" },
    { key: "num_comentarios",    label: "💬", format: "number", align: "right" },
    { key: "num_anexos",         label: "📎", format: "number", align: "right" },
  ],
};

// STATUS pills — cor sólida + texto branco para os "fortes",
// tom claro + texto escuro para os "leves" (pendente, rejeitado validade, N/A)
export const STATUS_META = {
  APROVADO:             { label: "Aprovado!",              tone: "bg-emerald-600 text-white ring-emerald-700",   isApproved: true  },
  APROVADO_FAT_DIRETO:  { label: "Aprovado Fat. Direto",   tone: "bg-sky-500 text-white ring-sky-600",           isApproved: true  },
  PRE_SELECAO:          { label: "Pré seleção",            tone: "bg-orange-400 text-white ring-orange-500",     isApproved: false },
  PENDENTE:             { label: "Pendente",               tone: "bg-slate-200 text-slate-800 ring-slate-300",   isApproved: false },
  NAO_APROVADO:         { label: "Não Aprovado",           tone: "bg-violet-700 text-white ring-violet-800",     isApproved: false },
  REJEITADO_VALIDADE:   { label: "Rejeitado por validade", tone: "bg-violet-200 text-violet-900 ring-violet-300", isApproved: false },
  CANCELAR_PEDIDO:      { label: "Cancelar Pedido",        tone: "bg-rose-500 text-white ring-rose-600",         isApproved: false },
  N_A:                  { label: "N/A",                    tone: "bg-slate-300 text-slate-800 ring-slate-400",   isApproved: false },
};
```

### `web/app/(app)/avulsos/page.tsx`

```tsx
import { supaServer } from "@/lib/supabase-server";
import GroupedModuleView from "@/components/GroupedModuleView";
import { groupsFor } from "@/lib/columns";

export const dynamic = "force-dynamic";

export default async function AvulsosPage() {
  const supa = await supaServer();
  const { data, error, count } = await supa
    .from("v_pc_avulsos")
    .select("*", { count: "exact" })
    .order("pv_emissao", { ascending: true,  nullsFirst: false })
    .order("ncod_ped",   { ascending: true })
    .limit(1000);

  return (
    <>
      {error && (
        <div className="p-4 mb-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {error.message}
        </div>
      )}
      <GroupedModuleView
        modulo="avulsos"
        title="Vendas Avulsas"
        groups={groupsFor("avulsos")}
        rows={data ?? []}
        totalCount={count ?? null}
        groupByPv
      />
    </>
  );
}
```

### `web/components/FiltersBar.tsx` (filtros + summary cards)

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { isApproved } from "@/lib/columns";

type AnyRow = Record<string, unknown>;
export type StatusFilter = "todos" | "aprovados" | "nao_aprovados" | "pendentes" | "atrasados" | "sem_projeto";
export type FacetKey = "projeto_nome" | "tipo_omie" | "pc_etapa_texto" | "codigo_categoria" | "contato_fornecedor";
export type FacetState = Partial<Record<FacetKey, Set<string>>>;

const FACETS: { key: FacetKey; label: string }[] = [
  { key: "projeto_nome",       label: "Projeto" },
  { key: "tipo_omie",          label: "Tipo Omie" },
  { key: "pc_etapa_texto",     label: "Etapa PC" },
  { key: "codigo_categoria",   label: "Categoria" },
  { key: "contato_fornecedor", label: "Fornecedor" },
];

export default function FiltersBar({
  rows, query, setQuery, statusFilter, setStatusFilter, facets, setFacets,
}: {
  rows: AnyRow[];
  query: string; setQuery: (v: string) => void;
  statusFilter: StatusFilter; setStatusFilter: (v: StatusFilter) => void;
  facets: FacetState; setFacets: (f: FacetState) => void;
}) {
  // ... computa summary (Todos / Aprovados / Não Aprovados / Pendentes / Atrasados)
  // ... computa facetValues (count por valor de cada facet, filtrado pelo statusFilter ativo)

  return (
    <div className="space-y-3">
      {/* Summary cards — 5 colunas em md+ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Todos" value={summary.total} tone="slate" active={statusFilter === "todos"} onClick={() => setStatusFilter("todos")} icon={<IconTicket />} />
        <SummaryCard label="Aprovados" value={summary.aprovados} tone="emerald" active={statusFilter === "aprovados"} onClick={() => setStatusFilter("aprovados")} icon={<IconCheck />} />
        <SummaryCard label="Não Aprovados" value={summary.nao_aprovados} tone="rose" active={statusFilter === "nao_aprovados"} onClick={() => setStatusFilter("nao_aprovados")} icon={<IconX />} />
        <SummaryCard label="Pendentes" value={summary.pendentes} tone="amber" active={statusFilter === "pendentes"} onClick={() => setStatusFilter("pendentes")} icon={<IconClock />} />
        <SummaryCard label="Atrasados" value={summary.atrasados} tone="orange" active={statusFilter === "atrasados"} onClick={() => setStatusFilter("atrasados")} icon={<IconAlert />} />
      </div>

      {/* Banner amarelo opcional pra "sem projeto atribuído" */}
      {summary.sem_projeto > 0 && (
        <button
          onClick={() => setStatusFilter(statusFilter === "sem_projeto" ? "todos" : "sem_projeto")}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-lg border border-amber-200 bg-amber-50/60 hover:bg-amber-50 text-left transition"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <IconAlert />
          </div>
          <div className="flex-1 text-sm">
            <span className="font-semibold text-amber-900">⚠️ {summary.sem_projeto} registros sem projeto.</span>
            <span className="ml-2 text-xs text-amber-800/80">Clique pra filtrar.</span>
          </div>
        </button>
      )}

      {/* Search + facet dropdowns + clear */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por PC, PV/OS, cliente, fornecedor, RC…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/60 bg-white"
          />
        </div>
        {FACETS.map(({ key, label }) => (
          <FacetDropdown key={key} label={label} values={facetValues[key]}
            selected={facets[key] ?? new Set()}
            onToggle={(v) => toggleFacet(key, v)}
            onClear={() => clearFacet(key)} />
        ))}
        {hasActiveFilters && (
          <button onClick={clearAll} className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition">
            Limpar tudo
          </button>
        )}
      </div>
    </div>
  );
}

// Summary card — botão grande clicável que ativa filtro de status
function SummaryCard({ label, value, tone, active, onClick, icon }) {
  // tone: slate | emerald | rose | amber | orange | violet
  return (
    <button onClick={onClick}
      className={`relative bg-white rounded-xl border transition-all text-left p-4 hover:shadow-md hover:-translate-y-0.5 ${
        active ? `border-transparent ring-2 ring-${tone}-300 shadow-md` : "border-slate-200 shadow-sm"
      }`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${tone}-100 text-${tone}-700`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-2xl font-semibold tabular-nums text-${tone}-900`}>
            {value.toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-slate-500 font-medium">{label}</div>
        </div>
      </div>
    </button>
  );
}

// Facet dropdown — multi-seleção com checkbox + count + busca interna
function FacetDropdown({ label, values, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const count = selected.size;
  const active = count > 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition ${
          active ? "bg-sky-50 border-sky-300 text-sky-900" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
        }`}>
        <span>{label}</span>
        {active && <span className="bg-sky-600 text-white rounded-full px-1.5 text-[10px] font-semibold tabular-nums">{count}</span>}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 right-0 w-[260px] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
          {/* search interno + lista de valores com checkbox + count + botão Limpar */}
        </div>
      )}
    </div>
  );
}
```

### `web/components/EditableCell.tsx` (célula editável amarela)

```tsx
"use client";
// Célula editável inline. Visual: bg-yellow-50 + border-dashed-amber.
// Salva via Supabase + router.refresh() pra re-renderizar somas em tempo real.

const base =
  `px-1.5 py-0.5 rounded text-[11px] bg-yellow-50 border border-dashed ` +
  `${saving ? "border-amber-400 animate-pulse" : "border-amber-300"} ` +
  `${error ? "border-rose-400 bg-rose-50" : ""} ` +
  `text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-500 ` +
  `hover:bg-yellow-100 cursor-text`;

// Variações por kind:
// - date:     <input type="date" />  className={`${base} w-[120px]`}
// - text:     <input />               className={`${base} w-[180px]`}
// - number:   <input inputMode=decimal />  w-[100px] text-right tabular-nums
// - money:    <input inputMode=decimal placeholder="R$" />  w-[100px] text-right
// - textarea: <textarea rows={2} />   className={`${base} w-[220px] min-h-[40px]`}
```

### `web/components/EditableStatusCell.tsx` (dropdown de status via portal)

```tsx
"use client";
// Botão pill com cor do STATUS_META atual. Ao clicar abre menu via createPortal
// (escapa overflow-hidden da tabela). Posição calculada via getBoundingClientRect.

<button className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold ${meta.tone} hover:brightness-110 shadow-sm`}>
  <span>{meta.label}</span>
  <span className="text-[9px] opacity-80">▾</span>
</button>

// Menu (portal):
<div style={{ position: "fixed", top, left, width: 260, zIndex: 9999 }}
     className="p-2 bg-white border border-slate-200 rounded-xl shadow-2xl space-y-1.5">
  {STATUS_ORDER.map(code => (
    <button key={code} className={`w-full px-4 py-2 rounded-full text-[12px] font-bold ${meta.tone}`}>
      {meta.label} {selected && "✓"}
    </button>
  ))}
</div>
```

### `web/components/GroupedModuleView.tsx` (tabela principal — comportamento)

```tsx
"use client";
// Componente principal: tabela única com:
// - Header sticky em 2 camadas (grupos com tint + colunas individuais)
// - Primeira coluna sticky (PV/OS label)
// - Rows agrupadas por pv_os_label (ou projeto_nome em /projetos)
// - Toggle ± por bucket pra colapsar/expandir
// - Linha summary do bucket (collapsed view) com merge de valores iguais
// - Filtros (FiltersBar) + grupos colapsáveis (toggle global)
// - Batch select com checkbox na 1ª col
// - Toolbar batch sticky no topo quando há seleção
// - DetailDrawer ao clicar em row (sidebar com comments/attachments)

// Estilos-chave da tabela:
const stickyHeaderCls = "sticky top-0 z-20 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]";
const stickyColCls = "sticky left-0 z-10 shadow-[2px_0_0_theme(colors.slate.200)]";

// Row do bucket (primeira linha):
"bg-slate-50 border-t border-slate-300"

// Row regular:
"hover:bg-slate-50/70 transition-colors cursor-pointer border-b border-slate-200"

// Gap entre buckets:
<tr><td colSpan={N} className="h-3 bg-slate-50/60" /></tr>

// Toolbar batch sticky:
"sticky top-2 z-30 bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5"

// Group toggle chip:
`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
  open ? `${group.tint} ${group.border} text-slate-900` : "bg-white border-slate-200 text-slate-500"
}`
```

---

## PROMPT pra colar no claude.ai/design

```
Preciso de uma análise de design e proposta de redesenho da página principal
(Vendas Avulsas) do meu app B2B.

Acima compartilhei: contexto do produto, paleta, tokens, anti-padrões, restrições
e o código dos componentes principais.

Anexei [N] screenshots da tela atual.

O que quero:

1. **Análise** rápida (5-7 bullets): o que está bom, o que está com hierarquia
   visual confusa, o que está ineficiente em densidade.

2. **3 variações** de redesenho focadas em diferentes vibes:
   - A) "Linear" — minimalista, monocromático, muito espaçamento, foco em
        densidade controlada
   - B) "Stripe Dashboard" — cards quadrados com pequenas sombras, paleta
        sutil, tipografia mais elegante
   - C) "Híbrido WaterWorks" — mantém o caráter atual (multi-grupo com tints)
        mas profissionaliza tipografia, espaçamento e microinterações

3. Pra cada variação:
   - Preview em React + Tailwind (componente standalone que eu possa rodar)
   - Use a paleta acima EXATAMENTE (sem inventar cores fora dela)
   - Mantenha as 8 status pills e 6 grupos de colunas inalteradas em conteúdo
   - Foque na **tabela principal + filter bar + summary cards** (a tela inteira)

4. Recomendação final: qual das 3 caberia melhor pra um app B2B usado o dia
   inteiro por compradores e aprovadores, e por quê.

Não invente novas funcionalidades — só redesenhe o que existe.
```

---

_Bundle gerado em 2026-04-27. Atualizar se mudar paleta, status ou estrutura de grupos._
