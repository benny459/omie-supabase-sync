// Leitor de extrato bancário (05/10/26) — qualquer banco.
//
// OFX 1.x (SGML: tags de folha sem fecho, cabeçalho "OFXHEADER:100") e 2.x
// (XML), vários extratos no mesmo arquivo (conta corrente STMTRS e cartão
// CCSTMTRS), saldos LEDGERBAL/AVAILBAL, datas com ou sem hora/fuso
// ("20261002120000[-3:BRT]"), valor com vírgula ou ponto, charset detectado
// (UTF-8 / Windows-1252 / Latin-1). Sem biblioteca: os bancos variam nos
// detalhes, e cada detalhe conhecido tem um caso em scripts/teste-ofx.ts.
//
// Deduplicação: (empresa, conta, FITID) no banco. Banco que repete o FITID no
// mesmo arquivo, manda "0" ou não manda: geramos um id estável a partir de
// data|valor|memo|nome|checknum|ordem do lançamento no dia e guardamos o
// original em fitid_original.
//
// Também lê extrato em CSV/XLSX já convertido em linhas, com um mapa de
// colunas (lerLinhasExtrato) — o mapa fica guardado por conta para reutilizar.
// Sem dependências de servidor: roda no Node puro (teste) e no Next.

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
  cartao: boolean;         // CCSTMTRS (fatura de cartão)
  moeda: string | null;
  inicio: string | null;
  fim: string | null;
  saldo_final: number | null;      // LEDGERBAL
  saldo_final_data: string | null;
  saldo_disponivel: number | null; // AVAILBAL
  movimentos: MovOfx[];
};

