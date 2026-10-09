// POST /api/ordem/comando — barra de comandos da Aria.
//  { texto }                    → pré-visualização: o que entendeu, os itens (só dos módulos que a pessoa vê),
//                                 quantos ficaram de fora por falta de acesso; se TODOS são de módulos sem
//                                 acesso → { semAcesso: modulo } (abre o diálogo e não executa nada)
//  { texto, confirmar: true, ids } → executa item a item pela mesma /api/ordem/acao (rotas de sempre),
//                                 encaminha os que dependem de outro módulo; devolve os log_id para Desfazer em lote.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, hojeSP, itensAbertos, lerConfig, pessoas, quemOrdem, TENANT } from "@/lib/ordem/servidor";
import { casaFiltro, interpretar } from "@/lib/ordem/comandos";
import { detetorLigado, moduloLigado, podeExecutar, podeVerItem, podeVerValores } from "@/lib/ordem/acesso";
import { renderValores } from "@/lib/ordem/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const cfg = await lerConfig();
  if (!cfg.comandos && !q.admin) return NextResponse.json({ error: "Comandos ainda desligados na configuração." }, { status: 400 });
  const b = await req.json().catch(() => ({})) as { texto?: string; confirmar?: boolean; ids?: string[] };
  const texto = (b.texto ?? "").trim().slice(0, 300);
  const it = interpretar(texto);
  if (!it.ok) return NextResponse.json({ ok: false, frase: it.frase });
  const hoje = hojeSP();
  const [linhas, ps] = await Promise.all([itensAbertos(), pessoas()]);
  const nomes = new Map(ps.map((p) => [p.id, p.nome]));
  const alvo = linhas.filter((l) => it.tipos.includes(l.tipo) && l.estado === "aberto" && casaFiltro(l, it.filtro, hoje));
  const visiveis = alvo.filter((l) => podeVerItem(q, { modulo: l.modulo, tipo: l.tipo, requer: l.dados?.requer }, cfg) && moduloLigado(q, cfg, l.modulo).ligado && detetorLigado(q, cfg, l.tipo).ligado);
  const fora = alvo.length - visiveis.length;
  if (alvo.length > 0 && visiveis.length === 0) {
    return NextResponse.json({ ok: false, frase: it.frase, semAcesso: alvo[0].modulo, fora });
  }
  const plano = visiveis.map((l) => {
    const ac = l.dados?.acao ?? null;
    const pe = ac ? podeExecutar(q, cfg, ac.chave) : null;
    const modo = it.modo === "encaminhar" ? (cfg.encaminhar && l.depende_de ? "encaminhar" : "abrir")
      : ac && pe?.ok && cfg.comandos ? "executar" : "abrir";
    return { id: l.id, modulo: l.modulo, titulo: renderValores(l.titulo, podeVerValores(q, l.modulo)), dono: l.dono_id ? nomes.get(l.dono_id) ?? null : null,
      modo, motivo: modo === "abrir" ? (pe?.motivo ?? (it.modo === "encaminhar" ? "Encaminhar desligado" : "Sem ação automática")) : null, link: l.link };
  });

  if (!b.confirmar) {
    return NextResponse.json({ ok: true, frase: it.frase, itens: plano, fora,
      executaveis: plano.filter((p) => p.modo !== "abrir").length, comandosLigados: cfg.comandos });
  }
  if (!cfg.comandos) return NextResponse.json({ error: "Comandos ainda desligados na configuração (só pré-visualização)." }, { status: 400 });
  const escolhidos = new Set((b.ids ?? []).map(String));
  const origem = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const lote = randomUUID();
  const resultados: { id: string; ok: boolean; texto: string; log_id?: number | null }[] = [];
  for (const p of plano.filter((x) => x.modo !== "abrir" && (!escolhidos.size || escolhidos.has(x.id)))) {
    const r = await fetch(new URL("/api/ordem/acao", origem), { method: "POST", cache: "no-store",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: p.id, acao: p.modo === "encaminhar" ? "encaminhar" : "executar", motivo: p.modo === "encaminhar" ? `Comando: ${texto}` : undefined }) });
    const j = await r.json().catch(() => ({})) as { texto?: string; error?: string; log_id?: number };
    resultados.push({ id: p.id, ok: r.ok, texto: j.texto ?? j.error ?? `erro ${r.status}`, log_id: j.log_id ?? null });
  }
  const logIds = resultados.map((r) => r.log_id).filter((x): x is number => !!x);
  if (logIds.length) await db().from("acao_log").update({ lote_id: lote, comando: texto }).in("id", logIds).eq("tenant_slug", TENANT);
  await db().from("acao_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, lote_id: lote, comando: texto, acao: "comando",
    executado: { ok: resultados.filter((r) => r.ok).length, total: resultados.length, fora } });
  return NextResponse.json({ ok: true, frase: it.frase, resultados, lote, fora, log_ids: logIds });
}
