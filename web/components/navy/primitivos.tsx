"use client";

/**
 * Primitivos do Allka Navy — porte dos componentes de
 * `design_handoff_painel_navy/design_system/components/`.
 *
 * Porquê style inline e não classes Tailwind: os componentes do pacote leem
 * os tokens `--ww-*` / `--radius-*` / `--shadow-*` directamente, e manter essa
 * leitura é o que permite trocar o design sem reescrever o componente. Os
 * tokens vivem em `app/globals.css` e mudam sozinhos com `.dark`.
 *
 * Regra do handoff: isto é APRESENTAÇÃO. Nenhum destes componentes decide
 * nada — recebem estado já calculado pela lógica que existe (lib/alarmes.ts,
 * lib/columns.ts, lib/permissions.ts).
 */

import type { CSSProperties, ReactNode } from "react";

// ── Tons ────────────────────────────────────────────────────────────────────
export type Tom = "ok" | "warn" | "crit" | "info" | "violet" | "off";

const TONS: Record<Tom, { dot: string; bg: string; fg: string }> = {
  ok:     { dot: "var(--ww-ok)",     bg: "var(--ww-ok-soft)",     fg: "var(--ww-ok-text)" },
  warn:   { dot: "var(--ww-warn)",   bg: "var(--ww-warn-soft)",   fg: "var(--ww-warn-text)" },
  crit:   { dot: "var(--ww-crit)",   bg: "var(--ww-crit-soft)",   fg: "var(--ww-crit-text)" },
  info:   { dot: "var(--ww-info)",   bg: "var(--ww-info-soft)",   fg: "var(--ww-info-text)" },
  violet: { dot: "var(--ww-violet)", bg: "var(--ww-violet-soft)", fg: "var(--ww-violet-text)" },
  off:    { dot: "var(--ww-off)",    bg: "var(--ww-off-soft)",    fg: "var(--ww-off-text)" },
};
export const tom = (t: Tom | string | null | undefined) => TONS[(t as Tom)] ?? TONS.off;

/* O Pipeline actual fala green/yellow/red/off; o Navy fala ok/warn/crit/off.
   A tradução vive aqui e só aqui, para a regra de cor continuar a ser a de
   lib/alarmes.ts e não ser reinventada em cada tela. */
export function tomDoEstado(estado: string | null | undefined): Tom {
  switch (estado) {
    case "green": return "ok";
    case "yellow": return "warn";
    case "red": return "crit";
    case "blue": return "info";
    default: return "off";
  }
}

// ── StatusPill ──────────────────────────────────────────────────────────────
export function StatusPill({ tone = "off", children, dot = false, title }: {
  tone?: Tom; children: ReactNode; dot?: boolean; title?: string;
}) {
  const t = tom(tone);
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: "var(--text-chip)", fontWeight: 600, padding: "2px 9px",
      borderRadius: "var(--radius-pill)", background: t.bg, color: t.fg,
      whiteSpace: "nowrap",
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot }} />}
      {children}
    </span>
  );
}

// ── FilterChip ──────────────────────────────────────────────────────────────
export function FilterChip({ active = false, onClick, children, title }: {
  active?: boolean; onClick?: () => void; children: ReactNode; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} style={{
      display: "inline-flex", alignItems: "center", padding: "6px 13px",
      borderRadius: "var(--radius-pill)", fontSize: "var(--text-body-sm)",
      cursor: "pointer", fontWeight: active ? 600 : 500,
      border: "1px solid " + (active ? "var(--ww-accent)" : "var(--ww-border-strong)"),
      color: active ? "var(--ww-accent-text)" : "var(--ww-text-2)",
      background: active ? "var(--ww-accent-soft)" : "transparent",
      boxShadow: active ? "var(--ww-glow-chip)" : "none",
      transition: "background var(--dur-fast), border-color var(--dur-fast)",
    }}>
      {children}
    </button>
  );
}

