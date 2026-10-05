// Leitor de extrato OFX (05/10/26) — Bradesco, C6, Itaú e afins.
//
// Aceita OFX 1.x (SGML: tags de folha sem fecho, cabeçalho "OFXHEADER:100")
// e 2.x (XML). Não depende de biblioteca: os bancos brasileiros variam pouco e
// o que interessa é BANKID/ACCTID e a lista de STMTTRN.
//
// Deduplicação: (empresa, conta, FITID) no banco. Alguns bancos repetem o
// FITID dentro do mesmo arquivo (lançamentos do mesmo dia) ou não o mandam —
// nesses casos geramos um id estável a partir de data|valor|memo|ordem e
// guardamos o original em fitid_original.

export type MovOfx = {
  fitid: string;
  fitid_original: string | null;
  data: string;      // YYYY-MM-DD
  valor: number;     // negativo = saída
  tipo: string | null;
  memo: string | null;
  nome: string | null;
  refnum: string | null;
  checknum: string | null;
};

export type ExtratoOfx = {
  banco: string | null;    // 3 dígitos (ex.: "237", "336", "341")
  conta: string | null;    // ACCTID só com dígitos
  agencia: string | null;
  inicio: string | null;
  fim: string | null;
  movimentos: MovOfx[];
};

/** Decodifica o arquivo respeitando o CHARSET do cabeçalho (1252 é o comum). */
export function decodificarOfx(buf: ArrayBuffer): string {
  const cabeca = new TextDecoder("latin1").decode(buf.slice(0, 600));
  const utf8 = /ENCODING:\s*UTF-?8/i.test(cabeca) || /encoding="utf-?8"/i.test(cabeca);
  const cp = /CHARSET:\s*(1252|ISO-?8859-?1|8859-1)/i.test(cabeca);
  if (utf8 && !cp) {
    const t = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!t.includes("�")) return t;
  }
  return new TextDecoder("windows-1252").decode(buf);
}

function folha(bloco: string, tag: string): string | null {
  // <TAG>valor  (SGML)  ou  <TAG>valor</TAG>  (XML)
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const v = m?.[1]?.trim();
  return v ? v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
}

function dataOfx(v: string | null): string | null {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 8);
  if (d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function valorOfx(v: string | null): number | null {
  if (!v) return null;
  let s = v.trim().replace(/\s/g, "");
  // "1.234,56" ou "1234,56" → ponto decimal
  if (s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Hash curto e estável (FNV-1a 32 bits) para o FITID sintético. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function lerOfx(texto: string): ExtratoOfx {
  if (!/<OFX>/i.test(texto)) throw new Error("Arquivo não parece ser OFX (sem a marca <OFX>).");
  const digitos = (v: string | null) => (v ?? "").replace(/\D/g, "") || null;
  const bancoBruto = digitos(folha(texto, "BANKID"));
  const banco = bancoBruto ? bancoBruto.replace(/^0+(?=\d{3})/, "").padStart(3, "0").slice(-3) : null;
  const conta = digitos(folha(texto, "ACCTID"));
  const agencia = digitos(folha(texto, "BRANCHID"));

  const blocos = texto.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const vistos = new Map<string, number>();
  const movimentos: MovOfx[] = [];
  blocos.forEach((b, i) => {
    const data = dataOfx(folha(b, "DTPOSTED")) ?? dataOfx(folha(b, "DTUSER"));
    const valor = valorOfx(folha(b, "TRNAMT"));
    if (!data || valor == null || valor === 0) return;
    const memo = folha(b, "MEMO");
    const nome = folha(b, "NAME") ?? folha(b, "PAYEE");
    const original = folha(b, "FITID");
    let fitid = original && original.replace(/\s+/g, "") !== "" && !/^0+$/.test(original) ? original : `sint:${data}:${valor.toFixed(2)}:${hash(`${memo ?? ""}|${nome ?? ""}|${i}`)}`;
    const n = (vistos.get(fitid) ?? 0) + 1;
    vistos.set(fitid, n);
    if (n > 1) fitid = `${fitid}#${n}`;
    movimentos.push({
      fitid, fitid_original: original, data, valor,
      tipo: folha(b, "TRNTYPE"), memo, nome,
      refnum: folha(b, "REFNUM"), checknum: folha(b, "CHECKNUM"),
    });
  });

  return {
    banco, conta, agencia,
    inicio: dataOfx(folha(texto, "DTSTART")), fim: dataOfx(folha(texto, "DTEND")),
    movimentos,
  };
}

export type ContaCorrente = {
  empresa: string; cod_cc: number; descricao: string; codigo_banco: string | null;
  numero_conta_corrente: string | null; tipo_conta_corrente: string | null; inativo: string | null;
};

/** Acha a conta corrente do extrato pelo banco + número da conta (sem DV/zeros à esquerda). */
export function acharConta(ext: ExtratoOfx, contas: ContaCorrente[]): ContaCorrente[] {
  if (!ext.conta) return [];
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const alvo = norm(ext.conta);
  const banco = (ext.banco ?? "").replace(/^0+/, "");
  const cands = contas.filter((c) => {
    const n = norm(c.numero_conta_corrente);
    if (!n) return false;
    const bancoOk = !banco || (c.codigo_banco ?? "").replace(/^0+/, "") === banco;
    // com ou sem dígito verificador: 410855499 ↔ 41085549-9 ; 26373 ↔ 26373-7
    const numOk = n === alvo || n.slice(0, -1) === alvo || alvo.slice(0, -1) === n || alvo.endsWith(n) || n.endsWith(alvo);
    return bancoOk && numOk;
  });
  // conta corrente ativa primeiro (Bradesco SF tem CC e "Aplicação" com o mesmo número)
  const rank = (c: ContaCorrente) => (c.inativo === "S" ? 2 : 0) + (c.tipo_conta_corrente === "CC" ? 0 : 1);
  return cands.sort((a, b) => rank(a) - rank(b));
}
