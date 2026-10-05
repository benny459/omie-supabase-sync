// /api/financeiro/pagar — Títulos a Pagar v3 (mockup "contas-a-pagar-v3", 05/10/26).
//
//  GET                       → { hoje, rows, agg, banks, prog, pode } (sql/57 finance.pagar_v3_dados)
//                              rows = títulos em aberto com vencimento em [hoje-180, hoje+90];
//                              fora da janela só agregados por faixa (agg). Linha compacta (array):
//                              0 ref 1 emp 2 venc 3 saldo 4 forn 5 cat 6 proj 7 doc 8 parc 9 conta 10 cod_cc
//                              11 cod_titulo 12 apr 13 pc 14 etapa 15 nf 16 aprov 17 tipo 18 div 19 st 20 cnpj
//                              21 orig 22 valor_doc 23 cod_forn 24 nf_doc 25 fase
//  GET ?baixas=hoje|omie     → baixas do pagar de hoje / de títulos do Omie ainda não enviadas ao Omie
//  GET ?mov=<cod_cc>&de=…    → movimentos do extrato de uma conta, com o que já está casado
//  POST { acao: "baixar", itens: [{ref, valor, cod_cc, desconto?, juros?, multa?, forcar?, obs?}], data, obs?, lote? }
//  POST { acao: "estornar", baixa_id, motivo }
//  POST { acao: "programar", refs, empresa, cod_cc | null }
//  POST { acao: "conciliar", movimento_id, itens: [{ref, valor}] }
//  POST { acao: "ignorar", movimento_id, ignorar, motivo }
//  POST { acao: "desfazer", movimento_id, motivo? }
//  POST { acao: "reprogramar", refs, data: "YYYY-MM-DD" | null, obs? }   (sql/73 — previsão; null = voltar à regra)
//  GET  ?hist=<ref>          → histórico de reprogramação da previsão
//  GET  ?ciclo=<ref>         → ciclo do pagamento (PC → NFs → parcelas → pagamentos), sql/75 finance.pagar_ciclo
//  GET  ?excluidos=1         → títulos que sumiram do Omie e seguem abertos aqui (sql/75)
//  POST { acao: "excluidos_marcar" | "excluidos_desfazer", refs }  (admin / financeiro.editar_titulo)
//  GET também devolve nomes (cod_forn → [fantasia, razão]), catpc (pc → categoria do PC)
//  e excl (refs de títulos já excluídos no Omie ainda por marcar).
//  GET também devolve prev (ref → [previsão efetiva, reprogramada?]), env (ref → remessa ao banco),
//  serie (ref → {id, seq}) e feriados (datas, p/ avisar previsão em dia não útil).
//
// Título do Omie baixado aqui fica PAGO no painel e com omie_status 'nao_enviado' —
// nada é escrito no Omie (a lista sai em ?baixas=omie para baixar lá à mão).
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type Linha = [string, string, string, number, string, string | null, string | null, string | null, string | null,
  string | null, number | null, number | null, string | null, string | null, string | null, string | null,
  string | null, string | null, boolean, string, string, string, number, number | null, string | null, string | null];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Dados da tela + sobreposição das regras de Compras (fase do PC do painel e
 *  "NF sem pedido"), as mesmas que a tela antiga aplicava. */
async function carregar() {
  const ord = supaAdmin().schema("orders");
  const [d, sp, fz] = await Promise.all([
    fin().rpc("pagar_v3_dados", {}),
    ord.rpc("compras_nf_sem_pedido_resumo"),
    ord.rpc("compras_fases_pagar"),
  ]);
  if (d.error) throw d.error;
  const dados = d.data as { hoje: string; rows: Linha[]; agg: unknown; banks: unknown[]; prog: Record<string, number> };

  type NfRef = { cnpj: string; numero: string; chave: string; pedido?: string };
  const semPed = new Set(((sp.data as { nfs?: NfRef[] } | null)?.nfs ?? []).map((n) => `${n.cnpj}|${n.numero}`));
  const aguard = new Set(((sp.data as { aguardando?: NfRef[] } | null)?.aguardando ?? []).map((n) => `${n.cnpj}|${n.numero}`));
  type Fase = { cnpj: string; nf: string; fase: string; pedido: string };
  const fases = new Map(((fz.data as Fase[] | null) ?? []).map((f) => [`${f.cnpj}|${f.nf}`, f]));

  for (const r of dados.rows) {
    if (r[21] !== "o") continue;
    const nf = dig(r[24]).replace(/^0+/, "");
    if (!nf) continue;
    const k = `${dig(r[20])}|${nf}`;
    const f = fases.get(k);
    if (f) {
      r[25] = f.fase;
      r[19] = f.fase === "liberado" ? "ok" : f.fase === "bloqueado" ? "bloq" : "nf";
      if (!r[13]) r[13] = f.pedido;
    }
    if (aguard.has(k)) r[19] = "bloq";
    if (semPed.has(k)) r[19] = "sempc";
  }
  return dados;
}

