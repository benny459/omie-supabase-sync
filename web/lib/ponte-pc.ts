// Ponte PC → Lista de materiais (09/10/26, Benny): "faço direto a compra (PC) linkada ao
// projeto — se o pedido não nasceu da lista, sincroniza sozinho e insere os itens na lista.
// A fonte já não é RC, é PC."
//
// Para um projeto: os itens dos PCs do projeto (approval._projeto_pc_itens — PCs do painel e
// do Omie, sem cancelados/ausentes, a MESMA base do comprometido) que nenhuma linha da lista
// cobre viram linhas novas, ligadas direto ao item (pc_item_id, vinculo_via 'pc_direto',
// origem 'pc'), com 💬 "Item trazido do PC n (compra direta, fora da lista)". A decisão é
// pura (lib/ponte-pc-decidir.ts); aqui ficam a leitura e a gravação.
//
// Roda sozinha: ao gravar um PC com projeto (posGravar, depois da resposta), ao abrir a
// Lista de materiais / o cartão do projeto em Operação › Projetos, e todo dia
// (/api/cron/ponte-pc). Idempotente pelo rastro approval.rc_projetos_pc_ponte (sql/156):
// item já tratado não volta, e a chave primária no item impede duas linhas iguais quando
// duas execuções correm juntas.
//
// PC cancelado: o fluxo de cancelamento (sql/146) desliga as linhas do PC. A linha que a
// PONTE criou só existia por causa daquele PC — desligada, viraria "sem PC" e voltaria a
// somar no projetado como compra a fazer. Por isso a ponte a manda para a lixeira (Itens
// removidos, recuperável), com o motivo; se o cancelamento for desfeito, o item volta.
// Sem a sql/156 aplicada, a ponte não faz nada (responde disponivel:false).
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { lerAjustes } from "@/lib/pc-ajustes";
import { deHtml } from "@/lib/match-pc";
import { fetchItensCp } from "@/lib/crm-fechamento";
import { casarItensProjeto, resolverItensProjeto, type ItemLista } from "@/lib/catalogo-projeto";
import { textoCasar, SUG_MIN } from "@/lib/texto-casar";
import { decidirPonte, linhasDePcCancelado, equipamentoDoItem, itemSemColisao, unitLiquido,
  type ItemPc, type LinhaLista, type Rastro, type Candidato } from "@/lib/ponte-pc-decidir";

const approval = () => supaAdmin().schema("approval");

export type ResultadoPonte = {
  ok: boolean; disponivel: boolean; simulado: boolean; empresa: string; codigo: number;
  itens_pc: number; cobertos: number; inseridos: number; ligados: number; removidos_cancelado: number;
  pulados: Record<string, number>;
  pcs: string[];
  linhas?: Record<string, unknown>[];
  ligacoes?: { lista_id: string; pc: string; pc_item_id: number; descricao: string }[];
  remover?: { lista_id: string; pc: string }[];
  erro?: string;
};

const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n));
const semTabela = (m?: string) => /rc_projetos_pc_ponte|origem/.test(m ?? "") && /exist|column|schema cache|relation/i.test(m ?? "");

