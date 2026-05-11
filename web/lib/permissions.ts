// ─────────────────────────────────────────────────────────────────────────
// Permissões granulares por módulo × bloco. Centraliza toda a lógica de
// "quem pode editar o quê" num único lugar. UI e RLS consomem daqui.
// ─────────────────────────────────────────────────────────────────────────

export type Role = "admin" | "aprovador" | "comprador" | "viewer";
export type Modulo = "avulsos" | "projetos" | "pcs";
export type BlockKey = "pvos" | "rc" | "pc" | "aprovacao" | "log" | "extras";

export type PermsOverride = Partial<Record<Modulo, Partial<Record<BlockKey, {
  edit?: boolean;
  approve?: boolean;
}>>>>;

// Linha da tabela platform.user_module_roles — fonte primária de permissões
// granulares por módulo. Quando presente, sobrepõe a matriz por role abaixo.
export type ModuleRole = {
  modulo: Modulo;
  can_edit_pv: boolean;
  can_edit_rc: boolean;
  can_edit_pc: boolean;
  can_approve: boolean;
  can_edit_log: boolean;
  approval_ceiling_brl: number | null;   // só usado em modulo='pcs'
  weekly_budget_brl:    number | null;   // só usado em modulo='pcs'
};

export type UserPerms = {
  id?: string;
  role: Role;
  is_admin: boolean;
  permissions?: PermsOverride | null;
  // Novo modelo: 0+ rows da platform.user_module_roles
  module_roles?: ModuleRole[];
};

// Default capability matrix por role
// edit = pode editar campos do bloco
// approve = pode mudar status de aprovação (só faz sentido no bloco "aprovacao")
const DEFAULTS: Record<Role, Record<BlockKey, { edit: boolean; approve: boolean }>> = {
  admin: {
    pvos:      { edit: true,  approve: true  },
    rc:        { edit: true,  approve: true  },
    pc:        { edit: true,  approve: true  },
    aprovacao: { edit: true,  approve: true  },
    log:       { edit: true,  approve: true  },
    extras:    { edit: true,  approve: true  },
  },
  aprovador: {
    pvos:      { edit: false, approve: false },
    rc:        { edit: false, approve: false },
    pc:        { edit: false, approve: false },
    aprovacao: { edit: true,  approve: true  },
    log:       { edit: false, approve: false },
    extras:    { edit: false, approve: false },
  },
  comprador: {
    pvos:      { edit: true,  approve: false },
    rc:        { edit: true,  approve: false },
    pc:        { edit: true,  approve: false },
    aprovacao: { edit: false, approve: false },
    log:       { edit: true,  approve: false },
    extras:    { edit: false, approve: false },
  },
  viewer: {
    pvos:      { edit: false, approve: false },
    rc:        { edit: false, approve: false },
    pc:        { edit: false, approve: false },
    aprovacao: { edit: false, approve: false },
    log:       { edit: false, approve: false },
    extras:    { edit: false, approve: false },
  },
};

function effective(user: UserPerms | null | undefined, _modulo: Modulo, block: BlockKey) {
  if (!user) return { edit: false, approve: false };
  // is_admin sempre libera tudo (mantém compat com seed que põe is_admin=true)
  if (user.is_admin) return { edit: true, approve: true };

  // Novo modelo (preferencial): user_module_roles — checa flags por bloco.
  // Cada bloco mapeia 1:1 numa coluna boolean da tabela.
  const mr = user.module_roles?.find((r) => r.modulo === _modulo);
  if (mr) {
    const editByBlock: Record<BlockKey, boolean> = {
      pvos:      mr.can_edit_pv,  // campos editáveis de previsão/etc do PV
      rc:        mr.can_edit_rc,
      pc:        mr.can_edit_pc,
      aprovacao: mr.can_approve,  // approver pode editar campos de aprovação
      log:       mr.can_edit_log,
      extras:    false,
    };
    return {
      edit:    editByBlock[block],
      approve: block === "aprovacao" ? mr.can_approve : false,
    };
  }

  // Fallback: matriz por role (legado) + override JSONB
  const base = DEFAULTS[user.role] ?? DEFAULTS.viewer;
  const baseBlock = base[block];
  const override = user.permissions?.[_modulo]?.[block];
  return {
    edit:    override?.edit    ?? baseBlock.edit,
    approve: override?.approve ?? baseBlock.approve,
  };
}

// Checa se um usuário pode aprovar um PC com determinado valor, considerando:
//   1. can_approve no módulo
//   2. valor ≤ approval_ceiling_brl (alçada individual)
//   3. valor + já_aprovado_últimos_7d ≤ weekly_budget_brl (teto semanal)
// O 3º requer chamada server-side; aqui retornamos só os 2 primeiros.
// O endpoint /api/approvals/set-status faz a checagem completa.
export type ApproveCheck =
  | { ok: true }
  | { ok: false; reason: "not_approver" | "above_ceiling" | "weekly_exceeded"; ceiling?: number; weeklyRemaining?: number };

export function canApproveValue(
  user: UserPerms | null | undefined,
  modulo: Modulo,
  valor: number | null,
): ApproveCheck {
  if (!user) return { ok: false, reason: "not_approver" };
  if (user.is_admin) return { ok: true };
  const mr = user.module_roles?.find((r) => r.modulo === modulo);
  if (!mr || !mr.can_approve) return { ok: false, reason: "not_approver" };
  // Limites só aplicam em /pcs
  if (modulo === "pcs" && valor != null) {
    if (mr.approval_ceiling_brl != null && Number(valor) > Number(mr.approval_ceiling_brl)) {
      return { ok: false, reason: "above_ceiling", ceiling: Number(mr.approval_ceiling_brl) };
    }
    // weekly check é server-side
  }
  return { ok: true };
}

export function canEdit(user: UserPerms | null | undefined, modulo: Modulo, block: BlockKey): boolean {
  return effective(user, modulo, block).edit;
}

export function canApprove(user: UserPerms | null | undefined, modulo: Modulo, block: BlockKey = "aprovacao"): boolean {
  return effective(user, modulo, block).approve;
}

// Resumo humano das permissões do usuário em um módulo — usado no badge do topo.
export type PermsSummary = {
  blocks: { key: BlockKey; label: string; edit: boolean; approve: boolean }[];
};

const BLOCK_LABELS: Record<BlockKey, string> = {
  pvos:      "PV/OS",
  rc:        "RC",
  pc:        "PC",
  aprovacao: "Aprovação",
  log:       "Logística",
  extras:    "Fórmulas/Meta",
};

export function summarize(user: UserPerms | null | undefined, modulo: Modulo): PermsSummary {
  const blocks: PermsSummary["blocks"] = (Object.keys(BLOCK_LABELS) as BlockKey[]).map((k) => {
    const eff = effective(user, modulo, k);
    return { key: k, label: BLOCK_LABELS[k], edit: eff.edit, approve: eff.approve };
  });
  return { blocks };
}

export const ROLE_LABELS: Record<Role, { label: string; tone: string; desc: string }> = {
  admin:     { label: "Admin",     tone: "bg-slate-900 text-white",              desc: "Pode tudo em todos os blocos." },
  aprovador: { label: "Aprovador", tone: "bg-emerald-600 text-white",            desc: "Só muda status de aprovação." },
  comprador: { label: "Comprador", tone: "bg-amber-500 text-amber-950",          desc: "Edita RC, PC, Logística e PV/OS — não aprova." },
  viewer:    { label: "Viewer",    tone: "bg-slate-200 text-slate-700",          desc: "Só leitura." },
};
