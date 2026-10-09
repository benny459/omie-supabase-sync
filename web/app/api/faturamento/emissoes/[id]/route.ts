import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { atualizar, buscar, cancelar, cancelarRecibo, situacaoRecibo, urlArquivo } from "@/lib/faturamento/server";
import { supaAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function resposta(id: number) {
  const e = await atualizar(id);
  // Parcelas a receber criadas por esta emissão (painel de transmissão da Nova emissão).
  const receber = e.receber_ids?.length
    ? (await supaAdmin().schema("finance").from("receber")
        .select("id,numero_parcela,vencimento,valor,numero_documento,extras").in("id", e.receber_ids).order("vencimento")).data ?? []
    : [];
  return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path), receber });
}

/** GET — consulta a Focus (se ainda processando) e devolve links assinados. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  try { return await resposta(Number(id)); } catch (e) { return falha(e); }
}

/** POST { acao: "cancelar", justificativa } — homologação (qualquer tipo) ou RECIBO de produção (09/10/26).
 *  POST { acao: "cancelar_previa" } — o que acontece ao cancelar o recibo (recebimento baixado? enviado ao cliente?). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.acao === "cancelar_previa") {
      const s = await situacaoRecibo(Number(id));
      return NextResponse.json({ numero: s.row.numero, valor: Number(s.row.valor_total), origem: s.row.origem_rotulo, status: s.row.status,
        tipo: s.row.tipo, ambiente: s.row.ambiente, tem_baixa: s.tem_baixa, receber: s.receber, envios: s.envios });
    }
    if (body.acao === "cancelar") {
      const row = await buscar(Number(id));
      if (row.tipo === "recibo" && row.ambiente === "producao") {
        const e = await cancelarRecibo(Number(id), String(body.justificativa || ""), q.email);
        await supaAdmin().schema("orders").rpc("vendas_refrescar").then(() => null, () => null);
        return NextResponse.json({ emissao: e });
      }
      const e = await cancelar(Number(id), String(body.justificativa || ""));
      return NextResponse.json({ emissao: e });
    }
    return falha("Ação desconhecida");
  } catch (e) {
    return falha(e);
  }
}
