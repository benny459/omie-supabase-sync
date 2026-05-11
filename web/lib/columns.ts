import { fmtBRL, fmtBool, fmtDate, fmtDateTime, fmtDays, fmtNum, fmtPct } from "./format";

export type ColumnFormat = "text" | "number" | "money" | "date" | "datetime" | "bool" | "pct" | "days" | "status" | "mono";

export type Column = {
  key: string;
  label: string;
  format?: ColumnFormat;
  width?: string;
  align?: "left" | "right" | "center";
  editable?: "date" | "text" | "number" | "money" | "status" | "textarea";
  // Campo onde persistir: coluna direta (ex: "rc_numero") ou "custom:<slug>"
  editableField?: string;
};

export type Group = {
  key: string;
  label: string;
  tint: string;
  border: string;
  defaultOpen: boolean;
  columns: Column[];
};

// ── 1º BLOCO (leftmost) — PV/OS com os 11 campos do Smart + PC número ────
export const GROUP_PV_OS: Group = {
  key: "pvos",
  label: "PV/OS · Omie",
  tint: "bg-violet-50/70",
  border: "border-violet-300",
  defaultOpen: true,
  columns: [
    { key: "pv_os_label",           label: "V.PV / OS",              format: "mono" },
    { key: "pv_emissao",            label: "V.Emissão_Omie",          format: "date" },
    { key: "tipo_omie",             label: "V.Tipo_Omie" },
    { key: "pv_cliente_fantasia",   label: "V.Cliente_Omie" },
    { key: "pv_numero_contrato",    label: "Proposta",                format: "mono" },
    { key: "projeto_nome",          label: "V.Projeto_Omie" },
    { key: "pv_data_previsao",      label: "V.Previsão Limite_Omie", format: "date" },
    { key: "pv_valor_total",        label: "V.Valor_Omie",            format: "money", align: "right" },
    { key: "pv_etapa_texto",        label: "V.Etapa Venda_Omie" },
    { key: "pv_dt_fat",             label: "V.Data de Faturamento",   format: "date" },
    { key: "pv_num_nfe",            label: "V.NF saída",              format: "mono" },
    { key: "servicos_concluidos",   label: "🔗 Link Serviços",        width: "130px" },
    { key: "nova_prev_materiais",   label: "*V.Nova Prev. Materiais", format: "date", editable: "date", editableField: "custom:s4b87bk9" },
    { key: "nova_prev_servicos",    label: "*V.Nova Prev. Serviços",  format: "date", editable: "date", editableField: "custom:s242fb18ba" },
  ],
};

// ── Demais blocos ─────────────────────────────────────────────────────────
export const GROUP_APROVACAO: Group = {
  key: "aprovacao", label: "Aprovação", tint: "bg-emerald-50/70", border: "border-emerald-300",
  defaultOpen: true,
  columns: [
    { key: "status_label",      label: "Status", format: "status", editable: "status", editableField: "status" },
    { key: "aprovador_email",   label: "Aprovador" },
    { key: "aprovado_em",       label: "Aprovado em", format: "datetime" },
    // Snapshot: gravado automaticamente ao aprovar (valor_total do PC naquele instante)
    { key: "valor_aprovado",    label: "Valor Aprovado (F)", format: "money", align: "right" },
    // Fórmula: pv_data_previsao - prazo_entrega_pc - 5 dias (vem da view enriched)
    { key: "aprovar_ate_calc",  label: "Aprovar até (F)", format: "date" },
    { key: "justificativa",     label: "Justificativa", editable: "textarea", editableField: "justificativa" },
  ],
};

export const GROUP_RC: Group = {
  key: "rc", label: "RC (Requisição) — manual · Excel · fórmulas", tint: "bg-amber-50/70", border: "border-amber-300",
  defaultOpen: true,
  columns: [
    { key: "rc_numero",       label: "*RC.Numero",       format: "mono",  editable: "number", editableField: "rc_numero" },
    { key: "rc_descricao",    label: "*RC.Descrição",                      editable: "text",   editableField: "rc_descricao" },
    { key: "rc_qtd",          label: "*RC.Qtd",          format: "number", align: "right", editable: "number", editableField: "custom:rc_qtd" },
    { key: "rc_custo",        label: "*RC.Custo Unit.",  format: "money", align: "right", editable: "money", editableField: "rc_custo" },
    // RC.Custo total agora é fórmula (SUM de qtd × custo dos siblings do mesmo PV/OS). Não editável.
    { key: "rc_custo_total_calc",  label: "RC.Custo total (F)", format: "money", align: "right" },
    { key: "dif_pct_pc_rc",   label: "RC.Dif % PC/RC (F)", format: "pct",   align: "right" },
    { key: "rc_pc_vs_rc",     label: "RC.PC vs RC (F)" },
  ],
};

