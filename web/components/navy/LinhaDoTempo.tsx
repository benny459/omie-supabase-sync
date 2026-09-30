"use client";

/**
 * Linha do tempo — coluna fixa à esquerda, trilha de semanas à direita.
 *
 * Responde a uma pergunta que nem a lista nem o kanban respondem: *quando*.
 * Onde o pedido está no seu prazo, e em que ordem os marcos do lote caíram.
 *
 * Do handoff:
 *   Pedido — faixa emissão→limite ao fundo, preenchida até hoje. Ciano dentro
 *            do prazo, coral se o limite já passou.
 *   Lote   — RC criada (círculo vazado) · PC emitido (quadrado azul) ·
 *            Aprovado (quadrado ciano) · previsão original (círculo vazado) ·
 *            nova previsão (círculo âmbar) · recebido (círculo ciano cheio).
 *   Hoje   — linha ciano. Limite do PV — linha coral.
 *
 * Só desenha o que tem data. Marco sem data não vira ponto no meio da trilha:
 * inventar posição é pior do que não mostrar.
 */

import { useMemo, useState } from "react";
import { Chevron } from "./primitivos";

type AnyRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? "").trim();

/** O Omie manda dd/mm/yyyy nuns campos e ISO noutros. */
function dia(v: unknown): number | null {
  const t = s(v);
  if (!t) return null;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t.slice(0, 10);
  const d = Date.parse(iso + "T00:00:00");
  return Number.isNaN(d) ? null : d;
}

const DIA_MS = 86_400_000;

