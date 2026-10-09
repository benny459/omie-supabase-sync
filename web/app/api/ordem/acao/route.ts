// POST /api/ordem/acao — decisões e ações a partir do cartão da Central de Ordem.
//  { item_id, acao: "previa" }                       → o que a ação faria (nada é gravado nem enviado)
//  { item_id, acao: "executar", motivo? }            → executa PELA ROTA EXISTENTE com a sessão da pessoa
//  { item_id, acao: "recusar", motivo }              → item fica "recusado" (motivo obrigatório)
//  { item_id, acao: "adiar", motivo?, ate? }         → sai da fila até a data (padrão: amanhã)
//  { item_id, acao: "encaminhar", motivo }           → cria o item no módulo de destino (lib/ordem/encaminhar.ts)
//  { item_id, acao: "feito", motivo? }               → só itens encaminhados (destino): resolvido
//  { acao: "desfazer", log_id }                      → desfaz a última decisão/ação (rota inversa, se existir)
// Cada chamada fica em ordem.acao_log (quem, quando, recomendado, executado, motivo).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db, lerConfig, quemOrdem, TENANT } from "@/lib/ordem/servidor";
import { detetorLigado, moduloLigado, podeExecutar, podeVerItem } from "@/lib/ordem/acesso";
import { chamarRota, erroDe, executarChamada } from "@/lib/ordem/executar";
import { aoDecidirDestino, encaminharItem } from "@/lib/ordem/encaminhar";
import { renderValores } from "@/lib/ordem/tipos";
import type { LinhaItem } from "@/lib/ordem/fila";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const COLS = "id, tipo, modulo, origem_ref, dono_id, urgencia, rotulo_urgencia, titulo, resumo, etapa, valor, link, recomendacao, dados, depende_de, estado, adiado_ate, degrau, encaminhado_de, encaminhado_por, criado_em";

