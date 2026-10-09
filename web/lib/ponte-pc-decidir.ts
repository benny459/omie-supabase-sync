// Ponte PC → Lista de materiais — a DECISÃO, pura (09/10/26). Testada em
// scripts/testes/ponte-pc.test.ts. A leitura/gravação fica em lib/ponte-pc.ts.
//
// Um item de PC do projeto está COBERTO pela lista quando (a mesma regra do "Comprado
// fora da lista" + o que a grade mostra como "Comprado"):
//   1. alguma linha tem pc_item_id = o item (vínculo direto);
//   2. alguma linha veio de uma RC atendida por este item (compras.item_rc);
//   3. alguma linha antiga ligada só pelo NÚMERO do PC casa com ele dentro do PC
//      (acharLinhaPc: código igual, senão descrição parecida, senão PC de uma linha só);
//   4. o casamento automático (rc_projetos_autolink) tem uma linha sem PC com certeza
//      (código igual, ou descrição ≥ 0,6 com as mesmas medidas) → a ponte LIGA a linha
//      ao item em vez de criar outra (não duplica o item nem o projetado).
// Fora isso, e se o item nunca foi tratado pela ponte (rastro), ele ENTRA na lista.
// Não entram: PC escondido no painel, item devolvido por inteiro, item já tratado
// (a pessoa pode ter excluído a linha de propósito — não volta).
import { acharLinhaPc, type LinhaPc } from "@/lib/lista-pc-linha";

export type ItemPc = {
  pc_item_id: number; pedido_id: number; numero: string; produto_cod: string | null; ncod_prod?: number | null;
  descricao: string; unidade: string | null; qtd: number; valor_unit: number; valor: number; previsao: string | null;
  fornecedor?: string | null; obs?: string | null;
};
export type LinhaLista = {
  id: string; equipamento: string; item: string; modelo?: string | null; cat_codigo?: string | null;
  pc_item_id?: number | null; rc_item_id?: number | null; pc_numero?: string | null; origem?: string | null;
};
export type Rastro = { pc_item_id: number; status: "inserido" | "ligado" | "removido_cancelado"; lista_id: string | null; pc_numero: string };
export type Candidato = { lista_id: string; pc_item_id: number; auto: boolean };

export type Decisao = {
  inserir: (ItemPc & { qtd_liquida: number })[];
  ligar: { lista_id: string; item: ItemPc }[];
  cobertos: { pc_item_id: number; por: "vinculo" | "rc" | "numero" }[];
  pulados: { pc_item_id: number; por: "escondido" | "devolvido" | "rastro" }[];
};

