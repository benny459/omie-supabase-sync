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
  if (modulo !== "pcs" && p.compras.length > 0 && estrutura(p).pcs.length === 0) f.push({ tom: "g", t: "sem PC" });
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
  else L.push({ k: "Mat", s: nPcs && nRcb === nPcs ? "d" : matLate ? "l" : nRcb || nAp ? "p" : "o",
    t: nPcs ? `${nRcb}/${nPcs} PCs recebidos${matLate ? ` · ${matLate} com previsão vencida` : ""}` : "nada comprado ainda",
    next: nPcs ? `receber ${plural(nPcs - nRcb, "PC", "PCs")}` : "aguardando compra" });
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
      : { k: "NF saída", s: nPcs && nRcb === nPcs ? (atrasado ? "l" : "p") : "o", t: "NF de saída não emitida", next: "emitir NF de saída" });
  }
  const atual = L.find((x) => x.s !== "d" && x.s !== "na") ?? null;
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
export function servicoDoPedido(p: Pedido): Servico | null {
  const tipo = tipoVenda(p.tipo);
  // Junta o que houver em QUALQUER linha do pedido: o app de serviços às vezes
  // grava o status numa linha e o nº da OS noutra.
  let os = "", st = "", prev: number | null = null, conc: number | null = null, podeFat = false, alt = 0;
  let hist: Servico["historico"] = [];
  for (const r of p.bucket.rows) {
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
      return { os: "", st: "", rotulo: "Sem vínculo", tom: "warn", prev: null, concluidoEm: null, alteracoes: 0, historico: [] };
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
  return { os, st, rotulo, tom, prev, concluidoEm: conc, alteracoes: alt || hist.length, historico: hist };
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
export type Rapida = "todos" | "minha" | "atrasados" | "sem_pc" | "alarme"
  | "serv_exec" | "serv_agend" | "serv_semos" | "pode_fat"
  | "venda_atraso" | "compra_atraso" | "recusa" | "sem_projeto" | "serv_atraso";
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
  if (per === "7" && (d == null || d < 0 || d > 7)) return false;
  if (per === "30" && (d == null || d < 0 || d > 30)) return false;
  if (per === "vencidos" && (d == null || d >= 0)) return false;
  if (rap === "minha" && c?.estado !== "pendente") return false;
  if (rap === "atrasados" && !p.flags.some((x) => x.t === "venda em atraso" || x.t === "compra em atraso")) return false;
  if (rap === "sem_pc" && !p.flags.some((x) => x.t === "sem PC")) return false;
  if (rap === "alarme" && !p.flags.some((x) => x.t !== "sem PC")) return false;
  if (rap === "venda_atraso" && !p.flags.some((x) => x.t === "venda em atraso")) return false;
  if (rap === "compra_atraso" && !p.flags.some((x) => x.t === "compra em atraso")) return false;
  if (rap === "recusa" && !p.flags.some((x) => x.t === "recusa a resolver")) return false;
  if (rap === "sem_projeto" && !p.flags.some((x) => x.t === "sem projeto")) return false;
  if (rap.startsWith("serv_") || rap === "pode_fat") {
    const sv = servicoDoPedido(p);
    if (rap === "serv_exec" && sv?.st !== "Concluída") return false;
    if (rap === "serv_atraso" && !servicoAtrasado(sv)) return false;
    // Agendado = serviço existe no app (OS ou status) e não foi concluído nem cancelado.
    if (rap === "serv_agend" && !(sv && (sv.os || sv.st) && sv.st !== "Concluída" && sv.st !== "Cancelada")) return false;
    // Sem OS = exatamente o que a tela mostra como "sem OS": falta o nº da OS.
    if (rap === "serv_semos" && !(sv && !sv.os)) return false;
    if (rap === "pode_fat" && !p.flags.some((x) => x.t === "pode faturar")) return false;
  }
  return true;
}

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
