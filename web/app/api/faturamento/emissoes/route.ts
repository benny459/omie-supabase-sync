import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";

/** GET /api/faturamento/emissoes?origem_tipo=&origem_id=&status=&limite= */
export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const p = req.nextUrl.searchParams;
  let s = supaAdmin().schema("orders").from("fat_emissoes")
    .select("id,empresa,ambiente,tipo,ref,origem_tipo,origem_id,origem_rotulo,cliente,status,focus_status,mensagem,numero,serie,chave,valor_total,xml_path,pdf_path,receber_ids,autorizada_em,cancelada_em,criado_por,created_at")
    .order("id", { ascending: false }).limit(Math.min(Number(p.get("limite") || 100), 500));
  if (p.get("origem_tipo")) s = s.eq("origem_tipo", p.get("origem_tipo")!);
  if (p.get("origem_id")) s = s.eq("origem_id", p.get("origem_id")!);
  if (p.get("status")) s = s.eq("status", p.get("status")!);
  const { data, error } = await s;
  if (error) return falha(error.message, 500);
  return NextResponse.json({ emissoes: data ?? [] });
}
