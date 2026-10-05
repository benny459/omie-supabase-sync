import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import type { VendaDoc, VendaSalvar } from "@/lib/vendas";

// O schema `vendas` não é exposto no PostgREST: tudo passa por orders.vendas_*
// (security definer, só service_role). As rotas de tela validam a sessão e a
// área ERP (exigirVendas); a rota do CRM valida o segredo partilhado.

export { erro } from "@/lib/compras-server";

export type QuemVendas = { email: string; nome: string; admin: boolean };

/** PV/OS: área ERP (como ERP · Vendas). */
export async function exigirVendas(): Promise<QuemVendas | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const { data: prof } = await supaAdmin().schema("platform").from("user_profiles").select("nome").eq("id", perms.id ?? "").maybeSingle();
  const email = user?.email ?? "painel";
  return { email, nome: (prof as { nome?: string } | null)?.nome || email, admin: !!perms.is_admin };
}

/** Servidor-a-servidor (CRM): mesmo segredo da RC — COMPRAS_RC_SECRET, já nas duas Vercel. */
export function crmAutorizado(req: Request) {
  const esperado = process.env.COMPRAS_RC_SECRET ?? "";
  const veio = req.headers.get("x-compras-secret") ?? "";
  if (!esperado || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}

export const naoAutorizado = () => NextResponse.json({ error: "não autorizado" }, { status: 401 });

export async function salvarVenda(p: VendaSalvar, por: string) {
  const r = await rpc<{ id: number; tipo: string; numero: string; label: string; codigo: number; valor_total: number; empresa: string }>(
    "vendas_salvar", { p, p_por: por });
  await refrescar();
  return r;
}

export async function documento(id: number) {
  const d = await rpc<VendaDoc | null>("vendas_documento", { p_id: id });
  if (!d) throw new Error(`Documento ${id} não encontrado`);
  return d;
}

/** Avulsos lê uma materializada (cron a cada 10 min); depois de gravar, atualiza na hora. */
export async function refrescar() {
  await rpc("vendas_refrescar").catch(() => null);
}

export { docFat } from "@/lib/vendas-fat";
