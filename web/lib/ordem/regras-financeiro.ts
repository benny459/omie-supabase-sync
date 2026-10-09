// Central de Ordem — regras PURAS dos detetores de Financeiro (testáveis sem banco).
// Reproduzem as MESMAS janelas e estados dos KPIs de Títulos a Pagar v3 / Receber v1
// (components/financeiro/pagar-v3-motor.ts e receber-v1-motor.ts), sobre os dados que
// as rotas da tela já devolvem (lib/financeiro-pagar-dados.ts → carregar()).
import type { ConfigOrdem } from "./config";
import { R, type ItemDetectado } from "./tipos";

/** Linha de pagar já interpretada (mesmos índices de finance.pagar_v3_dados). */
export type TituloPagar = {
  ref: string; emp: string; venc: string; prev: string; dias: number; v: number; forn: string; pc: string | null;
  st: string; nf: string | null; prov: boolean; cnpj: string | null; doc: string | null;
};

export const ST_PAGAR: Record<string, string> = {
  bloq: "Não autorizada", sempc: "NF sem pedido", nf: "Aguardando NF", ok: "Liberado", dir: "Despesa direta",
};

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

/** Interpreta as linhas compactas como a tela (motor:113-125): dias pela previsão efetiva;
 *  provisionado a vencer em ≤ 7 d que era "despesa direta" passa a "Aguardando NF". */
export function interpretarPagar(
  rows: unknown[][], hoje: string, prev: Record<string, [string, boolean] | undefined>, prov: Record<string, { nat?: string } | undefined>,
): TituloPagar[] {
  return rows.map((x) => {
    const ref = String(x[0]);
    const venc = String(x[2]);
    const pv = prev[ref]?.[0] || venc;
    const dias = diasEntre(hoje, pv);
    const ehProv = prov[ref]?.nat === "provisionado";
    let st = String(x[19] ?? "");
    if (ehProv && dias <= 7 && st === "dir") st = "nf";
    return {
      ref, emp: String(x[1]), venc, prev: pv, dias, v: Number(x[3]) || 0, forn: String(x[4] ?? "—"),
      pc: (x[13] as string | null) ?? null, st, nf: (x[15] as string | null) ?? null, prov: ehProv,
      cnpj: (x[20] as string | null) ?? null, doc: (x[7] as string | null) ?? null,
    };
  });
}

const soma = (ts: { v: number }[]) => ts.reduce((s, t) => s + t.v, 0);
const lista = (ts: TituloPagar[], n = 5) =>
  ts.slice(0, n).map((t) => `${t.forn} ${R(t.v)} (${ddmm(t.prev)})`).join("; ") + (ts.length > n ? "…" : "");

