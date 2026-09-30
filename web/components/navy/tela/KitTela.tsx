"use client";

/**
 * Kit das telas do Allka Navy — porte do motor de telas do "Painel Allka
 * finance" (o protótipo que o Benny enviou em 30/09/26).
 *
 * O protótipo desenha todas as telas com o mesmo esqueleto:
 *
 *   cabeçalho (área · título · de onde vem o dado · acções)
 *   → faixa de filtros
 *   → KPIs (um hero navy + cards com brilho e fio de cor no topo)
 *   → gráfico + painel lateral
 *   → árvore expansível com filtro e ordenação no cabeçalho de cada coluna
 *
 * Aqui ficam as peças desse esqueleto; cada tela só decide os DADOS. Regra do
 * handoff mantida: nada aqui calcula negócio — recebe números prontos.
 *
 * A árvore não filtra nós, filtra REGISTOS: a tela entrega a lista plana e a
 * função que a agrupa. Filtrar nós deixava os totais dos pais a contar o que
 * o filtro tinha escondido; filtrando os registos e reagrupando, o total do
 * grupo é sempre a soma do que está à vista.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Chevron, ProgressBar, tom, type Tom } from "../primitivos";
import { useCesar } from "@/components/cesar/CesarProvider";

// ── Moeda e números ─────────────────────────────────────────────────────────
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const BRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** Linha: R$ 92.300,00 (centavos contam num título). */
export const brl = (v: number) => BRL2.format(v || 0);
/** Arredondado: R$ 92.300. */
export const brl0 = (v: number) => BRL0.format(v || 0);
/** KPI: R$ 61 mil / R$ 1,84 mi — a escala do modelo. */
export function kbrl(v: number): string {
  const a = Math.abs(v || 0), sinal = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sinal}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} mi`;
  if (a >= 1e3) return `${sinal}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
  return `${sinal}R$ ${Math.round(a).toLocaleString("pt-BR")}`;
}
export const pct = (v: number, casas = 1) =>
  `${(Number.isFinite(v) ? v : 0).toFixed(casas).replace(".", ",")}%`;

// ── Estilos partilhados ─────────────────────────────────────────────────────
export const cartao: CSSProperties = {
  borderRadius: "var(--radius-panel)", background: "var(--ww-panel-grad)",
  border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-card)", minWidth: 0,
};

const botaoBase: CSSProperties = {
  height: 34, padding: "0 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
};

/** Botão do cabeçalho — primário (gradiente + brilho) ou fantasma. */
export function BotaoTela({ primario, children, onClick, disabled, title }: {
  primario?: boolean; children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{
      ...botaoBase,
      opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer",
      border: primario ? 0 : "1px solid var(--ww-border-strong)",
      background: primario ? "linear-gradient(180deg,var(--ww-brand-2),var(--ww-brand-1))" : "transparent",
      color: primario ? "#fff" : "var(--ww-text-2)",
      boxShadow: primario ? "0 0 16px color-mix(in srgb,var(--ww-brand-3) 30%,transparent)" : "none",
    }}>{children}</button>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────
export function PaginaNavy({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 48, minWidth: 0 }}>
      {children}
    </div>
  );
}

export function CabecalhoTela({ area, titulo, sub, acoes }: {
  area: string; titulo: string; sub?: ReactNode; acoes?: ReactNode;
}) {
  return (
    <header style={{ ...cartao, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "16px 20px" }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: 12, color: "var(--ww-text-faint)", fontWeight: 600 }}>{area}</div>
        <h1 style={{
          margin: "2px 0 0", fontSize: 22, fontWeight: 700, letterSpacing: "-.02em",
          color: "var(--ww-text)", fontFamily: "var(--font-display)",
        }}>{titulo}</h1>
        {sub != null && <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", marginTop: 3 }}>{sub}</div>}
      </div>
      {acoes && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{acoes}</div>}
    </header>
  );
}

/** Pílula de filtro do modelo (6/13px, raio 999). */
export function ChipFiltro({ ativo, onClick, children, title }: {
  ativo?: boolean; onClick?: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} style={{
      padding: "6px 13px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
      fontWeight: ativo ? 600 : 500,
      border: "1px solid " + (ativo ? "var(--ww-brand-3)" : "var(--ww-border-strong)"),
      color: ativo ? "var(--ww-accent-text)" : "var(--ww-text-2)",
      background: ativo ? "color-mix(in srgb,var(--ww-brand-3) 8%,transparent)" : "transparent",
      boxShadow: ativo ? "0 0 12px color-mix(in srgb,var(--ww-brand-3) 22%,transparent)" : "none",
      whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

export function FaixaFiltros({ children, busca, onBusca, placeholder }: {
  children?: ReactNode; busca?: string; onBusca?: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {children}
      {onBusca && (
        <div style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, height: 34,
          width: 260, maxWidth: "100%", padding: "0 12px", borderRadius: 10,
          background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-strong)",
          color: "var(--ww-text-faint)", fontSize: 12.5,
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input value={busca ?? ""} onChange={(e) => onBusca(e.target.value)} placeholder={placeholder ?? "Buscar…"}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
                     color: "var(--ww-text)", fontSize: 12.5, fontFamily: "inherit" }} />
        </div>
      )}
    </div>
  );
}

/** Campo de data no tom da faixa de filtros. */
export function CampoData({ valor, onChange, title }: { valor: string; onChange: (v: string) => void; title?: string }) {
  return (
    <input type="date" value={valor} title={title} onChange={(e) => onChange(e.target.value)} style={{
      height: 32, padding: "0 10px", borderRadius: 999, fontSize: 12.5, fontFamily: "inherit",
      border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
    }} />
  );
}

