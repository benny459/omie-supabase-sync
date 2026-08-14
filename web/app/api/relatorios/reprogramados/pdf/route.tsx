// GET /api/relatorios/reprogramados/pdf?cods=1,2,3 — PDF direto (download).
//
// Prova do que foi reprogramado: por título, a data original do Omie, a nova, e
// quantos dias andou. Lê a MESMA função da tela (bi.titulos_reprogramados), então
// PDF, Excel e tela não podem divergir.
//
// A4 PAISAGEM de propósito: são 11 colunas e nome de contraparte é longo. Em
// retrato, ou a coluna de contraparte trunca em 20 caracteres ou o valor sai da
// página. Larguras explícitas — flex:1 no react-pdf é frágil e colapsa colunas
// sem avisar.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { Document, Page, Text, View, StyleSheet, pdf, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { carregar, parseCods, type LinhaReprog } from "../route";

export const runtime = "nodejs";
export const maxDuration = 60;

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
    .format(Number(v) || 0);
const dataBr = (v: string | null) => {
  if (!v) return "—";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

// A4 paisagem: 842x595pt. Padding 24pt de cada lado = 794pt úteis.
const W = {
  tipo: 44, emp: 30, contraparte: 150, categoria: 120, titulo: 46,
  venc: 54, prevAnt: 58, prevNova: 58, dias: 34, valor: 66, omie: 46,
};
const TOTAL_W = Object.values(W).reduce((a, b) => a + b, 0);

const s = StyleSheet.create({
  page:   { padding: 24, fontSize: 7.5, color: "#1e293b", backgroundColor: "#ffffff" },
  h1:     { fontSize: 14, fontWeight: "bold", marginBottom: 2 },
  sub:    { fontSize: 8, color: "#64748b", marginBottom: 10 },
  kpis:   { flexDirection: "row", gap: 14, marginBottom: 10 },
  kpiBox: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4, padding: 6, minWidth: 118 },
  kpiRot: { fontSize: 6.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 11, fontWeight: "bold", marginTop: 2 },
  thead:  { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 1,
            borderBottomColor: "#cbd5e1", paddingVertical: 4 },
  th:     { fontSize: 6.5, fontWeight: "bold", color: "#475569",
            textTransform: "uppercase", letterSpacing: 0.3, paddingHorizontal: 3 },
  tr:     { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0",
            paddingVertical: 3.5 },
  td:     { fontSize: 7, paddingHorizontal: 3 },
  right:  { textAlign: "right" },
  foot:   { marginTop: 10, fontSize: 6.5, color: "#94a3b8" },
  totRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#cbd5e1",
            paddingTop: 4, marginTop: 2 },
});

