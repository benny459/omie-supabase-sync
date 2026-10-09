import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { buscar, urlArquivo, type Emissao } from "@/lib/faturamento/server";
import { emitenteLocal } from "@/lib/faturamento/danfe-previa";
import { dadosConta, instrucaoPagamento } from "@/lib/faturamento/lote";
import { BUCKET_FAT, documentoGuardado, nomePdf, pdfComCache } from "@/lib/faturamento/recibo-doc";
import { ocResumo } from "@/lib/vendas-anexos-server";
import { emailConfigurado, emailOk, enviarResend, lista, novoMessageId, resendGet, soParaLista } from "@/lib/compras-email";
import {
  assuntoEnvio, copiaOculta, corpoEnvio, destinatariosCliente, nomesAnexos,
  type ModeloEnvio, type TipoEnvio, type Vencimento,
} from "@/lib/faturamento/envio-modelo";

// "Enviar ao cliente" do Faturamento (09/10/26), no molde do envio do pedido de compra:
// Para (e-mails do cadastro do cliente) / Cc / Cco, assunto e texto editáveis, anexo extra,
// DANFE+XML, recibo em PDF ou o PDF/XML da NFS-e registrada (+ boletos, se houver).
// Corpo com vencimentos, OC do cliente e os dados de pagamento (envio-modelo.ts).
// Sai pelo e-mail da plataforma (Resend). Nada é enviado sozinho — só no clique.
// Cópia oculta = caixa do faturamento + quem enviou; "responder para" = quem enviou.
// O envio (ou o "marcar como enviado" por outro caminho) fica em orders.fat_envios
// e marca a emissão (enviado_em) — sem isso ela aparece como "✉ não enviado".
//
// Alvo: emissão do painel (orders.fat_emissoes, NF-e/recibo) ou NFS-e registrada
// (orders.fat_nfse_manual) — esta precisa da sql/157.

/** Remetente do faturamento (o domínio waterworks.com.br já está validado no Resend). */
// Como o Omie fazia (noreply@omie.com.br com contasareceber@ em cópia): sai do noreply@waterworks
// (Benny, 09/10/26); "responder para" = quem enviou, e o contasareceber@ e quem enviou ficam com a
// cópia oculta de todo envio.
export const remetenteFat = () => process.env.FATURAMENTO_EMAIL_REMETENTE || "WaterWorks Faturamento <noreply@waterworks.com.br>";
export const ccoFixoFat = () => lista(process.env.FATURAMENTO_EMAIL_CCO_FIXO ?? "contasareceber@waterworks.com.br").map((x) => x.toLowerCase());

export type Alvo = { tipo: "emissao" | "nfse"; id: number };
export function alvoDe(o: { id?: unknown; nfse?: unknown }): Alvo {
  const n = Number(o.nfse);
  if (Number.isFinite(n) && n > 0) return { tipo: "nfse", id: n };
  const e = Number(o.id);
  if (Number.isFinite(e) && e > 0) return { tipo: "emissao", id: e };
  throw new Error("Informe o documento (id da emissão ou da NFS-e)");
}

export const MSG_MIGRACAO = "Migração pendente (sql/157_fat_envios_nfse.sql): envio da NFS-e registrada ainda não está ligado";
const semColuna = (m?: string) => /nfse_id|enviado_em|does not exist|schema cache/i.test(m ?? "");

const db = () => supaAdmin().schema("orders");
const fat = () => db().from("fat_envios");

async function baixar(path: string) {
  const { data, error } = await supaAdmin().storage.from(BUCKET_FAT).download(path);
  if (error || !data) throw new Error(`Arquivo não encontrado (${path})`);
  return Buffer.from(await data.arrayBuffer());
}

type ReceberLinha = { vencimento: string | null; valor: number | null; extras: Record<string, unknown> | null };
async function receberDe(ids: string[] | null | undefined): Promise<ReceberLinha[]> {
  if (!ids?.length) return [];
  const { data } = await supaAdmin().schema("finance").from("receber").select("vencimento, valor, extras").in("id", ids);
  return ((data ?? []) as ReceberLinha[]).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
}

/** OC do cliente do PV/OS de origem (OC do painel, ou a do Omie). */
async function ocDe(empresa: string, rotulos: (string | null | undefined)[]) {
  const ls = rotulos.map((r) => String(r ?? "").trim().toUpperCase()).filter((r) => /^(PV|OS)\d+$/.test(r));
  if (!ls.length) return null;
  try {
    const { rows } = await ocResumo(empresa, ls);
    const ocs = [...new Set(rows.map((r) => r.num_pedido_cliente?.trim()).filter(Boolean))] as string[];
    return ocs.length ? ocs.join(", ") : null;
  } catch { return null; }
}

