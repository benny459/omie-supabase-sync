// /api/compras/antecipado — pagamento antecipado de PC (06/10/26, sql/96).
//   GET  ?ids=1,2,3        → { [pedido_id]: { valor, qtd, pago, titulos[] } } (selo do cartão)
//   GET  ?pedido=<id>      → dados do diálogo: PC, já adiantado, Pix/banco do fornecedor, contas, bancos
//   GET  ?numero=7356&emp=SF → mesmo, achando o PC pelo número (atalho no Contas a Pagar)
//   POST { pedido_id, valor, data, forma: "PIX"|"TED", conta_cod, categoria_cod?, obs?,
//          pix_tipo?, pix_chave?, banco_compe?, agencia?, conta?, conta_tipo?, salvar_cadastro?, forcar? }
//        → cria o título a pagar antecipado ligado ao PC (aparece no Pagar, remessa C6, BI e fluxo);
//          as previsões do PC são abatidas pelo adiantado (não paga duas vezes).
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ord = () => supaAdmin().schema("orders");
const hojeBR = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export async function GET(req: Request) {
  const a = await exigir();
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  const ids = (u.searchParams.get("ids") ?? "").split(",").map(Number).filter((n) => n > 0);
  if (u.searchParams.has("ids") || (!u.searchParams.get("pedido") && !u.searchParams.get("numero"))) {
    const { data, error } = await ord().rpc("compras_antecipados", { p_ids: ids.length ? ids : null });
    return error ? erroDb(error) : NextResponse.json(data ?? {});
  }
  let id = Number(u.searchParams.get("pedido") ?? 0);
  if (!id) {
    const num = String(u.searchParams.get("numero") ?? "").replace(/\D/g, "");
    const emps = u.searchParams.get("emp") ? [u.searchParams.get("emp")!.toUpperCase()] : ["SF", "WW", "CD"];
    for (const emp of emps) {
      const { data } = await ord().rpc("compras_id_por_numero", { p_empresa: emp, p_numero: num, p_tipo: "PC" });
      id = Number(data) || 0;
      if (id) break;
    }
    if (!id) return NextResponse.json({ error: `PC ${num} não encontrado` }, { status: 404 });
  }
  const { data: p, error } = await ord().rpc("compras_pedido", { p_id: id });
  if (error) return erroDb(error);
  const pc = p as { id: number; num: string; tipo: string; emp: string; forn?: string; fornCod?: number; cnpj?: string; valor: number;
    aprov?: string; cat?: string; catCod?: string; conta?: string; contaCod?: number; proj?: string; pv?: string } | null;
  if (!pc || pc.tipo !== "PC") return NextResponse.json({ error: "Pedido de compra não encontrado" }, { status: 404 });
  const [ant, pes, contas, bancos] = await Promise.all([
    ord().rpc("compras_antecipados", { p_ids: [id] }),
    ord().rpc("compras_fornecedor_pessoa", { p_empresa: pc.emp, p_cod: pc.fornCod ?? null, p_cnpj: pc.cnpj ?? null }),
    fin().from("contas_correntes").select("cod_cc, descricao").eq("empresa", pc.emp).order("descricao"),
    fin().from("bancos_ispb").select("compe, nome").order("nome"),
  ]);
  const pessoaId = (pes.data as { id?: number } | null)?.id ?? null;
  const pag = pessoaId ? await fin().rpc("pessoa_pagamento_obter", { p_pessoa_id: pessoaId }) : { data: null };
  const ja = ((ant.data ?? {}) as Record<string, { valor: number; titulos: unknown[] }>)[String(id)];
  return NextResponse.json({
    pedido: { id: pc.id, num: pc.num, emp: pc.emp, forn: pc.forn, fornCod: pc.fornCod, valor: Number(pc.valor) || 0, aprov: pc.aprov,
              cat: pc.cat, catCod: pc.catCod, conta: pc.conta, contaCod: pc.contaCod, proj: pc.proj, pv: pc.pv },
    adiantado: Number(ja?.valor ?? 0), titulos: ja?.titulos ?? [],
    pessoa_id: pessoaId, pagamento: pag.data ?? null,
    contas: contas.data ?? [], bancos: bancos.data ?? [], hoje: hojeBR(),
  });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.editar_titulo");
  if (a instanceof NextResponse) return a;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b?.pedido_id) return NextResponse.json({ error: "pedido_id obrigatório" }, { status: 400 });
  if (!b.conta_cod) return NextResponse.json({ error: "Escolha a conta corrente pagadora" }, { status: 400 });
  const forma = String(b.forma ?? "PIX").toUpperCase();
  if (forma === "PIX" && !String(b.pix_chave ?? "").trim()) return NextResponse.json({ error: "Informe a chave Pix do fornecedor" }, { status: 400 });
  if (forma === "TED" && (!b.banco_compe || !b.agencia || !b.conta)) return NextResponse.json({ error: "Informe banco, agência e conta do fornecedor" }, { status: 400 });
  const { data, error } = await ord().rpc("compras_antecipar", { p: b, p_usuario: a.email });
  if (error) return erroDb(error);
  // Guarda Pix / banco no cadastro do fornecedor (é de lá que a remessa C6 lê).
  if (b.salvar_cadastro !== false && b.pessoa_id) {
    const dados = forma === "PIX"
      ? { pix_tipo: b.pix_tipo ?? null, pix_chave: b.pix_chave ?? null }
      : { banco_compe: b.banco_compe ?? null, agencia: b.agencia ?? null, conta: b.conta ?? null, conta_tipo: b.conta_tipo ?? null };
    await fin().rpc("pessoa_pagamento_salvar", { p_pessoa_id: Number(b.pessoa_id), p: dados, p_usuario: a.email }).then(() => null, () => null);
  }
  return NextResponse.json(data);
}
