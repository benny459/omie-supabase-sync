// Situação do pedido de compra — UMA regra e UMA paleta para o painel inteiro
// (07/10/26). Pedido do Benny: "Pedido de Compra" não é situação (a coluna PC já
// diz que há PC) e não dava para distinguir aprovado de pendente; "Pedido" e
// "Aprovado" eram azuis, "Recebido" e "Conferido" verdes.
// Usada na lista de materiais do projeto, no Compras (kanban e tabela) e nas
// cores das etapas (lib/compras ETAPAS) e dos status de aprovação do /pcs.
// Pura — testada em scripts/testes/situacao-pc.test.ts.

export type EstadoPc = "requisicao" | "aguardando" | "reprovado" | "cancelado" | "devolucao" | "aprovado" | "enviado" | "faturado" | "recebido" | "conferido";

export const ESTADOS_PC: Record<EstadoPc, { rot: string; cor: string; ajuda: string }> = {
  requisicao: { rot: "Requisição",            cor: "#94A3B8", ajuda: "RC — ainda não virou pedido de compra" },
  aguardando: { rot: "Aguardando aprovação",  cor: "#F59E0B", ajuda: "PC criado, ainda sem aprovação" },
  reprovado:  { rot: "Reprovado",             cor: "#E11D48", ajuda: "aprovação negada" },
  cancelado:  { rot: "Cancelado",             cor: "#BE123C", ajuda: "pedido cancelado" },
  devolucao:  { rot: "Devolução",             cor: "#7C6F9B", ajuda: "material devolvido ao fornecedor (total ou parcial) — o PC segue ativo, o devolvido sai da conta do projeto" },
  aprovado:   { rot: "Aprovado",              cor: "#2563EB", ajuda: "aprovado, ainda não enviado ao fornecedor" },
  enviado:    { rot: "Enviado ao fornecedor", cor: "#6366F1", ajuda: "pedido mandado ao fornecedor (e-mail do PC)" },
  faturado:   { rot: "Faturado",              cor: "#A855F7", ajuda: "NF emitida pelo fornecedor — a caminho" },
  recebido:   { rot: "Recebido",              cor: "#0D9488", ajuda: "mercadoria chegou (parcial ou total)" },
  conferido:  { rot: "Conferido",             cor: "#16A34A", ajuda: "itens, quantidades e valores batidos com pedido e NF" },
};
/** Ordem da legenda. */
export const ORDEM_ESTADOS: EstadoPc[] = ["aguardando", "aprovado", "enviado", "faturado", "recebido", "conferido", "devolucao", "reprovado", "cancelado"];
export const LEGENDA_SITUACAO = ORDEM_ESTADOS.map((k) => `■ ${ESTADOS_PC[k].rot} — ${ESTADOS_PC[k].ajuda}`).join("\n");

export type DadosPc = {
  etapa?: string | null; aprov?: string | null; nf?: string | null; cancelado?: boolean | null;
  enviado_em?: string | null; dt_fat?: string | null; dt_rec?: string | null;
  qtd?: number | null; qtd_recebida?: number | null;
  aprov_por?: string | null; aprov_em?: string | null;
  /** devolução de material registrada no painel (sql/146) */
  devolucao?: "total" | "parcial" | null;
};

/** Estado real do PC: aprovação + etapa da compra. */
export function estadoPc(p: DadosPc): { chave: EstadoPc; rot: string; cor: string; parcial: boolean } {
  const rec = Number(p.qtd_recebida) || 0, qtd = Number(p.qtd) || 0;
  const parcial = rec > 0 && qtd > 0 && rec < qtd - 1e-6;
  const k: EstadoPc =
    p.cancelado ? "cancelado"
    : p.devolucao ? "devolucao"
    : p.aprov === "nao_aprovado" ? "reprovado"
    : p.etapa === "80" ? "conferido"
    : p.etapa === "60" || rec > 0 || !!p.dt_rec ? "recebido"
    : p.etapa === "40" || !!p.nf || !!p.dt_fat ? "faturado"
    : p.etapa === "35" || !!p.enviado_em ? "enviado"
    : p.etapa === "20" ? "requisicao"
    : p.aprov === "aprovado" || p.aprov === "na" ? "aprovado"
    : "aguardando";
  const e = ESTADOS_PC[k];
  const rot = k === "recebido" && parcial ? "Recebido parcial"
    : k === "devolucao" ? (p.devolucao === "total" ? "Devolução total" : "Devolução parcial") : e.rot;
  return { chave: k, rot, cor: e.cor, parcial: parcial || (k === "devolucao" && p.devolucao !== "total") };
}

const d = (s?: string | null) => {
  const m = s ? String(s).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : null;
};
const quem = (e?: string | null) => (e ? e.split("@")[0] : null);

/** Dica da pílula: a data do estado, quem aprovou e a NF. */
export function dicaEstadoPc(p: DadosPc & { previsao?: string | null }): string {
  const e = estadoPc(p);
  const partes: string[] = [e.rot];
  if (e.chave === "conferido" || e.chave === "recebido") {
    if (p.dt_rec) partes.push(`recebido em ${d(p.dt_rec)}`);
    if (p.qtd_recebida != null && p.qtd) partes.push(`${p.qtd_recebida} de ${p.qtd} recebidos`);
  }
  if (e.chave === "faturado" && p.dt_fat) partes.push(`faturado em ${d(p.dt_fat)}`);
  if (e.chave === "enviado" && p.enviado_em) partes.push(`enviado em ${d(p.enviado_em)}`);
  if (p.nf) partes.push(`NF ${p.nf}`);
  if (p.aprov === "aprovado") partes.push(`aprovado${p.aprov_por ? ` por ${quem(p.aprov_por)}` : ""}${p.aprov_em ? ` em ${d(p.aprov_em)}` : ""}`);
  if (["aguardando", "aprovado", "enviado"].includes(e.chave) && p.previsao) partes.push(`previsão ${d(p.previsao)}`);
  return partes.join(" · ");
}