/** E-mails do cadastro do cliente (cadastros.pessoas: e-mail de NF-e, e-mail). */
async function emailsCadastro(empresa: string, codigo: unknown, doc: unknown): Promise<string[]> {
  const cod = Number(codigo);
  const d = String(doc ?? "").replace(/\D/g, "");
  if (!(cod > 0) && d.length < 11) return [];
  const { data } = await db().rpc("compras_fornecedor_pessoa", { p_empresa: empresa, p_cod: cod > 0 ? cod : null, p_cnpj: d || null });
  const p = data as { email?: string | null; emailNfe?: string | null } | null;
  return [...lista(p?.emailNfe), ...lista(p?.email)];
}

/** Tudo o que o envio precisa saber de um documento, emissão ou NFS-e. */
type Base = {
  alvo: Alvo; empresa: string; modelo: ModeloEnvio; status: string; podeEnviar: string | null;
  emailsGravados: string[]; codigoCliente: unknown; docCliente: unknown;
  pdf_path: string | null; xml_path: string | null; recibo: boolean; boletos: string[];
  enviado_em: string | null; enviado_para: string[] | null; enviado_por: string | null;
};

async function carregar(alvo: Alvo): Promise<Base> {
  if (alvo.tipo === "nfse") return carregarNfse(alvo);
  const e = await buscar(alvo.id) as Emissao & { enviado_em?: string | null; enviado_para?: string[] | null; enviado_por?: string | null };
  const c = (e.cliente ?? {}) as { email?: string | null; nome?: string; cnpj?: string | null; cpf?: string | null; codigo?: unknown; codigo_cliente?: unknown };
  const cond = (e.condicao ?? {}) as { parcelas?: { vencimento?: string; valor?: number }[]; forma_recebimento?: string | null; instrucao_pagamento?: string | null; conta_corrente?: number | null };
  const rec = await receberDe(e.receber_ids);
  const vencimentos: Vencimento[] = rec.length
    ? rec.map((r) => ({ vencimento: String(r.vencimento ?? ""), valor: Number(r.valor ?? 0) }))
    : (cond.parcelas ?? []).filter((p) => p.vencimento).map((p) => ({ vencimento: String(p.vencimento), valor: Number(p.valor ?? 0) }));
  let instrucao = cond.instrucao_pagamento || (rec.find((r) => r.extras?.instrucao)?.extras?.instrucao as string | undefined) || "";
  if (!instrucao && cond.conta_corrente) {
    instrucao = instrucaoPagamento(["TRA", cond.forma_recebimento ?? ""], await dadosConta(e.empresa, cond.conta_corrente).catch(() => null));
  }
  const boletos = rec.map((r) => r.extras?.boleto_pdf_path).filter((p): p is string => typeof p === "string" && !!p);
  const recibo = !!e.pdf_path && /\.html?$/i.test(e.pdf_path);
  const doc: TipoEnvio = e.tipo === "nfe" ? "NF-e" : e.tipo === "nfse" ? "NFS-e" : "Recibo";
  const emitente = await emitenteLocal(e.empresa).then((x) => x.nome || "").catch(() => "");
  const podeEnviar = e.status !== "autorizada" ? "Só documento autorizado vai ao cliente"
    : e.ambiente !== "producao" || e.ensaio ? "Documento de homologação/ensaio — não vai ao cliente (a prévia funciona)" : null;
  return {
    alvo, empresa: e.empresa, status: e.status, podeEnviar,
    modelo: {
      doc, numero: String(e.numero ?? ""), cliente: c.nome ?? "", emitente, origem: e.origem_rotulo ?? null,
      oc: await ocDe(e.empresa, [e.origem_rotulo]), valor: Number(e.valor_total ?? 0), chave: e.chave ?? null,
      vencimentos, forma: cond.forma_recebimento ?? (rec[0]?.extras?.forma as string | undefined) ?? null, instrucao: instrucao || null,
      boleto: boletos.length > 0,
    },
    emailsGravados: lista(c.email), codigoCliente: c.codigo ?? c.codigo_cliente ?? null, docCliente: c.cnpj || c.cpf || null,
    pdf_path: e.pdf_path, xml_path: e.xml_path, recibo, boletos,
    enviado_em: e.enviado_em ?? null, enviado_para: e.enviado_para ?? null, enviado_por: e.enviado_por ?? null,
  };
}

