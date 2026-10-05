import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { documentoPvOmie, emitir, emitirPvOmie, prevoo, urlArquivo } from "@/lib/faturamento/server";
import { docFat, documento } from "@/lib/vendas-server";
import type { DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Carteira de faturamento PV & OS (05/10/2026) — a tela /faturamento no
   conceito "PV → NF-e · OS → NFS-e". GET devolve os documentos (Omie e
   nativos) a faturar ou faturados no período; POST age sobre UM documento
   pela chave ("pv_omie:<codigo>" | "venda:<id>"):
     doc     → itens e cliente montados (só banco, nada sai);
     prevoo  → checagens completas sem enviar;
     ensaio  → mesma nota na HOMOLOGAÇÃO (só PV do Omie);
     emitir  → emissão no ambiente da empresa (produção só com a chave do Benny).
   OS do Omie não emitem por aqui (NFS-e pelo painel ainda não existe). */

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const desde = req.nextUrl.searchParams.get("desde");
  // Com texto de busca, a carteira procura em todos os períodos (sql/72).
  const busca = (req.nextUrl.searchParams.get("busca") ?? "").trim().slice(0, 80) || null;
  const { data, error } = await supaAdmin().schema("orders")
    .rpc("fat_carteira", { p_empresa: empresa, p_desde: desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : null, p_busca: busca });
  if (error) return falha(error.message, 500);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { chave?: string; acao?: string; empresa?: string; documento?: DocFat | null };
  const [tipo, idTxt] = String(b.chave ?? "").split(":");
  const id = Number(idTxt);
  const empresa = b.empresa || "SF";
  if (!Number.isFinite(id) || id <= 0) return falha("chave inválida");
  try {
    if (tipo === "pv_omie") {
      if (b.acao === "doc") {
        const { bruto, doc } = await documentoPvOmie(empresa, id);
        return NextResponse.json({ documento: doc, condicao: bruto.condicao, parcelas_dias: bruto.parcelas_dias });
      }
      if (b.acao === "prevoo") {
        const { bruto, doc } = await documentoPvOmie(empresa, id);
        const pre = await prevoo(doc, { nf_omie: bruto.nf_omie, emissao_painel: bruto.emissao_painel, etapa: String(bruto.pv.etapa ?? ""), total_pv: Number(bruto.pv.valor_total) });
        return NextResponse.json({ documento: doc, ...pre });
      }
      if (b.acao === "ensaio" || b.acao === "emitir") {
        const e = await emitirPvOmie(empresa, id, { ensaio: b.acao === "ensaio", criado_por: q.email, documento: b.documento ?? null });
        return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
      }
    }
    if (tipo === "venda") {
      const d = await documento(id);
      const doc = docFat(d);
      if (b.acao === "doc") return NextResponse.json({ documento: doc });
      if (b.acao === "prevoo") {
        const pre = await prevoo(doc, { total_pv: Number(d.valor_total) });
        return NextResponse.json({ documento: doc, ...pre });
      }
      if (b.acao === "emitir") {
        if (d.status !== "aberto") return falha(`${d.label} não está em aberto (${d.status})`);
        const final = b.documento ? { ...b.documento, empresa: doc.empresa, rotulo: doc.rotulo } : doc;
        const e = await emitir(final, {
          tipo: d.tipo === "PV" ? "nfe" : undefined, origem_tipo: d.tipo === "OS" ? "os" : "pv",
          origem_id: String(id), origem_rotulo: d.label, criado_por: q.email,
        });
        return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
      }
      if (b.acao === "ensaio") return falha("Ensaio só existe para PV do Omie — use Validar");
    }
    if (tipo === "os_omie") return falha("OS do Omie: emissão de NFS-e pelo painel ainda não disponível — fature no Omie");
    return falha("ação inválida");
  } catch (e) {
    return falha(e);
  }
}
