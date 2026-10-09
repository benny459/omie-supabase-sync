// /api/ordem/avisos — sino e diálogo de entrada da Central de Ordem.
//  GET  → { ligado, n (não lidos), avisos[], resumo: {total, porModulo, primeiro}, dialogo }  — só o que a pessoa pode ver
//  POST { lidos: "todos" | number[] } → marca como lidos
import { NextResponse } from "next/server";
import { db, itensAbertos, lerConfig, quemOrdem, TENANT } from "@/lib/ordem/servidor";
import { filtrarItens } from "@/lib/ordem/fila";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const cfg = await lerConfig();
  const ligadoSino = cfg.ativo && cfg.sino;
  const ligadoDialogo = cfg.ativo && cfg.dialogo_entrada;
  // Admin vê a Central em pré-visualização, mas sino/diálogo só quando ligados (não incomodar).
  const centralVisivel = cfg.ativo || q.admin;
  if (!ligadoSino && !ligadoDialogo) return NextResponse.json({ ligado: false, central: centralVisivel, n: 0, avisos: [] });
  const [{ data: av }, linhas] = await Promise.all([
    db().from("aviso").select("id, tipo, item_id, texto, criado_em, lido_em").eq("tenant_slug", TENANT).eq("destinatario_id", q.uid).order("criado_em", { ascending: false }).limit(30),
    itensAbertos(),
  ]);
  const fila = filtrarItens(q, cfg, linhas, { escopo: "meus" });
  // aviso só mostra o que a pessoa pode ver: o item ligado tem de estar na fila dela (ou ser dela por encaminhamento)
  const visiveis = new Set(fila.itens.map((i) => i.id));
  const avisos = ((av ?? []) as { id: number; tipo: string; item_id: string | null; texto: string; criado_em: string; lido_em: string | null }[])
    .map((a) => ({ ...a, item_id: a.item_id && visiveis.has(a.item_id) ? a.item_id : null }));
  const porModulo: Record<string, number> = {};
  for (const i of fila.itens.filter((x) => x.meu || !x.dono_id)) porModulo[i.modulo] = (porModulo[i.modulo] ?? 0) + 1;
  const primeiro = fila.itens.find((x) => x.meu) ?? fila.itens[0] ?? null;
  return NextResponse.json({
    ligado: ligadoSino, dialogo: ligadoDialogo, central: centralVisivel, nome: q.nome,
    n: avisos.filter((a) => !a.lido_em).length, avisos,
    resumo: { total: Object.values(porModulo).reduce((s, n) => s + n, 0), porModulo, primeiro: primeiro ? { id: primeiro.id, modulo: primeiro.modulo, titulo: primeiro.titulo, acao: primeiro.recomendacao.acao } : null },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({})) as { lidos?: "todos" | number[] };
  const agora = new Date().toISOString();
  let u = db().from("aviso").update({ lido_em: agora }).eq("tenant_slug", TENANT).eq("destinatario_id", q.uid).is("lido_em", null);
  if (Array.isArray(b.lidos)) u = u.in("id", b.lidos.map(Number));
  await u;
  return NextResponse.json({ ok: true });
}
