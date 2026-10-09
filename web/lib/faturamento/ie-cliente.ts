import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { permissoesDe } from "@/lib/acessos";
import { ieDig, ieNumerica, type IeCadastro, type IeFonte, type IeInfo } from "./ie-regra";

/* IE conhecida do cliente (09/10/26): de onde a nota pode tirar a Inscrição Estadual que falta.
   Ordem de confiança: 1) última NF-e AUTORIZADA (produção) para o mesmo CNPJ — a SEFAZ aceitou;
   2) cadastro do cliente (cadastros.pessoas, todas as empresas); 3) espelho antigo do Omie (finance.clientes). */

const ddmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "");
const fmtDoc = (d: string) => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : d;

/** Linhas do cadastro (cadastros.pessoas) com este CNPJ/CPF, em todas as empresas, com a IE. */
export async function cadastrosDoDoc(doc: string): Promise<(IeCadastro & { pessoa: Record<string, unknown> })[]> {
  const a = supaAdmin().schema("orders");
  const listas = await Promise.all(["SF", "CD", "WW"].map((emp) =>
    Promise.resolve(a.rpc("cadastros_listar", { p_papel: null, p_empresa: emp, p_q: doc, p_ativos: false, p_lim: 5, p_off: 0 })).then((r) => r.data).catch(() => null)));
  const ids = new Set<number>();
  for (const l of listas) for (const x of ((l as { linhas?: { id: number; doc?: string | null }[] } | null)?.linhas ?? [])) {
    if (ieDig(x.doc) === doc) ids.add(Number(x.id));
  }
  const ps = await Promise.all([...ids].map((id) => Promise.resolve(a.rpc("cadastros_obter", { p_id: id })).then((r) => r.data as Record<string, unknown> | null).catch(() => null)));
  return ps.filter((p): p is Record<string, unknown> => !!p && !p.mescladoEm).map((p) => ({
    id: Number(p.id), empresa: String(p.empresa ?? ""), codigo: p.codigo == null ? null : Number(p.codigo),
    ie: p.ie == null ? null : String(p.ie), pessoa: p,
  }));
}

export async function ieConhecida(docBruto: string): Promise<IeInfo> {
  const doc = ieDig(docBruto);
  const vazio: IeInfo = { doc, fontes: [], sugestao: null, cadastros: [] };
  if (doc.length < 11) return vazio;
  const campo = doc.length === 14 ? "payload->>cnpj_destinatario" : "payload->>cpf_destinatario";
  const [nfe, cads, omie] = await Promise.all([
    supaAdmin().schema("orders").from("fat_emissoes")
      .select("id,numero,autorizada_em,ie:payload->>inscricao_estadual_destinatario")
      .eq("tipo", "nfe").eq("status", "autorizada").eq("ambiente", "producao").eq(campo, doc)
      .order("autorizada_em", { ascending: false }).limit(5)
      .then((r) => (r.data ?? []) as { id: number; numero: string | null; autorizada_em: string | null; ie: string | null }[]),
    cadastrosDoDoc(doc).catch(() => []),
    supaAdmin().schema("finance").from("clientes").select("empresa,inscricao_estadual").in("cnpj_cpf", [fmtDoc(doc), doc]).limit(5)
      .then((r) => (r.data ?? []) as { empresa: string; inscricao_estadual: string | null }[]),
  ]);
  const fontes: IeFonte[] = [];
  const n = nfe.find((x) => ieNumerica(x.ie));
  if (n) fontes.push({ ie: ieDig(n.ie), fonte: "nfe", rotulo: `da NF-e ${n.numero ?? "?"} autorizada em ${ddmm(n.autorizada_em)}` });
  const c = cads.find((x) => ieNumerica(x.ie));
  if (c) fontes.push({ ie: ieDig(c.ie), fonte: "cadastro", rotulo: `do cadastro do cliente (${c.empresa}, código ${c.codigo ?? "?"})` });
  const o = omie.find((x) => ieNumerica(x.inscricao_estadual));
  if (o) fontes.push({ ie: ieDig(o.inscricao_estadual), fonte: "omie", rotulo: `do cadastro antigo do Omie (${o.empresa})` });
  return { doc, fontes, sugestao: fontes[0] ?? null, cadastros: cads.map(({ pessoa: _p, ...r }) => r) };
}

/** Quem pode editar cadastros (a mesma regra de lib/cadastros-server: admin, Compras ou editar títulos). */
export const QUEM_EDITA_CADASTRO = "um administrador, quem tem acesso a Compras ou quem pode editar títulos no Financeiro";
export async function podeEditarCadastro(): Promise<boolean> {
  const perms = await loadPerms();
  if (!perms) return false;
  if (perms.is_admin) return true;
  const pode = await permissoesDe(perms);
  return !!(pode["compras.acesso"] || pode["financeiro.editar_titulo"]);
}

/** Grava a IE no cadastro de TODAS as linhas deste CNPJ que estão sem IE (vazia ou ISENTO).
 *  Nunca sobrescreve uma IE numérica diferente — devolve-as para o usuário conferir. Pelo cadastros_salvar
 *  (histórico em cadastros.pessoas_hist e propagação aos irmãos da mesma entidade). */
export async function salvarIeNoCadastro(docBruto: string, ieBruta: string, por: string) {
  const doc = ieDig(docBruto), ie = ieDig(ieBruta);
  if (doc.length < 11) throw new Error("CNPJ/CPF inválido");
  if (ie.length < 2) throw new Error("IE inválida");
  const linhas = await cadastrosDoDoc(doc);
  const atualizados: string[] = [], jaTinham: string[] = [], diferentes: string[] = [];
  for (const l of linhas) {
    const rot = `${l.empresa} ${l.codigo ?? l.id}`;
    if (ieNumerica(l.ie)) {
      if (ieDig(l.ie) === ie) jaTinham.push(rot); else diferentes.push(`${rot} (IE ${l.ie})`);
      continue;
    }
    const { historico: _h, ...p } = l.pessoa;
    const r = await supaAdmin().schema("orders").rpc("cadastros_salvar", { p: { ...p, ie, id: l.id }, p_por: por });
    if (r.error) throw new Error(`Cadastro ${rot}: ${r.error.message}`);
    atualizados.push(rot);
  }
  return { atualizados, ja_tinham: jaTinham, diferentes, encontrados: linhas.length };
}
