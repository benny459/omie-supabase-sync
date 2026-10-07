// /api/rc-projetos/compras — a lista de materiais do projeto ligada às compras.
//   GET  ?empresa=SF&codigo=… → situação de cada linha (RC/PC/recebido/NF),
//        itens de PC fora da lista, totais (estimado × budget × comprometido ×
//        pago) e fluxo mensal (planejado × comprometido × pago).
//   POST { acao: "autolink", aplicar }            casa linhas ↔ itens de PC do projeto
//   POST { acao: "vincular", lista_id, pc_item_id } vínculo manual
//   POST { acao: "desvincular", lista_id }
//   POST { acao: "gerar_rc", ids[], previsao?, simular? } RC com as linhas
//        escolhidas (mesmo caminho do Compras); cada linha da RC fica ligada à
//        linha da lista, e os PCs gerados dela herdam o vínculo pelo item_rc.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";
import { exigirCompras, rpc, erro, posGravar } from "@/lib/compras-server";
import { completarPcs, type DadosPcs } from "@/lib/lista-pc-completar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const approval = () => supaAdmin().schema("approval");

async function usuario() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

export async function GET(req: Request) {
  if (!(await usuario())) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  const codigo = Number(sp.get("codigo"));
  if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  // 07/10/26: o banco às vezes estoura o statement timeout (refresh das MVs de compras
  // na mesma hora) — tenta de novo duas vezes antes de desistir.
  let { data, error } = await approval().rpc("rc_projetos_compras", { p_empresa: empresa, p_projeto: codigo });
  for (let t = 0; t < 2 && error && /timeout|canceling statement/i.test(error.message); t++) {
    await new Promise((r) => setTimeout(r, 1500));
    ({ data, error } = await approval().rpc("rc_projetos_compras", { p_empresa: empresa, p_projeto: codigo }));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    return NextResponse.json(await completarPcs(data as DadosPcs, empresa, codigo));
  } catch {
    return NextResponse.json(data); // sem o detalhe dos PCs, a lista continua de pé
  }
}

type Linha = { id: string; item: string; modelo: string | null; qtd: number | null; un: string | null;
  cat_codigo: string | null; cat_ncod_prod: number | null; cat_valor_unit: number | null; cat_fornecedor: string | null;
  data_necessaria: string | null; observacao: string | null; equipamento: string | null; rc_item_id: number | null };

