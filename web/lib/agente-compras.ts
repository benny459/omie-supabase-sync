// Agente de compras — o lado do servidor (08/10/26, spec F; sql/129).
//
// Monta os lotes de um projeto com a MESMA função da tela (lib/planejamento-compras), a
// partir do banco: itens da lista (sem PC), prazos por fornecedor, recebimentos das vendas e
// os lotes já agendados/gerados. Usado pela rota /api/rc-projetos/lotes e pelo cron diário
// /api/cron/agente-compras, que no dia do lote agendado cria o PC (mesmo caminho do "Gerar
// pedido de compra" da lista) e avisa no Webex. Nada vai ao Omie.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supaAdmin } from "@/lib/supabase-admin";
import { rpc } from "@/lib/compras-server";
import { montar as montarVendas } from "@/lib/vendas-projeto";
import { gerarParcelas, TIPOS_FRETE, type Refs } from "@/lib/compras";
import { gerarPcsDaLista } from "@/lib/lista-gerar-pc";
import { deHtml } from "@/lib/match-pc";
import {
  planejarItem, montarLotes, recebimentosDasVendas, normFornecedor, hojeIso, JANELA_PADRAO_DIAS,
  type ItemLote, type Lote, type LotePersistido, type PrazoFornecedor, type Recebimento,
} from "@/lib/planejamento-compras";

const orders = () => supaAdmin().schema("orders");
const falta = (e: { code?: string; message: string } | null) => !!e && /does not exist|schema cache|PGRST202|42883|42P01/i.test(`${e.code} ${e.message}`);

export async function prazosDaEmpresa(empresa: string): Promise<Map<string, PrazoFornecedor>> {
  const { data, error } = await orders().rpc("fornecedor_prazo_listar", { p_empresa: empresa });
  if (error) return new Map();
  return new Map(((data ?? []) as { fornecedor_norm: string; nome: string | null; historico: number | null; manual: number | null }[])
    .map((r) => [r.fornecedor_norm, { norm: r.fornecedor_norm, nome: r.nome ?? r.fornecedor_norm, historico: r.historico, manual: r.manual }]));
}

/** Lotes persistidos e a janela; `pendente` = sql/129 ainda não aplicada. */
export async function persistidosDoProjeto(empresa: string, codigo: number): Promise<{ janela: number; lotes: LotePersistido[]; pendente: boolean }> {
  const { data, error } = await orders().rpc("lotes_listar", { p_empresa: empresa, p_projeto: codigo });
  if (error) {
    if (falta(error)) return { janela: JANELA_PADRAO_DIAS, lotes: [], pendente: true };
    throw new Error(error.message);
  }
  const d = (data ?? {}) as { janela?: number; lotes?: (LotePersistido & { itens: string[] })[] };
  return { janela: Number(d.janela ?? JANELA_PADRAO_DIAS), lotes: (d.lotes ?? []).map((l) => ({ ...l, data_base: String(l.data_base).slice(0, 10), data_pedir: String(l.data_pedir).slice(0, 10) })), pendente: false };
}

type Linha = { id: string; item: string; qtd: number | null; un: string | null; cat_valor_unit: number | null; cat_fornecedor: string | null;
  data_necessaria: string | null; pc_numero: string | null; pc_item_id: number | null; cat_entrega_dias: number | null; cat_codigo: string | null };

export async function itensDoProjeto(empresa: string, codigo: number, prazos: Map<string, PrazoFornecedor>, hoje = hojeIso()): Promise<ItemLote[]> {
  const { data, error } = await supaAdmin().schema("approval").from("v_rc_projetos_itens")
    .select("id, item, qtd, un, cat_valor_unit, cat_fornecedor, data_necessaria, pc_numero, pc_item_id, cat_entrega_dias, cat_codigo")
    .eq("empresa", empresa).eq("codigo_projeto", codigo);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Linha[]).map((l) => {
    const temPc = !!String(l.pc_numero ?? "").trim() || l.pc_item_id != null;
    const fornecedor = l.cat_fornecedor ? deHtml(l.cat_fornecedor) : null;
    return {
      id: l.id, item: l.item, qtd: Number(l.qtd) || 0, un: l.un ?? "", vu: Number(l.cat_valor_unit) || 0, fornecedor,
      necessario: l.data_necessaria ? String(l.data_necessaria).slice(0, 10) : null, temPc,
      plano: planejarItem({ necessario: l.data_necessaria, temPc, prazoItem: l.cat_entrega_dias, fornecedor, prazos, hoje }),
    };
  });
}

