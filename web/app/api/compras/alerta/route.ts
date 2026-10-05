// GET  /api/compras/alerta — contagem de NF-e sem pedido (selo no menu).
// POST /api/compras/alerta — chamado depois de cada import da Focus (GitHub
//      Actions, header Authorization: Bearer CRON_SECRET): roda o casamento e
//      avisa por Webex (mensagem direta) as NF-e que continuaram sem pedido e
//      ainda não foram avisadas. Destinatários: COMPRAS_ALERTA_EMAILS (CSV),
//      padrão benny@waterworks.com.br. Também avisa RCs novas e PCs criados
//      no Omie depois de 01/10 (lib/compras-avisos.ts, sql/51).
import { NextResponse } from "next/server";
import { exigirCompras, rpc } from "@/lib/compras-server";
import { avisarCompras } from "@/lib/compras-avisos";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Resumo = { n: number; valor: number };

export async function GET() {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return NextResponse.json({ n: 0, valor: 0 });
  try {
    const [r, av] = await Promise.all([
      rpc<Resumo>("compras_nf_sem_pedido_resumo"),
      // RCs novas desde a última visita e PCs criados no Omie após 01/10 (sql/51)
      rpc<{ rcNovas: number; pcsOmie: unknown[] }>("compras_avisos", { p_email: q.email }).catch(() => null),
    ]);
    return NextResponse.json({ n: r.n, valor: r.valor, rcNovas: av?.rcNovas ?? 0, pcsOmie: av?.pcsOmie?.length ?? 0 });
  }
  catch { return NextResponse.json({ n: 0, valor: 0 }); }
}

export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  const casou = await rpc("compras_casar_nfs").catch((e) => ({ erro: String(e) }));
  const nfs = await rpc<{ chave: string; numero: string; emitente: string; valor: number; emissao: string }[]>("compras_nfs_sem_pedido", { p_empresa: "SF" });
  // só avisa uma vez por NF (compras.historico não serve: NF sem pedido não tem pedido)
  const { data: ja } = await supaAdmin().schema("orders").rpc("compras_nf_avisadas", { p_chaves: nfs.map((n) => n.chave) });
  const novas = nfs.filter((n) => !((ja as string[] | null) ?? []).includes(n.chave));
  let enviado = 0; const erros: string[] = [];
  if (novas.length && process.env.WEBEX_TOKEN) {
    const para = (process.env.COMPRAS_ALERTA_EMAILS || "benny@waterworks.com.br").split(",").map((s) => s.trim()).filter(Boolean);
    const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const md = `**⛔ ${novas.length} NF-e sem pedido de compra — não pagar até casar**\n\n` +
      novas.map((n) => `- NF-e ${n.numero} · ${n.emitente} · ${brl(n.valor)} · emitida ${String(n.emissao).slice(0, 10).split("-").reverse().join("/")}`).join("\n") +
      `\n\nCasar ou dispensar em https://painel.waterworks.com.br/erp/compras`;
    for (const email of para) {
      const r = await fetch("https://webexapis.com/v1/messages", { method: "POST",
        headers: { Authorization: `Bearer ${process.env.WEBEX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ toPersonEmail: email, markdown: md }) });
      if (r.ok) enviado++; else erros.push(`${email}: ${r.status}`);
    }
    if (enviado) await supaAdmin().schema("orders").rpc("compras_nf_marcar_avisadas", { p_chaves: novas.map((n) => n.chave) });
  }
  const compras = await avisarCompras().catch((e) => ({ erro: String(e) }));
  return NextResponse.json({ casou, sem_pedido: nfs.length, novas: novas.length, avisos: enviado, erros, compras });
}
