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
import { fetchItensCp } from "@/lib/crm-fechamento";
import { casarItensProjeto, resolverItensProjeto } from "@/lib/catalogo-projeto";
import { textoCasar, SUG_MIN } from "@/lib/texto-casar";
import { gerarPcsDaLista } from "@/lib/lista-gerar-pc";
import { ponteProjeto } from "@/lib/ponte-pc";

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
  /* ?ponte=1 (09/10/26): o cartão do projeto em Operação › Projetos passa antes pela ponte
     PC → lista (lib/ponte-pc) — compra direta entra na lista e o resumo já a conta. */
  let ponte: Awaited<ReturnType<typeof ponteProjeto>> | null = null;
  if (sp.get("ponte") === "1") {
    try { ponte = await ponteProjeto(empresa, codigo, { por: "ponte PC (Operação)" }); } catch { ponte = null; }
  }
  // 07/10/26: o banco às vezes estoura o statement timeout (refresh das MVs de compras
  // na mesma hora) — tenta de novo duas vezes antes de desistir.
  let { data, error } = await approval().rpc("rc_projetos_compras", { p_empresa: empresa, p_projeto: codigo });
  for (let t = 0; t < 2 && error && /timeout|canceling statement/i.test(error.message); t++) {
    await new Promise((r) => setTimeout(r, 1500));
    ({ data, error } = await approval().rpc("rc_projetos_compras", { p_empresa: empresa, p_projeto: codigo }));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const d = await completarPcs(data as DadosPcs, empresa, codigo);
    return NextResponse.json(ponte ? { ...d, ponte } : d);
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
    ids?: string[]; previsao?: string; simular?: boolean; rc_id?: number;
    grupos?: { corpo: Record<string, unknown>; linhas: { lista_id: string; qtd: number; vu: number }[] }[] };
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

    /* ── RC → lista (07/10/26) ────────────────────────────────────────────────
       RCs do projeto que ainda não estão inteiras na lista. A RC vira ORIGEM da linha
       (rc_item_id) — só rastreio; a lista manda. */
    if (b.acao === "rcs_do_projeto" || b.acao === "importar_rc") {
      const { data: pj } = await supaAdmin().schema("finance").from("projetos").select("nome").eq("empresa", empresa).eq("codigo", codigo).maybeSingle();
      const nomeProj = String((pj as { nome?: string } | null)?.nome ?? "").trim();
      const { data: lst } = await supaAdmin().schema("orders").rpc("compras_lista", { p_desde: null });
      const rcs = ((lst ?? []) as { id: number; tipo: string; num: string; proj?: string | null; valor?: number; nItens?: number; emissao?: string | null }[])
        .filter((x) => x.tipo === "RC" && nomeProj && String(x.proj ?? "").trim() === nomeProj);
      const { data: naLista } = await approval().from("rc_projetos_itens").select("id, rc_item_id, equipamento, item")
        .eq("empresa", empresa).eq("codigo_projeto", codigo);
      const ligados = new Set(((naLista ?? []) as { rc_item_id: number | null }[]).map((r) => Number(r.rc_item_id)).filter(Boolean));
      if (b.acao === "rcs_do_projeto") {
        const out = await Promise.all(rcs.map(async (r) => {
          const { data: full } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: r.id });
          const its = (((full ?? {}) as { itens?: { id: number }[] }).itens ?? []);
          return { id: r.id, num: r.num, valor: Number(r.valor) || 0, emissao: r.emissao ?? null, itens: its.length, na_lista: its.filter((i) => ligados.has(Number(i.id))).length };
        }));
        return NextResponse.json({ rcs: out.filter((r) => r.itens > r.na_lista), todas: out });
      }
      const rc = rcs.find((r) => r.id === Number(b.rc_id));
      if (!rc) return NextResponse.json({ error: "Essa RC não é deste projeto" }, { status: 400 });
      const { data: full } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: rc.id });
      const its = (((full ?? {}) as { itens?: { id: number; cod?: string | null; ncodProd?: number | null; desc: string; un?: string | null; qtd: number; vu?: number | null; obs?: string | null }[] }).itens ?? [])
        .filter((i) => !ligados.has(Number(i.id)));
      const chave = (eq: string, it: string) => `${eq.trim().toLowerCase()}|${it.trim().toLowerCase()}`;
      // equipamento: o da RC (obs "Equip.: X"), senão o da CP do CRM com a mesma descrição
      const eqDaCp = new Map<string, string>();
      try {
        const { itens: cpIts } = await fetchItensCp(codigo);
        for (const c of cpIts) {
          eqDaCp.set(c.item.trim().toLowerCase(), c.equipamento);
          eqDaCp.set([c.item, c.modelo].filter(Boolean).join(" ").trim().toLowerCase(), c.equipamento);
        }
      } catch { /* sem CP: fica "Geral" */ }
      const existentes = new Map(((naLista ?? []) as { id: string; rc_item_id: number | null; equipamento: string; item: string }[])
        .map((r) => [chave(r.equipamento ?? "", r.item ?? ""), r]));
      const novas: Record<string, unknown>[] = [], ligar: { id: string; rc_item_id: number }[] = [];
      const entrar: { i: (typeof its)[number]; eq: string; desc: string }[] = [];
      for (const i of its) {
        const desc = String(i.desc ?? "").trim();
        const eq = /Equip\.?:\s*([^·|]+)/i.exec(i.obs ?? "")?.[1]?.trim() || eqDaCp.get(desc.toLowerCase()) || "Geral";
        if (!desc) continue;
        const ja = existentes.get(chave(eq, desc));
        if (ja) { if (!ja.rc_item_id) ligar.push({ id: ja.id, rc_item_id: Number(i.id) }); continue; }
        entrar.push({ i, eq, desc });
      }
      /* A RC é convertida para a lista (07/10/26, Benny): cada item passa pelo catálogo
         NOSSO — o produto da RC (se já é ou está ligado a um item nosso), senão o texto.
         Só entra com código quando o casamento é certo; o resto fica "sem código"/
         "conferir" na lista para resolver com o seletor. Código da RC que não é nosso
         (CRM/fornecedor/Omie) não vai para a coluna Código — fica na observação. */
      const porProduto = await resolverItensProjeto(empresa, entrar.map((e) => Number(e.i.ncodProd)).filter((x) => x > 0));
      const precisaTexto = entrar.filter((e) => !(e.i.ncodProd && porProduto[String(e.i.ncodProd)]));
      const cas = precisaTexto.length ? await casarItensProjeto(empresa, precisaTexto.map((e) => textoCasar(e.desc)), precisaTexto.map((e) => Number(e.i.vu) || null)) : [];
      const porTexto = new Map(precisaTexto.map((e, k) => [e, cas[k]]));
      let casados = 0;
      for (const e of entrar) {
        const nat = e.i.ncodProd ? porProduto[String(e.i.ncodProd)] : undefined;
        const c = porTexto.get(e);
        const it = nat ?? (c?.status === "ok" ? c.melhor : null);
        if (it) casados++;
        const codRc = String(e.i.cod ?? "").trim();
        novas.push({ empresa, codigo_projeto: codigo, equipamento: e.eq, item: e.desc, qtd: Number(e.i.qtd) || null, un: e.i.un ?? null,
          cat_codigo: it?.codigo ?? null, cat_ncod_prod: it?.ncod_prod ?? null,
          cat_valor_unit: e.i.vu ?? it?.ultimo_preco ?? null, cat_fornecedor: it?.fornecedor ?? null,
          cat_entrega_dias: it?.entrega_dias ?? null, cat_fat_dias: it?.fat_dias ?? null,
          observacao: [`RC ${rc.num}`, codRc && codRc !== it?.codigo ? `cód. na RC ${codRc}` : ""].filter(Boolean).join(" · "),
          rc_item_id: Number(e.i.id), vinculo_via: "rc", vinculo_em: new Date().toISOString(), criado_por: por, atualizado_por: por,
          // provável sem certeza: entra como SUGESTÃO gravada (sql/127) — a grade mostra ✓/✕
          ...(!it && c?.melhor && (c.melhor.score ?? 0) >= SUG_MIN ? { sug_ncod_prod: c.melhor.ncod_prod, sug_codigo: c.melhor.codigo ?? null,
            sug_descricao: c.melhor.descricao ?? null, sug_fornecedor: c.melhor.fornecedor ?? null, sug_score: c.melhor.score ?? null, sug_status: "pendente" } : {}) });
      }
      if (b.simular) return NextResponse.json({ ok: true, simulado: true, rc: rc.num, novas: novas.length, casados, ligadas: ligar.length, linhas: novas });
      if (novas.length) {
        let { error } = await approval().from("rc_projetos_itens").insert(novas);
        // sem a sql/127 as colunas de sugestão não existem: grava sem elas
        if (error && /sug_/.test(error.message)) ({ error } = await approval().from("rc_projetos_itens").insert(novas.map((n) => Object.fromEntries(Object.entries(n).filter(([k]) => !k.startsWith("sug_"))))));
        if (error) throw new Error(error.message);
      }
      for (const l of ligar) await approval().from("rc_projetos_itens").update({ rc_item_id: l.rc_item_id, vinculo_via: "rc", vinculo_em: new Date().toISOString(), atualizado_por: por }).eq("id", l.id);
      return NextResponse.json({ ok: true, rc: rc.num, novas: novas.length, casados, ligadas: ligar.length });
    }

    /* ── Gerar PC pela lista (07/10/26) ──────────────────────────────────────
       Um PC por fornecedor, pelo MESMO caminho da folha de Compras (compras_salvar +
       posGravar: numeração, aprovação, avisos). Cada item do PC já nasce ligado à
       linha da lista (pc_item_id) — e, se a linha veio de uma RC, ao item da RC.
       simular=true: valida e devolve os pedidos que seriam criados, sem gravar. */
    if (b.acao === "gerar_pc") {
      const q = await exigirCompras();
      if (q instanceof NextResponse) return q;
      const grupos = Array.isArray(b.grupos) ? b.grupos : [];
      if (!grupos.length) return NextResponse.json({ error: "Nada para gerar" }, { status: 400 });
      const r = await gerarPcsDaLista({ empresa, codigo, grupos, simular: !!b.simular, por: q.email, uid: q.uid });
      if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
      return NextResponse.json(r);
    }

    /* ── Ponte PC → lista (09/10/26, lib/ponte-pc) ──────────────────────────
       Itens de PC do projeto que nenhuma linha cobre (compra direta) entram na lista
       como origem "PC". simular=true: só diz o que entraria. A grade chama ao abrir. */
    if (b.acao === "ponte_pc") return NextResponse.json(await ponteProjeto(empresa, codigo, { simular: !!b.simular, por: `ponte PC (${por})` }));

    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  } catch (e) { return erro(e); }
}
