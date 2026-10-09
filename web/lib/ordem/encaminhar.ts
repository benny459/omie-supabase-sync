import "server-only";
// Encaminhamento entre módulos (SPEC §4.4):
// - quem encaminha NÃO precisa de acesso ao outro módulo;
// - o original fica "encaminhado" (a acompanhar) até o destino ser resolvido;
// - o destino nasce "↘ encaminhado por X (módulo)", com a recomendação adaptada e o mesmo porquê;
// - o destinatário recebe aviso; quem encaminhou vê SÓ o estado do destino e recebe aviso de volta.
import { ACAO_DESTINO, DETETOR_POR_TIPO } from "./catalogo";
import { MODULO_POR_ID } from "./modulos";
import { db, lerDonos, TENANT } from "./servidor";
import type { Quem } from "./acesso";
import type { ModuloOrdem, Recomendacao } from "./tipos";
import type { LinhaItem } from "./fila";

async function donoDestino(tipo: string): Promise<string | null> {
  const d = (await lerDonos()).find((x) => x.tipo === tipo);
  return d ? (d.titular_ausente && d.substituto_id ? d.substituto_id : d.titular_id) : null;
}

export async function avisar(destinatario: string | null, tipo: "encaminhado" | "resposta" | "escada" | "acesso" | "info", texto: string, itemId: string | null) {
  if (!destinatario) return;
  await db().from("aviso").insert({ tenant_slug: TENANT, destinatario_id: destinatario, tipo, texto, item_id: itemId });
}

/** Encaminha um item detetado ao módulo de que depende. */
export async function encaminharItem(q: Quem, item: LinhaItem, motivo: string): Promise<{ destino: string; texto: string }> {
  const dep = item.depende_de;
  if (!dep) throw new Error("Este item não depende de outro módulo.");
  const sub = dep.tipo_destino ?? `livre:${dep.modulo}`;
  const tipo = `enc:${sub}`;
  const dono = await donoDestino(tipo);
  const modOrigem = MODULO_POR_ID[item.modulo]?.rotulo ?? item.modulo;
  const rec: Recomendacao = {
    acao: ACAO_DESTINO[sub] ?? item.recomendacao.acao,
    porque: item.recomendacao.porque,
    impacto: `Desbloqueia ${modOrigem}: ${item.titulo}.`,
    confianca: item.recomendacao.confianca,
  };
  const titulo = DETETOR_POR_TIPO[tipo]?.rotulo.replace(/^↘\s*/, "").replace(/\s*\(vem do .*\)$/, "") ?? `Pedido de ${modOrigem}`;
  const { data, error } = await db().from("item").upsert({
    tenant_slug: TENANT, tipo, modulo: dep.modulo, origem_ref: `item:${item.id}`, dono_id: dono,
    urgencia: item.urgencia, rotulo_urgencia: `↘ de ${modOrigem}`,
    titulo: `${titulo}: ${item.titulo}`, resumo: `${motivo}${item.resumo ? ` · ${item.resumo}` : ""}`,
    etapa: null, valor: item.valor, link: item.link && dep.modulo === item.modulo ? item.link : MODULO_POR_ID[dep.modulo]?.tela ?? null,
    recomendacao: rec, dados: { ...(item.dados ?? {}), acao: null, requer: [], motivo }, depende_de: null,
    estado: "aberto", encaminhado_de: item.id, encaminhado_por: q.uid, resolvido_em: null, resolvido_como: null,
  }, { onConflict: "tenant_slug,tipo,origem_ref" }).select("id").single();
  if (error) throw new Error(error.message);
  const destino = (data as { id: string }).id;
  await db().from("item").update({ estado: "encaminhado" }).eq("id", item.id);
  await avisar(dono, "encaminhado", `${modOrigem} encaminhou (${q.nome}): ${titulo} — ${item.titulo}`, destino);
  return { destino, texto: `Encaminhado a ${MODULO_POR_ID[dep.modulo]?.rotulo}. Fica em “A acompanhar”.` };
}

/** Pedido livre (P4) a um módulo que a pessoa pode não ver. */
export async function pedidoLivre(q: Quem, modulo: ModuloOrdem, texto: string, prazo: string | null): Promise<string> {
  const tipo = `enc:livre:${modulo}`;
  const dono = await donoDestino(tipo);
  const ref = `pedido:${q.uid}:${Date.now()}`;
  const { data, error } = await db().from("item").insert({
    tenant_slug: TENANT, tipo, modulo, origem_ref: ref, dono_id: dono, urgencia: "atencao",
    rotulo_urgencia: prazo ? `até ${prazo.slice(8, 10)}/${prazo.slice(5, 7)}` : "pedido",
    titulo: `Pedido de ${q.nome}: ${texto.slice(0, 120)}`, resumo: texto,
    recomendacao: { acao: "Responder ao pedido e marcar como resolvido (ou recusar com motivo).", porque: `Pedido livre de ${q.nome}${prazo ? `, prazo ${prazo}` : ""}.`, confianca: "media" },
    dados: { motivo: texto, prazo, requer: [], acao: null }, encaminhado_por: q.uid, estado: "aberto",
  }).select("id").single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  await avisar(dono, "encaminhado", `Pedido de ${q.nome}: ${texto.slice(0, 140)}`, id);
  return id;
}

/** Destino resolvido/recusado → aviso a quem encaminhou; recusado devolve o original à fila. */
export async function aoDecidirDestino(destino: LinhaItem, estado: "feito" | "recusado", motivo: string | null, q: Quem) {
  const de = destino.encaminhado_por;
  const mod = MODULO_POR_ID[destino.modulo]?.rotulo ?? destino.modulo;
  if (estado === "recusado") {
    if (destino.encaminhado_de) await db().from("item").update({ estado: "aberto" }).eq("id", destino.encaminhado_de).eq("estado", "encaminhado");
    await avisar(de, "resposta", `${mod} recusou (${q.nome}): ${destino.titulo}${motivo ? ` — ${motivo}` : ""}`, destino.encaminhado_de);
  } else {
    await avisar(de, "resposta", `${mod} resolveu (${q.nome}): ${destino.titulo}`, destino.encaminhado_de);
  }
}

/** Itens de origem que saíram da fila sozinhos (ex.: a NF chegou → título desbloqueou) → fecha os destinos e avisa. */
export async function aoResolverOrigem(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data } = await db().from("item").select("id, titulo, dono_id, encaminhado_por, estado").in("encaminhado_de", ids);
  for (const d of (data ?? []) as { id: string; titulo: string; dono_id: string | null; encaminhado_por: string | null; estado: string }[]) {
    if (d.estado === "aberto" || d.estado === "adiado") {
      await db().from("item").update({ estado: "feito", resolvido_em: new Date().toISOString(), resolvido_como: "origem" }).eq("id", d.id);
      await avisar(d.dono_id, "info", `Resolvido na origem: ${d.titulo}`, d.id);
    }
    await avisar(d.encaminhado_por, "resposta", `Resolvido: ${d.titulo}`, null);
  }
}