export async function ponteProjeto(empresa: string, codigo: number, opts: { simular?: boolean; por?: string } = {}): Promise<ResultadoPonte> {
  const simular = !!opts.simular;
  const por = opts.por || "ponte PC";
  const res: ResultadoPonte = { ok: true, disponivel: true, simulado: simular, empresa, codigo, itens_pc: 0, cobertos: 0,
    inseridos: 0, ligados: 0, removidos_cancelado: 0, pulados: {}, pcs: [] };

  const [pcR, linR, rasR] = await Promise.all([
    approval().rpc("_projeto_pc_itens", { p_empresa: empresa, p_projeto: codigo }),
    approval().from("rc_projetos_itens").select("id, equipamento, item, modelo, cat_codigo, pc_item_id, rc_item_id, pc_numero, origem")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
    approval().from("rc_projetos_pc_ponte").select("pc_item_id, status, lista_id, pc_numero, pedido_id, atualizado_em")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
  ]);
  if (linR.error && semTabela(linR.error.message) || rasR.error && semTabela(rasR.error.message)) return { ...res, disponivel: false };
  if (pcR.error) throw new Error(pcR.error.message);
  if (linR.error) throw new Error(linR.error.message);
  if (rasR.error) throw new Error(rasR.error.message);
  const linhas = (linR.data ?? []) as LinhaLista[];
  let rastroRows = (rasR.data ?? []) as (Rastro & { pedido_id: number | null; atualizado_em?: string })[];
  /* reserva que ficou sem linha (a execução caiu entre reservar e inserir): passados 10 min,
     solta — o item volta a ser tratado na próxima passada */
  const presas = rastroRows.filter((r) => r.status === "inserido" && !r.lista_id && Date.now() - Date.parse(r.atualizado_em ?? "") > 600_000);
  if (presas.length && !simular) {
    await approval().from("rc_projetos_pc_ponte").delete().in("pc_item_id", presas.map((r) => r.pc_item_id)).is("lista_id", null);
    rastroRows = rastroRows.filter((r) => !presas.includes(r));
  }
  const rastro = new Map(rastroRows.map((r) => [Number(r.pc_item_id), r]));
  const brutos = (pcR.data ?? []) as { pc_item_id: number; pedido_id: number; numero: string; fornecedor: string | null; previsao: string | null;
    produto_cod: string | null; descricao: string | null; unidade: string | null; qtd: number | null; valor_unit: number | null; valor: number | null }[];
  res.itens_pc = brutos.length;

  // ncod_prod e observação do item (o _projeto_pc_itens não traz)
  const extra = new Map<number, { ncod_prod: number | null; obs: string | null }>();
  for (const ids of chunks(brutos.map((b) => Number(b.pc_item_id)))) {
    const { data } = await supaAdmin().schema("compras").from("itens").select("id, ncod_prod, obs").in("id", ids);
    for (const x of (data ?? []) as { id: number; ncod_prod: number | null; obs: string | null }[]) extra.set(Number(x.id), x);
  }
  const itens: ItemPc[] = brutos.map((b) => ({
    pc_item_id: Number(b.pc_item_id), pedido_id: Number(b.pedido_id), numero: String(b.numero), produto_cod: b.produto_cod,
    ncod_prod: extra.get(Number(b.pc_item_id))?.ncod_prod ?? null, obs: extra.get(Number(b.pc_item_id))?.obs ?? null,
    descricao: deHtml(String(b.descricao ?? "")).trim(), unidade: b.unidade, qtd: Number(b.qtd) || 0,
    valor_unit: Number(b.valor_unit) || 0, valor: Number(b.valor) || 0, previsao: b.previsao,
    fornecedor: b.fornecedor ? deHtml(b.fornecedor) : null,
  }));

  const numeros = [...new Set([...itens.map((i) => i.numero), ...rastroRows.map((r) => String(r.pc_numero))])];
  const rcIds = [...new Set(linhas.map((l) => Number(l.rc_item_id)).filter(Boolean))];
  const [viaRcR, excR, ajustes] = await Promise.all([
    rcIds.length ? supaAdmin().schema("compras").from("item_rc").select("pc_item_id, rc_item_id").in("rc_item_id", rcIds) : Promise.resolve({ data: [] }),
    numeros.length ? supaAdmin().schema("platform").from("excluded_pc").select("pc_numero, tipo").eq("empresa", empresa).in("pc_numero", numeros) : Promise.resolve({ data: [] }),
    numeros.length ? lerAjustes({ empresa, numeros }) : Promise.resolve({ cancelados: [], devolucoes: [] }),
  ]);
  const viaRc = new Set(((viaRcR.data ?? []) as { pc_item_id: number }[]).map((x) => Number(x.pc_item_id)));
  const exc = (excR.data ?? []) as { pc_numero: string; tipo?: string | null }[];
  const escondidos = new Set(exc.map((x) => String(x.pc_numero)));
  const devolvido = new Map<number, number>();
  for (const d of ajustes.devolucoes) {
    if (d.desfeito_em) continue;
    for (const it of d.itens ?? []) devolvido.set(Number(it.pc_item_id), (devolvido.get(Number(it.pc_item_id)) ?? 0) + (Number(it.qtd) || 0));
  }

  // ── PC cancelado: a linha que a ponte criou vai para a lixeira ──────────────
  const cancelados = new Set(exc.filter((x) => x.tipo === "cancelado").map((x) => String(x.pc_numero)));
  const pedRastro = [...new Set(rastroRows.filter((r) => r.status === "inserido").map((r) => Number(r.pedido_id)).filter(Boolean))];
  if (pedRastro.length) {
    const { data } = await supaAdmin().schema("compras").from("pedidos").select("numero, cancelado").in("id", pedRastro);
    for (const p of (data ?? []) as { numero: string; cancelado: boolean }[]) if (p.cancelado) cancelados.add(String(p.numero));
  }
  const remover = linhasDePcCancelado({ rastro: rastroRows, linhas, cancelados });
  res.remover = remover.map((r) => ({ lista_id: r.lista_id, pc: r.pc_numero }));
  if (remover.length && !simular) res.removidos_cancelado = await removerLinhas(empresa, codigo, remover, por);

  // ── O que entra ─────────────────────────────────────────────────────────────
  let dec = decidirPonte({ itens, linhas, viaRc, escondidos, devolvido, rastro });
  if (dec.inserir.length) {
    // há o que entrar: antes, o casamento automático com as linhas SEM PC (não duplica o item)
    const { data: al } = await approval().rpc("rc_projetos_autolink", { p_empresa: empresa, p_projeto: codigo, p_aplicar: false, p_por: por });
    const candidatos = ((al as { casamentos?: Candidato[] } | null)?.casamentos ?? []).map((c) => ({ ...c, pc_item_id: Number(c.pc_item_id) }));
    dec = decidirPonte({ itens, linhas, viaRc, escondidos, devolvido, rastro, candidatos });
  }
  res.cobertos = dec.cobertos.length;
  for (const p of dec.pulados) res.pulados[p.por] = (res.pulados[p.por] ?? 0) + 1;
  res.pcs = [...new Set([...dec.inserir.map((i) => i.numero), ...dec.ligar.map((l) => l.item.numero)])].sort();
  res.ligacoes = dec.ligar.map((l) => ({ lista_id: l.lista_id, pc: l.item.numero, pc_item_id: l.item.pc_item_id, descricao: l.item.descricao }));
  if (!dec.inserir.length && !dec.ligar.length) return res;

  const novas = dec.inserir.length ? await montarLinhas(empresa, codigo, dec.inserir, linhas, por) : [];
  if (simular) { res.inseridos = novas.length; res.ligados = dec.ligar.length; res.linhas = novas; return res; }

  // ── Ligar (linha sem PC que já era este item) ──────────────────────────────
  for (const l of dec.ligar) {
    if (!(await reservar(empresa, codigo, l.item, "ligado", l.lista_id, por))) continue;
    const { data, error } = await approval().from("rc_projetos_itens").update({
      pc_item_id: l.item.pc_item_id, pc_numero: l.item.numero, vinculo_via: "pc_direto", vinculo_score: null,
      vinculo_em: new Date().toISOString(), atualizado_por: por, atualizado_em: new Date().toISOString(),
    }).eq("id", l.lista_id).is("pc_item_id", null).is("rc_item_id", null).select("id");
    if (error || !data?.length) { await soltar(l.item.pc_item_id); continue; }
    res.ligados++;
    await nota(l.lista_id, `Ligado ao PC ${l.item.numero} (compra direta) — o item do pedido é esta linha`);
  }

  // ── Inserir ────────────────────────────────────────────────────────────────
  for (const lote of chunks(novas, 100)) {
    const meus: Record<string, unknown>[] = [];
    for (const n of lote) {
      const it = dec.inserir.find((i) => i.pc_item_id === n.pc_item_id)!;
      if (await reservar(empresa, codigo, it, "inserido", null, por)) meus.push(n);
    }
    if (!meus.length) continue;
    let { data, error } = await approval().from("rc_projetos_itens").insert(meus).select("id, pc_item_id");
    if (error && /sug_/.test(error.message)) {
      ({ data, error } = await approval().from("rc_projetos_itens")
        .insert(meus.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("sug_"))))).select("id, pc_item_id"));
    }
    if (error) { for (const m of meus) await soltar(Number(m.pc_item_id)); throw new Error(error.message); }
    for (const r of (data ?? []) as { id: string; pc_item_id: number }[]) {
      res.inseridos++;
      const num = String(meus.find((m) => Number(m.pc_item_id) === Number(r.pc_item_id))?.pc_numero ?? "");
      await approval().from("rc_projetos_pc_ponte").update({ lista_id: r.id, atualizado_em: new Date().toISOString() }).eq("pc_item_id", r.pc_item_id);
      await nota(r.id, `Item trazido do PC ${num} (compra direta, fora da lista)`);
    }
  }
  return res;
}