export async function recebimentosDoProjeto(empresa: string, codigo: number): Promise<Recebimento[]> {
  try { return recebimentosDasVendas((await montarVendas(empresa, codigo)).docs); } catch { return []; }
}

export async function lotesDoProjeto(empresa: string, codigo: number, o: { simAgora?: boolean; janela?: number; hoje?: string } = {}) {
  const hoje = o.hoje ?? hojeIso();
  const prazos = await prazosDaEmpresa(empresa);
  const [itens, pers, recebimentos] = await Promise.all([itensDoProjeto(empresa, codigo, prazos, hoje), persistidosDoProjeto(empresa, codigo), recebimentosDoProjeto(empresa, codigo)]);
  const lotes = montarLotes(itens, { janela: o.janela ?? pers.janela, hoje, simAgora: o.simAgora, persistidos: pers.lotes, recebimentos });
  return { lotes, janela: pers.janela, pendente: pers.pendente, persistidos: pers.lotes, itens, recebimentos };
}

/** O PC do lote pelo mesmo caminho do "Gerar pedido de compra" da lista: fornecedor do
 *  cadastro pelo nome (tem que bater), última categoria e condição usadas com ele, previsão =
 *  o "necessário em" mais cedo. Sem fornecedor certo ou sem categoria: não gera, devolve o porquê. */
export async function gerarPcDoLote(empresa: string, codigo: number, lote: Lote, o: { simular: boolean; por: string }):
  Promise<{ ok: true; simulado: boolean; pedidos: { num?: string; id?: number }[]; corpo: Record<string, unknown> } | { ok: false; motivo: string }> {
  if (lote.semFornecedor) return { ok: false, motivo: "lote sem fornecedor provável" };
  const itens = lote.itens.filter((x) => !x.temPc);
  if (!itens.length) return { ok: false, motivo: "todos os itens do lote já têm PC" };
  type Forn = { cod: number; nome: string; fantasia?: string; cnpj?: string; ultCatCod?: string; ultParc?: string; ultContato?: string };
  const ops = await rpc<Forn[]>("compras_buscar_fornecedores", { p_q: lote.forn.slice(0, 30), p_lim: 12, p_empresa: empresa }).catch(() => [] as Forn[]);
  const alvo = normFornecedor(lote.forn);
  const f = ops.find((x) => normFornecedor(x.nome) === alvo || normFornecedor(x.fantasia ?? "") === alvo) ?? null;
  if (!f) return { ok: false, motivo: `fornecedor "${lote.forn}" não achado no cadastro com o mesmo nome — gere pela lista escolhendo o fornecedor` };
  const refs = await rpc<Refs>("compras_refs", { p_empresa: empresa });
  const cat = refs.categorias.find((c) => c.cod === f.ultCatCod);
  if (!cat) return { ok: false, motivo: `sem categoria usada antes com ${f.fantasia || f.nome} — gere pela lista escolhendo a categoria` };
  const parc = refs.parcelas.find((p) => p.cod === f.ultParc) ?? refs.parcelas[0];
  const previsao = lote.primeiroNec || lote.chega;
  const total = Math.round(itens.reduce((a, x) => a + x.qtd * x.vu, 0) * 100) / 100;
  const corpo: Record<string, unknown> = {
    fornCod: f.cod, forn: f.nome, cnpj: f.cnpj ?? null, catCod: cat.cod, cat: cat.desc, comprador: null, compradorCod: null,
    contaCod: null, conta: "", parc: parc?.cod ?? "", previsao, contato: f.ultContato ?? null, numForn: null, contrato: null,
    obs: `Lote do agente de compras (${lote.itens.length} item(ns), pedir ${lote.pedir}). ${lote.motivo.replace(/\*\*/g, "")}`.slice(0, 900),
    frete: { tipo: TIPOS_FRETE[5] }, parcelas: gerarParcelas(total, parc?.dias ?? [0], previsao), deptos: [],
  };
  const r = await gerarPcsDaLista({ empresa, codigo, simular: o.simular, por: o.por, uid: null,
    grupos: [{ corpo, linhas: itens.map((x) => ({ lista_id: x.id, qtd: x.qtd, vu: x.vu })) }] });
  if ("erro" in r) return { ok: false, motivo: r.erro };
  return { ok: true, simulado: o.simular, pedidos: r.pedidos as { num?: string; id?: number }[], corpo };
}

