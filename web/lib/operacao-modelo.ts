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
import type { RentabResumo } from "@/lib/rentabilidade";

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
  /** Status do material marcado à mão pelo time (custom_fields.mat_status). */
  matManual: MatManual | null;
  /** Item sem PC próprio: PCs que atendem a RC dele (ou o pedido) — o material segue esses PCs. */
  pcsRef?: Compra[];
};

export type MatManual = { v: "estoque" | "recebido_sem_nf" | "parcial" | "cancelado"; qtd?: number; por?: string; em?: string };
export type MatItem = { k: "recebido" | "estoque" | "recebido_sem_nf" | "parcial" | "cancelado" | "atrasado" | "a_caminho" | "sem_previsao" | "sem_pc" | "aguarda";
  t: string; tom: "ok" | "info" | "warn" | "crit" | "mute"; manual: boolean };
export const MAT_MANUAL: { v: MatManual["v"]; t: string }[] = [
  { v: "estoque", t: "Em estoque" },
  { v: "recebido_sem_nf", t: "Recebido sem NF" },
  { v: "parcial", t: "Recebido parcial" },
  { v: "cancelado", t: "Não vai mais" },
];
const DIAS_SEM_NF = 5;

/** Situação do material de UM item: a NF de entrada do Omie manda; senão vale
 *  o que o time marcou; senão o automático (previsão do PC). */
export function materialDoItem(c: Compra): MatItem {
  if (c.recebidoEm != null) return { k: "recebido", t: "Recebido", tom: "ok", manual: false };
  const m = c.matManual;
  if (m?.v === "estoque") return { k: "estoque", t: "Em estoque", tom: "info", manual: true };
  if (m?.v === "recebido_sem_nf") return { k: "recebido_sem_nf", t: "Recebido sem NF", tom: "warn", manual: true };
  if (m?.v === "parcial") return { k: "parcial", t: `Parcial ${m.qtd ?? "?"}/${c.qtd}`, tom: "warn", manual: true };
  if (m?.v === "cancelado") return { k: "cancelado", t: "Não vai mais", tom: "mute", manual: true };
  if (!c.pc) {
    const ref = c.pcsRef ?? [];
    if (!ref.length) return { k: "sem_pc", t: "Sem PC", tom: "mute", manual: false };
    // Segue os PCs da RC: todos com NF = recebido; senão o pior entre eles.
    const ms = ref.map(materialDoPc);
    if (ms.every((m) => m.k === "recebido")) return { k: "recebido", t: "Recebido", tom: "ok", manual: false };
    for (const k of ["atrasado", "aguarda", "a_caminho", "sem_previsao"] as const) {
      const m = ms.find((x) => x.k === k); if (m) return m;
    }
    return ms[0];
  }
  return materialDoPc(c);
}

function materialDoPc(c: Compra): MatItem {
  if (c.recebidoEm != null) return { k: "recebido", t: "Recebido", tom: "ok", manual: false };
  if (c.estado === "pendente" || c.estado === "recusado") return { k: "aguarda", t: "Aguarda aprovação", tom: "mute", manual: false };
  if (c.prev != null && (diasAte(c.prev) ?? 0) < 0) return { k: "atrasado", t: "Atrasado", tom: "crit", manual: false };
  if (c.prev != null) return { k: "a_caminho", t: "A caminho", tom: "info", manual: false };
  return { k: "sem_previsao", t: "Sem previsão", tom: "mute", manual: false };
}

/** Material recebido (total ou parcial) sem NF de entrada há mais de 5 dias. */
export function materialSemNfAtrasado(c: Compra): boolean {
  const m = c.matManual;
  if (c.recebidoEm != null || !m || (m.v !== "recebido_sem_nf" && m.v !== "parcial") || !m.em) return false;
  return (Date.now() - new Date(m.em).getTime()) / 86_400_000 > DIAS_SEM_NF;
}
/** Item que não precisa de compra (veio do estoque ou saiu do escopo). */
export const naoPrecisaComprar = (c: Compra) => c.matManual?.v === "estoque" || c.matManual?.v === "cancelado";

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
  /** Data de emissão: do PV/OS (avulsos), a mais antiga dos PVs (projetos), do PC (PCs). */
  emissao: number | null;
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
    matManual: (() => {
      const m = ((r.custom_fields as Record<string, unknown> | null) ?? {}).mat_status as MatManual | undefined;
      return m && typeof m === "object" && m.v ? m : null;
    })(),
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

