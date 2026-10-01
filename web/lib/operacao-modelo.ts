// Modelo das telas de Operação (Avulsos, Projetos, PCs Standalone) no desenho
// do mockup de 30/09/2026 (web/docs/mockups/avulsos-mockup-2026-09-30.html).
//
// Converte as linhas de /api/list/rows em Pedido → Compra, com as regras do
// mockup em cima dos dados reais:
//   • estado da compra: sem_pc · pendente · aprovado · recebido · recusado
//   • fases nomeadas PV · RC · PC · Aprov · Mat · Serv · NF, cada uma com
//     estado (concluído, em andamento, atrasado, não iniciado, não se aplica)
//     e a etapa travada com o próximo passo ("PC · emitir 4 PCs")
//   • RC · PC · PV · M.B. com selo "= RC" / ▲ / ▼ e margem estimada (*)
//
// Nenhuma regra de gravação mora aqui — ver lib/approvals-write.ts.

import { STATUS_META } from "@/lib/columns";
import { computeBucketAlarms, type AlarmKind } from "@/lib/alarmes";

type AnyRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const DIA = 86_400_000;

export type Estado = "sem_pc" | "pendente" | "aprovado" | "recebido" | "recusado";
export const ESTADO_LABEL: Record<Estado, string> = {
  sem_pc: "Sem PC", pendente: "Aguarda aprovação", aprovado: "Aprovado",
  recebido: "Recebido", recusado: "Recusado",
};

/** Data do Omie (dd/mm/aaaa ou ISO) → ms à meia-noite, ou null. */
export function dataMs(v: unknown): number | null {
  const t = s(v);
  if (!t) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t.slice(0, 10);
  const d = Date.parse(iso + "T00:00:00");
  return Number.isNaN(d) ? null : d;
}
export const hojeMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const diasAte = (ms: number | null) => (ms == null ? null : Math.round((ms - hojeMs()) / DIA));
export const dBR = (ms: number | null) => (ms == null ? "" : new Date(ms).toLocaleDateString("pt-BR"));
/** ISO yyyy-mm-dd para <input type=date>. */
export const isoDia = (ms: number | null) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export type Compra = {
  key: string;             // empresa|ncod_ped — identidade da linha
  row: AnyRow;             // linha crua (para gravar)
  pedidoId: string;
  estado: Estado;
  statusCodigo: string;    // código real (APROVADO, PENDENTE, …)
  temPc: boolean;
  pc: string;
  desc: string;
  rcNumero: string;
  qtd: number;
  unit: number;
  rcTotal: number;
  pcValor: number | null;
  dif: number | null;      // (PC − RC) / RC
  fornecedor: string;
  categoria: string;
  pagamento: string;
  justificativa: string;
  prev: number | null;          // previsão efetiva (nova ou do PC)
  prevNova: number | null;
  prevOriginal: number | null;
  recebidoEm: number | null;
  nfFornecedor: string;
  aprovarAte: number | null;
  prevServicos: number | null;
  servico: boolean;
  /** Quantas linhas de RC dividem este PC (um PC do Omie cobre vários itens). */
  pcLinhas: number;
};

export type Fase = { k: string; s: "d" | "p" | "l" | "o" | "na"; t: string; next?: string };

export type Pedido = {
  id: string;              // rótulo do bucket (PV/OS, projeto ou PC)
  bucket: { pv_os_label: string; rows: AnyRow[] } & AnyRow;
  cliente: string;
  tipo: string;
  etapaVenda: string;
  projeto: string;
  lim: number | null;
  valorPv: number;
  faturado: boolean;
  nfSaida: string;
  fatEm: number | null;
  compras: Compra[];
  alarmes: Set<AlarmKind>;
  flags: { tom: "r" | "a" | "g" | "v"; t: string }[];
};

const APROV = (c: string) => STATUS_META[c]?.isApproved === true;
const RECUSA = new Set(["NAO_APROVADO", "REJEITADO_VALIDADE", "CANCELAR_PEDIDO"]);