/** Previsão efetiva (reprogramada ou regra do dia útil), remessas ao banco,
 *  séries de recorrência e feriados (sql/73). */
async function extras() {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [pv, env, se, fe] = await Promise.all([
    fin().rpc("pagar_v3_previsoes", {}),
    fin().rpc("remessa_enviados", {}),
    fin().from("pagar_previsto").select("id, serie_id, serie_seq, parcelas_total").not("serie_id", "is", null).neq("status", "cancelado"),
    fin().rpc("feriados_listar", { p_de: hoje.slice(0, 4) + "-01-01", p_ate: (Number(hoje.slice(0, 4)) + 2) + "-12-31" }),
  ]);
  const serie: Record<string, { id: string; seq: number; n: number | null }> = {};
  for (const x of (se.data ?? []) as { id: number; serie_id: string; serie_seq: number; parcelas_total: number | null }[]) {
    serie["p:" + x.id] = { id: x.serie_id, seq: x.serie_seq, n: x.parcelas_total };
  }
  return {
    prev: (pv.data ?? {}) as Record<string, [string, boolean]>,
    env: (env.data ?? {}) as Record<string, unknown>,
    serie,
    feriados: ((fe.data ?? []) as { data: string; ativo: boolean }[]).filter((f) => f.ativo).map((f) => f.data),
  };
}

/** Pendentes de excluídos no Omie, paginando (o PostgREST corta em 1000 linhas). */
async function excluidosTodos() {
  const out: { ref: string; natureza: string }[] = [];
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await fin().rpc("titulos_excluidos_pendentes", {}).range(de, de + 999);
    if (error) throw error;
    const lote = (data ?? []) as { ref: string; natureza: string }[];
    out.push(...lote);
    if (lote.length < 1000) break;
  }
  return out;
}

/** Nome curto do fornecedor (fantasia) + razão social, categoria herdada do PC
 *  quando o título não tem, e títulos que já sumiram do Omie (sql/75). */
async function nomesECategorias(rows: Linha[]) {
  const cods = [...new Set(rows.map((r) => r[23]).filter((c): c is number => typeof c === "number" && c > 0))];
  const pcs = [...new Set(rows.filter((r) => !r[5] && r[13]).map((r) => String(r[13]).split(",")[0].trim()).filter(Boolean))];
  const [cl, pd, ex] = await Promise.all([
    cods.length ? fin().from("clientes").select("empresa, codigo_cliente_omie, nome_fantasia, razao_social").in("codigo_cliente_omie", cods) : Promise.resolve({ data: [] }),
    pcs.length ? supaAdmin().schema("compras").from("pedidos").select("empresa, numero, categoria_desc").in("numero", pcs) : Promise.resolve({ data: [] }),
    excluidosTodos(),
  ]);
  const nomes: Record<string, [string, string]> = {};
  for (const c of (cl.data ?? []) as { empresa: string; codigo_cliente_omie: number; nome_fantasia: string | null; razao_social: string | null }[]) {
    nomes[`${c.empresa}|${c.codigo_cliente_omie}`] = [(c.nome_fantasia ?? "").trim(), (c.razao_social ?? "").trim()];
  }
  const catpc: Record<string, string> = {};
  for (const p of (pd.data ?? []) as { empresa: string; numero: string; categoria_desc: string | null }[]) {
    if (p.categoria_desc) catpc[`${p.empresa}|${p.numero}`] = p.categoria_desc;
  }
  const excl = ex.filter((x) => x.natureza === "P").map((x) => x.ref);
  return { nomes, catpc, excl };
}

