// Compras — tipos e regras puras partilhadas pela tela (Kanban/Tabela), pela
// folha de incluir/alterar e pelo documento do pedido. A fonte da verdade é o
// schema compras (sql/23); aqui só se calcula o que a tela mostra.

export type Etapa = "20" | "10" | "15" | "35" | "40" | "60" | "80";
export type Aprov = "na" | "nao_solicitada" | "aguardando" | "aprovado" | "nao_aprovado";

export const ETAPAS: { cod: Etapa; nome: string; plural: string; cor: string }[] = [
  { cod: "20", nome: "Requisição", plural: "requisições", cor: "#94A3B8" },
  { cod: "10", nome: "Pedido de Compra", plural: "pedidos de compra", cor: "#3B82F6" },
  { cod: "15", nome: "Aprovação", plural: "em aprovação", cor: "#8B5CF6" },
  { cod: "35", nome: "Enviado ao fornecedor", plural: "enviados", cor: "#06B6D4" },
  { cod: "40", nome: "Faturado pelo Fornecedor", plural: "faturados", cor: "#F59E0B" },
  { cod: "60", nome: "Recebido", plural: "recebidos", cor: "#0EA5E9" },
  { cod: "80", nome: "Conferido", plural: "conferidos", cor: "#22C55E" },
]
/** Texto curto que explica a etapa (Benny pode ressignificar depois). */
export const ETAPA_AJUDA: Partial<Record<Etapa, string>> = {
  "15": "aprovação interna",
  "35": "pedido mandado ao fornecedor",
  "40": "NF emitida, a caminho",
  "60": "mercadoria chegou fisicamente",
  "80": "itens, qtd e valores batidos com pedido e NF — liberado para pagar",
};
export const ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.cod, e])) as Record<Etapa, (typeof ETAPAS)[number]>;
export const ordemEtapa = (e: string) => ETAPAS.findIndex((x) => x.cod === e);

export const APROV_LABEL: Record<Aprov, string> = {
  na: "—", nao_solicitada: "Aprovação não solicitada", aguardando: "Aguardando aprovação",
  aprovado: "Aprovado", nao_aprovado: "Não aprovado",
};

export const TIPOS_FRETE = [
  "0 - Contratação do Frete por conta do Remetente (CIF)",
  "1 - Contratação do Frete por conta do Destinatário (FOB)",
  "2 - Contratação do Frete por conta de Terceiros",
  "3 - Transporte Próprio por conta do Remetente",
  "4 - Transporte Próprio por conta do Destinatário",
  "9 - Sem Ocorrência de Transporte",
];
export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const TIPOS_DOC = ["Boleto", "PIX", "Transferência", "Cartão de crédito", "Dinheiro"];
/* Lista de exemplo do mockup, usada só enquanto o cadastro do Omie
   (compras.cad_departamentos) ainda não chegou pelo sync. */
export const DEPTOS_PADRAO = ["Operação / Campo", "Projetos", "Manutenção Contratual", "Administrativo", "Comercial", "Laboratório"];

// ── Linha da lista ──────────────────────────────────────────────────────────
export type PedidoLista = {
  id: number; tipo: "RC" | "PC"; num: string; etapa: Etapa; emp: string;
  forn?: string; fornCod?: number; cnpj?: string; proj?: string; emissao?: string; previsao?: string;
  cat?: string; comprador?: string; contato?: string; parc?: string; conta?: string; numForn?: string;
  contrato?: string; nf?: string; dtRec?: string; dtFat?: string; pv?: string; pvCliente?: string; obsInt?: string;
  valor: number; nItens: number; busca?: string; aprov: Aprov; aprovPor?: string; aprovEm?: string;
  origem: "painel" | "omie"; sync?: string; rcs?: string[]; cobDone?: number; cobTotal?: number; cobPcs?: string[];
  saldo?: number; parciais?: number; enviadoEm?: string; enviadoPara?: string; enviadoMeio?: string;
};

// ── Pedido completo (folha) ─────────────────────────────────────────────────
export type ItemRc = { itemId: number; num: string; idx: number; desc: string; qtd: number };
export type Item = {
  id?: number; key: string; cod?: string | null; ncodProd?: number | null; desc: string; un: string;
  qtd: number; vu: number; desc0: number; ipi: number; st: number; ncm?: string | null; local?: string | null;
  obs?: string | null; rec?: number | null; rc?: ItemRc | null; cov?: number; seq?: number;
  _open?: boolean; _hist?: boolean;
};
export type Parcela = { n: number; venc: string; valor: number; doc: string };
export type Depto = { nome: string; perc: number };
export type Frete = {
  transp?: string; transpCod?: number | null; tipo?: string; placa?: string; uf?: string; qtdVol?: number; esp?: string;
  marca?: string; numer?: string; pl?: number; pb?: number; valor?: number; seguro?: number; lacre?: string; outras?: number;
};
export type Pedido = {
  id: number | null; tipo: "RC" | "PC"; num: string; etapa: Etapa; emp: string; etapaOmie?: string | null;
  forn: string; fornCod: number | null; cnpj: string; catCod: string; cat: string; comprador: string; compradorCod: number | null;
  projCod: number | null; proj: string; contaCod: number | null; conta: string; parc: string;
  emissao: string; previsao: string; contato: string; numForn: string; contrato: string; obs: string; obsInt: string;
  pv: string; pvCliente: string; nf: string; chave: string; dtFat?: string | null; dtRec?: string | null;
  aprov: Aprov; aprovPor?: string | null; aprovEm?: string | null; frete: Frete; valor: number;
  origem: "painel" | "omie"; ncodPed?: number | null; itens: Item[]; parcelas: Parcela[]; deptos: Depto[];
  criadoEm?: string | null; enviadoEm?: string | null; enviadoPor?: string | null; enviadoPara?: string | null;
  enviadoMeio?: string | null; pcsDaRc?: string[];
  hist: { t: string; em: string; por?: string }[];
};

