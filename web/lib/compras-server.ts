import "server-only";
import { NextResponse, after } from "next/server";
import { pontePedido } from "@/lib/ponte-pc";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea, type UserPerms } from "@/lib/permissions";
import { permissoesDe, semValores } from "@/lib/acessos";
import type { Chave } from "@/lib/acessos-catalogo";
import { motivoSemPermissao, caminhoAprovacaoCompras, motivoForaDoCaminho, type CaminhoCompras, type DecisaoAcao, type EntradaPermissao } from "@/lib/aprovacao-permissao";
import { permsAprovacao } from "@/lib/aprovacao-permissao-server";
import { canApprove } from "@/lib/permissions";
import { avaliarPcProjeto } from "@/lib/aprovacao-projeto";
import { ehProjetoDeObra } from "@/lib/aprovacao-projeto-regra";

// O schema compras não é exposto no PostgREST: tudo passa por funções
// orders.compras_* (security definer, só service_role). Estas rotas validam
// a sessão e a área ERP antes de chamar.

/** `caminho`: "compras" = área ERP + compras.acesso (o normal); "projetos" = só aprovar/reprovar
 *  PC de projeto de obra, para quem aprova no módulo Projetos sem a área ERP (exigirAprovacaoCompras). */
export type Quem = { perms: UserPerms; email: string; uid: string | null; nome: string; pode: Record<Chave, boolean>; caminho: CaminhoCompras };

async function quem(perms: UserPerms, pode: Record<Chave, boolean>, caminho: CaminhoCompras): Promise<Quem> {
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const { data: prof } = await supaAdmin().schema("platform").from("user_profiles").select("nome").eq("id", perms.id ?? "").maybeSingle();
  const email = user?.email ?? "painel";
  return { perms, email, uid: perms.id ?? null, nome: (prof as { nome?: string } | null)?.nome || email, pode, caminho };
}

export async function exigirCompras(): Promise<Quem | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const pode = await permissoesDe(perms);
  if (!pode["compras.acesso"]) return NextResponse.json({ error: "Sem acesso a Compras" }, { status: 403 });
  return quem(perms, pode, "compras");
}

/** Só para aprovar/reprovar PC (acao "aprovar"): quem tem Compras entra como sempre; quem não
 *  tem a área ERP mas aprova no módulo Projetos entra pelo caminho "projetos" (09/10/26) —
 *  e motivoNaoDecide só o deixa decidir PC de projeto de obra, dentro do budget. */
