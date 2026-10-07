// GET /api/rc-projetos/itens-cp?codigo_projeto=123 — os itens da composição de
// preço (CP) da proposta do CRM ligada ao projeto, já casados com o catálogo —
// desde 07/10/26 com os itens NOSSOS (código novo), de-para gravado primeiro
// (escolha feita no seletor da linha volta igual ao reabrir). ?sem_casar=1
// devolve só a CP (a lista usa o custo da CP como estimativa de reserva). É o ponto de partida da lista de materiais: quem monta tira o que não
// vai usar e salva.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { fetchItensCp } from "@/lib/crm-fechamento";
import { casarItensProjeto } from "@/lib/catalogo-projeto";

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
    if (new URL(req.url).searchParams.get("sem_casar") === "1") return NextResponse.json({ proposta, itens });
    const casamentos = await casarItensProjeto("SF", itens.map((i) => [i.item, i.modelo].filter(Boolean).join(" ")),
      itens.map((i) => i.custo_cp));
    return NextResponse.json({
      proposta,
      itens: itens.map((i, k) => ({ ...i, casamento: casamentos[k] })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
