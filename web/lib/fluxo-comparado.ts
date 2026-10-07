// Fluxo de caixa do projeto: INICIAL (travado) × EM ANDAMENTO — 07/10/26, Benny.
// Usada por /api/rc-projetos/fluxo-comparado (Projeto › 4 Fluxo de caixa, gráfico).
//
// ── Fluxo INICIAL ────────────────────────────────────────────────────────────
//   approval.projeto_fluxo_inicial (sql/112): foto do plano do fechamento na primeira
//   importação — parcelas pela data do plano (dt_plano) e agenda de saídas (no_fluxo).
//   Nunca muda; só "Redefinir fluxo inicial" (administrador) refaz a foto.
//   Sem a sql/112 aplicada, cai no plano vivo com as mesmas regras (e avisa).
//
// ── Fluxo EM ANDAMENTO ───────────────────────────────────────────────────────
//   ENTRADAS  cada parcela do plano, pela data ATUAL de recebimento:
//               título a receber (PV/OS faturado)  →  vencimento do título
//               senão a nova previsão de recebimento (projeto_plano_parcela.dt_ajustada,
//               a mesma que Operação › Projetos › Vendas do projeto grava)
//               senão a inicial (dt_plano).
//             Projeto sem parcelas no plano: os PV/OS (nova previsão de faturamento,
//             senão a inicial).
//   SAÍDAS    PCs do projeto (sem os escondidos, cancelados e reprovados): parcelas do
//               PC (vencimento); sem parcelas, previsão de entrega (a remarcada na
//               Operação vence) + prazo da condição de pagamento.
//             + linhas da Lista de materiais SEM PC: valor estimado, na data
//               "necessário em" (senão a primeira data de material do plano).
//             + saídas do plano que NÃO são material (obra/despesas, origem sem_pc).
//   REALIZADO títulos baixados do projeto (bi.projeto_realizado_diario), na data da
//             baixa. O que já foi baixado sai do previsto em ordem de data (FIFO):
//             entradas — primeiro as parcelas já marcadas recebidas, depois por data;
//             saídas — PCs por data, depois obra/despesas. Lista sem PC não é paga.
//   Previsto VENCIDO (data < hoje e ainda não baixado) conta como hoje.
//
// ── Sem contar duas vezes ────────────────────────────────────────────────────
//   Saída de MATERIAL do plano é substituída por PCs + Lista: se o projeto tem PC ou
//   linha na Lista, as saídas "material" do plano saem do andamento. Projeto sem PC e
//   sem Lista mantém as do plano (senão o andamento ficaria sem material nenhum).
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { montar, dia, difDias } from "@/lib/vendas-projeto";
import { estadoPc } from "@/lib/situacao-pc";

export type EvFluxo = {
  tipo: "entrada" | "saida";
  data: string | null;
  valor: number;
  descricao: string;
  origem: "parcela" | "pv_os" | "pc" | "lista" | "material" | "sem_pc" | "manual" | "realizado";
  status: "previsto" | "realizado" | "vencido";
  ref?: string | null;
  /** data original quando o vencido foi trazido para hoje */
  data_original?: string | null;
};

export type ParcelaDelta = {
  parcela: number; descricao: string;
  inicial_data: string | null; inicial_valor: number;
  atual_data: string | null; atual_valor: number; fonte_data: string;
};

export type FluxoComparado = {
  inicial: EvFluxo[];
  atual: EvFluxo[];
  inicial_fonte: "congelado" | "plano_vivo" | "vazio";
  inicial_em: string | null; inicial_proposta: string | null;
  plano_mudou: boolean;
  parcelas: ParcelaDelta[];
  saidas_plano: { descricao: string; origem: string; inicial_data: string | null; inicial_valor: number }[];
  regra_material: "substituido" | "mantido";
  avisos: string[];
  hoje: string;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const somaDias = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
};
/** Dias da condição de pagamento a partir da descrição ("28 dias", "30/60/90", "À vista"). */
export function diasCondicao(desc: string | null | undefined, cod?: string | null): number[] {
  const t = String(desc ?? "").toLowerCase();
  if (/vista|antecipad/.test(t) && !/\d/.test(t)) return [0];
  const ns = (t.match(/\d{1,3}/g) ?? []).map(Number).filter((n) => n <= 365);
  // "3 parcelas" sem dias não é prazo: fica o código (A28 → 28)
  if (ns.length && !/parcela/.test(t)) return ns;
  const m = String(cod ?? "").match(/^A(\d{1,3})$/i);
  if (m) return [Number(m[1])];
  if (String(cod ?? "") === "000") return [0];
  return ns.length ? ns : [0];
}

