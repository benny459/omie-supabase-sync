// Modelo do e-mail "Enviar ao cliente" do Faturamento (09/10/26) — puro, sem
// servidor: a janela usa para a prévia e o servidor para o envio, então o que a
// pessoa vê é exatamente o que sai. Testes: scripts/testes/fat-envio-modelo.test.ts.
//
// Destinatários: e-mails do cadastro do cliente (NF-e primeiro), sem os nossos
// (o Omie põe o contasareceber@ em vários cadastros — ele já vai em cópia oculta).
// Corpo: documento e nº, valor, OC do cliente, vencimentos e os dados de
// pagamento (o mesmo texto do bloco "Pagamento" do recibo), chave da NF-e.

export type TipoEnvio = "NF-e" | "NFS-e" | "Recibo";
export type Vencimento = { vencimento: string; valor: number };
export type ModeloEnvio = {
  doc: TipoEnvio; numero: string; cliente: string; emitente?: string | null;
  /** PV/OS de origem (PV1962 / OS4880). */ origem?: string | null;
  /** Nº do pedido/OC do cliente. */ oc?: string | null;
  valor: number;
  /** Valor a pagar, quando difere do total (NFS-e com retenções). */ liquido?: number | null;
  chave?: string | null;
  vencimentos?: Vencimento[];
  /** Forma de recebimento (BOL, PIX, DEP…). */ forma?: string | null;
  /** Instrução de pagamento: linhas separadas por " | " (PIX / banco). */ instrucao?: string | null;
  /** Há boleto em anexo. */ boleto?: boolean;
  /** Município da NFS-e (prefeitura). */ municipio?: string | null;
};