type NfseLinha = {
  id: number; empresa: string; municipio: string; numero: string; status: string; valor_servicos: number; valor_liquido: number;
  tomador_codigo: number | null; tomador_nome: string | null; tomador_doc: string | null; os: { rotulo: string }[] | null;
  parcelas: { vencimento: string; valor: number }[] | null; receber_ids: string[] | null; pdf_path: string | null; xml_path: string | null;
  enviado_em?: string | null; enviado_para?: string[] | null; enviado_por?: string | null;
};
async function carregarNfse(alvo: Alvo): Promise<Base> {
  const { data, error } = await db().from("fat_nfse_manual").select("*").eq("id", alvo.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("NFS-e registrada não encontrada");
  const n = data as NfseLinha;
  const rec = await receberDe(n.receber_ids);
  const vencimentos: Vencimento[] = rec.length
    ? rec.map((r) => ({ vencimento: String(r.vencimento ?? ""), valor: Number(r.valor ?? 0) }))
    : (n.parcelas ?? []).map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) }));
  const rotulos = (n.os ?? []).map((o) => o.rotulo).filter(Boolean);
  const emitente = await emitenteLocal(n.empresa).then((x) => x.nome || "").catch(() => "");
  const boletos = rec.map((r) => r.extras?.boleto_pdf_path).filter((p): p is string => typeof p === "string" && !!p);
  const migrada = "enviado_em" in n;
  return {
    alvo, empresa: n.empresa, status: n.status,
    podeEnviar: n.status !== "registrada" ? "NFS-e cancelada — não vai ao cliente" : !migrada ? MSG_MIGRACAO : null,
    modelo: {
      doc: "NFS-e", numero: n.numero, cliente: n.tomador_nome ?? "", emitente, origem: rotulos.join(", ") || null,
      oc: await ocDe(n.empresa, rotulos), valor: Number(n.valor_servicos ?? 0), liquido: Number(n.valor_liquido ?? n.valor_servicos ?? 0),
      vencimentos, forma: (rec[0]?.extras?.forma as string | undefined) ?? null,
      instrucao: (rec.find((r) => r.extras?.instrucao)?.extras?.instrucao as string | undefined) ?? null,
      municipio: n.municipio, boleto: boletos.length > 0,
    },
    emailsGravados: [], codigoCliente: n.tomador_codigo, docCliente: n.tomador_doc,
    pdf_path: n.pdf_path, xml_path: n.xml_path, recibo: false, boletos,
    enviado_em: n.enviado_em ?? null, enviado_para: n.enviado_para ?? null, enviado_por: n.enviado_por ?? null,
  };
}

/** Dados para a janela de envio: destinatários sugeridos, assunto padrão, arquivos e situação. */
export async function dadosEnvio(alvo: Alvo, eu: string) {
  const b = await carregar(alvo);
  const cadastro = await emailsCadastro(b.empresa, b.codigoCliente, b.docCliente).catch(() => []);
  const m = b.modelo;
  return {
    alvo, id: alvo.tipo === "emissao" ? alvo.id : null, nfse: alvo.tipo === "nfse" ? alvo.id : null,
    doc: m.doc, numero: m.numero, cliente: m.cliente, origem: m.origem ?? null, chave: m.chave ?? null, valor: m.valor,
    modelo: m,
    autorizada: !b.podeEnviar, bloqueio: b.podeEnviar,
    para: destinatariosCliente([cadastro, b.emailsGravados], [...ccoFixoFat()]),
    emitente: m.emitente ?? "",
    assunto: assuntoEnvio(m),
    arquivos: nomesAnexos(m.doc, m.numero, { pdf: !!b.pdf_path, xml: !!b.xml_path, boletos: b.boletos.length }),
    pdf: b.recibo ? `/api/faturamento/recibo-pdf?p=${encodeURIComponent(b.pdf_path!)}` : await urlArquivo(b.pdf_path),
    configurado: emailConfigurado(), soPara: soParaLista(), eu, remetente: remetenteFat(), ccoFixo: ccoFixoFat(),
    historico: await historico(alvo),
    enviadoEm: b.enviado_em, enviadoPara: b.enviado_para, enviadoPor: b.enviado_por,
  };
}

const limpaLista = (v: unknown) => lista(v).map((x) => x.toLowerCase());
type Opcoes = { para?: unknown; cc?: unknown; cco?: unknown; assunto?: string; texto?: string; anexo?: { nome: string; base64: string } | null };

