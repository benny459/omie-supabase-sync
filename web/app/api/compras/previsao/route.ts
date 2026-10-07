// POST /api/compras/previsao { empresa, numero, data } (07/10/26, sql/103)
// "Prev. material" editada na Operação › Projetos vira a previsão do PRÓPRIO PC
// quando ele nasceu no painel (uma fonte só). PC do Omie: nada muda aqui — a
// remarcação fica na aprovação e o Compras a mostra. Nada vai ao Omie.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; numero?: string; data?: string | null };
  const numero = String(b.numero ?? "").trim();
  const data = b.data && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : null;
  if (!numero) return NextResponse.json({ error: "numero obrigatório" }, { status: 400 });
  if (!data) return NextResponse.json({ ok: false, motivo: "sem data — o PC mantém a previsão" });
  const { data: r, error } = await supaAdmin().schema("orders").rpc("compras_previsao_salvar", {
    p_empresa: String(b.empresa ?? "SF").toUpperCase(), p_numero: numero, p_previsao: data, p_por: user.email ?? user.id });
  if (error) {
    if (/does not exist|schema cache|PGRST202|42883/i.test(`${error.code} ${error.message}`)) return NextResponse.json({ ok: false, pendente: true, motivo: "migração sql/103 pendente" });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(r);
}
