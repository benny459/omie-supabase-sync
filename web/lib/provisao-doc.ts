import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { supaAdmin } from "@/lib/supabase-admin";
import { lerBoleto } from "@/lib/boleto";

/* Arquivo da nota na confirmação de provisão (sql/144, 08/10/26).
   XML (NF-e, NFS-e nacional, ABRASF) é lido direto; PDF/foto vão à IA
   (mesma chave do Cesar). O arquivo fica no bucket financeiro-documentos e o
   caminho é gravado na confirmação — quem confirma ainda confere os campos. */

export const BUCKET_FIN_DOCS = "financeiro-documentos";
export const LIMITE_DOC = 4 * 1024 * 1024; // corpo da função na Vercel (~4,5 MB)
const MODELO = () => process.env.PROVISAO_IA_MODEL || "claude-sonnet-5";

export type DadosNota = {
  tipo: "NFE" | "NFSE" | "BOL" | "REC" | "DAS" | null;
  numero: string | null;
  emissao: string | null;      // AAAA-MM-DD
  valor: number | null;        // valor a pagar (líquido, quando houver retenção)
  valor_bruto: number | null;
  vencimento: string | null;   // AAAA-MM-DD
  cnpj_emitente: string | null;
  emitente: string | null;
  chave: string | null;        // 44 (NF-e) ou 50 (NFS-e nacional) dígitos
  codigo_barras: string | null;
  fonte: "xml" | "ia";
  descricao?: string | null;   // ex.: "Fatura Vivo ref. 09/2026"
  boleto?: { valido: boolean; valor: number | null; vencimento: string | null; tipo: string; aviso?: string } | null;
};

