"use client";

/**
 * Linha do tempo — o que estava previsto, o que aconteceu, o que falta.
 *
 * A versão anterior desenhava uma barra emissão→limite e um traço de limite.
 * Bonita e muda: não dizia em que etapa o pedido está, há quanto tempo, nem
 * o que falta — e como muitos pedidos têm a mesma janela, vinte linhas liam-se
 * exactamente iguais. Agora cada linha conta a história sem ser expandida:
 *
 *   coluna fixa   pedido · cliente · valor · nº de compras
 *   trilha        marcos DO PEDIDO sobre um calendário partilhado —
 *                 emissão, PC, aprovação, previsão do material (e a remarcada),
 *                 chegada, limite. Hoje é uma linha vertical.
 *   estado        em que etapa está, há quantos dias, e o que falta
 *
 * Expandir dá o detalhe por compra e as durações realizadas de cada etapa
 * ("venda → PC 5d · PC → aprovação 2d"), que é a leitura de tempo por etapa.
 *
 * As etapas e as datas vêm de `lib/etapas-tempo`, onde está registado quais
 * a vista sabe datar. Não há data de criação de RC — por isso não há marco de
 * RC, e a legenda não o promete. O que não existe não se desenha.
 */

import { useMemo, useState } from "react";
import { resumoDoTempo, type ResumoTempo } from "@/lib/etapas-tempo";
import { Chevron, StatusPill, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? "").trim();
const DIA_MS = 86_400_000;

/** O Omie manda dd/mm/yyyy nuns campos e ISO noutros. */
function dia(v: unknown): number | null {
  const t = s(v);
  if (!t) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t.slice(0, 10);
  const d = Date.parse(iso + "T00:00:00");
  return Number.isNaN(d) ? null : d;
}

const dBR = (t: number) => new Date(t).toLocaleDateString("pt-BR");

type Forma = "circulo" | "circuloCheio" | "quadrado" | "losango";
type Marco = { em: number; forma: Forma; cor: string; titulo: string };

function Simbolo({ forma, cor, tam = 9 }: { forma: Forma; cor: string; tam?: number }) {
  const base: React.CSSProperties = {
    width: tam, height: tam, border: `1.5px solid ${cor}`,
    background: forma === "circulo" ? "transparent" : cor,
    display: "inline-block", flex: "0 0 auto",
  };
  if (forma === "quadrado") return <span style={{ ...base, borderRadius: 2 }} />;
  if (forma === "losango") return <span style={{ ...base, borderRadius: 2, transform: "rotate(45deg)" }} />;
  return <span style={{ ...base, borderRadius: "50%" }} />;
}

const LEGENDA: { rot: string; forma: Forma; cor: string }[] = [
  { rot: "PC emitido", forma: "quadrado", cor: "var(--ww-info)" },
  { rot: "Aprovado", forma: "quadrado", cor: "var(--ww-ok)" },
  { rot: "Previsão do material", forma: "circulo", cor: "var(--ww-text-faint)" },
  { rot: "Previsão remarcada", forma: "circulo", cor: "var(--ww-warn)" },
  { rot: "Material recebido", forma: "circuloCheio", cor: "var(--ww-ok)" },
  { rot: "Faturado", forma: "losango", cor: "var(--ww-violet)" },
];

const COL = "300px 1fr 210px";

