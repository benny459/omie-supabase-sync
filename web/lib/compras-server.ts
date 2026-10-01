import "server-only";
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea, type UserPerms } from "@/lib/permissions";

// O schema compras não é exposto no PostgREST: tudo passa por funções
// orders.compras_* (security definer, só service_role). Estas rotas validam
// a sessão e a área ERP antes de chamar.

export type Quem = { perms: UserPerms; email: string; uid: string | null };

export async function exigirCompras(): Promise<Quem | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  return { perms, email: user?.email ?? "painel", uid: perms.id ?? null };
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Erro de regra (raise exception no banco) vira 400 com a mensagem; o resto, 500. */
export function erro(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Quem pode aprovar compra: admin, ou papel no módulo PCs com can_approve
 *  e dentro da alçada (approval_ceiling_brl). O teto semanal fica com a rota
 *  de aprovação do Omie (set-status), que já o calcula. */
export async function podeAprovar(q: Quem, valor: number): Promise<string | null> {
  if (q.perms.is_admin) return null;
  const { data } = await supaAdmin().schema("platform").from("user_module_roles")
    .select("can_approve, approval_ceiling_brl").eq("user_id", q.uid ?? "").eq("modulo", "pcs").maybeSingle();
  const r = data as { can_approve?: boolean; approval_ceiling_brl?: number | null } | null;
  if (!r?.can_approve) return "Sem permissão para aprovar compras";
  if (r.approval_ceiling_brl != null && valor > Number(r.approval_ceiling_brl)) {
    return `Acima da sua alçada (R$ ${Number(r.approval_ceiling_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`;
  }
  return null;
}
