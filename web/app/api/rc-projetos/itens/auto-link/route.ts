// POST /api/rc-projetos/itens/auto-link
// Body: { empresa, codigo_projeto, aplicar?: boolean, sobrescrever?: boolean }
//
// Busca, dentro dos pedidos de compra DESTE projeto, o item que corresponde a
// cada linha da lista de materiais — e grava o número do pedido. O que não
// achar fica para vínculo manual, que é a única parte que sobra para a mão.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { casarItens, type ItemPc, type Palpite } from "@/lib/match-pc";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; codigo_projeto?: number; aplicar?: boolean; sobrescrever?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const codigoProjeto = Number(body.codigo_projeto);
  if (!empresa || !codigoProjeto) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const aplicar = body.aplicar !== false;
  /* Por omissão não se mexe em quem já tem pedido: vínculo feito à mão é
     decisão de alguém, e o automático não passa por cima dela sem ordem. */
  const sobrescrever = body.sobrescrever === true;

  const approval = supa.schema("approval" as never);
  const { data: linhas, error: e1 } = await approval
    .from("rc_projetos_itens")
    .select("id, item, pc_numero")
    .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  type Linha = { id: string; item: string | null; pc_numero: string | null };
  const alvos = ((linhas ?? []) as Linha[])
    .filter((l) => String(l.item ?? "").trim())
    .filter((l) => sobrescrever || !String(l.pc_numero ?? "").trim())
    .map((l) => ({ id: l.id, item: String(l.item) }));
  if (!alvos.length) {
    return NextResponse.json({ total: 0, exatos: 0, similares: 0, semPc: 0, palpites: [] });
  }

  /* Os itens comprados vivem no schema orders, uma linha por item do pedido.
     Filtra pelo projeto: pedido de outro projeto não é candidato.
     Lido com a chave de serviço — `orders` não é exposto ao usuário
     autenticado (o mesmo caminho que /api/admin/pc-lookup usa). */
  const orders = supaAdmin().schema("orders" as never);
  const { data: pcRows, error: e2 } = await orders
    .from("pedidos_compra")
    .select("cnumero, cdescricao, cproduto")
    .eq("ncod_proj", codigoProjeto);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  type PcRow = { cnumero: string | null; cdescricao: string | null; cproduto: string | null };
  const itensPc: ItemPc[] = ((pcRows ?? []) as PcRow[])
    .filter((r) => String(r.cnumero ?? "").trim())
    .map((r) => ({ pc: String(r.cnumero), desc: String(r.cdescricao || r.cproduto || "") }))
    .filter((p) => p.desc.trim());
  if (!itensPc.length) {
    return NextResponse.json({ total: alvos.length, exatos: 0, similares: 0,
      semPc: alvos.length, palpites: [],
      aviso: "Nenhum pedido de compra deste projeto no Omie ainda." });
  }

  const palpites: Palpite[] = casarItens(alvos, itensPc);
  const casados = palpites.filter((p) => p.pc);
  const exatos = casados.filter((p) => p.via === "exato").length;
  const similares = casados.length - exatos;

  let gravados = 0;
  if (aplicar && casados.length) {
    const agora = new Date().toISOString();
    const userEmail = user.email || user.id;
    /* Um update por pedido, não por item: os itens agrupam-se em poucos
       pedidos, e isso troca dezenas de chamadas por meia dúzia. */
    const porPc = new Map<string, string[]>();
    for (const p of casados) {
      const arr = porPc.get(p.pc as string) ?? [];
      arr.push(p.id); porPc.set(p.pc as string, arr);
    }
    for (const [pc, ids] of porPc) {
      const { error } = await approval.from("rc_projetos_itens")
        .update({ pc_numero: pc, atualizado_por: userEmail, atualizado_em: agora })
        .in("id", ids).eq("empresa", empresa).eq("codigo_projeto", codigoProjeto);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      gravados += ids.length;
    }
  }

  return NextResponse.json({
    total: alvos.length, exatos, similares, semPc: alvos.length - casados.length,
    gravados,
    /* Devolve o que casou por similaridade (para conferência) e o que não
       casou (para o vínculo manual) — o resto não precisa de atenção. */
    palpites: palpites.filter((p) => p.via !== "exato")
      .map((p) => ({ id: p.id, item: p.item, pc: p.pc,
                     score: Math.round(p.score * 100) / 100, descPc: p.descPc })),
  });
}