/** Decodifica respeitando o cabeçalho; sem cabeçalho confiável, tenta UTF-8 e cai para Windows-1252. */
export function decodificarOfx(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const cabeca = new TextDecoder("latin1").decode(bytes.slice(0, 800));
  const declaraUtf8 = /ENCODING:\s*UTF-?8/i.test(cabeca) || /encoding\s*=\s*["']utf-?8["']/i.test(cabeca) || /CHARSET:\s*UTF-?8/i.test(cabeca);
  const declaraCp = /CHARSET:\s*(1252|ISO-?8859-?1|8859-1|LATIN-?1)/i.test(cabeca) || /encoding\s*=\s*["'](windows-1252|iso-8859-1)["']/i.test(cabeca);
  // BOM UTF-8
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.slice(3));
  if (declaraCp && !declaraUtf8) return new TextDecoder("windows-1252").decode(bytes);
  try {
    // UTF-8 estrito: se o arquivo for Latin-1 com acentos, falha e caímos no 1252
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function entidades(v: string): string {
  return v.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function folha(bloco: string, tag: string): string | null {
  // <TAG>valor  (SGML)  ou  <TAG>valor</TAG>  (XML); valor pode ter "<" escapado
  const m = bloco.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  const v = m?.[1]?.trim();
  return v ? entidades(v).replace(/\s+/g, " ").trim() || null : null;
}

/** "20261002", "20261002120000", "20261002120000.000[-3:BRT]", "2026-10-02T12:00:00" → "2026-10-02". */
export function dataOfx(v: string | null): string | null {
  const s = (v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = s.replace(/\[.*$/, "").replace(/\D/g, "").slice(0, 8);
  if (d.length !== 8) return null;
  const y = Number(d.slice(0, 4)), mo = Number(d.slice(4, 6)), da = Number(d.slice(6, 8));
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** "1.234,56" | "1234.56" | "-1,234.56" | "(1.234,56)" | "R$ 1.234,56" | "1234,56-" → número. */
export function valorOfx(v: string | null | number): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = v.trim().replace(/\s|R\$/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  if (/^[DC]$/i.test(s.slice(-1)) && s.length > 1) { if (/D$/i.test(s)) neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const ultVirg = s.lastIndexOf(","), ultPonto = s.lastIndexOf(".");
  if (ultVirg > -1 && ultVirg > ultPonto) s = s.replace(/\./g, "").replace(",", ".");
  else if (ultPonto > -1 && ultVirg > -1) s = s.replace(/,/g, "");
  else if (ultVirg > -1) s = s.replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\.(?=.*\.)/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

/** Hash curto e estável (FNV-1a 32 bits) para o FITID sintético. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const digitos = (v: string | null) => (v ?? "").replace(/\D/g, "") || null;
const bancoTres = (v: string | null) => {
  const d = digitos(v);
  return d ? d.replace(/^0+(?=\d{3})/, "").padStart(3, "0").slice(-3) : null;
};

/** Lista de lançamentos com FITID estável e único dentro do extrato. */
function montarMovimentos(blocos: string[]): MovOfx[] {
  const vistos = new Map<string, number>();
  const ordemDia = new Map<string, number>();
  const out: MovOfx[] = [];
  for (const b of blocos) {
    const data = dataOfx(folha(b, "DTPOSTED")) ?? dataOfx(folha(b, "DTUSER")) ?? dataOfx(folha(b, "DTAVAIL"));
    const valor = valorOfx(folha(b, "TRNAMT"));
    if (!data || valor == null || valor === 0) continue;
    const tipo = folha(b, "TRNTYPE");
    const memo = folha(b, "MEMO");
    const nome = folha(b, "NAME") ?? folha(b, "PAYEE") ?? folha(b, "PAYEEID");
    const checknum = folha(b, "CHECKNUM");
    const refnum = folha(b, "REFNUM");
    const original = folha(b, "FITID");
    const chaveDia = `${data}|${valor.toFixed(2)}|${memo ?? ""}|${nome ?? ""}|${checknum ?? ""}`;
    const nDia = (ordemDia.get(chaveDia) ?? 0) + 1;
    ordemDia.set(chaveDia, nDia);
    const valido = original && original.replace(/\s+/g, "") !== "" && !/^0+$/.test(original) && !/^(null|none|-)$/i.test(original);
    let fitid = valido ? original!.replace(/\s+/g, "") : `sint:${data}:${valor.toFixed(2)}:${hash(`${chaveDia}|${nDia}`)}`;
    const n = (vistos.get(fitid) ?? 0) + 1;
    vistos.set(fitid, n);
    if (n > 1) fitid = `${fitid}#${n}`;
    out.push({ fitid, fitid_original: original, data, valor, tipo, memo, nome, refnum, checknum });
  }
  return out;
}

/** Todos os extratos do arquivo (conta corrente e cartão). */
export function lerExtratos(texto: string): ExtratoOfx[] {
  if (!/<OFX>/i.test(texto)) throw new Error("Arquivo não parece ser OFX (sem a marca <OFX>).");
  const corpo = texto.slice(texto.search(/<OFX>/i));
  // cada extrato: <STMTRS>…</STMTRS> ou <CCSTMTRS>…</CCSTMTRS>; SGML às vezes não fecha → corta no próximo
  const marcas = [...corpo.matchAll(/<(CC)?STMTRS>/gi)];
  const pedacos: { cartao: boolean; txt: string }[] = marcas.length
    ? marcas.map((m, i) => ({
        cartao: !!m[1],
        txt: corpo.slice(m.index!, i + 1 < marcas.length ? marcas[i + 1].index! : undefined)
          .split(/<\/(CC)?STMTRS>/i)[0],
      }))
    : [{ cartao: /<CCACCTFROM>/i.test(corpo), txt: corpo }];

  return pedacos.map(({ cartao, txt }) => {
    const ctaBloco = (txt.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)(<\/(BANKACCTFROM|CCACCTFROM)>|<BANKTRANLIST>|<LEDGERBAL>)/i)?.[2]) ?? txt;
    const saldoBloco = txt.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1] ?? "";
    const dispBloco = txt.match(/<AVAILBAL>([\s\S]*?)(<\/AVAILBAL>|$)/i)?.[1] ?? "";
    const blocos = txt.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
    let movimentos = montarMovimentos(blocos);
    // Banco que manda tudo positivo e indica a saída só pelo TRNTYPE (DEBIT…):
    // se nenhum valor vier negativo e houver débitos, o tipo manda no sinal.
    const DEB = /^(DEBIT|PAYMENT|CHECK|FEE|SRVCHG|ATM|POS|DIRECTDEBIT|CASH)$/i;
    if (movimentos.length && movimentos.every((m) => m.valor > 0) && movimentos.some((m) => m.tipo && DEB.test(m.tipo))) {
      movimentos = movimentos.map((m) => (m.tipo && DEB.test(m.tipo) ? { ...m, valor: -m.valor } : m));
    }
    const datas = movimentos.map((m) => m.data).sort();
    return {
      banco: bancoTres(folha(ctaBloco, "BANKID")) ?? bancoTres(folha(corpo, "FID")),
      conta: digitos(folha(ctaBloco, "ACCTID")),
      agencia: digitos(folha(ctaBloco, "BRANCHID")),
      cartao,
      moeda: folha(txt, "CURDEF"),
      inicio: dataOfx(folha(txt, "DTSTART")) ?? datas[0] ?? null,
      fim: dataOfx(folha(txt, "DTEND")) ?? datas[datas.length - 1] ?? null,
      saldo_final: valorOfx(folha(saldoBloco, "BALAMT")),
      saldo_final_data: dataOfx(folha(saldoBloco, "DTASOF")),
      saldo_disponivel: valorOfx(folha(dispBloco, "BALAMT")),
      movimentos,
    };
  });
}

/** Compatibilidade: o primeiro extrato com lançamentos. */
export function lerOfx(texto: string): ExtratoOfx {
  const todos = lerExtratos(texto);
  return todos.find((e) => e.movimentos.length) ?? todos[0];
}

// ── CSV / planilha ─────────────────────────────────────────────────────────

/** Mapa de colunas de um extrato em planilha (índices 0-based; -1 = não tem). */
export type MapaColunas = {
  data: number;
  valor: number;          // valor com sinal; ou -1 e usar credito/debito
  credito?: number;
  debito?: number;
  historico: number;
  documento?: number;
  nome?: number;
  saldo?: number;
  linha_inicial?: number; // pula cabeçalho
  formato_data?: "dmy" | "ymd" | "mdy";
  inverter_sinal?: boolean;
};

/** Separa uma linha CSV com ; ou , e aspas. */
export function partirCsv(texto: string): string[][] {
  const linhas = texto.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const amostra = linhas.slice(0, 10).join("\n");
  const sep = (amostra.match(/;/g)?.length ?? 0) >= (amostra.match(/,/g)?.length ?? 0) ? ";" : (amostra.includes("\t") ? "\t" : ",");
  return linhas.map((l) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { out.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
}

function dataLivre(v: unknown, fmt: MapaColunas["formato_data"] = "dmy"): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) { // serial do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const p = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!p) return dataOfx(s);
  let [a, b, c] = [Number(p[1]), Number(p[2]), Number(p[3])];
  if (c < 100) c += 2000;
  const [dia, mes] = fmt === "mdy" ? [b, a] : [a, b];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${c}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Linhas de planilha + mapa → extrato no mesmo formato do OFX. */
export function lerLinhasExtrato(linhas: unknown[][], mapa: MapaColunas): ExtratoOfx {
  const blocos: MovOfx[] = [];
  const ini = mapa.linha_inicial ?? 1;
  let ultimoSaldo: number | null = null, ultimoSaldoData: string | null = null;
  const vistos = new Map<string, number>();
  for (const l of linhas.slice(ini)) {
    const data = dataLivre(l[mapa.data], mapa.formato_data);
    let valor: number | null = null;
    if (mapa.valor >= 0) valor = valorOfx(l[mapa.valor] as string | number);
    else {
      const cr = mapa.credito != null && mapa.credito >= 0 ? valorOfx(l[mapa.credito] as string | number) : null;
      const db = mapa.debito != null && mapa.debito >= 0 ? valorOfx(l[mapa.debito] as string | number) : null;
      valor = (cr ? Math.abs(cr) : 0) - (db ? Math.abs(db) : 0);
    }
    if (!data || valor == null || valor === 0) continue;
    if (mapa.inverter_sinal) valor = -valor;
    const memo = String(l[mapa.historico] ?? "").trim() || null;
    const doc = mapa.documento != null && mapa.documento >= 0 ? String(l[mapa.documento] ?? "").trim() || null : null;
    const nome = mapa.nome != null && mapa.nome >= 0 ? String(l[mapa.nome] ?? "").trim() || null : null;
    if (mapa.saldo != null && mapa.saldo >= 0) {
      const s = valorOfx(l[mapa.saldo] as string | number);
      if (s != null) { ultimoSaldo = s; ultimoSaldoData = data; }
    }
    const chave = `${data}|${valor.toFixed(2)}|${memo ?? ""}|${doc ?? ""}`;
    const n = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, n);
    blocos.push({ fitid: `csv:${data}:${valor.toFixed(2)}:${hash(`${chave}|${n}`)}`, fitid_original: null, data, valor,
      tipo: valor < 0 ? "DEBIT" : "CREDIT", memo, nome, refnum: doc, checknum: doc });
  }
  const datas = blocos.map((m) => m.data).sort();
  return {
    banco: null, conta: null, agencia: null, cartao: false, moeda: "BRL",
    inicio: datas[0] ?? null, fim: datas[datas.length - 1] ?? null,
    saldo_final: ultimoSaldo, saldo_final_data: ultimoSaldoData, saldo_disponivel: null, movimentos: blocos,
  };
}

/** Sugere o mapa de colunas pelo cabeçalho (Data, Valor, Histórico, Crédito, Débito, Saldo, Documento). */
export function sugerirMapa(cabecalho: unknown[]): MapaColunas {
  const h = cabecalho.map((c) => String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim());
  const achar = (...re: RegExp[]) => h.findIndex((c) => re.some((r) => r.test(c)));
  return {
    data: achar(/^data/, /dt\.?\s*lan/, /^date/),
    valor: achar(/^valor( \(r\$\))?$/, /^valor lan/, /^amount/, /^montante/),
    credito: achar(/credito/, /entrada/),
    debito: achar(/debito/, /saida/),
    historico: achar(/histor/, /descri/, /lancamento/, /^memo/),
    documento: achar(/docu/, /^n[ºo°]?\.? ?doc/),
    nome: achar(/favorecido/, /pagador/, /nome/, /origem/),
    saldo: achar(/^saldo/),
    linha_inicial: 1,
    formato_data: "dmy",
  };
}

// ── Conta do extrato ───────────────────────────────────────────────────────

export type ContaCorrente = {
  empresa: string; cod_cc: number; descricao: string; codigo_banco: string | null;
  numero_conta_corrente: string | null; tipo_conta_corrente: string | null; inativo: string | null;
  codigo_agencia?: string | null;
};

const normNum = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

/** Acha a conta corrente do extrato pelo banco + agência + número (sem DV/zeros à esquerda). */
export function acharConta(ext: Pick<ExtratoOfx, "banco" | "conta" | "agencia" | "cartao">, contas: ContaCorrente[]): ContaCorrente[] {
  if (!ext.conta) return [];
  const alvo = normNum(ext.conta);
  const banco = (ext.banco ?? "").replace(/^0+/, "");
  const ag = normNum(ext.agencia);
  const cands = contas.filter((c) => {
    const n = normNum(c.numero_conta_corrente);
    if (!n || !alvo) return false;
    const bancoOk = !banco || (c.codigo_banco ?? "").replace(/^0+/, "") === banco;
    // com ou sem dígito verificador e com a agência colada na frente:
    // 410855499 ↔ 41085549-9 ; 26373 ↔ 26373-7 ; 1234 + 0567890 ↔ 567890
    const numOk = n === alvo || n.slice(0, -1) === alvo || alvo.slice(0, -1) === n
      || (alvo.length >= 5 && n.endsWith(alvo)) || (n.length >= 5 && alvo.endsWith(n))
      || (!!ag && (alvo === ag + n || alvo === ag + n.slice(0, -1)));
    return bancoOk && numOk;
  });
  const rank = (c: ContaCorrente) =>
    (c.inativo === "S" ? 4 : 0)
    + (ext.cartao ? (c.tipo_conta_corrente === "CR" ? 0 : 1) : (c.tipo_conta_corrente === "CC" ? 0 : 1))
    + (ag && normNum(c.codigo_agencia) && normNum(c.codigo_agencia) !== ag ? 2 : 0);
  return cands.sort((a, b) => rank(a) - rank(b));
}

/** Confere o saldo do arquivo: saldo final − movimentos = saldo de abertura do período. */
export function conferirSaldo(ext: ExtratoOfx): { abertura: number | null; fechamento: number | null; movimento: number } {
  const movimento = Math.round(ext.movimentos.reduce((s, m) => s + m.valor, 0) * 100) / 100;
  if (ext.saldo_final == null) return { abertura: null, fechamento: null, movimento };
  return { abertura: Math.round((ext.saldo_final - movimento) * 100) / 100, fechamento: ext.saldo_final, movimento };
}
