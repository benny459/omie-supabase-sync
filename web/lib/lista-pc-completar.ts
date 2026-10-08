// Completa as compras de cada linha da lista (rc_projetos_compras) com o detalhe do PC.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { acharLinhaPc, valorLinhaPc, deHtml, type LinhaPc } from "@/lib/lista-pc-linha";
import { estadoPc } from "@/lib/situacao-pc";
import { lerAjustes, devolvidoPorPc, valorLiquido, fatorDevolucao, type ResumoDev } from "@/lib/pc-ajustes";

/* 07/10/26 (PJ361): linha ligada só pelo NÚMERO do PC vinha sem valor, quantidade
   nem recebimento — Comprado "—" até em pedido recebido. Aqui cada PC citado
   abre (orders.compras_pedido, que também vê PC de outro projeto) e a linha
   do item é achada dentro dele: código, senão descrição. Junto vêm a data de
   recebimento e o fornecedor sem "&amp;". */
type PcJ = { pc: string; pedido_id: number; fornecedor: string | null; qtd?: number | null; valor_unit?: number | null;
  valor?: number | null; qtd_recebida?: number | null; via: string; dt_rec?: string | null; casado_por?: string | null; etapa?: string | null; aprov?: string | null;
  dt_fat?: string | null; enviado_em?: string | null; aprov_por?: string | null; aprov_em?: string | null; cancelado?: boolean | null;
  previsao?: string | null; previsao_pc?: string | null; devolucao?: "total" | "parcial" | null };
type ItemJ = { id: string; item: string; modelo: string | null; codigo: string | null; pcs: PcJ[]; valor_pc: number | null; fornecedor: string | null };
export type DadosPcs = { itens: ItemJ[]; fora_da_lista: { fornecedor: string | null; pc?: string }[]; totais?: Record<string, unknown> } & Record<string, unknown>;
type PedJ = { dtRec?: string | null; etapa?: string | null; aprov?: string | null; dtFat?: string | null; enviadoEm?: string | null;
  aprovPor?: string | null; aprovEm?: string | null; cancelado?: boolean | null; ncodPed?: number | null; valor?: number | null; num?: string | null;
  previsao?: string | null; emissao?: string | null; parcelas?: { venc?: string | null; valor?: number | null }[];
  itens?: { cod: string | null; desc: string; qtd: number; vu: number; desc0?: number; ipi?: number; st?: number; rec?: number | null }[] };

