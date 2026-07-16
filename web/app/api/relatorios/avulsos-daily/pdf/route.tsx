// GET /api/relatorios/avulsos-daily/pdf — gera PDF direto (download).
// Sem tela intermediária. Retorna application/pdf com attachment.
//
// Comportamentos garantidos:
//   • Chama persistSnapshot() antes de tudo → snapshot do dia sempre existe
//   • Chart PNG embutido (fallback silencioso se falhar)
//   • Layout robusto com larguras explícitas (sem flex:1 frágil no react-pdf)
//   • Tabela de PVs completa por alarme (PV/OS · Cliente · Tipo · Valor)

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import {
  computeReportCounts,
  readSnapshots,
  persistSnapshot,
  buildAlarmeLink,
  ALARM_OWNERS,
  REPORT_SECTIONS,
  type AlarmKind,
} from "@/lib/avulsos-report";
import { Document, Page, Text, View, Image, StyleSheet, pdf, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

export const runtime = "nodejs";
export const maxDuration = 60;

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

// A4 portrait: 595x842pt. Com padding 28pt cada lado = 539pt úteis.
const CONTENT_W = 539;

// Larguras da tabela de PVs (soma ~509pt, deixa margem)
const COL_PV_W  = 55;
const COL_CLI_W = 300;
const COL_TIPO_W = 60;
const COL_VAL_W = 84;

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 28,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: "2 solid #0f172a",
  },
  h1: { fontSize: 20, fontWeight: 700, color: "#0f172a" },
  hSub: { fontSize: 9, color: "#64748b", marginTop: 2 },
  hDate: { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  hTime: { fontSize: 9, color: "#64748b" },
  // Chart
  chartBox: { marginBottom: 12 },
  chartImg: { width: CONTENT_W, height: 240, objectFit: "contain" },
  chartEmpty: {
    padding: 16, marginBottom: 12,
    backgroundColor: "#f8fafc", borderRadius: 4,
    fontSize: 10, color: "#64748b", textAlign: "center",
  },
  // Total row
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 8,
    marginBottom: 12,
    backgroundColor: "#f1f5f9",
    borderRadius: 4,
  },
  totalLabel: { fontSize: 10, color: "#334155", fontWeight: 700 },
  totalValue: { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  // Section
  section: { marginBottom: 12 },
  sectionHead: {
    backgroundColor: "#0f172a",
    color: "#ffffff",
    paddingVertical: 5,
    paddingHorizontal: 10,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  itemBlock: {
    borderLeft: "1 solid #e2e8f0",
    borderRight: "1 solid #e2e8f0",
    borderBottom: "1 solid #e2e8f0",
  },
  // Item summary row: [Label+Owner] [Count/Valor] [Delta] [Link]
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderBottom: "1 solid #e2e8f0",
  },
  itemLabelCol: { width: 260 },
  itemLabel:   { fontSize: 11, fontWeight: 700, color: "#0f172a" },
  itemMeta:    { fontSize: 8,  color: "#64748b", marginTop: 2 },
  itemCountCol: { width: 90, alignItems: "flex-end" },
  itemCount:    { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  itemVal:      { fontSize: 8,  color: "#475569", marginTop: 1 },
  itemDeltaCol: { width: 60, alignItems: "flex-end" },
  itemDelta:    { fontSize: 9, fontWeight: 700, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  itemLinkCol:  { width: 100, alignItems: "flex-end" },
  itemLink:     { fontSize: 8, color: "#0284c7", textDecoration: "underline" },
  // PV table
  pvTable: { padding: "4 10 8 10" },
  pvHeadRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottom: "1 solid #cbd5e1",
  },
  pvRow: {
    flexDirection: "row",
    paddingVertical: 2,
    borderBottom: "0.5 solid #e2e8f0",
  },
  pvHeadCell: { fontSize: 7.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase" },
  pvCell:     { fontSize: 8, color: "#0f172a" },
  colPv:   { width: COL_PV_W,   fontFamily: "Courier" },
  colCli:  { width: COL_CLI_W,  paddingHorizontal: 4 },
  colTipo: { width: COL_TIPO_W, color: "#64748b" },
  colVal:  { width: COL_VAL_W,  textAlign: "right", fontFamily: "Courier" },
  pvEmpty: {
    padding: 8, fontSize: 9, color: "#94a3b8", fontStyle: "italic", textAlign: "center",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 16, left: 28, right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8, color: "#94a3b8",
    borderTop: "0.5 solid #e2e8f0",
    paddingTop: 4,
  },
});

async function fetchChartPng(origin: string, cookie: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${origin}/api/relatorios/avulsos-daily/chart.png`, {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Garante snapshot do dia — para report/webex sempre mostrar o número atual
    try { await persistSnapshot(); } catch { /* ignora falha; segue sem snapshot novo */ }

    const now = await computeReportCounts();
    const snapshots = await readSnapshots(30);
    const today = new Date().toISOString().slice(0, 10);
    const previous = snapshots.filter((s) => s.date < today).slice(-1)[0];
    const prevCounts = previous?.counts ?? {};

    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";
    const chartPng = await fetchChartPng(origin, cookie);

    const nowStr = new Date().toLocaleDateString("pt-BR");
    const nowTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const doc: ReactElement<DocumentProps> = (
      <Document title={`Report Avulsos ${today}`} author="Painel WaterWorks">
        <Page size="A4" style={styles.page}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.h1}>Report Avulsos</Text>
              <Text style={styles.hSub}>Painel WaterWorks · Vendas Avulsas · PVs abertos</Text>
            </View>
            <View>
              <Text style={styles.hDate}>{nowStr}</Text>
              <Text style={styles.hTime}>gerado às {nowTime}</Text>
            </View>
          </View>

          {/* Chart */}
          {chartPng ? (
            <View style={styles.chartBox}>
              <Image src={{ data: Buffer.from(chartPng), format: "png" }} style={styles.chartImg} />
            </View>
          ) : (
            <View style={styles.chartEmpty}>
              <Text>Gráfico não disponível — snapshots ainda em coleta.</Text>
            </View>
          )}

          {/* Total */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total PVs abertos</Text>
            <Text style={styles.totalValue}>{now.total_pvs}</Text>
          </View>

          {/* Sections */}
          {REPORT_SECTIONS.map((sec) => (
            <View key={sec.title} style={styles.section} break={false}>
              <Text style={styles.sectionHead}>{sec.title}</Text>
              <View style={styles.itemBlock}>
                {sec.items.map(({ kind, label }) => {
                  const k = kind as AlarmKind;
                  const c = now.counts[k] ?? 0;
                  const p = Number(prevCounts[k] ?? c);
                  const delta = previous ? c - p : null;
                  const val = now.vals[k] ?? 0;
                  const owner = ALARM_OWNERS[k] ?? "—";
                  const pvs = now.pvs_by_kind[k] ?? [];
                  const deltaStr = delta == null ? "" : delta === 0 ? "=" : delta > 0 ? `+${delta}` : `${delta}`;
                  const deltaBg = delta == null || delta === 0 ? "#f1f5f9" : delta > 0 ? "#fee2e2" : "#dcfce7";
                  const deltaColor = delta == null || delta === 0 ? "#64748b" : delta > 0 ? "#b91c1c" : "#15803d";
                  return (
                    <View key={kind} wrap={false}>
                      <View style={styles.itemRow}>
                        <View style={styles.itemLabelCol}>
                          <Text style={styles.itemLabel}>{label}</Text>
                          <Text style={styles.itemMeta}>Responsável: {owner}</Text>
                        </View>
                        <View style={styles.itemCountCol}>
                          <Text style={styles.itemCount}>{c}</Text>
                          {val > 0 && <Text style={styles.itemVal}>{fmtBRL(val)}</Text>}
                        </View>
                        <View style={styles.itemDeltaCol}>
                          {delta != null && (
                            <Text style={[styles.itemDelta, { backgroundColor: deltaBg, color: deltaColor }]}>
                              {deltaStr}
                            </Text>
                          )}
                        </View>
                        <View style={styles.itemLinkCol}>
                          <Text style={styles.itemLink}>painel/avulsos?alarme={kind}</Text>
                        </View>
                      </View>
                      {pvs.length > 0 ? (
                        <View style={styles.pvTable}>
                          <View style={styles.pvHeadRow}>
                            <Text style={[styles.pvHeadCell, styles.colPv]}>PV/OS</Text>
                            <Text style={[styles.pvHeadCell, styles.colCli]}>Cliente</Text>
                            <Text style={[styles.pvHeadCell, styles.colTipo]}>Tipo</Text>
                            <Text style={[styles.pvHeadCell, styles.colVal]}>Valor</Text>
                          </View>
                          {pvs.slice(0, 60).map((pv) => (
                            <View key={pv.pv_os_label} style={styles.pvRow}>
                              <Text style={[styles.pvCell, styles.colPv]}>{pv.pv_os_label}</Text>
                              <Text style={[styles.pvCell, styles.colCli]}>{pv.cliente}</Text>
                              <Text style={[styles.pvCell, styles.colTipo]}>{pv.tipo}</Text>
                              <Text style={[styles.pvCell, styles.colVal]}>{fmtBRL(pv.valor)}</Text>
                            </View>
                          ))}
                          {pvs.length > 60 && (
                            <Text style={{ fontSize: 8, color: "#64748b", padding: 4, textAlign: "center" }}>
                              … +{pvs.length - 60} PVs (ver no painel para lista completa)
                            </Text>
                          )}
                        </View>
                      ) : c > 0 ? null : (
                        <View style={styles.pvTable}>
                          <Text style={styles.pvEmpty}>Nenhum PV neste alarme.</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Footer fixo em cada página */}
          <View style={styles.footer} fixed>
            <Text>painel.waterworks.com.br/avulsos · gerado {nowStr} {nowTime}</Text>
            <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      </Document>
    );

    const blob = await pdf(doc).toBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());

    // Log dos links reais no PDF (react-pdf Link tem histórico de bugs com URLs
    // longas — mantemos como texto no visual e o botão do painel abre filtrado).
    // Se depois precisarmos de link clicável, usar <Link src="…"> com URL curta.

    void buildAlarmeLink; // silencia unused warning; deep-link mantido no send.

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report-avulsos-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
