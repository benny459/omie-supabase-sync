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

/** Erro do banco com o código e o detalhe (a guarda de duplicados manda os candidatos no detalhe). */
export class ErroCad extends Error {
  constructor(message: string, public code?: string, public details?: string) { super(message); }
}

export async function rpcCad<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new ErroCad(error.message, error.code, error.details ?? undefined);
  return data as T;
}

/** Possível duplicado (sql/59, SQLSTATE P0D01): devolve os candidatos para "já existe — usar este". */
export function candidatosDoErro(e: unknown): unknown[] | null {
  if (!(e instanceof ErroCad) || e.code !== "P0D01") return null;
  try { const c = JSON.parse(e.details ?? "[]"); return Array.isArray(c) ? c : []; } catch { return []; }
}

/** Erro de regra (raise exception no banco) vira 400 com a mensagem; duplicado vira 409 com os candidatos. */
export function erroCad(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const candidatos = candidatosDoErro(e);
  if (candidatos) return NextResponse.json({ error: msg, duplicado: true, candidatos }, { status: 409 });
  return NextResponse.json({ error: msg }, { status: 400 });
}

type J = Record<string, unknown>;

/** Tira da ficha o que a pessoa não pode ver (no servidor, não só na tela). */
export function filtrarFicha(papel: "cliente" | "fornecedor", f: J, q: QuemCad): J {
  const out: J = { ...f };
  if (papel === "cliente") {
    if (!q.pode["financeiro.ver_receber"]) {
      out.receber = null; out.margem = null;
      // Custo, margem e pago/recebido de cada PV/OS vêm da mesma cadeia: somem juntos.
      out.vendas = Array.isArray(f.vendas)
        ? (f.vendas as J[]).map((v) => ({ ...v, custo: null, margemPct: null, pagoOk: null, recebidoOk: null }))
        : f.vendas;
    }
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