export async function POST(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const cfg = await lerConfig();
  const b = await req.json().catch(() => ({})) as { item_id?: string; acao?: string; motivo?: string; ate?: string | null; log_id?: number };
  const origem = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";
  const log = async (item_id: string | null, acao: string, recomendado: unknown, executado: unknown, motivo: string | null, lote_id: string | null = null) => {
    const { data } = await db().from("acao_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, item_id, acao, recomendado, executado, motivo, lote_id }).select("id").single();
    return (data as { id: number } | null)?.id ?? null;
  };

  // ── Desfazer ──
  if (b.acao === "desfazer") {
    const { data: l } = await db().from("acao_log").select("*").eq("tenant_slug", TENANT).eq("id", Number(b.log_id)).maybeSingle();
    const reg = l as { id: number; usuario_id: string; item_id: string | null; acao: string; executado: { estado_antes?: string; destino?: string; desfazer?: unknown } | null; desfeito_em: string | null } | null;
    if (!reg || reg.usuario_id !== q.uid) return NextResponse.json({ error: "Só pode desfazer o que fez." }, { status: 403 });
    if (reg.desfeito_em) return NextResponse.json({ error: "Já foi desfeito." }, { status: 400 });
    let texto = "Desfeito.";
    if (reg.acao === "executar") {
      const inv = reg.executado?.desfazer as Parameters<typeof executarChamada>[2] | null | undefined;
      if (!inv) return NextResponse.json({ error: "Esta ação não tem desfazer automático — use a tela tradicional." }, { status: 400 });
      const r = await executarChamada(origem, cookie, inv);
      if (!r.ok) return NextResponse.json({ error: `A rota recusou o desfazer: ${erroDe(r.res[0])}` }, { status: 400 });
      texto = `Desfeito pela rota de sempre (${r.ok}/${r.total}).`;
    }
    if (reg.item_id) await db().from("item").update({ estado: reg.executado?.estado_antes ?? "aberto", adiado_ate: null, resolvido_em: null, resolvido_como: null }).eq("id", reg.item_id);
    if (reg.acao === "encaminhar" && reg.executado?.destino) {
      await db().from("item").update({ estado: "recusado", resolvido_em: new Date().toISOString(), resolvido_como: "desfeito" }).eq("id", reg.executado.destino);
    }
    await db().from("acao_log").update({ desfeito_em: new Date().toISOString() }).eq("id", reg.id);
    const id = await log(reg.item_id, "desfazer", null, { de: reg.id }, null);
    return NextResponse.json({ ok: true, texto, log_id: id });
  }

  const { data: row } = await db().from("item").select(COLS).eq("tenant_slug", TENANT).eq("id", String(b.item_id ?? "")).maybeSingle();
  const it = row as LinhaItem | null;
  // Mesmo filtro da fila: quem não vê o módulo não toca no item (nem sabe se existe).
  if (!it || !podeVerItem(q, { modulo: it.modulo, tipo: it.tipo, requer: it.dados?.requer }, cfg)) {
    return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  }
  const ehDestino = it.tipo.startsWith("enc:");
  const ligado = moduloLigado(q, cfg, it.modulo);
  const det = ehDestino ? { ligado: cfg.encaminhar, previa: !cfg.encaminhar } : detetorLigado(q, cfg, it.tipo);
  const emPrevia = ligado.previa || det.previa || !cfg.ativo;

  // ── Decisões de estado (não mexem nos módulos) ──
  if (b.acao === "recusar" || b.acao === "adiar" || b.acao === "feito") {
    if (!cfg.decisoes && !(ehDestino && cfg.encaminhar)) return NextResponse.json({ error: "Decisões ainda desligadas na configuração." }, { status: 400 });
    const motivo = (b.motivo ?? "").trim();
    if (b.acao === "recusar" && motivo.length < 3) return NextResponse.json({ error: "Motivo obrigatório para recusar." }, { status: 400 });
    if (b.acao === "feito" && !ehDestino) return NextResponse.json({ error: "Este item sai da fila sozinho quando for resolvido na tela; não se marca à mão." }, { status: 400 });
    const agora = new Date();
    const ate = b.acao === "adiar" ? (b.ate && /^\d{4}-\d{2}-\d{2}$/.test(b.ate) ? new Date(b.ate + "T08:00:00-03:00") : new Date(agora.getTime() + 86_400_000)) : null;
    const novo = b.acao === "recusar" ? "recusado" : b.acao === "adiar" ? "adiado" : "feito";
    await db().from("item").update({
      estado: novo, adiado_ate: ate?.toISOString() ?? null,
      resolvido_em: novo === "adiado" ? null : agora.toISOString(), resolvido_como: novo === "adiado" ? null : "manual",
      dados: { ...(it.dados ?? {}), motivo: motivo || (it.dados as { motivo?: string } | null)?.motivo || null },
    }).eq("id", it.id);
    if (ehDestino && (novo === "feito" || novo === "recusado")) await aoDecidirDestino(it, novo, motivo || null, q);
    const id = await log(it.id, b.acao, it.recomendacao, { estado_antes: it.estado, estado: novo, ate: ate?.toISOString() ?? null }, motivo || null);
    return NextResponse.json({ ok: true, log_id: id, texto: novo === "recusado" ? "Recusado — o motivo fica registado." : novo === "adiado" ? `Adiado até ${ate!.toLocaleDateString("pt-BR")}.` : "Marcado como resolvido." });
  }

  // ── Encaminhar ──
  if (b.acao === "encaminhar") {
    if (!cfg.encaminhar) return NextResponse.json({ error: "Encaminhamento ainda desligado na configuração." }, { status: 400 });
    const motivo = (b.motivo ?? "").trim();
    if (motivo.length < 3) return NextResponse.json({ error: "Diga o que pede à outra área." }, { status: 400 });
    try {
      const r = await encaminharItem(q, it, motivo);
      const id = await log(it.id, "encaminhar", it.recomendacao, { estado_antes: it.estado, destino: r.destino }, motivo);
      return NextResponse.json({ ok: true, log_id: id, texto: r.texto });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
  }

  // ── Ações nos módulos (pelas rotas existentes) ──
  const ac = it.dados?.acao ?? null;
  if (!ac?.rota) return NextResponse.json({ error: "Este item não tem ação automática — use “Abrir na tela tradicional”." }, { status: 400 });
  const pe = podeExecutar(q, cfg, ac.chave);
  if (!pe.ok) return NextResponse.json({ error: pe.motivo }, { status: 403 });
  if (emPrevia) return NextResponse.json({ error: "Pré-visualização: ligue a Central, o módulo e o detetor na configuração para executar." }, { status: 400 });
  const rec = { ...it.recomendacao, acao: renderValores(it.recomendacao.acao, true) };

  if (b.acao === "previa") {
    const p = await previa(ac.chave, it, origem, cookie).catch((e) => ({ texto: `Não foi possível preparar: ${e instanceof Error ? e.message : String(e)}`, detalhe: null }));
    await log(it.id, "previa", rec, { chave: ac.chave }, null);
    return NextResponse.json({ ok: true, ...p });
  }

  if (b.acao === "executar") {
    let chamada = ac.rota;
    // Enviar PC: monta para/assunto com os dados que o modal de hoje usa (GET /api/compras/email?id=).
    if (ac.chave === "compras.enviar_fornecedor") {
      const id = Number(ac.rota.corpo.id);
      const g = await chamarRota(origem, cookie, "GET", `/api/compras/email?id=${id}`);
      const m = g.corpo as { para?: string[]; assunto?: string; configurado?: boolean } | null;
      if (!g.ok || !m?.para?.length) return NextResponse.json({ error: !g.ok ? erroDe(g) : "Fornecedor sem e-mail no cadastro — complete o cadastro ou envie pela tela." }, { status: 400 });
      chamada = { ...ac.rota, corpo: { id, para: m.para.join(", "), assunto: m.assunto } };
    }
    if (ac.chave === "financeiro.conciliar") {
      const ids = await movimentosComSugestao(it, origem, cookie);
      if (!ids.length) return NextResponse.json({ error: "Nenhum movimento com sugestão de score ≥ 80 — reveja na tela de conciliação." }, { status: 400 });
      chamada = { ...ac.rota, corpo: { acao: "aceitar_lote", movimentos: ids, limiar: 80 } };
    }
    const extra = ac.chave === "compras.aprovar" && b.motivo ? { motivoAcimaBudget: b.motivo } : {};
    const r = await executarChamada(origem, cookie, chamada, extra);
    const primeira = r.res[0]?.corpo as { code?: string; avisos?: unknown[]; falhas?: { num: string; erro: string }[]; alterados?: number } | null;
    if (primeira?.code === "ACIMA_BUDGET_CONFIRMAR") {
      return NextResponse.json({ ok: false, precisaMotivo: true, avisos: primeira.avisos, error: "Há PCs acima do budget do projeto: escreva o motivo e confirme de novo (a rota avisa o Benny)." }, { status: 409 });
    }
    const falhasRota = primeira?.falhas ?? [];
    const lote_id = randomUUID();
    const estado = r.ok === 0 ? it.estado : ac.chave === "compras.cobrar_fornecedor" ? "adiado" : "feito";
    if (r.ok > 0) {
      await db().from("item").update({
        estado, resolvido_em: estado === "feito" ? new Date().toISOString() : null, resolvido_como: estado === "feito" ? "acao" : null,
        adiado_ate: estado === "adiado" ? new Date(Date.now() + 3 * 86_400_000).toISOString() : null,
      }).eq("id", it.id);
    }
    const id = await log(it.id, "executar", rec, {
      chave: ac.chave, estado_antes: it.estado, ok: r.ok, total: r.total,
      respostas: r.res.map((x) => ({ status: x.status, corpo: x.corpo })), desfazer: r.ok > 0 ? ac.desfazer ?? null : null,
    }, b.motivo ?? null, lote_id);
    if (r.ok === 0) return NextResponse.json({ error: `A rota recusou: ${erroDe(r.res[0])}` }, { status: 400 });
    const parcial = r.falhas > 0 || falhasRota.length > 0;
    const msgFalhas = falhasRota.length ? ` · ${falhasRota.length} não passaram: ${falhasRota.slice(0, 3).map((f) => `PC ${f.num} (${f.erro})`).join("; ")}` : "";
    return NextResponse.json({ ok: true, parcial, log_id: id, desfazer: !!ac.desfazer,
      texto: `${ac.rotulo}: feito pela rota de sempre (${r.ok}/${r.total})${msgFalhas}.${ac.chave === "compras.cobrar_fornecedor" ? " Volta à fila em 3 dias se ainda estiver atrasado." : ""}` });
  }
  return NextResponse.json({ error: "ação inválida" }, { status: 400 });
}

/** O que a ação faria — nada é gravado nem enviado. */
async function previa(chave: string, it: LinhaItem, origem: string, cookie: string): Promise<{ texto: string; detalhe: unknown }> {
  const d = (it.dados ?? {}) as Record<string, unknown>;
  const ac = it.dados?.acao;
  switch (chave) {
    case "compras.aprovar": {
      const pcs = (d.pcs as { num: string; valor: number; forn?: string }[] | undefined) ?? [];
      return { texto: `Vai aprovar ${pcs.length} PC(s) pela rota de aprovação de Compras (mesma alçada, regra do budget e aviso Webex de hoje):\n${pcs.slice(0, 12).map((p) => `• PC ${p.num} · ${p.forn ?? "—"}`).join("\n")}${pcs.length > 12 ? "\n…" : ""}\n\nOs que a rota não deixar aprovar ficam com o motivo. Tem Desfazer (volta para “aguardando”).`, detalhe: pcs };
    }
    case "compras.casar_nf": {
      const pares = (d.pares as { nf: string; num: string }[] | undefined) ?? (d.nf ? [{ nf: String(d.nf), num: String(d.num) }] : []);
      return { texto: `Vai casar ${pares.length} NF com o PC:\n${pares.slice(0, 15).map((x) => `• NF ${x.nf} ↔ PC ${x.num}`).join("\n")}${pares.length > 15 ? "\n…" : ""}\n\nTem Desfazer (descasar).`, detalhe: pares };
    }
    case "compras.enviar_fornecedor": {
      const id = Number(ac?.rota?.corpo.id);
      const g = await chamarRota(origem, cookie, "GET", `/api/compras/email?id=${id}`);
      const m = g.corpo as { para?: string[]; assunto?: string; configurado?: boolean; soPara?: string[]; aprovado?: boolean } | null;
      if (!g.ok) return { texto: `Não foi possível preparar: ${erroDe(g)}`, detalhe: null };
      return {
        texto: `Vai enviar por e-mail, com o PDF do pedido:\nPara: ${m?.para?.join(", ") || "(sem e-mail no cadastro — não dá para enviar daqui)"}\nAssunto: ${m?.assunto ?? "—"}${m?.soPara?.length ? `\n⚠ Modo teste do painel: vai só para ${m.soPara.join(", ")}` : ""}${m?.configurado === false ? "\n⚠ E-mail do painel não configurado." : ""}\n\nEnviar não tem desfazer.`,
        detalhe: m,
      };
    }
    case "compras.cobrar_fornecedor": {
      const pcs = (d.pcs as { num: string }[] | undefined) ?? [];
      const texto = (ac?.rota?.lote?.[0] as { texto?: string } | undefined)?.texto ?? "";
      return { texto: `Vai responder na conversa de e-mail de ${pcs.length} PC(s) (para o último contato do fornecedor), com:\n\n${texto}\n\nEnviar não tem desfazer. O item volta à fila em 3 dias se a entrega continuar atrasada.`, detalhe: pcs };
    }
    case "financeiro.conciliar": {
      const ids = await movimentosComSugestao(it, origem, cookie);
      return { texto: `Vai aceitar a 1ª sugestão (score ≥ 80, sem empate) de ${ids.length} movimento(s) desta conta, como o botão “Aceitar sugestões” da tela. Os restantes ficam para rever.`, detalhe: ids };
    }
  }
  return { texto: "Sem pré-visualização para esta ação.", detalhe: null };
}

async function movimentosComSugestao(it: LinhaItem, origem: string, cookie: string): Promise<number[]> {
  const d = (it.dados ?? {}) as { empresa?: string; cod_cc?: number };
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const de = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const g = await chamarRota(origem, cookie, "GET", `/api/financeiro/conciliacao?empresa=${encodeURIComponent(d.empresa ?? "")}&cod_cc=${d.cod_cc}&de=${de}&ate=${hoje}`);
  if (!g.ok) throw new Error(erroDe(g));
  const movs = ((g.corpo as { movimentos?: { id: number; estado: string; sugestoes?: { score: number }[] }[] } | null)?.movimentos ?? []);
  return movs.filter((m) => m.estado === "pendente" && (m.sugestoes?.[0]?.score ?? 0) >= 80).map((m) => m.id).slice(0, 25);
}