export function compraDaLinha(r: AnyRow, pedidoId: string): Compra {
  const pc = s(r.pc_numero) || s(r.pc_numero_manual);
  const status = s(r.status);
  const recebidoEm = dataMs(r.mt_data_recebimento_nf);
  const estado: Estado = !pc ? "sem_pc" : recebidoEm != null ? "recebido"
    : APROV(status) ? "aprovado" : RECUSA.has(status) ? "recusado" : "pendente";
  const qtd = n(r.rc_qtd) || 1;
  const unit = n(r.rc_custo);
  const rcTotal = unit * qtd;
  const pcValor = pc && r.valor_total != null ? n(r.valor_total) : null;
  const prevNova = dataMs(r.nova_prev_materiais);
  const prevOriginal = dataMs(r.dt_previsao);
  const cat = s(r.codigo_categoria) || s(r.categoria);
  return {
    key: `${s(r.empresa)}|${s(r.ncod_ped)}`, row: r, pedidoId,
    estado, statusCodigo: status, temPc: !!pc, pc,
    desc: s(r.rc_descricao) || s(r.pc_descricao_item) || s(r.descricao) || (pc ? `PC ${pc}` : "sem descrição"),
    rcNumero: s(r.rc_numero), qtd, unit, rcTotal, pcValor,
    dif: pcValor != null && rcTotal > 0 ? pcValor / rcTotal - 1 : null,
    fornecedor: s(r.nome_fornecedor).replace(/&amp;/g, "&"),
    categoria: cat,
    pagamento: s(r.pc_forma_pagamento),
    justificativa: s(r.justificativa),
    prev: prevNova ?? prevOriginal, prevNova, prevOriginal,
    recebidoEm, nfFornecedor: s(r.mt_nf_fornecedor),
    aprovarAte: dataMs(r.aprovar_ate_calc),
    prevServicos: dataMs(r.nova_prev_servicos),
    servico: /servi/i.test(cat) || s(r.tipo_omie) === "Serviços",
    pcLinhas: 1,
  };
}

/** A mesma LINHA pode vir duas vezes (cópia manual + Omie). Mas um PC do
 *  Omie cobre várias linhas de RC — a chave inclui a RC e a descrição, para
 *  não esconder os outros itens do mesmo PC (erro corrigido em 30/09/2026). */
function dedupe(rows: AnyRow[]): AnyRow[] {
  const porChave = new Map<string, AnyRow>();
  const soltas: AnyRow[] = [];
  for (const r of rows) {
    const pc = s(r.pc_numero) || s(r.pc_numero_manual);
    const rc = s(r.rc_numero);
    const desc = s(r.rc_descricao);
    const chave = pc || rc ? `${pc}|${rc}|${desc}` : "";
    if (!chave) { soltas.push(r); continue; }
    const ant = porChave.get(chave);
    if (!ant || (n(r.ncod_ped) > 0 && n(ant.ncod_ped) < 0)) porChave.set(chave, r);
  }
  return [...porChave.values(), ...soltas];
}

export function encerrado(head: AnyRow): boolean {
  const etapa = s(head.pv_etapa_texto);
  return s(head.pv_dt_fat) !== "" || s(head.pv_num_nfe) !== "" || etapa === "Faturado" || etapa === "Cancelado";
}

export function montarPedido(
  bucket: { pv_os_label: string; rows: AnyRow[] } & AnyRow, modulo: string,
): Pedido {
  const rows = dedupe(bucket.rows);
  const head = bucket.rows[0] ?? {};
  const id = bucket.pv_os_label;
  const compras = rows.map((r) => compraDaLinha(r, id));
  // PC compartilhado: a comparação PC × RC é contra a SOMA das RCs daquele PC.
  const porPc = new Map<string, Compra[]>();
  for (const c of compras) if (c.pc) porPc.set(c.pc, [...(porPc.get(c.pc) ?? []), c]);
  for (const grupo of porPc.values()) {
    const rcSoma = grupo.reduce((a, c) => a + c.rcTotal, 0);
    for (const c of grupo) {
      c.pcLinhas = grupo.length;
      c.dif = c.pcValor != null && rcSoma > 0 ? c.pcValor / rcSoma - 1 : null;
    }
  }
  const alarmes = computeBucketAlarms(bucket.rows, hojeMs());
  // Projeto: o valor é a soma dos PV/OS distintos, não só o primeiro.
  let valorPv = n(head.pv_valor_total);
  if (modulo === "projetos") {
    const vistos = new Map<string, number>();
    for (const r of bucket.rows) { const k = s(r.pv_os_label); if (k && !vistos.has(k)) vistos.set(k, n(r.pv_valor_total)); }
    valorPv = [...vistos.values()].reduce((a, v) => a + v, 0);
  }
  const cliente = modulo === "pcs"
    ? compras.map((c) => c.fornecedor).find(Boolean) ?? ""
    : s(bucket.cliente) || bucket.rows.map((r) => s(r.pv_cliente_fantasia)).find(Boolean) || "";
  const p: Pedido = {
    id, bucket, cliente,
    tipo: s(head.tipo_omie), etapaVenda: s(head.pv_etapa_texto),
    projeto: s(head.projeto_nome),
    lim: dataMs(head.pv_data_previsao), valorPv,
    faturado: encerrado(head), nfSaida: s(head.pv_num_nfe), fatEm: dataMs(head.pv_dt_fat),
    compras, alarmes, flags: [],
  };
  p.flags = sinais(p, modulo);
  return p;
}