export function Aviso({ tone = "crit", children }: { tone?: Tom; children: ReactNode }) {
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 12, fontSize: 12.5,
      background: tom(tone).bg, color: tom(tone).fg, border: `1px solid ${tom(tone).dot}`,
    }}>{children}</div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div style={{ ...cartao, padding: 40, textAlign: "center", color: "var(--ww-text-muted)", fontSize: 13 }}>{texto}</div>
  );
}

// ── KPIs ────────────────────────────────────────────────────────────────────
export type Kpi = {
  rotulo: string;
  valor: ReactNode;
  sub?: ReactNode;
  /** Tom do subtítulo — "vence hoje" em âmbar, "vencidos" em coral. */
  subTom?: Tom;
  /** Card navy de destaque. Um por tela. */
  hero?: boolean;
  /** Quadradinho de cor antes do rótulo (categorias). */
  dot?: string;
  barra?: { pct: number; tom?: Tom };
  title?: string;
  onClick?: () => void;
};

const BRILHOS = [
  "color-mix(in srgb,var(--ww-brand-2) 38%,transparent)",
  "color-mix(in srgb,var(--ww-brand-3) 32%,transparent)",
  "rgba(154,130,255,.32)", "rgba(25,198,166,.28)", "rgba(245,197,66,.26)", "rgba(255,107,74,.26)",
];
const FIOS = [
  "linear-gradient(90deg,var(--ww-brand-1),var(--ww-brand-2))",
  "linear-gradient(90deg,var(--ww-brand-2),var(--ww-brand-3))",
  "linear-gradient(90deg,#9A82FF,#bfaeff)", "linear-gradient(90deg,#19C6A6,var(--ww-brand-3))",
  "linear-gradient(90deg,#F5C542,#FF8F73)", "linear-gradient(90deg,#FF6B4A,#FF8F73)",
];

