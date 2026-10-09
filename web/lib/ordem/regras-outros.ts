// Central de Ordem — regras PURAS dos detetores de Operação, Projetos, Faturamento, Estoque e Cadastros
// (roteiro do allka-em-dia). Os alarmes de Operação vêm prontos de lib/avulsos-report.ts
// (computeReportCounts → lib/alarmes.ts); aqui só viram cartões.
import { R, type ItemDetectado, type ModuloOrdem } from "./tipos";
import type { PedidoLista } from "@/lib/compras";
import { pendenteAprovacao } from "./regras-compras";

export type PvAlarme = { pv_os_label: string; cliente: string; tipo: string; valor: number };

/** Recomendação por tipo de alarme da Operação (o alarme e a sua regra são os de lib/alarmes.ts). */
const REC_OP: Record<string, { acao: string; impacto: string; urg: "critica" | "atencao"; etapa: string; dep?: { modulo: ModuloOrdem; papel: string; tipo_destino?: string } }> = {
  pode_faturar: { acao: "Emitir as notas dos pedidos que já podem faturar (Faturamento).", impacto: "O dinheiro entra em contas a receber.", urg: "critica", etapa: "Pode faturar", dep: { modulo: "faturamento", papel: "faturamento" } },
  retido_cliente: { acao: "Pedir ao cliente a liberação (pedido de compra dele) para faturar.", impacto: "Tudo está pronto; falta só o cliente.", urg: "atencao", etapa: "Pode faturar" },
  venda: { acao: "Rever a causa de cada venda em atraso e dar nova data ao cliente.", impacto: "O cliente recebe uma data nova em vez de silêncio.", urg: "critica", etapa: "Serviço" },
  compra: { acao: "Encaminhar a Compras a cobrança dos fornecedores destas vendas.", impacto: "Compras cobra com a prioridade da venda.", urg: "critica", etapa: "Materiais", dep: { modulo: "compras", papel: "comprador", tipo_destino: "livre:compras" } },
  sem_pc: { acao: "Criar os PCs que faltam (ou marcar o que não precisa de compra).", impacto: "Sem PC o material não chega a tempo.", urg: "atencao", etapa: "PC" },
  sem_rc: { acao: "Completar as requisições (RC) que faltam.", impacto: "Sem RC não há PC.", urg: "atencao", etapa: "RC" },
  aprov_pend: { acao: "Aprovar (ou reprovar) os PCs pendentes destas vendas.", impacto: "Liberta a compra e a OS.", urg: "atencao", etapa: "Aprovação" },
  aprov_bloq: { acao: "Resolver o bloqueio de aprovação (atribuição de cliente / fluxo do projeto).", impacto: "O PC fica aprovável.", urg: "atencao", etapa: "Aprovação" },
  defas_omie: { acao: "Conferir a defasagem de aprovação com o Omie (só leitura do espelho).", impacto: "Estado do PC coerente.", urg: "atencao", etapa: "Aprovação" },
  sem_vinculo: { acao: "Ligar a OS a cada pedido de serviço.", impacto: "Sem OS o serviço não entra na agenda nem fatura.", urg: "atencao", etapa: "Serviço" },
  agend_vazio: { acao: "Dar previsão de execução a cada serviço.", impacto: "O serviço entra na agenda.", urg: "atencao", etapa: "Serviço" },
  agend_venc: { acao: "Replanejar os serviços com previsão vencida.", impacto: "Previsão real para o cliente e o faturamento.", urg: "critica", etapa: "Serviço" },
  pvos_incompl: { acao: "Completar o cadastro das PV/OS (cliente, projeto, previsão).", impacto: "Sem cadastro completo o resto do ciclo para.", urg: "atencao", etapa: "PV / OS" },
  sem_projeto: { acao: "Marcar o projeto de cada venda (vendedor).", impacto: "Custo e margem caem no sítio certo.", urg: "atencao", etapa: "PV / OS" },
  aguarda_liberacao: { acao: "Acompanhar a liberação do cliente (sem PC do cliente ainda).", impacto: "Saber quando pode avançar.", urg: "atencao", etapa: "PV / OS" },
};