/** Bloqueados para pagar (janela do KPI: −60..+30 d), um cartão por motivo. */
export function detetarBloqueados(ts: TituloPagar[]): ItemDetectado[] {
  const jan = ts.filter((t) => t.dias >= -60 && t.dias <= 30);
  const out: ItemDetectado[] = [];
  const nf = jan.filter((t) => t.st === "nf").sort((a, b) => a.dias - b.dias);
  if (nf.length) out.push({
    tipo: "titulo_bloqueado_sem_nf", modulo: "financeiro", origem_ref: "lote:titulo_sem_nf", requer: ["financeiro.ver_pagar"],
    titulo: `${nf.length} título(s) bloqueado(s) à espera de NF`,
    resumo: `${R(soma(nf))} · vencem até 30 dias · a NF depende de Compras`,
    etapa: "Documento (NF)", valor: soma(nf), urgencia: nf.some((t) => t.dias <= 3) ? "critica" : "atencao", rotulo_urgencia: "depende de Compras",
    link: "/financeiro/pagar",
    recomendacao: {
      acao: "Encaminhar a Compras o pedido das NF (com os PCs ligados) e acompanhar daqui.",
      porque: `Título com PC mas sem NF recebida/conferida (${lista(nf)}). Quem pede a NF ao fornecedor é Compras.`,
      impacto: "Sem NF não se paga sem risco fiscal; quando a NF chega e é conferida, o título libera sozinho.",
      confianca: "alta",
    },
    dados: { titulos: nf.slice(0, 200).map((t) => ({ ref: t.ref, forn: t.forn, v: t.v, prev: t.prev, pc: t.pc })) },
    depende_de: { modulo: "compras", papel: "pedir NF ao fornecedor", tipo_destino: "pedir_nf_fornecedor" },
  });
  const sp = jan.filter((t) => t.st === "sempc").sort((a, b) => a.dias - b.dias);
  if (sp.length) out.push({
    tipo: "titulo_nf_sem_pedido", modulo: "financeiro", origem_ref: "lote:titulo_nf_sem_pedido", requer: ["financeiro.ver_pagar"],
    titulo: `${sp.length} título(s) com NF sem pedido de compra`,
    resumo: `${R(soma(sp))} · compras feitas fora do fluxo`,
    etapa: "Documento (NF)", valor: soma(sp), urgencia: "critica", rotulo_urgencia: "regularizar",
    link: "/financeiro/pagar",
    recomendacao: {
      acao: "Encaminhar a Compras o PC retroativo destas NF (vai à aprovação de quem tem alçada).",
      porque: `NF lançada sem PC aprovado — não passou pela alçada (${lista(sp)}).`,
      impacto: "Regulariza a alçada e liberta o pagamento.",
      alternativas: [{ acao: "Escalar tudo à direção", nota: `${sp.length} decisões` }],
      confianca: "alta",
    },
    dados: { titulos: sp.slice(0, 200).map((t) => ({ ref: t.ref, forn: t.forn, v: t.v, prev: t.prev, nf: t.nf })) },
    depende_de: { modulo: "compras", papel: "PC retroativo", tipo_destino: "pc_retroativo" },
  });
  const bq = jan.filter((t) => t.st === "bloq").sort((a, b) => a.dias - b.dias);
  if (bq.length) out.push({
    tipo: "titulo_nao_autorizado", modulo: "financeiro", origem_ref: "lote:titulo_nao_autorizado", requer: ["financeiro.ver_pagar"],
    titulo: `${bq.length} título(s) não autorizado(s) (PC sem aprovação)`,
    resumo: `${R(soma(bq))} · vence o primeiro em ${bq[0] ? ddmm(bq[0].prev) : "—"}`,
    etapa: "Autorizado", valor: soma(bq), urgencia: bq.some((t) => t.dias <= 3) ? "critica" : "atencao", rotulo_urgencia: bq[0] ? `vence ${ddmm(bq[0].prev)}` : "autorizar",
    link: "/financeiro/pagar",
    recomendacao: {
      acao: "Encaminhar ao aprovador de Compras a aprovação dos PCs destes títulos.",
      porque: `Têm PC, mas o PC não está aprovado (${lista(bq)}).`,
      impacto: "Evita juros e o bloqueio do fornecedor.",
      confianca: "media",
    },
    dados: { titulos: bq.slice(0, 200).map((t) => ({ ref: t.ref, forn: t.forn, v: t.v, prev: t.prev, pc: t.pc })) },
    depende_de: { modulo: "compras", papel: "aprovador", tipo_destino: "aprovar_pc_titulo" },
  });
  return out;
}

/** Provisionado a vencer em ≤ N dias sem documento (KPI "Vencendo em 7 dias sem documento"). */
export function detetarSemDocumento(ts: TituloPagar[], cfg: ConfigOrdem): ItemDetectado[] {
  const n = Math.max(1, cfg.parametros.vence_sem_doc_dias || 7);
  const xs = ts.filter((t) => t.prov && t.dias >= -60 && t.dias <= n).sort((a, b) => a.dias - b.dias);
  if (!xs.length) return [];
  return [{
    tipo: "titulo_sem_documento", modulo: "financeiro", origem_ref: "lote:titulo_sem_documento", requer: ["financeiro.ver_pagar"],
    titulo: `Pedir documento de ${xs.length} título(s) que vencem em ${n} dias`,
    resumo: `${R(soma(xs))} · provisionados, sem NF ou boleto`,
    etapa: "Documento (NF)", valor: soma(xs), urgencia: xs.some((t) => t.dias <= 2) ? "critica" : "atencao", rotulo_urgencia: `${n} d`,
    link: "/financeiro/pagar",
    recomendacao: {
      acao: "Pedir o documento (NF/boleto) a cada fornecedor e confirmar o valor com a NF quando chegar.",
      porque: `Valor ainda estimado e nenhum documento anexado (${lista(xs)}).`,
      impacto: "Sem documento, o pagamento atrasa ou sai sem suporte.",
      confianca: "alta",
    },
    dados: { titulos: xs.slice(0, 200).map((t) => ({ ref: t.ref, forn: t.forn, v: t.v, prev: t.prev })) },
  }];
}

