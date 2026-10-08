// Dados do modelo Excel da lista de materiais (lib/modelo-lista) — só leitura.
//   itens:  orders.v_estoque_item (código novo, ativos, não mesclados) + fornecedor habitual,
//           último preço e prazo médio de orders.mv_catalogo_compra (a compra mais recente).
//   grupos: os já usados no projeto + os equipamentos da proposta do CRM + o cadastro
//           (platform.equipamento_grupo); sem cadastro, os nomes em uso nos projetos.
import { supaAdmin } from "@/lib/supabase-admin";
import { deHtml } from "@/lib/match-pc";
import { gruposEmUso, lerCadastroGrupos, prazoDaProposta } from "@/lib/grupos-equipamento";
import { normGrupo } from "@/lib/grupos-equipamento-puro";
import type { GrupoModelo, ItemModelo } from "@/lib/modelo-lista";

type Est = { n_cod_prod: number; codigo_novo: string; descricao: string; unidade: string | null; familia: string | null; ult_preco: number | null; ativo: boolean | null };
type Mv = { ncod_prod: number; unidade: string | null; fornecedor: string | null; ultimo_preco: number | null; ultima_compra: string | null; entrega_dias: number | null };

export async function itensDoModelo(emp: string): Promise<ItemModelo[]> {
  const orders = supaAdmin().schema("orders");
  const itens: Est[] = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await orders.from("v_estoque_item")
      .select("n_cod_prod, codigo_novo, descricao, unidade, familia, ult_preco, ativo")
      .eq("empresa", emp).not("codigo_novo", "is", null).is("mesclado_em", null)
      .order("codigo_novo").range(ini, ini + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as Est[];
    itens.push(...lote.filter((r) => r.ativo !== false));
    if (lote.length < 1000) break;
  }
  const compra = new Map<number, Mv>();
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await orders.from("mv_catalogo_compra")
      .select("ncod_prod, unidade, fornecedor, ultimo_preco, ultima_compra, entrega_dias")
      .eq("empresa", emp).order("ncod_prod").range(ini, ini + 999);
    if (error) break; // sem o histórico, o modelo sai só com o cadastro
    const lote = (data ?? []) as Mv[];
    for (const m of lote) {
      const a = compra.get(Number(m.ncod_prod));
      if (!a || String(m.ultima_compra ?? "") > String(a.ultima_compra ?? "")) compra.set(Number(m.ncod_prod), m);
    }
    if (lote.length < 1000) break;
  }
  const vistos = new Set<string>();
  return itens.flatMap((i) => {
    const cod = String(i.codigo_novo).trim().toUpperCase();
    if (!cod || vistos.has(cod)) return [];
    vistos.add(cod);
    const m = compra.get(Number(i.n_cod_prod));
    return [{
      codigo: cod, descricao: deHtml(i.descricao ?? "").replace(/\s+/g, " ").trim(), un: (i.unidade || m?.unidade || "").trim().toUpperCase() || null, familia: i.familia ?? null,
      fornecedor: m?.fornecedor ? deHtml(m.fornecedor) : null, ultimo_preco: m?.ultimo_preco ?? i.ult_preco ?? null,
      prazo_dias: m?.entrega_dias != null ? Math.round(Number(m.entrega_dias)) : null,
    }];
  });
}

export async function gruposDoModelo(emp: string, codigoProjeto: number | null): Promise<GrupoModelo[]> {
  const out: GrupoModelo[] = [];
  const vistos = new Set<string>();
  const por = (nome: string | null | undefined, origem: GrupoModelo["origem"]) => {
    const n = String(nome ?? "").replace(/\s+/g, " ").trim();
    const k = normGrupo(n);
    if (!n || vistos.has(k)) return;
    vistos.add(k); out.push({ nome: n, origem });
  };
  if (codigoProjeto) {
    const { data } = await supaAdmin().schema("approval").from("rc_projetos_itens")
      .select("equipamento").eq("empresa", emp).eq("codigo_projeto", codigoProjeto).not("equipamento", "is", null).limit(5000);
    const nomes = [...new Set(((data ?? []) as { equipamento: string }[]).map((r) => r.equipamento))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    for (const n of nomes) por(n, "projeto");
    const prop = await prazoDaProposta(codigoProjeto).catch(() => ({ grupos: [] as string[] }));
    for (const n of prop.grupos ?? []) por(n, "proposta");
  }
  const cad = await lerCadastroGrupos().catch(() => null);
  if (cad) for (const g of cad) por(g.nome, "cadastro");
  else for (const g of (await gruposEmUso().catch(() => [])).slice(0, 60)) por(g.nome, "cadastro");
  if (!out.length) por("Geral", "cadastro");
  return out;
}
