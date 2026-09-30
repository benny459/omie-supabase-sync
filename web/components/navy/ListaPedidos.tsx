"use client";

/**
 * Lista — a vista por omissão do modelo: um cartão por pedido que abre nas
 * suas COMPRAS, e cada compra abre nos itens.
 *
 * "Lote" era o nome do mockup e não descreve o que a linha é: cada linha do
 * segundo nível é uma compra — um par RC → PC, com fornecedor, aprovação e
 * materiais próprios. As colunas já diziam isso; o rótulo é que não.
 *
 * Cartão do pedido:  chevron · id + tipo/nº lotes · cliente + previsão limite
 *                    · trilho de 7 segmentos · chips · valor
 * Lote (aberto):     mini-tabela Lote · RC · PC/fornecedor · Aprovação ·
 *                    Materiais (com barra) · Valor PC
 * Item (aberto):     descrição+código · qtd × unitário · barra + estado ·
 *                    rec/qtd un
 *
 * Os itens vêm de orders.pedidos_compra ao expandir o lote — 15.936 no total,
 * não se carregam à cabeça.
 */

import { useCallback, useState } from "react";
import { STATUS_META } from "@/lib/columns";
import { Chevron, PipelineRail, ProgressBar, StatusPill, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

type ItemPc = {
  ncod_item: number | null; cproduto: string | null; cdescricao: string | null;
  cunidade: string | null; nqtde: number | null; nqtde_rec: number | null;
  nval_unit: number | null;
};

export type Pedido = {
  pv_os_label: string;
  cliente: string | null;
  rows: AnyRow[];
  /** Lotes já deduplicados por número de PC pelo chamador. */
  lotes: AnyRow[];
  head: AnyRow;
  chips: { texto: string; tom: Tom }[];
  rail: Tom[];
};

function estadoItem(it: ItemPc): { tom: Tom; rotulo: string; pct: number } {
  const q = n(it.nqtde), r = n(it.nqtde_rec);
  if (q <= 0) return { tom: "off", rotulo: "—", pct: 0 };
  if (r >= q) return { tom: "ok", rotulo: "Recebido", pct: 100 };
  if (r > 0) return { tom: "warn", rotulo: "Parcial", pct: (r / q) * 100 };
  return { tom: "off", rotulo: "A receber", pct: 0 };
}

/** Estado de Materiais do lote, com a barra que o modelo mostra. */
function materiaisDoLote(r: AnyRow): { tom: Tom; rotulo: string; pct: number; sub: string } {
  const recebido = s(r.mt_data_recebimento_nf);
  const status = s(r.mt_status_fornecimento);
  const aprovado = STATUS_META[s(r.status)]?.isApproved === true;
  if (recebido) {
    return { tom: "ok", rotulo: status || "Recebido", pct: 100,
             sub: `NF ${s(r.mt_nf_fornecedor) || "—"} · ${recebido}` };
  }
  if (!aprovado) {
    return { tom: "off", rotulo: "Aguarda aprov.", pct: 0, sub: "libera após aprovação" };
  }
  const nova = s(r.nova_prev_materiais);
  return { tom: "warn", rotulo: "A caminho", pct: 35,
           sub: nova ? `nova ${nova}` : s(r.dt_previsao) ? `prev. ${s(r.dt_previsao)}` : "" };
}

export default function ListaPedidos({
  pedidos, dinheiro, empresa, abrirTudo, onLoteClick,
}: {
  pedidos: Pedido[];
  dinheiro: (v: number) => string;
  empresa: string;
  /** Sinal externo de Expandir tudo / Recolher. */
  abrirTudo: number | null;
  onLoteClick?: (r: AnyRow) => void;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [lotesAbertos, setLotesAbertos] = useState<Record<string, boolean>>({});
  const [itens, setItens] = useState<Record<string, ItemPc[]>>({});

  // Expandir tudo / Recolher: o chamador muda o sinal, aqui reage.
  const chaveSinal = `${abrirTudo}`;
  const [ultimoSinal, setUltimoSinal] = useState<string>("null");
  if (chaveSinal !== ultimoSinal) {
    setUltimoSinal(chaveSinal);
    if (abrirTudo != null) {
      setAbertos(abrirTudo > 0
        ? Object.fromEntries(pedidos.map((p) => [p.pv_os_label, true]))
        : {});
      if (abrirTudo <= 0) setLotesAbertos({});
    }
  }

  const abrirLote = useCallback(async (chave: string, ncod: number) => {
    setLotesAbertos((o) => ({ ...o, [chave]: !o[chave] }));
    if (ncod < 0 || itens[chave]) return;
    try {
      const r = await fetch(`/api/pcs/itens?empresa=${encodeURIComponent(empresa)}&ncod=${ncod}`);
      const j = await r.json();
      setItens((o) => ({ ...o, [chave]: r.ok ? (j.itens?.[String(ncod)] ?? []) : [] }));
    } catch { setItens((o) => ({ ...o, [chave]: [] })); }
  }, [empresa, itens]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {pedidos.map((p) => {
        const aberto = abertos[p.pv_os_label] ?? false;
        return (
          <div key={p.pv_os_label} style={{
            borderRadius: "var(--radius-panel)", background: "var(--ww-panel-grad)",
            border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}>
            {/* Cabeça do pedido */}
            <div onClick={() => setAbertos((o) => ({ ...o, [p.pv_os_label]: !aberto }))}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 104px 1.3fr 240px 1.7fr 120px",
                gap: 16, alignItems: "center", padding: "14px 18px", cursor: "pointer",
              }}>
              <Chevron open={aberto} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 14, color: "var(--ww-text)" }}>
                  {p.pv_os_label}
                </span>
                <span style={{ display: "block", fontSize: "var(--text-chip)", color: "var(--ww-text-faint)" }}>
                  {s(p.head.tipo_omie) || "—"} · {p.lotes.length} compra{p.lotes.length === 1 ? "" : "s"}
                </span>
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{
                  display: "block", fontSize: 14, color: "var(--ww-text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.cliente ?? "—"}</span>
                <span style={{ display: "block", fontSize: "var(--text-chip)", color: "var(--ww-text-faint)" }}>
                  {s(p.head.pv_data_previsao) ? `previsão limite ${s(p.head.pv_data_previsao)}` : "sem previsão"}
                </span>
              </span>
              <PipelineRail states={p.rail} />
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {p.chips.map((c, i) => <StatusPill key={i} tone={c.tom}>{c.texto}</StatusPill>)}
              </span>
              <span style={{
                fontSize: 15, fontWeight: 700, textAlign: "right", color: "var(--ww-text)",
                letterSpacing: "var(--tracking-tight)",
              }}>{dinheiro(n(p.head.pv_valor_total))}</span>
            </div>

            {/* Mini-tabela de lotes */}
            {aberto && (
              <div style={{ padding: "0 18px 14px" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "86px 1.3fr 1.1fr 1fr 1.3fr 110px",
                  gap: 16, padding: "8px 10px", fontSize: "var(--text-chip)",
                  color: "var(--ww-text-faint)", borderBottom: "1px solid var(--ww-border-subtle)",
                }}>
                  <span>Compra</span><span>RC</span><span>PC · fornecedor</span>
                  <span>Aprovação</span><span>Materiais</span>
                  <span style={{ textAlign: "right" }}>Valor PC</span>
                </div>

                {p.lotes.length === 0 && (
                  <div style={{
                    padding: "14px 10px", fontSize: "var(--text-body-sm)",
                    color: "var(--ww-text-faint)", display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", background: "var(--ww-off)",
                    }} />
                    Sem compras lançadas neste pedido — a venda existe, a compra ainda não.
                  </div>
                )}
                {p.lotes.map((r, i) => {
                  const ncod = n(r.ncod_ped);
                  const chave = `${p.pv_os_label}:${ncod}:${i}`;
                  const loteAberto = lotesAbertos[chave] ?? false;
                  const pc = s(r.pc_numero) || s(r.pc_numero_manual);
                  const meta = STATUS_META[s(r.status)];
                  const mat = materiaisDoLote(r);
                  const lista = itens[chave];
                  const temItens = ncod > 0;

                  return (
                    <div key={chave}>
                      <div onClick={() => (temItens ? abrirLote(chave, ncod) : onLoteClick?.(r))}
                        style={{
                          display: "grid", gridTemplateColumns: "86px 1.3fr 1.1fr 1fr 1.3fr 110px",
                          gap: 16, alignItems: "center", padding: "10px",
                          borderBottom: "1px dashed var(--ww-border-subtle)", cursor: "pointer",
                        }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--ww-text)" }}>
                          <Chevron open={loteAberto} hidden={!temItens} />
                          Compra {i + 1}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", color: "var(--ww-text)" }}>{s(r.rc_numero) || "—"}</span>
                          <span style={{
                            display: "block", fontSize: "var(--text-chip)", color: "var(--ww-text-faint)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{s(r.rc_descricao) || ""}</span>
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", color: "var(--ww-text)" }}>{pc ? `PC ${pc}` : "—"}</span>
                          <span style={{
                            display: "block", fontSize: "var(--text-chip)", color: "var(--ww-text-faint)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{s(r.nome_fornecedor) || ""}</span>
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                          {meta
                            ? <StatusPill tone={meta.isApproved ? "ok" : s(r.status) === "PENDENTE" || s(r.status) === "PRE_SELECAO" ? "warn" : "crit"}>
                                {meta.label}
                              </StatusPill>
                            : <span style={{ color: "var(--ww-text-faint)" }}>—</span>}
                          <span style={{ fontSize: "var(--text-chip)", color: "var(--ww-text-faint)" }}>
                            {s(r.aprovador_email) ? `${s(r.aprovador_email).split("@")[0]} · ${s(r.aprovado_em).slice(0, 10)}` : ""}
                          </span>
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <StatusPill tone={mat.tom}>{mat.rotulo}</StatusPill>
                            <span style={{ flex: 1, minWidth: 40 }}><ProgressBar value={mat.pct} tone={mat.tom} height={4} /></span>
                          </span>
                          {mat.sub && <span style={{ fontSize: "var(--text-chip)", color: "var(--ww-text-faint)" }}>{mat.sub}</span>}
                        </span>
                        <span style={{ textAlign: "right", fontWeight: 600, color: "var(--ww-text)" }}>
                          {dinheiro(n(r.valor_total))}
                        </span>
                      </div>

                      {/* Itens */}
                      {loteAberto && temItens && (
                        <div style={{ padding: "6px 0 10px 28px" }}>
                          {!lista ? (
                            [0, 1].map((k) => (
                              <div key={k} style={{ height: 26, marginBottom: 4, borderRadius: 8, background: "var(--ww-row-l2)", opacity: 0.5 }} />
                            ))
                          ) : lista.length === 0 ? (
                            <span style={{ fontSize: "var(--text-chip)", color: "var(--ww-text-faint)" }}>
                              Sem itens no Omie para este PC.
                            </span>
                          ) : lista.map((it, k) => {
                            const e = estadoItem(it);
                            return (
                              <div key={it.ncod_item ?? k} style={{
                                display: "grid", gridTemplateColumns: "1.6fr 150px 1.4fr 90px",
                                gap: 16, alignItems: "center", padding: "6px 10px",
                              }}>
                                <span style={{ minWidth: 0, color: "var(--ww-text)" }}>
                                  {it.cdescricao ?? "—"}
                                  {it.cproduto && (
                                    <span style={{ color: "var(--ww-text-faint)", fontSize: "var(--text-chip)" }}> {it.cproduto}</span>
                                  )}
                                </span>
                                <span style={{ fontSize: "var(--text-chip)", color: "var(--ww-text-muted)" }}>
                                  {n(it.nqtde)} × {dinheiro(n(it.nval_unit))}
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <span style={{ flex: 1, minWidth: 60 }}><ProgressBar value={e.pct} tone={e.tom} height={4} /></span>
                                  <span style={{ fontSize: "var(--text-chip)", color: `var(--ww-${e.tom}-text)`, fontWeight: 600 }}>
                                    {e.rotulo}
                                  </span>
                                </span>
                                <span style={{ textAlign: "right", fontSize: "var(--text-chip)", color: "var(--ww-text-muted)" }}>
                                  {n(it.nqtde_rec)}/{n(it.nqtde)} un
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