export async function salvarLote(p: Record<string, unknown>, por: string) {
  const { data, error } = await orders().rpc("lotes_salvar", { p, p_por: por });
  if (error) throw new Error(falta(error) ? "Agente de compras ainda não ativado (migração sql/129 pendente)" : error.message);
  return data as { ok: boolean; id?: string };
}

const lista = (v: string | undefined, padrao = "benny@waterworks.com.br") => (v || padrao).split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Aviso no Webex (o canal que o painel já usa para Compras: mensagem direta para as pessoas
 *  de COMPRAS_ALERTA_EMAILS; escalonamento para COMPRAS_ADMIN_EMAILS). Telegram não está
 *  ligado no painel. */
export async function avisarWebex(md: string, para: "compras" | "admin" = "compras"): Promise<{ enviados: number; erros: string[] }> {
  const token = process.env.WEBEX_TOKEN;
  const pessoas = para === "admin" ? lista(process.env.COMPRAS_ADMIN_EMAILS) : lista(process.env.COMPRAS_ALERTA_EMAILS);
  if (!token) return { enviados: 0, erros: ["WEBEX_TOKEN não configurado"] };
  let enviados = 0; const erros: string[] = [];
  for (const e of pessoas) {
    const r = await fetch("https://webexapis.com/v1/messages", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toPersonEmail: e, markdown: md }) }).catch((x) => ({ ok: false, status: String(x) }) as { ok: boolean; status: string | number });
    if (r.ok) enviados++; else erros.push(`webex ${e}: ${r.status}`);
  }
  return { enviados, erros };
}

/** Reescreve o motivo do lote com a Claude (mesma chave do Cesar), SÓ com os fatos do lote.
 *  Se a resposta trouxer uma data ou valor que não está nos fatos, fica o texto do template. */
export async function motivoComIA(lote: Lote): Promise<{ texto: string; ia: boolean }> {
  const chave = process.env.ANTHROPIC_API_KEY;
  const base = lote.motivo.replace(/\*\*/g, "");
  if (!chave) return { texto: base, ia: false };
  const fatos = {
    fornecedor: lote.forn, itens: lote.itens.map((x) => `${x.qtd} ${x.un} ${x.item} (comprar até ${x.plano.comprarAte}, necessário ${x.necessario})`),
    pedir: lote.pedir, base: lote.base, chega: lote.chega, primeiro_necessario: lote.primeiroNec, folga_dias: lote.folga,
    prazo_dias: lote.prazo, prazo_estimado: lote.estimado, valor: lote.valor, caixa: lote.caixaMsg, explicacao_atual: base,
  };
  try {
    const r = await new Anthropic({ apiKey: chave }).messages.create({
      model: process.env.AGENTE_COMPRAS_MODEL || "claude-haiku-4-5", max_tokens: 300,
      messages: [{ role: "user", content: `Reescreva em português do Brasil, em até 2 frases curtas e claras para um comprador, por que este lote de compra deve ser pedido nesta data. Use SOMENTE os fatos abaixo; não invente datas, valores, prazos nem itens. Datas no formato dd/mm.\n\n${JSON.stringify(fatos)}` }],
    });
    const txt = r.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    // trava: toda data dd/mm do texto tem que existir nos fatos
    const dmFatos = new Set(JSON.stringify(fatos).match(/\d{4}-(\d{2})-(\d{2})/g)?.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`) ?? []);
    const dmTxt = txt.match(/\b\d{2}\/\d{2}\b/g) ?? [];
    if (!txt || dmTxt.some((d) => !dmFatos.has(d))) return { texto: base, ia: false };
    return { texto: txt, ia: true };
  } catch { return { texto: base, ia: false }; }
}
