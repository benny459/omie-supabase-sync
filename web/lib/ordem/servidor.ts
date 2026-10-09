import "server-only";
// Central de Ordem — servidor: quem é a pessoa (camadas existentes), configuração,
// donos, sincronização dos detetores e leitura da fila já filtrada por permissão.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { permissoesDe } from "@/lib/acessos";
import type { ModuleRole } from "@/lib/permissions";
import { CONFIG_VAZIA, diferencas, normalizarConfig, type ConfigOrdem } from "./config";
import { DETETOR_POR_TIPO } from "./catalogo";
import { detectorLigadoPara, filtrarItens, type LinhaItem } from "./fila";
import type { Quem } from "./acesso";
import type { ItemDetectado, ModuloOrdem } from "./tipos";

/** O painel é do tenant WaterWorks (public.tenants.slug). Serviços/CRM gravam com o seu slug. */
export const TENANT = "waterworks";
export const db = () => supaAdmin().schema("ordem");
const plat = () => supaAdmin().schema("platform");

export const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Pessoa da sessão com as camadas de permissão de hoje. 401 sem sessão. */
export async function quemOrdem(): Promise<Quem | NextResponse> {
  const perms = await loadPerms();
  if (!perms?.id) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const [{ data: mr }, { data: prof }, pode] = await Promise.all([
    plat().from("user_module_roles").select("modulo, can_edit_pv, can_edit_rc, can_edit_pc, can_approve, can_edit_log, can_view_values, can_view_margin, can_release_pv, approval_ceiling_brl, weekly_budget_brl").eq("user_id", perms.id),
    plat().from("user_profiles").select("email, nome").eq("id", perms.id).maybeSingle(),
    permissoesDe(perms),
  ]);
  perms.module_roles = (mr ?? []) as ModuleRole[];
  const p = prof as { email?: string; nome?: string } | null;
  return { perms, pode: pode as Record<string, boolean>, uid: perms.id, email: p?.email ?? "", nome: p?.nome || (p?.email ?? "").split("@")[0], admin: !!perms.is_admin };
}

/** Monta Quem para outra pessoa (teste de permissões e mensagens) — mesmas funções. */
export async function quemPorId(uid: string): Promise<Quem | null> {
  const [{ data: prof }, { data: areas }, { data: mr }] = await Promise.all([
    plat().from("user_profiles").select("id, email, nome, role, is_admin, ativo, permissions").eq("id", uid).maybeSingle(),
    plat().from("user_area_access").select("area, can_view").eq("user_id", uid),
    plat().from("user_module_roles").select("modulo, can_edit_pv, can_edit_rc, can_edit_pc, can_approve, can_edit_log, can_view_values, can_view_margin, can_release_pv, approval_ceiling_brl, weekly_budget_brl").eq("user_id", uid),
  ]);
  const r = prof as { id: string; email: string; nome: string | null; role?: string; is_admin?: boolean; ativo?: boolean; permissions?: unknown } | null;
  if (!r || r.ativo === false) return null;
  const perms = {
    id: uid, role: (r.role ?? (r.is_admin ? "admin" : "viewer")) as "admin", is_admin: !!r.is_admin,
    permissions: (r.permissions ?? null) as null, module_roles: (mr ?? []) as ModuleRole[],
    area_access: (areas ?? []) as { area: "operacao"; can_view: boolean }[],
  };
  const pode = await permissoesDe(perms);
  return { perms, pode: pode as Record<string, boolean>, uid, email: r.email, nome: r.nome || r.email.split("@")[0], admin: !!r.is_admin };
}

// ── Configuração ─────────────────────────────────────────────────────────────
export async function lerConfig(tenant = TENANT): Promise<ConfigOrdem> {
  const { data } = await db().from("config").select("dados").eq("tenant_slug", tenant).maybeSingle();
  return normalizarConfig((data as { dados?: unknown } | null)?.dados ?? CONFIG_VAZIA);
}

