/* Contratos recorrentes — valores digitados, validação e diferenças (09/10/26).
   Por quê: em 08/10 o contrato CM180321 (HCor) foi gravado com R$ 0,00 — o campo
   de valor aceitava "2.720,64", o formulário trocava só a vírgula ("2.720.64"),
   isso virava NaN → null no JSON e o banco gravava 0 sem avisar. A OS4893 saiu
   dele com R$ 0,00 e o recibo nº 4657 também. Aqui fica a leitura do número no
   formato brasileiro e as checagens que barram valor vazio/zerado. */

/** Lê um valor digitado: "2.720,64", "2720,64", "2720.64", "R$ 2.720,64", "2.720".
 *  Devolve NaN quando não dá para entender (nunca 0 silencioso). */
export function numBR(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let s = String(v).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "2.720" = dois mil setecentos e vinte
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);

export type ItemCtr = { descricao?: string | null; quantidade?: unknown; valor_unitario?: unknown; lc116?: string | null };

/** Erro que guia o usuário, ou null quando os itens podem ser gravados. */
export function validarItensContrato(itens: ItemCtr[] | null | undefined): string | null {
  if (!itens?.length) return "O contrato precisa de pelo menos um item — use “+ item” e informe a descrição e o valor.";
  let total = 0;
  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    const n = i + 1;
    if (!String(it.descricao ?? "").trim()) return `Item ${n} sem descrição — escreva o serviço (ex.: VISITA CONTRATUAL PERIÓDICA).`;
    const q = numBR(it.quantidade ?? 1);
    if (!Number.isFinite(q) || q <= 0) return `Item ${n}: quantidade “${String(it.quantidade ?? "")}” inválida — use um número maior que zero (ex.: 1).`;
    const vu = numBR(it.valor_unitario);
    if (!Number.isFinite(vu)) {
      return `Item ${n}: não entendi o valor “${String(it.valor_unitario ?? "")}”. Digite só o número, por exemplo 2.720,64 ou 2720,64.`;
    }
    if (vu < 0) return `Item ${n}: valor negativo — o contrato não aceita desconto como item; ajuste o valor do serviço.`;
    total += q * vu;
  }
  if (!(Math.round(total * 100) > 0)) {
    return "O total do contrato ficou R$ 0,00 — a OS e o recibo sairiam sem preço. Informe o valor do serviço em cada item (ex.: 2.720,64) e grave de novo.";
  }
  return null;
}

/** Normaliza os itens digitados para o banco (números de verdade). */
export function itensNormalizados<T extends ItemCtr>(itens: T[]) {
  return itens.map((i) => ({ ...i, quantidade: numBR(i.quantidade ?? 1), valor_unitario: numBR(i.valor_unitario) }));
}

const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
/** Mesmo texto que o banco põe na OS (vendas.nome_mes): "AGOSTO/2026". */
export const nomeMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

export type ItemContratoDb = { seq?: number; descricao: string; servico_codigo?: string | null; quantidade: number; valor_unitario: number;
  lc116?: string | null; cod_serv_munic?: string | null; aliq_iss?: number | null; retem_iss?: boolean | null };

/** Itens da OS a partir dos itens do contrato — igual ao contrato_faturar do banco. */
export function itensDaOs(itens: ItemContratoDb[], competencia: string) {
  const ref = `REFERENTE AO MÊS DE ${nomeMes(competencia)}`;
  return [...itens].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0)).map((i) => {
    const fiscal: Record<string, unknown> = {};
    if (i.lc116) fiscal.lc116 = i.lc116;
    if (i.cod_serv_munic) fiscal.mun = i.cod_serv_munic;
    if (i.aliq_iss != null) fiscal.aliq_iss = i.aliq_iss;
    if (i.retem_iss != null) fiscal.retem_iss = i.retem_iss;
    return { descricao: `${i.descricao} || ${ref}`, codigo: i.servico_codigo ?? null, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario), unidade: "UN", fiscal };
  });
}

/** Campos do contrato que aparecem no histórico "de → para". */
const CAMPOS: [string, string][] = [
  ["valor_periodo", "valor"], ["vig_inicio", "início da vigência"], ["vig_fim", "fim da vigência"], ["periodicidade_meses", "periodicidade (meses)"],
  ["dia_faturamento", "dia de faturamento"], ["fatura_mes_seguinte", "fatura no mês seguinte"], ["condicao_codigo", "condição"],
  ["tipo_documento", "documento"], ["projeto_codigo", "projeto"], ["categoria_codigo", "categoria"], ["indice_reajuste", "índice"],
  ["proximo_reajuste", "próximo reajuste"], ["observacoes", "observações"], ["numero", "número"], ["cliente_codigo", "cliente"],
];
const vazio = (v: unknown) => v == null || v === "" ? null : v;
const resumoItens = (its: ItemContratoDb[]) => its.map((i) => `${String(i.descricao ?? "").trim()} · ${Number(i.quantidade)} × ${brl(Number(i.valor_unitario))}`).join(" | ");

export type Mudanca = { campo: string; de: unknown; para: unknown };
/** Diferenças entre o contrato antes e depois de gravar (para o Registro). */
export function diffContrato(antes: { contrato: Record<string, unknown>; itens: ItemContratoDb[] }, depois: { contrato: Record<string, unknown>; itens: ItemContratoDb[] }): Mudanca[] {
  const out: Mudanca[] = [];
  for (const [k, rot] of CAMPOS) {
    const a = vazio(antes.contrato[k]), b = vazio(depois.contrato[k]);
    const igual = k === "valor_periodo" ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005 : String(a ?? "") === String(b ?? "");
    if (!igual) out.push({ campo: rot, de: a, para: b });
  }
  const ia = resumoItens(antes.itens), ib = resumoItens(depois.itens);
  if (ia !== ib) out.push({ campo: "itens", de: ia, para: ib });
  return out;
}

/** Texto curto de uma mudança: "valor: R$ 0,00 → R$ 2.720,64". */
export function textoMudanca(m: Mudanca) {
  const f = (v: unknown) => (v == null ? "—" : m.campo === "valor" ? brl(Number(v)) : typeof v === "boolean" ? (v ? "sim" : "não") : String(v));
  return `${m.campo}: ${f(m.de)} → ${f(m.para)}`;
}
