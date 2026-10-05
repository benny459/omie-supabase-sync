import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Contas a receber de cada PV/OS da carteira (sql/72 orders.fat_receber_resumo):
   próxima parcela, vencidas, recebido e as parcelas. A tela pede em lotes,
   depois de mostrar a lista. */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; labels?: string[] };
  const labels = (b.labels ?? []).filter((l) => /^(PV|OS)\d+$/i.test(l)).slice(0, 600);
  if (!labels.length) return NextResponse.json({});
  const { data, error } = await supaAdmin().schema("orders")
    .rpc("fat_receber_resumo", { p_empresa: b.empresa || "SF", p_labels: labels });
  if (error) return falha(error.message, 500);
  return NextResponse.json(data ?? {});
}