export async function gravarConfig(novo: ConfigOrdem, q: Quem, tenant = TENANT) {
  const antes = await lerConfig(tenant);
  const depois = normalizarConfig(novo);
  const difs = diferencas(antes, depois);
  if (!difs.length) return { ok: true, mudancas: 0 };
  const { error } = await db().from("config").upsert({ tenant_slug: tenant, dados: depois, atualizado_por: q.uid, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await db().from("config_log").insert(difs.map((d) => ({ tenant_slug: tenant, usuario_id: q.uid, email: q.email, chave: d.chave, antes: d.antes, depois: d.depois })));
  return { ok: true, mudancas: difs.length };
}

// ── Pessoas e donos ──────────────────────────────────────────────────────────
export type Pessoa = { id: string; email: string; nome: string; ativo: boolean };

export async function pessoas(): Promise<Pessoa[]> {
  const { data } = await plat().from("user_profiles").select("id, email, nome, ativo").order("email");
  return ((data ?? []) as { id: string; email: string; nome: string | null; ativo: boolean }[])
    .map((p) => ({ id: p.id, email: p.email, nome: p.nome || p.email.split("@")[0], ativo: p.ativo !== false }));
}

/** "Erick" / "compras@…" / "Cristina Machado" → pessoa (primeiro nome, nome completo ou e-mail). */
export function acharPessoa(ps: Pessoa[], chave: string | null | undefined): Pessoa | null {
  const k = (chave ?? "").trim().toLowerCase();
  if (!k) return null;
  return ps.find((p) => p.ativo && p.email.toLowerCase() === k)
    ?? ps.find((p) => p.ativo && p.nome.toLowerCase() === k)
    ?? ps.find((p) => p.ativo && p.nome.toLowerCase().split(/\s+/)[0] === k)
    ?? null;
}

export type DonoConfig = { tipo: string; papel: string; titular_id: string; substituto_id: string | null; titular_ausente: boolean };

export async function lerDonos(tenant = TENANT): Promise<DonoConfig[]> {
  const { data } = await db().from("dono_config").select("tipo, papel, titular_id, substituto_id, titular_ausente").eq("tenant_slug", tenant);
  return (data ?? []) as DonoConfig[];
}

/** Dono: configuração (titular, ou substituto se ausente) → dono do próprio dado → nome fixo de hoje → sem dono. */
export function resolverDono(it: Pick<ItemDetectado, "tipo" | "dono_email">, donos: Map<string, DonoConfig>, ps: Pessoa[]): string | null {
  const c = donos.get(it.tipo);
  if (c) return c.titular_ausente && c.substituto_id ? c.substituto_id : c.titular_id;
  return acharPessoa(ps, it.dono_email)?.id ?? acharPessoa(ps, DETETOR_POR_TIPO[it.tipo]?.donoPadrao)?.id ?? null;
}

// ── Sincronização (detetores → ordem.item) ───────────────────────────────────
export type Sync = { detetados: number; novos: number; fechados: number; reabertos: number; tipos: string[]; erros: Record<string, string>; ms: number };

export async function sincronizar(opts: { modulos?: ModuloOrdem[] } = {}): Promise<Sync> {
  const t0 = Date.now();
  const cfg = await lerConfig();
  const hoje = hojeSP();
  const quer = (m: ModuloOrdem) => !opts.modulos || opts.modulos.includes(m);
  const { detetarCompras } = await import("./detectores/compras");
  const { detetarFinanceiro } = await import("./detectores/financeiro");
  const { detetarOperacao } = await import("./detectores/operacao");
  const { detetarOutros } = await import("./detectores/outros");
  const res = await Promise.all([
    quer("compras") ? detetarCompras(cfg, hoje) : null,
    quer("financeiro") ? detetarFinanceiro(cfg, hoje) : null,
    quer("operacao") || quer("projetos") ? detetarOperacao(cfg, hoje) : null,
    quer("faturamento") || quer("estoque") || quer("cadastros") ? detetarOutros(cfg, hoje) : null,
  ]);
  const itens = res.flatMap((r) => r?.itens ?? []);
  const tipos = res.flatMap((r) => r?.tipos ?? []);
  const erros = Object.assign({}, ...res.map((r) => r?.erros ?? {}));

  const [ps, donosL] = await Promise.all([pessoas(), lerDonos()]);
  const donos = new Map(donosL.map((d) => [d.tipo, d]));
  const agora = new Date().toISOString();

  // estado atual dos tipos que correram
  const existentes: { id: string; tipo: string; origem_ref: string; estado: string; resolvido_como: string | null; adiado_ate: string | null }[] = [];
  for (let de = 0; tipos.length; de += 1000) {
    const { data, error } = await db().from("item").select("id, tipo, origem_ref, estado, resolvido_como, adiado_ate")
      .eq("tenant_slug", TENANT).in("tipo", tipos).range(de, de + 999);
    if (error) throw new Error(error.message);
    existentes.push(...((data ?? []) as typeof existentes));
    if ((data ?? []).length < 1000) break;
  }
  const porChave = new Map(existentes.map((e) => [`${e.tipo}|${e.origem_ref}`, e]));
  const vistos = new Set<string>();
  const linhas = itens.map((it) => {
    vistos.add(`${it.tipo}|${it.origem_ref}`);
    return {
      tenant_slug: TENANT, tipo: it.tipo, modulo: it.modulo, origem_ref: it.origem_ref,
      dono_id: resolverDono(it, donos, ps), urgencia: it.urgencia, rotulo_urgencia: it.rotulo_urgencia ?? null,
      titulo: it.titulo, resumo: it.resumo ?? null, etapa: it.etapa ?? null, valor: it.valor ?? null, link: it.link ?? null,
      recomendacao: it.recomendacao, dados: { ...(it.dados ?? {}), requer: it.requer ?? [], acao: it.acao ?? null },
      depende_de: it.depende_de ?? null, visto_em: agora,
    };
  });
  let novos = 0;
  for (let i = 0; i < linhas.length; i += 300) {
    const lote = linhas.slice(i, i + 300);
    novos += lote.filter((l) => !porChave.has(`${l.tipo}|${l.origem_ref}`)).length;
    const { error } = await db().from("item").upsert(lote, { onConflict: "tenant_slug,tipo,origem_ref" });
    if (error) throw new Error(error.message);
  }
  // reabrir: voltou a aparecer depois de sair sozinho, ou o adiamento venceu
  const reabrir = existentes.filter((e) => vistos.has(`${e.tipo}|${e.origem_ref}`) &&
    ((e.estado === "feito" && (e.resolvido_como === "detetor" || e.resolvido_como === "acao")) || (e.estado === "adiado" && e.adiado_ate && e.adiado_ate < agora))).map((e) => e.id);
  for (let i = 0; i < reabrir.length; i += 200) {
    await db().from("item").update({ estado: "aberto", resolvido_em: null, resolvido_como: null, adiado_ate: null }).in("id", reabrir.slice(i, i + 200));
  }
  // fechar: o detetor correu sem erro e o item deixou de aparecer → resolvido na origem
  const tiposOk = new Set(tipos.filter((t) => !erros[t]));
  const fechar = existentes.filter((e) => tiposOk.has(e.tipo) && !vistos.has(`${e.tipo}|${e.origem_ref}`) &&
    ["aberto", "adiado", "encaminhado"].includes(e.estado)).map((e) => e.id);
  for (let i = 0; i < fechar.length; i += 200) {
    await db().from("item").update({ estado: "feito", resolvido_em: agora, resolvido_como: "detetor" }).in("id", fechar.slice(i, i + 200));
  }
  if (fechar.length) {
    const { aoResolverOrigem } = await import("./encaminhar");
    await aoResolverOrigem(fechar).catch(() => null);
  }
  return { detetados: itens.length, novos, fechados: fechar.length, reabertos: reabrir.length, tipos, erros, ms: Date.now() - t0 };
}

/** Última sincronização (para "Atualizado há X min" e para sincronizar sozinho se ficou velho). */
export async function ultimaSync(): Promise<string | null> {
  const { data } = await db().from("item").select("visto_em").eq("tenant_slug", TENANT).order("visto_em", { ascending: false }).limit(1).maybeSingle();
  return (data as { visto_em?: string } | null)?.visto_em ?? null;
}

// ── Leitura da fila para uma pessoa ──────────────────────────────────────────
const COLS = "id, tipo, modulo, origem_ref, dono_id, urgencia, rotulo_urgencia, titulo, resumo, etapa, valor, link, recomendacao, dados, depende_de, estado, adiado_ate, degrau, encaminhado_de, encaminhado_por, criado_em, resolvido_em, resolvido_como";

export async function itensAbertos(): Promise<LinhaItem[]> {
  const out: LinhaItem[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db().from("item").select(COLS).eq("tenant_slug", TENANT)
      .in("estado", ["aberto", "adiado", "encaminhado"]).order("criado_em").range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as LinhaItem[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export { detectorLigadoPara, filtrarItens };