export async function GET(req: Request) {
  try {
    const supa = await supaServer();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const perms = await loadPerms();
    if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
      return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
    }

    const cods = parseCods(new URL(req.url).searchParams.get("cods"));
    const { data, error } = await carregar(cods);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const linhas = (data ?? []) as LinhaReprog[];
    const num = (v: unknown) => Number(v) || 0;
    const entradas = linhas.filter((l) => l.natureza === "R").reduce((a, l) => a + num(l.valor), 0);
    const saidas   = linhas.filter((l) => l.natureza === "P").reduce((a, l) => a + num(l.valor), 0);
    const noOmie   = linhas.filter((l) => l.enviado_omie).length;
    const hoje = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const arquivoData = new Date().toISOString().slice(0, 10);

    const doc = (
      <Document>
        <Page size="A4" orientation="landscape" style={s.page}>
          <Text style={s.h1}>Títulos reprogramados</Text>
          <Text style={s.sub}>
            Previsão alterada no painel · gerado em {hoje}
            {cods ? ` · seleção de ${cods.length} título(s)` : " · todos os reprogramados em aberto"}
          </Text>

          <View style={s.kpis}>
            <View style={s.kpiBox}>
              <Text style={s.kpiRot}>Títulos</Text>
              <Text style={s.kpiVal}>{linhas.length}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiRot}>Entradas</Text>
              <Text style={s.kpiVal}>{fmtBRL(entradas)}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiRot}>Saídas</Text>
              <Text style={s.kpiVal}>{fmtBRL(saidas)}</Text>
            </View>
            <View style={s.kpiBox}>
              <Text style={s.kpiRot}>Já enviados ao Omie</Text>
              <Text style={s.kpiVal}>{noOmie} de {linhas.length}</Text>
            </View>
          </View>

          <View style={s.thead} fixed>
            <Text style={[s.th, { width: W.tipo }]}>Tipo</Text>
            <Text style={[s.th, { width: W.emp }]}>Emp</Text>
            <Text style={[s.th, { width: W.contraparte }]}>Contraparte</Text>
            <Text style={[s.th, { width: W.categoria }]}>Categoria</Text>
            <Text style={[s.th, { width: W.titulo }]}>Título</Text>
            <Text style={[s.th, { width: W.venc }]}>Vencto</Text>
            <Text style={[s.th, { width: W.prevAnt }]}>Prev. orig.</Text>
            <Text style={[s.th, { width: W.prevNova }]}>Prev. nova</Text>
            <Text style={[s.th, { width: W.dias }, s.right]}>Dias</Text>
            <Text style={[s.th, { width: W.valor }, s.right]}>Valor</Text>
            <Text style={[s.th, { width: W.omie }]}>Omie</Text>
          </View>

          {linhas.length === 0 && (
            <Text style={{ fontSize: 9, marginTop: 14, color: "#64748b" }}>
              Nenhum título reprogramado.
            </Text>
          )}

          {linhas.map((l) => (
            <View key={l.cod_titulo} style={s.tr} wrap={false}>
              <Text style={[s.td, { width: W.tipo }]}>{l.tipo}</Text>
              <Text style={[s.td, { width: W.emp }]}>{l.empresa}</Text>
              <Text style={[s.td, { width: W.contraparte }]}>{l.contraparte}</Text>
              <Text style={[s.td, { width: W.categoria }]}>{l.categoria}</Text>
              <Text style={[s.td, { width: W.titulo }]}>{l.num_titulo}</Text>
              <Text style={[s.td, { width: W.venc }]}>{dataBr(l.vencimento)}</Text>
              <Text style={[s.td, { width: W.prevAnt }]}>{dataBr(l.previsao_original)}</Text>
              <Text style={[s.td, { width: W.prevNova, fontWeight: "bold" }]}>
                {dataBr(l.previsao_nova)}
              </Text>
              <Text style={[s.td, { width: W.dias }, s.right]}>
                {l.dias_movidos == null ? "—" : `${l.dias_movidos > 0 ? "+" : ""}${l.dias_movidos}`}
              </Text>
              <Text style={[s.td, { width: W.valor }, s.right]}>{fmtBRL(l.valor)}</Text>
              <Text style={[s.td, { width: W.omie }]}>{l.enviado_omie ? "enviado" : "pendente"}</Text>
            </View>
          ))}

          {linhas.length > 0 && (
            <View style={s.totRow}>
              <Text style={[s.th, { width: TOTAL_W - W.valor - W.omie }]}>Total</Text>
              <Text style={[s.td, { width: W.valor, fontWeight: "bold" }, s.right]}>
                {fmtBRL(entradas + saidas)}
              </Text>
              <Text style={[s.td, { width: W.omie }]} />
            </View>
          )}

          <Text style={s.foot} fixed>
            Dias = quantos dias a previsão andou em relação à data original do Omie. "Pendente" =
            gravado no painel e ainda não enviado ao Omie, então o Omie segue com a data antiga.
          </Text>
        </Page>
      </Document>
    ) as ReactElement<DocumentProps>;

    const blob = await pdf(doc).toBlob();
    const buf = Buffer.from(await blob.arrayBuffer());

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="titulos-reprogramados-${arquivoData}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
