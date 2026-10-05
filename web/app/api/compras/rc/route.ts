// /api/compras/rc — servidor-a-servidor para o CRM (Propostas-WW).
//   POST   cria a requisição de compra (RC) da proposta no painel (compras.*),
//          ligada ao PV/OS — substitui o IncluirPedCompra no Omie (01/10/26).
//   DELETE desfaz a RC automática (só se nenhum item já virou pedido).
// Autenticação: header x-compras-secret = COMPRAS_RC_SECRET (mesmo valor nas
// duas Vercel). A rota é pública no middleware; a guarda é o segredo.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { rpc, posGravar } from "@/lib/compras-server";
import { avisarCompras } from "@/lib/compras-avisos";
import { supaAdmin } from "@/lib/supabase-admin";
import type { Pedido } from "@/lib/compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function autorizado(req: Request) {
  const esperado = process.env.COMPRAS_RC_SECRET ?? "";
  const veio = req.headers.get("x-compras-secret") ?? "";
  if (!esperado || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
const marca = (proposta: string) => `[CRM proposta ${proposta}]`;

async function daProposta(empresa: string, proposta: string) {
  const { data } = await supaAdmin().schema("orders").rpc("compras_lista", { p_desde: null });
  return ((data ?? []) as { id: number; num: string; tipo: string; emp: string; obsInt?: string }[])
    .filter((p) => p.tipo === "RC" && p.emp === empresa && (p.obsInt ?? "").includes(marca(proposta)));
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const b = await req.json().catch(() => null) as {
    empresa?: string; proposta?: string; label?: string; por?: string; previsao?: string;
    itens?: { cod?: string; ncodProd?: number; desc: string; un?: string; qtd: number; custo: number;
      obs?: string; fornecedor?: string; fornCod?: number }[];
  } | null;
  const empresa = (b?.empresa ?? "SF").toUpperCase();
  const proposta = String(b?.proposta ?? "").trim(), label = String(b?.label ?? "").toUpperCase().replace(/\s/g, "");
  if (!proposta || !/^(PV|OS)\d+$/.test(label)) return NextResponse.json({ error: "proposta e label (PV/OS) obrigatórios" }, { status: 400 });
  if (!b?.itens?.length) return NextResponse.json({ error: "sem itens" }, { status: 400 });
  try {
    const ja = await daProposta(empresa, proposta);
    if (ja.length) return NextResponse.json({ error: `a proposta já tem RC nº ${ja[0].num}`, numero_rc: ja[0].num, id: ja[0].id }, { status: 409 });
    const { data: venda } = await supaAdmin().schema("sales").from("v_erp_vendas")
      .select("cliente, projeto, codigo_projeto").eq("empresa", empresa).eq("label", label).limit(1).maybeSingle();
    const v = venda as { cliente?: string; projeto?: string; codigo_projeto?: string } | null;
    // Fornecedor sugerido pelo CRM (prévia da RC, 05/10/26): vai na obs de cada
    // item e, se todos os itens trazem o mesmo, também no cabeçalho.
    const forns = [...new Set(b.itens.map((i) => (i.fornecedor ?? "").trim()).filter(Boolean))];
    const fornUnico = forns.length === 1 && b.itens.every((i) => (i.fornecedor ?? "").trim() === forns[0]) ? forns[0] : null;
    const fornCods = [...new Set(b.itens.map((i) => i.fornCod).filter((c): c is number => typeof c === "number" && c > 0))];
    const r = await rpc<{ id: number; num: string }>("compras_salvar", {
      p: {
        tipo: "RC", emp: empresa, pv: label, pvCliente: v?.cliente ?? null, proj: v?.projeto ?? null,
        projCod: v?.codigo_projeto && /^\d+$/.test(v.codigo_projeto) ? v.codigo_projeto : null,
        previsao: b.previsao ?? null,
        ...(fornUnico ? { forn: fornUnico, fornCod: fornCods.length === 1 ? fornCods[0] : null } : {}),
        obsInt: `${label} — RC automática ${marca(proposta)}, custos máximos da CP${b.por ? ` · emitida por ${b.por}` : ""}`,
        itens: b.itens.map((i) => ({ cod: i.cod ?? null, ncodProd: i.ncodProd ?? null, desc: i.desc, un: i.un ?? "UN",
          qtd: Number(i.qtd) || 1, vu: Math.round((Number(i.custo) || 0) * 100) / 100,
          obs: [i.obs?.trim(), i.fornecedor?.trim() ? `Fornecedor sugerido: ${i.fornecedor.trim()}` : ""].filter(Boolean).join(" · ") || null })),
        origemDe: `Criada pelo CRM (proposta ${proposta})`,
      },
      p_por: b.por ? `CRM · ${b.por}` : "CRM", p_uid: null,
    });
    await posGravar(r.id, "RC");
    await avisarCompras().catch(() => null); // avisa o time de compras da RC nova (uma vez)
    await rpc("vendas_refrescar").catch(() => null); // Avulsos mostra a RC na hora (P1)
    return NextResponse.json({ ok: true, id: r.id, numero_rc: r.num, label });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

// GET ?op=proximo&empresa=SF — número que a próxima RC/PC deve receber (prévia,
// não reserva: o número final é confirmado ao gravar).
export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const u = new URL(req.url);
  if (u.searchParams.get("op") !== "proximo") return NextResponse.json({ error: "op inválida" }, { status: 400 });
  const empresa = (u.searchParams.get("empresa") ?? "SF").toUpperCase();
  const { data, error } = await supaAdmin().schema("orders").rpc("proximo_numero_previa", { p_empresa: empresa });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ empresa, proximo: data, aviso: "prévia — confirmado ao gravar" });
}

export async function DELETE(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const b = await req.json().catch(() => null) as { empresa?: string; id?: number; proposta?: string; por?: string } | null;
  const empresa = (b?.empresa ?? "SF").toUpperCase();
  try {
    let id = Number(b?.id) || 0;
    if (!id && b?.proposta) id = (await daProposta(empresa, String(b.proposta)))[0]?.id ?? 0;
    if (!id) return NextResponse.json({ error: "RC não encontrada" }, { status: 404 });
    const p = await rpc<Pedido>("compras_pedido", { p_id: id });
    if (!p || p.tipo !== "RC" || p.origem !== "painel") return NextResponse.json({ error: "só se desfaz RC criada pelo CRM no painel" }, { status: 400 });
    if ((p.pcsDaRc ?? []).length) return NextResponse.json({ error: `a RC ${p.num} já tem pedido de compra (${p.pcsDaRc!.join(", ")}) — cancele no painel` }, { status: 409 });
    await rpc("compras_excluir", { p_id: id });
    await rpc("compras_publicar_rcs").catch(() => null); // tira as linhas dos baldes de PV/OS
    return NextResponse.json({ ok: true, excluida: p.num });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
