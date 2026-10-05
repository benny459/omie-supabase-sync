// /api/financeiro/remessa — arquivo de pagamentos em lote do C6 Bank (05/10/26, sql/73).
//
//  POST { acao: "previa", refs }                  → dados de cada título p/ o arquivo (favorecido, CPF/CNPJ,
//                                                   chave Pix / banco-agência-conta / código de barras, previsão)
//  POST { acao: "gerar", modelo, empresa, cod_cc, linhas[], salvar_cadastro? }
//                                                 → valida, preenche o modelo oficial do C6, guarda o arquivo,
//                                                   registra a remessa e marca os títulos "enviado ao banco".
//                                                   Devolve { id, url } (download assinado, 1 h).
//  POST { acao: "salvar_pagamento", pessoa_id, dados } → chave Pix / banco do fornecedor no cadastro
//  POST { acao: "cancelar", id }                  → desfaz a marca "enviado" (o arquivo fica no histórico)
//  GET  ?lista=1                                  → últimas remessas
//  GET  ?id=<n>                                   → link de download de uma remessa
//  GET  ?pagamento=<pessoa_id>                    → chave Pix / banco do fornecedor (cadastro)
//
// Nada é enviado ao banco: o arquivo é baixado e o Benny sobe no portal do C6.
// A baixa continua vindo da conciliação do extrato.
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import { supaAdmin } from "@/lib/supabase-admin";
import { gerarArquivoC6, validarLinha, MODALIDADES_DO_MODELO, type LinhaC6, type Modelo } from "@/lib/c6/remessa-xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "financeiro-remessas";
const REF = /^[op]:\d+$/;
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type Linha = LinhaC6 & { ref: string; pessoa_id?: number | null };

export async function GET(req: Request) {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  const pag = Number(u.searchParams.get("pagamento") ?? 0);
  if (pag) {
    const [d, bs] = await Promise.all([
      supaAdmin().schema("cadastros").from("pessoas_pagamento").select("*").eq("pessoa_id", pag).maybeSingle(),
      fin().from("bancos_ispb").select("compe, ispb, nome").order("nome"),
    ]);
    return NextResponse.json({ dados: d.data ?? null, bancos: bs.data ?? [] });
  }
  const id = Number(u.searchParams.get("id") ?? 0);
  if (id) {
    const { data, error } = await fin().from("remessas").select("arquivo_path, arquivo_nome").eq("id", id).maybeSingle();
    if (error || !data?.arquivo_path) return NextResponse.json({ error: "Remessa não encontrada" }, { status: 404 });
    const { data: s } = await supaAdmin().storage.from(BUCKET).createSignedUrl(data.arquivo_path, 3600, { download: data.arquivo_nome ?? true });
    return NextResponse.json({ url: s?.signedUrl ?? null });
  }
  const { data, error } = await fin().from("remessas")
    .select("id, banco, modelo, empresa, cod_cc, arquivo_nome, n, total, criado_por, criado_em, cancelada_em")
    .order("criado_em", { ascending: false }).limit(30);
  if (error) return erroDb(error);
  return NextResponse.json({ remessas: data });
}