/** Marca o item no rastro (idempotência). false = outra execução já tratou o item. */
async function reservar(empresa: string, codigo: number, i: ItemPc, status: "inserido" | "ligado", listaId: string | null, por: string): Promise<boolean> {
  const linha = { pc_item_id: i.pc_item_id, empresa, codigo_projeto: codigo, pedido_id: i.pedido_id, pc_numero: i.numero,
    lista_id: listaId, status, por, atualizado_em: new Date().toISOString() };
  const { data, error } = await approval().from("rc_projetos_pc_ponte").upsert(linha, { onConflict: "pc_item_id", ignoreDuplicates: true }).select("pc_item_id");
  if (error) throw new Error(error.message);
  if (data?.length) return true;
  // já no rastro: só volta se foi removido por cancelamento (o cancelamento foi desfeito)
  const { data: up } = await approval().from("rc_projetos_pc_ponte").update(linha).eq("pc_item_id", i.pc_item_id)
    .eq("status", "removido_cancelado").select("pc_item_id");
  return !!up?.length;
}
async function soltar(pcItemId: number) {
  await approval().from("rc_projetos_pc_ponte").delete().eq("pc_item_id", pcItemId).is("lista_id", null);
}
async function nota(listaId: string, texto: string) {
  await approval().from("rc_projetos_itens_comentarios").insert({ item_id: listaId, autor: "sistema (ponte PC)", texto, origem: "ponte_pc" });
}