/** Um cartão por tipo de alarme com PVs (lote), rótulo e dono de lib/avulsos-report.ts. */
export function detetarAlarmesOperacao(
  porTipo: Record<string, PvAlarme[]>, rotulos: Record<string, string>, donos: Record<string, string>, link: (k: string) => string,
): ItemDetectado[] {
  const out: ItemDetectado[] = [];
  for (const [k, pvs] of Object.entries(porTipo)) {
    if (!pvs?.length) continue;
    const r = REC_OP[k] ?? { acao: "Rever na tela de Operação.", impacto: "—", urg: "atencao" as const, etapa: "PV / OS" };
    const total = pvs.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    out.push({
      tipo: `op_${k}`, modulo: "operacao", origem_ref: `alarme:${k}`,
      titulo: `${rotulos[k] ?? k}: ${pvs.length} PV/OS`,
      resumo: `${R(total)} · ${pvs.slice(0, 3).map((p) => p.pv_os_label).join(", ")}${pvs.length > 3 ? "…" : ""}`,
      etapa: r.etapa, valor: total, urgencia: r.urg, rotulo_urgencia: r.urg === "critica" ? "parado" : "rever",
      link: link(k).replace(/^https?:\/\/[^/]+/, ""), dono_email: donos[k] ?? null,
      recomendacao: {
        acao: r.acao,
        porque: `Alarme “${rotulos[k] ?? k}” do relatório de Avulsos (mesma regra da tela): ${pvs.slice(0, 6).map((p) => `${p.pv_os_label} ${p.cliente}`).join("; ")}${pvs.length > 6 ? "…" : ""}.`,
        impacto: r.impacto, confianca: "alta",
      },
      dados: { pvs: pvs.slice(0, 200) },
      depende_de: r.dep ?? null,
    });
  }
  return out;
}

/** PCs de projeto de obra (PJ) pendentes no painel — o caminho "projetos" da aprovação (quem aprova no
 *  módulo Projetos sem a área ERP, ex.: Marcelo) pode decidi-los pela mesma rota. */
export function detetarPjPendentes(pedidos: PedidoLista[], hoje: string): ItemDetectado[] {
  const grupos = new Map<string, PedidoLista[]>();
  for (const p of pedidos.filter((x) => pendenteAprovacao(x) && /^\s*PJ\s*\d/i.test(x.proj ?? ""))) grupos.set(p.proj!, [...(grupos.get(p.proj!) ?? []), p]);
  return [...grupos].map(([proj, ps]) => {
    const total = ps.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const velho = ps.map((p) => p.emissao ?? hoje).sort()[0];
    const d = Math.round((Date.parse(hoje) - Date.parse(velho)) / 86_400_000);
    return {
      tipo: "pj_pc_pendente", modulo: "projetos" as const, origem_ref: `projeto:${proj}`,
      titulo: `Aprovar ${ps.length} PC(s) de ${proj}`,
      resumo: `${R(total)} · o mais antigo espera há ${d} d`,
      etapa: "Aprovação", valor: total, urgencia: d >= 3 ? "critica" as const : "atencao" as const, rotulo_urgencia: d >= 3 ? `parado ${d} d` : "aprovar",
      link: "/projetos",
      recomendacao: {
        acao: `Aprovar os PCs de ${proj} dentro do budget; os que estouram pedem motivo (o Benny é avisado).`,
        porque: `${ps.length} PC(s) do projeto à espera de aprovação (${ps.slice(0, 6).map((p) => p.num).join(", ")}).`,
        impacto: "Destrava a etapa Materiais do projeto.",
        alternativas: [{ acao: "Rever o budget antes", nota: "Projetos › Lista de materiais" }],
        confianca: "media" as const,
      },
      dados: { pcs: ps.map((p) => ({ id: p.id, num: p.num, valor: p.valor, forn: p.forn })) },
      acao: {
        chave: "compras.aprovar", rotulo: `Aprovar ${ps.length}`, irreversivel: true,
        rota: { metodo: "POST" as const, caminho: "/api/compras/acao", corpo: { acao: "aprovar", ids: ps.map((p) => p.id), status: "aprovado" } },
        desfazer: { metodo: "POST" as const, caminho: "/api/compras/acao", corpo: { acao: "aprovar", ids: ps.map((p) => p.id), status: "aguardando" } },
      },
    };
  });
}

