// GET /api/estoque/busca?q=          → PCs (nº começando por q) e clientes (nome contém q) para o ⌘K.
// GET /api/estoque/busca?cliente=NOME → ids dos produtos que saíram para esse cliente (últimos 12 meses).
// Itens (código/descrição) a tela busca na lista que já tem em memória — fica instantâneo.

import { NextResponse } from "next/server";
import { exigirEstoque, orders, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";

const umAno = () => {
  const d = new Date(Date.now() - 365 * 864e5);
  return d.toISOString().slice(0, 10);
};

type Saida = { id_prod: number; cliente: string | null };

export async function GET(req: Request) {
  const negado = await exigirEstoque();
  if (negado) return negado;
  const url = new URL(req.url);
  const cliente = url.searchParams.get("cliente");
  const q = (url.searchParams.get("q") ?? "").trim();
  const db = orders();
  try {
    if (cliente) {
      const rows = await todas<Saida>((de, ate) => db.from("v_estoque_mov_cli").select("id_prod, cliente")
        .eq("tipo", "saida").eq("cancelado", false).eq("cliente", cliente).gte("dt_mov", umAno()).range(de, ate));
      return NextResponse.json({ cliente, ids: [...new Set(rows.map((r) => Number(r.id_prod)))] });
    }
    if (q.length < 3) return NextResponse.json({ pcs: [], clientes: [] });

    const soDigitos = /^\d+$/.test(q);
    const [pcsRes, cliRows] = await Promise.all([
      soDigitos ? db.rpc("estoque_busca_pcs", { p_q: q }) : Promise.resolve({ data: [], error: null }),
      todas<Saida>((de, ate) => db.from("v_estoque_mov_cli").select("id_prod, cliente")
        .eq("tipo", "saida").eq("cancelado", false).not("cliente", "is", null)
        .ilike("cliente", `%${q.replace(/[%_,()]/g, " ")}%`).gte("dt_mov", umAno()).range(de, ate), 5000),
    ]);
    if (pcsRes.error) throw new Error(pcsRes.error.message);

    const porCli = new Map<string, Set<number>>();
    for (const r of cliRows) {
      if (!r.cliente) continue;
      (porCli.get(r.cliente) ?? porCli.set(r.cliente, new Set()).get(r.cliente)!).add(Number(r.id_prod));
    }
    const clientes = [...porCli.entries()].map(([nome, s]) => ({ nome, itens: s.size }))
      .sort((a, b) => b.itens - a.itens).slice(0, 5);
    const pcs = ((pcsRes.data ?? []) as { itens: unknown[] }[]).filter((p) => p.itens.length > 0).slice(0, 4);
    return NextResponse.json({ pcs, clientes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