const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "") || null;
const dia = (s: string | null | undefined) => {
  const m = String(s ?? "").match(/(\d{4})-(\d{2})-(\d{2})/) || String(s ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
};
// "1234.56" (XML / JSON) ou "1.234,56" (texto brasileiro)
const nro = (s: string | null | undefined) => {
  let t = String(s ?? "").replace(/[^\d.,-]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const tag = (xml: string, nome: string, dentro?: string) => {
  let x = xml;
  if (dentro) { const b = xml.match(new RegExp(`<(?:\\w+:)?${dentro}[\\s>][\\s\\S]*?</(?:\\w+:)?${dentro}>`, "i")); if (!b) return null; x = b[0]; }
  const m = x.match(new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${nome}>`, "i"));
  return m ? m[1].trim() : null;
};

/** XML de NF-e, NFS-e nacional (DPS/NFSe) ou ABRASF. */
export function lerXml(xml: string): DadosNota | null {
  if (/<(?:\w+:)?infNFe[\s>]/i.test(xml)) {
    const chave = so(xml.match(/Id="NFe(\d{44})"/i)?.[1]) || so(tag(xml, "chNFe"));
    return {
      tipo: "NFE", numero: tag(xml, "nNF"), emissao: dia(tag(xml, "dhEmi") || tag(xml, "dEmi")),
      valor: nro(tag(xml, "vNF")), valor_bruto: nro(tag(xml, "vProd")), vencimento: dia(tag(xml, "dVenc", "dup")),
      cnpj_emitente: so(tag(xml, "CNPJ", "emit") || tag(xml, "CPF", "emit")), emitente: tag(xml, "xNome", "emit"),
      chave, codigo_barras: null, fonte: "xml",
    };
  }
  if (/<(?:\w+:)?infNFSe[\s>]/.test(xml)) { // padrão nacional (maiúsculas importam: ABRASF usa InfNfse)
    const chave = so(xml.match(/Id="NFS(\d{50})"/i)?.[1]);
    return {
      tipo: "NFSE", numero: tag(xml, "nNFSe"), emissao: dia(tag(xml, "dhEmi", "DPS") || tag(xml, "dhProc") || tag(xml, "dhEmi")),
      valor: nro(tag(xml, "vLiq")) ?? nro(tag(xml, "vServ")), valor_bruto: nro(tag(xml, "vServ")), vencimento: null,
      cnpj_emitente: so(tag(xml, "CNPJ", "emit") || tag(xml, "CNPJ", "prest")), emitente: tag(xml, "xNome", "emit"),
      chave, codigo_barras: null, fonte: "xml",
    };
  }
  if (/<(?:\w+:)?(?:InfNfse|CompNfse|Nfse)[\s>]/i.test(xml)) { // ABRASF (prefeituras)
    return {
      tipo: "NFSE", numero: tag(xml, "Numero", "InfNfse") || tag(xml, "Numero"), emissao: dia(tag(xml, "DataEmissao")),
      valor: nro(tag(xml, "ValorLiquidoNfse")) ?? nro(tag(xml, "ValorServicos")), valor_bruto: nro(tag(xml, "ValorServicos")), vencimento: null,
      cnpj_emitente: so(tag(xml, "Cnpj", "PrestadorServico") || tag(xml, "Cnpj", "Prestador") || tag(xml, "Cnpj", "IdentificacaoPrestador")),
      emitente: tag(xml, "RazaoSocial", "PrestadorServico") || tag(xml, "RazaoSocial"),
      chave: null, codigo_barras: null, fonte: "xml",
    };
  }
  return null;
}

/** PDF ou foto: a IA devolve os campos. */
export async function lerComIA(bytes: Buffer, mime: string): Promise<DadosNota> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error("Leitura automática indisponível (ANTHROPIC_API_KEY não configurada) — preencha à mão");
  const cliente = new Anthropic({ apiKey: chave });
  const b64 = bytes.toString("base64");
  const arquivo = mime === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: b64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/png" | "image/jpeg" | "image/webp", data: b64 } };
  const r = await cliente.messages.create({
    model: MODELO(), max_tokens: 1000,
    messages: [{ role: "user", content: [arquivo, { type: "text", text:
`Este é um documento recebido por uma empresa brasileira para pagar: nota fiscal (NF-e, NFS-e), fatura de serviço
(telefonia/internet como Vivo, Claro, TIM; energia; água; gás; aluguel; condomínio), boleto bancário, recibo ou guia de imposto (DAS, DARF, GPS, GRU).
Extraia os campos e responda SÓ com JSON, sem texto em volta:
{"tipo":"NFSE|NFE|BOL|REC|DAS","numero":"nº da nota; numa fatura, o nº da fatura/conta/documento","emissao":"AAAA-MM-DD","valor":0.00,"valor_bruto":0.00,"vencimento":"AAAA-MM-DD ou null","cnpj_emitente":"só dígitos","emitente":"razão social de quem cobra","chave":"chave de acesso só dígitos ou null","codigo_barras":"linha digitável só dígitos ou null","descricao":"o que é, curto (ex.: Fatura Vivo ref. 09/2026)"}
Regras:
- tipo: NF-e de produto = NFE; NFS-e/nota de serviço = NFSE; fatura de concessionária/telefonia ou boleto = BOL; recibo = REC; guia de imposto = DAS.
- "valor" é o total a pagar (líquido de retenções; numa fatura, o "total a pagar"). "valor_bruto" é o valor antes de retenções/descontos.
- "emissao": data de emissão da nota/fatura. Se só houver mês de referência, use null.
- "codigo_barras": a linha digitável do boleto (47 dígitos; de concessionária/arrecadação 48, começa com 8). Copie dígito a dígito, sem espaços nem pontos.
- "cnpj_emitente": CNPJ de quem emitiu/cobra (beneficiário/cedente), nunca o do pagador.
- Use null quando o campo não existir no documento. Não invente.` }] }],
  });
  const txt = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const i = txt.indexOf("{"), j = txt.lastIndexOf("}");
  let o: Record<string, unknown> = {};
  try { o = JSON.parse(txt.slice(i, j + 1)); } catch { throw new Error("Não consegui ler o documento — preencha à mão"); }
  const t = String(o.tipo ?? "").toUpperCase();
  return {
    tipo: (["NFE", "NFSE", "BOL", "REC", "DAS"].includes(t) ? t : null) as DadosNota["tipo"],
    numero: o.numero ? String(o.numero).trim() : null, emissao: dia(o.emissao as string), valor: nro(String(o.valor ?? "")),
    valor_bruto: nro(String(o.valor_bruto ?? "")), vencimento: dia(o.vencimento as string),
    cnpj_emitente: so(o.cnpj_emitente as string), emitente: o.emitente ? String(o.emitente) : null,
    chave: so(o.chave as string), codigo_barras: so(o.codigo_barras as string), fonte: "ia",
    descricao: o.descricao ? String(o.descricao) : null,
  };
}

/** Guarda o arquivo e lê os campos. Devolve o caminho no storage + os dados. */
export async function receberNota(f: File, empresa: string) {
  if (!f || !f.size) throw new Error("Arquivo vazio");
  if (f.size > LIMITE_DOC) throw new Error("Arquivo maior que 4 MB");
  const nome = f.name || "nota";
  const low = nome.toLowerCase();
  const mime = /\.xml$/.test(low) || /xml/.test(f.type) ? "application/xml"
    : /\.pdf$/.test(low) || f.type === "application/pdf" ? "application/pdf"
    : /\.png$/.test(low) || f.type === "image/png" ? "image/png"
    : /\.webp$/.test(low) || f.type === "image/webp" ? "image/webp"
    : /\.jpe?g$/.test(low) || f.type === "image/jpeg" ? "image/jpeg" : null;
  if (!mime) throw new Error("Envie o XML, o PDF ou uma foto (JPG/PNG) da nota");
  const bytes = Buffer.from(await f.arrayBuffer());

  let dados: DadosNota | null = null; let aviso: string | null = null;
  if (mime === "application/xml") {
    dados = lerXml(bytes.toString("utf8"));
    if (!dados) aviso = "XML não reconhecido como NF-e/NFS-e — preencha à mão";
  } else {
    try { dados = await lerComIA(bytes, mime); } catch (e) { aviso = e instanceof Error ? e.message : String(e); }
  }

  // linha digitável: o valor/vencimento dentro do código mandam sobre a leitura
  if (dados?.codigo_barras) {
    const b = lerBoleto(dados.codigo_barras);
    if (!b) { dados.codigo_barras = null; }
    else {
      dados.boleto = { valido: b.valido, valor: b.valor, vencimento: b.vencimento, tipo: b.tipo, aviso: b.aviso };
      if (b.valido) {
        if (b.valor && (!dados.valor || Math.abs(b.valor - dados.valor) > 0.009)) dados.valor = b.valor;
        if (b.vencimento && !dados.vencimento) dados.vencimento = b.vencimento;
      }
    }
  }

  const ext = mime === "application/xml" ? "xml" : mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const path = `provisao/${empresa}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const { error } = await supaAdmin().storage.from(BUCKET_FIN_DOCS).upload(path, new Blob([bytes], { type: mime }), { upsert: false, contentType: mime });
  if (error) throw new Error("Falha ao guardar o arquivo: " + error.message);
  return { path, nome, dados, aviso };
}

export async function linkNota(path: string) {
  const { data, error } = await supaAdmin().storage.from(BUCKET_FIN_DOCS).createSignedUrl(path, 600);
  if (error || !data) throw new Error("Arquivo não encontrado");
  return data.signedUrl;
}
