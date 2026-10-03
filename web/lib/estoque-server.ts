import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";
import { permissoesDe, semValores } from "@/lib/acessos";
import type { Chave } from "@/lib/acessos-catalogo";

export type QuemEstoque = { id: string; email: string; admin: boolean; pode: Record<Chave, boolean> };

/** Estoque vive na área ERP (mesma guarda de /api/estoque). Devolve a resposta de erro ou null. */
export async function exigirEstoque(): Promise<NextResponse | null> {
  const q = await quemEstoque();
  return q instanceof NextResponse ? q : null;
}

/** Quem está pedindo (id, e-mail, admin). Admin = platform.user_profiles.is_admin (Benny). */
export async function quemEstoque(): Promise<QuemEstoque | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const pode = await permissoesDe(perms);
  if (!pode["estoque.acesso"]) return NextResponse.json({ error: "Sem acesso ao Estoque" }, { status: 403 });
  const { data: { user } } = await (await supaServer()).auth.getUser();
  return { id: perms.id ?? user?.id ?? "", email: user?.email ?? "", admin: !!perms.is_admin, pode };
}

/** Exige uma permissão fina do Estoque (Usuários e acessos). Sem chave = só administrador. */
export async function exigirAdminEstoque(chave?: Chave): Promise<QuemEstoque | NextResponse> {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  if (chave ? !q.pode[chave] : !q.admin) return NextResponse.json({ error: "Sem permissão para isso — peça ao administrador em Usuários e acessos" }, { status: 403 });
  return q;
}

/** Custos (CMC, valor em estoque, preços) zerados para quem não pode ver custos. */
const CAMPOS_CUSTO = /^(cmc|cmc_.*|valor|valor_.*|valor_estoque|custo|custo_.*|preco|preco_.*|ultimo_preco|ult_preco|vu|nval_unit|min|max|media|avg|valor_unit|vlr.*)$/i;
export function custosSePuder<T>(q: QuemEstoque, dado: T): T {
  return q.pode["estoque.ver_custos"] ? dado : semValores(dado, CAMPOS_CUSTO);
}

/** Service role no schema orders — views orders.v_estoque_* e RPCs orders.estoque_*. */
export const orders = () => supaAdmin().schema("orders");
/** Service role no schema platform — janelas, ajustes e decisões (RLS sem policy: só aqui). */
export const platform = () => supaAdmin().schema("platform");

/** Mensagem limpa de um erro do Postgres levantado por RAISE EXCEPTION. */
export const msgErro = (e: { message?: string } | null | undefined) => (e?.message ?? "Erro").replace(/^.*?ERROR:\s*/, "");

// ── Senha da janela de inventário ────────────────────────────────────────────
// 6 caracteres sem ambíguos (sem 0/O, 1/I/L): 31^6 ≈ 887 milhões. Guardamos só sha256(sal:senha).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function gerarCodigo(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}
export const normCodigo = (c: string) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const novoSal = () => randomBytes(16).toString("hex");
export const hashCodigo = (sal: string, codigo: string) => createHash("sha256").update(`${sal}:${normCodigo(codigo)}`).digest("hex");
const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type Janela = {
  id: number; nome: string; escopo: Record<string, string>; valida_ate: string; revogada_em: string | null;
  created_by_email: string | null; created_at: string;
};

/**
 * Confere a senha contra as janelas ATIVAS (não revogadas, não expiradas). Limite de 8 erros em
 * 15 minutos por usuário. Registra cada tentativa. Devolve a janela ou uma resposta de erro.
 */
export async function validarCodigo(codigo: string, userId: string): Promise<Janela | NextResponse> {
  const db = platform();
  const desde = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from("estoque_janela_tentativa").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("ok", false).gte("created_at", desde);
  if ((count ?? 0) >= 8) return NextResponse.json({ error: "Muitas tentativas erradas. Aguarde 15 minutos." }, { status: 429 });

  const cod = normCodigo(codigo);
  const { data, error } = await db.from("estoque_janela").select("*").is("revogada_em", null).gt("valida_ate", new Date().toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const achada = cod.length === 6
    ? ((data ?? []) as (Janela & { codigo_salt: string; codigo_hash: string })[]).find((j) => igual(hashCodigo(j.codigo_salt, cod), j.codigo_hash))
    : undefined;
  await db.from("estoque_janela_tentativa").insert({ user_id: userId || null, ok: !!achada, janela_id: achada?.id ?? null });
  if (!achada) return NextResponse.json({ error: "Senha de inventário inválida ou expirada. Peça a senha ao Benny." }, { status: 403 });
  const { codigo_salt: _s, codigo_hash: _h, ...janela } = achada;
  return janela;
}

/** Páginas de 1000 em paralelo (a view agrega tudo a cada chamada: em série o custo soma).
 *  Pede `paginas` de uma vez; se a última vier cheia, continua em série. */
export async function todasParalelo<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, paginas = 4): Promise<T[]> {
  const res = await Promise.all(Array.from({ length: paginas }, (_, i) => q(i * 1000, i * 1000 + 999)));
  const out: T[] = [];
  for (const r of res) { if (r.error) throw new Error(r.error.message); out.push(...(r.data ?? [])); }
  if ((res[paginas - 1].data ?? []).length === 1000) out.push(...await todas((de, ate) => q(de + paginas * 1000, ate + paginas * 1000)));
  return out;
}

/** PostgREST devolve no máx. 1000 linhas por chamada: pagina até acabar. */
export async function todas<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 30_000): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < max; de += 1000) {
    const { data, error } = await q(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
