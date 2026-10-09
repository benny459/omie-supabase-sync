import "server-only";
// Mensagens ao longo do dia e escada da cobrança (SPEC Serviços "Aria proativa" + SPEC §5.4).
// - Cada mensagem é filtrada pelo perfil: usa a MESMA fila (filtrarItens, escopo "meus").
// - Modos (configuração): desligado · ensaio (só regista em ordem.mensagem) · teste (um resumo só
//   para o e-mail de teste, com [TESTE]) · ligado (Webex direto a cada pessoa).
// - Sem ruído: só nos horários configurados, dias úteis (opção), limite por dia, silêncio com a fila zerada.
// - Escada: Lembrete (0) → 2º aviso (1) → Supervisão (2) → Direção (3), pela idade do item na fila do dono;
//   adiados não contam (saem da fila). Encaminhado parado: o atraso conta para o destino e quem encaminhou é avisado.
import { db, itensAbertos, lerConfig, pessoas, quemPorId, TENANT } from "./servidor";
import { filtrarItens, type LinhaItem } from "./fila";
import { MODULO_POR_ID } from "./modulos";
import { avisar } from "./encaminhar";
import type { ConfigOrdem } from "./config";
import { degrauPorIdade, janelaAtual, min, textoJanela } from "./mensagens-regras";

const BASE = "https://painel.waterworks.com.br";
type Texto = { para: string; nome: string; uid: string; texto: string };
const agoraSP = () => {
  const d = new Date();
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });
  const dia = d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const dow = new Date(dia + "T12:00:00Z").getUTCDay();
  return { hm, dia, util: dow !== 0 && dow !== 6 };
};
async function enviarWebex(para: string, markdown: string): Promise<string | null> {
  const token = process.env.WEBEX_TOKEN;
  if (!token) return "WEBEX_TOKEN não configurado";
  try {
    const r = await fetch("https://webexapis.com/v1/messages", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toPersonEmail: para, markdown }) });
    return r.ok ? null : `Webex ${r.status}`;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}

async function escada(cfg: ConfigOrdem, linhas: LinhaItem[], simular: boolean) {
  const subidas: { id: string; de: number; para: number; dono: string | null; titulo: string }[] = [];
  const agora = new Date().toISOString();
  for (const l of linhas) {
    if (l.estado !== "aberto" || !l.dono_id) continue;
    const novo = degrauPorIdade(l.criado_em, agora, cfg.escada);
    if (novo > l.degrau) subidas.push({ id: l.id, de: l.degrau, para: novo, dono: l.dono_id, titulo: l.titulo });
  }
  if (simular) return { subidas: subidas.length };
  const NOMES = ["lembrete", "2º aviso", "supervisão", "direção"];
  for (const s of subidas) {
    await db().from("item").update({ degrau: s.para }).eq("id", s.id);
    await avisar(s.dono, "escada", `Subiu para ${NOMES[s.para]}: ${s.titulo.replace(/\{\{R\$:[^}]+\}\}/g, "")}`, s.id);
    const l = linhas.find((x) => x.id === s.id);
    if (l?.encaminhado_por) await avisar(l.encaminhado_por, "escada", `O que encaminhou está parado (${NOMES[s.para]}): ${l.titulo.replace(/\{\{R\$:[^}]+\}\}/g, "")}`, null);
  }
  return { subidas: subidas.length };
}

