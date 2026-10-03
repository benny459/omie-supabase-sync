import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { canViewArea, type UserPerms } from "@/lib/permissions";
import { CATALOGO, type Chave } from "@/lib/acessos-catalogo";

// Permissões finas efetivas de uma pessoa (03/10/26).
// Três estados por chave: sem linha em platform.permissoes_usuario = padrão
// (o que a pessoa já podia fazer até hoje); linha = escolha do administrador.
// Admin (user_profiles.is_admin) pode tudo. Toda chave exige a área ERP.

export type Efetiva = { valor: boolean; explicito: boolean; padrao: boolean };
export type Efetivas = Record<Chave, Efetiva>;

export async function permissoesEfetivas(perms: UserPerms | null | undefined): Promise<Efetivas> {
  const out = {} as Efetivas;
  const uid = perms?.id;
  const erp = canViewArea(perms, "erp");
  let explicitas = new Map<string, boolean>();
  let aprovador = false;
  if (uid && !perms?.is_admin) {
    const db = supaAdmin().schema("platform");
    const [pu, mr] = await Promise.all([
      db.from("permissoes_usuario").select("chave, concedida").eq("user_id", uid),
      db.from("user_module_roles").select("can_approve").eq("user_id", uid).eq("modulo", "pcs").maybeSingle(),
    ]);
    explicitas = new Map(((pu.data ?? []) as { chave: string; concedida: boolean }[]).map((r) => [r.chave, r.concedida]));
    aprovador = !!(mr.data as { can_approve?: boolean } | null)?.can_approve;
  }
  for (const c of CATALOGO) {
    if (perms?.is_admin) { out[c.chave] = { valor: true, explicito: false, padrao: true }; continue; }
    const padrao = erp && (c.padrao === "erp" || (c.padrao === "aprovador" && aprovador));
    const ex = explicitas.get(c.chave);
    out[c.chave] = { valor: erp && (ex ?? padrao), explicito: ex !== undefined, padrao };
  }
  return out;
}

/** Só os booleanos — formato usado pelas rotas e enviado à UI. */
export async function permissoesDe(perms: UserPerms | null | undefined): Promise<Record<Chave, boolean>> {
  const e = await permissoesEfetivas(perms);
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.valor])) as Record<Chave, boolean>;
}

/** Zera campos de valor (R$) num objeto/array, recursivamente — usado quando a pessoa não pode ver valores. */
export function semValores<T>(dado: T, campos: RegExp): T {
  const vis = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(vis);
    if (x && typeof x === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        o[k] = campos.test(k) && (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) ? null : vis(v);
      }
      return o;
    }
    return x;
  };
  return vis(dado) as T;
}
