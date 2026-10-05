import "server-only";
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea, type UserPerms } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";
import type { Chave } from "@/lib/acessos-catalogo";

// Cadastros próprios de clientes e fornecedores (05/10/26, sql/50_cadastros.sql).
// O schema cadastros não é exposto no PostgREST: tudo passa por orders.cadastros_*
// (security definer, só service_role). Estas rotas validam sessão e permissões.
//
// Quem vê: área ERP (a mesma de Compras e dos títulos).
// Quem edita: admin, quem abre Compras (fornecedores do dia a dia) ou quem pode
// incluir títulos no financeiro (clientes da cobrança).
// O que aparece na ficha segue as permissões finas: valores de compra só com
// compras.ver_valores; contas a receber/margem só com financeiro.ver_receber;
// contas a pagar/gasto pago só com financeiro.ver_pagar.

export type QuemCad = { perms: UserPerms; email: string; pode: Record<Chave, boolean>; editar: boolean };

export async function exigirCadastros(): Promise<QuemCad | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso aos cadastros" }, { status: 403 });
  const pode = await permissoesDe(perms);
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const editar = perms.is_admin || pode["compras.acesso"] || pode["financeiro.editar_titulo"];
  return { perms, email: user?.email ?? "painel", pode, editar };
}

export async function rpcCad<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Erro de regra (raise exception no banco) vira 400 com a mensagem. */
export function erroCad(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 400 });
}

type J = Record<string, unknown>;

/** Tira da ficha o que a pessoa não pode ver (no servidor, não só na tela). */
export function filtrarFicha(papel: "cliente" | "fornecedor", f: J, q: QuemCad): J {
  const out: J = { ...f };
  if (papel === "cliente") {
    if (!q.pode["financeiro.ver_receber"]) { out.receber = null; out.margem = null; }
  } else {
    if (!q.pode["financeiro.ver_pagar"]) {
      out.pagar = null;
      out.gasto = Array.isArray(f.gasto) ? (f.gasto as J[]).map((g) => ({ ...g, pago: null })) : f.gasto;
    }
    if (!q.pode["compras.ver_valores"]) {
      out.pcs = Array.isArray(f.pcs) ? (f.pcs as J[]).map((p) => ({ ...p, valor: null })) : f.pcs;
      out.nfs = Array.isArray(f.nfs) ? (f.nfs as J[]).map((n) => ({ ...n, valor: null })) : f.nfs;
      out.gasto = Array.isArray(out.gasto) ? (out.gasto as J[]).map((g) => ({ ...g, comprado: null })) : out.gasto;
      out.totais = f.totais ? { ...(f.totais as J), comprado: null } : f.totais;
    }
  }
  return out;
}
