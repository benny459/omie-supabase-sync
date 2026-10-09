import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { buscar } from "@/lib/faturamento/server";
import { BUCKET_FAT, documentoGuardado, nomePdf, pdfComCache } from "@/lib/faturamento/recibo-doc";
import { emailConfigurado, emailOk, enviarResend, lista, novoMessageId, soParaLista } from "@/lib/compras-email";

// "Enviar ao cliente" do Faturamento (09/10/26): manda a nota autorizada (DANFE + XML) ou o
// recibo em PDF para os e-mails do cliente, pelo Resend. Nada é enviado sozinho — só no clique.
// Cópia oculta para quem enviou; o envio fica registrado na emissão (enviado_em/enviado_para).

const rotuloDoc = (tipo: string) => (tipo === "nfe" ? "NF-e" : tipo === "nfse" ? "NFS-e" : "Recibo");

async function baixar(path: string) {
  const { data, error } = await supaAdmin().storage.from(BUCKET_FAT).download(path);
  if (error || !data) throw new Error(`Arquivo não encontrado (${path})`);
  return Buffer.from(await data.arrayBuffer());
}

/** E-mails do cliente da emissão (campo do documento, que veio do cadastro). */
export async function destinosDaEmissao(id: number) {
  const e = await buscar(id);
  const c = (e.cliente ?? {}) as { email?: string | null; nome?: string };
  return { emissao: e, emails: lista(c.email).filter(emailOk) };
}

export async function enviarEmissao(id: number, quem: string, para?: string[]) {
  if (!emailConfigurado()) throw new Error("E-mail não configurado (RESEND_API_KEY / remetente)");
  const { emissao: e, emails } = await destinosDaEmissao(id);
  if (e.status !== "autorizada") throw new Error("Só documento autorizado pode ser enviado");
  const destinos = (para?.length ? para : emails).map((x) => x.trim()).filter(Boolean);
  const ruim = destinos.find((x) => !emailOk(x));
  if (ruim) throw new Error(`E-mail inválido: ${ruim}`);
  if (!destinos.length) throw new Error("O cliente não tem e-mail no cadastro — informe para quem enviar");

  const doc = rotuloDoc(e.tipo);
  const num = String(e.numero ?? "");
  const cliente = (e.cliente as { nome?: string } | null)?.nome ?? "";
  const anexos: { filename: string; content: string }[] = [];
  if (e.pdf_path && /\.html?$/i.test(e.pdf_path)) {
    const html = await documentoGuardado(e.pdf_path);
    if (!html) throw new Error("Recibo não encontrado");
    anexos.push({ filename: nomePdf(html, `Recibo ${num}`), content: Buffer.from(await pdfComCache(html, e.pdf_path)).toString("base64") });
  } else if (e.pdf_path) {
    anexos.push({ filename: `${doc} ${num}.pdf`, content: (await baixar(e.pdf_path)).toString("base64") });
  }
  if (e.xml_path) anexos.push({ filename: `${doc} ${num}.xml`, content: (await baixar(e.xml_path)).toString("base64") });
  if (!anexos.length) throw new Error("Documento ainda sem arquivo (PDF/XML) — tente de novo em instantes");

  // Modo teste (COMPRAS_EMAIL_SO_PARA): nenhum externo recebe; vai para a lista de teste.
  const teste = soParaLista();
  const to = teste.length ? teste : destinos;
  const assunto = `${teste.length ? `[TESTE → ${destinos.join(", ")}] ` : ""}${doc} nº ${num} — WaterWorks${e.origem_rotulo ? ` (${e.origem_rotulo})` : ""}`;
  const valor = Number(e.valor_total ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const html = `<p>Prezados${cliente ? ` da ${cliente}` : ""},</p>
<p>Segue em anexo ${doc === "Recibo" ? "o recibo" : `a ${doc}`} nº <b>${num}</b>${e.origem_rotulo ? ` referente ao pedido ${e.origem_rotulo}` : ""}, no valor de <b>${valor}</b>.</p>
${e.chave ? `<p>Chave de acesso: <span style="font-family:monospace">${e.chave}</span></p>` : ""}
<p>Qualquer dúvida, é só responder este e-mail.</p><p>Atenciosamente,<br>WaterWorks</p>`;

  const idResend = await enviarResend({
    para: to, cco: teste.length ? [] : [quem], assunto, html, replyTo: quem,
    messageId: novoMessageId(`fat${e.id}`), anexos,
  });
  await supaAdmin().schema("orders").from("fat_emissoes")
    .update({ enviado_em: new Date().toISOString(), enviado_para: destinos, enviado_por: quem }).eq("id", e.id);
  return { id: idResend, para: destinos, teste: teste.length > 0 };
}
