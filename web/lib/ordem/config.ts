// Central de Ordem — configuração por tenant (09/10/26).
//
// Pedido do Benny: "me deixe configurar tudo para ir habilitando". Por isso:
// - TUDO nasce desligado. Sem configuração gravada, a Central só aparece para o
//   administrador, em pré-visualização (só leitura).
// - Os valores propostos na SPEC (M1–M6, P1–P4) vêm como SUGERIDO: aparecem no
//   formulário marcados "sugerido", mas só passam a valer quando o admin grava.
// - Cada mudança fica registada em ordem.config_log (quem, quando, antes → depois).
import type { ModuloOrdem } from "./tipos";

export type ModoMensagens = "desligado" | "ensaio" | "teste" | "ligado";

export type ConfigOrdem = {
  /** Central visível a quem não é admin (com os módulos ligados abaixo). */
  ativo: boolean;
  modulos: Partial<Record<ModuloOrdem, boolean>>;
  detetores: Record<string, boolean>;
  /** Execução de ações a partir do cartão (Aceitar), por chave de ação. */
  acoes: Record<string, boolean>;
  /** Recusar / adiar / marcar feito (só mexem no estado do item, não no módulo). */
  decisoes: boolean;
  comandos: boolean;
  encaminhar: boolean;
  sino: boolean;
  dialogo_entrada: boolean;
  pedido_acesso: boolean;
  mensagens: {
    modo: ModoMensagens;          // ensaio = só regista; teste = só ao e-mail de teste com [TESTE]; ligado = a cada dono
    horarios: string[];           // "07:30", …
    limite_dia: number;
    so_dias_uteis: boolean;
    email_teste: string;
  };
  escada: {
    ligada: boolean;
    dias_segundo_aviso: number;   // lembrete → 2º aviso
    dias_supervisao: number;      // → relatório da supervisão
    dias_direcao: number;         // → direção
    supervisao_emails: string[];
    direcao_emails: string[];
  };
  parametros: {
    m1_tol_reais: number;         // casa sozinha até R$ X …
    m1_tol_pct: number;           // … ou X% (o menor dos dois)
    m2_nf_horas: number;          // NF casada em até X h depois de chegar
    m2_conferencia_dias_uteis: number;
    m4_dias_vencido: number;      // a partir de quantos dias o vencido vai para "separar histórico"
    m4_separar_historico: boolean;
    m5_nome_assistente: "Cesar" | "Aria";
    p1_visao_equipe: "mesmo_modulo" | "so_supervisao";
    p2_financeiro: "tela" | "estrito";
    p3_aprova_acesso: "admin" | "admin_e_dono";
    p4_encaminhar_livre: boolean;
    entrega_atrasada_dias: number;  // entrega vencida há mais de X dias entra na fila
    vence_sem_doc_dias: number;     // título vence em X dias sem documento
  };
  /** Quem vê os itens de todos os módulos a que tem acesso, com o dono (diretoria/supervisão). */
  supervisao_ids: string[];
};

/** O que fica gravado quando nada foi configurado: tudo desligado. */
export const CONFIG_VAZIA: ConfigOrdem = {
  ativo: false,
  modulos: {},
  detetores: {},
  acoes: {},
  decisoes: false,
  comandos: false,
  encaminhar: false,
  sino: false,
  dialogo_entrada: false,
  pedido_acesso: false,
  mensagens: { modo: "desligado", horarios: [], limite_dia: 0, so_dias_uteis: true, email_teste: "" },
  escada: { ligada: false, dias_segundo_aviso: 0, dias_supervisao: 0, dias_direcao: 0, supervisao_emails: [], direcao_emails: [] },
  parametros: {
    m1_tol_reais: 0, m1_tol_pct: 0, m2_nf_horas: 0, m2_conferencia_dias_uteis: 0,
    m4_dias_vencido: 0, m4_separar_historico: false, m5_nome_assistente: "Cesar",
    p1_visao_equipe: "so_supervisao", p2_financeiro: "tela", p3_aprova_acesso: "admin", p4_encaminhar_livre: false,
    entrega_atrasada_dias: 0, vence_sem_doc_dias: 0,
  },
  supervisao_ids: [],
};

/** Propostas da SPEC (decisões em aberto) — mostradas como "sugerido", nunca aplicadas sozinhas. */
export const SUGERIDO: ConfigOrdem = {
  ...CONFIG_VAZIA,
  mensagens: { modo: "ensaio", horarios: ["07:30", "11:30", "16:00", "18:00"], limite_dia: 4, so_dias_uteis: true, email_teste: "benny@waterworks.com.br" },
  escada: { ligada: false, dias_segundo_aviso: 1, dias_supervisao: 2, dias_direcao: 7, supervisao_emails: [], direcao_emails: ["benny@waterworks.com.br"] },
  parametros: {
    m1_tol_reais: 5, m1_tol_pct: 0.5, m2_nf_horas: 24, m2_conferencia_dias_uteis: 2,
    m4_dias_vencido: 60, m4_separar_historico: true, m5_nome_assistente: "Aria",
    p1_visao_equipe: "mesmo_modulo", p2_financeiro: "tela", p3_aprova_acesso: "admin", p4_encaminhar_livre: true,
    entrega_atrasada_dias: 7, vence_sem_doc_dias: 7,
  },
};