export async function rodarMensagens(o: { simular: boolean; forcarJanela?: string }): Promise<Record<string, unknown>> {
  const cfg = await lerConfig();
  const linhas = await itensAbertos();
  const out: Record<string, unknown> = { modo: cfg.mensagens.modo };
  if (cfg.ativo && cfg.escada.ligada) out.escada = await escada(cfg, linhas, o.simular);
  if (cfg.mensagens.modo === "desligado" && !o.forcarJanela) return out;
  const { hm, dia, util } = agoraSP();
  if (cfg.mensagens.so_dias_uteis && !util && !o.forcarJanela) return { ...out, pulado: "fim de semana" };
  const janela = o.forcarJanela ?? janelaAtual(cfg.mensagens.horarios, hm);
  if (!janela) return { ...out, janela: null };
  const inicio = new Date(dia + "T00:00:00-03:00").toISOString();
  const { data: ja } = await db().from("mensagem").select("destinatario_id, janela").eq("tenant_slug", TENANT).gte("criado_em", inicio);
  const jaRows = (ja ?? []) as { destinatario_id: string | null; janela: string | null }[];
  if (!o.forcarJanela && jaRows.some((x) => x.janela === janela)) return { ...out, janela, pulado: "janela já processada hoje" };

  // ensaio/teste/pré-visualização: calcula como se tudo estivesse ligado, para ver o que CADA pessoa receberia.
  const real = cfg.mensagens.modo === "ligado" && !o.simular;
  const cfgFila: ConfigOrdem = real ? cfg : { ...cfg, ativo: true,
    modulos: Object.fromEntries(Object.keys(MODULO_POR_ID).map((m) => [m, true])),
    detetores: new Proxy({}, { get: () => true }) as Record<string, boolean> };
  const ps = (await pessoas()).filter((p) => p.ativo);
  const nomes = new Map(ps.map((p) => [p.id, p.nome]));
  const textos: Texto[] = [];
  for (const p of ps) {
    const q = await quemPorId(p.id);
    if (!q) continue;
    if (real && !cfg.ativo) continue;                               // ligado de verdade só com a Central ligada
    const enviados = jaRows.filter((x) => x.destinatario_id === p.id).length;
    if (cfg.mensagens.limite_dia > 0 && enviados >= cfg.mensagens.limite_dia) continue;
    const fila = filtrarItens(q, cfgFila, linhas, { escopo: "meus", nomes });
    const meus = fila.itens.filter((i) => i.meu && !i.previa);
    if (!meus.length) continue;                                     // silêncio com a fila zerada
    const { count } = await db().from("item").select("id", { count: "exact", head: true }).eq("tenant_slug", TENANT).eq("dono_id", p.id).gte("resolvido_em", inicio);
    textos.push({ para: p.email, nome: p.nome, uid: p.id, texto: textoJanela(janela, p.nome.split(" ")[0], meus, count ?? 0) });
  }
  // Relatório da supervisão às 18:00: itens no degrau 2+ dos módulos que cada supervisor vê.
  if (min(janela) >= 17 * 60 + 30 && cfg.escada.ligada) {
    for (const email of [...cfg.escada.supervisao_emails, ...cfg.escada.direcao_emails]) {
      const p = ps.find((x) => x.email.toLowerCase() === email.toLowerCase());
      const q = p ? await quemPorId(p.id) : null;
      if (!q) continue;
      const nivel = cfg.escada.direcao_emails.includes(email) ? 3 : 2;
      const parados = filtrarItens(q, cfgFila, linhas, { escopo: "todos", nomes }).itens.filter((i) => i.degrau >= nivel && !i.previa);
      if (!parados.length) continue;
      textos.push({ para: email, nome: q.nome, uid: q.uid, texto: `**✦ Relatório da ${nivel === 3 ? "direção" : "supervisão"} (${parados.length} parado(s))**\n\n${parados.slice(0, 20).map((i) => `- ${i.titulo} · ${MODULO_POR_ID[i.modulo]?.rotulo} · dono: ${i.dono_nome ?? "sem dono"}`).join("\n")}\n\n[Abrir a Central](${BASE}/ordem?escopo=todos)` });
    }
  }
  out.janela = janela;
  out.mensagens = textos.length;
  if (o.simular) return { ...out, previa: textos.map((t) => ({ para: t.para, texto: t.texto })) };

  const modo = cfg.mensagens.modo;
  if (modo === "teste") {
    const para = cfg.mensagens.email_teste || "benny@waterworks.com.br";
    const md = `**[TESTE] Central de Ordem — mensagens das ${janela}** (seriam enviadas a ${textos.length} pessoa(s))\n\n` +
      textos.map((t) => `---\n**Para ${t.nome} <${t.para}>:**\n\n${t.texto}`).join("\n\n");
    const erro = textos.length ? await enviarWebex(para, md.slice(0, 7000)) : null;
    await db().from("mensagem").insert(textos.map((t) => ({ tenant_slug: TENANT, destinatario_id: t.uid, destinatario_email: t.para, canal: "webex", janela, modo, enviado: false, texto: t.texto, erro: erro ? `teste: ${erro}` : `teste: só para ${para}` })));
    if (!textos.length) await db().from("mensagem").insert({ tenant_slug: TENANT, canal: "webex", janela, modo, texto: "(nenhuma mensagem: filas zeradas)" });
    return { ...out, teste_para: para, erro };
  }
  for (const t of textos) {
    const erro = modo === "ligado" ? await enviarWebex(t.para, t.texto) : null;
    await db().from("mensagem").insert({ tenant_slug: TENANT, destinatario_id: t.uid, destinatario_email: t.para, canal: "webex", janela, modo, enviado: modo === "ligado" && !erro, texto: t.texto, erro });
  }
  if (!textos.length) await db().from("mensagem").insert({ tenant_slug: TENANT, canal: "webex", janela, modo, texto: "(nenhuma mensagem: filas zeradas)" });
  return out;
}
