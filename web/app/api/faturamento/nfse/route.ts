import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { lista, prefill, registrar } from "@/lib/faturamento/nfse-manual";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* NFS-e emitida na prefeitura — controle no painel (sql/59).
   GET ?empresa=SF                 → registros (registradas e canceladas)
   GET ?empresa=SF&prefill=k1,k2   → dados das OS para pré-preencher o form
   POST multipart (dados=JSON, pdf, xml) → registra */

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const pf = req.nextUrl.searchParams.get("prefill");
  try {
    if (pf) {
      const chaves = pf.split(",").map((s) => s.trim()).filter((s) => /^(os_omie|venda):[\w-]+$/.test(s)).slice(0, 30);
      return NextResponse.json(await prefill(empresa, chaves));
    }
    return NextResponse.json({ registros: await lista(empresa) });
  } catch (e) {
    return falha(e, 500);
  }
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  try {
    const form = await req.formData();
    const dados = JSON.parse(String(form.get("dados") ?? "{}")) as Record<string, unknown>;
    const arq = (k: string) => { const f = form.get(k); return f instanceof File && f.size > 0 ? f : null; };
    const r = await registrar(dados, arq("pdf"), arq("xml"), q.email);
    return NextResponse.json({ registro: r });
  } catch (e) {
    return falha(e);
  }
}
