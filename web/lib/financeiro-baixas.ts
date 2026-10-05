import "server-only";
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import type { Chave } from "@/lib/acessos-catalogo";

// Guarda comum das rotas de baixa e conciliação (05/10/26): sessão, área ERP,
// permissão fina e o e-mail de quem age (vai para o livro de baixas e para
// finance.financeiro_audit).

export type Ator = { email: string; pode: Record<Chave, boolean> };

export async function exigir(...chaves: Chave[]): Promise<Ator | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const pode = await permissoesDe(perms);
  const falta = chaves.find((c) => !pode[c]);
  if (falta) return NextResponse.json({ error: `Sem permissão (${falta})` }, { status: 403 });
  const { data: { user } } = await (await supaServer()).auth.getUser();
  return { email: user?.email ?? perms.id ?? "?", pode };
}

/** Cliente admin já no schema finance (RPCs security definer só para service_role). */
export const fin = () => supaAdmin().schema("finance");

/** Mensagem do Postgres sem o prefixo técnico, para mostrar na tela. */
export function erroDb(e: { message?: string } | null | undefined): NextResponse {
  return NextResponse.json({ error: (e?.message ?? "Erro").replace(/^.*?ERROR:\s*/, "") }, { status: 422 });
}
