import "server-only";
// PDF do Pedido de Compra para o fornecedor — layout adotado pelo Benny em
// 01/10/26 (docs/mockups/pedido-compra-layout.html). Duas variantes:
//   · completo     — itens com valores, totais, parcelas
//   · sem_valores  — só Item/Código/Descrição/NCM/Quantidade (sem totais nem parcelas)
// Observação interna NUNCA entra. Paginação segura: cabeçalho da tabela e
// rodapé ("Gerado em … · Página x de y") repetem em cada página.

import { Document, Page, Text, View, StyleSheet, pdf, type DocumentProps } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { ReactElement } from "react";
import { supaAdmin } from "@/lib/supabase-admin";
import { totais, totalItem, type Pedido } from "@/lib/compras";

export type VariantePdf = "completo" | "sem_valores";

/* Histórico de códigos (02/10/26): PC NOVO (já com o código de hoje) pode imprimir
   uma linha pequena "código anterior" sob o item nos primeiros meses — ligado por
   padrão até 31/12/2026. PC ANTIGO imprime o código que foi usado (é cópia do
   documento) e nunca ganha essa linha. */
export const CODIGO_ANTERIOR_PADRAO_ATE = "2026-12-31";
export const codigoAnteriorPadrao = (hoje = new Date().toISOString().slice(0, 10)) => hoje <= CODIGO_ANTERIOR_PADRAO_ATE;

type Empresa = { razao_social?: string; cnpj?: string; ie?: string; im?: string; endereco?: string; numero?: string; complemento?: string;
  bairro?: string; cidade?: string; uf?: string; cep?: string; telefone?: string; email?: string };
export type Fornecedor = { razao_social?: string; nome_fantasia?: string; cnpj_cpf?: string; inscricao_estadual?: string;
  endereco?: string; endereco_numero?: string; complemento?: string; bairro?: string; cidade?: string; estado?: string;
  cep?: string; email?: string; telefone1_ddd?: string; telefone1_numero?: string };

