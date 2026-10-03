// GET /api/compras/buscar?tipo=fornecedor|produto|venda|rc|preco&q=
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, valoresSePuder } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { buscarCatalogo, type ItemCatalogo } from "@/lib/catalogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Histórico de códigos (02/10/26): o item escolhido num PC/RC novo leva o código
   de HOJE (família nova / item que absorveu o mesclado), e a busca acha também
   por qualquer código antigo. Resolvedor do Estoque: orders.item_codigo_resolver. */
type Resolvido = { codigo_usado: string; origem: string; n_cod_prod_usado: number; n_cod_prod_atual: number;
  codigo_atual: string | null; codigo_omie_atual: string | null; descricao_atual: string | null };
async function produtosComCodigoAtual(q: string) {
  const base = await buscarCatalogo(q, 12);
  const codes = [q, ...base.map((b) => b.codigo ?? "").filter(Boolean), ...base.map((b) => String(b.ncod_prod))];
  const { data } = await supaAdmin().schema("orders").rpc("item_codigo_resolver", { p_empresa: "SF", p_codigos: codes });
  const linhas = ((data ?? []) as Resolvido[]).filter((l) => l.origem !== "fornecedor");
  const porId = new Map(linhas.map((l) => [l.n_cod_prod_usado, l]));
  const out: (ItemCatalogo & { codigo_omie?: string | null; via?: string })[] = [];
  const vistos = new Set<number>();
  // quem buscou por um código antigo/mesclado: o item de hoje vem primeiro
  for (const l of linhas.filter((x) => x.codigo_usado.toUpperCase() === q.toUpperCase())) {
    if (vistos.has(l.n_cod_prod_atual)) continue;
    const b = base.find((x) => x.ncod_prod === l.n_cod_prod_atual || x.ncod_prod === l.n_cod_prod_usado);
    out.push({ ...(b ?? { ultimo_preco: null, ultima_compra: null, fornecedor: null, qtd_compras: null, entrega_dias: null, entrega_fonte: null, fat_dias: null, unidade: null }),
      ncod_prod: l.n_cod_prod_atual, codigo: l.codigo_atual, descricao: l.descricao_atual ?? b?.descricao ?? q,
      codigo_omie: l.codigo_omie_atual, via: l.codigo_usado.toUpperCase() !== String(l.codigo_atual ?? "").toUpperCase() ? `código antigo ${l.codigo_usado}` : undefined });
    vistos.add(l.n_cod_prod_atual);
  }
  for (const b of base) {
    const l = porId.get(b.ncod_prod);
    const id = l?.n_cod_prod_atual ?? b.ncod_prod;
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.push(l ? { ...b, ncod_prod: id, codigo: l.codigo_atual ?? b.codigo, descricao: l.descricao_atual ?? b.descricao,
                   codigo_omie: b.codigo, via: id !== b.ncod_prod ? `mesclado de ${b.codigo}` : undefined }
               : b);
  }
  return out.slice(0, 12);
}

export async function GET(req: Request) {
  const qq = await exigirCompras();
  if (qq instanceof NextResponse) return qq;
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo"), q = (sp.get("q") ?? "").trim(), emp = (sp.get("emp") ?? "SF").toUpperCase();
  try {
    if (tipo === "fornecedor") return NextResponse.json(await rpc("compras_buscar_fornecedores", { p_q: q, p_lim: 12, p_empresa: emp }));
    if (tipo === "rc") return NextResponse.json(await rpc("compras_rcs_abertas", { p_q: q || null }));
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
