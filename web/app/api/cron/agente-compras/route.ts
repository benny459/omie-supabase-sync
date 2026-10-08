// /api/cron/agente-compras — o agente de compras, todo dia às 07:00 de Brasília (10:00 UTC,
// vercel.json). 08/10/26, spec F; sql/129.
//   (a) recalcula os lotes propostos de cada projeto com item sem PC perto do "comprar até";
//   (b) lote AGENDADO com data de pedir = hoje (ou já passada): cria o PC pelo mesmo caminho do
//       "Gerar pedido de compra" da lista (aguardando aprovação), marca o lote "gerado" e avisa;
//       item que ganhou PC fora do lote sai dele antes; sem fornecedor/categoria certos, avisa
//       em vez de gerar;
//   (c) lote agendado para AMANHÃ: lembrete (uma vez);
//   (d) lote proposto atrasado há 2 dias sem ação: escalona ao admin (uma vez, no 2º dia).
// Avisos no Webex (mensagem direta: COMPRAS_ALERTA_EMAILS; admin: COMPRAS_ADMIN_EMAILS).
// Telegram não está ligado no painel.
// Manual: /api/cron/agente-compras?secret=<CRON_SECRET>[&simular=1][&avisar=1][&hoje=AAAA-MM-DD]
//   simular=1 → não cria PC, não grava nada e não avisa (a não ser com avisar=1); devolve o
//   que faria, inclusive o pedido montado de cada lote.
//   simular=1&projeto=<código>&lote=<chave do lote proposto> → trata esse lote como se estivesse
//   agendado para hoje (para conferir o PC que o agente montaria, sem agendar nada).
import { NextRequest, NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { lotesDoProjeto, gerarPcDoLote, salvarLote, avisarWebex } from "@/lib/agente-compras";
import { hojeIso, somaDias } from "@/lib/planejamento-compras";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const d2 = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const URL_PAINEL = "https://painel.waterworks.com.br";

type Agendado = { id: string; empresa: string; codigo_projeto: number; fornecedor: string | null; data_pedir: string; ultimo_aviso: string | null; itens: string[] };

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (!authorized(req)) {
    // administrador logado pode rodar a SIMULAÇÃO pelo navegador (sem criar PC, sem gravar, sem avisar)
    const perms = sp.get("simular") === "1" && sp.get("avisar") !== "1" ? await loadPerms().catch(() => null) : null;
    if (!perms?.is_admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const simular = sp.get("simular") === "1";
  const avisar = !simular || sp.get("avisar") === "1";
  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("hoje") ?? "") ? sp.get("hoje")! : hojeIso();
  const amanha = somaDias(hoje, 1);
  const { data, error } = await supaAdmin().schema("orders").rpc("lotes_do_dia", { p_ate: amanha });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const dia = (data ?? {}) as { agendados?: Agendado[]; projetos?: { empresa: string; codigo_projeto: number }[] };
  const agendados = (dia.agendados ?? []).map((a) => ({ ...a, data_pedir: String(a.data_pedir).slice(0, 10) }));
  const simProjeto = simular ? Number(sp.get("projeto")) || 0 : 0;
  const simLote = simular ? sp.get("lote") ?? "" : "";
  const projetos = new Map<string, { empresa: string; codigo: number }>();
  for (const p of dia.projetos ?? []) projetos.set(`${p.empresa}|${p.codigo_projeto}`, { empresa: p.empresa, codigo: Number(p.codigo_projeto) });
  for (const a of agendados) projetos.set(`${a.empresa}|${a.codigo_projeto}`, { empresa: a.empresa, codigo: Number(a.codigo_projeto) });
  if (simProjeto) { // simulação de um projeto só
    const emp = (sp.get("empresa") || "SF").toUpperCase();
    for (const k of [...projetos.keys()]) if (k !== `${emp}|${simProjeto}`) projetos.delete(k);
    projetos.set(`${emp}|${simProjeto}`, { empresa: emp, codigo: simProjeto });
  }

  const nomes = new Map<string, string>();
  { const cods = [...new Set([...projetos.values()].map((p) => p.codigo))];
    if (cods.length) {
      const { data: pj } = await supaAdmin().schema("finance").from("projetos").select("empresa, codigo, nome").in("codigo", cods);
      for (const p of (pj ?? []) as { empresa: string; codigo: number; nome: string }[]) nomes.set(`${p.empresa}|${p.codigo}`, p.nome);
    } }

  const gerados: string[] = [], lembretes: string[] = [], escalar: string[] = [], problemas: string[] = [];
  const detalhe: Record<string, unknown>[] = [];
  for (const [k, p] of projetos) {
    const nome = nomes.get(k) ?? String(p.codigo);
    let r: Awaited<ReturnType<typeof lotesDoProjeto>>;
    try { r = await lotesDoProjeto(p.empresa, p.codigo, { hoje }); }
    catch (e) { problemas.push(`${nome}: ${(e as Error).message}`); continue; }
    const link = `${URL_PAINEL}/projetos/${p.codigo}/materiais`;
    // simulação de um lote proposto como se estivesse agendado para hoje
    if (simLote && p.codigo === simProjeto) {
      const l = r.lotes.find((x) => x.chave === simLote);
      if (l) { l.id = l.id ?? `sim:${l.chave}`; agendados.push({ id: l.id, empresa: p.empresa, codigo_projeto: p.codigo, fornecedor: l.forn, data_pedir: hoje, ultimo_aviso: null, itens: l.itens.map((x) => x.id) }); }
      else problemas.push(`lote ${simLote} não encontrado no projeto ${simProjeto}`);
    }
    // (b) agendados para hoje (ou atrasados) · (c) lembrete de amanhã
    for (const a of agendados.filter((x) => x.empresa === p.empresa && Number(x.codigo_projeto) === p.codigo)) {
      const lote = r.lotes.find((l) => l.id === a.id);
      if (!lote) { // todos os itens ganharam PC fora do lote
        if (!simular) await salvarLote({ acao: "cancelar", id: a.id }, "agente").catch(() => null);
        problemas.push(`${nome} · lote ${a.fornecedor ?? ""} de ${d2(a.data_pedir)} cancelado: os itens já têm PC`);
        detalhe.push({ projeto: nome, lote: a.id, acao: "cancelado (itens já com PC)" });
        continue;
      }
      const sairam = a.itens.filter((id) => !lote.itens.some((x) => x.id === id));
      if (sairam.length && !simular) await salvarLote({ acao: "tirar_itens", id: a.id, itens: sairam }, "agente").catch(() => null);
      if (a.data_pedir <= hoje) {
        const g = await gerarPcDoLote(p.empresa, p.codigo, lote, { simular, por: "agente de compras" });
        if (!g.ok) {
          if (a.ultimo_aviso !== `erro:${hoje}`) problemas.push(`**${nome}** · lote ${lote.forn} (${lote.itens.length} item(ns), ${brl(lote.valor)}) **não foi gerado**: ${g.motivo} — [abrir](${link})`);
          if (!simular) await salvarLote({ acao: "aviso", id: a.id, aviso: `erro:${hoje}` }, "agente").catch(() => null);
          detalhe.push({ projeto: nome, lote: a.id, acao: "não gerou", motivo: g.motivo });
          continue;
        }
        const num = g.pedidos[0]?.num ? `PC ${g.pedidos[0].num}` : "PC";
        if (!simular && g.pedidos[0]) await salvarLote({ acao: "gerado", id: a.id, pedido_num: String(g.pedidos[0].num ?? ""), pedido_id: g.pedidos[0].id ?? null }, "agente");
        gerados.push(`**${nome}** · ${simular ? "(simulação) " : ""}${num} ${lote.forn} · ${lote.itens.length} item(ns) · ${brl(lote.valor)} — aguardando aprovação em [Compras › Aprovações PC](${URL_PAINEL}/pcs)`);
        detalhe.push({ projeto: nome, lote: a.id, acao: simular ? "geraria PC" : "gerou PC", pedido: g.pedidos[0] ?? null,
          itens_lote: lote.itens.map((x) => x.id), itens_pc: lote.itens.filter((x) => !x.temPc).map((x) => x.id),
          corpo: simular ? g.corpo : undefined, removidos_do_lote: sairam });
      } else if (a.data_pedir === amanha && a.ultimo_aviso !== "lembrete") {
        lembretes.push(`**${nome}** · amanhã (${d2(a.data_pedir)}) o agente cria o PC de ${lote.forn}: ${lote.itens.length} item(ns), ${brl(lote.valor)} — [conferir](${link})`);
        if (!simular) await salvarLote({ acao: "aviso", id: a.id, aviso: "lembrete" }, "agente").catch(() => null);
        detalhe.push({ projeto: nome, lote: a.id, acao: "lembrete" });
      }
    }
    // (d) proposto atrasado há 2 dias sem ação → admin (uma vez)
    for (const l of r.lotes.filter((x) => x.status === "proposto" && x.base === somaDias(hoje, -2))) {
      escalar.push(`**${nome}** · ${l.forn}: ${l.itens.length} item(ns), ${brl(l.valor)} — devia ter sido pedido em ${d2(l.base)} e ninguém agiu (chega ≈ ${d2(somaDias(hoje, l.prazo))}) — [abrir](${link})`);
      detalhe.push({ projeto: nome, lote: l.chave, acao: "escalonado" });
    }
  }

  const avisos: Record<string, unknown> = {};
  if (avisar) {
    const md = [
      gerados.length ? `**🧾 Agente de compras — PC(s) criados hoje (${d2(hoje)})**\n\n${gerados.map((x) => `- ${x}`).join("\n")}` : "",
      lembretes.length ? `**🔔 Amanhã o agente cria estes PCs**\n\n${lembretes.map((x) => `- ${x}`).join("\n")}` : "",
      problemas.length ? `**⚠️ Precisa de você**\n\n${problemas.map((x) => `- ${x}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    if (md) avisos.compras = await avisarWebex(md, "compras");
    if (escalar.length) avisos.admin = await avisarWebex(`**⏰ Lotes de compra atrasados há 2 dias sem ação**\n\n${escalar.map((x) => `- ${x}`).join("\n")}`, "admin");
  }
  return NextResponse.json({ ok: true, hoje, simular, projetos: projetos.size, gerados, lembretes, escalonados: escalar, problemas, avisos, detalhe });
}
