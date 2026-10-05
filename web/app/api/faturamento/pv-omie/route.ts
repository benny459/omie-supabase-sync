import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { documentoPvOmie, emitirPvOmie, prevoo, urlArquivo } from "@/lib/faturamento/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?empresa=SF — PVs do Omie em aberto (10/20/50) ainda sem NF. */
export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const { data, error } = await supaAdmin().schema("orders").from("v_fat_pv_omie_abertos")
    .select("*").eq("empresa", empresa).order("numero_pedido", { ascending: false }).limit(300);
  if (error) return falha(error.message, 500);
  return NextResponse.json({ pvs: data ?? [] });
}

/**
 * POST { empresa, codigo, acao }
 *  - "prevoo": monta o payload exato e checa tudo, sem chamar a Focus;
 *  - "ensaio": envia o mesmo payload à HOMOLOGAÇÃO (destinatário = a própria
 *    empresa, e-mail interno) — sem valor fiscal, nada chega ao cliente;
 *  - "emitir": emissão de verdade no ambiente da empresa (produção só com a
 *    chave do Benny ligada e o Omie desligado).
 */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo?: number | string; acao?: string };
  const empresa = b.empresa || "SF";
  const codigo = Number(b.codigo);
  if (!Number.isFinite(codigo) || codigo <= 0) return falha("codigo do PV inválido");
  try {
    if (b.acao === "prevoo") {
      const { bruto, doc } = await documentoPvOmie(empresa, codigo);
      const pre = await prevoo(doc, { nf_omie: bruto.nf_omie, emissao_painel: bruto.emissao_painel, etapa: String(bruto.pv.etapa ?? ""), total_pv: Number(bruto.pv.valor_total) });
      return NextResponse.json({ documento: doc, ...pre });
    }
    if (b.acao === "ensaio" || b.acao === "emitir") {
      const e = await emitirPvOmie(empresa, codigo, { ensaio: b.acao === "ensaio", criado_por: q.email });
      return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
    }
    return falha("acao deve ser prevoo, ensaio ou emitir");
  } catch (e) {
    return falha(e);
  }
}