export default function LinhaDoTempo({
  buckets, formatarValor, onLoteClick,
}: {
  buckets: { pv_os_label: string; cliente: string | null; rows: AnyRow[] }[];
  formatarValor: (v: number) => string;
  onLoteClick?: (r: AnyRow) => void;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const hoje = useMemo(() => {
    const d = new Date();
    return Date.parse(`${d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T00:00:00`);
  }, []);

  /* Janela rolante, não o intervalo todo dos dados: há PV de 2024 ainda
     listados, e deixá-los mandar na escala esmagava dois anos num ecrã. */
  const janela = useMemo(() => {
    const min = hoje - 56 * DIA_MS;
    const max = hoje + 112 * DIA_MS;
    return { min, max, span: max - min };
  }, [hoje]);

  const pos = (t: number) => Math.max(0, Math.min(100, ((t - janela.min) / janela.span) * 100));
  const antes = (t: number | null) => t != null && t < janela.min;
  const depois = (t: number | null) => t != null && t > janela.max;
  const dentro = (t: number | null): t is number => t != null && !antes(t) && !depois(t);

  const marcasSemana = useMemo(() => {
    const out: { em: number; rot: string }[] = [];
    for (let t = hoje - 56 * DIA_MS; t <= janela.max; t += 28 * DIA_MS) {
      const d = new Date(t);
      out.push({ em: t, rot: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` });
    }
    return out;
  }, [hoje, janela.max]);

  const dados = useMemo(() => buckets.map((b) => ({
    ...b,
    resumo: resumoDoTempo(b.rows, b.rows[0] ?? {}, hoje),
  })), [buckets, hoje]);

  if (buckets.length === 0) {
    return <div className="py-14 text-center text-[12px] text-ww-textFaint">Nada para mostrar com estes filtros.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Legenda + régua */}
      <div style={{ display: "grid", gridTemplateColumns: COL, gap: 12, alignItems: "end" }}>
        <span style={{
          display: "flex", flexWrap: "wrap", gap: "4px 10px",
          fontSize: "var(--text-micro)", color: "var(--ww-text-faint)",
        }}>
          {LEGENDA.map((l) => (
            <span key={l.rot} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Simbolo forma={l.forma} cor={l.cor} />{l.rot}
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: "var(--ww-crit)" }} />
            Limite do PV
          </span>
        </span>
        <span style={{ position: "relative", height: 18 }}>
          {marcasSemana.map((m) => (
            <span key={m.em} style={{
              position: "absolute", left: `${pos(m.em)}%`, top: 3,
              transform: "translateX(-50%)", fontSize: "var(--text-micro)",
              color: "var(--ww-text-faint)", whiteSpace: "nowrap",
            }}>{m.rot}</span>
          ))}
          <span style={{
            position: "absolute", left: `${pos(hoje)}%`, top: 0, bottom: 0, width: 2,
            background: "var(--ww-ok)", boxShadow: "var(--ww-glow-ok)",
          }} />
          <span style={{
            position: "absolute", left: `${pos(hoje)}%`, top: 1,
            transform: "translateX(-50%)", fontSize: "var(--text-micro)", fontWeight: 700,
            color: "var(--ww-ok-text)", whiteSpace: "nowrap",
            background: "var(--ww-panel)", padding: "0 4px",
          }}>hoje</span>
        </span>
        <span style={{
          fontSize: "var(--text-chip)", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "var(--tracking-label)", color: "var(--ww-text-2)",
          paddingLeft: 12, borderLeft: "1px solid var(--ww-border-subtle)",
        }}>Onde está · o que falta</span>
      </div>

      {dados.map((b) => {
        const r = b.resumo;
        const aberto = abertos[b.pv_os_label] ?? false;
        const atrasado = r.atrasoLimite != null && r.atrasoLimite > 0 && r.atual != null;
        const head = b.rows[0] ?? {};

        /* Marcos do pedido. Só entram os que TÊM data — um marco sem data não
           vira ponto no meio da trilha. */
        const marcos: Marco[] = [];
        const push = (t: number | null, forma: Forma, cor: string, titulo: string) => {
          if (t != null) marcos.push({ em: t, forma, cor, titulo });
        };
        const et = Object.fromEntries(r.etapas.map((e) => [e.chave, e]));
        push(et.pc?.em ?? null, "quadrado", "var(--ww-info)", "PC emitido");
        push(et.aprov?.em ?? null, "quadrado", "var(--ww-ok)", "Aprovado");
        push(et.nf?.remarcado ?? null, "circulo", "var(--ww-warn)", "Previsão remarcada");
        if (!et.nf?.remarcado) push(et.nf?.previsto ?? null, "circulo", "var(--ww-text-faint)", "Previsão do material");
        push(et.nf?.em ?? null, "circuloCheio", "var(--ww-ok)", "Material recebido");
        push(et.fat?.em ?? null, "losango", "var(--ww-violet)", "Faturado");

        const foraAtras = marcos.filter((m) => antes(m.em)).length;
        const tomEstado: Tom = !r.atual ? "ok" : atrasado ? "crit" : "warn";

        return (
          <div key={b.pv_os_label} style={{
            borderRadius: "var(--radius-row)", background: "var(--ww-row-l0)",
            border: "1px solid var(--ww-border-subtle)", padding: "10px 12px",
          }}>
            <div style={{ display: "grid", gridTemplateColumns: COL, gap: 12, alignItems: "center" }}>
              {/* Coluna fixa */}
              <button type="button"
                onClick={() => setAbertos((x) => ({ ...x, [b.pv_os_label]: !aberto }))}
                style={{
                  display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                  background: "transparent", border: 0, cursor: "pointer", minWidth: 0, padding: 0,
                }}>
                <Chevron open={aberto} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "var(--text-body-sm)", fontWeight: 700, color: "var(--ww-text)" }}>
                    {b.pv_os_label}
                  </span>
                  <span style={{
                    display: "block", fontSize: "var(--text-micro)", color: "var(--ww-text-muted)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {b.cliente ?? "—"} · {formatarValor(Number(head.pv_valor_total ?? 0))}
                    {" · "}{b.rows.length} compra{b.rows.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>

              {/* Trilha */}
              <span style={{ position: "relative", height: 26 }}>
                {marcasSemana.map((m) => (
                  <span key={m.em} style={{
                    position: "absolute", left: `${pos(m.em)}%`, top: 0, bottom: 0,
                    width: 1, background: "var(--ww-border-subtle)", opacity: 0.5,
                  }} />
                ))}

                {/* Pedido inteiramente atrás da janela: a barra colapsava a zero
                    e sobrava uma seta muda. O que interessa é o atraso. */}
                {r.limite != null && r.limite < janela.min ? (
                  <span style={{
                    position: "absolute", left: 0, top: 4,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: "var(--text-micro)", fontWeight: 600,
                    color: "var(--ww-crit-text)", background: "var(--ww-crit-soft)",
                    border: "1px solid var(--ww-crit)", borderRadius: "var(--radius-pill)",
                    padding: "2px 8px",
                  }}>
                    ◀ limite {dBR(r.limite)} · {r.atrasoLimite}d de atraso
                    {foraAtras > 0 && ` · ${foraAtras} marco(s) antes`}
                  </span>
                ) : (
                  <>
                    {r.emissao != null && r.limite != null && (
                      <>
                        <span style={{
                          position: "absolute", top: 10, height: 6, borderRadius: "var(--radius-bar)",
                          left: `${pos(r.emissao)}%`,
                          width: `${Math.max(0.4, pos(r.limite) - pos(r.emissao))}%`,
                          background: "var(--ww-track)",
                        }} />
                        <span style={{
                          position: "absolute", top: 10, height: 6, borderRadius: "var(--radius-bar)",
                          left: `${pos(r.emissao)}%`,
                          width: `${Math.max(0, Math.min(pos(r.limite), pos(hoje)) - pos(r.emissao))}%`,
                          background: atrasado ? "var(--ww-crit)" : "var(--ww-ok)",
                          boxShadow: atrasado ? "none" : "var(--ww-glow-ok)",
                        }} />
                        <span title={`limite do PV · ${dBR(r.limite)}`} style={{
                          position: "absolute", left: `${pos(r.limite)}%`, top: 3, bottom: 3,
                          width: 2, background: "var(--ww-crit)",
                        }} />
                      </>
                    )}
                    {foraAtras > 0 && (
                      <span style={{
                        position: "absolute", left: 0, top: 6, fontSize: "var(--text-micro)",
                        color: "var(--ww-text-faint)", background: "var(--ww-row-l0)", paddingRight: 4,
                      }}>◀ {foraAtras}</span>
                    )}
                    {marcos.filter((m) => dentro(m.em)).map((m, k) => (
                      <span key={k} title={`${m.titulo} · ${dBR(m.em)}`}
                        style={{
                          position: "absolute", left: `${pos(m.em)}%`, top: m.forma === "quadrado" ? 8.5 : 8,
                          transform: "translateX(-50%)", lineHeight: 0,
                        }}>
                        <Simbolo forma={m.forma} cor={m.cor} />
                      </span>
                    ))}
                  </>
                )}
                <span style={{
                  position: "absolute", left: `${pos(hoje)}%`, top: 0, bottom: 0,
                  width: 1, background: "var(--ww-ok)", opacity: 0.45,
                }} />
              </span>

              {/* Estado — a parte que faltava: onde está e o que falta */}
              <span style={{
                display: "flex", flexDirection: "column", gap: 3, minWidth: 0,
                paddingLeft: 12, borderLeft: "1px solid var(--ww-border-subtle)",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <StatusPill tone={tomEstado}>{r.atual ? r.atual.rotulo : "Concluído"}</StatusPill>
                  {r.diasNaAtual != null && (
                    <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-muted)" }}>
                      há {r.diasNaAtual}d
                    </span>
                  )}
                </span>
                <span style={{
                  fontSize: "var(--text-micro)", color: "var(--ww-text-faint)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {r.falta}
                  {r.atrasoLimite != null && r.atual != null && (
                    r.atrasoLimite > 0
                      ? <span style={{ color: "var(--ww-crit-text)" }}> · {r.atrasoLimite}d além do limite</span>
                      : <span> · {Math.abs(r.atrasoLimite)}d de folga</span>
                  )}
                </span>
              </span>
            </div>

            {aberto && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--ww-border-subtle)" }}>
                {/* Durações realizadas — a leitura de "tempo de cada etapa" */}
                {r.duracoes.length > 0 && (
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8,
                    fontSize: "var(--text-micro)", color: "var(--ww-text-muted)",
                  }}>
                    {r.duracoes.map((d) => (
                      <span key={d.rotulo}>
                        {d.rotulo} <strong style={{ color: "var(--ww-text)" }}>{d.dias}d</strong>
                      </span>
                    ))}
                    {r.etapas.find((e) => e.chave === "nf")?.previsto != null
                      && r.etapas.find((e) => e.chave === "nf")?.em != null && (() => {
                        const nf = r.etapas.find((e) => e.chave === "nf")!;
                        const desvio = Math.round(((nf.em as number) - (nf.previsto as number)) / DIA_MS);
                        return (
                          <span style={{ color: desvio > 0 ? "var(--ww-crit-text)" : "var(--ww-ok-text)" }}>
                            material {desvio > 0 ? `${desvio}d depois` : `${Math.abs(desvio)}d antes`} do previsto
                          </span>
                        );
                      })()}
                  </div>
                )}

                {/* Detalhe por compra */}
                {b.rows.map((row, i) => {
                  const mc: Marco[] = [];
                  const p = (v: unknown, forma: Forma, cor: string, titulo: string) => {
                    const d = dia(v);
                    if (d != null) mc.push({ em: d, forma, cor, titulo });
                  };
                  p(row.dt_inclusao, "quadrado", "var(--ww-info)", "PC emitido");
                  p(row.aprovado_em, "quadrado", "var(--ww-ok)", "Aprovado");
                  p(row.nova_prev_materiais, "circulo", "var(--ww-warn)", "Previsão remarcada");
                  if (!s(row.nova_prev_materiais)) p(row.dt_previsao, "circulo", "var(--ww-text-faint)", "Previsão do material");
                  p(row.mt_data_recebimento_nf, "circuloCheio", "var(--ww-ok)", "Material recebido");

                  const pc = s(row.pc_numero) || s(row.pc_numero_manual);
                  const foraMc = mc.filter((m) => antes(m.em)).length;

                  return (
                    <div key={`${s(row.ncod_ped)}-${i}`}
                      onClick={() => onLoteClick?.(row)}
                      style={{
                        display: "grid", gridTemplateColumns: COL, gap: 12,
                        alignItems: "center", marginTop: 4,
                        cursor: onLoteClick ? "pointer" : "default",
                      }}>
                      <span style={{
                        paddingLeft: "var(--tree-indent)", fontSize: "var(--text-micro)",
                        color: "var(--ww-text-muted)", overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {pc ? `PC ${pc} · ${s(row.nome_fornecedor) || "—"}`
                           : s(row.rc_numero) ? `RC ${s(row.rc_numero)} · ${s(row.rc_descricao) || "sem descrição"}`
                           : "sem RC nem PC"}
                      </span>
                      <span style={{ position: "relative", height: 16 }}>
                        <span style={{
                          position: "absolute", left: 0, right: 0, top: 7, height: 1,
                          background: "var(--ww-border-subtle)",
                        }} />
                        {foraMc > 0 && (
                          <span title={mc.filter((m) => antes(m.em)).map((m) => `${m.titulo} · ${dBR(m.em)}`).join("\n")}
                            style={{
                              position: "absolute", left: 0, top: 1, fontSize: "var(--text-micro)",
                              color: "var(--ww-text-faint)", background: "var(--ww-row-l0)", paddingRight: 4,
                            }}>◀ {foraMc}</span>
                        )}
                        {mc.filter((m) => dentro(m.em)).map((m, k) => (
                          <span key={k} title={`${m.titulo} · ${dBR(m.em)}`}
                            style={{
                              position: "absolute", left: `${pos(m.em)}%`, top: 3.5,
                              transform: "translateX(-50%)", lineHeight: 0,
                            }}>
                            <Simbolo forma={m.forma} cor={m.cor} />
                          </span>
                        ))}
                        {mc.length === 0 && (
                          <span style={{
                            position: "absolute", left: 0, top: 1, fontSize: "var(--text-micro)",
                            color: "var(--ww-text-faint)",
                          }}>sem datas — só requisição</span>
                        )}
                      </span>
                      <span style={{
                        paddingLeft: 12, borderLeft: "1px solid var(--ww-border-subtle)",
                        fontSize: "var(--text-micro)", color: "var(--ww-text-faint)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {pc
                          ? (s(row.mt_data_recebimento_nf) ? `recebido ${s(row.mt_data_recebimento_nf).slice(0, 10)}`
                             : s(row.nova_prev_materiais) ? `prev. ${s(row.nova_prev_materiais).slice(0, 10)}`
                             : s(row.dt_previsao) ? `prev. ${s(row.dt_previsao)}`
                             : "sem previsão")
                          : "aguarda PC"}
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
  );
}

export type { ResumoTempo };