/** Sinais do cartão — os mesmos alarmes do painel, com o nome do mockup. */
export function sinais(p: Pedido, modulo: string): Pedido["flags"] {
  const f: Pedido["flags"] = [];
  const a = p.alarmes;
  if (modulo !== "pcs" && a.has("venda")) f.push({ tom: "r", t: "venda em atraso" });
  if (a.has("compra")) f.push({ tom: "r", t: "compra em atraso" });
  if (p.compras.some((c) => c.estado === "pendente")) f.push({ tom: "a", t: "aprovação pendente" });
  if (p.compras.some((c) => c.estado === "recusado")) f.push({ tom: "r", t: "recusa a resolver" });
  if (modulo !== "pcs" && estrutura(p).rcsSemPc > 0) f.push({ tom: "g", t: "sem PC" });
  if (modulo === "avulsos" && a.has("sem_projeto")) f.push({ tom: "v", t: "sem projeto" });
  if (modulo !== "pcs" && a.has("pvos_incompl")) f.push({ tom: "v", t: "PV incompleto" });
  if (a.has("defas_omie")) f.push({ tom: "v", t: "defasado Omie" });
  if (modulo === "avulsos" && a.has("pode_faturar")) f.push({ tom: "v", t: "pode faturar" });
  return f;
}

/** Agrupa as compras do pedido: RCs (uma linha sem RC conta como uma) e PCs
 *  distintos. NÃO há relação 1:1 entre itens e PCs — um PC pode atender
 *  várias RCs (Benny, 30/09/2026); então as fases contam RCs e PCs, não itens. */
export function estrutura(p: Pedido) {
  const rcs = new Map<string, Compra[]>();
  for (const c of p.compras) {
    const k = c.rcNumero ? `rc:${c.rcNumero}` : `x:${c.key}`;
    rcs.set(k, [...(rcs.get(k) ?? []), c]);
  }
  const pcs = new Map<string, Compra[]>();
  for (const c of p.compras) if (c.pc) pcs.set(c.pc, [...(pcs.get(c.pc) ?? []), c]);
  const rcsSemPc = [...rcs.values()].filter((cs) => !cs.some((c) => c.pc)).length;
  const estadoPc = (cs: Compra[]) =>
    cs.every((c) => c.estado === "recebido") ? "recebido"
      : cs.some((c) => c.estado === "recusado") ? "recusado"
      : cs.some((c) => c.estado === "pendente") ? "pendente" : "aprovado";
  const pcsLista = [...pcs.entries()].map(([pc, cs]) => ({ pc, cs, estado: estadoPc(cs) }));
  return { rcs, nRcs: rcs.size, rcsSemPc, pcs: pcsLista };
}

