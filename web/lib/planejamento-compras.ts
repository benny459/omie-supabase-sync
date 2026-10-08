// Planejamento de compras por item (08/10/26, spec E) — puro, testado em
// scripts/testes/planejamento-compras.test.ts. A view approval.v_rc_projetos_itens
// (sql/128) calcula o mesmo `comprar_ate` no banco; aqui é para refletir na hora o que
// se edita na tela, antes de gravar.
//
//   prazo efetivo = prazo MANUAL do fornecedor (⏱ Prazos por fornecedor)
//                 → prazo do item no catálogo (cat_entrega_dias, média pedido → NF)
//                 → histórico do fornecedor (média do catálogo de compras)
//                 → 15 dias ("prazo estimado")
//   comprar até   = necessário em − prazo efetivo − folga (FOLGA_ENTREGA_DIAS)
//   status sem PC: comprar até < hoje → atrasado · ≤ hoje + 7 → comprar agora · senão em Nd
//
// O manual vem antes do prazo do item de propósito: quem ajusta o prazo da ACQUA IMPORT
// para 10 dias quer ver TODOS os itens dela sem PC mudarem (aceite da spec E).

import { FOLGA_ENTREGA_DIAS } from "@/lib/sinal-entrega";

export const PRAZO_ESTIMADO_DIAS = 15;
export const JANELA_AGORA_DIAS = 7;

/** Mesmo texto de approval._norm_item (sql/89): minúsculo, sem acento, só [a-z0-9/.,x]. */
export const normFornecedor = (t: string | null | undefined) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/.,x]+/g, " ").trim();

export type PrazoFornecedor = { norm: string; nome: string; historico: number | null; manual: number | null };
export type FontePrazo = "manual" | "item" | "historico" | "estimado";

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
export const somaDias = (base: string, n: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const hojeIso = () => iso(new Date(Date.now() - 3 * 3600000)); // dia de Brasília

/** Prazo efetivo de um item. */
export function prazoEfetivo(a: { prazoItem?: number | null; fornecedor?: string | null; prazos?: Map<string, PrazoFornecedor> }):
  { prazo: number; fonte: FontePrazo; estimado: boolean } {
  const f = a.fornecedor ? a.prazos?.get(normFornecedor(a.fornecedor)) : undefined;
  if (f?.manual != null) return { prazo: f.manual, fonte: "manual", estimado: false };
  const pi = a.prazoItem != null && Number.isFinite(Number(a.prazoItem)) && Number(a.prazoItem) > 0 ? Math.round(Number(a.prazoItem)) : null;
  if (pi != null) return { prazo: pi, fonte: "item", estimado: false };
  if (f?.historico != null) return { prazo: f.historico, fonte: "historico", estimado: false };
  return { prazo: PRAZO_ESTIMADO_DIAS, fonte: "estimado", estimado: true };
}

export type PlanoItem = {
  status: "semdata" | "compc" | "atrasado" | "agora" | "ok";
  comprarAte: string | null; prazo: number; fonte: FontePrazo; estimado: boolean;
  /** dias de hoje até o comprar até (negativo = passou) */ dias: number | null;
  chegadaSemPc: string; texto: string;
};

/** O plano de compra de UM item (sem PC: quando pedir; com PC: "compc", a lógica do sinal de entrega vale). */
export function planejarItem(a: {
  necessario: string | null | undefined; temPc: boolean; prazoItem?: number | null; fornecedor?: string | null;
  prazos?: Map<string, PrazoFornecedor>; hoje?: string; folga?: number;
}): PlanoItem {
  const hoje = a.hoje ?? hojeIso();
  const { prazo, fonte, estimado } = prazoEfetivo(a);
  const chegadaSemPc = somaDias(hoje, prazo);
  const nec = a.necessario && /^\d{4}-\d{2}-\d{2}/.test(a.necessario) ? a.necessario.slice(0, 10) : null;
  const base = { prazo, fonte, estimado, chegadaSemPc };
  if (!nec) return { ...base, status: a.temPc ? "compc" : "semdata", comprarAte: null, dias: null, texto: a.temPc ? "com PC" : "sem data" };
  const comprarAte = somaDias(nec, -(prazo + (a.folga ?? FOLGA_ENTREGA_DIAS)));
  const dias = difDias(comprarAte, hoje);
  if (a.temPc) return { ...base, status: "compc", comprarAte, dias, texto: "com PC" };
  if (dias < 0) return { ...base, status: "atrasado", comprarAte, dias, texto: `atrasado ${-dias}d` };
  if (dias <= JANELA_AGORA_DIAS) return { ...base, status: "agora", comprarAte, dias, texto: "comprar agora" };
  return { ...base, status: "ok", comprarAte, dias, texto: `em ${dias}d` };
}
