// Central de Ordem — acesso. SPEC §4.2: SÓ composição das camadas que já existem.
// Não guarda nem decide permissões: pergunta a canViewArea (platform.user_area_access),
// a permissoesDe (platform.permissoes_usuario + catálogo) e a canViewValues
// (platform.user_module_roles), exactamente como as telas de hoje.
// Funções puras (testáveis); o carregamento do utilizador fica em acesso-server.ts.
import { canApprove, canViewArea, canViewValues, type UserPerms } from "@/lib/permissions";
import type { ConfigOrdem } from "./config";
import { MODULOS } from "./modulos";
import type { ModuloOrdem } from "./tipos";

export type Pode = Record<string, boolean>;
export type Quem = { perms: UserPerms; pode: Pode; uid: string; email: string; nome: string; admin: boolean };

/** Módulo → a mesma verificação que a tela tradicional faz (ver lib/ordem/modulos.ts). */
export function veModulo(q: Pick<Quem, "perms" | "pode">, m: ModuloOrdem, cfg?: Pick<ConfigOrdem, "parametros">): boolean {
  const erp = canViewArea(q.perms, "erp");
  const p = q.pode;
  switch (m) {
    case "compras": return erp && p["compras.acesso"] === true;
    case "financeiro": {
      const tela = erp && (p["financeiro.ver_pagar"] === true || p["financeiro.ver_receber"] === true);
      if (!tela) return false;
      // P2 "estrito": exige também a linha explícita da área Financeiro (nunca alarga, só restringe).
      return cfg?.parametros.p2_financeiro === "estrito" ? canViewArea(q.perms, "financeiro") : true;
    }
    case "faturamento": return erp && p["faturamento.acesso"] === true;
    case "estoque": return erp && p["estoque.acesso"] === true;
    case "cadastros": return erp;
    case "operacao": return canViewArea(q.perms, "operacao");
    case "projetos": return canViewArea(q.perms, "operacao");
    // CRM: o painel não guarda o acesso; decide o próprio CRM (lista vazia = sem acesso).
    case "comercial": return false;
  }
}

/** Módulos que a pessoa vê (camadas existentes). Comercial entra à parte (resposta do CRM). */
export function modulosVisiveis(q: Pick<Quem, "perms" | "pode">, cfg?: Pick<ConfigOrdem, "parametros">): ModuloOrdem[] {
  return MODULOS.map((m) => m.id).filter((m) => veModulo(q, m, cfg));
}

/** Módulo ligado para esta pessoa: o admin vê tudo em pré-visualização; os outros só o que o admin ligou. */
export function moduloLigado(q: Pick<Quem, "admin">, cfg: ConfigOrdem, m: ModuloOrdem): { ligado: boolean; previa: boolean } {
  const ligado = cfg.ativo && cfg.modulos[m] === true;
  if (ligado) return { ligado: true, previa: false };
  return q.admin ? { ligado: true, previa: true } : { ligado: false, previa: false };
}

export function detetorLigado(q: Pick<Quem, "admin">, cfg: ConfigOrdem, tipo: string): { ligado: boolean; previa: boolean } {
  if (cfg.ativo && cfg.detetores[tipo] === true) return { ligado: true, previa: false };
  return q.admin ? { ligado: true, previa: true } : { ligado: false, previa: false };
}

/** Pode ver valores (R$) deste módulo — mesma regra das telas. */
export function podeVerValores(q: Pick<Quem, "perms" | "pode">, m: ModuloOrdem): boolean {
  const p = q.pode;
  switch (m) {
    case "compras": return p["compras.ver_valores"] !== false;
    case "estoque": return p["estoque.ver_custos"] !== false;
    case "operacao": return canViewValues(q.perms, "avulsos");
    case "projetos": return canViewValues(q.perms, "projetos");
    default: return true;
  }
}

export type ItemAcesso = { modulo: ModuloOrdem; tipo: string; requer?: string[] | null };

/** Pode ver este item (sem olhar a dono): módulo visível + permissões finas extra do item. */
export function podeVerItem(q: Pick<Quem, "perms" | "pode">, item: ItemAcesso, cfg?: Pick<ConfigOrdem, "parametros">): boolean {
  if (!veModulo(q, item.modulo, cfg)) return false;
  for (const k of item.requer ?? []) if (q.pode[k] !== true) return false;
  return true;
}

/** Ação a partir da Central: precisa (1) do interruptor da ação ligado pelo admin e
 *  (2) da MESMA permissão que a tela de hoje exige. A rota existente volta a verificar tudo. */
export function podeExecutar(q: Pick<Quem, "perms" | "pode" | "admin">, cfg: ConfigOrdem, chave: string): { ok: boolean; motivo: string | null } {
  if (cfg.acoes[chave] !== true) return { ok: false, motivo: "Ação ainda desligada na configuração da Central (o administrador liga quando quiser)." };
  const exige = PERMISSAO_DA_ACAO[chave];
  if (exige === undefined) return { ok: false, motivo: "Ação desconhecida." };
  if (!q.admin && exige.some((k) => q.pode[k] !== true)) return { ok: false, motivo: "O seu perfil não tem esta permissão na tela tradicional." };
  // Aprovar PC: quem aprova em Compras (compras.aprovar) ou no módulo Projetos (caminho "projetos" da
  // rota) — o mesmo filtro de exigirAprovacaoCompras; alçada e budget a rota decide PC a PC.
  if (chave === "compras.aprovar" && !q.admin && q.pode["compras.aprovar"] !== true && !canApprove(q.perms, "projetos")) {
    return { ok: false, motivo: "O seu perfil não aprova pedidos de compra." };
  }
  return { ok: true, motivo: null };
}

/** Ação da Central → chaves de permissão que a tela de hoje exige ([] = só o acesso ao módulo).
 *  É só o primeiro filtro: a rota existente volta a verificar tudo (alçada, budget, etc.). */
export const PERMISSAO_DA_ACAO: Record<string, string[]> = {
  "compras.aprovar": [],            // /api/compras/acao decide (compras.aprovar, alçada, projetos.aprovar_acima_budget)
  "compras.casar_nf": ["compras.acesso"],
  "compras.enviar_fornecedor": ["compras.enviar_fornecedor"],
  "compras.cobrar_fornecedor": ["compras.enviar_fornecedor"],
  "operacao.aprovar": [],           // /api/approvals/* decide (decidirLinha)
  "financeiro.conciliar": ["financeiro.conciliar", "financeiro.baixar"],
};

/** Escopo da fila: "meus" (padrão), "equipe" (colegas dos mesmos módulos), "todos" (supervisão). */
export type Escopo = "meus" | "equipe" | "todos";

export function escoposPermitidos(q: Pick<Quem, "admin" | "uid">, cfg: ConfigOrdem): Escopo[] {
  const sup = q.admin || cfg.supervisao_ids.includes(q.uid);
  if (sup) return ["meus", "equipe", "todos"];
  if (cfg.parametros.p1_visao_equipe === "mesmo_modulo") return ["meus", "equipe"];
  return ["meus"];
}

/** Filtro de dono (depois de podeVerItem). Item sem dono resolvido conta como "da equipe do módulo" e aparece em "meus". */
export function noEscopo(item: { dono_id: string | null; encaminhado_por?: string | null }, uid: string, escopo: Escopo): boolean {
  if (escopo !== "meus") return true;
  return item.dono_id === uid || item.dono_id == null || item.encaminhado_por === uid;
}
