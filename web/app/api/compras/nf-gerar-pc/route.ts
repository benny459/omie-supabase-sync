// /api/compras/nf-gerar-pc — "Gerar pedido a partir da NF" (NF sem pedido).
//   GET  ?chave=  prévia: fornecedor, itens (casados com o catálogo quando dá),
//                 totais, parcelas e a categoria padrão (último PC do fornecedor)
//   POST {chave, catCod, cat, projCod?, proj?}  cria o PC PENDENTE, já casado
//                 com a NF. Aprovado → Faturado; cancelado/não aprovado → a NF
//                 volta para "NF sem pedido" (trigger compras.tg_pc_da_nf).
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, posGravar } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const chave = new URL(req.url).searchParams.get("chave") ?? "";
  if (!/^\d{44}$/.test(chave)) return NextResponse.json({ error: "chave inválida" }, { status: 400 });
  try { return NextResponse.json(await rpc("compras_pc_da_nf_previa", { p_chave: chave })); }
  catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({})) as { chave?: string; catCod?: string; cat?: string; projCod?: string | number | null; proj?: string | null };
  if (!/^\d{44}$/.test(String(b.chave ?? ""))) return NextResponse.json({ error: "chave inválida" }, { status: 400 });
  if (!b.catCod) return NextResponse.json({ error: "Escolha a categoria do pedido" }, { status: 400 });
  try {
    const r = await rpc<{ id: number; num: string; itens: number; casados: number }>("compras_gerar_pc_da_nf", {
      p_chave: b.chave, p_cat_cod: b.catCod, p_cat: b.cat ?? null,
      p_proj_cod: b.projCod != null && b.projCod !== "" ? String(b.projCod) : null, p_proj: b.proj ?? null,
      p_por: q.email, p_uid: q.uid,
    });
    await posGravar(r.id, "PC");
    return NextResponse.json(r);
  } catch (e) { return erro(e); }
}
