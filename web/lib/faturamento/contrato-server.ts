import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { brl, itensDaOs, type ItemContratoDb } from "./contrato-valor";

/* Contratos recorrentes — corrigir a OS gerada com o valor do contrato (09/10/26).
   A OS é atualizada pelo mesmo caminho da tela de Vendas (orders.vendas_salvar), que
   só aceita OS aberta: OS já faturada (recibo emitido) precisa do recibo cancelado antes.
   Nada vai ao Omie. */

const db = () => supaAdmin().schema("orders");

export type HistFatura = {
  id: number; competencia: string; status: string; origem: string; documento: string | null; venda_id: number | null; valor: number;
  emissao: { id: number; tipo: string; status: string; numero: string | null; ambiente: string } | null;
  nfse: { id: number; numero: string } | null;
};
export type DetalheContrato = { contrato: Record<string, unknown>; itens: ItemContratoDb[]; historico_faturas: HistFatura[] };

export async function detalhe(id: number): Promise<DetalheContrato | null> {
  const { data, error } = await db().rpc("contrato_detalhe", { p_id: id });
  if (error) throw new Error(error.message);
  return (data as DetalheContrato | null) ?? null;
}

/** Registro "de → para" (sql/160). Devolve false se a função ainda não existe no banco. */
export async function registrar(id: number, por: string, acao: "alteracao" | "os_atualizada" | "recibo_cancelado", det: Record<string, unknown>,
  comp?: { id: number; valor: number }) {
  const { error } = await db().rpc("contrato_registrar", {
    p_id: id, p_por: por, p_acao: acao, p_detalhe: det, p_comp_id: comp?.id ?? null, p_valor: comp?.valor ?? null,
  });
  if (!error) return true;
  if (error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message)) return false;
  throw new Error(error.message);
}

/** OS geradas pelo contrato que ainda podem ser corrigidas (abertas, sem recibo/NFS-e). */
export const osAbertas = (d: DetalheContrato) =>
  d.historico_faturas.filter((h) => h.origem === "painel" && h.status === "gerado" && h.venda_id && !h.nfse && h.emissao?.status !== "autorizada");

/** Troca os itens da OS pelos itens atuais do contrato (valor, quantidade, descrição). */
export async function reaplicarNaOs(d: DetalheContrato, h: HistFatura, por: string) {
  const id = Number(h.venda_id);
  const { data: doc, error: e1 } = await db().rpc("vendas_documento", { p_id: id });
  if (e1) throw new Error(e1.message);
  if (!doc) throw new Error(`${h.documento ?? "OS"} não encontrada`);
  const o = doc as Record<string, unknown> & { status: string; label: string; valor_total: number };
  if (o.status === "faturado") {
    throw new Error(`${o.label} já está faturada${h.emissao?.numero ? ` (recibo nº ${h.emissao.numero})` : ""}: cancele primeiro o recibo (botão “Cancelar recibo e corrigir”) e depois atualize a OS.`);
  }
  if (o.status !== "aberto") throw new Error(`${o.label} está ${o.status}: não pode ser alterada. Fature a competência de novo, se for o caso.`);
  const itens = itensDaOs(d.itens, h.competencia);
  // Mesmo payload que a tela de Vendas manda: o documento como está, com os itens novos.
  // Sem "parcelas": o banco recalcula pela condição de pagamento com o total novo.
  const p: Record<string, unknown> = { ...o, id, itens };
  for (const k of ["parcelas", "historico", "emissoes", "rcs", "pessoa", "cliente", "condicao", "projeto", "categoria", "label"]) delete p[k];
  const { data: r, error: e2 } = await db().rpc("vendas_salvar", { p, p_por: por });
  if (e2) throw new Error(`${o.label}: ${e2.message}`);
  const para = Number((r as { valor_total: number }).valor_total);
  const de = Number(o.valor_total);
  await registrar(Number(d.contrato.id), por, "os_atualizada",
    { documento: o.label, competencia: h.competencia, de, para, texto: `${o.label}: ${brl(de)} → ${brl(para)}` }, { id: h.id, valor: para }).catch(() => false);
  await db().rpc("vendas_refrescar").then(() => null, () => null);
  return { documento: o.label, de, para, venda_id: id };
}
