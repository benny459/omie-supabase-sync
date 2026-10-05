import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { prevoo } from "@/lib/faturamento/server";
import { supaAdmin } from "@/lib/supabase-admin";
import type { DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Nova emissão (folha dedicada, 05/10/26).
 *  GET ?op=opcoes&emp=SF              → condições, formas, contas, categorias, projetos, centros, vendedores
 *  GET ?op=historico&emp=SF&doc=CNPJ  → últimos faturamentos do cliente ("usar como modelo")
 *  POST { op: "previa", documento }   → pré-voo (payload + checagens + parcelas), sem enviar nada
 */

/** Formas de recebimento: tipo de documento do título (cadastros › tipos de documento)
 *  + o tPag da NF-e correspondente. */
const FORMAS = [
  { codigo: "BOL", nome: "Boleto", tpag: "15" },
  { codigo: "PIX", nome: "Pix", tpag: "17" },
  { codigo: "TRA", nome: "Transferência", tpag: "18" },
  { codigo: "TED", nome: "TED", tpag: "18" },
  { codigo: "DEP", nome: "Depósito", tpag: "16" },
  { codigo: "CRC", nome: "Cartão de crédito", tpag: "03" },
  { codigo: "CRD", nome: "Cartão de débito", tpag: "04" },
  { codigo: "DIN", nome: "Dinheiro", tpag: "01" },
  { codigo: "CHQ", nome: "Cheque", tpag: "02" },
  { codigo: "DUP", nome: "Duplicata", tpag: "15" },
  { codigo: "REC", nome: "Recibo", tpag: "99" },
  { codigo: "NFS", nome: "Nota Fiscal de Serviço", tpag: "99" },
  { codigo: "99999", nome: "Outros", tpag: "99" },
];

/** Prazos de uma condição: dados.dias, "30/60/90", "Para 28 dias", "A28", "N Parcelas" (30 em 30). */
function diasDe(codigo: string, nome: string, dados: { dias?: number[] } | null): number[] | null {
  if (Array.isArray(dados?.dias) && dados!.dias!.length) return dados!.dias!;
  const n = nome.toLowerCase();
  if (/vista/.test(n) || codigo === "000") return [0];
  const barras = nome.match(/\d+(?:\s*\/\s*\d+)+/);
  if (barras) return barras[0].split("/").map((x) => Number(x.trim()));
  const para = n.match(/(\d+)\s*(dias|ddl|dd)/);
  if (para) return [Number(para[1])];
  const a = codigo.match(/^A(\d+)$/i);
  if (a) return [Number(a[1])];
  const parc = n.match(/^(\d+)\s*parcela/);
  if (parc) return Array.from({ length: Number(parc[1]) }, (_, i) => 30 * (i + 1));
  return null;
}

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  const emp = (sp.get("emp") ?? "SF").toUpperCase();
  const op = sp.get("op") ?? "opcoes";
  const a = supaAdmin();
  try {
    if (op === "historico") {
      const doc = (sp.get("doc") ?? "").replace(/\D/g, "");
      if (doc.length < 11) return NextResponse.json({ historico: [] });
      const { data, error } = await a.schema("orders").rpc("fat_historico_cliente", { p_empresa: emp, p_doc: doc, p_lim: 10 });
      if (error) throw new Error(error.message);
      return NextResponse.json({ historico: data ?? [] });
    }
    // cadastros.* não é exposto no PostgREST: lê pela função orders.cad_aux_opcoes.
    const aux = async (registro: string) => {
      const r = await a.schema("orders").rpc("cad_aux_opcoes", { p_registro: registro, p_empresa: emp });
      return { data: (r.data ?? []) as unknown[], error: r.error };
    };
    const [cond, contas, cats, proj, cc, vend] = await Promise.all([
      aux("condicoes"),
      a.schema("finance").from("contas_correntes").select("cod_cc,descricao,tipo_conta_corrente").eq("empresa", emp).neq("inativo", "S").order("descricao").limit(200),
      a.schema("finance").from("categorias").select("codigo,descricao").eq("empresa", emp).like("codigo", "1.%")
        .neq("conta_inativa", "S").neq("totalizadora", "S").order("codigo").limit(500),
      a.schema("finance").from("projetos").select("codigo,nome").eq("empresa", emp).neq("inativo", "S").order("nome").limit(1000),
      aux("centros_custo"),
      aux("vendedores"),
    ]);
    const err = cond.error ?? contas.error ?? cats.error ?? proj.error ?? cc.error ?? vend.error;
    if (err) throw new Error(err.message);
    type Aux = { codigo: string; nome: string; dados: { dias?: number[] } | null };
    return NextResponse.json({
      condicoes: ((cond.data ?? []) as Aux[]).map((c) => ({ codigo: c.codigo, nome: c.nome, dias: diasDe(c.codigo, c.nome, c.dados) }))
        .sort((x, y) => x.codigo.localeCompare(y.codigo)),
      formas: FORMAS,
      contas: (contas.data ?? []).map((c) => ({ codigo: Number(c.cod_cc), nome: c.descricao, tipo: c.tipo_conta_corrente })),
      categorias: (cats.data ?? []).map((c) => ({ codigo: c.codigo, nome: c.descricao })),
      projetos: (proj.data ?? []).map((p) => ({ codigo: String(p.codigo), nome: p.nome })),
      centros: ((cc.data ?? []) as Aux[]).map((c) => ({ codigo: c.codigo, nome: c.nome })),
      vendedores: ((vend.data ?? []) as Aux[]).map((v) => ({ codigo: v.codigo, nome: v.nome })),
    });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const body = await req.json().catch(() => ({})) as { op?: string; documento?: DocFat };
  if (body.op !== "previa" || !body.documento) return falha("op/documento inválidos");
  try {
    return NextResponse.json(await prevoo(body.documento, {}));
  } catch (e) {
    return falha(e);
  }
}
