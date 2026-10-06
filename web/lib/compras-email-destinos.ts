// Destinatários finais do e-mail do pedido de compra (puro — testável sem servidor).
//
// • Cópia oculta automática: a fixa (compras@) e quem enviou.
// • Modo teste (COMPRAS_EMAIL_SO_PARA): NÃO bloqueia — REDIRECIONA (06/10/26,
//   Benny). Todo destinatário fora da lista de teste (Para, Cc e Cco) sai do
//   envio; no lugar dele vão os endereços de teste. Os originais voltam em
//   `teste.originais` para o assunto e o corpo mostrarem para quem iria.
//   Nenhum endereço externo recebe enquanto a trava estiver ligada.

export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export type Originais = { para: string[]; cc: string[]; cco: string[] };
export type Destinos = {
  para: string[]; cc: string[]; cco: string[];
  /** Preenchido só em modo teste. */
  teste: null | { originais: Originais; vaiPara: string[] };
};

const unicos = (xs: string[], ja: Set<string>) => {
  const out: string[] = [];
  for (const e of xs) { const k = e.toLowerCase(); if (!ja.has(k)) { ja.add(k); out.push(e); } }
  return out;
};

export function montarDestinatarios(
  para: string[], cc: string[], cco: string[], quem: string, so: string[], fixo: string[],
): Destinos | { erro: string } {
  const ruim = [...para, ...cc, ...cco].find((e) => !emailValido(e));
  if (ruim) return { erro: `E-mail inválido: ${ruim}` };
  const soL = so.map((e) => e.toLowerCase()), fixoL = fixo.map((e) => e.toLowerCase());
  const teste = soL.length > 0;
  const liberado = (e: string) => !teste || soL.includes(e.toLowerCase()) || fixoL.includes(e.toLowerCase());

  const originais: Originais = { para: para.filter((e) => !liberado(e)), cc: cc.filter((e) => !liberado(e)), cco: cco.filter((e) => !liberado(e)) };
  let p = para.filter(liberado);
  const c = cc.filter(liberado), k = cco.filter(liberado);
  // Em teste, quem ficou de fora é substituído pelos endereços de teste (no Para).
  if (teste && (originais.para.length || originais.cc.length || originais.cco.length || !p.length)) p = [...p, ...so];

  const ja = new Set<string>();
  const paraF = unicos(p, ja), ccF = unicos(c, ja);
  const ccoF = unicos([...k, ...fixo, ...(quem && liberado(quem) ? [quem] : [])], ja);
  return { para: paraF, cc: ccF, cco: ccoF, teste: teste ? { originais, vaiPara: paraF } : null };
}

const temOriginais = (o: Originais) => o.para.length + o.cc.length + o.cco.length > 0;

/** Assunto em modo teste: "[TESTE → era para: a; cc: b] …". */
export function assuntoTeste(assunto: string, d: Destinos) {
  if (!d.teste) return assunto;
  const o = d.teste.originais;
  if (!temOriginais(o)) return `[TESTE] ${assunto}`;
  const partes = [o.para.length ? `era para: ${o.para.join(", ")}` : "", o.cc.length ? `cc: ${o.cc.join(", ")}` : "", o.cco.length ? `cco: ${o.cco.join(", ")}` : ""].filter(Boolean);
  return `[TESTE → ${partes.join("; ")}] ${assunto}`;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

/** Faixa visível no topo do corpo, em modo teste, com os destinatários originais. */
export function faixaTeste(d: Destinos) {
  if (!d.teste) return "";
  const o = d.teste.originais;
  const linhas = [o.para.length ? `Para: ${o.para.join(", ")}` : "", o.cc.length ? `Cc: ${o.cc.join(", ")}` : "", o.cco.length ? `Cco: ${o.cco.join(", ")}` : ""].filter(Boolean);
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#FFF4D6;border:1px solid #E8B93C;color:#5A4300;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:13px">
<b>E-MAIL DE TESTE</b> — o painel está em modo teste e redirecionou este envio para ${esc(d.teste.vaiPara.join(", "))}.${linhas.length ? `<br>Iria para: ${linhas.map(esc).join(" · ")}` : ""}</div>`;
}