export type LinhaAprovarAte = { empresa: string; ncod_ped: number; pc_numero: string | null; projeto_nome: string | null; nome_fornecedor: string | null; valor_total: number | null; aprovar_ate_calc: string; status: string };

/** PCs do Omie/approvals pendentes com o "aprovar até" (lib/columns.ts) vencido ou a vencer em 7 dias, por projeto. */
export function detetarAprovarAte(ls: LinhaAprovarAte[], hoje: string): ItemDetectado[] {
  const lim = new Date(Date.parse(hoje) + 7 * 86_400_000).toISOString().slice(0, 10);
  const grupos = new Map<string, LinhaAprovarAte[]>();
  for (const l of ls) if (l.aprovar_ate_calc <= lim) grupos.set(l.projeto_nome ?? "—", [...(grupos.get(l.projeto_nome ?? "—") ?? []), l]);
  return [...grupos].map(([proj, xs]) => {
    const primeiro = xs.map((x) => x.aprovar_ate_calc).sort()[0];
    const venc = primeiro < hoje;
    const total = xs.reduce((s, x) => s + (Number(x.valor_total) || 0), 0);
    return {
      tipo: "pj_aprovar_ate", modulo: "projetos" as const, origem_ref: `projeto:${proj}`,
      titulo: `Aprovar ${xs.length} PC(s) de ${proj} até ${primeiro.slice(8, 10)}/${primeiro.slice(5, 7)}`,
      resumo: `${R(total)} · ${venc ? "“aprovar até” já passou" : "vence esta semana"}`,
      etapa: "Aprovação", valor: total, urgencia: venc ? "critica" as const : "atencao" as const,
      rotulo_urgencia: venc ? "aprovar até vencido" : `até ${primeiro.slice(8, 10)}/${primeiro.slice(5, 7)}`,
      link: `/projetos?q=${encodeURIComponent(proj === "—" ? "" : proj)}`,
      recomendacao: {
        acao: "Aprovar dentro do “aprovar até” para cumprir a entrega da venda.",
        porque: `“Aprovar até” = previsão da venda − prazo de entrega − 5 dias (coluna de Projetos): ${xs.slice(0, 5).map((x) => `PC ${x.pc_numero ?? x.ncod_ped} até ${x.aprovar_ate_calc.slice(8, 10)}/${x.aprovar_ate_calc.slice(5, 7)}`).join("; ")}${xs.length > 5 ? "…" : ""}.`,
        impacto: "Mantém a folga do projeto.", confianca: "alta" as const,
      },
      dados: { pcs: xs.slice(0, 100) },
    };
  });
}

export type EtapaProjeto = { empresa: string; codigo_projeto: number; etapa: string; data_prevista: string; nome?: string | null };

