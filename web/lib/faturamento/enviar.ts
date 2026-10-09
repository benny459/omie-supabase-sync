import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { buscar, urlArquivo } from "@/lib/faturamento/server";
import { emitenteLocal } from "@/lib/faturamento/danfe-previa";
import { BUCKET_FAT, documentoGuardado, nomePdf, pdfComCache } from "@/lib/faturamento/recibo-doc";
import { emailConfigurado, emailOk, enviarResend, lista, novoMessageId, resendGet, soParaLista } from "@/lib/compras-email";

// "Enviar ao cliente" do Faturamento (09/10/26), no molde do envio do pedido de compra:
// Para (e-mails do cadastro do cliente) / Cc / Cco, assunto e texto editáveis, anexo extra,
// DANFE+XML ou recibo em PDF. Sai pelo e-mail da plataforma (Resend). Nada é enviado
// sozinho — só no clique. Cópia oculta e "responder para" = quem enviou. O envio (ou o
// "marcar como enviado" por outro caminho) fica registrado na emissão.

/** Remetente do faturamento (o domínio waterworks.com.br já está validado no Resend). */
// Como o Omie fazia (noreply@omie.com.br com contasareceber@ em cópia): sai do noreply@waterworks
// (Benny, 09/10/26); "responder para" = quem enviou, e o contasareceber@ e quem enviou ficam com a
// cópia oculta de todo envio.
export const remetenteFat = () => process.env.FATURAMENTO_EMAIL_REMETENTE || "WaterWorks Faturamento <noreply@waterworks.com.br>";
export const ccoFixoFat = () => lista(process.env.FATURAMENTO_EMAIL_CCO_FIXO ?? "contasareceber@waterworks.com.br").map((x) => x.toLowerCase());
const nomeDoc = (tipo: string) => (tipo === "nfe" ? "Nota Fiscal Eletrônica (NF-e)" : tipo === "nfse" ? "Nota Fiscal de Serviço (NFS-e)" : "Recibo de Prestação de Serviço");

const rotuloDoc = (tipo: string) => (tipo === "nfe" ? "NF-e" : tipo === "nfse" ? "NFS-e" : "Recibo");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function baixar(path: string) {
  const { data, error } = await supaAdmin().storage.from(BUCKET_FAT).download(path);
  if (error || !data) throw new Error(`Arquivo não encontrado (${path})`);
  return Buffer.from(await data.arrayBuffer());
}

type Extra = { enviado_em?: string | null; enviado_para?: string[] | null; enviado_por?: string | null };

/** Dados para a janela de envio: destinatários sugeridos, assunto padrão, arquivos e situação. */
export async function dadosEnvio(id: number, eu: string) {
  const e = await buscar(id);
  const c = (e.cliente ?? {}) as { email?: string | null; nome?: string };
  const doc = rotuloDoc(e.tipo);
  const num = String(e.numero ?? "");
  const x = e as unknown as Extra;
  const recibo = !!e.pdf_path && /\.html?$/i.test(e.pdf_path);
  const emitente = await emitenteLocal(e.empresa).then((x) => x.nome || "").catch(() => "");
  return {
    id: e.id, doc, numero: num, cliente: c.nome ?? "", origem: e.origem_rotulo ?? null, chave: e.chave ?? null,
    valor: Number(e.valor_total ?? 0), autorizada: e.status === "autorizada",
    para: lista(c.email).filter(emailOk),
    emitente,
    assunto: `${emitente || "WaterWorks"} - ${nomeDoc(e.tipo)} nº ${num}${e.origem_rotulo ? ` (${e.origem_rotulo})` : ""}`,
    arquivos: [
      ...(e.pdf_path ? [recibo ? `${doc} ${num}.pdf` : `DANFE ${doc} ${num}.pdf`] : []),
      ...(e.xml_path ? [`${doc} ${num}.xml`] : []),
    ],
    pdf: recibo ? `/api/faturamento/recibo-pdf?p=${encodeURIComponent(e.pdf_path!)}` : await urlArquivo(e.pdf_path),
    configurado: emailConfigurado(), soPara: soParaLista(), eu, remetente: remetenteFat(), ccoFixo: ccoFixoFat(),
    historico: await historico(e.id),
    enviadoEm: x.enviado_em ?? null, enviadoPara: x.enviado_para ?? null, enviadoPor: x.enviado_por ?? null,
  };
}

export function corpoEmail(d: { emitente?: string; cliente: string; doc: string; numero: string; origem: string | null; valor: number; chave: string | null }, texto?: string | null) {
  const valor = d.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `<p>Prezados${d.cliente ? ` da ${esc(d.cliente)}` : ""},</p>
<p>Segue em anexo ${d.doc === "Recibo" ? "o recibo" : `a ${d.doc}`} nº <b>${esc(d.numero)}</b>${d.origem ? ` referente ao pedido ${esc(d.origem)}` : ""}, no valor de <b>${valor}</b>.</p>
${d.chave ? `<p>Chave de acesso: <span style="font-family:monospace">${esc(d.chave)}</span></p>` : ""}
${texto?.trim() ? `<p style="white-space:pre-wrap">${esc(texto.trim())}</p>` : ""}
<p>Qualquer dúvida, é só responder este e-mail.</p><p>Atenciosamente,<br>${esc(d.emitente || "WaterWorks")}</p>`;
}

