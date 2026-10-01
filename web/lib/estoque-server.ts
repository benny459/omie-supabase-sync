import "server-only";
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { supaAdmin } from "@/lib/supabase-admin";

/** Estoque vive na área ERP (mesma guarda de /api/estoque). Devolve a resposta de erro ou null. */
export async function exigirEstoque(): Promise<NextResponse | null> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  return null;
}

/** Service role no schema orders — views orders.v_estoque_* e RPCs orders.estoque_*. */
export const orders = () => supaAdmin().schema("orders");

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
