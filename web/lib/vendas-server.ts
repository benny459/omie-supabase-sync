import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import type { DocFat } from "@/lib/faturamento/montar";
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

/**
 * Monta o documento do faturamento (P5) a partir do PV/OS: cliente do cadastro
 * próprio (endereço, IE, e-mail de NF), itens e condição (parcelas do PV/OS).
 */
export async function docFat(d: VendaDoc): Promise<DocFat> {
  const c = (d.pessoa ?? {}) as Record<string, string | boolean | null>;
  const doc = String(c.doc ?? c.cnpj_cpf ?? d.cnpj ?? "").replace(/\D/g, "");
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    empresa: d.empresa,
    cliente: {
      nome: s(c.razao_social || d.cliente_razao || d.cliente),
      cnpj: doc.length === 14 ? doc : null,
      cpf: doc.length === 11 ? doc : null,
      ie: s(c.inscricao_estadual).replace(/\D/g, "") || null,
      email: s(c.email_nfe || c.email) || null,
      logradouro: s(c.logradouro), numero: s(c.numero) || "S/N", complemento: s(c.complemento) || null,
      bairro: s(c.bairro), municipio: s(c.cidade || d.cidade).replace(/\s*\([A-Z]{2}\)\s*$/, ""),
      codigo_municipio: s(c.cidade_ibge) || null, uf: s(c.uf || d.uf || "SP"),
      cep: s(c.cep).replace(/\D/g, ""), telefone: s(c.telefone) || null,
    },
    itens: d.itens.map((i, k) => ({
      codigo: i.codigo || String(i.ncod_prod ?? "") || `${d.label}-${k + 1}`,
      descricao: i.descricao, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario),
      unidade: i.unidade ?? "UN", ncm: i.ncm ?? null, cfop: i.cfop ?? null,
      servico_lc116: (i.fiscal?.lc116 as string | undefined) ?? null,
      codigo_tributario_municipio: (i.fiscal?.mun as string | undefined) ?? null,
    })),
    // Parcelas pela condição contam a partir da data da nota (dias); as fixadas
    // à mão (sem dias) vão com o vencimento gravado.
    condicao: {
      descricao: d.condicao ?? undefined,
      parcelas: d.parcelas.map((x) => x.dias != null
        ? { dias: x.dias, percentual: x.percentual ?? undefined }
        : { vencimento: x.vencimento, valor: Number(x.valor) }),
    },
    observacoes: [d.obs_nf, d.proposta ? `Proposta ${d.proposta}` : null, d.label].filter(Boolean).join(" · "),
    pedido_cliente: d.num_pedido_cliente,
  };
}