export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const separar = (v: unknown): string[] =>
  (Array.isArray(v) ? v.flatMap(separar) : String(v ?? "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

/** Domínio próprio: endereço nosso não vai no "Para" do cliente. */
export const DOMINIO_PROPRIO = /@waterworks\.com\.br$/i;

/**
 * "Para" sugerido: junta as fontes (na ordem — e-mail de NF-e do cadastro, e-mail do
 * cadastro, e-mail gravado na nota), um por endereço, só os válidos, sem os
 * excluídos (cópia fixa, quem envia) e sem os do nosso domínio — a não ser que o
 * cliente só tenha endereços nossos (intercompany), aí ficam (menos os excluídos).
 */
export function destinatariosCliente(fontes: unknown[], excluir: string[] = []): string[] {
  const fora = new Set(excluir.map((e) => e.trim().toLowerCase()));
  const vistos = new Set<string>();
  const todos: string[] = [];
  for (const e of separar(fontes)) {
    if (!emailValido(e) || fora.has(e) || vistos.has(e)) continue;
    vistos.add(e); todos.push(e);
  }
  const externos = todos.filter((e) => !DOMINIO_PROPRIO.test(e));
  return externos.length ? externos : todos;
}

/** Cópia oculta automática: caixa fixa do faturamento + quem enviou (sem repetir). */
export function copiaOculta(fixo: string[], quem: string | null | undefined, extra: string[] = []): string[] {
  return [...new Set([...extra, ...fixo, ...(quem ? [quem] : [])].map((e) => e.trim().toLowerCase()).filter(emailValido))];
}

const NOME_DOC: Record<TipoEnvio, string> = {
  "NF-e": "Nota Fiscal Eletrônica (NF-e)", "NFS-e": "Nota Fiscal de Serviço (NFS-e)", Recibo: "Recibo de Prestação de Serviço",
};
const artigo = (doc: TipoEnvio) => (doc === "Recibo" ? "o recibo" : `a ${doc}`);
export const FORMAS: Record<string, string> = {
  PIX: "PIX", BOL: "Boleto", TRA: "Transferência", TRF: "Transferência", TED: "TED", DEP: "Depósito", DIN: "Dinheiro", CHQ: "Cheque", CRT: "Cartão",
};
export const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : iso);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function assuntoEnvio(m: ModeloEnvio) {
  return `${m.emitente || "WaterWorks"} - ${NOME_DOC[m.doc]} nº ${m.numero}${m.origem ? ` (${m.origem})` : ""}${m.oc ? ` - OC ${m.oc}` : ""}`;
}

/** Linhas de pagamento: forma + instrução (o mesmo conteúdo do bloco "Pagamento" do recibo). */
export function linhasPagamento(m: Pick<ModeloEnvio, "forma" | "instrucao" | "boleto">): string[] {
  const forma = m.forma ? FORMAS[m.forma.toUpperCase()] ?? m.forma : null;
  const l: string[] = [];
  if (forma) l.push(`Forma de pagamento: ${forma}${m.boleto ? " (boleto em anexo)" : ""}`);
  for (const x of String(m.instrucao ?? "").split("|").map((s) => s.trim()).filter(Boolean)) l.push(x);
  return l;
}

/** Nomes dos anexos por tipo de documento (o servidor usa os mesmos). */
export function nomesAnexos(doc: TipoEnvio, numero: string, tem: { pdf?: boolean; xml?: boolean; boletos?: number }) {
  const n: string[] = [];
  if (tem.pdf) n.push(doc === "NF-e" ? `DANFE NF-e ${numero}.pdf` : `${doc} ${numero}.pdf`);
  if (tem.xml) n.push(`${doc} ${numero}.xml`);
  for (let i = 1; i <= (tem.boletos ?? 0); i++) n.push(`Boleto ${numero}${(tem.boletos ?? 0) > 1 ? `-${i}` : ""}.pdf`);
  return n;
}

/** Corpo (HTML) do e-mail. `texto` = texto complementar digitado na janela. */
export function corpoEnvio(m: ModeloEnvio, texto?: string | null, opts: { faixa?: string } = {}) {
  const vs = (m.vencimentos ?? []).filter((v) => v.vencimento);
  const pag = linhasPagamento(m);
  const aPagar = m.liquido != null && Math.abs(m.liquido - m.valor) > 0.009 ? m.liquido : null;
  const tab = vs.length
    ? `<table style="border-collapse:collapse;font-size:13px;margin:4px 0 12px">
<tr><th style="text-align:left;padding:4px 14px 4px 0;color:#6A7B86;font-weight:600">Vencimento</th><th style="text-align:right;padding:4px 0;color:#6A7B86;font-weight:600">Valor</th></tr>
${vs.map((v) => `<tr><td style="padding:3px 14px 3px 0">${esc(dataBR(v.vencimento))}</td><td style="padding:3px 0;text-align:right">${brl(v.valor)}</td></tr>`).join("\n")}
</table>` : "";
  return `${opts.faixa ?? ""}<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A2731;font-size:14px;line-height:1.55;max-width:600px">
<div style="height:4px;background:linear-gradient(90deg,#10324A,#1C7FA0);margin-bottom:18px"></div>
<img src="https://painel.waterworks.com.br/logo-waterworks.png" alt="WaterWorks" width="150" style="display:block;margin-bottom:16px">
<p>Prezados${m.cliente ? ` da ${esc(m.cliente)}` : ""},</p>
<p>Segue em anexo ${artigo(m.doc)} nº <b>${esc(m.numero)}</b>${m.municipio ? ` (prefeitura de ${esc(m.municipio)})` : ""}${m.origem ? `, referente ao pedido ${esc(m.origem)}` : ""}, no valor de <b>${brl(m.valor)}</b>${aPagar != null ? ` (valor líquido a pagar: <b>${brl(aPagar)}</b>)` : ""}.</p>
${m.oc ? `<p>Seu pedido / ordem de compra: <b>${esc(m.oc)}</b></p>` : ""}
${vs.length ? `<p style="margin-bottom:2px"><b>${vs.length > 1 ? "Vencimentos" : "Vencimento"}</b></p>\n${tab}` : ""}
${pag.length ? `<p style="background:#EEF4F7;border-left:3px solid #1C7FA0;padding:10px 12px;font-size:13px"><b>Dados para pagamento</b><br>${pag.map(esc).join("<br>")}</p>` : ""}
${m.chave ? `<p style="font-size:13px">Chave de acesso: <span style="font-family:monospace">${esc(m.chave)}</span></p>` : ""}
${texto?.trim() ? `<p style="white-space:pre-wrap">${esc(texto.trim())}</p>` : ""}
<p>Qualquer dúvida, é só responder este e-mail.</p>
<p>Atenciosamente,<br>${esc(m.emitente || "WaterWorks")}</p></div>`;
}
