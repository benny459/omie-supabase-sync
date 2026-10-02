import "server-only";
import { orders } from "@/lib/estoque-server";

/**
 * "Mesclar todos" (02/10/26): prévia dos grupos de duplicidade com o principal sugerido.
 * Grupo = componente ligado dos pares ainda não decididos (orders.v_estoque_duplicidade):
 *   escopo "exatas" → só pares de nome igual; "todos" → nome igual + parecidos.
 * Principal sugerido: mais movimentos nos últimos 12 meses → empate: maior valor em estoque
 * (saldo × CMC) → empate: PC mais recente → empate: menor id (o código mais antigo no Omie).
 */
export type EscopoMescla = "exatas" | "todos";
export type MembroPrevia = {
  n_cod_prod: number; codigo: string; codigo_novo: string | null; descricao: string; unidade: string | null;
  saldo: number; cmc: number; valor: number; mov12: number; ult_pc: string | null;
};
export type GrupoPrevia = {
  chave: string; tipo: "exata" | "parecido"; sim_min: number; membros: MembroPrevia[];
  principal: number; motivo: string;
};

type Par = { prod_a: number; prod_b: number; tipo: "exata" | "similar"; sim: number };

export async function previaMescla(empresa: string, escopo: EscopoMescla) {
  const db = orders();
  const pr = await db.from("v_estoque_duplicidade").select("prod_a, prod_b, tipo, sim").eq("empresa", empresa);
  if (pr.error) throw new Error(pr.error.message);
  const pares = ((pr.data ?? []) as Par[])
    .map((p) => ({ ...p, prod_a: Number(p.prod_a), prod_b: Number(p.prod_b), sim: Number(p.sim) }))
    .filter((p) => escopo === "todos" || p.tipo === "exata");

  // componentes ligados (union-find)
  const pai = new Map<number, number>();
  const raiz = (x: number): number => { let r = x; while (pai.get(r) !== r) r = pai.get(r)!; pai.set(x, r); return r; };
  for (const p of pares) for (const x of [p.prod_a, p.prod_b]) if (!pai.has(x)) pai.set(x, x);
  for (const p of pares) { const a = raiz(p.prod_a), b = raiz(p.prod_b); if (a !== b) pai.set(a, b); }
  const comp = new Map<number, number[]>();
  for (const x of pai.keys()) { const r = raiz(x); (comp.get(r) ?? comp.set(r, []).get(r)!).push(x); }
  const ids = [...pai.keys()];
  if (!ids.length) return { grupos: [] as GrupoPrevia[], totais: totais([]) };

  const [it, mv] = await Promise.all([
    db.from("v_estoque_item").select("n_cod_prod, codigo, codigo_novo, descricao, unidade, saldo, cmc, ult_pc, mesclado_em").eq("empresa", empresa).in("n_cod_prod", ids),
    db.rpc("estoque_mov12", { p_empresa: empresa, p_ids: ids }),
  ]);
  if (it.error) throw new Error(it.error.message);
  if (mv.error) throw new Error(mv.error.message);
  const mov = new Map(((mv.data ?? []) as { id_prod: number; n: number }[]).map((r) => [Number(r.id_prod), Number(r.n)]));
  const porId = new Map(((it.data ?? []) as Record<string, unknown>[])
    .filter((r) => r.mesclado_em == null)
    .map((r): [number, MembroPrevia] => {
      const id = Number(r.n_cod_prod), saldo = Number(r.saldo) || 0, cmc = Number(r.cmc) || 0;
      return [id, { n_cod_prod: id, codigo: String(r.codigo), codigo_novo: (r.codigo_novo as string) ?? null, descricao: String(r.descricao ?? ""),
        unidade: (r.unidade as string) ?? null, saldo, cmc, valor: Math.round(saldo * cmc * 100) / 100, mov12: mov.get(id) ?? 0, ult_pc: (r.ult_pc as string) ?? null }];
    }));

  const grupos: GrupoPrevia[] = [];
  for (const [r, membrosIds] of comp) {
    const membros = membrosIds.map((i) => porId.get(i)).filter((m): m is MembroPrevia => !!m);
    if (membros.length < 2) continue;
    const doGrupo = pares.filter((p) => membrosIds.includes(p.prod_a));
    const tipo = doGrupo.every((p) => p.tipo === "exata") ? "exata" : "parecido";
    const ord = [...membros].sort((a, b) => b.mov12 - a.mov12 || b.valor - a.valor
      || String(b.ult_pc ?? "").localeCompare(String(a.ult_pc ?? "")) || a.n_cod_prod - b.n_cod_prod);
    const [p1, p2] = ord;
    const motivo = p1.mov12 !== p2.mov12 ? `mais movimentos em 12 meses (${p1.mov12} × ${p2.mov12})`
      : p1.valor !== p2.valor ? `empate em movimentos (${p1.mov12}) → maior valor em estoque`
      : (p1.ult_pc ?? "") !== (p2.ult_pc ?? "") ? `empate em movimentos e valor → PC mais recente`
      : "empate em tudo → o código mais antigo";
    grupos.push({ chave: `g${r}`, tipo, sim_min: Math.min(...doGrupo.map((p) => (p.tipo === "exata" ? 1 : p.sim))), membros: ord, principal: p1.n_cod_prod, motivo });
  }
  grupos.sort((a, b) => Number(b.tipo === "exata") - Number(a.tipo === "exata")
    || peso(b) - peso(a));
  return { grupos, totais: totais(grupos) };
}

const peso = (g: GrupoPrevia) => g.membros.reduce((s, m) => s + Math.abs(m.valor), 0);

export function totais(grupos: GrupoPrevia[]) {
  const sec = grupos.flatMap((g) => g.membros.filter((m) => m.n_cod_prod !== g.principal));
  return {
    grupos: grupos.length,
    exatas: grupos.filter((g) => g.tipo === "exata").length,
    parecidos: grupos.filter((g) => g.tipo === "parecido").length,
    codigos_que_saem: sec.length,
    grupos_grandes: grupos.filter((g) => g.membros.length > 3).length,
    valor_transferido: Math.round(sec.reduce((s, m) => s + m.valor, 0) * 100) / 100,
    com_saldo: sec.filter((m) => m.saldo !== 0).length,
  };
}
