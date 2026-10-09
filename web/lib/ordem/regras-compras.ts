// Central de Ordem — regras PURAS dos detetores de Compras (testáveis sem banco).
// As regras de situação vêm de lib/compras.ts (as mesmas do kanban): naoEnviado, atrasado.
import { atrasado, naoEnviado, type PedidoLista } from "@/lib/compras";
import { dentroTolerancia, type ConfigOrdem } from "./config";
import { R, type ItemDetectado } from "./tipos";

export type NfSugestao = { chave: string; numero: string; valor: number; emitente: string; emissao?: string; status: string; score?: number; motivo?: string };

const dias = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a.slice(0, 10) + "T12:00:00Z")) / 86_400_000);
const linkPc = (p: { id: number }) => `/erp/compras?pedido=${p.id}`;
const nomePc = (p: PedidoLista) => `PC ${p.num}${p.emp && p.emp !== "SF" ? ` (${p.emp})` : ""}`;

/** Pendentes de aprovação = a mesma regra da coluna "Pedido de Compra · Pendentes" do kanban (TelaCompras). */
export const pendenteAprovacao = (p: PedidoLista) =>
  p.tipo === "PC" && ["10", "15", "35"].includes(p.etapa) && p.aprov !== "aprovado" && p.aprov !== "nao_aprovado";

