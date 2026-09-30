"use client";

/**
 * TreeTable — porte fiel do componente do design system
 * (`design_system/components/data/TreeTable.jsx`).
 *
 * Árvore de 3 níveis numa grelha única: cabeçalho com divisórias, fundo por
 * nível (row-l0/l1/l2), indentação de 26px e chevron que roda. As células são
 * ReactNode — quem monta as linhas decide se a célula é texto, pílula ou barra.
 *
 * O que muda em relação ao que o painel tinha: as linhas deixam de ser cartões
 * com bolinhas e caixas à direita e passam a ser linhas de tabela com colunas
 * comparáveis de cima a baixo. É a diferença entre ler um pedido e comparar
 * vinte.
 */

import { useState, type ReactNode } from "react";
import { Chevron, ProgressBar, StatusPill, tom, type Tom } from "./primitivos";

const FUNDO = ["var(--ww-row-l0)", "var(--ww-row-l1)", "var(--ww-row-l2)"];

export type NoArvore = {
  id: string;
  name: string;
  sub?: string;
  cells?: ReactNode[];
  children?: NoArvore[];
  /** Clique quando o nó não tem filhos — abrir o drawer, por exemplo. */
  onClick?: () => void;
};

export type ColunaArvore = { label: string; align?: "left" | "right"; width?: string };

/** Faixa de grupo do cabeçalho duplo. `span` conta colunas de dados (a coluna
 *  do nome fica sempre de fora — é a árvore, não pertence a grupo nenhum). */
export type GrupoArvore = { label: string; span: number; tone: Tom };

/** Célula com pílula de estado — o formato que o modelo usa em Aprovação. */
export function CelulaPill({ tone, children, sub }: { tone: Tom; children: ReactNode; sub?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
      <StatusPill tone={tone}>{children}</StatusPill>
      {sub && <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>{sub}</span>}
    </span>
  );
}

/** Célula valor + barra de progresso — o formato de Comprometido e Materiais. */
export function CelulaBarra({ valor, pct, tone = "info", sub }: {
  valor: ReactNode; pct: number; tone?: Tom; sub?: string;
}) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontWeight: 600, color: "var(--ww-text)" }}>{valor}</span>
      <ProgressBar value={pct} tone={tone} height={4} />
      {sub && <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>{sub}</span>}
    </span>
  );
}

/** Célula de duas linhas — texto e detalhe, como "prox.: Comissionamento 12/10". */
export function CelulaTexto({ t, sub, tone }: { t: ReactNode; sub?: string; tone?: Tom }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{
        color: tone ? `var(--ww-${tone}-text)` : "var(--ww-text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{t}</span>
      {sub && <span style={{
        fontSize: "var(--text-micro)", color: "var(--ww-text-faint)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{sub}</span>}
    </span>
  );
}

export default function TreeTable({
  columns, rows, grid, groups, defaultExpanded = [], minWidth = 1000,
}: {
  columns: ColunaArvore[];
  rows: NoArvore[];
  grid?: string;
  /** Cabeçalho duplo: faixas coloridas por grupo, como no modelo. */
  groups?: GrupoArvore[];
  defaultExpanded?: string[];
  minWidth?: number;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>(
    () => Object.fromEntries(defaultExpanded.map((k) => [k, true])),
  );

  const tpl = grid
    ?? ("minmax(260px,1.7fr) " + columns.slice(1).map((c) => c.width ?? "minmax(110px,1fr)").join(" "));

  const plano: { n: NoArvore; lvl: number; temFilhos: boolean }[] = [];
  const percorrer = (nos: NoArvore[], lvl: number) => {
    for (const n of nos) {
      const temFilhos = !!n.children?.length;
      plano.push({ n, lvl, temFilhos });
      if (temFilhos && abertos[n.id]) percorrer(n.children!, lvl + 1);
    }
  };
  percorrer(rows, 0);

  if (rows.length === 0) {
    return <div className="py-14 text-center text-[12px] text-ww-textFaint">Nada com estes filtros.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth }}>
        {groups && groups.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: tpl }}>
            <div />
            {groups.map((g, i) => (
              <div key={i} style={{
                gridColumn: `span ${g.span}`, padding: "6px 12px",
                fontSize: "var(--text-chip)", fontWeight: 700,
                letterSpacing: "var(--tracking-label)", textTransform: "uppercase",
                color: tom(g.tone).fg, background: tom(g.tone).bg,
                borderLeft: "1px solid var(--ww-border-subtle)",
              }}>{g.label}</div>
            ))}
          </div>
        )}
        <div style={{
          display: "grid", gridTemplateColumns: tpl, background: "var(--ww-panel-sunken)",
          borderBottom: "1px solid var(--ww-border)", fontSize: "var(--text-chip)",
          color: "var(--ww-text-faint)", position: "sticky", top: 0, zIndex: 2,
        }}>
          {columns.map((c, i) => (
            <div key={i} style={{
              padding: "9px 12px", paddingLeft: i ? 12 : 40,
              textAlign: c.align ?? "left",
              borderLeft: i ? "1px solid var(--ww-border-subtle)" : 0,
            }}>{c.label}</div>
          ))}
        </div>

        {plano.map(({ n, lvl, temFilhos }) => (
          <div key={n.id}
            onClick={temFilhos
              ? () => setAbertos((o) => ({ ...o, [n.id]: !o[n.id] }))
              : n.onClick}
            style={{
              display: "grid", gridTemplateColumns: tpl, alignItems: "center",
              fontSize: "var(--text-body-sm)",
              cursor: temFilhos || n.onClick ? "pointer" : "default",
              background: FUNDO[Math.min(lvl, 2)],
              borderTop: lvl === 0 ? "1px solid var(--ww-border)" : "1px dashed var(--ww-border-subtle)",
            }}>
            <div style={{
              padding: "10px 12px", paddingLeft: 14 + lvl * 26,
              display: "flex", alignItems: "center", gap: 8, minWidth: 0,
            }}>
              <Chevron open={!!abertos[n.id]} hidden={!temFilhos} />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: lvl === 0 ? 700 : lvl === 1 ? 600 : 500,
                  fontSize: lvl === 0 ? 13.5 : 12.5,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  color: "var(--ww-text)",
                }}>{n.name}</div>
                {n.sub && <div style={{
                  fontSize: "var(--text-chip)", color: "var(--ww-text-faint)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{n.sub}</div>}
              </div>
            </div>
            {(n.cells ?? []).map((c, i) => (
              <div key={i} style={{
                padding: "10px 12px", minWidth: 0,
                textAlign: columns[i + 1]?.align ?? "left",
                borderLeft: "1px solid var(--ww-border-subtle)",
              }}>{c}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