export function detetarEtapasAtrasadas(es: EtapaProjeto[], hoje: string): ItemDetectado[] {
  const g = new Map<string, EtapaProjeto[]>();
  for (const e of es) g.set(`${e.empresa}|${e.codigo_projeto}`, [...(g.get(`${e.empresa}|${e.codigo_projeto}`) ?? []), e]);
  return [...g].map(([k, xs]) => {
    const pior = Math.max(...xs.map((e) => Math.round((Date.parse(hoje) - Date.parse(e.data_prevista)) / 86_400_000)));
    const nome = xs[0].nome ?? `projeto ${xs[0].codigo_projeto}`;
    return {
      tipo: "pj_etapa_atrasada", modulo: "projetos" as const, origem_ref: `projeto:${k}`,
      titulo: `Replanejar ${nome}: ${xs.length} etapa(s) vencida(s)`,
      resumo: `${xs.map((e) => `${e.etapa} (${e.data_prevista.slice(8, 10)}/${e.data_prevista.slice(5, 7)})`).join(", ")} · até ${pior} d de atraso`,
      etapa: xs[0].etapa, urgencia: pior > 7 ? "critica" as const : "atencao" as const, rotulo_urgencia: `${pior} d atrasado`,
      link: `/projetos/${xs[0].codigo_projeto}/materiais?empresa=${xs[0].empresa}&aba=resumo`,
      recomendacao: {
        acao: "Dar nova data a cada etapa vencida (com a justificativa) e avisar o cliente.",
        porque: "Data prevista passou e a etapa não está concluída.",
        impacto: "O cliente recebe uma data nova em vez de silêncio.", confianca: "media" as const,
      },
      dados: { etapas: xs },
    };
  });
}

export type ProjetoBudget = { empresa: string; codigo_projeto: number; nome: string; budget: number | null; comprometido: number };

export function detetarAcimaBudget(ps: ProjetoBudget[]): ItemDetectado[] {
  return ps.filter((p) => p.budget != null && p.budget > 0 && p.comprometido > p.budget).map((p) => {
    const pct = (p.comprometido / (p.budget as number)) * 100;
    return {
      tipo: "pj_acima_budget", modulo: "projetos" as const, origem_ref: `projeto:${p.empresa}|${p.codigo_projeto}`,
      titulo: `${p.nome} com compras em ${pct.toFixed(pct < 110 ? 1 : 0).replace(".", ",")}% do budget`,
      resumo: `${R(p.comprometido)} comprometidos para ${R(p.budget)} de budget de materiais`,
      etapa: "Materiais", valor: p.comprometido - (p.budget as number), urgencia: "critica" as const, rotulo_urgencia: "decidir",
      link: `/projetos/${p.codigo_projeto}/materiais?empresa=${p.empresa}&aba=compras`,
      recomendacao: {
        acao: "Rever o budget com o comercial antes de qualquer nova compra no projeto.",
        porque: `Comprometido (cada PC uma vez, mesma conta da Lista de materiais) passa o budget em ${R(p.comprometido - (p.budget as number))}.`,
        impacto: "Sem decisão, a margem do projeto cai.", alternativas: [{ acao: "Aceitar e aprovar com motivo", nota: "o Benny é avisado" }],
        confianca: "alta" as const,
      },
      dados: { ...p },
    };
  });
}

export type DocCarteira = { chave: string; rotulo: string; cliente: string; valor: number; faturado?: number; pend: string[]; tipo?: string };

/** Pode faturar, mas falta dado do cliente (pend de orders.fat_carteira) — a correção é de Cadastros. */
export function detetarPendenciaCadastroFat(docs: DocCarteira[]): ItemDetectado[] {
  return docs.filter((d) => (d.pend?.length ?? 0) > 0 && Number(d.faturado ?? 0) < Number(d.valor ?? 0)).map((d) => ({
    tipo: "fat_pendencia_cadastro", modulo: "faturamento" as const, origem_ref: `doc:${d.chave}`,
    titulo: `${d.rotulo} não fatura: falta ${d.pend.join(", ")}`,
    resumo: `${d.cliente} · ${R(d.valor)}`,
    etapa: "Pode faturar", valor: d.valor, urgencia: "atencao" as const, rotulo_urgencia: "cadastro",
    link: `/faturamento?q=${encodeURIComponent(d.rotulo)}`,
    recomendacao: {
      acao: `Completar o cadastro do cliente (${d.pend.join(", ")}) para poder emitir.`,
      porque: "A carteira do Faturamento marca este pedido com pendência de cadastro.",
      impacto: "O pedido fica pronto para emitir.", confianca: "alta" as const,
    },
    dados: { chave: d.chave, pend: d.pend },
    depende_de: { modulo: "cadastros" as const, papel: "cadastros", tipo_destino: "livre:cadastros" },
  }));
}

