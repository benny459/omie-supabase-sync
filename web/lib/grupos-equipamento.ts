// Grupos de equipamento (07/10/26) — nomes padronizados e a data "necessário em"
// de cada grupo na lista de materiais do projeto.
//
// A data do grupo não tem tabela própria: mora nas linhas (rc_projetos_itens.
// data_necessaria), que é o que a RC ("data limite") e o fluxo já leem. A data do
// grupo é a da maioria das linhas dele (ver dataDoGrupo, pura).
// O cadastro (platform.equipamento_grupo, sql/100) é opcional: sem a migração, a
// lista sugere os nomes já usados nos projetos.
import { supaAdmin } from "@/lib/supabase-admin";
import { CRM_URL, CRM_ANON, CRM_EMPRESA } from "@/lib/crm-fechamento";
import { normGrupo } from "@/lib/grupos-equipamento-puro";

export type GrupoCadastro = { id: number; nome: string; descricao: string | null; ativo: boolean };

/** Tabela ainda não criada (migração pendente) → null, para a tela cair no plano B. */
export async function lerCadastroGrupos(todos = false): Promise<GrupoCadastro[] | null> {
  let q = supaAdmin().schema("platform").from("equipamento_grupo").select("id, nome, descricao, ativo").order("nome");
  if (!todos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) return null;
    throw new Error(error.message);
  }
  return (data ?? []) as GrupoCadastro[];
}

/** Cor gravada de cada grupo do cadastro (sql/131), por nome normalizado. null = coluna ainda
 *  não existe (migração pendente) — a tela usa a paleta pela ordem dos grupos. */
export async function coresDosGrupos(): Promise<Record<string, string> | null> {
  const { data, error } = await supaAdmin().schema("platform").from("equipamento_grupo").select("nome_norm, cor");
  if (error) return null;
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { nome_norm: string; cor: string | null }[]) if (r.cor) out[r.nome_norm] = r.cor;
  return out;
}

export async function salvarGrupo(a: { id?: number | null; nome: string; descricao?: string | null; ativo?: boolean; por: string }) {
  const nome = a.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) throw new Error("Informe o nome do grupo");
  const linha = { nome, nome_norm: normGrupo(nome), descricao: a.descricao?.trim() || null, ativo: a.ativo !== false,
    atualizado_por: a.por, atualizado_em: new Date().toISOString() };
  const t = supaAdmin().schema("platform").from("equipamento_grupo");
  const r = a.id ? await t.update(linha).eq("id", a.id) : await t.insert({ ...linha, criado_por: a.por });
  if (r.error) {
    if (/duplicate|23505/i.test(`${r.error.code} ${r.error.message}`)) throw new Error("Já existe um grupo com esse nome");
    throw new Error(r.error.message);
  }
}

/** Nomes de equipamento já usados nas listas dos projetos (com quantos projetos usam). */
export async function gruposEmUso(): Promise<{ nome: string; projetos: number }[]> {
  const { data, error } = await supaAdmin().schema("approval").from("rc_projetos_itens")
    .select("equipamento, codigo_projeto").not("equipamento", "is", null).limit(20000);
  if (error) throw new Error(error.message);
  const m = new Map<string, { nome: string; proj: Set<number> }>();
  for (const r of (data ?? []) as { equipamento: string; codigo_projeto: number }[]) {
    const k = normGrupo(r.equipamento);
    if (!k) continue;
    const x = m.get(k) ?? { nome: r.equipamento.trim(), proj: new Set<number>() };
    x.proj.add(Number(r.codigo_projeto));
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ nome: x.nome, projetos: x.proj.size })).sort((a, b) => b.projetos - a.projetos || a.nome.localeCompare(b.nome));
}

/** Prazo da proposta ligada ao projeto (CRM): entrega prevista do material, para sugerir a data dos grupos.
 *  A CP não tem data por equipamento — o que existe é a entrega do fechamento e o evento "Contra entrega do material". */
export async function prazoDaProposta(codigoProjeto: number): Promise<{ data: string | null; fonte: string | null; grupos: string[] }> {
  const filtro = `dados_json->recebimento->projetoPainel->>codigo=eq.${encodeURIComponent(String(codigoProjeto))}`;
  const url = `${CRM_URL}/rest/v1/propostas?select=numero,valor,rec:dados_json->recebimento,eqs:dados_json->formacaoCusto->equipamentos`
    + `&empresa_id=eq.${CRM_EMPRESA}&${filtro}&order=valor.desc.nullslast&limit=1`;
  const r = await fetch(url, { headers: { apikey: CRM_ANON, Authorization: `Bearer ${CRM_ANON}` }, cache: "no-store" });
  if (!r.ok) return { data: null, fonte: null, grupos: [] };
  const [p] = (await r.json()) as { numero: string; rec?: { entregaPrevista?: string; parcelas?: { evento?: string; previsao?: string; faturamento?: string }[] }; eqs?: { nome?: string }[] }[];
  if (!p) return { data: null, fonte: null, grupos: [] };
  const grupos = [...new Set((p.eqs ?? []).map((e) => String(e.nome ?? "").trim()).filter(Boolean))];
  const material = (p.rec?.parcelas ?? []).find((x) => /material/i.test(String(x.evento ?? "")));
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
  if (iso(p.rec?.entregaPrevista)) return { data: iso(p.rec?.entregaPrevista), fonte: `entrega prevista da proposta ${p.numero}`, grupos };
  if (material && iso(material.faturamento ?? material.previsao)) return { data: iso(material.faturamento ?? material.previsao), fonte: `"${material.evento}" na proposta ${p.numero}`, grupos };
  return { data: null, fonte: null, grupos };
}