type Marco = { em: number; forma: "circulo" | "circuloCheio" | "quadrado"; cor: string; titulo: string };

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

  /* Janela comum a todos: sem isto cada linha teria a sua escala e a
     comparação visual entre pedidos — que é o ponto da vista — perdia-se.
     Mas a janela é *rolante*, não o intervalo todo dos dados: há PV de 2024
     ainda em aberto, e deixá-los mandar na escala esmagava dois anos num
     ecrã — todas as barras ficavam cotos de 20px à esquerda e o "hoje"
     encostado à direita. Prende-se em [hoje−8sem, hoje+16sem] e quem cai
     fora ganha uma seta no bordo. */
  const janela = useMemo(() => {
    const min = hoje - 56 * DIA_MS;
    const max = hoje + 112 * DIA_MS;
    return { min, max, span: max - min };
  }, [hoje]);

  /** Posição em %, presa ao intervalo visível. */
  const pos = (t: number) =>
    Math.max(0, Math.min(100, ((t - janela.min) / janela.span) * 100));
  const antes = (t: number | null) => t != null && t < janela.min;
  const depois = (t: number | null) => t != null && t > janela.max;

  /* Marcas de semana ao fundo — sem elas a barra é um traço sem unidade.
     Uma a cada 4 semanas, para não virar grade. */
  const marcasSemana = useMemo(() => {
    const out: { em: number; rot: string }[] = [];
    for (let t = hoje - 56 * DIA_MS; t <= janela.max; t += 28 * DIA_MS) {
      const d = new Date(t);
      out.push({ em: t, rot: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` });
    }
    return out;
  }, [hoje, janela.max]);

  if (buckets.length === 0) {
    return <div className="py-14 text-center text-[12px] text-ww-textFaint">Nada para mostrar com estes filtros.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Régua */}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, alignItems: "center" }}>
        {/* Legenda do modelo: sem ela os marcos sao pontos sem significado. */}
        <span style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>
          {([
            ["RC criada", "circulo", "var(--ww-text-faint)"],
            ["PC emitido", "quadrado", "var(--ww-info)"],
            ["Aprovado", "quadrado", "var(--ww-ok)"],
            ["Recebido", "circuloCheio", "var(--ww-ok)"],
            ["Aguardando / previsto", "circulo", "var(--ww-warn)"],
          ] as [string, string, string][]).map(([rot, forma, cor]) => (
            <span key={rot} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: forma === "quadrado" ? 8 : 9, height: forma === "quadrado" ? 8 : 9,
                borderRadius: forma === "quadrado" ? 2 : "50%",
                background: forma === "circulo" ? "transparent" : cor,
                border: `1.5px solid ${cor}`,
              }} />
              {rot}
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: "var(--ww-crit)" }} />
            Previsão limite do PV
          </span>
        </span>
        <span style={{ position: "relative", height: 16 }}>
          {marcasSemana.map((m) => (
            <span key={m.em} style={{
              position: "absolute", left: `${pos(m.em)}%`, top: 2,
              transform: "translateX(-50%)", fontSize: "var(--text-micro)",
              color: "var(--ww-text-faint)", whiteSpace: "nowrap",
            }}>{m.rot}</span>
          ))}
          <span style={{
            position: "absolute", left: `${pos(hoje)}%`, top: 0, bottom: 0, width: 2,
            background: "var(--ww-ok)", boxShadow: "var(--ww-glow-ok)",
          }} />
          <span style={{
            position: "absolute", left: `${pos(hoje)}%`, top: 0,
            transform: "translateX(-50%)", fontSize: "var(--text-micro)",
            fontWeight: 700, color: "var(--ww-ok-text)", whiteSpace: "nowrap",
            background: "var(--ww-panel)", padding: "0 4px",
          }}>hoje</span>
        </span>
      </div>

      {buckets.map((b) => {
        const head = b.rows[0] ?? {};
        const emissao = dia(head.pv_emissao);
        const limite = dia(head.pv_data_previsao);
        const aberto = abertos[b.pv_os_label] ?? false;
        const atrasado = limite != null && limite < hoje;

        return (
          <div key={b.pv_os_label} style={{
            borderRadius: "var(--radius-row)", background: "var(--ww-row-l0)",
            border: "1px solid var(--ww-border-subtle)", padding: "10px 12px",
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, alignItems: "center" }}>
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
                  </span>
                </span>
              </button>

              {/* Faixa do pedido */}
              <span style={{ position: "relative", height: 22 }}>
                {marcasSemana.map((m) => (
                  <span key={m.em} style={{
                    position: "absolute", left: `${pos(m.em)}%`, top: 0, bottom: 0,
                    width: 1, background: "var(--ww-border-subtle)", opacity: 0.5,
                  }} />
                ))}
                {/* Pedido inteiramente atrás da janela: a barra colapsava a
                    zero e sobrava uma seta muda. O que importa nesse caso não
                    é o intervalo — é há quanto tempo o prazo rebentou. */}
                {emissao != null && limite != null && limite < janela.min && (
                  <span style={{
                    position: "absolute", left: 0, top: 3,
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: "var(--text-micro)", fontWeight: 600,
                    color: "var(--ww-crit-text)", background: "var(--ww-crit-soft)",
                    border: "1px solid var(--ww-crit)",
                    borderRadius: "var(--radius-pill)", padding: "2px 8px",
                  }}>
                    ◀ limite {new Date(limite).toLocaleDateString("pt-BR")} ·
                    {" "}{Math.floor((hoje - limite) / DIA_MS)}d de atraso
                  </span>
                )}
                {emissao != null && limite != null && limite >= janela.min && (
                  <>
                    <span style={{
                      position: "absolute", top: 8, height: 6, borderRadius: "var(--radius-bar)",
                      left: `${pos(emissao)}%`, width: `${Math.max(0.4, pos(limite) - pos(emissao))}%`,
                      background: "var(--ww-track)",
                    }} />
                    <span style={{
                      position: "absolute", top: 8, height: 6, borderRadius: "var(--radius-bar)",
                      left: `${pos(emissao)}%`,
                      width: `${Math.max(0, Math.min(pos(limite), pos(hoje)) - pos(emissao))}%`,
                      background: atrasado ? "var(--ww-crit)" : "var(--ww-ok)",
                      boxShadow: atrasado ? "none" : "var(--ww-glow-ok)",
                    }} />
                    <span title="limite do PV" style={{
                      position: "absolute", left: `${pos(limite)}%`, top: 2, bottom: 2,
                      width: 2, background: "var(--ww-crit)",
                    }} />
                    {/* Fora da janela: a seta diz que a barra continua para lá
                        do bordo, em vez de mentir que começa/acaba ali. */}
                    {antes(emissao) && (
                      <span title={`emitido em ${new Date(emissao).toLocaleDateString("pt-BR")}`}
                        style={{
                          position: "absolute", left: 0, top: 4, fontSize: "var(--text-micro)",
                          color: "var(--ww-text-faint)", background: "var(--ww-row-l0)",
                          paddingRight: 3,
                        }}>◀</span>
                    )}
                    {depois(limite) && (
                      <span title={`limite em ${new Date(limite).toLocaleDateString("pt-BR")}`}
                        style={{
                          position: "absolute", right: 0, top: 4, fontSize: "var(--text-micro)",
                          color: "var(--ww-text-faint)", background: "var(--ww-row-l0)",
                          paddingLeft: 3,
                        }}>▶</span>
                    )}
                  </>
                )}
                {(emissao == null || limite == null) && (
                  <span style={{
                    position: "absolute", left: 0, top: 6, fontSize: "var(--text-micro)",
                    color: "var(--ww-text-faint)",
                  }}>sem emissão ou limite no Omie</span>
                )}
                <span style={{
                  position: "absolute", left: `${pos(hoje)}%`, top: 0, bottom: 0,
                  width: 1, background: "var(--ww-ok)", opacity: 0.45,
                }} />
              </span>
            </div>

            {/* Lotes */}
            {aberto && b.rows.map((r, i) => {
              const marcos: Marco[] = [];
              const push = (v: unknown, forma: Marco["forma"], cor: string, titulo: string) => {
                const d = dia(v);
                if (d != null) marcos.push({ em: d, forma, cor, titulo });
              };
              push(r.dt_inclusao, "quadrado", "var(--ww-info)", "PC emitido");
              push(r.aprovado_em, "quadrado", "var(--ww-ok)", "Aprovado");
              push(r.dt_previsao, "circulo", "var(--ww-text-faint)", "Previsão original");
              push(r.nova_prev_materiais, "circulo", "var(--ww-warn)", "Nova previsão");
              push(r.mt_data_recebimento_nf, "circuloCheio", "var(--ww-ok)", "NF recebida");

              const pc = s(r.pc_numero) || s(r.pc_numero_manual);
              return (
                <div key={`${s(r.ncod_ped)}-${i}`}
                  onClick={() => onLoteClick?.(r)}
                  style={{
                    display: "grid", gridTemplateColumns: "320px 1fr", gap: 12,
                    alignItems: "center", marginTop: 4, cursor: onLoteClick ? "pointer" : "default",
                  }}>
                  <span style={{
                    paddingLeft: "var(--tree-indent)", fontSize: "var(--text-micro)",
                    color: "var(--ww-text-muted)", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {/* Sem PC ainda não há fornecedor, e duas linhas da mesma
                        RC liam ambas "RC 7299 · —" — indistinguíveis, pareciam
                        a mesma repetida. Quem as separa é a descrição do item,
                        por isso é ela que entra no rótulo. */}
                    {pc ? `PC ${pc} · ${s(r.nome_fornecedor) || "—"}`
                       : s(r.rc_numero) ? `RC ${s(r.rc_numero)} · ${s(r.rc_descricao) || "sem descrição"}`
                       : "lote sem RC nem PC"}
                  </span>
                  <span style={{ position: "relative", height: 16 }}>
                    <span style={{
                      position: "absolute", left: 0, right: 0, top: 7, height: 1,
                      background: "var(--ww-border-subtle)",
                    }} />
                    {/* Marco fora da janela vira contagem no bordo: encostá-lo
                        ao limite punha-o a fingir uma data que não tem. */}
                    {(() => {
                      const fora = marcos.filter((m) => antes(m.em));
                      if (fora.length === 0) return null;
                      return (
                        <span title={fora.map((m) => `${m.titulo} · ${new Date(m.em).toLocaleDateString("pt-BR")}`).join("\n")}
                          style={{
                            position: "absolute", left: 0, top: 1, fontSize: "var(--text-micro)",
                            color: "var(--ww-text-faint)", background: "var(--ww-row-l0)", paddingRight: 4,
                          }}>◀ {fora.length}</span>
                      );
                    })()}
                    {marcos.filter((m) => !antes(m.em) && !depois(m.em)).map((m, k) => (
                      <span key={k} title={`${m.titulo} · ${new Date(m.em).toLocaleDateString("pt-BR")}`}
                        style={{
                          position: "absolute", left: `${pos(m.em)}%`, top: m.forma === "quadrado" ? 4 : 3.5,
                          transform: "translateX(-50%)",
                          width: m.forma === "quadrado" ? 8 : 9,
                          height: m.forma === "quadrado" ? 8 : 9,
                          borderRadius: m.forma === "quadrado" ? 2 : "50%",
                          background: m.forma === "circulo" ? "transparent" : m.cor,
                          border: `1.5px solid ${m.cor}`,
                        }} />
                    ))}
                    {marcos.length === 0 && (
                      <span style={{
                        position: "absolute", left: 0, top: 1, fontSize: "var(--text-micro)",
                        color: "var(--ww-text-faint)",
                      }}>sem datas</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