export type DocNaoEnviado = { ref: string; doc: string; numero: string; cliente: string; valor: number; autorizada_em: string | null; criado_por: string | null };

export function detetarNaoEnviadosFat(ds: DocNaoEnviado[], agoraIso: string): ItemDetectado[] {
  const lim = Date.parse(agoraIso) - 24 * 3600_000;
  return ds.filter((d) => d.autorizada_em && Date.parse(d.autorizada_em) <= lim && d.autorizada_em >= "2026-10-09").map((d) => ({
    tipo: "fat_nao_enviado", modulo: "faturamento" as const, origem_ref: `fat:${d.ref}`,
    titulo: `Enviar ${d.doc} ${d.numero} ao cliente`,
    resumo: `${d.cliente} · ${R(d.valor)} · emitido em ${d.autorizada_em!.slice(8, 10)}/${d.autorizada_em!.slice(5, 7)}`,
    etapa: "Enviada ao cliente", valor: d.valor, urgencia: "atencao" as const, rotulo_urgencia: "não enviado",
    link: "/faturamento", dono_email: d.criado_por,
    recomendacao: {
      acao: "Enviar ao cliente pelo Faturamento (✉ Enviar ao cliente) ou marcar como enviado se foi por outro caminho.",
      porque: "Documento autorizado há mais de 1 dia e sem envio registado (mesma regra do lembrete diário).",
      impacto: "O cliente recebe a nota e o prazo de pagamento começa.", confianca: "alta" as const,
    },
    dados: { ref: d.ref },
  }));
}

export type ItemAbaixo = { empresa: string; codigo: string; descricao: string; saldo: number; minimo: number; rotulo: string };

export function detetarAbaixoMinimo(xs: ItemAbaixo[]): ItemDetectado[] {
  if (!xs.length) return [];
  return [{
    tipo: "est_abaixo_minimo", modulo: "estoque", origem_ref: "lote:abaixo_minimo",
    titulo: `${xs.length} item(ns) abaixo do mínimo`,
    resumo: xs.slice(0, 4).map((x) => x.descricao).join(", ") + (xs.length > 4 ? "…" : ""),
    etapa: "Requisição", urgencia: "atencao", rotulo_urgencia: "repor",
    link: "/estoque",
    recomendacao: {
      acao: "Abrir a requisição de reposição dos itens abaixo do mínimo.",
      porque: `Saldo ≤ mínimo do cadastro do item (alarme da tela de Estoque): ${xs.slice(0, 6).map((x) => `${x.codigo} saldo ${x.saldo} (mín. ${x.minimo})`).join("; ")}${xs.length > 6 ? "…" : ""}.`,
      impacto: "Nenhum técnico sai sem material.", confianca: "alta",
    },
    dados: { itens: xs.slice(0, 200) },
    depende_de: { modulo: "compras", papel: "comprador", tipo_destino: "livre:compras" },
  }];
}

export function detetarDuplicados(n: number, exemplos: string[]): ItemDetectado[] {
  if (!n) return [];
  return [{
    tipo: "cad_duplicados", modulo: "cadastros", origem_ref: "lote:duplicados",
    titulo: `Juntar ${n} grupo(s) de cadastros duplicados prováveis`,
    resumo: exemplos.slice(0, 3).join(" · "),
    etapa: "Validado", urgencia: "atencao", rotulo_urgencia: "juntar",
    link: "/cadastros/duplicidades",
    recomendacao: {
      acao: "Rever e juntar os duplicados prováveis (aba “Prováveis”).",
      porque: "Mesmo documento ou nome muito parecido (detetor de duplicidades de Cadastros).",
      impacto: "NF, casamento e faturamento sem erro de cadastro.", confianca: "media",
    },
    dados: { n },
  }];
}
