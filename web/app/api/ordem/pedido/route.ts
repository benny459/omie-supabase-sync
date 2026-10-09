// POST /api/ordem/pedido — do diálogo "Sem acesso a [módulo]":
//  { tipo: "pedido", modulo, texto, prazo? } → pedido livre ao dono do módulo (P4), fica "a acompanhar"
//  { tipo: "acesso", modulo, texto }         → pedido de acesso ao administrador (a Central não concede nada)
import { NextResponse } from "next/server";
import { db, lerConfig, pessoas, quemOrdem, quemPorId, TENANT } from "@/lib/ordem/servidor";
import { ehModulo, MODULO_POR_ID } from "@/lib/ordem/modulos";
import { pedidoLivre, avisar } from "@/lib/ordem/encaminhar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const cfg = await lerConfig();
  const b = await req.json().catch(() => ({})) as { tipo?: string; modulo?: string; texto?: string; prazo?: string | null };
  if (!ehModulo(b.modulo) || b.modulo === "comercial") return NextResponse.json({ error: "Módulo inválido." }, { status: 400 });
  const texto = (b.texto ?? "").trim();
  if (texto.length < 3) return NextResponse.json({ error: "Escreva o que precisa." }, { status: 400 });
  if (b.tipo === "pedido") {
    if (!cfg.encaminhar || !cfg.parametros.p4_encaminhar_livre) return NextResponse.json({ error: "Pedido livre ainda desligado na configuração." }, { status: 400 });
    await pedidoLivre(q, b.modulo, texto, b.prazo && /^\d{4}-\d{2}-\d{2}$/.test(b.prazo) ? b.prazo : null);
    await db().from("acao_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, acao: "encaminhar", executado: { modulo: b.modulo, livre: true }, motivo: texto });
    return NextResponse.json({ ok: true, texto: `Pedido enviado a ${MODULO_POR_ID[b.modulo].rotulo}. Acompanhe em “A acompanhar”.` });
  }
  if (b.tipo === "acesso") {
    if (!cfg.pedido_acesso) return NextResponse.json({ error: "Pedido de acesso ainda desligado na configuração." }, { status: 400 });
    const { data: ja } = await db().from("pedido_acesso").select("id").eq("tenant_slug", TENANT).eq("usuario_id", q.uid).eq("modulo", b.modulo).eq("estado", "pendente").maybeSingle();
    if (ja) return NextResponse.json({ ok: true, texto: "Já tem um pedido pendente para este módulo." });
    await db().from("pedido_acesso").insert({ tenant_slug: TENANT, usuario_id: q.uid, modulo: b.modulo, motivo: texto });
    // P3: só o admin (e, se configurado, os donos do módulo) são avisados
    const ps = await pessoas();
    const admins: string[] = [];
    for (const p of ps.filter((x) => x.ativo)) { const qq = await quemPorId(p.id); if (qq?.admin) admins.push(p.id); }
    for (const a of admins) await avisar(a, "acesso", `${q.nome} pede acesso a ${MODULO_POR_ID[b.modulo].rotulo}: ${texto}`, null);
    return NextResponse.json({ ok: true, texto: "Pedido enviado ao administrador. Recebe aviso quando for decidido." });
  }
  return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
}
