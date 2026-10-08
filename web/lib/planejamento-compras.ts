// Planejamento de compras por item (08/10/26, spec E) — puro, testado em
// scripts/testes/planejamento-compras.test.ts. A view approval.v_rc_projetos_itens
// (sql/128) calcula o mesmo `comprar_ate` no banco; aqui é para refletir na hora o que
// se edita na tela, antes de gravar.
//
//   prazo efetivo = prazo ajustado no ITEM (célula Prazo da lista, sql/141)
//                 → prazo MANUAL do fornecedor (⏱ Prazos por fornecedor)
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
/** item_manual = ajustado na célula Prazo da linha (sql/141); manual = ⏱ do fornecedor. */
export type FontePrazo = "item_manual" | "manual" | "item" | "historico" | "estimado";
export const ROTULO_FONTE: Record<FontePrazo, string> = {
  item_manual: "ajustado no item", manual: "fornecedor (manual)", item: "item (catálogo)", historico: "histórico", estimado: "prazo estimado",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
export const somaDias = (base: string, n: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const hojeIso = () => iso(new Date(Date.now() - 3 * 3600000)); // dia de Brasília

const prazoValido = (v: unknown) => (v != null && String(v).trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null);

/** Prazo efetivo de um item. `prazoManualItem` (ajustado na linha) vence tudo; sem ele vale
 *  o automático (prazoAuto). */
export function prazoEfetivo(a: { prazoManualItem?: number | string | null; prazoItem?: number | null; fornecedor?: string | null; prazos?: Map<string, PrazoFornecedor> }):
  { prazo: number; fonte: FontePrazo; estimado: boolean } {
  const m = prazoValido(a.prazoManualItem);
  if (m != null) return { prazo: m, fonte: "item_manual", estimado: false };
  return prazoAuto(a);
}

/** O prazo SEM o ajuste do item: manual do fornecedor → item → histórico → 15. É o valor que
 *  a célula mostra riscado quando o item foi ajustado (e o que volta no ↺). */
export function prazoAuto(a: { prazoItem?: number | null; fornecedor?: string | null; prazos?: Map<string, PrazoFornecedor> }):
  { prazo: number; fonte: Exclude<FontePrazo, "item_manual">; estimado: boolean } {
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
  necessario: string | null | undefined; temPc: boolean; prazoItem?: number | null; prazoManualItem?: number | string | null; fornecedor?: string | null;
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

// ── Agente de compras: lotes (08/10/26, spec F — porta de montarLotes() do mockup) ──────────
//
// 1. Universo: itens sem PC, com "necessário em" (e comprar até), fora de lote agendado/gerado.
// 2. Agrupa pelo fornecedor provável (sem fornecedor = lote "— sem fornecedor", para confirmar).
// 3. No fornecedor, ordena por comprar até e junta guloso: o lote começa no 1º item (base) e
//    recebe os seguintes enquanto comprar_ate − base ≤ janela (padrão 10 dias).
// 4. pedir = max(base, hoje) (ou a data manual); chega = pedir + prazo; folga = 1º necessário − chega.
// 5. atrasado (base < hoje) → "pedir hoje"; urgente (base ≤ hoje + 7) → "esta semana"; senão proposto.
// 6. Caixa: gasto acumulado dos lotes por data de pedir × recebimentos das parcelas de venda até a
//    data; saldo negativo avisa a próxima entrada. Informa, não bloqueia.
// 7. Motivo: texto curto feito só com estes fatos (a reescrita pela IA, se houver, usa os mesmos).

export const JANELA_PADRAO_DIAS = 10;
export const SEM_FORNECEDOR = "— sem fornecedor";

export type ItemLote = {
  id: string; item: string; qtd: number; un: string; vu: number; fornecedor: string | null;
  necessario: string | null; temPc: boolean; plano: PlanoItem;
};
export type Recebimento = { doc: string; valor: number; data: string };
export type LotePersistido = {
  id: string; fornecedor: string | null; data_base: string; data_pedir: string;
  status: "proposto" | "agendado" | "gerado" | "cancelado"; motivo: string | null; pedido_num?: string | null; itens: string[];
};
export type Lote = {
  chave: string; id: string | null; forn: string; semFornecedor: boolean;
  base: string; pedir: string; status: "proposto" | "agendado" | "gerado";
  itens: ItemLote[]; valor: number; prazo: number; estimado: boolean;
  chega: string; primeiroNec: string; folga: number; atrasado: boolean; urgente: boolean; forcado: boolean;
  motivo: string; pedidoNum: string | null;
  caixaEntradas: number; caixaSaldo: number; caixaNeg: boolean; proxEntrada: Recebimento | null; caixaMsg: string;
};

const d2 = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;
const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function chaveLote(forn: string, base: string) { return `${normFornecedor(forn) || "sem"}|${base}`; }

/** O nome a exibir de um grupo de fornecedor: o mais usado nas linhas (empate: ordem alfabética). */
function nomeExibicao(nomes: Map<string, number>): string {
  return [...nomes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? SEM_FORNECEDOR;
}

// ── Escalonamento (spec F): lote PROPOSTO atrasado sem ação há ≥ 2 dias vai ao admin uma vez;
// depois, no máximo um lembrete por semana enquanto ninguém agir. O que já foi avisado fica em
// compras.lote_planejado.ultimo_aviso ("escalado:AAAA-MM-DD", linha-marcador do lote proposto,
// sql/143). Sem essa memória (migração pendente), cai na regra sem estado: avisa no 2º dia de
// atraso e de 7 em 7 dias depois disso.
export const ESCALAR_APOS_DIAS = 2;
export const REESCALAR_CADA_DIAS = 7;
export type Escalonamento = { acao: "escalar" | "lembrete"; diasAtraso: number } | null;
/** `ultimoAviso`: string/null = memória disponível (null = nunca avisado); undefined = sem memória. */
export function decidirEscalonamento(l: { status: Lote["status"]; base: string }, hoje: string, ultimoAviso: string | null | undefined): Escalonamento {
  if (l.status !== "proposto") return null;
  const diasAtraso = difDias(hoje, l.base);
  if (diasAtraso < ESCALAR_APOS_DIAS) return null;
  if (ultimoAviso === undefined) {
    const n = diasAtraso - ESCALAR_APOS_DIAS;
    return n % REESCALAR_CADA_DIAS !== 0 ? null : { acao: n === 0 ? "escalar" : "lembrete", diasAtraso };
  }
  const m = /^escalado:(\d{4}-\d{2}-\d{2})$/.exec(ultimoAviso ?? "");
  if (!m) return { acao: "escalar", diasAtraso };
  return difDias(hoje, m[1]) >= REESCALAR_CADA_DIAS ? { acao: "lembrete", diasAtraso } : null;
}

/** Monta os lotes (propostos + persistidos) com motivo e caixa. Puro. */
export function montarLotes(itens: ItemLote[], o: {
  janela?: number; hoje?: string; simAgora?: boolean; persistidos?: LotePersistido[]; recebimentos?: Recebimento[];
  datasManuais?: Map<string, string>; forcados?: Set<string>;
}): Lote[] {
  const hoje = o.hoje ?? hojeIso();
  const janela = Math.max(0, o.janela ?? JANELA_PADRAO_DIAS);
  const porId = new Map(itens.map((x) => [x.id, x]));
  const pers = (o.persistidos ?? []).filter((l) => l.status === "agendado" || l.status === "gerado");
  const emLote = new Set(pers.flatMap((l) => l.itens));
  const abertos = itens.filter((x) => !x.temPc && x.necessario && x.plano.comprarAte && !emLote.has(x.id));

  type Cru = { forn: string; base: string; itens: ItemLote[]; id: string | null; status: Lote["status"]; pedirFixo: string | null; motivoGravado: string | null; pedidoNum: string | null };
  const crus: Cru[] = [];
  // Agrupa pelo nome NORMALIZADO (o mesmo de approval._norm_item / fornecedor_norm): "Acqua
  // Import" e "ACQUA IMPORT " são a mesma empresa e vão no mesmo lote. Exibe o nome mais usado.
  const porForn = new Map<string, { nomes: Map<string, number>; xs: ItemLote[] }>();
  for (const x of abertos) {
    const nome = x.fornecedor?.trim() || "";
    const k = normFornecedor(nome) || SEM_FORNECEDOR;
    const g = porForn.get(k) ?? { nomes: new Map<string, number>(), xs: [] };
    if (nome) g.nomes.set(nome, (g.nomes.get(nome) ?? 0) + 1);
    g.xs.push(x); porForn.set(k, g);
  }
  for (const [k, { nomes, xs }] of porForn) {
    const forn = k === SEM_FORNECEDOR ? SEM_FORNECEDOR : nomeExibicao(nomes);
    xs.sort((a, b) => a.plano.comprarAte!.localeCompare(b.plano.comprarAte!) || a.id.localeCompare(b.id));
    let cur: Cru | null = null;
    for (const x of xs) {
      if (!cur || difDias(x.plano.comprarAte!, cur.base) > janela) {
        cur = { forn, base: x.plano.comprarAte!, itens: [], id: null, status: "proposto", pedirFixo: null, motivoGravado: null, pedidoNum: null };
        crus.push(cur);
      }
      cur.itens.push(x);
    }
  }
  for (const l of pers) {
    // item que ganhou PC fora do lote agendado sai dele (no gerado, os itens já têm o PC do lote)
    const its = l.itens.map((id) => porId.get(id)).filter((x): x is ItemLote => !!x && (l.status === "gerado" || !x.temPc));
    if (!its.length && l.status === "agendado") continue;
    crus.push({ forn: l.fornecedor?.trim() || SEM_FORNECEDOR, base: l.data_base, itens: its, id: l.id, status: l.status as Lote["status"],
      pedirFixo: l.data_pedir, motivoGravado: l.motivo, pedidoNum: l.pedido_num ?? null });
  }

  const lotes: Lote[] = crus.map((c) => {
    const chave = c.id ?? chaveLote(c.forn, c.base);
    const manual = o.datasManuais?.get(chave);
    const pedir = o.simAgora && c.status !== "gerado" ? hoje : (manual ?? c.pedirFixo ?? (c.base < hoje ? hoje : c.base));
    const prazo = Math.max(0, ...c.itens.map((x) => x.plano.prazo));
    const estimado = c.itens.some((x) => x.plano.estimado);
    const valor = Math.round(c.itens.reduce((a, x) => a + x.qtd * x.vu, 0) * 100) / 100;
    const chega = somaDias(pedir, prazo);
    const primeiroNec = c.itens.map((x) => x.necessario ?? "").filter(Boolean).sort()[0] ?? pedir;
    const folga = difDias(primeiroNec, chega);
    const atrasado = c.status !== "gerado" && c.base < hoje;
    const urgente = !atrasado && c.status !== "gerado" && difDias(c.base, hoje) <= JANELA_AGORA_DIAS;
    const semFornecedor = c.forn === SEM_FORNECEDOR;
    // motivo (só fatos do lote)
    const n = c.itens.length;
    const datas = [...new Set(c.itens.map((x) => x.plano.comprarAte).filter(Boolean) as string[])].sort();
    const m: string[] = [];
    if (n > 1 && datas.length > 1) m.push(`junta **${n} itens** com datas de pedir entre ${d2(datas[0])} e ${d2(datas[datas.length - 1])} num pedido só (um frete, uma aprovação)`);
    else if (n > 1) m.push(`**${n} itens** com a mesma data de pedir`);
    else m.push("item único — nada mais deste fornecedor na janela");
    if (atrasado) m.push(`**já passou da data** (${d2(c.base)}); pedindo ${pedir === hoje ? "hoje" : `em ${d2(pedir)}`} chega ≈ ${d2(chega)}, ${folga < 0 ? `**${-folga}d depois** do necessário — avisar a obra ou pedir prazo menor` : `${folga}d antes do necessário`}`);
    else m.push(`pedindo em ${d2(pedir)} chega ≈ ${d2(chega)}, ${folga < 0 ? `**${-folga}d depois**` : `${folga}d antes`} do primeiro "necessário em" (${d2(primeiroNec)})`);
    if (estimado) m.push(`prazo do fornecedor é **estimado** (${PRAZO_ESTIMADO_DIAS}d) — confirmar antes de agendar`);
    if (semFornecedor) m.push("**sem fornecedor provável** — escolha o fornecedor antes de gerar o PC");
    return {
      chave, id: c.id, forn: c.forn, semFornecedor, base: c.base, pedir, status: c.status, itens: c.itens, valor, prazo, estimado,
      chega, primeiroNec, folga, atrasado, urgente, forcado: c.itens.some((x) => o.forcados?.has(x.id)),
      motivo: m.join(" · "), pedidoNum: c.pedidoNum,
      caixaEntradas: 0, caixaSaldo: 0, caixaNeg: false, proxEntrada: null, caixaMsg: "",
    };
  });

  lotes.sort((a, b) => a.pedir.localeCompare(b.pedir) || b.valor - a.valor);
  const rec = [...(o.recebimentos ?? [])].filter((r) => r.data && r.valor > 0).sort((a, b) => a.data.localeCompare(b.data));
  let acum = 0;
  for (const lo of lotes) {
    acum += lo.valor;
    lo.caixaEntradas = rec.filter((r) => r.data <= lo.pedir).reduce((a, r) => a + r.valor, 0);
    lo.caixaSaldo = Math.round((lo.caixaEntradas - acum) * 100) / 100;
    lo.caixaNeg = lo.caixaSaldo < 0;
    lo.proxEntrada = rec.find((r) => r.data > lo.pedir) ?? null;
    lo.caixaMsg = !rec.length ? "sem recebimentos de venda previstos para comparar"
      : !lo.caixaNeg ? `caixa ok · ${brl0(lo.caixaEntradas)} recebido até ${d2(lo.pedir)}`
      : `⚠ caixa: faltam ${brl0(-lo.caixaSaldo)} — próxima entrada ${lo.proxEntrada ? `${lo.proxEntrada.doc} ${brl0(lo.proxEntrada.valor)} em ${d2(lo.proxEntrada.data)}` : "nenhuma prevista"}`;
  }
  return lotes;
}

/** Recebimentos das parcelas de venda (Vendas PV/OS do projeto) para o caixa dos lotes. */
export function recebimentosDasVendas(docs: { rotulo: string; valor: number; receb_inicial: string | null; receb_nova: string | null;
  faturado?: boolean; titulo_venc?: string | null }[]): Recebimento[] {
  return docs.map((d) => ({ doc: d.rotulo, valor: Number(d.valor) || 0,
    data: String((d.faturado ? d.titulo_venc : null) ?? d.receb_nova ?? d.receb_inicial ?? "").slice(0, 10) })).filter((r) => r.data);
}