// Paleta do layout adotado pelo Benny (docs/mockups/pedido-compra-layout.html).
const INK = "#10324A", WATER = "#1C7FA0", MIST = "#EEF4F7", LINE = "#DCE5EA", TEXT = "#1A2731", MUTED = "#6A7B86";
const AMBER = "#B9770E", AMBER_BG = "#FFF5E3", OK = "#1F8A5B", OK_BG = "#E5F5EC", CRIT = "#B4413B", CRIT_BG = "#FCEBEA";
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });
const brl = (v: unknown) => BRL.format(Number(v) || 0);
const dBR = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const semUf = (c?: string | null) => (c ?? "").replace(/\s*\([A-Z]{2}\)\s*$/, "");
const cep = (c?: string | null) => { const d = (c ?? "").replace(/\D/g, ""); return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, "$1-$2") : (c ?? ""); };
const titulo = (t?: string | null) => (t ?? "").toLowerCase().replace(/(^|[\s/(-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
  .replace(/\b(Ltda|Eireli|Epp|Me|S\.?a\.?)\b/gi, (m) => m.length <= 3 ? m.toUpperCase() : m[0].toUpperCase() + m.slice(1).toLowerCase());
const fretoCurto = (t?: string) => !t ? "—" : t.startsWith("9") ? "Sem transporte" : t.startsWith("0") ? "CIF (por conta do fornecedor)"
  : t.startsWith("1") ? "FOB (por nossa conta)" : t.replace(/^\d - /, "");
const METODOS = ["PIX", "Transferência", "Boleto", "Cartão corporativo"];

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 44, fontSize: 9, fontFamily: "Helvetica", color: TEXT },
  faixa: { position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: WATER },
  faixaInk: { position: "absolute", top: 0, left: 0, width: "45%", height: 5, backgroundColor: INK },
  head: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 16, borderBottom: `1 solid ${LINE}` },
  marca: { fontSize: 19, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 5 },
  brandP: { fontSize: 8.3, color: MUTED, marginBottom: 1.5 },
  forte: { color: TEXT, fontFamily: "Helvetica-Bold" },
  doc: { alignItems: "flex-end" },
  kind: { fontSize: 8.8, color: MUTED, marginBottom: 2 },
  num: { fontSize: 29, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: -0.6 },
  status: { marginTop: 8, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, fontSize: 8, fontFamily: "Helvetica-Bold" },
  dates: { flexDirection: "row", paddingTop: 12, paddingBottom: 16 },
  date: { marginRight: 26 },
  small: { fontSize: 8, color: MUTED, marginBottom: 2 },
  dateV: { fontSize: 11, fontFamily: "Helvetica-Bold", color: TEXT },
  parties: { flexDirection: "row", marginBottom: 18 },
  box: { backgroundColor: MIST, borderRadius: 7, paddingVertical: 11, paddingHorizontal: 13 },
  boxH: { fontSize: 8.8, fontFamily: "Helvetica-Bold", color: WATER, marginBottom: 7 },
  boxName: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 4 },
  boxP: { fontSize: 8.3, color: MUTED, marginBottom: 2 },
  kv: { flexDirection: "row", justifyContent: "space-between", fontSize: 8.8, marginBottom: 5 },
  kvK: { color: MUTED }, kvV: { fontFamily: "Helvetica-Bold", color: TEXT, textAlign: "right", maxWidth: 130 },
  pend: { color: AMBER },
  th: { flexDirection: "row", borderBottom: `1.4 solid ${INK}`, paddingBottom: 6 },
  thC: { fontSize: 8, color: MUTED, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottom: `0.6 solid ${LINE}`, paddingVertical: 8 },
  td: { fontSize: 8.8, paddingHorizontal: 4 },
  r: { textAlign: "right" },
  dash: { color: "#B6C3CA" },
  descB: { fontFamily: "Helvetica-Bold", color: TEXT, marginBottom: 2 },
  descS: { fontSize: 7.8, color: MUTED },
  bottom: { flexDirection: "row", marginTop: 18 },
  h3: { fontSize: 8.8, fontFamily: "Helvetica-Bold", color: WATER, marginBottom: 7 },
  inst: { border: `0.8 solid ${LINE}`, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 10 },
  instL: { flexDirection: "row", marginBottom: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 7 },
  chip: { fontSize: 7.8, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, border: `0.8 solid ${LINE}`, color: MUTED, marginRight: 4, marginBottom: 3 },
  chipOn: { borderColor: WATER, color: "#FFFFFF", backgroundColor: WATER },
  noteS: { fontSize: 7.8, color: MUTED, marginTop: 5 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", fontSize: 9, paddingVertical: 4, color: MUTED },
  grand: { marginTop: 7, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 7, backgroundColor: INK, color: "#FFFFFF",
    flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nfe: { marginTop: 18, paddingVertical: 9, paddingHorizontal: 12, borderLeft: `2.4 solid ${WATER}`, backgroundColor: MIST, fontSize: 8.4 },
  signs: { flexDirection: "row", marginTop: 34 },
  sign: { flex: 1, borderTop: `0.8 solid ${TEXT}`, paddingTop: 6, fontSize: 8.6 },
  foot: { position: "absolute", bottom: 20, left: 44, right: 44, borderTop: `0.6 solid ${LINE}`, paddingTop: 7,
    flexDirection: "row", justifyContent: "space-between", fontSize: 7.4, color: MUTED },
  marcaD: { position: "absolute", top: 380, left: -40, right: -40, textAlign: "center", fontSize: 30, color: CRIT, opacity: 0.13,
    fontFamily: "Helvetica-Bold", transform: "rotate(-18deg)" },
});

function Itens({ p, variante, anteriores }: { p: Pedido; variante: VariantePdf; anteriores: Record<string, string> }) {
  const v = variante === "completo";
  const W = v ? { n: 18, prod: 186, ncm: 44, q: 40, vu: 58, d: 34, ipi: 30, st: 40, tot: 57 }
              : { n: 22, prod: 330, ncm: 70, q: 85, vu: 0, d: 0, ipi: 0, st: 0, tot: 0 };
  const dash = (x: unknown) => (Number(x) ? brl(x) : null);
  const cel = (val: string | null, w: number, extra: Style = {}) => (
    <Text style={[s.td, s.r, { width: w }, extra]}>{val ?? <Text style={s.dash}>—</Text>}</Text>
  );
  return (
    <View>
      <View style={s.th} fixed>
        <Text style={[s.thC, { width: W.n }]}>#</Text>
        <Text style={[s.thC, { width: W.prod }]}>Produto</Text>
        <Text style={[s.thC, { width: W.ncm }]}>NCM</Text>
        <Text style={[s.thC, s.r, { width: W.q }]}>Qtde</Text>
        {v && <Text style={[s.thC, s.r, { width: W.vu }]}>Valor unit.</Text>}
        {v && <Text style={[s.thC, s.r, { width: W.d }]}>Desc.</Text>}
        {v && <Text style={[s.thC, s.r, { width: W.ipi }]}>IPI</Text>}
        {v && <Text style={[s.thC, s.r, { width: W.st }]}>ICMS ST</Text>}
        {v && <Text style={[s.thC, s.r, { width: W.tot }]}>Total</Text>}
      </View>
      {(p.itens ?? []).map((it, i) => (
        <View key={i} style={s.tr} wrap={false}>
          <Text style={[s.td, { width: W.n, color: MUTED }]}>{i + 1}</Text>
          <View style={[s.td, { width: W.prod }]}>
            <Text style={s.descB}>{it.desc}</Text>
            <Text style={s.descS}>{it.cod ? `Cód. ${it.cod}` : ""}{it.obs ? `${it.cod ? " · " : ""}${it.obs}` : ""}</Text>
            {it.cod && anteriores[it.cod.toUpperCase()] ? <Text style={s.descS}>código anterior: {anteriores[it.cod.toUpperCase()]}</Text> : null}
          </View>
          <Text style={[s.td, { width: W.ncm }]}>{it.ncm || <Text style={s.dash}>—</Text>}</Text>
          <Text style={[s.td, s.r, { width: W.q }]}>{QTD.format(Number(it.qtd) || 0)} {(it.un ?? "UN").toUpperCase()}</Text>
          {v && cel(brl(it.vu), W.vu)}
          {v && cel(dash(it.desc0), W.d)}
          {v && cel(dash(it.ipi), W.ipi)}
          {v && cel(dash(it.st), W.st)}
          {v && cel(brl(totalItem({ ...it, key: "" })), W.tot, { fontFamily: "Helvetica-Bold", color: INK })}
        </View>
      ))}
    </View>
  );
}

export function DocumentoPedido({ p, empresa, forn, condicao, variante, usuario, agora, anteriores = {} }: {
  p: Pedido; empresa: Empresa; forn: Fornecedor; condicao: string; variante: VariantePdf; usuario: string; agora: Date;
  anteriores?: Record<string, string>;
}): ReactElement<DocumentProps> {
  const t = totais({ itens: p.itens ?? [], frete: p.frete ?? {} });
  const fr = p.frete ?? {};
  const v = variante === "completo";
  const emitido = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).replace(",", " às");
  const tel = forn.telefone1_numero ? `(${forn.telefone1_ddd ?? ""}) ${forn.telefone1_numero}` : "";
  const docs = [...new Set((p.parcelas ?? []).map((x) => x.doc).filter(Boolean))];
  const forma = docs.length === 1 ? (docs[0] === "Cartão de crédito" ? "Cartão corporativo" : docs[0]) : null;
  const st = p.aprov === "aprovado" ? { t: "Aprovado", c: OK, bg: OK_BG }
    : p.aprov === "nao_aprovado" ? { t: "Não aprovado", c: CRIT, bg: CRIT_BG } : { t: "Aguardando aprovação", c: AMBER, bg: AMBER_BG };
  const empNome = titulo(empresa.razao_social ?? p.emp);
  const fornNome = titulo(forn.razao_social || p.forn || "—");
  const linhaEnd = (e: string | undefined, n: string | undefined, comp?: string) => [[e, n].filter(Boolean).join(", "), comp].filter(Boolean).join(", ");
  return (
    <Document title={`Pedido de Compra ${p.num}`} author={empNome}>
      <Page size="A4" style={s.page}>
        <View style={s.faixa} fixed /><View style={s.faixaInk} fixed />
        {p.aprov !== "aprovado" && <Text style={s.marcaD} fixed>AGUARDANDO APROVAÇÃO — sem validade</Text>}
        <View style={s.head}>
          <View style={{ maxWidth: 330 }}>
            <Text style={s.marca}>{empNome}</Text>
            <Text style={s.brandP}>CNPJ <Text style={s.forte}>{empresa.cnpj ?? "—"}</Text>{empresa.ie ? `   IE ${empresa.ie}` : ""}{empresa.im ? `   IM ${empresa.im}` : ""}</Text>
            <Text style={s.brandP}>{[linhaEnd(empresa.endereco, empresa.numero, empresa.complemento || undefined), empresa.bairro,
              [titulo(semUf(empresa.cidade)), empresa.uf].filter(Boolean).join("/"), empresa.cep && `CEP ${cep(empresa.cep)}`].filter(Boolean).join(", ")}</Text>
            <Text style={s.brandP}>{[empresa.telefone, empresa.email].filter(Boolean).join("   ")}</Text>
          </View>
          <View style={s.doc}>
            <Text style={s.kind}>Pedido de compra</Text>
            <Text style={s.num}>{p.num}</Text>
            <Text style={[s.status, { color: st.c, backgroundColor: st.bg }]}>{st.t}</Text>
          </View>
        </View>

        <View style={s.dates}>
          <View style={s.date}><Text style={s.small}>Emissão</Text><Text style={s.dateV}>{dBR(p.emissao)}</Text></View>
          <View style={s.date}><Text style={s.small}>Entrega prevista</Text><Text style={s.dateV}>{dBR(p.previsao)}</Text></View>
          <View style={s.date}><Text style={s.small}>Comprador</Text><Text style={[s.dateV, p.comprador ? {} : s.pend]}>{p.comprador || "Não definido"}</Text></View>
          {p.contato ? <View style={s.date}><Text style={s.small}>Contato</Text><Text style={s.dateV}>{p.contato}</Text></View> : null}
        </View>

        <View style={s.parties}>
          <View style={[s.box, { flex: 1.4, marginRight: 10 }]}>
            <Text style={s.boxH}>Fornecedor</Text>
            <Text style={s.boxName}>{fornNome}</Text>
            <Text style={s.boxP}>CNPJ {forn.cnpj_cpf || p.cnpj || "—"}{forn.inscricao_estadual ? `   IE ${forn.inscricao_estadual}` : ""}</Text>
            {forn.endereco ? <Text style={s.boxP}>{linhaEnd(titulo(forn.endereco), forn.endereco_numero, forn.complemento || undefined)}</Text> : null}
            {forn.cidade ? <Text style={s.boxP}>{[forn.bairro && titulo(forn.bairro), [titulo(semUf(forn.cidade)), forn.estado].filter(Boolean).join("/"), forn.cep && `CEP ${cep(forn.cep)}`].filter(Boolean).join(", ")}</Text> : null}
            {tel ? <Text style={s.boxP}>{tel}</Text> : null}
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.boxH}>Condições</Text>
            <View style={s.kv}><Text style={s.kvK}>Prazo</Text><Text style={s.kvV}>{condicao || "—"}</Text></View>
            {v && <View style={s.kv}><Text style={s.kvK}>Forma de pagamento</Text><Text style={[s.kvV, forma ? {} : s.pend]}>{forma ?? "A definir"}</Text></View>}
            <View style={s.kv}><Text style={s.kvK}>Frete</Text><Text style={s.kvV}>{fretoCurto(fr.tipo)}{fr.transp ? ` · ${titulo(fr.transp)}` : ""}</Text></View>
            {p.numForn ? <View style={s.kv}><Text style={s.kvK}>Pedido do fornecedor</Text><Text style={s.kvV}>{p.numForn}</Text></View> : null}
          </View>
        </View>

        <Itens p={p} variante={variante} anteriores={anteriores} />

        {v && (
          <View style={s.bottom} wrap={false}>
            <View style={{ flex: 1.3, marginRight: 22 }}>
              <Text style={s.h3}>Pagamento</Text>
              <View style={s.inst}>
                <View style={s.instL}><Text style={[s.small, { width: 60 }]}>Parcela</Text><Text style={[s.small, { flex: 1 }]}>Vencimento</Text><Text style={[s.small, s.r, { width: 80 }]}>Valor</Text></View>
                {(p.parcelas ?? []).map((x) => (
                  <View key={x.n} style={s.instL}><Text style={{ width: 60, fontFamily: "Helvetica-Bold" }}>{x.n} de {p.parcelas.length}</Text>
                    <Text style={{ flex: 1, fontFamily: "Helvetica-Bold" }}>{dBR(x.venc)}</Text><Text style={[s.r, { width: 80, fontFamily: "Helvetica-Bold" }]}>{brl(x.valor)}</Text></View>
                ))}
                {!(p.parcelas ?? []).length && <Text style={s.noteS}>Sem parcelas lançadas.</Text>}
              </View>
              <View style={s.chips}>{METODOS.map((m) => <Text key={m} style={[s.chip, forma === m ? s.chipOn : {}]}>{m}</Text>)}</View>
              <Text style={s.noteS}>{forma ? `Forma de pagamento: ${forma}.` : "A forma de pagamento é definida na aprovação do pedido."}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.h3}>Resumo</Text>
              <View style={s.sumRow}><Text>Mercadorias</Text><Text style={{ color: TEXT }}>{brl(t.merc)}</Text></View>
              <View style={s.sumRow}><Text>Descontos</Text><Text style={{ color: TEXT }}>{brl(t.desc)}</Text></View>
              <View style={s.sumRow}><Text>Impostos (IPI + ST)</Text><Text style={{ color: TEXT }}>{brl(t.ipi + t.st)}</Text></View>
              <View style={s.sumRow}><Text>Frete</Text><Text style={{ color: TEXT }}>{brl(fr.valor)}</Text></View>
              {(fr.seguro || fr.outras) ? <View style={s.sumRow}><Text>Seguro e outras despesas</Text><Text style={{ color: TEXT }}>{brl((Number(fr.seguro) || 0) + (Number(fr.outras) || 0))}</Text></View> : null}
              <View style={s.grand}><Text style={{ fontSize: 8.8, opacity: 0.8 }}>Total do pedido</Text>
                <Text style={{ fontSize: 17, fontFamily: "Helvetica-Bold" }}>{brl(t.total)}</Text></View>
            </View>
          </View>
        )}

        <View style={s.nfe} wrap={false}>
          <Text>Informe o número <Text style={[s.forte, { color: INK }]}>{p.num}</Text> na NF-e, no campo “Pedido de compra” (xPed) de cada item. É por ele que conferimos o recebimento.</Text>
          <Text style={{ marginTop: 3, color: MUTED }}>No XML: #128m · I60 · xPed = número do pedido de compra ({p.num})   ·   #128n · I61 · nItemPed = item do pedido (coluna “#” acima)</Text>
        </View>
        {p.obs ? <View style={[s.nfe, { borderLeftColor: INK, backgroundColor: "#FFFFFF", border: `0.6 solid ${LINE}` }]} wrap={false}>
          <Text style={[s.h3, { marginBottom: 3 }]}>Observações</Text><Text>{p.obs}</Text></View> : null}

        <View style={s.signs} wrap={false}>
          <View style={[s.sign, { marginRight: 30 }]}><Text>Aprovação do comprador</Text>
            <Text style={[s.small, { marginTop: 2 }]}>{p.aprov === "aprovado" && p.aprovPor ? `Aprovado por ${p.aprovPor}${p.aprovEm ? ` em ${dBR(p.aprovEm.slice(0, 10))}` : ""}` : "Nome, data e assinatura"}</Text></View>
          <View style={s.sign}><Text>De acordo do fornecedor</Text><Text style={[s.small, { marginTop: 2 }]}>Nome, data e assinatura</Text></View>
        </View>

        <View style={s.foot} fixed>
          <Text>{empNome}, pedido de compra {p.num}</Text>
          <Text render={({ pageNumber, totalPages }) => `Emitido em ${emitido} por ${usuario} · Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Junta pedido + empresa + fornecedor + condição e devolve o PDF. */
export async function gerarPdfPedido(id: number, variante: VariantePdf, usuario: string, codigoAnterior = codigoAnteriorPadrao()) {
  const admin = supaAdmin();
  const { data: ped, error } = await admin.schema("orders").rpc("compras_pedido", { p_id: id });
  if (error) throw new Error(error.message);
  const p = ped as Pedido | null;
  if (!p) throw new Error("Pedido não encontrado");
  if (p.tipo !== "PC") throw new Error("Só pedido de compra vai ao fornecedor");
  const [{ data: emp }, { data: forn }, { data: parc }] = await Promise.all([
    admin.schema("orders").rpc("compras_empresa", { p_empresa: p.emp }),
    p.fornCod ? admin.schema("finance").from("clientes").select("razao_social, nome_fantasia, cnpj_cpf, inscricao_estadual, endereco, endereco_numero, complemento, bairro, cidade, estado, cep, email, telefone1_ddd, telefone1_numero")
      .eq("empresa", p.emp).eq("codigo_cliente_omie", p.fornCod).maybeSingle() : Promise.resolve({ data: null }),
    p.parc ? admin.schema("finance").from("parcelas").select("descricao").eq("codigo", p.parc).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // código anterior só para item cujo código no PC já é o código NOVO (recodificado) e o do Omie era outro
  const anteriores: Record<string, string> = {};
  const cods = [...new Set((p.itens ?? []).map((i) => i.cod).filter(Boolean) as string[])];
  if (codigoAnterior && cods.length) {
    const { data: rs } = await admin.schema("orders").rpc("item_codigo_resolver", { p_empresa: p.emp, p_codigos: cods });
    for (const r of (rs ?? []) as { codigo_usado: string; origem: string; codigo_omie_atual: string | null; codigo_novo_atual: string | null }[]) {
      if (r.origem === "recodificado" && r.codigo_novo_atual && r.codigo_usado.toUpperCase() === r.codigo_novo_atual.toUpperCase()
          && r.codigo_omie_atual && r.codigo_omie_atual.toUpperCase() !== r.codigo_usado.toUpperCase())
        anteriores[r.codigo_usado.toUpperCase()] = r.codigo_omie_atual;
    }
  }
  const doc = (
    <DocumentoPedido anteriores={anteriores} p={p} empresa={(emp ?? {}) as Empresa} forn={(forn ?? {}) as Fornecedor}
      condicao={(parc as { descricao?: string } | null)?.descricao ?? p.parc ?? ""} variante={variante}
      usuario={usuario} agora={new Date()} />
  );
  const blob = await pdf(doc).toBlob();
  return { pdf: new Uint8Array(await blob.arrayBuffer()), pedido: p, empresa: (emp ?? {}) as Empresa, fornecedor: (forn ?? {}) as Fornecedor };
}
