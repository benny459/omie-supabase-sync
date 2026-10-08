// Gerar PC pela LISTA de materiais (07/10/26; extraído da rota em 08/10/26 para o agente
// de compras usar o MESMO caminho): um PC por fornecedor via compras_salvar + posGravar
// (numeração, aprovação, avisos). Cada item do PC já nasce ligado à linha da lista
// (pc_item_id) — e, se a linha veio de uma RC, ao item da RC. simular=true: valida e devolve
// os pedidos que seriam criados, sem gravar. Nada vai ao Omie.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { rpc, posGravar } from "@/lib/compras-server";

const approval = () => supaAdmin().schema("approval");
export type GrupoPc = { corpo: Record<string, unknown>; linhas: { lista_id: string; qtd: number; vu: number }[] };

export async function gerarPcsDaLista({ empresa, codigo, grupos, simular, por, uid }: {
  empresa: string; codigo: number; grupos: GrupoPc[]; simular: boolean; por: string; uid: string | null;
}): Promise<{ erro: string } | { ok: true; simulado: true; pedidos: Record<string, unknown>[] } | { ok: true; pedidos: { num: string; id: number; linhas: number }[] }> {
  const ids = grupos.flatMap((g) => g.linhas.map((l) => String(l.lista_id)));
  const { data: rows, error } = await approval().from("rc_projetos_itens")
    .select("id, item, modelo, qtd, un, cat_codigo, cat_ncod_prod, cat_valor_unit, equipamento, observacao, rc_item_id, pc_item_id, pc_numero, data_necessaria")
    .eq("empresa", empresa).eq("codigo_projeto", codigo).in("id", ids);
  if (error) throw new Error(error.message);
  const porId = new Map(((rows ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const { data: pj } = await supaAdmin().schema("finance").from("projetos").select("nome").eq("empresa", empresa).eq("codigo", codigo).maybeSingle();
  const { data: vendas } = await supaAdmin().schema("sales").from("v_erp_vendas").select("label, cliente, emissao").eq("empresa", empresa).eq("codigo_projeto", String(codigo));
  const venda = ((vendas ?? []) as { label: string; cliente: string | null; emissao: string | null }[])
    .sort((x, y) => Number(y.label.startsWith("PV")) - Number(x.label.startsWith("PV")) || String(y.emissao ?? "").localeCompare(String(x.emissao ?? "")))[0];
  const montados: { corpo: Record<string, unknown>; linhas: string[] }[] = [];
  for (const g of grupos) {
    const linhas: string[] = [];
    const itens = [];
    for (const l of g.linhas) {
      const r = porId.get(String(l.lista_id));
      if (!r) return { erro: "Linha da lista não encontrada neste projeto" };
      if (r.pc_item_id || String(r.pc_numero ?? "").trim()) return { erro: `"${r.item}" já tem PC` };
      if (!(Number(l.qtd) > 0)) return { erro: `"${r.item}" está sem quantidade` };
      itens.push({ id: null, cod: r.cat_codigo ?? "", ncodProd: r.cat_ncod_prod ?? null, desc: [r.item, r.modelo].filter(Boolean).join(" · "),
        un: r.un || "UN", qtd: Number(l.qtd), vu: Math.round((Number(l.vu) || 0) * 100) / 100, desc0: 0, ipi: 0, st: 0, ncm: null, local: null,
        obs: [r.equipamento ? `Equip.: ${r.equipamento}` : "", r.observacao ?? ""].filter(Boolean).join(" · ") || null,
        rc: r.rc_item_id ? { itemId: Number(r.rc_item_id) } : null });
      linhas.push(String(r.id));
    }
    const corpo: Record<string, unknown> = { ...g.corpo, tipo: "PC", emp: empresa, projCod: codigo, proj: (pj as { nome?: string } | null)?.nome ?? "",
      ...(venda ? { pv: venda.label, pvCliente: venda.cliente ?? "" } : {}),
      semRc: false, semRcMotivo: null, avulsa: false, avulsaMotivo: null, itens,
      origemDe: `Lista de materiais do projeto ${(pj as { nome?: string } | null)?.nome ?? codigo}`,
      obsInt: `PC gerado da Lista de materiais do projeto ${(pj as { nome?: string } | null)?.nome ?? codigo} · ${linhas.length} linha(s)` };
    if (!corpo.fornCod && !corpo.forn) return { erro: 'O "Fornecedor" deve ser preenchido em todos os pedidos.' };
    if (!corpo.cat) return { erro: 'A "Categoria da Compra" deve ser preenchida em todos os pedidos.' };
    montados.push({ corpo, linhas });
  }
  if (simular) return { ok: true, simulado: true, pedidos: montados.map((m) => m.corpo) };
  const feitos: { num: string; id: number; linhas: number }[] = [];
  for (const m of montados) {
    const r = await rpc<{ id: number; num: string }>("compras_salvar", { p: m.corpo, p_por: por, p_uid: uid });
    const { data: full } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: r.id });
    const its = [...(((full ?? {}) as { itens?: { id: number; seq: number }[] }).itens ?? [])].sort((x, y) => x.seq - y.seq);
    for (let k = 0; k < m.linhas.length && k < its.length; k++) {
      await approval().from("rc_projetos_itens").update({ pc_item_id: its[k].id, pc_numero: r.num, vinculo_via: "lista", vinculo_em: new Date().toISOString(), atualizado_por: por })
        .eq("id", m.linhas[k]);
    }
    await posGravar(r.id, "PC");
    feitos.push({ num: r.num, id: r.id, linhas: m.linhas.length });
  }
  return { ok: true, pedidos: feitos };
}