/** Fases nomeadas + a etapa travada (a primeira não concluída). */
export function fases(p: Pedido, modulo: string): { lista: Fase[]; atual: Fase | null } {
  const it = p.compras;
  const atrasado = (diasAte(p.lim) ?? 1) < 0;
  const E = estrutura(p);
  const nPcs = E.pcs.length;
  const nPend = E.pcs.filter((x) => x.estado === "pendente").length;
  const nRec = E.pcs.filter((x) => x.estado === "recusado").length;
  const nAp = E.pcs.filter((x) => x.estado === "aprovado" || x.estado === "recebido").length;
  const nRcb = E.pcs.filter((x) => x.estado === "recebido").length;
  const matLate = E.pcs.filter((x) => x.estado !== "recebido" && x.cs.some((c) => c.prev != null && (diasAte(c.prev) ?? 0) < 0)).length;
  const srv = it.filter((c) => c.servico), srvOk = srv.filter((c) => c.estado === "recebido").length;
  const rcsCom = E.nRcs - E.rcsSemPc;
  const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;
  const L: Fase[] = [];
  if (modulo !== "pcs") {
    L.push({ k: "PV", s: "d", t: "Venda registrada no Omie" });
    const nRcNum = [...E.rcs.keys()].filter((k) => k.startsWith("rc:")).length;
    // Linha sem RC conta como um item solto; sem nenhuma RC, fala-se em itens.
    const alvoTxt = (n: number) => nRcNum ? plural(n, "RC", "RCs") : plural(n, "item", "itens");
    L.push(nRcNum === 0 && nPcs > 0
      ? { k: "RC", s: "na", t: "sem requisição — compra direto por PC" }
      : { k: "RC", s: nRcNum ? "d" : "o", t: nRcNum ? plural(nRcNum, "requisição", "requisições") : "nenhuma requisição ainda", next: "criar requisição" });
    L.push({ k: "PC", s: !E.nRcs ? "o" : E.rcsSemPc === 0 ? "d" : rcsCom ? (atrasado ? "l" : "p") : (atrasado ? "l" : "o"),
      t: E.rcsSemPc === 0 ? `${plural(nPcs, "pedido de compra", "pedidos de compra")} atendendo ${alvoTxt(E.nRcs)}`
        : `${E.rcsSemPc} de ${alvoTxt(E.nRcs)} sem pedido de compra`,
      next: `${alvoTxt(E.rcsSemPc)} sem pedido de compra` });
  } else {
    L.push({ k: "PC", s: nPcs ? "d" : "o", t: plural(nPcs, "pedido de compra", "pedidos de compra") });
  }
  L.push({ k: "Aprov", s: nRec ? "l" : nPend ? "p" : nPcs && nAp === nPcs ? (E.rcsSemPc === 0 ? "d" : "p") : "o",
    t: nRec ? `${plural(nRec, "PC recusado", "PCs recusados")}` : nPend ? `${plural(nPend, "PC aguardando", "PCs aguardando")} aprovação` : nPcs ? `${nAp}/${nPcs} PCs aprovados` : "nenhum PC para aprovar",
    next: nRec ? `resolver ${plural(nRec, "recusa", "recusas")}` : `aprovar ${plural(nPend, "PC", "PCs")}` });
  const soServico = it.length > 0 && it.every((c) => c.servico);
  if (soServico) L.push({ k: "Mat", s: "na", t: "sem material — pedido só de serviço" });
  else L.push({ k: "Mat", s: nPcs && nRcb === nPcs && E.rcsSemPc === 0 ? "d" : matLate ? "l" : nRcb || nAp ? "p" : "o",
    t: nPcs ? `${nRcb}/${nPcs} PCs recebidos${matLate ? ` · ${matLate} com previsão vencida` : ""}` : "nada comprado ainda",
    next: nPcs ? `receber ${plural(nPcs - nRcb, "PC", "PCs")}` : "aguardando compra" });
  if (modulo !== "pcs") {
    // A OS do app de serviços (custom_fields.ww_os_status) manda: se existe,
    // o pedido tem serviço — mesmo que nenhuma compra seja de categoria serviço.
    const os = servicoDoPedido(p);
    L.push(os
      ? { k: "Serv", s: os.st === "Concluída" ? "d" : os.prev != null && (diasAte(os.prev) ?? 0) < 0 ? "l" : os.st === "Aberta" ? "o" : "p",
          t: `OS ${os.st}${os.prev ? ` · prev. ${dBR(os.prev)}` : ""}`, next: `serviço ${os.st.toLowerCase()}` }
      : srv.length
      ? { k: "Serv", s: srvOk === srv.length ? "d" : srvOk ? "p" : "o", t: `${srvOk}/${srv.length} serviços concluídos`, next: "concluir serviços" }
      : { k: "Serv", s: "na", t: "sem serviço neste pedido" });
    L.push(p.faturado
      ? { k: "NF saída", s: "d", t: `NF ${p.nfSaida || "emitida"}` }
      : { k: "NF saída", s: nPcs && nRcb === nPcs ? (atrasado ? "l" : "p") : "o", t: "NF de saída não emitida", next: "emitir NF de saída" });
  }
  const atual = L.find((x) => x.s !== "d" && x.s !== "na") ?? null;
  return { lista: L, atual };
}

