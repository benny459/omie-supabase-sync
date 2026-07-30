// PNG do gráfico de evolução (14d) usando next/og (Satori).
// Anexado ao envio Webex e também acessível standalone via URL.
//
// Renderiza multi-linhas por AlarmKind ao longo dos snapshots reais.
import { ImageResponse } from "next/og";
import { readSnapshots, type AlarmKind } from "@/lib/avulsos-report";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CHART_COLORS: Record<AlarmKind, string> = {
  pvos_incompl:      "#dc2626", // red-600
  sem_projeto:       "#be123c", // rose-800
  aguarda_liberacao: "#d97706", // amber-600
  venda:             "#f43f5e",
  compra:            "#f97316",
  sem_rc:            "#8b5cf6",
  sem_pc:            "#a855f7",
  aprov_pend:        "#f59e0b",
  aprov_bloq:        "#7c3aed", // violet-600
  retido_cliente:    "#eab308", // yellow-500 — pronto, mas a bola está com o cliente
  defas_omie:        "#ec4899",
  sem_vinculo:       "#14b8a6",
  agend_vazio:       "#06b6d4",
  agend_venc:        "#0ea5e9",
  pode_faturar:      "#10b981",
};
const CHART_LABEL: Record<AlarmKind, string> = {
  pvos_incompl:      "PV/OS incompl.",
  sem_projeto:       "Sem Projeto",
  aguarda_liberacao: "Aguard. Liberação",
  venda: "Vendas atraso", compra: "Previsão atrasada",
  sem_rc: "RC ausente", sem_pc: "PC ausente", aprov_pend: "Aprov pend",
  aprov_bloq: "Aprov bloq",
  defas_omie: "Defas Omie", sem_vinculo: "Sem Vínculo",
  agend_vazio: "Sem prev.", agend_venc: "Prev vencida",
  pode_faturar: "Faturável", retido_cliente: "Retido cliente",
};

export async function GET() {
  try {
    const snapshots = await readSnapshots(14);
    const W = 1200, H = 630;
    const PAD_L = 60, PAD_R = 260, PAD_T = 80, PAD_B = 80;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    // Kinds com pelo menos 1 ponto > 0
    const KINDS = Object.keys(CHART_COLORS) as AlarmKind[];
    const kinds = KINDS.filter((k) => snapshots.some((d) => Number(d.counts[k] ?? 0) > 0));

    const maxY = Math.max(1, ...snapshots.flatMap((d) => kinds.map((k) => Number(d.counts[k] ?? 0))));
    const yTicks = 4;
    const xStep = snapshots.length > 1 ? innerW / (snapshots.length - 1) : innerW;
    const xy = (i: number, v: number) => ({
      x: PAD_L + i * xStep,
      y: PAD_T + innerH - (v / maxY) * innerH,
    });

    // Y grid + labels
    const yGrid: React.ReactNode[] = [];
    for (let i = 0; i <= yTicks; i++) {
      const v = Math.round((maxY / yTicks) * i);
      const y = PAD_T + innerH - (v / maxY) * innerH;
      yGrid.push(
        <line key={`gh${i}`} x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
          stroke="#e5e7eb" strokeWidth={1} strokeDasharray="3,4" />
      );
      yGrid.push(
        <text key={`gt${i}`} x={PAD_L - 10} y={y + 5} fontSize={16} fill="#64748b" textAnchor="end">{v}</text>
      );
    }

    // X labels — 5 marks equidistantes
    const xLabels: React.ReactNode[] = [];
    const nLabels = Math.min(snapshots.length, 5);
    for (let li = 0; li < nLabels; li++) {
      const i = Math.round((snapshots.length - 1) * (li / Math.max(1, nLabels - 1)));
      const { x } = xy(i, 0);
      const [, mm, dd] = snapshots[i].date.split("-");
      xLabels.push(
        <text key={`xl${li}`} x={x} y={H - PAD_B + 24} fontSize={16} fill="#64748b" textAnchor="middle">{dd}/{mm}</text>
      );
    }

    // Séries
    const seriesEls: React.ReactNode[] = [];
    kinds.forEach((k) => {
      const pts = snapshots.map((d, i) => xy(i, Number(d.counts[k] ?? 0)));
      const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      seriesEls.push(
        <path key={`p${k}`} d={path} fill="none" stroke={CHART_COLORS[k]} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      );
      pts.forEach((p, i) => {
        seriesEls.push(<circle key={`c${k}${i}`} cx={p.x} cy={p.y} r={4} fill={CHART_COLORS[k]} />);
      });
    });

    // Legenda à direita — 1 linha por kind
    const legend: React.ReactNode[] = [];
    kinds.forEach((k, i) => {
      const y = PAD_T + i * 30 + 12;
      const last = Number(snapshots[snapshots.length - 1].counts[k] ?? 0);
      legend.push(
        <rect key={`ll${k}`} x={W - PAD_R + 20} y={y - 12} width={16} height={16} rx={3} fill={CHART_COLORS[k]} />
      );
      legend.push(
        <text key={`lt${k}`} x={W - PAD_R + 44} y={y} fontSize={18} fill="#1e293b">{CHART_LABEL[k]}</text>
      );
      legend.push(
        <text key={`lv${k}`} x={W - 20} y={y} fontSize={18} fill="#64748b" textAnchor="end" fontWeight={700}>{last}</text>
      );
    });

    // Se não tiver dados
    const emptyState = snapshots.length === 0 || kinds.length === 0;

    return new ImageResponse(
      (
        <div style={{
          width: W, height: H, background: "white", display: "flex", flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif", padding: 0,
        }}>
          <div style={{
            padding: "24px 40px", borderBottom: "2px solid #e5e7eb",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#0f172a" }}>Evolução Avulsos</span>
              <span style={{ fontSize: 14, color: "#64748b", marginTop: 2 }}>
                Últimos {snapshots.length} snapshot(s) · Painel WaterWorks
              </span>
            </div>
            <span style={{ fontSize: 14, color: "#64748b" }}>{new Date().toLocaleDateString("pt-BR")}</span>
          </div>
          {emptyState ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 24 }}>
              Sem snapshots ainda — cron 07:55 SP começará a acumular.
            </div>
          ) : (
            <svg width={W} height={H - 90} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
              {yGrid}
              {xLabels}
              {seriesEls}
              {legend}
            </svg>
          )}
        </div>
      ),
      { width: W, height: H }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