/** Explicação de cada decisão, para a tela de configuração e o manual. */
export const DECISOES: { chave: keyof ConfigOrdem["parametros"]; codigo: string; rotulo: string; ajuda: string }[] = [
  { chave: "m1_tol_reais", codigo: "M1", rotulo: "Tolerância NF ↔ PC (R$)", ajuda: "Diferença até este valor (e até a % abaixo, o menor dos dois) a Aria propõe casar no lote; acima vira decisão." },
  { chave: "m1_tol_pct", codigo: "M1", rotulo: "Tolerância NF ↔ PC (%)", ajuda: "Percentagem da diferença sobre o valor do PC." },
  { chave: "m2_nf_horas", codigo: "M2", rotulo: "NF casada em até (horas)", ajuda: "NF que chegou pela Focus e não foi casada neste prazo passa a crítica." },
  { chave: "m2_conferencia_dias_uteis", codigo: "M2", rotulo: "Recebimento → conferência (dias úteis)", ajuda: "PC recebido e não conferido além deste prazo entra na fila." },
  { chave: "m4_dias_vencido", codigo: "M4", rotulo: "Vencido antigo (dias)", ajuda: "Títulos vencidos há mais do que isto vão primeiro para “separar histórico/lixo do Omie”." },
  { chave: "m4_separar_historico", codigo: "M4", rotulo: "Separar histórico do Omie antes da cobrança", ajuda: "O espelho do Omie é só histórico desde 02/10/26 (sql/159): o que vem dele não entra na fila de cobrança, vai para um cartão próprio." },
  { chave: "m5_nome_assistente", codigo: "M5", rotulo: "Nome do assistente do painel", ajuda: "“Aria” = um só assistente com papel por módulo (o Cesar continua com tudo o que faz, só muda o nome no botão)." },
  { chave: "p1_visao_equipe", codigo: "P1", rotulo: "Quem vê os itens da equipe", ajuda: "mesmo_modulo = qualquer pessoa vê os itens dos colegas dos módulos que já vê; so_supervisao = só quem está na lista de supervisão." },
  { chave: "p2_financeiro", codigo: "P2", rotulo: "Financeiro na Central", ajuda: "tela = quem abre Títulos a pagar/receber hoje (área ERP + permissão) vê o Financeiro na Central; estrito = exige também a linha explícita da área “Financeiro”. Nunca se abre a quem não tem acesso hoje." },
  { chave: "p3_aprova_acesso", codigo: "P3", rotulo: "Quem aprova pedidos de acesso", ajuda: "O pedido aparece para o admin (e, se escolher, para o dono do módulo). A concessão continua a ser feita em Usuários e acessos." },
  { chave: "p4_encaminhar_livre", codigo: "P4", rotulo: "Encaminhamento livre", ajuda: "Qualquer pessoa pode encaminhar um pedido livre a um módulo que não vê." },
  { chave: "entrega_atrasada_dias", codigo: "—", rotulo: "Entrega atrasada há mais de (dias)", ajuda: "Cobrança de fornecedor só a partir deste atraso." },
  { chave: "vence_sem_doc_dias", codigo: "—", rotulo: "Vence sem documento em (dias)", ajuda: "Título a pagar que vence neste prazo sem NF/boleto anexado." },
];

/** Junta o que está gravado sobre a configuração vazia (campos novos nascem desligados). */
export function normalizarConfig(dados: unknown): ConfigOrdem {
  const d = (dados && typeof dados === "object" ? dados : {}) as Partial<ConfigOrdem>;
  return {
    ...CONFIG_VAZIA,
    ...d,
    modulos: { ...(d.modulos ?? {}) },
    detetores: { ...(d.detetores ?? {}) },
    acoes: { ...(d.acoes ?? {}) },
    mensagens: { ...CONFIG_VAZIA.mensagens, ...(d.mensagens ?? {}) },
    escada: { ...CONFIG_VAZIA.escada, ...(d.escada ?? {}) },
    parametros: { ...CONFIG_VAZIA.parametros, ...(d.parametros ?? {}) },
    supervisao_ids: Array.isArray(d.supervisao_ids) ? d.supervisao_ids : [],
  };
}

/** Lista plana caminho → valor, para registar a diferença no log. */
export function diferencas(antes: ConfigOrdem, depois: ConfigOrdem): { chave: string; antes: unknown; depois: unknown }[] {
  const out: { chave: string; antes: unknown; depois: unknown }[] = [];
  const andar = (a: unknown, b: unknown, caminho: string) => {
    const obj = (x: unknown) => x && typeof x === "object" && !Array.isArray(x);
    if (obj(a) || obj(b)) {
      const ks = new Set([...Object.keys((a ?? {}) as object), ...Object.keys((b ?? {}) as object)]);
      for (const k of ks) andar((a as Record<string, unknown> | undefined)?.[k], (b as Record<string, unknown> | undefined)?.[k], caminho ? `${caminho}.${k}` : k);
      return;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ chave: caminho, antes: a ?? null, depois: b ?? null });
  };
  andar(antes, depois, "");
  return out;
}

/** Tolerância M1: menor entre R$ e % do valor do PC. */
export function dentroTolerancia(diferenca: number, valorPc: number, p: ConfigOrdem["parametros"]): boolean {
  const d = Math.abs(diferenca);
  if (d < 0.005) return true;
  const porPct = Math.abs(valorPc) * (p.m1_tol_pct / 100);
  const limite = Math.min(p.m1_tol_reais, porPct);
  return d <= limite + 1e-9;
}
