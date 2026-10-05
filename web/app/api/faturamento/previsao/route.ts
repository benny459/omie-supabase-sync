import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";

/* Previsão de faturamento corrigida no painel (sql/72). Vence a previsão do
   Omie / do documento; data vazia volta à original. Nada vai ao Omie. */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { chave?: string; data?: string | null };
  const chave = String(b.chave ?? "");
  if (!/^(pv_omie|os_omie|venda):[0-9A-Za-z_-]+$/.test(chave)) return falha("chave inválida");
  const data = b.data ? String(b.data) : null;
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return falha("data inválida");
  const { data: r, error } = await supaAdmin().schema("orders")
    .rpc("fat_previsao_definir", { p_chave: chave, p_data: data, p_por: q.email ?? null });
  if (error) return falha(error.message, 500);
  return NextResponse.json(r);
}
