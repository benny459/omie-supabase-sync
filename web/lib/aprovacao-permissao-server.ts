// Quem decide a aprovação de uma linha de approval.approvals (Operação/Projetos) — 08/10/26.
// Regra pura em lib/aprovacao-permissao.ts (a MESMA do Compras); aqui só se juntam os dados:
// perfil + papéis do usuário, status atual da linha, alçada e o projeto do PC do Omie.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { canApprove, type Modulo, type ModuleRole, type Role, type UserPerms } from "@/lib/permissions";
import { motivoSemPermissao, statusExigeAprovador, acaoDoStatus, type EntradaPermissao } from "@/lib/aprovacao-permissao";
import { avaliarPcProjeto } from "@/lib/aprovacao-projeto";
import { ehProjetoDeObra } from "@/lib/aprovacao-projeto-regra";

export type PermsAprovacao = UserPerms & { ativo: boolean };

/** Perfil + papéis por módulo (service role: não depende de RLS). null = sem perfil. */
export async function permsAprovacao(userId: string): Promise<PermsAprovacao | null> {
  const adm = supaAdmin();
  const [{ data: perfil }, { data: papeis }] = await Promise.all([
    adm.schema("platform").from("user_profiles").select("role, is_admin, permissions, ativo").eq("id", userId).maybeSingle(),
    adm.schema("platform").from("user_module_roles").select("*").eq("user_id", userId),
  ]);
  const p = perfil as { role?: Role; is_admin?: boolean; permissions?: UserPerms["permissions"]; ativo?: boolean } | null;
  if (!p) return null;
  return {
    id: userId, role: p.role ?? (p.is_admin ? "admin" : "viewer"), is_admin: p.is_admin === true || p.role === "admin",
    permissions: p.permissions ?? null, module_roles: (papeis ?? []) as ModuleRole[], ativo: p.ativo !== false,
  };
}

export type LinhaAprovacao = { empresa: string; ncod_ped: number; modulo: string; valorPc?: number | null };

/** null = pode mudar a linha para `novo`; senão o motivo. `statusAtual` evita reler a linha. */
export async function motivoNaoDecideLinha(perms: PermsAprovacao, l: LinhaAprovacao, novo: string,
                                           statusAtual?: string | null): Promise<string | null> {
  if (!perms.ativo) return "Acesso desativado";
  let atual = statusAtual;
  if (atual === undefined) {
    const { data } = await supaAdmin().schema("approval").from("approvals").select("status")
      .eq("empresa", l.empresa).eq("ncod_ped", l.ncod_ped).maybeSingle();
    atual = (data as { status?: string | null } | null)?.status ?? null;
  }
  if (!statusExigeAprovador(atual, novo)) return null;
  const acao = acaoDoStatus(novo);
  const modulo = (["avulsos", "projetos", "pcs"].includes(l.modulo) ? l.modulo : "avulsos") as Modulo;
  const ehAdmin = perms.is_admin;
  const temPermissao = canApprove(perms, modulo);
  if (ehAdmin || !temPermissao) return motivoSemPermissao({ ehAdmin, temPermissao, valor: null, teto: null }, acao);

  // PC de projeto de obra (Omie): estourou o budget → só admin (lib/aprovacao-projeto-regra).
  const { data: ped } = await supaAdmin().schema("orders").from("pedidos_compra")
    .select("ncod_proj, cnumero").eq("empresa", l.empresa).eq("ncod_ped", l.ncod_ped).limit(1).maybeSingle();
  const codProj = (ped as { ncod_proj?: number | null } | null)?.ncod_proj ?? null;
  const pcNum = (ped as { cnumero?: string | null } | null)?.cnumero ?? null;
  if (codProj && pcNum) {
    const { data: pj } = await supaAdmin().schema("finance").from("projetos").select("nome").eq("codigo", codProj).limit(1).maybeSingle();
    if (ehProjetoDeObra((pj as { nome?: string } | null)?.nome)) {
      let projeto: EntradaPermissao["projeto"] = null;
      // sem como avaliar o budget agora: segue a regra de antes (set-status, 07/10/26)
      try { projeto = await avaliarPcProjeto(l.empresa, Number(codProj), String(pcNum), l.valorPc ?? null); } catch { projeto = null; }
      if (projeto) return motivoSemPermissao({ ehAdmin, temPermissao, valor: l.valorPc ?? null, teto: null, projeto }, acao);
    }
  }
  // Alçada individual: só no módulo PCs (como sempre foi).
  const mr = perms.module_roles?.find((r) => r.modulo === modulo);
  const teto = modulo === "pcs" && mr?.approval_ceiling_brl != null ? Number(mr.approval_ceiling_brl) : null;
  return motivoSemPermissao({ ehAdmin, temPermissao, valor: l.valorPc ?? null, teto }, acao);
}
