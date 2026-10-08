// Agente de compras — lotes do projeto (08/10/26, spec F; sql/129).
//   GET  ?empresa=SF&codigo=…[&sim=1][&janela=N] → { lotes (propostos + agendados/gerados, com
//        motivo e caixa), janela, pendente? }
//   POST { acao, empresa, codigo, … }  (exige acesso a Compras)
//        agendar  { lote: { forn, base, pedir, motivo, itens[] } }  → no dia o cron cria o PC e avisa
//        mover    { id, data }       · cancelar { id }       · gerado { id, pedido_num }
//        janela   { janela }         (janela de consolidação da empresa, 0–60 dias)
//        gerar    { chave, simular } → o PC do lote pelo caminho do Gerar pedido de compra
//                                       (simular=true só confere, nada é gravado)
//        motivo_ia { chave }         → a explicação reescrita pela Claude, só com os fatos do lote
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { exigirCompras } from "@/lib/compras-server";
import { lotesDoProjeto, salvarLote, gerarPcDoLote, motivoComIA } from "@/lib/agente-compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") || "SF").toUpperCase();
  const codigo = Number(sp.get("codigo"));
  if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  try {
    const j = sp.get("janela") != null ? Number(sp.get("janela")) : undefined;
    const r = await lotesDoProjeto(empresa, codigo, { simAgora: sp.get("sim") === "1", janela: Number.isFinite(j) ? j : undefined });
    return NextResponse.json({ lotes: r.lotes, janela: r.janela, pendente: r.pendente, persistidos: r.persistidos });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; empresa?: string; codigo?: number; id?: string; data?: string;
    pedido_num?: string; janela?: number; chave?: string; simular?: boolean;
    lote?: { forn?: string; base?: string; pedir?: string; motivo?: string; itens?: string[] } };
  const empresa = String(b.empresa ?? "SF").toUpperCase();
  const codigo = Number(b.codigo);
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  try {
    if (b.acao === "janela") {
      const j = Math.round(Number(b.janela));
      if (!(j >= 0 && j <= 60)) return NextResponse.json({ error: "janela entre 0 e 60 dias" }, { status: 400 });
      return NextResponse.json(await salvarLote({ acao: "janela", empresa, janela: j }, q.email));
    }
    if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
    if (b.acao === "agendar") {
      const l = b.lote ?? {};
      if (!iso(l.base) || !iso(l.pedir) || !Array.isArray(l.itens) || !l.itens.length) return NextResponse.json({ error: "lote incompleto" }, { status: 400 });
      return NextResponse.json(await salvarLote({ acao: "agendar", empresa, codigo_projeto: codigo, fornecedor: l.forn ?? null,
        data_base: l.base, data_pedir: l.pedir, motivo: String(l.motivo ?? "").replace(/\*\*/g, "").slice(0, 1000), itens: l.itens }, q.email));
    }
    if (b.acao === "mover") {
      if (!b.id || !iso(b.data)) return NextResponse.json({ error: "lote e data obrigatórios" }, { status: 400 });
      return NextResponse.json(await salvarLote({ acao: "mover", id: b.id, data: b.data }, q.email));
    }
    if (b.acao === "cancelar") {
      if (!b.id) return NextResponse.json({ error: "lote obrigatório" }, { status: 400 });
      return NextResponse.json(await salvarLote({ acao: "cancelar", id: b.id }, q.email));
    }
    if (b.acao === "gerado") {
      if (!b.id) return NextResponse.json({ error: "lote obrigatório" }, { status: 400 });
      return NextResponse.json(await salvarLote({ acao: "gerado", id: b.id, pedido_num: b.pedido_num ?? null }, q.email));
    }
    if (b.acao === "gerar" || b.acao === "motivo_ia") {
      const { lotes } = await lotesDoProjeto(empresa, codigo);
      const lote = lotes.find((x) => x.chave === b.chave || x.id === b.chave);
      if (!lote) return NextResponse.json({ error: "lote não encontrado — recarregue (os itens mudaram?)" }, { status: 404 });
      if (b.acao === "motivo_ia") return NextResponse.json(await motivoComIA(lote));
      const r = await gerarPcDoLote(empresa, codigo, lote, { simular: b.simular !== false, por: q.email });
      if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 400 });
      if (!r.simulado && lote.id && r.pedidos[0]?.num) await salvarLote({ acao: "gerado", id: lote.id, pedido_num: String(r.pedidos[0].num), pedido_id: r.pedidos[0].id ?? null }, q.email);
      return NextResponse.json({ ...r, lote: { chave: lote.chave, itens: lote.itens.map((x) => x.id), forn: lote.forn } });
    }
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