type Ped = {
  id?: number; tipo?: string; num?: string | null; forn?: string | null; valor?: number | null;
  previsao?: string | null; emissao?: string | null; parc?: string | null; ncodPed?: number | null;
  etapa?: string | null; aprov?: string | null; cancelado?: boolean | null; dtRec?: string | null; dtFat?: string | null;
  enviadoEm?: string | null; parcelas?: { venc?: string | null; valor?: number | null }[];
};
type ItemLista = { id: string; item: string; modelo: string | null; estimado: number | null; qtd: number | null; custo: number | null;
  data_necessaria: string | null; pcs: { pedido_id: number; pc: string }[] };

export async function montarFluxoComparado(empresa: string, codigo: number, quem: string | null): Promise<FluxoComparado> {
  const adm = supaAdmin();
  const ap = adm.schema("approval");
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // America/Sao_Paulo
  const avisos: string[] = [];

  // ── leituras em paralelo ─────────────────────────────────────────────────
  /* O banco às vezes estoura o statement timeout (refresh das MVs na mesma hora, ou
     consultas pesadas em paralelo): tenta de novo duas vezes, e as duas pesadas
     (lista e realizado) rodam depois das leves, uma de cada vez. */
  const comRetry = async <T,>(f: () => PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
    let r = await f();
    for (let t = 0; t < 2 && r.error && /timeout|canceling statement/i.test(r.error.message); t++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      r = await f();
    }
    return r;
  };
  const [ini0, planoCab, parcPlano, saidPlano, vendas, pcItens, manuais, condicoes] = await Promise.all([
    ap.from("projeto_fluxo_inicial").select("tipo, data, valor, descricao, origem, ref, proposta, congelado_em")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).order("data", { ascending: true }),
    ap.from("projeto_plano").select("proposta").eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
    ap.from("projeto_plano_parcela").select("parcela, evento, valor, dt_plano, dt_ajustada")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).order("parcela"),
    ap.from("projeto_plano_saida").select("id, origem, descricao, fornecedor, dt_prevista, valor, no_fluxo")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).order("dt_prevista"),
    montar(empresa, codigo).catch((e: Error) => { avisos.push(`PV/OS não carregaram (${e.message}).`); return { docs: [], parcelas: [] }; }),
    comRetry(() => ap.rpc("_projeto_pc_itens", { p_empresa: empresa, p_projeto: codigo })),
    ap.from("projeto_fluxo_linha").select("tipo, descricao, data_prevista, valor")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
    adm.schema("finance").from("parcelas").select("codigo, descricao"),
  ]);
  const realiz = await comRetry(() => adm.schema("bi").rpc("projeto_realizado_diario", { p_codigo_projeto: codigo, p_empresas: [empresa] }));
  const listaR = await comRetry(() => ap.rpc("rc_projetos_compras", { p_empresa: empresa, p_projeto: codigo }));
  if (listaR.error) avisos.push(`Lista de materiais não carregou (${listaR.error.message}) — linhas sem PC fora do andamento.`);
  const lista = (listaR.data ?? null) as { itens?: ItemLista[] } | null;

  const parcelasPlano = ((parcPlano.data ?? []) as { parcela: number; evento: string | null; valor: number | null; dt_plano: string | null; dt_ajustada: string | null }[]);
  const saidasPlano = ((saidPlano.data ?? []) as { id: number; origem: string; descricao: string | null; fornecedor: string | null; dt_prevista: string | null; valor: number | null; no_fluxo: boolean | null }[])
    .filter((s) => s.no_fluxo !== false);

  // ── INICIAL ──────────────────────────────────────────────────────────────
  type IniRow = { tipo: "entrada" | "saida"; data: string | null; valor: number; descricao: string | null; origem: string; ref: string | null; proposta: string | null; congelado_em: string };
  let iniRows: IniRow[] = [];
  let inicial_fonte: FluxoComparado["inicial_fonte"] = "vazio";
  if (ini0.error) {
    avisos.push("O fluxo inicial travado ainda não existe no banco (sql/112) — mostrando o plano atual como inicial.");
  } else {
    iniRows = (ini0.data ?? []) as IniRow[];
    if (!iniRows.length && (parcelasPlano.length || saidasPlano.length)) {
      // primeira vez que o projeto é aberto com plano: congela agora
      const c = await ap.rpc("fluxo_inicial_congelar", { p_empresa: empresa, p_codigo: codigo, p_quem: quem, p_forcar: false });
      if (!c.error) {
        const deNovo = await ap.from("projeto_fluxo_inicial").select("tipo, data, valor, descricao, origem, ref, proposta, congelado_em")
          .eq("empresa", empresa).eq("codigo_projeto", codigo).order("data", { ascending: true });
        iniRows = (deNovo.data ?? []) as IniRow[];
      }
    }
  }
  let inicial: EvFluxo[];
  if (iniRows.length) {
    inicial_fonte = "congelado";
    inicial = iniRows.map((r) => ({
      tipo: r.tipo, data: dia(r.data), valor: Number(r.valor) || 0, descricao: r.descricao ?? "",
      origem: (r.origem === "parcela" ? "parcela" : r.origem === "sem_pc" ? "sem_pc" : "material") as EvFluxo["origem"],
      status: "previsto", ref: r.ref,
    }));
  } else {
    inicial = [
      ...parcelasPlano.map((p) => ({ tipo: "entrada" as const, data: dia(p.dt_plano), valor: Number(p.valor) || 0,
        descricao: p.evento || `Parcela ${p.parcela}`, origem: "parcela" as const, status: "previsto" as const, ref: String(p.parcela) })),
      ...saidasPlano.map((s) => ({ tipo: "saida" as const, data: dia(s.dt_prevista), valor: Number(s.valor) || 0,
        descricao: s.descricao || s.fornecedor || "Saída do plano", origem: (s.origem === "sem_pc" ? "sem_pc" : "material") as EvFluxo["origem"],
        status: "previsto" as const, ref: String(s.id) })),
    ];
    if (inicial.length) inicial_fonte = "plano_vivo";
  }
  const inicial_em = iniRows[0]?.congelado_em ?? null;
  const inicial_proposta = iniRows[0]?.proposta ?? null;
  const somaT = (l: { tipo: string; valor: number }[], t: string) => r2(l.filter((x) => x.tipo === t).reduce((a, x) => a + x.valor, 0));
  const planoVivoEnt = r2(parcelasPlano.reduce((a, p) => a + (Number(p.valor) || 0), 0));
  const planoVivoSai = r2(saidasPlano.reduce((a, s) => a + (Number(s.valor) || 0), 0));
  const plano_mudou = inicial_fonte === "congelado" && (
    Math.abs(planoVivoEnt - somaT(inicial, "entrada")) > 0.05 || Math.abs(planoVivoSai - somaT(inicial, "saida")) > 0.05
    || (!!(planoCab.data as { proposta?: string } | null)?.proposta && (planoCab.data as { proposta?: string }).proposta !== inicial_proposta));

  // ── EM ANDAMENTO: entradas ───────────────────────────────────────────────
  type Pend = EvFluxo & { prioridade: number };
  const entPend: Pend[] = [];
  const parcelasDelta: ParcelaDelta[] = [];
  const docs = vendas.docs;
  if (parcelasPlano.length) {
    for (const p of parcelasPlano) {
      const d = docs.find((x) => x.parcela === p.parcela);
      let data = dia(p.dt_ajustada) ?? dia(p.dt_plano);
      let fonte = p.dt_ajustada ? "nova previsão" : "previsão inicial";
      if (d?.faturado && d.titulo_venc) { data = d.titulo_venc; fonte = `título ${d.rotulo}`; }
      const v = Number(p.valor) || 0;
      entPend.push({ tipo: "entrada", data, valor: v, descricao: (p.evento || `Parcela ${p.parcela}`) + (d ? ` · ${d.rotulo}` : ""),
        origem: "parcela", status: "previsto", ref: String(p.parcela), prioridade: d?.recebido ? 0 : 1 });
      const ini = inicial.find((x) => x.tipo === "entrada" && x.ref === String(p.parcela));
      parcelasDelta.push({ parcela: p.parcela, descricao: p.evento || `Parcela ${p.parcela}`,
        inicial_data: ini?.data ?? null, inicial_valor: ini?.valor ?? 0, atual_data: data, atual_valor: v, fonte_data: fonte });
    }
  } else {
    for (const d of docs) {
      entPend.push({ tipo: "entrada", data: d.titulo_venc ?? d.fat_nova ?? d.fat_inicial, valor: d.valor,
        descricao: `${d.rotulo}${d.evento ? ` · ${d.evento}` : ""}`, origem: "pv_os", status: "previsto", ref: d.chave, prioridade: d.recebido ? 0 : 1 });
    }
  }

  // ── EM ANDAMENTO: saídas ─────────────────────────────────────────────────
  const condMap = new Map(((condicoes.data ?? []) as { codigo: string; descricao: string }[]).map((c) => [String(c.codigo), c.descricao]));
  const doProjeto = (pcItens.data ?? []) as { pedido_id: number; numero: string }[];
  const idsPc = [...new Set(doProjeto.map((x) => Number(x.pedido_id)).filter(Boolean))].slice(0, 150);
  const numsPc = [...new Set(doProjeto.map((x) => String(x.numero)))];
  const [peds, exc] = await Promise.all([
    Promise.all(idsPc.map(async (id) => ((await adm.schema("orders").rpc("compras_pedido", { p_id: id })).data ?? null) as Ped | null)),
    numsPc.length ? adm.schema("platform").from("excluded_pc").select("pc_numero").eq("empresa", empresa).in("pc_numero", numsPc) : Promise.resolve({ data: [] }),
  ]);
  const escondidos = new Set(((exc.data ?? []) as { pc_numero: string }[]).map((x) => String(x.pc_numero)));
  // previsão remarcada na Operação ("Nova prev. materiais") vence a do PC — mesma regra da Lista
  const ncods = peds.map((p) => Number(p?.ncodPed)).filter((x) => x > 0);
  const novaPrev = new Map<number, string>();
  if (ncods.length) {
    const { data } = await ap.from("approvals").select("ncod_ped, custom_fields").eq("empresa", empresa).in("ncod_ped", ncods);
    for (const a of (data ?? []) as { ncod_ped: number; custom_fields: Record<string, unknown> | null }[]) {
      const v = a.custom_fields?.s4b87bk9;
      if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) novaPrev.set(Number(a.ncod_ped), String(v).slice(0, 10));
    }
  }
  const saiPend: Pend[] = [];
  const pcsValidos = new Set<number>();
  for (const p of peds) {
    if (!p || p.tipo === "RC" || !p.id) continue;
    if (p.num && escondidos.has(String(p.num))) continue;
    const e = estadoPc({ etapa: p.etapa, aprov: p.aprov, cancelado: p.cancelado, dt_rec: p.dtRec, dt_fat: p.dtFat, enviado_em: p.enviadoEm }).chave;
    if (e === "cancelado" || e === "reprovado") continue;
    pcsValidos.add(Number(p.id));
    const rot = `PC ${p.num ?? p.id}${p.forn ? ` · ${p.forn}` : ""}`;
    const parcs = (p.parcelas ?? []).filter((x) => Number(x.valor) > 0);
    if (parcs.length) {
      parcs.forEach((x, i) => saiPend.push({ tipo: "saida", data: dia(x.venc) ?? dia(p.previsao) ?? dia(p.emissao), valor: Number(x.valor) || 0,
        descricao: parcs.length > 1 ? `${rot} (${i + 1}/${parcs.length})` : rot, origem: "pc", status: "previsto", ref: String(p.num ?? p.id), prioridade: 0 }));
    } else {
      const base = novaPrev.get(Number(p.ncodPed)) ?? dia(p.previsao) ?? dia(p.emissao);
      const dias = diasCondicao(condMap.get(String(p.parc ?? "")), p.parc);
      const total = Number(p.valor) || 0;
      const parte = Math.floor((total / dias.length) * 100) / 100;
      dias.forEach((dd, i) => saiPend.push({ tipo: "saida", data: base ? somaDias(base, dd) : null,
        valor: i === dias.length - 1 ? r2(total - parte * (dias.length - 1)) : parte,
        descricao: dias.length > 1 ? `${rot} (${i + 1}/${dias.length})` : rot, origem: "pc", status: "previsto", ref: String(p.num ?? p.id), prioridade: 0 }));
    }
  }
  // Lista de materiais sem PC (ou só com PC escondido/cancelado)
  const itens = (lista?.itens ?? []) as ItemLista[];
  const dataMaterialPlano = saidasPlano.filter((s) => s.origem !== "sem_pc").map((s) => dia(s.dt_prevista)).filter(Boolean).sort()[0] ?? null;
  const listaSemPc: Pend[] = [];
  for (const it of itens) {
    const comprado = (it.pcs ?? []).some((pc) => pcsValidos.has(Number(pc.pedido_id)));
    if (comprado) continue;
    const v = Number(it.estimado) || (Number(it.qtd) || 0) * (Number(it.custo) || 0);
    if (!(v > 0)) continue;
    listaSemPc.push({ tipo: "saida", data: dia(it.data_necessaria) ?? dataMaterialPlano, valor: r2(v),
      descricao: `Lista: ${[it.item, it.modelo].filter(Boolean).join(" · ")}`, origem: "lista", status: "previsto", ref: it.id, prioridade: 9 });
  }
  const temCompraOuLista = pcsValidos.size > 0 || itens.length > 0;
  const regra_material: FluxoComparado["regra_material"] = temCompraOuLista ? "substituido" : "mantido";
  for (const s of saidasPlano) {
    const material = s.origem !== "sem_pc";
    if (material && temCompraOuLista) continue;
    saiPend.push({ tipo: "saida", data: dia(s.dt_prevista), valor: Number(s.valor) || 0,
      descricao: s.descricao || s.fornecedor || "Saída do plano", origem: material ? "material" : "sem_pc", status: "previsto", ref: String(s.id), prioridade: 1 });
  }
  for (const m of (manuais.data ?? []) as { tipo: "entrada" | "saida"; descricao: string; data_prevista: string; valor: number }[]) {
    (m.tipo === "entrada" ? entPend : saiPend).push({ tipo: m.tipo, data: dia(m.data_prevista), valor: Number(m.valor) || 0,
      descricao: `À mão: ${m.descricao}`, origem: "manual", status: "previsto", prioridade: 2 });
  }

  // ── REALIZADO e baixa FIFO ───────────────────────────────────────────────
  const real = ((realiz.data ?? []) as { dia: string; entrada: number; saida: number }[]);
  if (realiz.error) avisos.push(`Realizado não carregou (${realiz.error.message}).`);
  const realizados: EvFluxo[] = [];
  let totR = 0, totP = 0;
  for (const r of real) {
    const d = dia(r.dia);
    if (Number(r.entrada) > 0) { realizados.push({ tipo: "entrada", data: d, valor: r2(Number(r.entrada)), descricao: "Recebido (título baixado)", origem: "realizado", status: "realizado" }); totR += Number(r.entrada); }
    if (Number(r.saida) > 0) { realizados.push({ tipo: "saida", data: d, valor: r2(Number(r.saida)), descricao: "Pago (título baixado)", origem: "realizado", status: "realizado" }); totP += Number(r.saida); }
  }
  const baixar = (lst: Pend[], total: number) => {
    let rest = total;
    const ord = [...lst].sort((a, b) => a.prioridade - b.prioridade || (a.data ?? "9999").localeCompare(b.data ?? "9999"));
    for (const x of ord) {
      if (rest <= 0.004) break;
      const t = Math.min(x.valor, rest); x.valor = r2(x.valor - t); rest -= t;
    }
    return ord.filter((x) => x.valor > 0.004);
  };
  const entRest = baixar(entPend, totR);
  const saiRest = [...baixar(saiPend, totP), ...listaSemPc];
  const venceHoje = (x: Pend): EvFluxo => {
    const { prioridade: _p, ...ev } = x; void _p;
    if (ev.data && ev.data < hoje) return { ...ev, status: "vencido", data_original: ev.data, data: hoje };
    return ev;
  };
  const atual: EvFluxo[] = [...realizados, ...entRest.map(venceHoje), ...saiRest.map(venceHoje)];

  const semData = atual.filter((x) => !x.data).length + inicial.filter((x) => !x.data).length;
  if (semData) avisos.push(`${semData} lançamento(s) sem data — entram nos totais, não no gráfico.`);

  return {
    inicial, atual, inicial_fonte, inicial_em, inicial_proposta, plano_mudou,
    parcelas: parcelasDelta,
    saidas_plano: inicial.filter((x) => x.tipo === "saida").map((x) => ({ descricao: x.descricao, origem: x.origem, inicial_data: x.data, inicial_valor: x.valor })),
    regra_material, avisos, hoje,
  };
}

export { difDias };