/** Estado do serviço vindo do app de serviços por PV/OS. */
export function servicoDoPedido(p: Pedido): { st: string; prev: number | null } | null {
  for (const r of p.bucket.rows) {
    const cf = (r.custom_fields as Record<string, unknown> | null) ?? {};
    const st = s(cf.ww_os_status);
    const prev = dataMs(r.nova_prev_servicos);
    if (st || prev != null) return { st: st || "Agendar", prev };
  }
  return null;
}

/** RC · PC · PV · M.B. — custo usa o PC quando existe, senão a RC (estimado *). */
export function financeiro(p: Pedido) {
  const it = p.compras;
  const rc = it.reduce((a, c) => a + c.rcTotal, 0);
  const comPc = it.filter((c) => c.pcValor != null);
  // Cada PC conta uma vez, por mais linhas de RC que ele cubra.
  const valorPorPc = new Map<string, number>();
  for (const c of comPc) valorPorPc.set(c.pc, c.pcValor ?? 0);
  const pc = [...valorPorPc.values()].reduce((a, v) => a + v, 0);
  const rcDosPcs = comPc.reduce((a, c) => a + c.rcTotal, 0);
  const custo = pc + it.filter((c) => c.pcValor == null).reduce((a, c) => a + c.rcTotal, 0);
  const mb = p.valorPv > 0 ? (p.valorPv - custo) / p.valorPv : null;
  return {
    rc, pc, pcN: valorPorPc.size, total: it.length,
    dif: comPc.length && rcDosPcs > 0 ? pc / rcDosPcs - 1 : null,
    mb, estimada: comPc.length < it.length,
  };
}

// ── Filtros ────────────────────────────────────────────────────────────────
export type Escopo = "aberto" | "faturado" | "todos";
export type Periodo = "tudo" | "7" | "30" | "vencidos";
export type Rapida = "todos" | "minha" | "atrasados" | "sem_pc" | "alarme";
export type Filtros = {
  tipo?: string; etapaVenda?: string; projeto?: string;
  estado?: Estado; fornecedor?: string; categoria?: string;
};
export const FILTRO_LABEL: Record<keyof Filtros, string> = {
  tipo: "Tipo Omie", etapaVenda: "Etapa venda", projeto: "Projeto",
  estado: "Etapa PC", fornecedor: "Fornecedor", categoria: "Categoria",
};

export function noEscopo(p: Pedido, e: Escopo) {
  return e === "todos" ? true : e === "faturado" ? p.faturado : !p.faturado;
}

/** A compra passa? (o pedido aparece se alguma compra passar, ou se não tem compra e o filtro não é de compra). */
export function passa(p: Pedido, c: Compra | null, q: string, per: Periodo, f: Filtros, rap: Rapida): boolean {
  if (q) {
    const alvo = `${p.id} ${p.cliente} ${p.projeto} ${c?.fornecedor ?? ""} ${c?.pc ?? ""} ${c?.rcNumero ?? ""} ${c?.desc ?? ""}`.toLowerCase();
    if (!alvo.includes(q)) return false;
  }
  if (f.tipo && p.tipo !== f.tipo) return false;
  if (f.etapaVenda && p.etapaVenda !== f.etapaVenda) return false;
  if (f.projeto && (f.projeto === "Sem projeto" ? !!p.projeto : p.projeto !== f.projeto)) return false;
  if (f.estado && c?.estado !== f.estado) return false;
  if (f.fornecedor && c?.fornecedor !== f.fornecedor) return false;
  if (f.categoria && c?.categoria !== f.categoria) return false;
  const d = diasAte(p.lim);
  if (per === "7" && (d == null || d < 0 || d > 7)) return false;
  if (per === "30" && (d == null || d < 0 || d > 30)) return false;
  if (per === "vencidos" && (d == null || d >= 0)) return false;
  if (rap === "minha" && c?.estado !== "pendente") return false;
  if (rap === "atrasados" && !p.flags.some((x) => x.t === "venda em atraso" || x.t === "compra em atraso")) return false;
  if (rap === "sem_pc" && c?.estado !== "sem_pc") return false;
  if (rap === "alarme" && !p.flags.some((x) => x.t !== "sem PC")) return false;
  return true;
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