export async function exigirAprovacaoCompras(): Promise<Quem | NextResponse> {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const areaErp = canViewArea(perms, "erp");
  const pode = await permissoesDe(perms);
  const papeis = perms.id ? await permsAprovacao(perms.id) : null;
  const caminho = caminhoAprovacaoCompras({
    ehAdmin: perms.is_admin, areaErp, comprasAcesso: !!pode["compras.acesso"],
    aprovaProjetos: !!papeis?.ativo && canApprove(papeis, "projetos"),
  });
  if (!caminho) return NextResponse.json({ error: !areaErp ? "Sem acesso à área ERP" : "Sem acesso a Compras" }, { status: 403 });
  return quem(perms, pode, caminho);
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Erro de regra (raise exception no banco) vira 400 com a mensagem; o resto, 500. */
export function erro(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Alçada individual no módulo PCs (approval_ceiling_brl); null = sem limite. */
async function tetoPcs(uid: string | null): Promise<number | null> {
  const { data } = await supaAdmin().schema("platform").from("user_module_roles")
    .select("approval_ceiling_brl").eq("user_id", uid ?? "").eq("modulo", "pcs").maybeSingle();
  const t = (data as { approval_ceiling_brl?: number | null } | null)?.approval_ceiling_brl;
  return t != null ? Number(t) : null;
}

/** Pode decidir a aprovação deste PC do painel (aprovar, reprovar, devolver para aguardando)?
 *  null = pode; senão o motivo. A MESMA regra para as três (lib/aprovacao-permissao):
 *  admin; ou compras.aprovar + alçada; PC de projeto de obra: compras.aprovar e, se o
 *  projeto estoura o budget de materiais, só admin. */
export async function motivoNaoDecide(q: Quem, p: { emp: string; num: string; valor: number; projCod: number | null; proj: string | null }, acao: DecisaoAcao): Promise<string | null> {
  const ehAdmin = q.perms.is_admin;
  const deObra = !!p.projCod && ehProjetoDeObra(p.proj);
  if (!ehAdmin) { const fora = motivoForaDoCaminho(q.caminho, deObra); if (fora) return fora; }
  // caminho "projetos": a permissão é o can_approve do módulo Projetos (já conferido na entrada)
  const temPermissao = q.caminho === "projetos" ? true : !!q.pode["compras.aprovar"];
  if (ehAdmin || !temPermissao) return motivoSemPermissao({ ehAdmin, temPermissao, valor: null, teto: null }, acao);
  if (p.projCod && ehProjetoDeObra(p.proj)) {
    let projeto: EntradaPermissao["projeto"];
    try { projeto = await avaliarPcProjeto(p.emp, Number(p.projCod), p.num, Number(p.valor) || 0); }
    catch { projeto = "indisponivel"; }
    return motivoSemPermissao({ ehAdmin, temPermissao, valor: Number(p.valor) || 0, teto: null, projeto }, acao);
  }
  return motivoSemPermissao({ ehAdmin, temPermissao, valor: Number(p.valor) || 0, teto: await tetoPcs(q.uid) }, acao);
}

/** Depois de gravar: previsões a pagar do pedido e RCs nos baldes de PV/OS
 *  (Avulsos/Projetos). Idempotentes; falha aqui não desfaz o que foi gravado. */
export async function posGravar(id: number, tipo?: string) {
  await Promise.all([
    tipo !== "RC" ? rpc("compras_gerar_previsoes", { p_id: id }).catch(() => null) : null,
    // PC também republica as RCs (06/10/26): o nº do PC aparece na hora nas
    // linhas da RC em Operação (Vendas avulsas / Projetos).
    rpc("compras_publicar_rcs").catch(() => null),
    tipo !== "RC" ? vincularListaDoProjeto(id).catch(() => null) : null,
  ]);
  /* Ponte PC → lista (09/10/26, lib/ponte-pc): PC com projeto que não nasceu da lista traz
     os itens para a lista — depois do vínculo automático acima (o que já está na lista só
     liga) e DEPOIS da resposta (não atrasa quem gravou). Fora de uma requisição, roda já. */
  if (tipo !== "RC") {
    const rodar = () => pontePedido(id).catch(() => null);
    try { after(rodar); } catch { void rodar(); }
  }
}

/** PC de projeto (06/10/26): casa os itens dele com a lista de materiais do
 *  projeto — código igual ou descrição com as mesmas medidas — sem ninguém
 *  precisar clicar. O que ficar em dúvida aparece para conferir na lista. */
async function vincularListaDoProjeto(id: number) {
  await supaAdmin().schema("approval").rpc("rc_projetos_autolink_pc", { p_pedido_id: id });
}

/** Resposta 403 se a pessoa não tem a permissão fina; null se tem. */
export function semPermissao(q: Quem, chave: Chave, msg: string): NextResponse | null {
  return q.pode[chave] ? null : NextResponse.json({ error: msg }, { status: 403 });
}

/** Campos de valor (R$) dos pedidos — zerados para quem não pode ver valores. */
const CAMPOS_VALOR = /^(valor|vu|vlrUnit|nval|preco|total|merc|desc0|desconto|ipi|st|frete|seguro|outras|liberado|valorAberto|valor_.*|ultimo_preco|min|max|media|avg|vuMax|valOutros)$/i;
export function valoresSePuder<T>(q: Quem, dado: T): T {
  return q.pode["compras.ver_valores"] ? dado : semValores(dado, CAMPOS_VALOR);
}