const limpaLista = (v: unknown) => lista(v).map((x) => x.toLowerCase());

export async function enviarEmissao(id: number, quem: string, o: {
  para?: unknown; cc?: unknown; cco?: unknown; assunto?: string; texto?: string; anexo?: { nome: string; base64: string } | null;
} = {}) {
  if (!emailConfigurado()) throw new Error("E-mail não configurado (RESEND_API_KEY / remetente)");
  const e = await buscar(id);
  if (e.status !== "autorizada") throw new Error("Só documento autorizado pode ser enviado");
  const d = await dadosEnvio(id, quem);
  const para = o.para != null ? limpaLista(o.para) : d.para;
  const cc = limpaLista(o.cc), cco = limpaLista(o.cco);
  const ruim = [...para, ...cc, ...cco].find((x) => !emailOk(x));
  if (ruim) throw new Error(`E-mail inválido: ${ruim}`);
  if (!para.length) throw new Error("Informe pelo menos um destinatário em “Para”");

  const anexos: { filename: string; content: string }[] = [];
  if (e.pdf_path && /\.html?$/i.test(e.pdf_path)) {
    const html = await documentoGuardado(e.pdf_path);
    if (!html) throw new Error("Recibo não encontrado");
    anexos.push({ filename: nomePdf(html, `Recibo ${d.numero}`), content: Buffer.from(await pdfComCache(html, e.pdf_path)).toString("base64") });
  } else if (e.pdf_path) {
    anexos.push({ filename: `DANFE ${d.doc} ${d.numero}.pdf`, content: (await baixar(e.pdf_path)).toString("base64") });
  }
  if (e.xml_path) anexos.push({ filename: `${d.doc} ${d.numero}.xml`, content: (await baixar(e.xml_path)).toString("base64") });
  if (!anexos.length) throw new Error("Documento ainda sem arquivo (PDF/XML) — tente de novo em instantes");
  if (o.anexo?.base64) {
    if (o.anexo.base64.length > 10_000_000) throw new Error("Anexo grande demais (máx. 7 MB)");
    anexos.push({ filename: o.anexo.nome || "anexo", content: o.anexo.base64 });
  }

  // Modo teste (COMPRAS_EMAIL_SO_PARA): nenhum externo recebe; vai para a lista de teste.
  const teste = soParaLista();
  const todos = [...para, ...cc, ...cco];
  const assunto = `${teste.length ? `[TESTE → ${todos.join(", ")}] ` : ""}${(o.assunto ?? "").trim() || d.assunto}`;
  const ccoFinal = teste.length ? [] : [...new Set([...cco, ...ccoFixoFat(), quem.toLowerCase()])];
  let idResend: string | null = null;
  try {
    idResend = await enviarResend({
      de: remetenteFat(), para: teste.length ? teste : para, cc: teste.length ? [] : cc, cco: ccoFinal,
      assunto, html: corpoEmail(d, o.texto), replyTo: quem, messageId: novoMessageId(`fat${e.id}`), anexos,
    });
  } catch (err) {
    await linha({ emissao_id: e.id, de: remetenteFat(), para, cc, cco: ccoFinal, assunto, anexos: anexos.map((a) => a.filename),
      enviado_por: quem, status: "falhou", status_em: new Date().toISOString(), detalhe: (err as Error).message });
    throw err;
  }
  await linha({ emissao_id: e.id, resend_id: idResend, de: remetenteFat(), para, cc, cco: ccoFinal, assunto,
    anexos: anexos.map((a) => a.filename), enviado_por: quem, status: "enviado", detalhe: teste.length ? `modo teste → ${teste.join(", ")}` : null });
  await registrar(e.id, todos, quem);
  return { id: idResend, para: todos, teste: teste.length > 0, vaiPara: teste.length ? teste : todos };
}

/** "Enviou por outro caminho" (WhatsApp, portal do cliente…): só registra. */
export async function marcarEnviado(id: number, quem: string, meio: string, para: string) {
  await linha({ emissao_id: id, meio, para: lista(para), enviado_por: quem, status: "marcado", detalhe: `Enviado por ${meio} (registrado à mão)` });
  await registrar(id, [`${meio}${para ? `: ${para}` : ""}`], quem);
  return { ok: true };
}

async function registrar(id: number, para: string[], quem: string) {
  await supaAdmin().schema("orders").from("fat_emissoes")
    .update({ enviado_em: new Date().toISOString(), enviado_para: para, enviado_por: quem }).eq("id", id);
}

const fat = () => supaAdmin().schema("orders").from("fat_envios");
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

/** Histórico da emissão; atualiza no Resend a situação dos envios que ainda não terminaram. */
export async function historico(emissaoId: number): Promise<Envio[]> {
  const { data } = await fat().select("*").eq("emissao_id", emissaoId).order("enviado_em", { ascending: false });
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