export function GradeKpis({ kpis, min = 190 }: { kpis: Kpi[]; min?: number }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`, gap: 14 }}>
      {kpis.map((k, i) => {
        const brilho = k.dot ? `color-mix(in srgb,${k.dot} 35%,transparent)` : BRILHOS[i % 6];
        return (
          <div key={i} title={k.title} onClick={k.onClick} style={{
            position: "relative", overflow: "hidden", borderRadius: 16, padding: "16px 18px",
            background: k.hero ? "var(--ww-hero-grad)" : "var(--ww-panel-grad)",
            border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-card)",
            display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
            color: k.hero ? "var(--ww-hero-text)" : "var(--ww-text)",
            cursor: k.onClick ? "pointer" : "default",
          }}>
            <span style={{ position: "absolute", right: -50, top: -60, width: 170, height: 170, borderRadius: "50%",
                           background: `radial-gradient(circle,${brilho},transparent 68%)`, pointerEvents: "none" }} />
            <span style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: FIOS[i % 6] }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
              {k.dot && <span style={{ width: 9, height: 9, borderRadius: 3, background: k.dot }} />}
              {k.rotulo}
            </div>
            <div style={{ position: "relative", fontSize: 24, fontWeight: 700, letterSpacing: "-.02em",
                          whiteSpace: "nowrap", fontFamily: "var(--font-display)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {k.valor}
            </div>
            {k.sub != null && (
              <div style={{ position: "relative", fontSize: 12,
                            color: k.subTom ? tom(k.subTom).fg : k.hero ? "var(--ww-hero-text-2)" : "var(--ww-text-muted)" }}>
                {k.sub}
              </div>
            )}
            {k.barra && (
              <div style={{ position: "relative", marginTop: 2 }}>
                <ProgressBar value={k.barra.pct} tone={k.barra.tom ?? "info"} height={6} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── Gráficos ────────────────────────────────────────────────────────────────
export type Legenda = { nome: string; cor: string };

/** Os dois botões que todo gráfico da tela antiga tinha (ChartFrame): perguntar
 *  ao Cesar sobre ele, levando os números que estão na tela, e ver os mesmos
 *  números como tabela. Tirá-los seria perder função, não só enfeite. */
function BotoesGrafico({ titulo, contexto, tabela, setTabela }: {
  titulo: string; contexto: string; tabela?: boolean; setTabela?: (v: boolean) => void;
}) {
  const cesar = useCesar();
  const b: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 8px", borderRadius: 7, fontSize: 11, fontWeight: 600,
    cursor: "pointer", border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-muted)", whiteSpace: "nowrap",
  };
  return (<>
    <button type="button" style={b} title="Perguntar ao Cesar sobre este gráfico"
      onClick={() => cesar.abrir({ origem: titulo, contexto })}>
      <span style={{ width: 13, height: 13, borderRadius: "50%", background: "linear-gradient(135deg,#0ea5e9,#8b5cf6)", color: "#fff", fontSize: 8, fontWeight: 700, display: "grid", placeItems: "center" }}>C</span>
      Cesar
    </button>
    {setTabela && <button type="button" style={{ ...b, color: tabela ? "var(--ww-accent-text)" : b.color, borderColor: tabela ? "var(--ww-brand-3)" : undefined }}
      onClick={() => setTabela(!tabela)} aria-pressed={tabela}>Tabela</button>}
  </>);
}

const textoDe = (x: ReactNode) => (typeof x === "string" || typeof x === "number" ? String(x) : "");

function TabelaDoGrafico({ cab, linhas }: { cab: string[]; linhas: (string | number)[][] }) {
  return (
    <div style={{ overflow: "auto", maxHeight: 260, border: "1px solid var(--ww-border-subtle)", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr>{cab.map((c, i) => <th key={i} style={{ padding: "6px 10px", textAlign: i ? "right" : "left", color: "var(--ww-text-faint)", fontWeight: 600, background: "var(--ww-panel-sunken)", position: "sticky", top: 0 }}>{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} style={{ padding: "5px 10px", textAlign: j ? "right" : "left", borderTop: "1px dashed var(--ww-border-subtle)" }}>
          {typeof v === "number" ? brl0(v) : v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function CabecalhoGrafico({ titulo, legenda, extra, botoes }: { titulo: ReactNode; legenda?: Legenda[]; extra?: ReactNode; botoes?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, flex: "1 1 100%", minWidth: 220, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ flex: 1 }}>{titulo}</span>{extra}{botoes}
      </div>
      {(legenda ?? []).map((l) => (
        <span key={l.nome} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ww-text-muted)" }}>
          <span style={{ width: 10, height: 4, borderRadius: 2, background: l.cor }} />{l.nome}
        </span>
      ))}
    </div>
  );
}

export type ColunaBarra = {
  rotulo: string;
  /** Texto por cima da barra ("R$ 12k", "4 pend."). */
  topo?: string;
  topoCor?: string;
  /** Tooltip. */
  title?: string;
  segs: { v: number; cor: string; brilho?: boolean }[];
  onClick?: () => void;
  /** Fica fora da escala: desenha-se no teto, cortada, com o valor no topo.
   *  Serve para o balde de vencidos, que achatava os dias todos. */
  foraEscala?: boolean;
};

/** Barras empilhadas do modelo: 200px de altura, segmentos de baixo para cima. */
export function GraficoBarras({ titulo, colunas, legenda, extra, altura = 200, agrupado = false }: {
  titulo: ReactNode; colunas: ColunaBarra[]; legenda?: Legenda[]; extra?: ReactNode; altura?: number;
  /** Segmentos lado a lado em vez de empilhados — para séries que não se
   *  somam (a receber × a pagar). A escala passa a ser a do maior segmento. */
  agrupado?: boolean;
}) {
  const somaCol = (c: ColunaBarra) => agrupado
    ? Math.max(0, ...c.segs.map((s) => s.v))
    : c.segs.reduce((a, s) => a + Math.max(0, s.v), 0);
  const naEscala = colunas.filter((c) => !c.foraEscala);
  const mx = Math.max(1e-9, ...(naEscala.length ? naEscala : colunas).map(somaCol));
  const util = altura - 18;
  const passoRotulo = Math.max(1, Math.ceil(colunas.length / 14));
  /* Rótulo de topo só nas colunas maiores — trinta rótulos em cima de trinta
     barras finas atropelam-se e não se lê nenhum. */
  const [tabela, setTabela] = useState(false);
  const nomes = (i: number) => legenda?.[i]?.nome ?? `série ${i + 1}`;
  const nSeg = Math.max(0, ...colunas.map((c) => c.segs.length));
  const cabT = ["", ...Array.from({ length: nSeg }, (_, i) => nomes(i)), ...(nSeg > 1 ? ["Total"] : [])];
  const linT = colunas.map((c) => [c.title ?? c.rotulo, ...c.segs.map((s) => s.v), ...(nSeg > 1 ? [c.segs.reduce((a, s) => a + s.v, 0)] : [])]);
  const contexto = [`Gráfico: ${textoDe(titulo)}`, cabT.join(" | "), ...linT.slice(0, 40).map((l) => l.map((v) => (typeof v === "number" ? v.toFixed(2) : v)).join(" | "))].join("\n");
  const botoes = <BotoesGrafico titulo={textoDe(titulo) || "Gráfico"} contexto={contexto} tabela={tabela} setTabela={setTabela} />;
  const maiores = new Set(colunas.map((c, i) => [somaCol(c), i] as const)
    .sort((a, b) => b[0] - a[0]).slice(0, Math.max(6, Math.ceil(14 / passoRotulo))).map(([, i]) => i));
  return (
    <div style={{ ...cartao, padding: "18px 20px" }}>
      <CabecalhoGrafico titulo={titulo} legenda={legenda} extra={extra} botoes={botoes} />
      {tabela ? <TabelaDoGrafico cab={cabT} linhas={linT} /> : colunas.length === 0 ? (
        <div style={{ height: altura, display: "grid", placeItems: "center", color: "var(--ww-text-faint)", fontSize: 12.5 }}>Sem dados no período</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: altura,
                        borderBottom: "1px solid color-mix(in srgb,var(--ww-brand-2) 12%,transparent)" }}>
            {colunas.map((c, i) => {
              const segs = c.segs.filter((s) => s.v > 0);
              return (
                <div key={i} title={c.title} onClick={c.onClick} style={{
                  flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column",
                  justifyContent: "flex-end", alignItems: "center", gap: 2, cursor: c.onClick ? "pointer" : "default",
                }}>
                  <span style={{ fontSize: 10, color: c.topoCor ?? "var(--ww-text-faint)", whiteSpace: "nowrap", height: 13 }}>{colunas.length <= 14 || maiores.has(i) || c.foraEscala ? (c.topo ?? "") : ""}</span>
                  {agrupado ? (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, width: "100%", maxWidth: 64, justifyContent: "center" }}>
                      {c.segs.map((s, j) => (
                        <span key={j} style={{ flex: 1, height: Math.max(s.v > 0 ? 2 : 0, (s.v / mx) * util), background: s.cor, borderRadius: "4px 4px 0 0" }} />
                      ))}
                    </div>
                  ) : null}
                  {/* De cima para baixo: o último segmento é o do topo. */}
                  {!agrupado && [...segs].reverse().map((s, j) => (
                    <span key={j} style={{
                      width: "100%", maxWidth: 44,
                      height: Math.max(2, Math.min(util, (c.foraEscala ? (s.v / somaCol(c)) * util : (s.v / mx) * util))),
                      borderTop: c.foraEscala && j === 0 ? "2px dashed var(--ww-panel)" : undefined,
                      background: s.cor, borderRadius: j === 0 ? "4px 4px 0 0" : 0,
                      boxShadow: s.brilho ? "0 0 10px color-mix(in srgb,var(--ww-brand-3) 35%,transparent)" : "none",
                    }} />
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {colunas.map((c, i) => (
              <span key={i} title={c.title ?? c.rotulo} style={{
                flex: 1, minWidth: 0, textAlign: "center", fontSize: 10.5, color: "var(--ww-text-faint)",
                whiteSpace: "nowrap", overflow: "visible", display: "flex", justifyContent: "center",
                // Muitas colunas: rótulo só de tantas em tantas, sem cortar a meio.
                visibility: i % passoRotulo === 0 || i === colunas.length - 1 ? "visible" : "hidden",
              }}>{c.rotulo}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type Serie = { nome: string; cor: string; vals: (number | null)[]; largura?: number; tracejado?: string };

/** Linhas do modelo: SVG 600×200 esticado, três guias horizontais. */
export function GraficoLinha({ titulo, rotulos, series, extra, formatar }: {
  titulo: ReactNode; rotulos: string[]; series: Serie[]; extra?: ReactNode;
  /** Formato do valor no tooltip de cada ponto. */
  formatar?: (v: number) => string;
}) {
  const todos = series.flatMap((s) => s.vals.filter((v): v is number => v != null && Number.isFinite(v)));
  const mn = Math.min(0, ...todos), mx = Math.max(1e-9, ...todos);
  const n = Math.max(1, rotulos.length - 1);
  const y = (v: number) => 180 - ((v - mn) / (mx - mn || 1)) * 160;
  const x = (i: number) => (i / n) * 600;
  const caminho = (vals: (number | null)[]) => {
    let d = "", caneta = false;
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { caneta = false; return; }
      d += `${caneta ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      caneta = true;
    });
    return d;
  };
  const zero = mn < 0 ? y(0) : null;
  const [tabela, setTabela] = useState(false);
  const cabT = ["", ...series.map((s) => s.nome)];
  const linT = rotulos.map((r, i) => [r, ...series.map((s) => s.vals[i] ?? 0)]);
  const contexto = [`Gráfico: ${textoDe(titulo)}`, cabT.join(" | "), ...linT.slice(0, 40).map((l) => l.map((v) => (typeof v === "number" ? v.toFixed(2) : v)).join(" | "))].join("\n");
  // Rótulos: no máximo ~12, para não se atropelarem.
  const passo = Math.max(1, Math.ceil(rotulos.length / 12));
  return (
    <div style={{ ...cartao, padding: "18px 20px" }}>
      <CabecalhoGrafico titulo={titulo} legenda={series.map((s) => ({ nome: s.nome, cor: s.cor }))} extra={extra}
        botoes={<BotoesGrafico titulo={textoDe(titulo) || "Gráfico"} contexto={contexto} tabela={tabela} setTabela={setTabela} />} />
      {tabela ? <TabelaDoGrafico cab={cabT} linhas={linT} /> : rotulos.length === 0 ? (
        <div style={{ height: 200, display: "grid", placeItems: "center", color: "var(--ww-text-faint)", fontSize: 12.5 }}>Sem dados no período</div>
      ) : (
        <>
          <svg viewBox="0 0 600 200" preserveAspectRatio="none" style={{ width: "100%", height: 200, display: "block" }}>
            <g stroke="color-mix(in srgb,var(--ww-brand-2) 10%,transparent)">
              <line x1="0" y1="40" x2="600" y2="40" /><line x1="0" y1="100" x2="600" y2="100" /><line x1="0" y1="160" x2="600" y2="160" />
            </g>
            {zero != null && <line x1="0" y1={zero} x2="600" y2={zero} stroke="var(--ww-crit)" strokeDasharray="3 4" strokeOpacity=".5" vectorEffect="non-scaling-stroke" />}
            {series.map((s) => (
              <path key={s.nome} d={caminho(s.vals)} fill="none" stroke={s.cor} strokeWidth={s.largura ?? 2}
                    strokeDasharray={s.tracejado ?? "0"} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Alvos invisíveis por coluna: o tooltip dá o valor de cada série. */}
            {rotulos.map((r, i) => (
              <rect key={i} x={x(i) - 300 / n} y={0} width={600 / n} height={200} fill="transparent">
                <title>{`${r}\n${series.map((s) => `${s.nome}: ${s.vals[i] == null ? "—" : formatar ? formatar(s.vals[i] as number) : s.vals[i]}`).join("\n")}`}</title>
              </rect>
            ))}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            {rotulos.map((l, i) => (
              <span key={i} style={{ fontSize: 10.5, color: "var(--ww-text-faint)", visibility: i % passo === 0 || i === rotulos.length - 1 ? "visible" : "hidden" }}>{l}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Painel lateral ──────────────────────────────────────────────────────────
export type Bloco =
  | { k: "m"; rotulo: string; valor: ReactNode; pct: number; tom?: Tom; title?: string }
  | { k: "i"; t: ReactNode; s?: ReactNode; tom?: Tom; onClick?: () => void; title?: string }
  | { k: "t"; t: ReactNode };

export function PainelLateral({ titulo, blocos, extra, children }: {
  titulo: ReactNode; blocos?: Bloco[]; extra?: ReactNode; children?: ReactNode;
}) {
  return (
    <div style={{ ...cartao, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{titulo}</div>{extra}
        <BotoesGrafico titulo={textoDe(titulo) || "Painel"} contexto={[`Painel: ${textoDe(titulo)}`,
          ...(blocos ?? []).map((b) => (b.k === "m" ? `${b.rotulo} | ${textoDe(b.valor)}${b.title ? ` | ${b.title}` : ""}` : b.k === "i" ? `${textoDe(b.t)} | ${textoDe(b.s)}` : textoDe(b.t)))].join("\n")} />
      </div>
      {(blocos ?? []).map((b, i) => {
        if (b.k === "m") return (
          <div key={i} title={b.title} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
              <span style={{ color: "var(--ww-text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.rotulo}</span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{b.valor}</span>
            </div>
            <ProgressBar value={b.pct} tone={b.tom ?? "info"} height={7} />
          </div>
        );
        if (b.k === "i") return (
          <div key={i} title={b.title} onClick={b.onClick} style={{
            display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 10,
            background: "var(--ww-panel-sunken)", border: "1px solid color-mix(in srgb,var(--ww-brand-2) 10%,transparent)",
            cursor: b.onClick ? "pointer" : "default",
          }}>
            <span style={{ flex: "none", width: 8, height: 8, borderRadius: "50%", marginTop: 5, background: tom(b.tom ?? "ok").dot }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.t}</div>
              {b.s != null && <div style={{ fontSize: 11.5, color: "var(--ww-text-muted)", marginTop: 1 }}>{b.s}</div>}
            </div>
          </div>
        );
        return <div key={i} style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ww-text-2)", padding: "0 2px", whiteSpace: "pre-wrap" }}>{b.t}</div>;
      })}
      {children}
    </div>
  );
}

/** Gráfico + painel lateral lado a lado (2fr / 1fr), empilham no estreito. */
export function MeioTela({ grafico, lado }: { grafico?: ReactNode; lado?: ReactNode }) {
  if (!grafico && !lado) return null;
  return (
    <section style={{
      display: "grid", gap: 14, alignItems: "start",
      gridTemplateColumns: grafico && lado ? "repeat(auto-fit,minmax(min(100%,520px),1fr))" : "minmax(0,1fr)",
    }}>
      {grafico}{lado}
    </section>
  );
}

// ── Células da árvore ───────────────────────────────────────────────────────
export type Celula = ReactNode;

export function cTexto(t: ReactNode, o?: { sub?: ReactNode; tom?: Tom; peso?: number; cor?: string; title?: string }) {
  if (t == null || t === "") return <span style={{ color: "var(--ww-text-faint)" }}>{o?.sub ?? ""}</span>;
  return (
    <span title={o?.title ?? (typeof t === "string" ? t : undefined)} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{
        fontWeight: o?.peso ?? 500, color: o?.cor ?? (o?.tom ? tom(o.tom).fg : "var(--ww-text)"),
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{t}</span>
      {o?.sub != null && o.sub !== "" && (
        <span style={{ fontSize: 11, color: "var(--ww-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.sub}</span>
      )}
    </span>
  );
}
export const cMudo = (t: ReactNode) => cTexto(t, { cor: "var(--ww-text-faint)" });
export function cPill(t: ReactNode, tone: Tom, sub?: ReactNode) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", minWidth: 0 }}>
      <span style={{
        fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999, maxWidth: "100%",
        background: tom(tone).bg, color: tom(tone).fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{t}</span>
      {sub != null && sub !== "" && <span style={{ fontSize: 11, color: "var(--ww-text-faint)", whiteSpace: "nowrap" }}>{sub}</span>}
    </span>
  );
}
export function cBarra(t: ReactNode, pctv: number, tone: Tom = "info", sub?: ReactNode) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{t}</span>
      <ProgressBar value={pctv} tone={tone} height={5} />
      {sub != null && sub !== "" && <span style={{ fontSize: 11, color: "var(--ww-text-faint)", whiteSpace: "nowrap" }}>{sub}</span>}
    </span>
  );
}

// ── Árvore com filtro por coluna ────────────────────────────────────────────
export type NoNavy = {
  id: string;
  nome: ReactNode;
  sub?: ReactNode;
  cels: Celula[];
  filhos?: NoNavy[];
  /** Acção ao lado do nome (abrir retrato, excluir…). Não expande a linha. */
  acao?: ReactNode;
  /** Clique quando não tem filhos. */
  onClick?: () => void;
  title?: string;
};

export type ColunaNavy<R> = {
  label: string;
  align?: "left" | "right";
  /** Texto do registo nesta coluna — alimenta o filtro "Contém…" e as opções. */
  texto?: (r: R) => string;
  /** Número do registo — ordenação numérica. Sem isto, ordena pelo texto. */
  numero?: (r: R) => number | null;
  /** false = cabeçalho não abre o painel de filtro. */
  filtravel?: boolean;
};

type FiltroCol = { vals: string[]; q: string };

const LIMITE_OPCOES = 24;

export function ArvoreNavy<R>({
  titulo, dica, colunas, registros, montar, grid, abertosIniciais = [], toolbar, rodape,
  minWidth = 1000, buscaNome, vazio = "Nenhum item com esses filtros", chave,
}: {
  titulo: ReactNode;
  dica?: ReactNode;
  /** colunas[0] é a coluna da árvore (nome). */
  colunas: ColunaNavy<R>[];
  registros: R[];
  /** Agrupa os registos filtrados e ordenados em nós. */
  montar: (rs: R[]) => NoNavy[];
  grid: string;
  abertosIniciais?: string[];
  toolbar?: ReactNode;
  rodape?: (rs: R[]) => ReactNode;
  minWidth?: number;
  /** Texto pesquisado quando se filtra a coluna da árvore. */
  buscaNome?: (r: R) => string;
  vazio?: string;
  /** Muda quando a tela troca de modo — limpa filtros e ordem. */
  chave?: string;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>(
    () => Object.fromEntries(abertosIniciais.map((k) => [k, true])),
  );
  const [filtros, setFiltros] = useState<Record<number, FiltroCol>>({});
  const [ordem, setOrdem] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [painel, setPainel] = useState<number | null>(null);
  const [chaveVista, setChaveVista] = useState(chave);
  if (chave !== chaveVista) { setChaveVista(chave); setFiltros({}); setOrdem(null); setPainel(null); }

  const textoCol = (r: R, i: number) =>
    i === 0 ? (buscaNome ? buscaNome(r) : "") : (colunas[i]?.texto?.(r) ?? "");
  const ativo = (f?: FiltroCol) => !!f && (f.vals.length > 0 || !!f.q.trim());

  const filtrados = useMemo(() => {
    let rs = registros.filter((r) => Object.entries(filtros).every(([k, f]) => {
      if (!ativo(f)) return true;
      const i = Number(k), v = textoCol(r, i);
      if (f.vals.length && !f.vals.includes(v)) return false;
      if (f.q.trim() && !v.toLowerCase().includes(f.q.trim().toLowerCase())) return false;
      return true;
    }));
    if (ordem) {
      const c = colunas[ordem.col];
      rs = [...rs].sort((a, b) => {
        if (c?.numero) {
          const x = c.numero(a), y = c.numero(b);
          if (x != null && y != null) return (x - y) * ordem.dir;
          if (x == null && y != null) return 1;
          if (x != null && y == null) return -1;
        }
        return textoCol(a, ordem.col).localeCompare(textoCol(b, ordem.col), "pt") * ordem.dir;
      });
    }
    return rs;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registros, filtros, ordem, colunas]);

  const nos = useMemo(() => montar(filtrados), [montar, filtrados]);

  const plano: { n: NoNavy; lvl: number; tem: boolean }[] = [];
  const andar = (lista: NoNavy[], lvl: number) => lista.forEach((n) => {
    const tem = !!n.filhos?.length;
    plano.push({ n, lvl, tem });
    if (tem && abertos[n.id]) andar(n.filhos!, lvl + 1);
  });
  andar(nos, 0);

  const todosPais = useMemo(() => {
    const o: Record<string, boolean> = {};
    const col = (l: NoNavy[]) => l.forEach((n) => { if (n.filhos?.length) { o[n.id] = true; col(n.filhos); } });
    col(nos);
    return o;
  }, [nos]);

  const ativos = Object.entries(filtros).filter(([, f]) => ativo(f));

  // Opções do painel: valores distintos da coluna, com contagem.
  const opcoes = useMemo(() => {
    if (painel == null || painel === 0) return [] as [string, number][];
    const c: Record<string, number> = {};
    for (const r of registros) { const v = textoCol(r, painel); if (v && v !== "—") c[v] = (c[v] ?? 0) + 1; }
    const lista = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return lista.length <= 60 ? lista : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painel, registros, colunas]);

  const fpAtual = painel != null ? (filtros[painel] ?? { vals: [], q: "" }) : null;
  const setF = (i: number, f: FiltroCol) => setFiltros((x) => ({ ...x, [i]: f }));
  const [mostrarTodas, setMostrarTodas] = useState(false);

  const bordaSuave = "1px solid color-mix(in srgb,var(--ww-brand-2) 6%,transparent)";
  const btnFp = (on: boolean): CSSProperties => ({
    height: 28, padding: "0 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", background: "transparent",
    border: "1px solid " + (on ? "var(--ww-brand-3)" : "var(--ww-border-strong)"),
    color: on ? "var(--ww-accent-text)" : "var(--ww-text-2)",
  });

  return (
    <section style={{
      borderRadius: "var(--radius-section)", background: "var(--ww-panel-grad)",
      border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-section)", overflow: "hidden", minWidth: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "14px 20px",
        borderBottom: "1px solid color-mix(in srgb,var(--ww-brand-2) 10%,transparent)",
      }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{titulo}</div>
          {dica != null && <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginTop: 2 }}>{dica}</div>}
        </div>
        {ativos.length > 0 && (
          <div style={{ flex: "1 1 100%", order: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Mostrando {filtrados.length} de {registros.length}</span>
            {ativos.map(([k, f]) => (
              <button key={k} type="button" onClick={() => setFiltros((x) => { const n = { ...x }; delete n[Number(k)]; return n; })} style={{
                height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, cursor: "pointer",
                border: "1px solid color-mix(in srgb,var(--ww-brand-3) 45%,transparent)",
                background: "color-mix(in srgb,var(--ww-brand-3) 10%,transparent)", color: "var(--ww-accent-text)",
              }}>
                {colunas[Number(k)]?.label.split(" › ")[0]}: {[...f.vals, ...(f.q.trim() ? [`“${f.q.trim()}”`] : [])].join(", ")}  ✕
              </button>
            ))}
            <button type="button" onClick={() => setFiltros({})} style={{
              height: 26, padding: "0 10px", border: 0, background: "transparent", color: "var(--ww-text-muted)",
              fontSize: 11.5, cursor: "pointer", textDecoration: "underline",
            }}>Limpar filtros</button>
          </div>
        )}
        {toolbar}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" title="Baixar o que está filtrado, com as colunas à vista" onClick={() => {
            // Mesma exportação das tabelas antigas (VizTable): ponto e vírgula e
            // BOM, para o Excel em português abrir sem mexer em nada.
            const cab = [colunas[0]?.label ?? "", ...colunas.slice(1).map((c) => c.label)];
            const lin = filtrados.map((r) => [buscaNome ? buscaNome(r) : "", ...colunas.slice(1).map((c) => c.texto?.(r) ?? "")]);
            const csv = "\ufeff" + [cab, ...lin].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const a = document.createElement("a"); a.href = url;
            a.download = `${textoDe(titulo).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-") || "lista"}.csv`;
            a.click(); URL.revokeObjectURL(url);
          }} style={{ ...btnFp(false), height: 32, borderRadius: 9, padding: "7px 12px", fontSize: 12.5 }}>CSV</button>
          <button type="button" onClick={() => setAbertos((o) => ({ ...o, ...todosPais }))} style={{ ...btnFp(false), height: 32, borderRadius: 9, padding: "7px 12px", fontSize: 12.5 }}>Expandir tudo</button>
          <button type="button" onClick={() => setAbertos({})} style={{ ...btnFp(false), height: 32, borderRadius: 9, padding: "7px 12px", fontSize: 12.5 }}>Recolher</button>
        </div>
      </div>

      {painel != null && fpAtual && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px",
          background: "var(--ww-panel-sunken)", borderBottom: "1px solid color-mix(in srgb,var(--ww-brand-3) 30%,transparent)",
          boxShadow: "inset 0 2px 0 var(--ww-brand-3)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ww-accent-text)", whiteSpace: "nowrap" }}>
            Filtrar · {colunas[painel]?.label.split(" › ")[0]}
          </span>
          <input autoFocus value={fpAtual.q} onChange={(e) => setF(painel, { ...fpAtual, q: e.target.value })} placeholder="Contém…" style={{
            height: 30, width: 180, padding: "0 10px", borderRadius: 8, border: "1px solid var(--ww-border-strong)",
            background: "var(--ww-panel)", color: "var(--ww-text)", fontFamily: "inherit", fontSize: 12.5, outline: "none",
          }} />
          {(mostrarTodas ? opcoes : opcoes.slice(0, LIMITE_OPCOES)).map(([v, c]) => {
            const on = fpAtual.vals.includes(v);
            return (
              <button key={v} type="button"
                onClick={() => setF(painel, { ...fpAtual, vals: on ? fpAtual.vals.filter((z) => z !== v) : [...fpAtual.vals, v] })}
                style={{
                  height: 28, padding: "0 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6, maxWidth: 260,
                  border: "1px solid " + (on ? "var(--ww-brand-3)" : "var(--ww-border-strong)"),
                  background: on ? "color-mix(in srgb,var(--ww-brand-3) 12%,transparent)" : "transparent",
                  color: on ? "var(--ww-accent-text)" : "var(--ww-text-2)",
                }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                <span style={{ fontSize: 10.5, color: "var(--ww-text-faint)" }}>{c}</span>
              </button>
            );
          })}
          {opcoes.length > LIMITE_OPCOES && (
            <button type="button" onClick={() => setMostrarTodas((v) => !v)} style={{ ...btnFp(false), border: 0, textDecoration: "underline" }}>
              {mostrarTodas ? "menos" : `+${opcoes.length - LIMITE_OPCOES}`}
            </button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setOrdem({ col: painel, dir: 1 })} style={btnFp(ordem?.col === painel && ordem.dir > 0)}>↑ Crescente</button>
            <button type="button" onClick={() => setOrdem({ col: painel, dir: -1 })} style={btnFp(ordem?.col === painel && ordem.dir < 0)}>↓ Decrescente</button>
            <button type="button" onClick={() => {
              setFiltros((x) => { const n = { ...x }; delete n[painel]; return n; });
              if (ordem?.col === painel) setOrdem(null);
            }} style={btnFp(false)}>Limpar</button>
            <button type="button" onClick={() => setPainel(null)} style={{ ...btnFp(false), width: 28, padding: 0 }}>✕</button>
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth }}>
          <div style={{
            display: "grid", gridTemplateColumns: grid, background: "var(--ww-panel-sunken)",
            borderBottom: "1px solid color-mix(in srgb,var(--ww-brand-2) 12%,transparent)", fontSize: 11.5,
          }}>
            {colunas.map((c, i) => {
              const f = filtros[i], on = painel === i, so = ordem?.col === i, act = ativo(f);
              const podeFiltrar = c.filtravel !== false;
              return (
                <div key={i} title={podeFiltrar ? "Filtrar e ordenar" : undefined}
                  onClick={podeFiltrar ? () => { setMostrarTodas(false); setPainel(on ? null : i); } : undefined}
                  style={{
                    padding: "9px 12px", paddingLeft: i ? 12 : 40, borderLeft: i ? bordaSuave : 0,
                    display: "flex", alignItems: "center", gap: 6,
                    justifyContent: c.align === "right" ? "flex-end" : "flex-start",
                    cursor: podeFiltrar ? "pointer" : "default", userSelect: "none", fontWeight: 600,
                    color: act || on || so ? "var(--ww-accent-text)" : "var(--ww-text-faint)",
                    background: on ? "color-mix(in srgb,var(--ww-brand-3) 10%,transparent)" : "transparent",
                  }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                  <span style={{ fontSize: 11 }}>{so ? (ordem!.dir > 0 ? "↑" : "↓") : ""}</span>
                  {podeFiltrar && (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill={act ? "currentColor" : "none"} stroke="currentColor"
                         strokeWidth="2" strokeLinejoin="round" style={{ flex: "none", opacity: act || on ? 1 : 0.5 }}>
                      <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>

          {plano.map(({ n, lvl, tem }) => (
            <div key={n.id} className="navy-linha" title={n.title}
              onClick={tem ? () => setAbertos((o) => ({ ...o, [n.id]: !o[n.id] })) : n.onClick}
              style={{
                display: "grid", gridTemplateColumns: grid, alignItems: "center", fontSize: 12.5,
                cursor: tem || n.onClick ? "pointer" : "default",
                background: lvl === 0 ? "var(--ww-row-l0)" : lvl === 1 ? "var(--ww-row-l1)" : "var(--ww-row-l2)",
                borderTop: lvl === 0 ? "1px solid var(--ww-border)" : "1px dashed color-mix(in srgb,var(--ww-brand-2) 7%,transparent)",
              }}>
              <div style={{ padding: `10px 12px 10px ${14 + lvl * 26}px`, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Chevron open={!!abertos[n.id]} hidden={!tem} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontWeight: lvl === 0 ? 700 : lvl === 1 ? 600 : 500, fontSize: lvl === 0 ? 13.5 : 12.5,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{n.nome}</div>
                  {n.sub != null && n.sub !== "" && (
                    <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.sub}</div>
                  )}
                </div>
                {n.acao && <span onClick={(e) => e.stopPropagation()} style={{ flex: "none" }}>{n.acao}</span>}
              </div>
              {n.cels.map((c, i) => (
                <div key={i} style={{
                  padding: "10px 12px", minWidth: 0, borderLeft: bordaSuave,
                  display: "flex", flexDirection: "column", gap: 4,
                  alignItems: colunas[i + 1]?.align === "right" ? "flex-end" : "flex-start",
                  textAlign: colunas[i + 1]?.align === "right" ? "right" : "left",
                  fontVariantNumeric: "tabular-nums",
                }}>{c}</div>
              ))}
            </div>
          ))}
          {nos.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--ww-text-faint)", fontSize: 13 }}>{vazio}</div>
          )}
        </div>
      </div>
      {rodape && (
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 20px", borderTop: "1px solid color-mix(in srgb,var(--ww-brand-2) 10%,transparent)",
          fontSize: 12, color: "var(--ww-text-muted)",
        }}>{rodape(filtrados)}</div>
      )}
    </section>
  );
}

// ── Datas ───────────────────────────────────────────────────────────────────
export const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export const somaDias = (iso: string, d: number) => {
  const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
export const ddmmaa = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaSemana = (iso: string) => DIAS_SEMANA[new Date(iso + "T12:00:00Z").getUTCDay()];
export const diffDias = (a: string, b: string) =>
  Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86_400_000);

// ── Seletor de colunas ──────────────────────────────────────────────────────
/** "Colunas · x/y" com painel de caixas por grupo e "voltar ao padrão".
 *  Tudo o que a tela conhece fica disponível; o padrão é só o que vem ligado.
 *  A escolha fica no browser (chave), porque é preferência de quem opera. */
export function useColunasEscolhidas<K extends string>(chave: string, todas: K[], padrao: K[]) {
  const [sel, setSel] = useState<K[]>(padrao);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    try {
      const g = window.localStorage.getItem(chave);
      if (g) { const l = (JSON.parse(g) as K[]).filter((k) => todas.includes(k)); if (l.length) setSel(l); }
    } catch { /* preferência corrompida: fica o padrão */ }
    setOk(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  useEffect(() => {
    if (!ok) return;
    try { window.localStorage.setItem(chave, JSON.stringify(sel)); } catch { /* quota */ }
  }, [sel, chave, ok]);
  return [sel, setSel] as const;
}

export function SeletorColunas<K extends string>({ colunas, sel, setSel, padrao, titulo = "Colunas" }: {
  colunas: { key: K; label: string; grupo?: string }[];
  sel: K[]; setSel: (v: K[]) => void; padrao: K[]; titulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const grupos = [...new Set(colunas.map((c) => c.grupo ?? ""))];
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setAberto((v) => !v)} style={{
        height: 32, padding: "0 12px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", background: "transparent",
        border: "1px solid var(--ww-border-strong)", color: "var(--ww-text-2)",
      }}>Colunas · {sel.length}/{colunas.length}</button>
      {aberto && (<>
        <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setAberto(false)} />
        <div style={{
          position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 40, width: 560, maxWidth: "90vw",
          maxHeight: 460, overflowY: "auto", padding: 14, borderRadius: 14, background: "var(--ww-panel)",
          border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{titulo}</span>
            <span style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setSel(colunas.map((c) => c.key))} style={{ fontSize: 11, background: "none", border: 0, color: "var(--ww-text-muted)", textDecoration: "underline", cursor: "pointer" }}>todas</button>
              <button type="button" onClick={() => setSel(padrao)} style={{ fontSize: 11, background: "none", border: 0, color: "var(--ww-text-muted)", textDecoration: "underline", cursor: "pointer" }}>voltar ao padrão</button>
            </span>
          </div>
          {grupos.map((g) => (
            <div key={g} style={{ marginBottom: 10 }}>
              {g && <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ww-text-faint)", marginBottom: 4 }}>{g}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "2px 12px" }}>
                {colunas.filter((c) => (c.grupo ?? "") === g).map((c) => (
                  <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ww-text-2)", cursor: "pointer" }}>
                    <input type="checkbox" checked={sel.includes(c.key)}
                      onChange={() => setSel(sel.includes(c.key) ? sel.filter((k) => k !== c.key) : [...sel, c.key])} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}