/** Vencidos (≤ 60 d) a pagar que não estão bloqueados — sem baixa. M4: os mais antigos vão para o cartão de histórico. */
export function detetarVencidosPagar(ts: TituloPagar[], cfg: ConfigOrdem, agg: Record<string, Record<string, { n?: number; v?: number }>> | null, excluidosOmie: number): ItemDetectado[] {
  const lim = Math.max(1, cfg.parametros.m4_dias_vencido || 60);
  const out: ItemDetectado[] = [];
  const rec = ts.filter((t) => t.dias < 0 && t.dias >= -lim && !["bloq", "sempc", "nf"].includes(t.st)).sort((a, b) => a.dias - b.dias);
  if (rec.length) out.push({
    tipo: "titulo_vencido", modulo: "financeiro", origem_ref: "lote:titulo_vencido", requer: ["financeiro.ver_pagar"],
    titulo: `${rec.length} título(s) a pagar vencido(s) nos últimos ${lim} dias sem baixa`,
    resumo: `${R(soma(rec))} · o mais antigo há ${-rec[0].dias} d`,
    etapa: "Pago", valor: soma(rec), urgencia: "critica", rotulo_urgencia: "sem plano",
    link: "/financeiro/pagar",
    recomendacao: {
      acao: "Conferir com o extrato (OFX): baixar o que já foi pago, reprogramar ou pagar o resto.",
      porque: `Vencidos sem baixa no painel (${lista(rec)}).`,
      impacto: "Fluxo de caixa e saldo a pagar confiáveis.",
      alternativas: [{ acao: "Baixar em lote na tela", nota: "Títulos a Pagar › Em aberto › Vencidos" }],
      confianca: "media",
    },
    dados: { titulos: rec.slice(0, 200).map((t) => ({ ref: t.ref, forn: t.forn, v: t.v, prev: t.prev })) },
  });
  {
    const velhos = ts.filter((t) => t.dias < -lim);
    let vAgg = 0, nAgg = 0;
    for (const porEmp of Object.values(agg ?? {})) for (const k of ["v181-365", "v>365"]) { vAgg += Number(porEmp?.[k]?.v ?? 0); nAgg += Number(porEmp?.[k]?.n ?? 0); }
    const total = soma(velhos) + vAgg, n = velhos.length + nAgg;
    if (n > 0 || excluidosOmie > 0) out.push({
      tipo: "vencido_historico_omie", modulo: "financeiro", origem_ref: "lote:vencido_historico", requer: ["financeiro.ver_pagar"],
      titulo: `Separar histórico do Omie: ${n} título(s) vencidos há mais de ${lim} dias`,
      resumo: `${R(total)}${excluidosOmie ? ` · ${excluidosOmie} já excluídos no Omie e ainda abertos aqui` : ""}`,
      etapa: "Pago", valor: total, urgencia: "atencao", rotulo_urgencia: "separar antes de cobrar",
      link: "/financeiro/pagar",
      recomendacao: {
        acao: "Separar o que é título real do que é lixo/histórico do espelho do Omie antes de qualquer cobrança ou pagamento.",
        porque: "O espelho do Omie é só histórico desde 02/10/26 (sql/159); vencidos tão antigos são, na maioria, pagos sem baixa ou excluídos no Omie.",
        impacto: "Os vencidos reais ficam na fila; o resto sai do contas a pagar com registo (“Tirar do contas a pagar” / baixa).",
        alternativas: [{ acao: "Listar para baixa na tela", nota: "painel “Vencidos · onde está o dinheiro”" }],
        confianca: "media",
        risco: "Nunca escreve no Omie; marcar excluído/baixar é sempre o clique da pessoa na tela.",
      },
      dados: { n, total, excluidosOmie },
    });
  }
  return out;
}

export type TituloReceber = { ref: string; emp: string; venc: string; dias: number; v: number; cliente: string; prom: boolean; reneg: boolean };

export function interpretarReceber(rows: unknown[][], hoje: string): TituloReceber[] {
  return rows.map((x) => {
    const venc = String(x[2]);
    const prev = String(x[17] || x[21] || x[2]);
    const dias = diasEntre(hoje, venc);
    const prom = dias < 0 && prev > venc && prev >= hoje;
    return { ref: String(x[0]), emp: String(x[1]), venc, dias, v: Number(x[3]) || 0, cliente: String(x[4] ?? "—"), prom, reneg: !!x[16] };
  });
}