/** Linhas novas: item do catálogo NOSSO quando o casamento é certo (o produto do PC já é /
 *  está ligado a um item nosso, ou o texto casa com de-para/nome); senão o texto do PC, com
 *  o código do pedido na observação e a sugestão gravada para ✓/✕ na grade. */
async function montarLinhas(empresa: string, codigo: number, entrar: (ItemPc & { qtd_liquida: number })[], linhas: LinhaLista[], por: string) {
  const porProduto = await resolverItensProjeto(empresa, entrar.map((e) => Number(e.ncod_prod)).filter((x) => x > 0)).catch(() => ({} as Record<string, ItemLista>));
  const precisa = entrar.filter((e) => !(e.ncod_prod && porProduto[String(e.ncod_prod)]));
  const cas = precisa.length ? await casarItensProjeto(empresa, precisa.map((e) => textoCasar(e.descricao)), precisa.map((e) => unitLiquido(e) || null)).catch(() => []) : [];
  const porTexto = new Map(precisa.map((e, k) => [e.pc_item_id, cas[k]]));
  // equipamento da RC/CP com a mesma descrição (CRM fora do ar: "Compras diretas")
  const daCp = new Map<string, string>();
  try {
    const { itens: cp } = await Promise.race([fetchItensCp(codigo),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tempo")), 6000))]);
    for (const c of cp) {
      daCp.set(c.item.trim().toLowerCase(), c.equipamento);
      daCp.set([c.item, c.modelo].filter(Boolean).join(" ").trim().toLowerCase(), c.equipamento);
    }
  } catch { /* sem CP */ }
  const ocupadas = new Set(linhas.map((l) => `${String(l.equipamento ?? "").trim().toLowerCase()}\x01${String(l.item ?? "").trim().toLowerCase()}`));
  const agora = new Date().toISOString();
  return entrar.map((e) => {
    const nat = e.ncod_prod ? porProduto[String(e.ncod_prod)] : undefined;
    const c = porTexto.get(e.pc_item_id);
    const it = nat ?? (c?.status === "ok" ? c.melhor : null);
    const eq = equipamentoDoItem(e, daCp);
    const desc = e.descricao || `Item do PC ${e.numero}`;
    const cod = String(e.produto_cod ?? "").trim();
    return {
      empresa, codigo_projeto: codigo, equipamento: eq, item: itemSemColisao(desc, e.numero, eq, ocupadas),
      qtd: e.qtd_liquida || null, un: e.unidade ? String(e.unidade).trim().slice(0, 10).toUpperCase() : null,
      cat_codigo: it?.codigo ?? null, cat_ncod_prod: it?.ncod_prod ?? null,
      cat_valor_unit: unitLiquido(e) || null, cat_fornecedor: e.fornecedor || it?.fornecedor || null,
      cat_entrega_dias: it?.entrega_dias ?? null, cat_fat_dias: it?.fat_dias ?? null,
      data_necessaria: e.previsao ? String(e.previsao).slice(0, 10) : null,
      observacao: [`PC ${e.numero} (compra direta)`, cod && cod !== it?.codigo ? `cód. no PC ${cod}` : "",
        e.qtd_liquida < e.qtd ? `devolvido ${Math.round((e.qtd - e.qtd_liquida) * 100) / 100} de ${e.qtd}` : ""].filter(Boolean).join(" · "),
      pc_item_id: e.pc_item_id, pc_numero: e.numero, vinculo_via: "pc_direto", vinculo_em: agora, origem: "pc",
      criado_por: por, atualizado_por: por,
      ...(!it && c?.melhor && (c.melhor.score ?? 0) >= SUG_MIN ? { sug_ncod_prod: c.melhor.ncod_prod, sug_codigo: c.melhor.codigo ?? null,
        sug_descricao: c.melhor.descricao ?? null, sug_fornecedor: c.melhor.fornecedor ?? null, sug_score: c.melhor.score ?? null, sug_status: "pendente" } : {}),
    } as Record<string, unknown>;
  });
}

/** Linhas da ponte cujo PC foi cancelado → lixeira (recuperável em "Itens removidos"). */
async function removerLinhas(empresa: string, codigo: number, rem: { lista_id: string; pc_item_id: number; pc_numero: string }[], por: string) {
  const ids = rem.map((r) => r.lista_id);
  const { data: rows } = await approval().from("rc_projetos_itens").select("*").in("id", ids).eq("origem", "pc");
  const linhas = (rows ?? []) as Record<string, unknown>[];
  if (!linhas.length) return 0;
  const pcDe = new Map(rem.map((r) => [r.lista_id, r.pc_numero]));
  const { error: e1 } = await approval().from("rc_projetos_itens_lixeira").insert(linhas.map((r) => ({
    item_id: r.id, empresa, codigo_projeto: codigo, equipamento: r.equipamento, item: r.item, item_norm: r.item_norm,
    qtd: r.qtd, modelo: r.modelo, observacao: r.observacao, pc_numero: r.pc_numero ?? pcDe.get(String(r.id)) ?? null,
    criado_em: r.criado_em, criado_por: r.criado_por, cat_ncod_prod: r.cat_ncod_prod, cat_codigo: r.cat_codigo,
    cat_valor_unit: r.cat_valor_unit, cat_fornecedor: r.cat_fornecedor, cat_entrega_dias: r.cat_entrega_dias, cat_fat_dias: r.cat_fat_dias,
    apagado_por: por, apagado_por_upload: `PC ${pcDe.get(String(r.id)) ?? ""} cancelado — a linha tinha vindo só dele (compra direta, ponte PC)`,
  })));
  if (e1) return 0; // sem arquivar, não apaga
  const { error: e2, count } = await approval().from("rc_projetos_itens").delete({ count: "exact" }).in("id", linhas.map((r) => String(r.id)));
  if (e2) return 0;
  for (const r of rem) {
    if (!linhas.some((l) => String(l.id) === r.lista_id)) continue;
    await approval().from("rc_projetos_pc_ponte").update({ status: "removido_cancelado", lista_id: null, atualizado_em: new Date().toISOString(), por })
      .eq("pc_item_id", r.pc_item_id);
  }
  return count ?? linhas.length;
}

/** Depois de gravar um PC no Compras: a ponte do projeto dele (só PC com projeto). */
export async function pontePedido(pedidoId: number, por?: string): Promise<ResultadoPonte | null> {
  const { data } = await supaAdmin().schema("compras").from("pedidos").select("empresa, tipo, numero, projeto_cod").eq("id", pedidoId).maybeSingle();
  const p = data as { empresa: string; tipo: string; numero: string; projeto_cod: number | null } | null;
  if (!p || p.tipo !== "PC" || !p.projeto_cod) return null;
  return ponteProjeto(p.empresa, Number(p.projeto_cod), { por: por ?? `ponte (PC ${p.numero})` });
}