export async function POST(req: Request) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  let b: { acao?: string; empresa?: string; codigo?: number; aplicar?: boolean; lista_id?: string; pc_item_id?: number;
    ids?: string[]; previsao?: string; simular?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const empresa = String(b.empresa ?? "SF").toUpperCase();
  const codigo = Number(b.codigo);
  if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  const por = user.email ?? user.id;

  try {
    if (b.acao === "autolink") {
      const { data, error } = await approval().rpc("rc_projetos_autolink",
        { p_empresa: empresa, p_projeto: codigo, p_aplicar: b.aplicar === true, p_por: por });
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }

    if (b.acao === "vincular" || b.acao === "desvincular") {
      if (!b.lista_id) return NextResponse.json({ error: "lista_id obrigatório" }, { status: 400 });
      let pcNumero: string | null = null;
      if (b.acao === "vincular") {
        // o item de PC tem de ser deste projeto
        const { data: itens, error } = await approval().rpc("_projeto_pc_itens", { p_empresa: empresa, p_projeto: codigo });
        if (error) throw new Error(error.message);
        const alvo = ((itens ?? []) as { pc_item_id: number; numero: string }[]).find((i) => i.pc_item_id === Number(b.pc_item_id));
        if (!alvo) return NextResponse.json({ error: "Esse item de pedido não é deste projeto" }, { status: 400 });
        pcNumero = alvo.numero;
      }
      const { error } = await approval().from("rc_projetos_itens").update(b.acao === "vincular"
        ? { pc_item_id: Number(b.pc_item_id), pc_numero: pcNumero, vinculo_via: "manual", vinculo_score: null, vinculo_em: new Date().toISOString(), atualizado_por: por, atualizado_em: new Date().toISOString() }
        : { pc_item_id: null, pc_numero: null, vinculo_via: null, vinculo_score: null, vinculo_em: null, atualizado_por: por, atualizado_em: new Date().toISOString() })
        .eq("id", b.lista_id).eq("empresa", empresa).eq("codigo_projeto", codigo);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    if (b.acao === "gerar_rc") {
      const q = await exigirCompras();
      if (q instanceof NextResponse) return q;
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      if (!ids.length) return NextResponse.json({ error: "Escolha as linhas da lista" }, { status: 400 });
      const { data: rows, error } = await approval().from("rc_projetos_itens")
        .select("id, item, modelo, qtd, un, cat_codigo, cat_ncod_prod, cat_valor_unit, cat_fornecedor, data_necessaria, observacao, equipamento, rc_item_id")
        .eq("empresa", empresa).eq("codigo_projeto", codigo).in("id", ids);
      if (error) throw new Error(error.message);
      const linhas = ((rows ?? []) as Linha[]).filter((l) => !l.rc_item_id);
      if (!linhas.length) return NextResponse.json({ error: "Essas linhas já estão em uma RC" }, { status: 400 });
      const semQtd = linhas.find((l) => !(Number(l.qtd) > 0));
      if (semQtd) return NextResponse.json({ error: `"${semQtd.item}" está sem quantidade` }, { status: 400 });
      const { data: proj } = await supaAdmin().schema("finance").from("projetos").select("nome").eq("empresa", empresa).eq("codigo", codigo).maybeSingle();
      // Venda do projeto: o PC exige PV/OS. Material vai para o PV (o mais recente);
      // sem PV, a OS. Sem venda nenhuma, a RC sai sem e o PC pede na hora.
      const { data: vendas } = await supaAdmin().schema("sales").from("v_erp_vendas")
        .select("label, cliente, emissao").eq("empresa", empresa).eq("codigo_projeto", String(codigo));
      const venda = ((vendas ?? []) as { label: string; cliente: string | null; emissao: string | null }[])
        .sort((x, y) => Number(y.label.startsWith("PV")) - Number(x.label.startsWith("PV")) || String(y.emissao ?? "").localeCompare(String(x.emissao ?? "")))[0];
      const datas = linhas.map((l) => l.data_necessaria).filter(Boolean).sort() as string[];
      const previsao = b.previsao || datas[0] || null;
      const forns = [...new Set(linhas.map((l) => (l.cat_fornecedor ?? "").trim()).filter(Boolean))];
      const corpo = {
        tipo: "RC", emp: empresa, proj: (proj as { nome?: string } | null)?.nome ?? null, projCod: String(codigo), previsao,
        ...(venda ? { pv: venda.label, pvCliente: venda.cliente } : {}),
        ...(forns.length === 1 ? { forn: forns[0] } : {}),
        obsInt: `RC da lista de materiais do projeto ${(proj as { nome?: string } | null)?.nome ?? codigo} · ${linhas.length} linha(s)`,
        origemDe: `Lista de materiais do projeto ${(proj as { nome?: string } | null)?.nome ?? codigo}`,
        itens: linhas.map((l) => ({
          cod: l.cat_codigo ?? null, ncodProd: l.cat_ncod_prod ?? null,
          desc: [l.item, l.modelo].filter(Boolean).join(" · "), un: l.un || "UN", qtd: Number(l.qtd),
          vu: Math.round((Number(l.cat_valor_unit) || 0) * 100) / 100,
          obs: [l.equipamento ? `Equip.: ${l.equipamento}` : "", l.observacao ?? "", l.cat_fornecedor ? `Fornecedor sugerido: ${l.cat_fornecedor}` : ""]
            .filter(Boolean).join(" · ") || null,
        })),
      };
      if (b.simular) return NextResponse.json({ ok: true, simulado: true, rc: corpo });
      const r = await rpc<{ id: number; num: string }>("compras_salvar", { p: corpo, p_por: q.email, p_uid: q.uid });
      // liga cada linha da RC à linha da lista, pela ordem
      const { data: itensRc } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: r.id });
      const its = [...(((itensRc ?? {}) as { itens?: { id: number; seq: number }[] }).itens ?? [])].sort((x, y) => x.seq - y.seq);
      for (let k = 0; k < linhas.length && k < its.length; k++) {
        await approval().from("rc_projetos_itens").update({ rc_item_id: its[k].id, vinculo_via: "rc", vinculo_em: new Date().toISOString(), atualizado_por: por })
          .eq("id", linhas[k].id);
      }
      await posGravar(r.id, "RC");
      return NextResponse.json({ ok: true, rc: r.num, id: r.id, linhas: linhas.length });
    }

    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  } catch (e) { return erro(e); }
}
