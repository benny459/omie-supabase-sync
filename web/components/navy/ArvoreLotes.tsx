"use client";

/**
 * Árvore Pedido → Lote → Item.
 *
 * O terceiro nível é novo: os itens vêm de `orders.pedidos_compra` e trazem
 * `nqtde_rec`, o recebimento parcial POR ITEM. Esse campo existe desde sempre
 * no espelho do Omie e não aparecia em nenhuma tela — é o que responde
 * "chegou tudo?" sem ir ao Omie.
 *
 * Itens carregam ao expandir o lote (1 pedido por bucket, cache por sessão).
 * São 15.936 itens no total; trazê-los no load inicial pagava por tudo o que
 * ninguém abre.
 *
 * Nada aqui decide regra: estado, cor e permissão vêm de fora.
 */

import { useCallback, useState } from "react";
import { Chevron, ProgressBar, StatusPill, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;

type ItemPc = {
  ncod_ped: number;
  ncod_item: number | null;
  cproduto: string | null;
  cdescricao: string | null;
  cunidade: string | null;
  nqtde: number | null;
  nqtde_rec: number | null;
  nval_unit: number | null;
  nval_tot: number | null;
  ddt_previsao: string | null;
  ddata_recebimento: string | null;
  cnumero_nf: string | null;
};

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/** Estado de recebimento de um item — a leitura que o nqtde_rec permite. */
export function estadoDoItem(it: ItemPc): { tom: Tom; rotulo: string; pct: number } {
  const qtd = n(it.nqtde), rec = n(it.nqtde_rec);
  if (qtd <= 0) return { tom: "off", rotulo: "—", pct: 0 };
  const pct = Math.min(100, (rec / qtd) * 100);
  if (rec >= qtd) return { tom: "ok", rotulo: "recebido", pct: 100 };
  if (rec > 0) return { tom: "warn", rotulo: "parcial", pct };
  return { tom: "off", rotulo: "a receber", pct: 0 };
}

export default function ArvoreLotes({
  bucket, formatarValor, onLoteClick,
}: {
  bucket: { pv_os_label: string; cliente: string | null; rows: AnyRow[]; empresa?: string };
  formatarValor: (v: number) => string;
  onLoteClick?: (r: AnyRow) => void;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [itens, setItens] = useState<Record<string, ItemPc[]>>({});
  const [carregando, setCarregando] = useState<Record<string, boolean>>({});

  const empresa = String(bucket.empresa ?? bucket.rows[0]?.empresa ?? "SF");

  const abrirLote = useCallback(async (ncod: number) => {
    const chave = String(ncod);
    setAbertos((s) => ({ ...s, [chave]: !s[chave] }));
    // Linha manual (ncod negativo) não tem item no Omie; e já em cache não repete.
    if (ncod < 0 || itens[chave] || carregando[chave]) return;
    setCarregando((s) => ({ ...s, [chave]: true }));
    try {
      const r = await fetch(`/api/pcs/itens?empresa=${encodeURIComponent(empresa)}&ncod=${ncod}`);
      const j = await r.json();
      if (r.ok) setItens((s) => ({ ...s, [chave]: (j.itens?.[chave] ?? []) as ItemPc[] }));
      else setItens((s) => ({ ...s, [chave]: [] }));
    } catch {
      setItens((s) => ({ ...s, [chave]: [] }));   // falha não trava a árvore
    } finally {
      setCarregando((s) => ({ ...s, [chave]: false }));
    }
  }, [empresa, itens, carregando]);

  /* Um PC e um PC, como na grade e no Kanban. Sem isto a arvore listava as
     duas copias do mesmo PC — a manual e a do Omie — e a manual, por nao ter
     item nenhum, abria o drawer em vez de expandir. Fica a do Omie (ncod
     positivo), que e a que tem itens. */
  const lotes = (() => {
    const porPc = new Map<string, AnyRow>();
    const semPc: AnyRow[] = [];
    for (const r of bucket.rows) {
      const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
      if (!pc) { semPc.push(r); continue; }
      const anterior = porPc.get(pc);
      if (!anterior || (n(r.ncod_ped) > 0 && n(anterior.ncod_ped) < 0)) porPc.set(pc, r);
    }
    return [...porPc.values(), ...semPc];
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {lotes.map((r, i) => {
        const ncod = Number(r.ncod_ped ?? 0);
        const chave = String(ncod);
        const aberto = abertos[chave] ?? false;
        const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
        const rc = String(r.rc_numero ?? "").trim();
        const lista = itens[chave];
        const semItens = ncod < 0;

        return (
          <div key={`${chave}-${i}`}>
            {/* Nível 2 — lote */}
            <div
              onClick={() => (semItens ? onLoteClick?.(r) : abrirLote(ncod))}
              style={{
                display: "grid", gridTemplateColumns: "20px 120px 1fr 130px 110px",
                alignItems: "center", gap: 12, cursor: "pointer",
                padding: "9px 12px", marginLeft: "var(--tree-indent)",
                borderRadius: "var(--radius-row)", background: "var(--ww-row-l1)",
                border: "1px dashed var(--ww-border-subtle)",
              }}>
              <Chevron open={aberto} hidden={semItens} />
              <span style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--ww-text)" }}>
                {pc ? `PC ${pc}` : rc ? `RC ${rc}` : "—"}
              </span>
              <span style={{
                fontSize: "var(--text-meta)", color: "var(--ww-text-muted)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {String(r.nome_fornecedor ?? r.rc_descricao ?? "—")}
              </span>
              <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)" }}>
                {r.mt_data_recebimento_nf ? "NF recebida" : r.dt_previsao ? `prev. ${String(r.dt_previsao)}` : "—"}
              </span>
              <span style={{
                fontSize: "var(--text-body-sm)", fontWeight: 600,
                color: "var(--ww-text)", textAlign: "right",
              }}>
                {formatarValor(n(r.valor_total))}
              </span>
            </div>

            {/* Nível 3 — itens */}
            {aberto && !semItens && (
              <div style={{ marginLeft: "calc(var(--tree-indent) * 2)", marginTop: 4, marginBottom: 6 }}>
                {carregando[chave] ? (
                  [0, 1].map((k) => (
                    <div key={k} style={{
                      height: 30, marginBottom: 4, borderRadius: 10,
                      background: "var(--ww-row-l2)", opacity: 0.6,
                    }} />
                  ))
                ) : !lista || lista.length === 0 ? (
                  <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-faint)", padding: "6px 12px" }}>
                    Sem itens no Omie para este PC.
                  </div>
                ) : (
                  lista.map((it, k) => {
                    const est = estadoDoItem(it);
                    return (
                      <div key={`${it.ncod_item ?? k}`} style={{
                        display: "grid", gridTemplateColumns: "1.6fr 150px 1.4fr 90px",
                        alignItems: "center", gap: 12, padding: "7px 12px", marginBottom: 3,
                        borderRadius: 10, background: "var(--ww-row-l2)",
                        border: "1px dashed var(--ww-border-subtle)",
                      }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{
                            display: "block", fontSize: "var(--text-meta)", color: "var(--ww-text)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{it.cdescricao ?? "—"}</span>
                          {it.cproduto && (
                            <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>
                              {it.cproduto}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-muted)" }}>
                          {n(it.nqtde)} {it.cunidade ?? ""} × {formatarValor(n(it.nval_unit))}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 60 }}>
                            <ProgressBar value={est.pct} tone={est.tom} height={4} />
                          </span>
                          <StatusPill tone={est.tom}>{est.rotulo}</StatusPill>
                        </span>
                        <span style={{
                          fontSize: "var(--text-micro)", color: "var(--ww-text-muted)", textAlign: "right",
                        }}>
                          {n(it.nqtde_rec)}/{n(it.nqtde)} un
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