/** Faturado ou não. Avulso = um PV. Projeto = vários PVs: só está faturado
 *  quando TODOS os PVs dele estão encerrados (antes valia o 1º da lista, e um
 *  projeto com um PV antigo faturado sumia de "Em aberto"). */
function situacaoFaturamento(rows: AnyRow[], head: AnyRow, modulo: string): { faturado: boolean; nfSaida: string; fatEm: number | null } {
  if (modulo !== "projetos") return { faturado: encerrado(head), nfSaida: s(head.pv_num_nfe), fatEm: dataMs(head.pv_dt_fat) };
  const porPv = new Map<string, AnyRow>();
  for (const r of rows) { const pv = s(r.pv_os_label); if (pv && !porPv.has(pv)) porPv.set(pv, r); }
  const pvs = [...porPv.values()];
  if (!pvs.length || !pvs.every(encerrado)) return { faturado: false, nfSaida: "", fatEm: null };
  const ult = pvs.reduce((a, r) => ((dataMs(r.pv_dt_fat) ?? 0) > (dataMs(a.pv_dt_fat) ?? 0) ? r : a), pvs[0]);
  const nfs = [...new Set(pvs.map((r) => s(r.pv_num_nfe)).filter(Boolean))];
  return { faturado: true, nfSaida: nfs.join(", "), fatEm: dataMs(ult.pv_dt_fat) };
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
  // Item sem PC próprio herda o material dos PCs da RC dele (ou do pedido,
  // se o item não tem RC): um PC atende a RC inteira, não item a item.
  const comPc = compras.filter((c) => c.pc);
  for (const c of compras) {
    if (c.pc) continue;
    const daRc = c.rcNumero ? comPc.filter((x) => x.rcNumero === c.rcNumero) : [];
    c.pcsRef = daRc.length ? daRc : comPc;
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
    ...situacaoFaturamento(bucket.rows, head, modulo),
    emissao: modulo === "pcs" ? dataMs(head.dt_inclusao)
      : modulo === "projetos"
        ? (bucket.rows.map((r) => dataMs(r.pv_emissao)).filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? null)
        : dataMs(head.pv_emissao),
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
  // Um PC pode atender qualquer número de RCs: "sem PC" só quando o pedido
  // tem compra/RC e nenhum PC ainda (Benny, 01/10/2026).
  // Item do estoque ou fora do escopo não precisa de PC.
  if (modulo !== "pcs" && p.compras.some((c) => !naoPrecisaComprar(c)) && estrutura(p).pcs.length === 0) f.push({ tom: "g", t: "sem PC" });
  if (modulo !== "pcs" && p.compras.some(materialSemNfAtrasado)) f.push({ tom: "r", t: "material sem NF" });
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
export function fases(p: Pedido, modulo: string, cadeia?: RentabResumo | null): { lista: Fase[]; atual: Fase | null } {
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
    // Sem relação fixa RC × PC: basta haver PC para a etapa estar feita.
    L.push({ k: "PC", s: nPcs ? "d" : atrasado && E.nRcs ? "l" : "o",
      t: nPcs ? `${plural(nPcs, "pedido de compra", "pedidos de compra")} · ${alvoTxt(E.nRcs)}`
        : E.nRcs ? "nenhum pedido de compra ainda" : "nada a comprar lançado",
      next: "emitir pedido de compra" });
  } else {
    L.push({ k: "PC", s: nPcs ? "d" : "o", t: plural(nPcs, "pedido de compra", "pedidos de compra") });
  }
  L.push({ k: "Aprov", s: nRec ? "l" : nPend ? "p" : nPcs && nAp === nPcs ? "d" : "o",
    t: nRec ? `${plural(nRec, "PC recusado", "PCs recusados")}` : nPend ? `${plural(nPend, "PC aguardando", "PCs aguardando")} aprovação` : nPcs ? `${nAp}/${nPcs} PCs aprovados` : "nenhum PC para aprovar",
    next: nRec ? `resolver ${plural(nRec, "recusa", "recusas")}` : `aprovar ${plural(nPend, "PC", "PCs")}` });
  const soServico = it.length > 0 && it.every((c) => c.servico);
  if (soServico) L.push({ k: "Mat", s: "na", t: "sem material — pedido só de serviço" });
  else {
    // Por item (01/10/2026): conta como "tem o material" recebido pela NF,
    // recebido sem NF e em estoque; "não vai mais" sai da conta.
    const rel = it.filter((c) => c.matManual?.v !== "cancelado").map(materialDoItem);
    const tem = rel.filter((m) => m.k === "recebido" || m.k === "recebido_sem_nf" || m.k === "estoque").length;
    const semNf = rel.filter((m) => m.k === "recebido_sem_nf" || m.k === "parcial").length;
    const late = rel.filter((m) => m.k === "atrasado").length || matLate;
    L.push({ k: "Mat", s: rel.length && tem === rel.length ? "d" : late ? "l" : tem || nRcb || nAp ? "p" : "o",
      t: rel.length ? `${tem}/${rel.length} itens com o material${semNf ? ` · ${semNf} sem NF de entrada` : ""}${late ? ` · ${late} com previsão vencida` : ""}` : "nada comprado ainda",
      next: rel.length ? `material de ${plural(rel.length - tem, "item", "itens")}` : "aguardando compra" });
  }
  if (modulo !== "pcs") {
    // A OS do app de serviços (custom_fields.ww_os_status) manda: se existe,
    // o pedido tem serviço — mesmo que nenhuma compra seja de categoria serviço.
    const os = servicoDoPedido(p);
    L.push(os
      ? (os.st === "Cancelada" ? { k: "Serv", s: "na", t: "OS cancelada" }
        : { k: "Serv", s: os.st === "Concluída" ? "d" : os.prev != null && (diasAte(os.prev) ?? 0) < 0 ? "l" : (os.st === "Aberta" || !os.st) ? "o" : "p",
          t: `${os.os ? `OS ${os.os} · ` : ""}${os.rotulo}${os.prev ? ` · prev. ${dBR(os.prev)}` : ""}`,
          next: os.os ? `serviço ${os.rotulo.toLowerCase()}` : "vincular OS no app de serviços" })
      : srv.length
      ? { k: "Serv", s: srvOk === srv.length ? "d" : srvOk ? "p" : "o", t: `${srvOk}/${srv.length} serviços concluídos`, next: "concluir serviços" }
      : { k: "Serv", s: "na", t: "sem serviço neste pedido" });
    L.push(p.faturado
      ? { k: "NF saída", s: "d", t: `NF ${p.nfSaida || "emitida"}` }
      : { k: "NF saída", s: L.find((x) => x.k === "Mat")?.s === "d" || (nPcs && nRcb === nPcs) ? (atrasado ? "l" : "p") : "o", t: "NF de saída não emitida", next: "emitir NF de saída" });
  }
  const atual = L.find((x) => x.s !== "d" && x.s !== "na") ?? null;
  /* Pago / Receb. (05/10/2026): o fim da cadeia — compras pagas e venda
     recebida, de sales.mv_rentab_pvos (baixas do painel + títulos do Omie).
     Entram DEPOIS de escolher a etapa atual: são informação de financeiro e
     não mudam "em que etapa o pedido está", nem os filtros e o kanban. */
  if (cadeia && modulo !== "pcs") {
    L.push(cadeia.n_pc === 0
      ? { k: "Pago", s: "na", t: "sem compra a pagar" }
      : { k: "Pago", s: cadeia.pago_ok ? "d" : cadeia.n_pago > 0 ? "p" : "o", t: `${cadeia.n_pago}/${cadeia.n_pc} PCs pagos` });
    const pr = cadeia.pct_recebido;
    L.push(!p.faturado && !cadeia.faturado
      ? { k: "Receb.", s: "o", t: "aguardando faturamento" }
      : { k: "Receb.", s: cadeia.recebido_ok ? "d" : pr && pr > 0 ? "p" : "o",
          t: cadeia.recebido_ok ? "venda recebida" : pr != null ? `${Math.round(pr * 100)}% recebido` : "sem título a receber lançado" });
  }
  return { lista: L, atual };
}

/** Tipo da venda normalizado em 3 baldes — Mix / Serviço / Mercantil — como
 *  na tela antiga (pedido_venda → Mercantil, ordem_servico → Serviço). */
export function tipoVenda(t: string): "Mix" | "Serviço" | "Mercantil" | "" {
  const x = t.trim().toLowerCase();
  if (!x) return "";
  if (x === "mix") return "Mix";
  if (/^(servi[cç]os?|ordem_servico)$/.test(x)) return "Serviço";
  if (/^(mercantil|pedido_venda)$/.test(x)) return "Mercantil";
  return "";
}

export type Servico = {
  pv: string;               // PV/OS a que a OS pertence
  todos: Servico[];         // todas as OS do pedido (projeto pode ter várias)
  os: string;               // nº da OS no app de serviços ("" se sem vínculo)
  st: string;               // status cru da OS (Aberta, Parcial, Em Execução, Concluída, Cancelada)
  rotulo: string;           // como a tela antiga mostrava (Pode faturar, OS pendente, Aguardando, Sem vínculo…)
  tom: "ok" | "warn" | "crit" | "info" | "mute";
  prev: number | null;      // previsão do serviço (vem do app de serviços — só leitura)
  concluidoEm: number | null;
  alteracoes: number;
  historico: { data: string | null; em: string; por: string }[];
};

/** Serviço atrasado: previsão do app de serviços vencida e OS ainda não
 *  concluída nem cancelada. */
export function servicoAtrasado(sv: Servico | null): boolean {
  return !!sv && sv.prev != null && sv.st !== "Concluída" && sv.st !== "Cancelada" && (diasAte(sv.prev) ?? 0) < 0;
}

/** Serviço do pedido (PV/OS), a partir do app de serviços — mesmo critério da
 *  coluna "Status OS" da tela antiga. Mercantil sem OS não tem serviço. */
function servicoDasLinhas(rows: AnyRow[], tipoTxt: string, pv: string): Servico | null {
  const tipo = tipoVenda(tipoTxt);
  // Junta o que houver em QUALQUER linha: o app de serviços às vezes grava o
  // status numa linha e o nº da OS noutra.
  let os = "", st = "", prev: number | null = null, conc: number | null = null, podeFat = false, alt = 0;
  let hist: Servico["historico"] = [];
  for (const r of rows) {
    const cf = (r.custom_fields as Record<string, unknown> | null) ?? {};
    os ||= s(r.servicos_os_numero);
    st ||= s(cf.ww_os_status);
    prev ??= dataMs(r.nova_prev_servicos);
    conc ??= dataMs(cf.ww_os_concluida_em ?? r.servicos_concluidos_em);
    podeFat ||= cf.ww_pode_faturar === true;
    alt = Math.max(alt, Number(cf.ww_nova_prev_alteracoes) || 0);
    if (!hist.length && Array.isArray(cf.ww_nova_prev_historico)) hist = cf.ww_nova_prev_historico as Servico["historico"];
  }
  if (!os && !st && prev == null) {
    if (tipo === "Mix" || tipo === "Serviço") {
      return { pv, os: "", st: "", rotulo: "Sem vínculo", tom: "warn", prev: null, concluidoEm: null, alteracoes: 0, historico: [], todos: [] };
    }
    return null;
  }
  const [rotulo, tom]: [string, Servico["tom"]] =
    st === "Cancelada" ? ["Cancelada", "mute"]
    : st === "Concluída" ? (podeFat ? ["Concluída", "ok"] : ["OS pendente", "warn"])
    : st === "Em Execução" ? ["Em execução", "info"]
    : st === "Parcial" ? ["Parcial", "info"]
    : st === "Aberta" ? ["Aberta", "mute"]
    : os ? ["Aguardando", "mute"] : ["Sem vínculo", "warn"];
  return { pv, os, st, rotulo, tom, prev, concluidoEm: conc, alteracoes: alt || hist.length, historico: hist, todos: [] };
}

/** Ordem de urgência para escolher qual OS mostrar quando há várias. */
const ORDEM_SERV = ["Sem vínculo", "Aguardando", "Aberta", "Em execução", "Parcial", "OS pendente", "Concluída", "Cancelada"];

/** Serviço do pedido. Avulso = um PV/OS. Projeto pode ter várias OS: mostra a
 *  mais urgente (atrasada, depois a menos avançada) e guarda todas em `todos`
 *  — os filtros acham o projeto se QUALQUER OS bater (01/10/2026). */
export function servicoDoPedido(p: Pedido): Servico | null {
  const porPv = new Map<string, AnyRow[]>();
  for (const r of p.bucket.rows) { const k = s(r.pv_os_label); porPv.set(k, [...(porPv.get(k) ?? []), r]); }
  const todas = [...porPv.entries()]
    .filter(([pv]) => pv) // linhas direto no projeto (sem PV) não têm OS
    .map(([pv, rows]) => servicoDasLinhas(rows, s(rows[0]?.tipo_omie) || p.tipo, pv))
    .filter((x): x is Servico => !!x);
  // Só OS de verdade (nº, status ou previsão do app de serviços). "Sem vínculo"
  // só quando o pedido não tem OS nenhuma — senão vira ruído em projeto com vários PVs.
  const lista = todas.filter((x) => x.os || x.st || x.prev != null);
  if (!lista.length) {
    const sv = todas.find((x) => x.rotulo === "Sem vínculo");
    return sv ? { ...sv, todos: [] } : null;
  }
  const ordenada = [...lista].sort((a, b) =>
    (servicoAtrasado(b) ? 1 : 0) - (servicoAtrasado(a) ? 1 : 0) || ORDEM_SERV.indexOf(a.rotulo) - ORDEM_SERV.indexOf(b.rotulo));
  return { ...ordenada[0], todos: lista };
}

/** Todas as OS do pedido (uma em avulsos; uma ou mais em projetos). */
export const servicosDoPedido = (sv: Servico | null): Servico[] => (sv ? (sv.todos.length ? sv.todos : [sv]) : []);

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

/** Margens do PROJETO (07/10/26, Benny — PJ361 mostrava M.B. −16%: o M.B. somava os PCs
 *  E os itens da RC sem PC, e no projeto os PCs saem da Lista sem ligar à RC — a mesma
 *  compra contava duas vezes). Duas margens, lado a lado:
 *    projetada = (PV − budget de materiais da RC) ÷ PV
 *    real      = (PV − PCs aprovados) ÷ PV   (cada PC uma vez; recebido conta como aprovado)
 *  `comPendentes` = a real se os PCs aguardando aprovação forem aprovados. */
export function margensProjeto(p: Pedido, budgetMateriais: number | null) {
  const porPc = new Map<string, { v: number; e: Estado }>();
  for (const c of p.compras) if (c.pc && c.pcValor != null) porPc.set(c.pc, { v: c.pcValor, e: c.estado });
  let aprov = 0, pend = 0;
  for (const { v, e } of porPc.values()) { if (e === "aprovado" || e === "recebido") aprov += v; else if (e === "pendente") pend += v; }
  const pv = p.valorPv;
  const m = (custo: number) => (pv > 0 ? { valor: pv - custo, pct: (pv - custo) / pv } : null);
  return { pv, aprov, pend, budget: budgetMateriais,
    // sem PC aprovado não há custo real ainda: "—", não 100%
    projetada: budgetMateriais != null ? m(budgetMateriais) : null, real: aprov > 0 ? m(aprov) : null, comPendentes: aprov + pend > 0 ? m(aprov + pend) : null };
}

// ── Filtros ────────────────────────────────────────────────────────────────
export type Escopo = "aberto" | "faturado" | "todos";
/** "7"/"30" = entrou no painel (emissão do PV/OS · PC) nos últimos N dias —
 *  era o prazo até 06/10/26; as visões salvas com "7"/"30" passam a ser por entrada.
 *  "vence7" = prazo nos próximos 7 dias (o comportamento antigo). */
export type Periodo = "tudo" | "7" | "30" | "vence7" | "vencidos";
export type Rapida = "todos" | "minha" | "atrasados" | "sem_pc" | "alarme"
  | "serv_exec" | "serv_agend" | "serv_semos" | "pode_fat"
  | "venda_atraso" | "compra_atraso" | "recusa" | "sem_projeto" | "serv_atraso"
  | `serv_st:${string}`
  | "mat_estoque" | "mat_sem_nf" | "mat_parcial" | "mat_alarme";

/** Status de serviço, na ordem em que aparecem nos filtros (rótulos da tela). */
export const STATUS_SERVICO: { rotulo: string; tom: Servico["tom"]; desc: string }[] = [
  { rotulo: "Aberta", tom: "mute", desc: "OS aberta no app de serviços" },
  { rotulo: "Em execução", tom: "info", desc: "OS em execução" },
  { rotulo: "Parcial", tom: "info", desc: "OS executada em parte" },
  { rotulo: "Concluída", tom: "ok", desc: "OS concluída e liberada para faturar" },
  { rotulo: "OS pendente", tom: "warn", desc: "OS concluída, mas ainda não liberada para faturar" },
  { rotulo: "Aguardando", tom: "mute", desc: "OS vinculada, sem status do app de serviços" },
  { rotulo: "Sem vínculo", tom: "warn", desc: "Venda com serviço e nenhuma OS no app de serviços" },
  { rotulo: "Cancelada", tom: "mute", desc: "OS cancelada" },
];
export type Filtros = {
  tipo?: string; etapaVenda?: string; projeto?: string;
  estado?: Estado; fornecedor?: string; categoria?: string;
};
export const FILTRO_LABEL: Record<keyof Filtros, string> = {
  tipo: "Tipo de venda", etapaVenda: "Etapa venda", projeto: "Projeto",
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
  // Tipo normalizado: o Omie grava "Mercantil" e "pedido_venda", "Serviços" e "ordem_servico".
  if (f.tipo && (tipoVenda(p.tipo) || p.tipo) !== f.tipo) return false;
  if (f.etapaVenda && p.etapaVenda !== f.etapaVenda) return false;
  if (f.projeto && (f.projeto === "Sem projeto" ? !!p.projeto : p.projeto !== f.projeto)) return false;
  // "Sem PC" é do pedido (nenhum PC emitido) — um PC pode atender qualquer RC,
  // então linha sem PC num pedido que já tem PC não é pendência.
  if (f.estado === "sem_pc") { if (!p.flags.some((x) => x.t === "sem PC")) return false; }
  else if (f.estado && c?.estado !== f.estado) return false;
  // O Omie tem o mesmo fornecedor grafado em caixas diferentes (INDFILTROS/Indfiltros).
  if (f.fornecedor && (c?.fornecedor ?? "").toUpperCase() !== f.fornecedor.toUpperCase()) return false;
  if (f.categoria && c?.categoria !== f.categoria) return false;
  const d = diasAte(p.lim);
  const desde = diasAte(p.emissao); // ≤ 0: dias desde a emissão/entrada
  if (per === "7" && (desde == null || desde < -7)) return false;
  if (per === "30" && (desde == null || desde < -30)) return false;
  if (per === "vence7" && (d == null || d < 0 || d > 7)) return false;
  if (per === "vencidos" && (d == null || d >= 0)) return false;
  if (rap === "minha" && c?.estado !== "pendente") return false;
  if (rap === "atrasados" && !p.flags.some((x) => x.t === "venda em atraso" || x.t === "compra em atraso")) return false;
  if (rap === "sem_pc" && !p.flags.some((x) => x.t === "sem PC")) return false;
  if (rap === "alarme" && !p.flags.some((x) => x.t !== "sem PC")) return false;
  if (rap.startsWith("mat_")) {
    // Filtros de material são por item: no pedido aberto ficam só os itens que batem.
    if (!c) return false;
    const m = c.matManual?.v;
    if (rap === "mat_estoque" && m !== "estoque") return false;
    if (rap === "mat_sem_nf" && !(m === "recebido_sem_nf" && c.recebidoEm == null)) return false;
    if (rap === "mat_parcial" && !(m === "parcial" && c.recebidoEm == null)) return false;
    if (rap === "mat_alarme" && !materialSemNfAtrasado(c)) return false;
  }
  if (rap === "venda_atraso" && !p.flags.some((x) => x.t === "venda em atraso")) return false;
  if (rap === "compra_atraso" && !p.flags.some((x) => x.t === "compra em atraso")) return false;
  if (rap === "recusa" && !p.flags.some((x) => x.t === "recusa a resolver")) return false;
  if (rap === "sem_projeto" && !p.flags.some((x) => x.t === "sem projeto")) return false;
  if (rap.startsWith("serv_") || rap === "pode_fat") {
    const sv = servicoDoPedido(p);
    const tds = servicosDoPedido(sv);
    if (rap === "serv_exec" && !tds.some((x) => x.st === "Concluída")) return false;
    if (rap === "serv_atraso" && !tds.some((x) => servicoAtrasado(x))) return false;
    if (rap.startsWith("serv_st:") && !tds.some((x) => x.rotulo === rap.slice("serv_st:".length))) return false;
    // Agendado = serviço existe no app (OS ou status) e não foi concluído nem cancelado.
    if (rap === "serv_agend" && !tds.some((x) => (x.os || x.st) && x.st !== "Concluída" && x.st !== "Cancelada")) return false;
    // Sem OS = exatamente o que a tela mostra como "sem OS": falta o nº da OS.
    if (rap === "serv_semos" && !tds.some((x) => !x.os)) return false;
    if (rap === "pode_fat" && !p.flags.some((x) => x.t === "pode faturar")) return false;
  }
  return true;
}

// ── Ordenação (cabeçalho clicável, como no Excel — 06/10/26) ──────────────
export type OrdemCampo = "emissao" | "pedido" | "cliente" | "etapas" | "prazo" | "servico" | "rc" | "pc" | "pv" | "mb";
export type Ordem = { k: OrdemCampo; d: 1 | -1 };
export const ORDEM_PADRAO: Ordem = { k: "emissao", d: -1 }; // mais novo primeiro

const numDoRotulo = (id: string) => { const m = /(\d+)/.exec(id); return m ? Number(m[1]) : null; };

/** Valor de ordenação de um pedido para a coluna escolhida (null vai sempre para o fim). */
export function chaveOrdem(p: Pedido, k: OrdemCampo, modulo: string): number | string | null {
  switch (k) {
    case "emissao": return p.emissao;
    case "pedido": return numDoRotulo(p.id) ?? p.id;
    case "cliente": return p.cliente || null;
    case "prazo": return diasAte(p.lim);
    case "etapas": {
      const L = fases(p, modulo).lista;
      return L.length ? L.filter((f) => f.s === "d" || f.s === "na").length / L.length : null;
    }
    case "servico": {
      const sv = servicoDoPedido(p);
      return sv ? ORDEM_SERV.indexOf(sv.rotulo) : null;
    }
    default: {
      const f = financeiro(p);
      if (k === "rc") return f.rc || null;
      if (k === "pc") return f.pc || null;
      if (k === "pv") return p.valorPv || null;
      return f.mb;
    }
  }
}

export function ordenarPedidos<T extends { p: Pedido }>(lista: T[], o: Ordem, modulo: string): T[] {
  const ch = new Map(lista.map((x) => [x.p.id, chaveOrdem(x.p, o.k, modulo)]));
  return [...lista].sort((a, b) => {
    const va = ch.get(a.p.id), vb = ch.get(b.p.id);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR", { numeric: true });
    return r * o.d || ((numDoRotulo(b.p.id) ?? 0) - (numDoRotulo(a.p.id) ?? 0));
  });
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
