import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { emitir, urlArquivo, type OrigemTipo, type TipoDoc } from "@/lib/faturamento/server";
import type { DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/faturamento/emitir
 * { documento: {empresa, cliente, itens, condicao, observacoes?, pedido_cliente?},
 *   tipo?: "nfe"|"nfse"|"recibo", origem_tipo?, origem_id?, gerar_receber_homologacao? }
 * Emite em HOMOLOGAÇÃO salvo a empresa ter produção liberada (fat_config).
 */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  let body: {
    documento?: DocFat; tipo?: TipoDoc; origem_tipo?: OrigemTipo; origem_id?: string | null;
    gerar_receber_homologacao?: boolean;
    /** Só admin: força homologação (teste da Nova emissão sem emitir em produção). */
    forcar_homologacao?: boolean;
  };
  try { body = await req.json(); } catch { return falha("JSON inválido"); }
  if (!body.documento) return falha("documento é obrigatório");
  if (body.forcar_homologacao && !q.admin) return falha("Só administradores podem forçar homologação", 403);
  try {
    const e = await emitir(body.documento, {
      tipo: body.tipo, origem_tipo: body.origem_tipo, origem_id: body.origem_id ?? null,
      gerar_receber_homologacao: !!body.gerar_receber_homologacao, criado_por: q.email,
      forcar_homologacao: !!body.forcar_homologacao,
    });
    return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
  } catch (e) {
    return falha(e);
  }
}
