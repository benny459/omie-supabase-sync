// Central de Ordem — a fila de uma pessoa (PURO: recebe as linhas e a pessoa, devolve o que ela pode ver).
// Regras (SPEC §4.5–4.6, com a configuração do admin):
// - módulo sem acesso: não aparece nada (nem título, nem valor, nem contagem) — só o cadeado;
// - módulo/detetor desligado: só o admin vê, marcado como pré-visualização;
// - "meus" por omissão; "equipe" e "todos" conforme P1 e a lista de supervisão;
// - valores mascarados para quem não vê valores nesse módulo (mesma regra das telas).
import { detetorLigado, escoposPermitidos, moduloLigado, noEscopo, podeExecutar, podeVerItem, podeVerValores, veModulo, type Escopo, type Quem } from "./acesso";
import type { ConfigOrdem } from "./config";
import { MODULOS } from "./modulos";
import { renderValores, type AcaoItem, type EstadoItem, type ItemTela, type ModuloOrdem, type Recomendacao } from "./tipos";

export type LinhaItem = {
  id: string; tipo: string; modulo: ModuloOrdem; origem_ref: string; dono_id: string | null;
  urgencia: "critica" | "atencao" | null; rotulo_urgencia: string | null; titulo: string; resumo: string | null;
  etapa: string | null; valor: number | null; link: string | null; recomendacao: Recomendacao;
  dados: { requer?: string[]; acao?: AcaoItem | null; [k: string]: unknown } | null;
  depende_de: ItemTela["depende_de"]; estado: EstadoItem; adiado_ate: string | null; degrau: number;
  encaminhado_de: string | null; encaminhado_por: string | null; criado_em: string;
  resolvido_em?: string | null; resolvido_como?: string | null;
};

export const detectorLigadoPara = detetorLigado;

export type Aba = { modulo: ModuloOrdem; rotulo: string; acesso: boolean; ligado: boolean; previa: boolean; n: number | null; criticos: number | null };

export type Fila = {
  abas: Aba[];
  itens: ItemTela[];
  escopos: Escopo[];
  escopo: Escopo;
  bloqueado: ModuloOrdem | null;     // pediu um módulo sem acesso → 403 + diálogo
  previa: boolean;                    // a pessoa vê algo só por ser admin
  emOrdem: { feitos: number; total: number };
};

const PESO = { critica: 0, atencao: 1 } as const;

/** Ordem de urgência real: crítica primeiro, depois degrau da escada, depois o mais antigo. */
export function ordenar<T extends { urgencia: "critica" | "atencao" | null; degrau: number; criado_em: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) =>
    (PESO[a.urgencia ?? "atencao"] - PESO[b.urgencia ?? "atencao"]) || (b.degrau - a.degrau) || a.criado_em.localeCompare(b.criado_em));
}

export function filtrarItens(
  q: Quem, cfg: ConfigOrdem, linhas: LinhaItem[],
  opts: { modulo?: ModuloOrdem | null; escopo?: Escopo; nomes?: Map<string, string>; feitosHoje?: number; comercial?: { acesso: boolean; itens: ItemTela[] }; agora?: string },
): Fila {
  const nomes = opts.nomes ?? new Map<string, string>();
  const escopos = escoposPermitidos(q, cfg);
  const escopo: Escopo = opts.escopo && escopos.includes(opts.escopo) ? opts.escopo
    : (q.admin || cfg.supervisao_ids.includes(q.uid)) ? "todos" : "meus";
  let previa = false;

  const visiveis: ItemTela[] = [];
  const agora = opts.agora ?? new Date().toISOString();
  for (const l of linhas) {
    // adiado (com motivo, ou cobrança feita à espera de resposta): sai da fila até a data
    if (l.estado === "adiado" && l.adiado_ate && l.adiado_ate > agora) continue;
    if (!podeVerItem(q, { modulo: l.modulo, tipo: l.tipo, requer: l.dados?.requer }, cfg)) continue;
    const ml = moduloLigado(q, cfg, l.modulo);
    const dl = l.tipo.startsWith("enc:") ? { ligado: cfg.encaminhar || q.admin, previa: !cfg.encaminhar } : detetorLigado(q, cfg, l.tipo);
    if (!ml.ligado || !dl.ligado) continue;
    if (!noEscopo(l, q.uid, escopo)) continue;
    const pv = ml.previa || dl.previa;
    if (pv) previa = true;
    const vv = podeVerValores(q, l.modulo);
    const ac = l.dados?.acao ?? null;
    const ex = ac ? podeExecutar(q, cfg, ac.chave) : null;
    visiveis.push({
      id: l.id, tipo: l.tipo, modulo: l.modulo, origem_ref: l.origem_ref,
      titulo: renderValores(l.titulo, vv), resumo: renderValores(l.resumo, vv), etapa: l.etapa,
      valor: vv ? l.valor : null, urgencia: l.urgencia, rotulo_urgencia: l.rotulo_urgencia, link: l.link,
      recomendacao: mascararRec(l.recomendacao, vv), depende_de: l.depende_de, estado: l.estado, degrau: l.degrau,
      dono_id: l.dono_id, dono_nome: l.dono_id ? nomes.get(l.dono_id) ?? null : null, meu: l.dono_id === q.uid,
      criado_em: l.criado_em, adiado_ate: l.adiado_ate, encaminhado_de: l.encaminhado_de,
      encaminhado_por_nome: l.encaminhado_por ? nomes.get(l.encaminhado_por) ?? null : null,
      previa: pv,
      acao: ac ? { chave: ac.chave, rotulo: ac.rotulo, ligada: cfg.acoes[ac.chave] === true, podeExecutar: !!ex?.ok, motivo: ex?.motivo ?? null, irreversivel: ac.irreversivel } : null,
    });
  }
  if (opts.comercial?.acesso) visiveis.push(...opts.comercial.itens);

  const abas: Aba[] = MODULOS.map((m) => {
    const acesso = m.id === "comercial" ? !!opts.comercial?.acesso : veModulo(q, m.id, cfg);
    const ml = moduloLigado(q, cfg, m.id);
    if (!acesso) return { modulo: m.id, rotulo: m.rotulo, acesso: false, ligado: ml.ligado, previa: ml.previa, n: null, criticos: null };
    const xs = visiveis.filter((i) => i.modulo === m.id);
    return { modulo: m.id, rotulo: m.rotulo, acesso: true, ligado: m.id === "comercial" ? true : ml.ligado, previa: m.id === "comercial" ? false : ml.previa, n: xs.length, criticos: xs.filter((i) => i.urgencia === "critica").length };
  }).filter((a) => a.ligado || !a.acesso);  // módulo desligado para a pessoa (não-admin) some; sem acesso fica com cadeado

  const mod = opts.modulo ?? null;
  const bloqueado = mod && mod !== "comercial" && !veModulo(q, mod, cfg) ? mod : mod === "comercial" && !opts.comercial?.acesso ? mod : null;
  const itens = bloqueado ? [] : ordenar(mod ? visiveis.filter((i) => i.modulo === mod) : visiveis);
  const feitos = opts.feitosHoje ?? 0;
  return { abas, itens, escopos, escopo, bloqueado, previa, emOrdem: { feitos, total: feitos + itens.length } };
}

function mascararRec(r: Recomendacao, vv: boolean): Recomendacao {
  return {
    ...r,
    acao: renderValores(r.acao, vv), porque: renderValores(r.porque, vv), impacto: renderValores(r.impacto, vv) || undefined,
    alternativas: r.alternativas?.map((a) => ({ acao: renderValores(a.acao, vv), nota: renderValores(a.nota, vv) || undefined })),
  };
}
