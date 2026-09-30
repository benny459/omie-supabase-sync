"use client";

/**
 * Kanban de raias — uma raia por pedido, quatro colunas por estado do lote.
 *
 * Do handoff, e é o que mais importa aqui: **Kanban é leitura, sem arrastar.**
 * O estado do lote é derivado dos dados, não movido à mão — arrastar um cartão
 * sugeriria que a coluna define o estado, quando é o contrário. Quem muda
 * estado é a aprovação e o recebimento, nos sítios onde isso já acontece.
 *
 * As quatro colunas saem da mesma leitura que o resto do painel usa:
 *   Compra     — lote sem PC
 *   Aprovação  — tem PC, ainda não aprovado (isApproved de lib/columns)
 *   Materiais  — aprovado, sem NF de recebimento
 *   Recebido   — tem data de recebimento da NF
 */

import { useMemo, useState } from "react";
import { isApproved } from "@/lib/columns";
import { Chevron, StatusPill, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;

export type ColunaKanban = "compra" | "aprovacao" | "materiais" | "recebido";

const COLUNAS: { chave: ColunaKanban; titulo: string; tom: Tom }[] = [
  { chave: "compra",    titulo: "Compra",    tom: "off" },
  { chave: "aprovacao", titulo: "Aprovação", tom: "warn" },
  { chave: "materiais", titulo: "Materiais", tom: "info" },
  { chave: "recebido",  titulo: "Recebido",  tom: "ok" },
];

/** Estado do lote. Exportado porque a mesma leitura serve a contagem do topo. */
export function colunaDoLote(r: AnyRow): ColunaKanban {
  const temPc = Boolean(String(r.pc_numero ?? r.pc_numero_manual ?? "").trim());
  if (!temPc) return "compra";
  if (r.mt_data_recebimento_nf) return "recebido";
  return isApproved(String(r.status ?? "")) ? "materiais" : "aprovacao";
}

export default function KanbanRaias({
  buckets, formatarValor, onLoteClick, rotuloBucket,
}: {
  buckets: { pv_os_label: string; cliente: string | null; rows: AnyRow[] }[];
  /** Vem de fora para respeitar canViewValues — aqui não se decide permissão. */
  formatarValor: (v: number) => string;
  onLoteClick?: (r: AnyRow) => void;
  rotuloBucket?: (b: { pv_os_label: string }) => string;
}) {
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  /* Um PC e um PC, mesma regra da grade. Sem isto o PC duplicado (a copia
     manual e a linha do Omie) aparecia em DUAS colunas ao mesmo tempo, e a
     contagem de cada coluna inflava. Fica a copia mais avancada no fluxo:
     recebido diz mais sobre o estado real do pedido do que "por aprovar". */
  const ORDEM: ColunaKanban[] = ["compra", "aprovacao", "materiais", "recebido"];

  const raias = useMemo(() => buckets.map((b) => {
    const porPc = new Map<string, AnyRow>();
    const semPc: AnyRow[] = [];
    for (const r of b.rows) {
      const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
      if (!pc) { semPc.push(r); continue; }
      const anterior = porPc.get(pc);
      if (!anterior || ORDEM.indexOf(colunaDoLote(r)) > ORDEM.indexOf(colunaDoLote(anterior))) {
        porPc.set(pc, r);
      }
    }
    const porColuna: Record<ColunaKanban, AnyRow[]> = {
      compra: [], aprovacao: [], materiais: [], recebido: [],
    };
    for (const r of [...semPc, ...porPc.values()]) porColuna[colunaDoLote(r)].push(r);
    return { bucket: b, porColuna, lotes: semPc.length + porPc.size };
  }), [buckets]);

  const totalColuna = (linhas: AnyRow[]) =>
    linhas.reduce((s, r) => s + Number(r.valor_total ?? 0), 0);

  if (raias.length === 0) {
    return <div className="py-14 text-center text-[12px] text-ww-textFaint">Nada para mostrar com estes filtros.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Cabeçalho das colunas — fica fora das raias para não repetir 40 vezes. */}
      <div style={{ display: "grid", gridTemplateColumns: "270px repeat(4, 1fr)", gap: 10, position: "sticky", top: 0, zIndex: 5 }}>
        <div />
        {COLUNAS.map((c) => {
          const totalCol = raias.reduce((x, r) => x + r.porColuna[c.chave].length, 0);
          const valorCol = raias.reduce((x, r) =>
            x + r.porColuna[c.chave].reduce((y, l) => y + Number(l.valor_total ?? 0), 0), 0);
          return (
          <div key={c.chave} style={{
            padding: "6px 12px", borderRadius: "var(--radius-row)",
            background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-subtle)",
            fontSize: "var(--text-chip)", fontWeight: 700, color: "var(--ww-text-2)",
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: `var(--ww-${c.tom === "off" ? "off" : c.tom})` }} />
            <span style={{ flex: 1 }}>{c.titulo}</span>
            {/* Contagem e valor da coluna inteira — o modelo mostra-os aqui,
                e sem eles cada raia obriga a somar de cabeca. */}
            <span style={{ color: "var(--ww-text-faint)", fontWeight: 600 }}>{totalCol}</span>
            <span style={{ color: "var(--ww-text-faint)", fontWeight: 500 }}>{formatarValor(valorCol)}</span>
          </div>
          );
        })}
      </div>

      {raias.map(({ bucket, porColuna, lotes }) => {
        const aberta = abertas[bucket.pv_os_label] ?? false;
        return (
          <div key={bucket.pv_os_label} style={{
            display: "grid", gridTemplateColumns: "270px repeat(4, 1fr)", gap: 10,
            alignItems: "start",
          }}>
            {/* Cabeça da raia */}
            <button type="button"
              onClick={() => setAbertas((s) => ({ ...s, [bucket.pv_os_label]: !aberta }))}
              style={{
                display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                padding: "12px 14px", borderRadius: "var(--radius-row)",
                background: "var(--ww-row-l0)", border: "1px solid var(--ww-border)",
                cursor: "pointer", minWidth: 0, width: "100%",
              }}>
              <Chevron open={aberta} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--text-body)", fontWeight: 700, color: "var(--ww-text)" }}>
                  {rotuloBucket ? rotuloBucket(bucket) : bucket.pv_os_label}
                </span>
                <span style={{
                  display: "block", fontSize: "var(--text-meta)", color: "var(--ww-text-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {bucket.cliente ?? "—"} · {lotes} lote{lotes === 1 ? "" : "s"}
                </span>
              </span>
            </button>

            {COLUNAS.map((c) => {
              const linhas = porColuna[c.chave];
              return (
                <div key={c.chave} style={{
                  borderRadius: "var(--radius-row)", padding: 8, minHeight: 58,
                  background: "var(--ww-row-l1)", border: "1px solid var(--ww-border-subtle)",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  {/* Recolhida: só o resumo. Aberta: os cartões. */}
                  {!aberta ? (
                    linhas.length === 0 ? (
                      <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-faint)" }}>—</span>
                    ) : (
                      <>
                        <span style={{ fontSize: "var(--text-body)", fontWeight: 700, color: "var(--ww-text)" }}>
                          {linhas.length}
                        </span>
                        <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)" }}>
                          {formatarValor(totalColuna(linhas))}
                        </span>
                      </>
                    )
                  ) : linhas.length === 0 ? (
                    <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-faint)" }}>—</span>
                  ) : (
                    linhas.map((r, i) => {
                      const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
                      const rc = String(r.rc_numero ?? "").trim();
                      return (
                        <button key={`${String(r.ncod_ped)}-${i}`} type="button"
                          onClick={onLoteClick ? () => onLoteClick(r) : undefined}
                          style={{
                            textAlign: "left", padding: "8px 10px", borderRadius: 10,
                            background: "var(--ww-row-l2)", border: "1px solid var(--ww-border-subtle)",
                            cursor: onLoteClick ? "pointer" : "default", display: "flex",
                            flexDirection: "column", gap: 4, minWidth: 0,
                          }}>
                          <span style={{
                            fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--ww-text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {pc ? `PC ${pc}` : rc ? `RC ${rc}` : "Lote sem número"}
                          </span>
                          <span style={{
                            fontSize: "var(--text-micro)", color: "var(--ww-text-muted)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {String(r.nome_fornecedor ?? r.rc_descricao ?? "—")}
                          </span>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <span style={{ fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--ww-text)" }}>
                              {formatarValor(Number(r.valor_total ?? 0))}
                            </span>
                            {c.chave === "recebido" && Boolean(r.mt_data_recebimento_nf) && (
                              <StatusPill tone="ok">recebido</StatusPill>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