/** Monta o e-mail final (destinatários, assunto, corpo e anexos) sem enviar. */
async function montar(alvo: Alvo, quem: string, o: Opcoes, modo: "envio" | "previa" | "prova") {
  const b = await carregar(alvo);
  const m = b.modelo;
  const sugeridos = o.para != null ? null : destinatariosCliente([await emailsCadastro(b.empresa, b.codigoCliente, b.docCliente).catch(() => []), b.emailsGravados], ccoFixoFat());
  const para = o.para != null ? limpaLista(o.para) : sugeridos!;
  const cc = limpaLista(o.cc), cco = limpaLista(o.cco);
  const ruim = [...para, ...cc, ...cco].find((x) => !emailOk(x));
  if (ruim) throw new Error(`E-mail inválido: ${ruim}`);

  const anexos: { filename: string; content: string }[] = [];
  const nomes = nomesAnexos(m.doc, m.numero, { pdf: true, xml: true, boletos: b.boletos.length });
  if (b.pdf_path && b.recibo) {
    const html = await documentoGuardado(b.pdf_path);
    if (!html) throw new Error("Recibo não encontrado");
    anexos.push({ filename: nomePdf(html, `Recibo ${m.numero}`), content: Buffer.from(await pdfComCache(html, b.pdf_path)).toString("base64") });
  } else if (b.pdf_path) {
    anexos.push({ filename: nomes[0], content: (await baixar(b.pdf_path)).toString("base64") });
  }
  if (b.xml_path) anexos.push({ filename: `${m.doc} ${m.numero}.xml`, content: (await baixar(b.xml_path)).toString("base64") });
  for (let i = 0; i < b.boletos.length; i++) {
    anexos.push({ filename: nomesAnexos(m.doc, m.numero, { boletos: b.boletos.length })[i], content: (await baixar(b.boletos[i])).toString("base64") });
  }
  if (!anexos.length) throw new Error("Documento ainda sem arquivo (PDF/XML) — tente de novo em instantes");
  if (o.anexo?.base64) {
    if (o.anexo.base64.length > 10_000_000) throw new Error("Anexo grande demais (máx. 7 MB)");
    anexos.push({ filename: o.anexo.nome || "anexo", content: o.anexo.base64 });
  }

  const assuntoBase = (o.assunto ?? "").trim() || assuntoEnvio(m);
  const html = corpoEnvio(m, o.texto);
  if (modo === "prova") {
    // Prova: só para quem está logado, assunto [TESTE], sem cópias, sem registro.
    return { b, de: remetenteFat(), para: [quem.toLowerCase()], cc: [] as string[], cco: [] as string[], assunto: `[TESTE] ${assuntoBase}`,
      html, anexos, replyTo: quem, teste: [] as string[], todos: [quem], paraOrig: para };
  }
  // Modo teste (COMPRAS_EMAIL_SO_PARA): nenhum externo recebe; vai para a lista de teste.
  const teste = soParaLista();
  const todos = [...para, ...cc, ...cco];
  const assunto = `${teste.length ? `[TESTE → ${todos.join(", ")}] ` : ""}${assuntoBase}`;
  const ccoFinal = teste.length ? [] : copiaOculta(ccoFixoFat(), quem, cco);
  return { b, de: remetenteFat(), para: teste.length ? teste : para, cc: teste.length ? [] : cc, cco: ccoFinal, assunto, html, anexos, replyTo: quem, teste, todos, paraOrig: para };
}

/** Situação do domínio do remetente no Resend (verificado?). */
async function dominioRemetente() {
  const dom = (remetenteFat().match(/@([^>\s]+)/)?.[1] ?? "").toLowerCase();
  try {
    const r = await resendGet<{ data?: { name: string; status: string }[] }>("/domains");
    const d = (r.data ?? []).find((x) => x.name.toLowerCase() === dom);
    return { dominio: dom, status: d?.status ?? "não cadastrado no Resend" };
  } catch (e) { return { dominio: dom, status: `não consultado (${(e as Error).message})` }; }
}

/** Ensaio do envio (dry-run): monta tudo — destinatários, assunto, corpo e anexos de verdade — e NÃO envia. */
export async function previaEnvio(alvo: Alvo, quem: string, o: Opcoes = {}) {
  const x = await montar(alvo, quem, o, "previa");
  return {
    enviaria: false, bloqueio: x.b.podeEnviar, configurado: emailConfigurado(),
    de: x.de, para: x.para, cc: x.cc, cco: x.cco, replyTo: x.replyTo, assunto: x.assunto, html: x.html,
    anexos: x.anexos.map((a) => ({ nome: a.filename, kb: Math.round((a.content.length * 3) / 4 / 1024) })),
    teste: x.teste.length ? x.teste : null, remetente: await dominioRemetente(),
  };
}

