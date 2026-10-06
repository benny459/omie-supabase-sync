// GET /api/compras/buscar?tipo=fornecedor|produto|venda|rc|rcresumo|preco&q=
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, valoresSePuder } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { produtosComCodigoAtual } from "@/lib/catalogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const qq = await exigirCompras();
  if (qq instanceof NextResponse) return qq;
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo"), q = (sp.get("q") ?? "").trim(), emp = (sp.get("emp") ?? "SF").toUpperCase();
  try {
    if (tipo === "fornecedor") return NextResponse.json(await rpc("compras_buscar_fornecedores", { p_q: q, p_lim: 12, p_empresa: emp }));
    if (tipo === "rc") return NextResponse.json(await rpc("compras_rcs_abertas", { p_q: q || null }));
    // PC × máximo da RC (06/10/26): itens das RCs (q = "7346,7350") com o que os
    // OUTROS pedidos já compraram (excluir = id do pedido aberto na folha).
    if (tipo === "rcresumo") {
      const nums = q.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
      const exc = Number(sp.get("excluir")) || null;
      return NextResponse.json(valoresSePuder(qq, nums.length ? await rpc("compras_rc_resumo", { p_emp: emp, p_nums: nums, p_excluir: exc }) : []));
    }
    if (tipo === "preco") return NextResponse.json(valoresSePuder(qq, q ? await rpc("compras_historico_preco", { p_cod: q, p_lim: 25 }) : []));
    if (tipo === "produto") return NextResponse.json(q.length < 2 ? [] : await produtosComCodigoAtual(q));
    if (tipo === "venda") {
      let s = supaAdmin().schema("sales").from("v_erp_vendas")
        .select("label, cliente, projeto, emissao").eq("empresa", emp).not("label", "is", null)
        .order("emissao", { ascending: false }).limit(12);
      if (q) s = s.or(`label.ilike.%${q.replace(/[,()%]/g, " ")}%,cliente.ilike.%${q.replace(/[,()%]/g, " ")}%`);
      const { data, error } = await s;
      if (error) throw new Error(error.message);
      return NextResponse.json(data ?? []);
    }
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  } catch (e) { return erro(e); }
}