export async function completarPcs(d: DadosPcs, empresa = "SF", projeto?: number): Promise<DadosPcs> {
  // PCs do projeto (todas as linhas) + os citados pela lista
  const doProjeto = projeto
    ? (((await supaAdmin().schema("approval").rpc("_projeto_pc_itens", { p_empresa: empresa, p_projeto: projeto })).data ?? []) as { pedido_id: number; numero: string }[])
    : [];
  const ids = [...new Set([...d.itens.flatMap((l) => l.pcs.map((p) => Number(p.pedido_id))), ...doProjeto.map((x) => Number(x.pedido_id))].filter(Boolean))].slice(0, 120);
  const peds = new Map<number, PedJ>();
  await Promise.all(ids.map(async (id) => {
    const { data } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: id });
    if (data) peds.set(id, data as PedJ);
  }));
  /* Previsão de entrega EFETIVA (07/10/26): a remarcação feita na Operação
     (approvals "Nova prev. materiais") vale por cima da previsão do PC — a
     mesma regra da Operação, para as duas telas mostrarem a mesma data. */
  const ncods = [...peds.values()].map((p) => Number(p.ncodPed)).filter((x) => x > 0);
  const nova = new Map<number, string>();
  if (ncods.length) {
    const { data } = await supaAdmin().schema("approval").from("approvals").select("ncod_ped, custom_fields")
      .eq("empresa", empresa).in("ncod_ped", ncods);
    for (const a of (data ?? []) as { ncod_ped: number; custom_fields: Record<string, unknown> | null }[]) {
      const v = a.custom_fields?.s4b87bk9;
      if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) nova.set(Number(a.ncod_ped), String(v).slice(0, 10));
    }
  }
  /* Comprometido (07/10/26) com a MESMA definição da lista de Projetos: soma do
     valor de cada PC do projeto UMA vez (valor do pedido, com frete), sem os PCs
     escondidos no painel (platform.excluded_pc — ex.: PJ361, PC 7163). */
  /* Budget de materiais (07/10/26, Benny — PJ361): é o total de MATERIAIS da RC
     (custo_materiais do fechamento do CRM, "materiais" do Custo planejado), ou o
     valor que alguém definiu para materiais (rc_projetos_budget.valor_budget_materiais,
     sql/107). NÃO é o valor_budget: esse é o custo TOTAL (materiais + mão de obra +
     despesas, preenchido sozinho pelo CRM) e continua sendo o teto do Fluxo de caixa.
     Lista, cartão de Projetos e regra de aprovação leem daqui. */
  if (projeto && d.totais) {
    const { data: bud } = await supaAdmin().schema("approval").from("rc_projetos_budget").select("*")
      .eq("empresa", empresa).eq("codigo_projeto", projeto).maybeSingle();
    const manual = (bud as { valor_budget_materiais?: number | null } | null)?.valor_budget_materiais;
    d.totais.budget_fluxo = d.totais.budget_lista ?? null;
    d.totais.budget_lista = manual != null ? Number(manual) : null;
  }
  /* Cancelar / devolver (sql/146): PC cancelado sai das linhas da lista (a linha volta a
     "sem PC") e o valor devolvido sai do comprometido, da barra e do fluxo. */
  const citados = [...new Set([...doProjeto.map((x) => x.numero), ...d.itens.flatMap((l) => l.pcs.map((p) => String(p.pc)))])];
  const [excAll, ajustes] = await Promise.all([
    citados.length ? supaAdmin().schema("platform").from("excluded_pc").select("*").eq("empresa", empresa).in("pc_numero", citados) : Promise.resolve({ data: [] }),
    citados.length ? lerAjustes({ empresa, numeros: citados }) : Promise.resolve({ cancelados: [], devolucoes: [] }),
  ]);
  const cancelados = new Set(((excAll.data ?? []) as { pc_numero: string; tipo?: string }[]).filter((x) => x.tipo === "cancelado").map((x) => String(x.pc_numero)));
  const devPc = new Map<string, ResumoDev>([...devolvidoPorPc(ajustes.devolucoes)].map(([k, v]) => [k.split("|")[1], v]));
  for (const l of d.itens) {
    if (cancelados.size) l.pcs = l.pcs.filter((p) => !cancelados.has(String(p.pc)));
    for (const p of l.pcs) { const dv = devPc.get(String(p.pc)); if (dv) p.devolucao = dv.tipo; }
  }
  if (projeto && d.totais) {
    const nums = [...new Set(doProjeto.map((x) => x.numero))];
    const escondidos = new Set(((excAll.data ?? []) as { pc_numero: string }[]).map((x) => String(x.pc_numero)).filter((n) => nums.includes(n)));
    const porPedido = new Map<number, string>(doProjeto.map((x) => [Number(x.pedido_id), x.numero]));
    let comp = 0, aprovado = 0, pendente = 0, outros = 0, devolvido = 0;
    const valores: Record<string, number> = {};
    for (const [id, num] of porPedido) if (!escondidos.has(num)) {
      const ped = peds.get(id);
      const bruto = Number(ped?.valor) || 0;
      const v = valorLiquido(bruto, devPc.get(num));
      devolvido += bruto - v;
      comp += v; valores[num] = Math.round(((valores[num] ?? 0) + v) * 100) / 100;
      // Resumo da lista (07/10/26): PCs aprovados × aguardando aprovação
      const e = estadoPc({ etapa: ped?.etapa, aprov: ped?.aprov, cancelado: ped?.cancelado, dt_rec: ped?.dtRec, dt_fat: ped?.dtFat, enviado_em: ped?.enviadoEm }).chave;
      if (e === "aguardando" || e === "requisicao") pendente += v;
      else if (e === "reprovado" || e === "cancelado") outros += v;
      else aprovado += v;
    }
    const r2 = (x: number) => Math.round(x * 100) / 100;
    d.totais.pcs_aprovado = r2(aprovado);
    d.totais.pcs_pendente = r2(pendente);
    d.totais.pcs_outros = r2(outros);
    d.totais.pcs_devolvido = r2(devolvido);
    d.totais.pcs_cancelados = [...cancelados].filter((n) => nums.includes(n));
    d.totais.pcs_valores = valores;
    d.totais.comprometido_itens = d.totais.comprometido;
    d.totais.comprometido = Math.round(comp * 100) / 100;
    d.totais.pcs_escondidos = [...escondidos];
    d.fora_da_lista = d.fora_da_lista.filter((f) => !f.pc || !escondidos.has(String(f.pc)));
    // fluxo mensal: tira as parcelas dos PCs escondidos (mesma regra do SQL: vencimento
    // da parcela, senão previsão/emissão do PC, com o valor da parcela ou do pedido)
    const fluxo = (d.fluxo ?? []) as { mes: string | null; comprometido: number }[];
    if ((escondidos.size || devPc.size) && fluxo.length) {
      const mesDe = (dt?: string | null) => (dt && /^\d{4}-\d{2}/.test(dt) ? `${dt.slice(0, 7)}-01` : null);
      for (const [id, num] of porPedido) {
        // escondido/cancelado sai inteiro; devolvido sai na proporção do que voltou
        const tira = escondidos.has(num) ? 1 : 1 - fatorDevolucao(Number(peds.get(id)?.valor) || 0, devPc.get(num));
        if (!(tira > 0)) continue;
        const ped = peds.get(id);
        if (!ped) continue;
        const partes = (ped.parcelas?.length
          ? ped.parcelas.map((pa) => ({ mes: mesDe(pa.venc ?? ped.previsao ?? ped.emissao), v: Number(pa.valor) || 0 }))
          : [{ mes: mesDe(ped.previsao ?? ped.emissao), v: Number(ped.valor) || 0 }]).map((x) => ({ ...x, v: x.v * tira }));
        for (const pt of partes) {
          const m = fluxo.find((f) => f.mes === pt.mes);
          if (m) m.comprometido = Math.round((Number(m.comprometido) - pt.v) * 100) / 100;
        }
      }
    }
  }
  for (const l of d.itens) {
    l.fornecedor = l.fornecedor ? deHtml(l.fornecedor) : l.fornecedor;
    let soma = 0, temValor = false;
    for (const p of l.pcs) {
      p.fornecedor = p.fornecedor ? deHtml(p.fornecedor) : p.fornecedor;
      const ped = peds.get(Number(p.pedido_id));
      if (!ped) { if (p.valor != null) { soma += Number(p.valor); temValor = true; } continue; }
      p.dt_rec = ped.dtRec ?? null;
      p.previsao_pc = p.previsao ?? null;
      { const n = nova.get(Number(ped.ncodPed)); if (n) p.previsao = n; }
      p.dt_fat = ped.dtFat ?? null; p.enviado_em = ped.enviadoEm ?? null; p.cancelado = ped.cancelado ?? null;
      p.aprov_por = ped.aprovPor ?? null; p.aprov_em = ped.aprovEm ?? null;
      if (ped.aprov) p.aprov = ped.aprov; if (ped.etapa) p.etapa = ped.etapa;
      if (p.valor == null) {
        const linhas: LinhaPc[] = (ped.itens ?? []).map((i) => ({ cod: i.cod, desc: deHtml(i.desc), qtd: Number(i.qtd) || 0,
          vu: Number(i.vu) || 0, valor: valorLinhaPc(i), rec: i.rec == null ? null : Number(i.rec) }));
        const a = acharLinhaPc({ codigo: l.codigo, texto: [l.item, l.modelo].filter(Boolean).join(" ") }, linhas);
        if (a) { p.qtd = a.qtd; p.valor_unit = a.vu; p.valor = a.valor; p.qtd_recebida = a.rec; p.casado_por = a.por; }
      } else p.casado_por = "vínculo";
      if (p.valor != null) { soma += Number(p.valor); temValor = true; }
    }
    if (l.valor_pc == null && temValor) l.valor_pc = Math.round(soma * 100) / 100;
  }
  for (const f of d.fora_da_lista) f.fornecedor = f.fornecedor ? deHtml(f.fornecedor) : f.fornecedor;
  return d;
}