// ── SegmentedControl ────────────────────────────────────────────────────────
export type Opcao = { value: string; label: string };
export function SegmentedControl({ options, value, onChange }: {
  options: Opcao[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{
      display: "inline-flex", gap: 4, padding: 4, borderRadius: 12,
      background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-subtle)",
    }}>
      {options.map((o) => {
        const activo = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} style={{
            border: 0, borderRadius: 9, padding: "7px 14px", fontFamily: "var(--font-sans)",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: activo ? "var(--ww-active-nav)" : "transparent",
            color: activo ? "var(--ww-text)" : "var(--ww-text-muted)",
            boxShadow: activo ? "var(--ww-active-ring)" : "none",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Chevron ─────────────────────────────────────────────────────────────────
export function Chevron({ open = false, hidden = false, size = 12 }: {
  open?: boolean; hidden?: boolean; size?: number;
}) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} style={{
      flex: "none", color: "var(--ww-accent-text)",
      transition: "transform var(--dur-fast)",
      transform: open ? "rotate(90deg)" : "none",
      opacity: hidden ? 0 : 1,
    }}>
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── ProgressBar ─────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, tone = "ok", height = 5 }: {
  value?: number; tone?: Tom; height?: number;
}) {
  const t = tom(tone);
  return (
    <div style={{ width: "100%", height, borderRadius: "var(--radius-bar)", background: "var(--ww-track)" }}>
      <div style={{
        height: "100%", width: Math.max(0, Math.min(100, value)) + "%",
        borderRadius: "var(--radius-bar)", background: t.dot,
        boxShadow: tone === "ok" ? "var(--ww-glow-ok)" : "none",
      }} />
    </div>
  );
}

// ── PipelineRail ────────────────────────────────────────────────────────────
export const ETAPAS = ["PV/OS", "RC", "PC", "Aprovação", "Materiais", "Serviços", "Saída"];
const ETAPAS_CURTAS = ["PV", "RC", "PC", "Apr", "Mat", "Srv", "NF"];

export function PipelineRail({ states, labels = true, height = 7, locked = false, onStageClick }: {
  states: Tom[]; labels?: boolean; height?: number; locked?: boolean;
  onStageClick?: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 180 }}>
      <div style={{ display: "flex", gap: 4, position: "relative" }}>
        {states.map((s, i) => (
          <span key={i} title={ETAPAS[i]}
            onClick={onStageClick ? (e) => { e.stopPropagation(); onStageClick(i); } : undefined}
            style={{
              flex: 1, height, borderRadius: "var(--radius-seg)", background: tom(s).dot,
              boxShadow: s === "ok" ? "var(--ww-glow-ok)" : "none",
              position: "relative", cursor: onStageClick ? "pointer" : undefined,
            }}>
            {/* O cadeado de "Aguardando Liberação" continua sobreposto ao PV/OS,
                como hoje — é sinal de estado, não decoração. */}
            {locked && i === 0 && (
              <span style={{ position: "absolute", right: -3, top: -9, fontSize: 10 }}>🔒</span>
            )}
          </span>
        ))}
      </div>
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ww-text-faint)" }}>
          {ETAPAS_CURTAS.slice(0, states.length).map((l) => <span key={l}>{l}</span>)}
        </div>
      )}
    </div>
  );
}

// ── KpiCard ─────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, subTone, hero = false, dot, progress, progressTone = "info" }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; subTone?: Tom;
  hero?: boolean; dot?: string; progress?: number | null; progressTone?: Tom;
}) {
  return (
    <div style={{
      borderRadius: "var(--radius-card)", padding: "16px 18px",
      background: hero ? "var(--ww-hero-grad)" : "var(--ww-panel-grad)",
      border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-card)",
      display: "flex", flexDirection: "column", gap: 6,
      color: hero ? "var(--ww-hero-text)" : "var(--ww-text)", minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "var(--text-body-sm)", fontWeight: 700 }}>
        {dot && <span style={{ width: 9, height: 9, borderRadius: 3, background: dot }} />}
        {label}
      </div>
      <div style={{
        fontSize: hero ? "var(--text-kpi-hero)" : "var(--text-kpi)",
        fontFamily: "var(--font-display)", fontWeight: 700,
        letterSpacing: "var(--tracking-tight)", whiteSpace: "nowrap",
      }}>{value}</div>
      {sub != null && (
        <div style={{
          fontSize: "var(--text-meta)",
          color: subTone ? tom(subTone).fg : hero ? "var(--ww-hero-text-2)" : "var(--ww-text-muted)",
        }}>{sub}</div>
      )}
      {progress != null && <ProgressBar value={progress} tone={progressTone} height={6} />}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────
export function Panel({ title, subtitle, actions, padding = "18px 20px", children, style }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
  padding?: string; children?: ReactNode; style?: CSSProperties;
}) {
  return (
    <section style={{
      borderRadius: "var(--radius-panel)", background: "var(--ww-panel-grad)",
      border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-card)",
      padding, minWidth: 0, ...style,
    }}>
      {title != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: "1 1 220px" }}>
            <div style={{ fontSize: "var(--text-h3)", fontWeight: 700 }}>{title}</div>
            {subtitle != null && (
              <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
export function Button({ variant = "ghost", onClick, children, disabled, title, type = "button" }: {
  variant?: "primary" | "ghost" | "quiet";
  onClick?: () => void; children: ReactNode; disabled?: boolean; title?: string;
  type?: "button" | "submit";
}) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "8px 14px", borderRadius: "var(--radius-button)",
    fontSize: "var(--text-body-sm)", fontWeight: 600, cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1, transition: "background var(--dur-fast), box-shadow var(--dur-fast)",
  };
  const porVariante: Record<string, CSSProperties> = {
    primary: { ...base, border: "1px solid var(--ww-accent)", background: "var(--ww-accent-grad)",
               color: "var(--ww-on-accent)", boxShadow: "var(--ww-glow-accent)" },
    ghost:   { ...base, border: "1px solid var(--ww-border-strong)", background: "transparent",
               color: "var(--ww-text-2)" },
    quiet:   { ...base, border: "1px solid transparent", background: "transparent",
               color: "var(--ww-text-muted)" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={porVariante[variant]}>
      {children}
    </button>
  );
}
