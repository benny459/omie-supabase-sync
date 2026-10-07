import "server-only";
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";

/** Quem fatura: área ERP + "Incluir / excluir título" (cria contas a receber),
 *  ou admin. A chave de produção é só do Benny. */
export const DONO_PRODUCAO = "benny@waterworks.com.br";

/** semProposta / homologacao: admin ou permissão própria (Usuários e acessos → Faturamento). */
export type QuemFat = { email: string; admin: boolean; semProposta: boolean; homologacao: boolean };

export async function exigirFaturamento(): Promise<QuemFat | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const pode = await permissoesDe(perms);
  if (!perms.is_admin && !pode["faturamento.acesso"]) {
    return NextResponse.json({ error: "Sem permissão para o Faturamento — peça ao administrador (Usuários e acessos → Faturamento)" }, { status: 403 });
  }
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const admin = !!perms.is_admin;
  return {
    email: user?.email ?? "painel", admin,
    semProposta: admin || !!pode["faturamento.sem_proposta"],
    homologacao: admin || !!pode["faturamento.homologacao"],
  };
}

export function falha(e: unknown, status = 400) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}