/** Prova: o mesmo e-mail, só para quem está logado, assunto "[TESTE]". Não registra nem marca como enviado. */
export async function provaEnvio(alvo: Alvo, quem: string, o: Opcoes = {}) {
  if (!emailConfigurado()) throw new Error("E-mail não configurado (RESEND_API_KEY / remetente)");
  if (!emailOk(quem)) throw new Error("Sem e-mail de quem está logado");
  const x = await montar(alvo, quem, o, "prova");
  const id = await enviarResend({ de: x.de, para: x.para, assunto: x.assunto, html: x.html, replyTo: x.replyTo,
    messageId: novoMessageId(`fatprova${alvo.id}`), anexos: x.anexos });
  return { id, para: x.para, assunto: x.assunto, anexos: x.anexos.map((a) => a.filename) };
}

export async function enviarEmissao(alvo: Alvo, quem: string, o: Opcoes = {}) {
  if (!emailConfigurado()) throw new Error("E-mail não configurado (RESEND_API_KEY / remetente)");
  const x = await montar(alvo, quem, o, "envio");
  if (x.b.podeEnviar) throw new Error(x.b.podeEnviar);
  if (!x.paraOrig.length) throw new Error("Informe pelo menos um destinatário em “Para”");
  const ref = alvo.tipo === "emissao" ? { emissao_id: alvo.id } : { nfse_id: alvo.id };
  const paraReg = x.paraOrig;
  let idResend: string | null = null;
  try {
    idResend = await enviarResend({
      de: x.de, para: x.para, cc: x.cc, cco: x.cco, assunto: x.assunto, html: x.html, replyTo: x.replyTo,
      messageId: novoMessageId(`fat${alvo.tipo === "nfse" ? "n" : ""}${alvo.id}`), anexos: x.anexos,
    });
  } catch (err) {
    await linha({ ...ref, de: x.de, para: paraReg, cc: x.cc, cco: x.cco, assunto: x.assunto, anexos: x.anexos.map((a) => a.filename),
      enviado_por: quem, status: "falhou", status_em: new Date().toISOString(), detalhe: (err as Error).message });
    throw err;
  }
  await linha({ ...ref, resend_id: idResend, de: x.de, para: paraReg, cc: x.cc, cco: x.cco, assunto: x.assunto,
    anexos: x.anexos.map((a) => a.filename), enviado_por: quem, status: "enviado", detalhe: x.teste.length ? `modo teste → ${x.teste.join(", ")}` : null });
  // Em modo teste o documento continua "não enviado" (o cliente não recebeu).
  if (!x.teste.length) await registrar(alvo, [...x.para, ...x.cc], quem);
  return { id: idResend, para: x.todos, teste: x.teste.length > 0, vaiPara: x.teste.length ? x.teste : x.todos };
}

/** "Enviou por outro caminho" (WhatsApp, portal do cliente…): só registra. */
export async function marcarEnviado(alvo: Alvo, quem: string, meio: string, para: string) {
  const ref = alvo.tipo === "emissao" ? { emissao_id: alvo.id } : { nfse_id: alvo.id };
  if (alvo.tipo === "nfse") { const b = await carregar(alvo); if (b.podeEnviar === MSG_MIGRACAO) throw new Error(MSG_MIGRACAO); }
  await linha({ ...ref, meio, para: lista(para), enviado_por: quem, status: "marcado", detalhe: `Enviado por ${meio} (registrado à mão)` });
  await registrar(alvo, [`${meio}${para ? `: ${para}` : ""}`], quem);
  return { ok: true };
}

async function registrar(alvo: Alvo, para: string[], quem: string) {
  const campos = { enviado_em: new Date().toISOString(), enviado_para: para, enviado_por: quem };
  const { error } = alvo.tipo === "emissao"
    ? await db().from("fat_emissoes").update(campos).eq("id", alvo.id)
    : await db().from("fat_nfse_manual").update(campos).eq("id", alvo.id);
  if (error) console.warn("[fat enviado]", error.message);
}

async function linha(r: Record<string, unknown>) {
  const { error } = await fat().insert(r);
  if (error) console.warn("[fat_envios]", error.message);
}