export async function POST(req: Request) {
  let b: { acao?: string; refs?: string[]; modelo?: Modelo; empresa?: string; cod_cc?: number | null; linhas?: Linha[];
           salvar_cadastro?: boolean; pessoa_id?: number; dados?: Record<string, string | null>; id?: number };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const a = await exigir("financeiro.ver_pagar", "financeiro.baixar");
  if (a instanceof NextResponse) return a;

  if (b.acao === "previa") {
    const refs = (b.refs ?? []).filter((r) => REF.test(r));
    if (!refs.length) return NextResponse.json({ error: "Nenhum título" }, { status: 400 });
    const { data, error } = await fin().rpc("remessa_previa", { p_refs: refs });
    return error ? erroDb(error) : NextResponse.json(data);
  }

  if (b.acao === "salvar_pagamento") {
    if (!b.pessoa_id || !b.dados) return NextResponse.json({ error: "pessoa_id e dados obrigatórios" }, { status: 400 });
    const d = b.dados;
    const { error } = await supaAdmin().schema("cadastros").from("pessoas_pagamento").upsert({
      pessoa_id: b.pessoa_id, pix_tipo: d.pix_tipo ?? null, pix_chave: d.pix_chave ?? null,
      banco_compe: d.banco_compe ?? null, agencia: d.agencia ?? null, conta: d.conta ?? null, conta_tipo: d.conta_tipo ?? null,
      titular_nome: d.titular_nome ?? null, titular_doc: d.titular_doc ?? null, atualizado_por: a.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "pessoa_id" });
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }

  if (b.acao === "cancelar") {
    if (!b.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    const { error } = await fin().from("remessas").update({ cancelada_em: new Date().toISOString(), cancelada_por: a.email }).eq("id", b.id).is("cancelada_em", null);
    if (!error) await fin().from("financeiro_audit").insert({ usuario: a.email, acao: "cancelar_remessa", entidade: "remessa", entidade_id: String(b.id), detalhe: {} });
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }

  if (b.acao !== "gerar") return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  const modelo: Modelo = b.modelo === "salarios" ? "salarios" : "contas";
  const linhas = (b.linhas ?? []).filter((l) => REF.test(l.ref));
  if (!linhas.length) return NextResponse.json({ error: "Nenhuma linha" }, { status: 400 });
  const permitidas = MODALIDADES_DO_MODELO[modelo];
  const h = hoje();
  const erros: { ref: string; faltando: string[] }[] = [];
  for (const l of linhas) {
    l.valor = Math.round(Number(l.valor) * 100) / 100;
    const f = validarLinha(l, h);
    if (!permitidas.includes(l.modalidade)) f.push(`modalidade ${l.modalidade} não existe no modelo ${modelo}`);
    if (f.length) erros.push({ ref: l.ref, faltando: f });
  }
  if (erros.length) return NextResponse.json({ error: "Há pagamentos com dados faltando", erros }, { status: 422 });

  let arq: { buf: Buffer; porAba: Record<string, number> };
  try { arq = await gerarArquivoC6(modelo, linhas); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 422 }); }

  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const { data: rem, error: e1 } = await fin().from("remessas").insert({
    banco: "C6", modelo, empresa: b.empresa ?? null, cod_cc: b.cod_cc ?? null, n: linhas.length, total: Math.round(total * 100) / 100, criado_por: a.email,
  }).select("id").single();
  if (e1 || !rem) return erroDb(e1);
  const nome = `C6-${modelo === "salarios" ? "salarios" : "pagamentos"}-${h}-remessa${rem.id}.xlsx`;
  const caminho = `${h.slice(0, 7)}/${nome}`;
  const up = await supaAdmin().storage.from(BUCKET).upload(caminho, arq.buf, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true,
  });
  if (up.error) { await fin().from("remessas").delete().eq("id", rem.id); return NextResponse.json({ error: `Não guardou o arquivo: ${up.error.message}` }, { status: 500 }); }
  const { error: e2 } = await fin().from("remessa_itens").insert(linhas.map((l) => ({
    remessa_id: rem.id, ref: l.ref, modalidade: l.modalidade, favorecido: l.nome, valor: l.valor, data_pagamento: l.data,
    linha: { ...l, pessoa_id: undefined },
  })));
  if (e2) { await fin().from("remessas").delete().eq("id", rem.id); return erroDb(e2); }
  await fin().from("remessas").update({ arquivo_path: caminho, arquivo_nome: nome }).eq("id", rem.id);
  await fin().from("financeiro_audit").insert({ usuario: a.email, acao: "gerar_remessa", entidade: "remessa", entidade_id: String(rem.id),
    detalhe: { modelo, n: linhas.length, total, por_aba: arq.porAba, refs: linhas.map((l) => l.ref) } });

  // Guarda no cadastro do fornecedor a chave Pix / dados bancários usados (se pedido).
  if (b.salvar_cadastro) {
    const vistos = new Set<number>();
    for (const l of linhas) {
      if (!l.pessoa_id || vistos.has(l.pessoa_id) || l.modalidade === "BOLETO") continue;
      vistos.add(l.pessoa_id);
      const dados = l.modalidade === "PIX_CHAVE" ? { pix_chave: l.chave } : { banco_compe: l.compe, agencia: l.agencia, conta: l.conta, conta_tipo: l.contaTipo };
      const { data: atual } = await supaAdmin().schema("cadastros").from("pessoas_pagamento").select("*").eq("pessoa_id", l.pessoa_id).maybeSingle();
      await supaAdmin().schema("cadastros").from("pessoas_pagamento").upsert({ ...(atual ?? {}), pessoa_id: l.pessoa_id, ...dados, atualizado_por: a.email, atualizado_em: new Date().toISOString() }, { onConflict: "pessoa_id" });
    }
  }

  const { data: s } = await supaAdmin().storage.from(BUCKET).createSignedUrl(caminho, 3600, { download: nome });
  return NextResponse.json({ ok: true, id: rem.id, nome, url: s?.signedUrl ?? null, por_aba: arq.porAba, n: linhas.length, total });
}
