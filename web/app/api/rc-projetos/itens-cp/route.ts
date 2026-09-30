// GET /api/rc-projetos/itens-cp?codigo_projeto=123 — os itens da composição de
// preço (CP) da proposta do CRM ligada ao projeto, já casados com o catálogo do
// Omie. É o ponto de partida da lista de materiais: quem monta tira o que não
// vai usar e salva.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { fetchItensCp } from "@/lib/crm-fechamento";
import { casarCatalogo } from "@/lib/catalogo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const codigo = Number(new URL(req.url).searchParams.get("codigo_projeto"));
  if (!Number.isFinite(codigo) || codigo <= 0) {
    return NextResponse.json({ error: "codigo_projeto obrigatório" }, { status: 400 });
  }
  try {
    const { proposta, itens } = await fetchItensCp(codigo);
    const casamentos = await casarCatalogo(itens.map((i) => [i.item, i.modelo].filter(Boolean).join(" ")));
    return NextResponse.json({
      proposta,
      itens: itens.map((i, k) => ({ ...i, casamento: casamentos[k] })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