export const GROUP_PC_OMIE: Group = {
  key: "pc", label: "PC (Omie) — # editável", tint: "bg-blue-50/60", border: "border-blue-300",
  defaultOpen: true,
  columns: [
    { key: "pc_numero",           label: "PC #",               format: "mono", editable: "text", editableField: "pc_numero_manual" },
    { key: "pc_projeto_alert",    label: "PC.Projeto" },
    { key: "pc_etapa_texto",      label: "Etapa PC" },
    { key: "codigo_categoria",    label: "Categoria" },
    { key: "nome_fornecedor",     label: "Fornecedor" },
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
  key: "log", label: "Logística / NFe Entrada", tint: "bg-cyan-50/70", border: "border-cyan-300",
  defaultOpen: false,
  columns: [
    { key: "mt_status_fornecimento",  label: "Status Fornec" },
    { key: "mt_data_emissao_nf",      label: "Emissão NF", format: "date" },
    { key: "mt_data_recebimento_nf",  label: "Recebto NF", format: "date" },
    { key: "mt_nf_fornecedor",        label: "NF Fornec #", format: "mono" },
  ],
};

// Bloco único com fórmulas derivadas + metadata de origem
export const GROUP_EXTRAS: Group = {
  key: "extras", label: "Fórmulas & Metadata", tint: "bg-slate-50", border: "border-slate-300",
  defaultOpen: false,
  columns: [
    { key: "prazo_entrega_dias",  label: "Prazo Entr.", format: "days", align: "right" },
    { key: "aprovar_ate_calc",    label: "Aprov. até calc", format: "date" },
    { key: "dias_para_aprovar",   label: "Dias p/ Aprov.", format: "days", align: "right" },
    { key: "dias_prazo_pv",       label: "Dias Prazo PV", format: "days", align: "right" },
    { key: "status_atraso_pv",    label: "Atraso?" },
    { key: "dif_rc_pc",           label: "Dif RC→PC", format: "money", align: "right" },
    { key: "source",              label: "Fonte" },
    { key: "smart_id",            label: "Smart ID", format: "mono" },
    { key: "imported_at",         label: "Importado", format: "datetime" },
    { key: "num_comentarios",     label: "💬", format: "number", align: "right" },
    { key: "num_anexos",          label: "📎", format: "number", align: "right" },
  ],
};

export const GROUP_PCS_EXTRA: Group = {
  key: "pcs_extra", label: "Prioridade (PCs Standalone)", tint: "bg-rose-50/70", border: "border-rose-300",
  defaultOpen: true,
  columns: [
    { key: "prioridade", label: "Prioridade" },
  ],
};

// Ordem canônica: PV/OS primeiro (leftmost), depois o workflow
export function groupsFor(modulo: "avulsos" | "projetos" | "pcs"): Group[] {
  if (modulo === "pcs") {
    // PCs standalone: vêm naturalmente do Omie, sem input manual de PC#.
    // Mostra PC# apenas como display (não editável) e tira o pc_projeto_alert
    // (não há venda pra comparar nesse contexto).
    const pcStandaloneCols = GROUP_PC_OMIE.columns
      .filter((c) => c.key !== "pc_numero" && c.key !== "pc_projeto_alert");
    // /pcs Standalone NÃO tem RC associado — removemos GROUP_RC e qualquer
    // coluna que dependa dele dos demais grupos (dif_rc_pc, rc_custo_total_calc,
    // dif_pct_pc_rc, rc_pc_vs_rc do EXTRAS).
    const RC_DEPENDENT_KEYS = new Set([
      "rc_numero", "rc_descricao", "rc_custo", "rc_custo_total",
      "rc_custo_total_calc", "dif_rc_pc", "dif_pct_pc_rc", "rc_pc_vs_rc",
    ]);
    const stripRc = (g: Group): Group => ({
      ...g,
      columns: g.columns.filter((c) => !RC_DEPENDENT_KEYS.has(c.key)),
    });
    // Em /pcs a justificativa entra no grupo PC (editável por quem tem can_edit_pc),
    // não no grupo Aprovação. Aprovação fica enxuta com status + aprovador + datas.
    const aprovacaoSemJustif: Group = {
      ...GROUP_APROVACAO,
      columns: GROUP_APROVACAO.columns.filter((c) => c.key !== "justificativa"),
    };
    const justificativaCol = GROUP_APROVACAO.columns.find((c) => c.key === "justificativa")!;
    return [
      { ...GROUP_PC_OMIE, defaultOpen: true, columns: [
          { key: "pc_numero", label: "PC #", format: "mono" },
          // Projeto vinculado ao PC (vem de finance.projetos via codigo_projeto).
          // Em /pcs aparecem PCs cujo projeto NÃO é 40_VS/41_VP/PJ* — útil ver
          // qual é o projeto real (43_ESTOQUE, 47_CONTRATUAL, CT*, etc).
          { key: "projeto_nome", label: "Projeto" },
          ...pcStandaloneCols,
          justificativaCol, // ← justificativa no grupo PC (editável c/ can_edit_pc)
        ]
      },
      GROUP_PCS_EXTRA,
      aprovacaoSemJustif,
      GROUP_LOGISTICA,
      stripRc(GROUP_EXTRAS),
    ];
  }
  // avulsos / projetos: PV/OS → RC → PC → Aprovação → Logística → Fórmulas & Metadata
  // V.Serviços OK só faz sentido em /avulsos (fluxo de OS de campo do app de serviços)
  if (modulo === "projetos") {
    const pvOsSemServicos: Group = {
      ...GROUP_PV_OS,
      columns: GROUP_PV_OS.columns.filter((c) => c.key !== "servicos_concluidos"),
    };
    return [pvOsSemServicos, GROUP_RC, GROUP_PC_OMIE, GROUP_APROVACAO, GROUP_LOGISTICA, GROUP_EXTRAS];
  }
  return [GROUP_PV_OS, GROUP_RC, GROUP_PC_OMIE, GROUP_APROVACAO, GROUP_LOGISTICA, GROUP_EXTRAS];
}

export function formatCell(value: unknown, fmt?: ColumnFormat): string {
  if (value == null || value === "") return "—";
  switch (fmt) {
    case "money":    return fmtBRL(value as number | string);
    case "number":   return fmtNum(value as number);
    case "date":     return fmtDate(value as string);
    case "datetime": return fmtDateTime(value as string);
    case "bool":     return fmtBool(value as boolean);
    case "pct":      return fmtPct(value as number);
    case "days":     return fmtDays(value as number);
    case "mono":     return String(value);
    case "status":   return String(value);
    default:         return String(value);
  }
}

// Cores Variação D — paleta sóbria. Só "Aprovado!" e "Aprovado Fat. Direto"
// contam como efetivamente aprovados (isApproved=true).
// Fundos custom via classes arbitrárias (Tailwind) — light + dark.
export const STATUS_META: Record<string, { label: string; tone: string; emoji: string; isApproved: boolean }> = {
  APROVADO:             { label: "Aprovado!",               tone: "bg-[#0e6e57] text-white dark:bg-[#3eba9a] dark:text-[#0a1812]",                emoji: "✅", isApproved: true  },
  APROVADO_FAT_DIRETO:  { label: "Aprovado Fat. Direto",    tone: "bg-[#0e6493] text-white dark:bg-[#5cb6ed] dark:text-[#0a1622]",                emoji: "✅", isApproved: true  },
  PRE_SELECAO:          { label: "Pré seleção",             tone: "bg-[#b8651a] text-white dark:bg-[#e8a04a] dark:text-[#1a0e02]",                emoji: "⏳", isApproved: false },
  PENDENTE:             { label: "Pendente",                tone: "bg-[#1a1a18] text-white dark:bg-[#f1f1ea] dark:text-[#0a0a08]",                emoji: "⏸️", isApproved: false },
  NAO_APROVADO:         { label: "Não Aprovado",            tone: "bg-[#5223a4] text-white dark:bg-[#ad8af0] dark:text-[#1a0e2c]",                emoji: "❌", isApproved: false },
  REJEITADO_VALIDADE:   { label: "Rejeitado por validade",  tone: "bg-[#ede2ff] text-[#5223a4] dark:bg-[#2a1c45] dark:text-[#c2a8e8]",            emoji: "🕒", isApproved: false },
  CANCELAR_PEDIDO:      { label: "Cancelar Pedido",         tone: "bg-[#b8253a] text-white dark:bg-[#ed5f7a] dark:text-[#280a10]",                emoji: "🚫", isApproved: false },
  N_A:                  { label: "N/A",                     tone: "bg-ww-border text-ww-textMuted dark:bg-ww-border dark:text-ww-textMuted",     emoji: "—",  isApproved: false },
};

// Ordem de exibição no dropdown — replica a ordem do Smart
export const STATUS_ORDER: string[] = [
  "APROVADO",
  "APROVADO_FAT_DIRETO",
  "PRE_SELECAO",
  "PENDENTE",
  "REJEITADO_VALIDADE",
  "NAO_APROVADO",
  "CANCELAR_PEDIDO",
  "N_A",
];

export const isApproved = (status: string): boolean => !!STATUS_META[status]?.isApproved;
export const STATUS_BADGE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([k, v]) => [k, v.tone]),
);