/** A receber vencido ≤ 60 d, situação "cobrar" (sem promessa e sem renegociação) — um cartão por cliente (top 15) + resto. */
export function detetarReceberVencido(ts: TituloReceber[]): ItemDetectado[] {
  const cobrar = ts.filter((t) => t.dias < 0 && t.dias >= -60 && !t.prom && !t.reneg);
  const porCli = new Map<string, TituloReceber[]>();
  for (const t of cobrar) porCli.set(t.cliente, [...(porCli.get(t.cliente) ?? []), t]);
  const grupos = [...porCli].sort((a, b) => soma(b[1]) - soma(a[1]));
  return grupos.slice(0, 15).map(([cli, xs]) => {
    const pior = Math.min(...xs.map((t) => t.dias));
    return {
      tipo: "receber_vencido", modulo: "financeiro" as const, origem_ref: `cliente:${cli}`, requer: ["financeiro.ver_receber"],
      titulo: `Cobrar ${cli}: ${xs.length} título(s) vencido(s)`,
      resumo: `${R(soma(xs))} · há até ${-pior} d`,
      etapa: "Pago", valor: soma(xs), urgencia: (-pior > 15 ? "critica" : "atencao") as "critica" | "atencao", rotulo_urgencia: `${-pior} d`,
      link: "/financeiro/receber",
      recomendacao: {
        acao: "Registar a cobrança (canal e nova previsão prometida) ou renegociar.",
        porque: `Vencido sem promessa nem renegociação (${xs.slice(0, 4).map((t) => `${R(t.v)} venc. ${ddmm(t.venc)}`).join("; ")}${xs.length > 4 ? "…" : ""}).`,
        impacto: "Entra no fluxo de caixa com data real.",
        confianca: "alta" as const,
      },
      dados: { titulos: xs.map((t) => ({ ref: t.ref, v: t.v, venc: t.venc })) },
    };
  });
}

export type ContaConciliacao = { empresa: string; cod_cc: number; conta?: string; descricao?: string; pendentes: number; pendentes_valor?: number; extrato_ate?: string | null };

/** Movimentos a conciliar por conta (finance.conciliacao_resumo, últimos 90 dias). */
export function detetarConciliacao(contas: ContaConciliacao[], hoje: string): ItemDetectado[] {
  return contas.filter((c) => Number(c.pendentes) > 0).map((c) => {
    const nome = c.conta || c.descricao || `conta ${c.cod_cc}`;
    const atraso = c.extrato_ate ? diasEntre(c.extrato_ate.slice(0, 10), hoje) : null;
    return {
      tipo: "extrato_a_conciliar", modulo: "financeiro" as const, origem_ref: `conta:${c.empresa}:${c.cod_cc}`, requer: ["financeiro.conciliar"],
      titulo: `Conciliar ${c.pendentes} movimento(s) · ${c.empresa} ${nome}`,
      resumo: `${R(Number(c.pendentes_valor) || 0)} a casar${atraso != null ? ` · extrato até ${ddmm(c.extrato_ate!.slice(0, 10))}` : ""}`,
      etapa: "Conciliado", valor: Number(c.pendentes_valor) || 0,
      urgencia: (atraso != null && atraso > 3) || c.pendentes > 50 ? "critica" as const : "atencao" as const,
      rotulo_urgencia: atraso != null && atraso > 1 ? `extrato de há ${atraso} d` : "esta semana",
      link: `/financeiro/conciliacao?conta=${c.empresa}:${c.cod_cc}`,
      recomendacao: {
        acao: "Aceitar as sugestões de casamento com score alto e rever só as restantes.",
        porque: `${c.pendentes} movimento(s) do extrato sem título casado nos últimos 90 dias.`,
        impacto: "Saldo bancário real e fluxo de caixa confiável.",
        confianca: "alta" as const,
      },
      dados: { empresa: c.empresa, cod_cc: c.cod_cc },
      acao: {
        chave: "financeiro.conciliar", rotulo: "Aceitar sugestões (score ≥ 80)", irreversivel: false,
        rota: { metodo: "POST", caminho: "/api/financeiro/conciliacao", corpo: { acao: "aceitar_lote", empresa: c.empresa, cod_cc: c.cod_cc } },
        desfazer: null,
      },
    };
  });
}