export async function GET(req: Request) {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);

  const baixas = u.searchParams.get("baixas");
  if (baixas) {
    const inicioHoje = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00");
    const { data, error } = await fin().rpc("pagar_v3_baixas", { p_desde: inicioHoje.toISOString(), p_so_omie_pendente: baixas === "omie" });
    if (error) return erroDb(error);
    return NextResponse.json({ baixas: data });
  }

  const hist = u.searchParams.get("hist");
  if (hist) {
    const { data, error } = await fin().rpc("previsao_historico", { p_ref: hist });
    if (error) return erroDb(error);
    return NextResponse.json({ historico: data });
  }

  const ciclo = u.searchParams.get("ciclo");
  if (ciclo) {
    if (!/^[op]:\d+$/.test(ciclo)) return NextResponse.json({ error: "ref inválida" }, { status: 400 });
    const { data, error } = await fin().rpc("pagar_ciclo", { p_ref: ciclo });
    if (error) return erroDb(error);
    return NextResponse.json({ ciclo: data }, { headers: { "Cache-Control": "no-store" } });
  }

  if (u.searchParams.get("excluidos")) {
    try { return NextResponse.json({ excluidos: (await excluidosTodos()).filter((x) => x.natureza === "P") }); }
    catch (e) { return erroDb(e as { message?: string }); }
  }

  const mov = Number(u.searchParams.get("mov") ?? 0);
  if (mov) {
    if (!a.pode["financeiro.conciliar"]) return NextResponse.json({ error: "Sem permissão (financeiro.conciliar)" }, { status: 403 });
    const de = u.searchParams.get("de") ?? "";
    const { data, error } = await fin().rpc("pagar_v3_movimentos", { p_cod_cc: mov, p_de: ISO.test(de) ? de : "2000-01-01" });
    if (error) return erroDb(error);
    return NextResponse.json({ movimentos: data });
  }

  try {
    const [dados, extra] = await Promise.all([carregar(), extras()]);
    const nomes = await nomesECategorias(dados.rows);
    return NextResponse.json({
      ...dados,
      ...extra,
      ...nomes,
      pode: { baixar: !!a.pode["financeiro.baixar"], conciliar: !!a.pode["financeiro.conciliar"], incluir: !!a.pode["financeiro.editar_titulo"] },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return erroDb(e as { message?: string });
  }
}

type Item = { ref?: string; valor?: number; cod_cc?: number | null; desconto?: number; juros?: number; multa?: number; forcar?: boolean; obs?: string };

export async function POST(req: Request) {
  let b: { acao?: string; itens?: Item[]; data?: string | null; obs?: string; lote?: boolean; baixa_id?: number; motivo?: string;
           refs?: string[]; empresa?: string; cod_cc?: number | null; movimento_id?: number; ignorar?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  if (b.acao === "excluidos_marcar" || b.acao === "excluidos_desfazer") {
    const r = await exigir("financeiro.ver_pagar");
    if (r instanceof NextResponse) return r;
    if (!r.pode["financeiro.editar_titulo"]) return NextResponse.json({ error: "Sem permissão (financeiro.editar_titulo)" }, { status: 403 });
    const refs = (b.refs ?? []).filter((x) => /^o:\d+$/.test(x));
    if (!refs.length) return NextResponse.json({ error: "Nenhum título" }, { status: 400 });
    const fn = b.acao === "excluidos_marcar" ? "titulos_excluidos_marcar" : "titulos_excluidos_desfazer";
    const args = b.acao === "excluidos_marcar" ? { p_refs: refs, p_por: r.email, p_motivo: b.motivo ?? "sumiu do Omie (relatório 02/10/2026)" } : { p_refs: refs, p_por: r.email };
    const { data, error } = await fin().rpc(fn, args);
    return error ? erroDb(error) : NextResponse.json({ ok: true, n: data });
  }

  const conc = b.acao === "conciliar" || b.acao === "ignorar" || b.acao === "desfazer";
  // Reprogramar a previsão: quem lança/edita títulos ou quem paga.
  if (b.acao === "reprogramar") {
    const r = await exigir("financeiro.ver_pagar");
    if (r instanceof NextResponse) return r;
    if (!r.pode["financeiro.editar_titulo"] && !r.pode["financeiro.baixar"]) {
      return NextResponse.json({ error: "Sem permissão para reprogramar (financeiro.editar_titulo ou financeiro.baixar)" }, { status: 403 });
    }
    const refs = (b.refs ?? []).filter((x) => /^[op]:\d+$/.test(x));
    if (!refs.length) return NextResponse.json({ error: "Nenhum título" }, { status: 400 });
    if (b.data != null && !ISO.test(b.data)) return NextResponse.json({ error: "data (YYYY-MM-DD) ou null" }, { status: 400 });
    const { data, error } = await fin().rpc("pagar_reprogramar", { p_refs: refs, p_data: b.data ?? null, p_obs: b.obs ?? null, p_usuario: r.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }
  const a = await exigir(conc ? "financeiro.conciliar" : "financeiro.baixar");
  if (a instanceof NextResponse) return a;

  if (b.acao === "estornar") {
    if (!b.baixa_id) return NextResponse.json({ error: "baixa_id obrigatório" }, { status: 400 });
    const { data, error } = await fin().rpc("baixa_estornar", { p_baixa_id: b.baixa_id, p_motivo: b.motivo ?? "", p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (b.acao === "programar") {
    const refs = (b.refs ?? []).filter((r) => /^[op]:\d+$/.test(r));
    if (!refs.length || !b.empresa) return NextResponse.json({ error: "refs e empresa obrigatórios" }, { status: 400 });
    const { data, error } = await fin().rpc("pagar_v3_programar", { p_refs: refs, p_empresa: b.empresa, p_cod_cc: b.cod_cc ?? null, p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (b.acao === "ignorar") {
    if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
    const { data, error } = await fin().rpc("movimento_ignorar", { p_movimento_id: b.movimento_id, p_ignorar: b.ignorar !== false, p_motivo: b.motivo ?? "", p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (b.acao === "desfazer") {
    if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
    const { data, error } = await fin().rpc("conciliacao_desfazer", { p_movimento_id: b.movimento_id, p_motivo: b.motivo ?? "Conciliação desfeita na tela Pagar", p_usuario: a.email });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (b.acao !== "baixar" && b.acao !== "conciliar") return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  const itens = (b.itens ?? []).filter((i) => i.ref && /^[op]:\d+$/.test(i.ref) && Number(i.valor) > 0);
  if (!itens.length) return NextResponse.json({ error: "Nenhum título válido" }, { status: 400 });

  if (b.acao === "conciliar") {
    if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
    // o pagamento já aconteceu no banco: passa mesmo com o título bloqueado (fica marcado no livro)
    const { data: mov } = await fin().from("banco_movimentos").select("data").eq("id", b.movimento_id).maybeSingle();
    const { data, error } = await fin().rpc("pagar_v3_baixar", {
      p_itens: itens.map((i) => ({ ref: i.ref, valor: i.valor, cod_cc: null, forcar: true, obs: "Conciliado pelo extrato" })),
      p_data: (mov as { data?: string } | null)?.data ?? b.data, p_obs: null, p_usuario: a.email, p_lote: false, p_movimento_id: b.movimento_id,
    });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (!b.data || !ISO.test(b.data)) return NextResponse.json({ error: "data (YYYY-MM-DD) obrigatória" }, { status: 400 });

  // status de pagamento recalculado no servidor: bloqueado só passa com "pagar mesmo assim" + justificativa
  let dados;
  try { dados = await carregar(); } catch (e) { return erroDb(e as { message?: string }); }
  const st = new Map(dados.rows.map((r) => [r[0], r[19]]));
  for (const i of itens) {
    const s = st.get(i.ref!);
    if (s && s !== "ok" && s !== "dir" && !(i.forcar && (i.obs ?? b.obs ?? "").trim().length >= 5)) {
      return NextResponse.json({ error: `Título bloqueado para pagar (${s}) — marque "pagar mesmo assim" e justifique` }, { status: 422 });
    }
  }
  const { data, error } = await fin().rpc("pagar_v3_baixar", {
    p_itens: itens, p_data: b.data, p_obs: b.obs ?? null, p_usuario: a.email, p_lote: !!b.lote, p_movimento_id: null,
  });
  return error ? erroDb(error) : NextResponse.json(data);
}
