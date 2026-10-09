import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";

/* Tipo da venda (Mix / Mercantil / Serviços) do PV/OS da carteira — 09/10/26, sql/158.
   GET  ?empresa=SF&chave=pv_omie:123     → tipo atual, opções válidas, OS do app de Serviços e histórico
   POST { empresa, chave, tipo, motivo, os_decisao?, simular? }
        simular=true → o que vai mudar (nada é gravado); sem simular → troca, com histórico (quem/quando/de→para).
   Grava no NOSSO banco (vendas.documentos / espelho sales.*); nunca no Omie. */

const SEM_SQL = "A troca do tipo da venda depende da atualização do banco sql/158 (ainda não aplicada). O tipo continua como está.";
const faltaFuncao = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|does not exist/i.test(e.message ?? ""));

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  const chave = sp.get("chave") ?? "";
  if (!/^(venda|pv_omie|os_omie):\d+$/.test(chave)) return falha("chave inválida");
  const { data, error } = await supaAdmin().schema("orders").rpc("fat_tipo_venda", { p_empresa: empresa, p_chave: chave });
  if (faltaFuncao(error)) return NextResponse.json({ disponivel: false, sem_sql: true, motivo: SEM_SQL });
  if (error) return falha(error.message);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; chave?: string; tipo?: string; motivo?: string; os_decisao?: string | null; simular?: boolean };
  const chave = String(b.chave ?? "");
  if (!/^(venda|pv_omie|os_omie):\d+$/.test(chave)) return falha("chave inválida");
  const { data, error } = await supaAdmin().schema("orders").rpc("fat_tipo_venda_trocar", {
    p_empresa: String(b.empresa ?? "SF").toUpperCase(), p_chave: chave, p_tipo: String(b.tipo ?? ""),
    p_motivo: String(b.motivo ?? ""), p_os_decisao: b.os_decisao ?? null, p_por: q.email, p_simular: !!b.simular,
  });
  if (faltaFuncao(error)) return NextResponse.json({ error: SEM_SQL, sem_sql: true }, { status: 409 });
  // Saindo de Mix/Serviços com OS já gerada no app de Serviços: a tela pergunta o que fazer (P0T01).
  if (error?.code === "P0T01") {
    let os: unknown = null;
    try { os = JSON.parse(error.details ?? "null"); } catch { /* sem detalhe */ }
    return NextResponse.json({ error: error.message, precisa_decisao_os: true, os }, { status: 409 });
  }
  if (error) return falha(error.message);
  return NextResponse.json(data);
}