export type Refs = {
  categorias: { cod: string; desc: string }[];
  parcelas: { cod: string; desc: string; dias: number[] }[];
  contas: { cod: number; desc: string }[];
  compradores: { cod: number | null; nome: string }[];
  departamentos: { cod: string; desc: string }[];
  locais: { cod: string; n: number }[];
  projetos: { cod: number; nome: string }[];
};

// ── Números e datas ─────────────────────────────────────────────────────────
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
export const money = (v: number | null | undefined) => BRL.format(Number(v) || 0);
export const num2 = (v: number | null | undefined) => NUM.format(Number(v) || 0);
export const qtd = (v: number | null | undefined) => QTD.format(Number(v) || 0);
/** "1.234,56" / "1234.56" / "12,5" → número. */
export function parseNum(s: unknown): number {
  if (typeof s === "number") return s;
  let t = String(s ?? "").trim();
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
export const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export function addDias(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diffDias = (a: string, b: string) =>
  Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86_400_000);
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function dBR(iso?: string | null, dow = false) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  const s = `${d}/${m}/${y.slice(2)}`;
  return dow ? `${s} ${DOW[new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay()]}` : s;
}
export function rel(iso?: string | null) {
  if (!iso) return "—";
  const n = diffDias(iso.slice(0, 10), hoje());
  if (n === 0) return "Hoje";
  if (n === 1) return "Amanhã";
  if (n === -1) return "Ontem";
  return dBR(iso, true);
}

// ── Regras ──────────────────────────────────────────────────────────────────
export function totais(p: Pick<Pedido, "itens" | "frete">) {
  let merc = 0, desc = 0, ipi = 0, st = 0;
  for (const it of p.itens) {
    merc += (Number(it.qtd) || 0) * (Number(it.vu) || 0);
    desc += Number(it.desc0) || 0; ipi += Number(it.ipi) || 0; st += Number(it.st) || 0;
  }
  const f = p.frete || {};
  const extra = (Number(f.valor) || 0) + (Number(f.seguro) || 0) + (Number(f.outras) || 0);
  return { merc, desc, ipi, st, extra, total: Math.round((merc - desc + ipi + st + extra) * 100) / 100 };
}
export const totalItem = (it: Item) =>
  (Number(it.qtd) || 0) * (Number(it.vu) || 0) - (Number(it.desc0) || 0) + (Number(it.ipi) || 0) + (Number(it.st) || 0);

export const rcAtendida = (p: PedidoLista) => p.tipo === "RC" && (p.cobTotal ?? 0) > 0 && p.cobDone === p.cobTotal;
export function situacao(p: PedidoLista): string {
  if (p.etapa === "60" || p.etapa === "80") return "Recebido";
  if (p.etapa === "20") return rcAtendida(p) ? "Requisição atendida" : "Requisição";
  if (p.previsao && p.previsao < hoje()) return "Previsão de entrega atrasada";
  return "Aguardando entrega";
}
export const atrasado = (p: PedidoLista) => situacao(p) === "Previsão de entrega atrasada";

/** Parcelas a partir da condição (dias) contados da previsão de entrega. */
export function gerarParcelas(total: number, dias: number[], base: string, doc = "Boleto"): Parcela[] {
  const ds = dias.length ? dias : [0];
  const n = ds.length;
  const parte = Math.floor((total / n) * 100) / 100;
  return ds.map((d, i) => ({
    n: i + 1, venc: addDias(base || hoje(), d),
    valor: i === n - 1 ? Math.round((total - parte * (n - 1)) * 100) / 100 : parte, doc,
  }));
}

export type HistPreco = { n: string; d: string; f: string | null; q: number; vu: number; id: number };
export function infoPreco(it: Item, forn: string, hist: HistPreco[] | undefined) {
  const h = (hist ?? []).filter((x) => !(it.rc && x.n === it.rc.num));
  if (!h.length) return null;
  const same = h.filter((x) => x.f && x.f === forn);
  const ref = same[0] ?? h.find((x) => x.f) ?? h[0];
  const avg = h.reduce((a, x) => a + x.vu, 0) / h.length;
  const min = h.reduce((a, x) => (x.vu < a.vu ? x : a));
  const dif = ref.vu ? (((Number(it.vu) || 0) - ref.vu) / ref.vu) * 100 : 0;
  return { h, ref, sameForn: same.length > 0, avg, min, dif };
}

let seqKey = 0;
export const novaChave = () => `k${Date.now().toString(36)}${(seqKey++).toString(36)}`;
export function itemVazio(): Item {
  return { key: novaChave(), cod: "", desc: "", un: "UN", qtd: 1, vu: 0, desc0: 0, ipi: 0, st: 0, ncm: "", local: null, obs: "" };
}