/** PCs pendentes agrupados por projeto (ou "sem projeto") — um cartão por grupo, como o mockup. */
export function detetarPendentesAprovacao(pedidos: PedidoLista[], hoje: string): ItemDetectado[] {
  const grupos = new Map<string, PedidoLista[]>();
  for (const p of pedidos.filter(pendenteAprovacao)) {
    const k = (p.proj ?? "").trim() || "—";
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const out: ItemDetectado[] = [];
  for (const [proj, ps] of grupos) {
    const total = ps.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const maisVelho = ps.map((p) => p.emissao ?? p.criadoEm ?? hoje).sort()[0];
    const parado = dias(maisVelho, hoje);
    const pj = /^\s*PJ\s*\d/i.test(proj);
    const semProj = proj === "—";
    out.push({
      tipo: "pc_pendente_aprovacao", modulo: "compras",
      origem_ref: `projeto:${proj}`,
      titulo: semProj ? `Aprovar ${ps.length} PC(s) sem projeto` : `Aprovar ${ps.length} PC(s) de ${proj}`,
      resumo: `${R(total)} · o mais antigo espera há ${parado} d`,
      etapa: "Aprovação", valor: total,
      urgencia: parado >= 3 ? "critica" : "atencao", rotulo_urgencia: parado >= 3 ? `parado ${parado} d` : "aprovar",
      link: ps.length === 1 ? linkPc(ps[0]) : "/erp/compras",
      recomendacao: {
        acao: pj ? `Aprovar os PCs de ${proj} que cabem no budget e na sua alçada; os que estouram ficam com motivo.`
          : `Aprovar os ${ps.length} PC(s) dentro da sua alçada.`,
        porque: `${ps.length} PC(s) em “Pedido de Compra · Pendentes” (${ps.slice(0, 6).map((p) => p.num).join(", ")}${ps.length > 6 ? "…" : ""}). ` +
          (pj ? "Projeto de obra: a rota de aprovação aplica a regra do budget (acima do budget pede motivo e avisa o Benny)." : "A rota de aprovação aplica a alçada de cada aprovador."),
        impacto: "Os PCs aprovados ficam prontos para enviar ao fornecedor; quem não pode aprovar algum vê o motivo, como na tela.",
        alternativas: [{ acao: "Abrir um a um na tela", nota: "folha do pedido" }],
        confianca: pj ? "media" : "alta",
        risco: pj ? "Projeto pode estar acima do budget — a rota pede confirmação com motivo." : undefined,
      },
      dados: { pcs: ps.map((p) => ({ id: p.id, num: p.num, valor: p.valor, forn: p.forn, aprov: p.aprov })) },
      acao: {
        chave: "compras.aprovar", rotulo: `Aprovar ${ps.length}`, irreversivel: true,
        rota: { metodo: "POST", caminho: "/api/compras/acao", corpo: { acao: "aprovar", ids: ps.map((p) => p.id), status: "aprovado" } },
        desfazer: { metodo: "POST", caminho: "/api/compras/acao", corpo: { acao: "aprovar", ids: ps.map((p) => p.id), status: "aguardando" } },
      },
    });
  }
  return out;
}

/** PC aprovado e não enviado — mesma regra (naoEnviado) do chip "✉ Não enviados". Um cartão por PC. */
export function detetarNaoEnviados(pedidos: PedidoLista[], hoje: string): ItemDetectado[] {
  return pedidos.filter((p) => naoEnviado({ ...p, enviadoEm: p.enviadoEm ?? null })).map((p) => {
    const d = p.aprovEm ? dias(p.aprovEm, hoje) : 0;
    return {
      tipo: "pc_nao_enviado", modulo: "compras", origem_ref: `pc:${p.id}`,
      titulo: `Enviar ${nomePc(p)} ao fornecedor`,
      resumo: `${p.forn ?? "—"} · ${R(p.valor)} · aprovado${p.aprovEm ? ` há ${d} d` : ""}`,
      etapa: "Enviado ao fornecedor", valor: p.valor,
      urgencia: d >= 1 ? "critica" : "atencao", rotulo_urgencia: d >= 1 ? `aprovado há ${d} d` : "hoje",
      link: linkPc(p), dono_email: p.comprador ?? null,
      recomendacao: {
        acao: `Enviar o ${nomePc(p)} ao fornecedor por e-mail, com o PDF.`,
        porque: `Aprovado${p.aprovPor ? ` por ${p.aprovPor.split("@")[0]}` : ""}${p.aprovEm ? ` em ${p.aprovEm.slice(8, 10)}/${p.aprovEm.slice(5, 7)}` : ""} e sem registo de envio.`,
        impacto: "Cada dia sem envio é um dia a mais na entrega.",
        alternativas: [{ acao: "Marcar como enviado (WhatsApp/em mãos)", nota: "na folha do pedido" }],
        confianca: "alta",
        conferir: ["E-mail do fornecedor no cadastro", "Valores visíveis ou PDF sem valores"],
      },
      dados: { pc: { id: p.id, num: p.num, forn: p.forn } },
      acao: {
        chave: "compras.enviar_fornecedor", rotulo: "Enviar ao fornecedor", irreversivel: true,
        // corpo completo (para/assunto) é montado na hora pela pré-visualização (GET /api/compras/email?id=)
        rota: { metodo: "POST", caminho: "/api/compras/email", corpo: { id: p.id } },
        desfazer: null,
      },
    };
  });
}

/** Entrega atrasada há mais de N dias (regra `atrasado` do kanban), só PCs aprovados e recentes
 *  (o espelho do Omie é histórico desde 02/10/26). Um cartão por fornecedor. */
export function detetarEntregasAtrasadas(pedidos: PedidoLista[], hoje: string, cfg: ConfigOrdem): ItemDetectado[] {
  const min = Math.max(0, cfg.parametros.entrega_atrasada_dias || 7);
  const porForn = new Map<string, PedidoLista[]>();
  for (const p of pedidos) {
    if (p.tipo !== "PC" || p.aprov !== "aprovado" || !atrasado(p) || !p.previsao) continue;
    const d = dias(p.previsao, hoje);
    if (d < min || d > 180) continue;
    const k = p.cnpj || p.forn || "—";
    porForn.set(k, [...(porForn.get(k) ?? []), p]);
  }
  const out: ItemDetectado[] = [];
  for (const [k, ps] of porForn) {
    const pior = Math.max(...ps.map((p) => dias(p.previsao!, hoje)));
    const projs = [...new Set(ps.map((p) => p.proj).filter(Boolean))] as string[];
    out.push({
      tipo: "entrega_atrasada", modulo: "compras", origem_ref: `fornecedor:${k}`,
      titulo: `Cobrar ${ps[0].forn ?? "fornecedor"}: ${ps.length} PC(s) com entrega atrasada`,
      resumo: `até ${pior} d de atraso${projs.length ? ` · afeta ${projs.slice(0, 3).join(", ")}${projs.length > 3 ? "…" : ""}` : ""}`,
      etapa: "Enviado ao fornecedor", valor: ps.reduce((s, p) => s + (Number(p.valor) || 0), 0),
      urgencia: projs.some((x) => /^\s*PJ/i.test(x)) || pior > 15 ? "critica" : "atencao",
      rotulo_urgencia: projs.length ? `afeta ${projs.length} projeto(s)` : `${pior} d`,
      link: ps.length === 1 ? linkPc(ps[0]) : "/erp/compras",
      dono_email: ps[0].comprador ?? null,
      recomendacao: {
        acao: `Cobrar o fornecedor na conversa de cada PC e pedir nova data de entrega.`,
        porque: `Previsão de entrega vencida (${ps.slice(0, 5).map((p) => `PC ${p.num} em ${p.previsao!.slice(8, 10)}/${p.previsao!.slice(5, 7)}`).join("; ")}${ps.length > 5 ? "…" : ""}) e sem recebimento.`,
        impacto: projs.length ? `Atualiza a previsão dos materiais de ${projs.join(", ")}.` : "Atualiza a previsão de entrega.",
        alternativas: [{ acao: "Registar nova previsão sem escrever ao fornecedor", nota: "na folha do pedido" }],
        confianca: "alta",
      },
      dados: { pcs: ps.map((p) => ({ id: p.id, num: p.num, previsao: p.previsao, proj: p.proj })) },
      acao: {
        chave: "compras.cobrar_fornecedor", rotulo: "Cobrar fornecedor", irreversivel: true,
        rota: { metodo: "POST", caminho: "/api/compras/email/conversa", corpo: {}, lote: ps.map((p) => ({ id: p.id, texto: textoCobranca([p]) })) },
        desfazer: null,
      },
    });
  }
  return out;
}

export function textoCobranca(ps: { num: string; previsao?: string | null }[]): string {
  const l = ps.map((p) => `- Pedido ${p.num}${p.previsao ? ` (previsão ${p.previsao.slice(8, 10)}/${p.previsao.slice(5, 7)})` : ""}`).join("\n");
  return `Bom dia,\n\nA previsão de entrega do(s) pedido(s) abaixo já passou e ainda não recebemos o material:\n${l}\n\nPor favor, confirme a nova data de entrega.\n\nObrigado.`;
}

/** Recebido e não conferido além do prazo (M2). */
export function detetarRecebidosNaoConferidos(pedidos: PedidoLista[], hoje: string, cfg: ConfigOrdem): ItemDetectado[] {
  const lim = Math.max(0, cfg.parametros.m2_conferencia_dias_uteis || 2);
  return pedidos.filter((p) => p.tipo === "PC" && p.etapa === "60" && p.dtRec && diasUteis(p.dtRec, hoje) > lim).map((p) => ({
    tipo: "recebido_nao_conferido", modulo: "compras" as const, origem_ref: `pc:${p.id}`,
    titulo: `Conferir ${nomePc(p)} recebido`,
    resumo: `${p.forn ?? "—"} · NF ${p.nf ?? "—"} · recebido há ${diasUteis(p.dtRec!, hoje)} dia(s) útil(eis)`,
    etapa: "Recebido", valor: p.valor, urgencia: "atencao" as const, rotulo_urgencia: "conferir",
    link: linkPc(p), dono_email: p.comprador ?? null,
    recomendacao: {
      acao: "Conferir itens, quantidades e valores com a NF e liberar o pagamento.",
      porque: `Recebido em ${p.dtRec!.slice(8, 10)}/${p.dtRec!.slice(5, 7)} e ainda em “Recebido”.`,
      impacto: "Liberta o título no Financeiro (sai de “Aguardando NF/conferência”).",
      confianca: "alta" as const,
    },
    dados: { pc: { id: p.id, num: p.num } }, acao: null,
  }));
}

/** NF que chegou (Focus) e tem sugestão de PC por casar. Dentro da tolerância M1 → lote; fora → decisão. */
export function detetarNfColunaMeio(
  pedidos: PedidoLista[], sugestoes: Map<number, NfSugestao[]>, hoje: string, cfg: ConfigOrdem,
): ItemDetectado[] {
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const lote: { p: PedidoLista; n: NfSugestao }[] = [];
  const out: ItemDetectado[] = [];
  for (const [id, nfs] of sugestoes) {
    const p = porId.get(id);
    if (!p) continue;
    for (const n of nfs.filter((x) => x.status === "sugerido")) {
      const dif = Number(n.valor) - Number(p.valor);
      if (dentroTolerancia(dif, Number(p.valor) || 0, cfg.parametros)) { lote.push({ p, n }); continue; }
      const pctv = p.valor ? (dif / Number(p.valor)) * 100 : 0;
      const horas = n.emissao ? dias(n.emissao, hoje) * 24 : 0;
      const longe = Math.abs(pctv) > 50;   // provável outro pedido ou entrega parcial, não divergência de preço
      out.push({
        tipo: "nf_divergente", modulo: "compras", origem_ref: `nfe:${n.chave}|pc:${p.id}`,
        titulo: `NF-e ${n.numero} vem ${pctv >= 0 ? "+" : ""}${pctv.toFixed(1).replace(".", ",")}% do ${nomePc(p)}`,
        resumo: `${n.emitente || p.forn || "—"} · ${R(n.valor)} na NF vs ${R(p.valor)} no PC`,
        etapa: "Faturado pelo fornecedor", valor: n.valor,
        urgencia: !longe && horas > (cfg.parametros.m2_nf_horas || 24) ? "critica" : "atencao", rotulo_urgencia: longe ? "rever sugestão" : "decidir",
        link: linkPc(p), dono_email: p.comprador ?? null,
        recomendacao: longe ? {
          acao: "Rever a sugestão: o valor é muito diferente do PC — provavelmente é de outro pedido ou de uma entrega parcial.",
          porque: `Sugestão automática da Focus${n.motivo ? ` (${n.motivo})` : ""} com diferença de ${pctv.toFixed(0)}%.`,
          impacto: "Evita casar a NF errada; a sugestão descartada não volta.",
          alternativas: [{ acao: "Casar mesmo assim", nota: "se for entrega parcial deste PC" }],
          confianca: "baixa",
        } : {
          acao: dif > 0 ? `Pedir ao fornecedor carta de correção ou desconto de ${R(dif)} antes de casar.` : `Casar a NF (vem ${R(-dif)} abaixo do PC) e conferir se faltou item.`,
          porque: `Mesmo pedido sugerido pela Focus${n.motivo ? ` (${n.motivo})` : ""}; a diferença passa a tolerância configurada.`,
          impacto: dif > 0 ? `Evita pagar ${R(dif)} a mais.` : "O PC fica com NF de valor menor — conferir quantidades.",
          alternativas: [{ acao: "Casar mesmo assim", nota: "regista no histórico do PC" }, { acao: "Descartar a sugestão", nota: "na folha do pedido" }],
          confianca: "media",
        },
        dados: { chave: n.chave, pedido: p.id, num: p.num, nf: n.numero, dif },
        acao: {
          chave: "compras.casar_nf", rotulo: "Casar mesmo assim", irreversivel: false,
          rota: { metodo: "POST", caminho: "/api/compras/acao", corpo: { acao: "nf_casar", chave: n.chave, pedido: p.id } },
          desfazer: { metodo: "POST", caminho: "/api/compras/acao", corpo: { acao: "nf_descasar", chave: n.chave, pedido: p.id } },
        },
      });
    }
  }
  if (lote.length) {
    const total = lote.reduce((s, x) => s + Number(x.n.valor || 0), 0);
    out.push({
      tipo: "nf_casar_lote", modulo: "compras", origem_ref: "lote:nf_casar",
      titulo: `Confirmar ${lote.length} NF que casam com o PC`,
      resumo: `chegadas pela Focus · valor dentro da tolerância · ${R(total)}`,
      etapa: "Faturado pelo fornecedor", valor: total, urgencia: "atencao", rotulo_urgencia: "hoje",
      link: "/erp/compras",
      recomendacao: {
        acao: `Casar as ${lote.length} NF com os seus PCs de uma vez.`,
        porque: `Sugestão da Focus com diferença de valor dentro da tolerância (${lote.slice(0, 5).map((x) => `NF ${x.n.numero} ↔ PC ${x.p.num}`).join("; ")}${lote.length > 5 ? "…" : ""}).`,
        impacto: "A coluna do meio fica só com o que precisa de decisão.",
        alternativas: [{ acao: "Abrir uma a uma", nota: `${lote.length} decisões na tela` }],
        confianca: "alta",
      },
      dados: { pares: lote.map((x) => ({ chave: x.n.chave, pedido: x.p.id, num: x.p.num, nf: x.n.numero, dif: Number(x.n.valor) - Number(x.p.valor) })) },
      acao: {
        chave: "compras.casar_nf", rotulo: `Casar ${lote.length}`, irreversivel: false,
        rota: { metodo: "POST", caminho: "/api/compras/acao", corpo: {}, lote: lote.map((x) => ({ acao: "nf_casar", chave: x.n.chave, pedido: x.p.id })) },
        desfazer: { metodo: "POST", caminho: "/api/compras/acao", corpo: {}, lote: lote.map((x) => ({ acao: "nf_descasar", chave: x.n.chave, pedido: x.p.id })) },
      },
    });
  }
  return out;
}

export type NfSemPedido = { chave: string; numero: string; emitente: string; valor: number; emissao: string; cnpj?: string };

/** NF-e chegou sem pedido (mesma lista do alarme "⛔ NF sem pedido" — compras_nfs_sem_pedido). */
export function detetarNfSemPedido(nfs: NfSemPedido[], hoje: string): ItemDetectado[] {
  return nfs.map((n) => {
    const d = n.emissao ? dias(n.emissao, hoje) : 0;
    return {
      tipo: "nf_sem_pedido", modulo: "compras" as const, origem_ref: `nfe:${n.chave}`,
      titulo: `NF-e ${n.numero} chegou sem pedido de compra`,
      resumo: `${n.emitente} · ${R(n.valor)} · emitida há ${d} d`,
      etapa: "Faturado pelo fornecedor", valor: n.valor, urgencia: "critica" as const, rotulo_urgencia: "não pagar até casar",
      link: "/erp/compras",
      recomendacao: {
        acao: "Gerar o PC retroativo a partir da NF (vai para aprovação) ou casar com um PC existente.",
        porque: "NF lançada pela Focus sem PC confirmado: não passou pela alçada.",
        impacto: "Regulariza a alçada e liberta o pagamento no Financeiro.",
        alternativas: [{ acao: "Dispensar com motivo", nota: "quem tem “Dispensar NF sem pedido”" }],
        confianca: "alta",
      },
      dados: { chave: n.chave, numero: n.numero }, acao: null,
    };
  });
}

/** Dias úteis (seg–sex) entre duas datas ISO. */
export function diasUteis(de: string, ate: string): number {
  let n = 0;
  const d = new Date(de.slice(0, 10) + "T12:00:00Z"), fim = new Date(ate.slice(0, 10) + "T12:00:00Z");
  while (d < fim) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