/** Último evento do Resend → situação do envio. "opened" só aparece se o rastreio de abertura estiver ligado. */
const FINAIS = new Set(["entregue", "devolvido", "spam", "falhou", "marcado", "aberto", "clicado"]);
const DO_RESEND: Record<string, string> = {
  sent: "enviado", delivered: "entregue", delivery_delayed: "atrasado", bounced: "devolvido",
  complained: "spam", opened: "aberto", clicked: "clicado", failed: "falhou", canceled: "falhou",
};

export type Envio = {
  id: number; meio: string; de: string | null; para: string[]; cc: string[]; cco: string[]; assunto: string | null; anexos: string[];
  enviado_por: string | null; enviado_em: string; status: string; status_em: string | null; detalhe: string | null; resend_id: string | null;
};

/** Histórico do documento; atualiza no Resend a situação dos envios que ainda não terminaram. */
export async function historico(alvo: Alvo): Promise<Envio[]> {
  const { data, error } = await fat().select("*").eq(alvo.tipo === "emissao" ? "emissao_id" : "nfse_id", alvo.id).order("enviado_em", { ascending: false });
  if (error) { if (!semColuna(error.message)) console.warn("[fat_envios]", error.message); return []; }
  const rows = (data ?? []) as Envio[];
  await Promise.all(rows.filter((r) => r.resend_id && !FINAIS.has(r.status)).map(async (r) => {
    try {
      const m = await resendGet<{ last_event?: string }>(`/emails/${r.resend_id}`);
      const st = DO_RESEND[m.last_event ?? ""] ?? r.status;
      if (st !== r.status) {
        r.status = st; r.status_em = new Date().toISOString();
        await fat().update({ status: st, status_em: r.status_em }).eq("id", r.id);
      }
    } catch { /* sem rede/sem permissão: fica a última situação conhecida */ }
  }));
  return rows;
}

export type Pendente = {
  ref: string; tipo: "emissao" | "nfse"; id: number; doc: TipoEnvio; numero: string; origem: string | null;
  cliente: string; valor: number; autorizada_em: string | null; criado_por: string | null;
};

/**
 * Documentos de PRODUÇÃO emitidos/registrados no painel e ainda sem envio ao cliente
 * (sem e-mail com sucesso nem "marcar como enviado"). ref = "e<id>" (emissão) ou "n<id>" (NFS-e).
 */
export async function pendentes(empresa?: string | null): Promise<{ docs: Pendente[]; nfsePendente?: boolean }> {
  let q = db().from("fat_emissoes").select("id, empresa, tipo, numero, origem_rotulo, cliente, valor_total, autorizada_em, criado_por")
    .eq("status", "autorizada").eq("ambiente", "producao").eq("ensaio", false).is("enviado_em", null)
    .order("autorizada_em", { ascending: false }).limit(1000);
  if (empresa) q = q.eq("empresa", empresa);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const docs: Pendente[] = ((data ?? []) as { id: number; tipo: string; numero: string | null; origem_rotulo: string | null; cliente: { nome?: string } | null; valor_total: number; autorizada_em: string | null; criado_por: string | null }[])
    .map((e) => ({ ref: `e${e.id}`, tipo: "emissao", id: e.id, doc: e.tipo === "nfe" ? "NF-e" : e.tipo === "nfse" ? "NFS-e" : "Recibo",
      numero: String(e.numero ?? ""), origem: e.origem_rotulo, cliente: e.cliente?.nome ?? "", valor: Number(e.valor_total ?? 0),
      autorizada_em: e.autorizada_em, criado_por: e.criado_por }));
  let n = db().from("fat_nfse_manual").select("id, empresa, numero, os, tomador_nome, valor_servicos, criado_em, criado_por")
    .eq("status", "registrada").is("enviado_em", null).limit(500);
  if (empresa) n = n.eq("empresa", empresa);
  const r = await n;
  if (r.error) return { docs, nfsePendente: true };
  for (const x of (r.data ?? []) as { id: number; numero: string; os: { rotulo: string }[] | null; tomador_nome: string | null; valor_servicos: number; criado_em: string; criado_por: string | null }[]) {
    docs.push({ ref: `n${x.id}`, tipo: "nfse", id: x.id, doc: "NFS-e", numero: x.numero, origem: (x.os ?? []).map((o) => o.rotulo).join(", ") || null,
      cliente: x.tomador_nome ?? "", valor: Number(x.valor_servicos ?? 0), autorizada_em: x.criado_em, criado_por: x.criado_por });
  }
  return { docs };
}