/** PCs citados por texto na linha ("7262, 7300"). */
export const numerosDaLinha = (pc: string | null | undefined) =>
  String(pc ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function decidirPonte(a: {
  itens: ItemPc[]; linhas: LinhaLista[];
  /** pc_item_id atendidos por RCs das linhas da lista (compras.item_rc). */
  viaRc: Set<number>;
  /** casamentos do autolink (sem aplicar) — só os `auto` contam. */
  candidatos?: Candidato[];
  escondidos?: Set<string>;
  /** quantidade devolvida por item (devoluções ativas). */
  devolvido?: Map<number, number>;
  rastro?: Map<number, Rastro>;
}): Decisao {
  const out: Decisao = { inserir: [], ligar: [], cobertos: [], pulados: [] };
  const diretos = new Set(a.linhas.map((l) => Number(l.pc_item_id)).filter(Boolean));
  // 3. linhas antigas só com o nº do PC: o item que cada uma casa dentro do PC
  const porPc = new Map<string, ItemPc[]>();
  for (const i of a.itens) porPc.set(i.numero, [...(porPc.get(i.numero) ?? []), i]);
  const porNumero = new Set<number>();
  for (const l of a.linhas) {
    if (l.pc_item_id || l.rc_item_id) continue;
    for (const n of numerosDaLinha(l.pc_numero)) {
      const its = porPc.get(n);
      if (!its?.length) continue;
      const linhasPc: (LinhaPc & { id: number })[] = its.map((i) => ({ id: i.pc_item_id, cod: i.produto_cod, desc: i.descricao,
        qtd: Number(i.qtd) || 0, vu: Number(i.valor_unit) || 0, valor: Number(i.valor) || 0, rec: null }));
      const achou = acharLinhaPc({ codigo: l.cat_codigo, texto: [l.item, l.modelo].filter(Boolean).join(" ") }, linhasPc) as (LinhaPc & { id?: number }) | null;
      if (achou?.id) porNumero.add(achou.id);
    }
  }
  const linhaLivre = new Map(a.linhas.filter((l) => !l.pc_item_id && !l.rc_item_id && !numerosDaLinha(l.pc_numero).length).map((l) => [l.id, l]));
  const tomadas = new Set<string>();
  const candPorItem = new Map<number, Candidato>();
  for (const c of a.candidatos ?? []) if (c.auto && !candPorItem.has(c.pc_item_id)) candPorItem.set(c.pc_item_id, c);

  for (const i of a.itens) {
    if (diretos.has(i.pc_item_id)) { out.cobertos.push({ pc_item_id: i.pc_item_id, por: "vinculo" }); continue; }
    if (a.viaRc.has(i.pc_item_id)) { out.cobertos.push({ pc_item_id: i.pc_item_id, por: "rc" }); continue; }
    if (porNumero.has(i.pc_item_id)) { out.cobertos.push({ pc_item_id: i.pc_item_id, por: "numero" }); continue; }
    if (a.escondidos?.has(String(i.numero))) { out.pulados.push({ pc_item_id: i.pc_item_id, por: "escondido" }); continue; }
    const r = a.rastro?.get(i.pc_item_id);
    if (r && r.status !== "removido_cancelado") { out.pulados.push({ pc_item_id: i.pc_item_id, por: "rastro" }); continue; }
    const liquida = Math.round(((Number(i.qtd) || 0) - (a.devolvido?.get(i.pc_item_id) ?? 0)) * 10000) / 10000;
    if ((Number(i.qtd) || 0) > 0 && !(liquida > 0)) { out.pulados.push({ pc_item_id: i.pc_item_id, por: "devolvido" }); continue; }
    const c = candPorItem.get(i.pc_item_id);
    if (c && linhaLivre.has(c.lista_id) && !tomadas.has(c.lista_id)) {
      tomadas.add(c.lista_id);
      out.ligar.push({ lista_id: c.lista_id, item: i });
      continue;
    }
    out.inserir.push({ ...i, qtd_liquida: (Number(i.qtd) || 0) > 0 ? liquida : Number(i.qtd) || 0 });
  }
  return out;
}

/** Linhas que a ponte criou e cujo PC foi CANCELADO: vão para a lixeira (só existiam por
 *  causa do PC). Fica a linha que alguém religou a outro PC ou a uma RC. */
export function linhasDePcCancelado(a: {
  rastro: Rastro[]; linhas: LinhaLista[]; cancelados: Set<string>;
}): { lista_id: string; pc_item_id: number; pc_numero: string }[] {
  const porId = new Map(a.linhas.map((l) => [l.id, l]));
  const out: { lista_id: string; pc_item_id: number; pc_numero: string }[] = [];
  for (const r of a.rastro) {
    if (r.status !== "inserido" || !r.lista_id || !a.cancelados.has(String(r.pc_numero))) continue;
    const l = porId.get(r.lista_id);
    if (!l || l.origem !== "pc" || l.rc_item_id) continue;
    if (l.pc_item_id && Number(l.pc_item_id) !== Number(r.pc_item_id)) continue;
    const outros = numerosDaLinha(l.pc_numero).filter((n) => n !== String(r.pc_numero));
    if (outros.length) continue;
    out.push({ lista_id: l.id, pc_item_id: r.pc_item_id, pc_numero: r.pc_numero });
  }
  return out;
}

/** Equipamento da linha nova: o do item do PC ("Equip.: X" na observação), senão o da RC/CP
 *  com a mesma descrição, senão "Compras diretas". */
export const GRUPO_COMPRAS_DIRETAS = "Compras diretas";
export function equipamentoDoItem(i: Pick<ItemPc, "obs" | "descricao">, daCp?: Map<string, string>): string {
  const doPc = /Equip\.?:\s*([^·|]+)/i.exec(i.obs ?? "")?.[1]?.trim();
  if (doPc) return doPc;
  const cp = daCp?.get(String(i.descricao ?? "").trim().toLowerCase());
  return cp || GRUPO_COMPRAS_DIRETAS;
}

/** Texto do item sem colidir com outra linha do mesmo grupo (a lista não aceita duas linhas
 *  com o mesmo item no mesmo equipamento): acrescenta " · PC n". */
export function itemSemColisao(desc: string, numero: string, equipamento: string, ocupadas: Set<string>): string {
  const ch = (t: string) => `${equipamento.trim().toLowerCase()}\x01${t.trim().toLowerCase()}`;
  let t = desc.trim();
  if (ocupadas.has(ch(t))) t = `${desc.trim()} · PC ${numero}`;
  for (let k = 2; ocupadas.has(ch(t)); k++) t = `${desc.trim()} · PC ${numero} (${k})`;
  ocupadas.add(ch(t));
  return t;
}

/** Valor unitário que fecha com o valor da linha do PC (desconto/IPI/ST rateados):
 *  qtd × unit = valor do item — o Projetado da linha bate com o Comprado. */
export const unitLiquido = (i: Pick<ItemPc, "qtd" | "valor" | "valor_unit">) =>
  Number(i.qtd) > 0 ? Math.round((Number(i.valor) / Number(i.qtd)) * 10000) / 10000 : Number(i.valor_unit) || 0;

/** Aviso curto para a tela: "N item(ns) de compras diretas entraram na lista (PC 7xxx)". */
export function avisoPonte(r: { inseridos: number; ligados: number; removidos_cancelado: number; pcs: string[] } | null | undefined): string | null {
  if (!r) return null;
  const partes: string[] = [];
  const pcs = r.pcs.length ? ` (PC ${r.pcs.slice(0, 4).join(", ")}${r.pcs.length > 4 ? "…" : ""})` : "";
  if (r.inseridos) partes.push(`${r.inseridos} item(ns) de compras diretas entraram na lista${pcs}`);
  if (r.ligados) partes.push(`${r.ligados} linha(s) ligada(s) a PC de compra direta`);
  if (r.removidos_cancelado) partes.push(`${r.removidos_cancelado} linha(s) de PC cancelado foram para "Itens removidos"`);
  return partes.length ? partes.join(" · ") : null;
}
