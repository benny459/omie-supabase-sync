// GET /api/rc-projetos/modelo?emp=SF → modelo Excel da lista de materiais (08/10/26, spec D.2).
//
//   aba "Lista":   Código · Item · Qtd · Un · Necessário em · Valor unit. · Grupo — para
//                  preencher e colar no "+ Adicionar itens › Colar do Excel" (com o cabeçalho).
//   aba "Códigos": os itens do NOSSO estoque (código novo, ativos, não mesclados) com
//                  descrição, unidade, fornecedor habitual, último preço e prazo médio —
//                  para montar a lista com PROCV e colar.
// Só leitura.

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { deHtml } from "@/lib/match-pc";

export const runtime = "nodejs";
export const maxDuration = 60;

type Est = { n_cod_prod: number; codigo_novo: string; descricao: string; unidade: string | null; ult_preco: number | null; ativo: boolean | null };
type Mv = { ncod_prod: number; fornecedor: string | null; ultimo_preco: number | null; ultima_compra: string | null; entrega_dias: number | null };

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const emp = (new URL(req.url).searchParams.get("emp") || "SF").toUpperCase().slice(0, 4);
  const orders = supaAdmin().schema("orders");

  const itens: Est[] = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await orders.from("v_estoque_item")
      .select("n_cod_prod, codigo_novo, descricao, unidade, ult_preco, ativo")
      .eq("empresa", emp).not("codigo_novo", "is", null).is("mesclado_em", null)
      .order("codigo_novo").range(ini, ini + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const lote = (data ?? []) as Est[];
    itens.push(...lote.filter((r) => r.ativo !== false));
    if (lote.length < 1000) break;
  }
  // fornecedor habitual, último preço e prazo médio (pedido → NF) por produto
  const compra = new Map<number, Mv>();
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await orders.from("mv_catalogo_compra")
      .select("ncod_prod, fornecedor, ultimo_preco, ultima_compra, entrega_dias")
      .eq("empresa", emp).order("ncod_prod").range(ini, ini + 999);
    if (error) break; // sem o histórico, o modelo sai só com o cadastro
    const lote = (data ?? []) as Mv[];
    for (const m of lote) {
      const a = compra.get(Number(m.ncod_prod));
      if (!a || String(m.ultima_compra ?? "") > String(a.ultima_compra ?? "")) compra.set(Number(m.ncod_prod), m);
    }
    if (lote.length < 1000) break;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Painel WaterWorks";
  const lista = wb.addWorksheet("Lista", { views: [{ state: "frozen", ySplit: 1 }] });
  lista.columns = [
    { header: "Código", key: "cod", width: 12 }, { header: "Item", key: "item", width: 48 }, { header: "Qtd", key: "qtd", width: 8 },
    { header: "Un", key: "un", width: 6 }, { header: "Necessário em", key: "nec", width: 14 }, { header: "Valor unit.", key: "vu", width: 12 },
    { header: "Grupo", key: "grp", width: 18 },
  ];
  lista.getRow(1).font = { bold: true };
  lista.addRow({ cod: itens[0]?.codigo_novo ?? "", item: "(exemplo — apague) com PROCV na aba Códigos: =PROCV(A2;Códigos!A:B;2;0)", qtd: 1, un: itens[0]?.unidade ?? "UN", nec: "30/10/2026", vu: "", grp: "Abrandador" });
  lista.getColumn("nec").numFmt = "@";

  const cods = wb.addWorksheet("Códigos", { views: [{ state: "frozen", ySplit: 1 }] });
  cods.columns = [
    { header: "Código", key: "cod", width: 12 }, { header: "Descrição", key: "desc", width: 56 }, { header: "Un", key: "un", width: 6 },
    { header: "Fornecedor habitual", key: "forn", width: 36 }, { header: "Último preço", key: "preco", width: 13 },
    { header: "Prazo médio (dias)", key: "prazo", width: 12 },
  ];
  cods.getRow(1).font = { bold: true };
  for (const i of itens) {
    const m = compra.get(Number(i.n_cod_prod));
    cods.addRow({ cod: i.codigo_novo, desc: deHtml(i.descricao ?? ""), un: i.unidade ?? "", forn: m?.fornecedor ? deHtml(m.fornecedor) : "",
      preco: m?.ultimo_preco ?? i.ult_preco ?? null, prazo: m?.entrega_dias ?? null });
  }
  cods.getColumn("preco").numFmt = "#,##0.00";
  cods.autoFilter = { from: "A1", to: "F1" };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="lista-materiais-modelo-${emp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
