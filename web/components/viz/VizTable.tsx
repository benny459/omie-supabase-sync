"use client";

// Tabela de detalhe — o porte dos 49 cards `table` do Metabase.
//
// Não é a mesma coisa que o toggle "Tabela" do ChartFrame: aquele mostra os
// dados DO GRÁFICO em forma tabular (acessibilidade). Este é a lista
// linha-a-linha que se abre pra conferir caso a caso, e por isso precisa de
// ordenação, busca, cabeçalho fixo e exportação.
//
// Decisões que vêm da natureza do dado, não de estilo:
//  • número sempre alinhado à direita e em tabular-nums — coluna de valor só é
//    comparável quando os dígitos alinham verticalmente;
//  • data em formato curto BR, texto à esquerda;
//  • ordenação padrão pela coluna que o chamador indicar, não pela primeira;
//  • o total do rodapé soma o que está FILTRADO, não o conjunto todo — senão
//    o rodapé contradiz a tela.

import { useMemo, useState } from "react";

export type Col<T> = {
  key: keyof T & string;
  label: string;
  /** Como formatar e alinhar. `money`/`num` alinham à direita. */
  tipo?: "text" | "money" | "num" | "date" | "dias" | "badge";
  /** Largura sugerida (px). */
  w?: number;
  /** Formatador próprio, vence o tipo. */
  fmt?: (v: unknown, row: T) => string;
  /** Tom da badge, quando tipo="badge". */
  tom?: (v: unknown, row: T) => "ok" | "alerta" | "critico" | "neutro";
};

const brl = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const num = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR");
const dataBr = (v: unknown) => {
  const s = String(v ?? "");
  if (!s || s === "null") return "—";
  const d = s.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0].slice(2)}` : s;
};

const TOM_CLASSE: Record<string, string> = {
  ok:      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  alerta:  "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  critico: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  neutro:  "bg-ww-border/60 text-ww-textMuted border-ww-border",
};

/** Minúsculas e sem diacríticos, pra busca não depender de acentuação. */
const normaliza = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function VizTable<T extends Record<string, unknown>>({
  title, subtitle, cols, rows, ordemInicial, loading, altura = 420, totalizar,
  onLinhaClick, podeClicar,
}: {
  title: string;
  subtitle?: string;
  cols: Col<T>[];
  rows: T[];
  /** Coluna da ordenação inicial. Sem isso ordena pela primeira, que raramente
   *  é a interessante. */
  ordemInicial?: keyof T & string;
  loading?: boolean;
  altura?: number;
  /** Colunas que ganham total no rodapé. */
  totalizar?: Array<keyof T & string>;
  /** Abre o detalhe daquela linha. A linha inteira vira alvo, não um ícone de
   *  4px — e o cursor muda pra avisar que há o que clicar. */
  onLinhaClick?: (linha: T) => void;
  /** Nem toda linha tem detalhe. Quando devolve false, a linha não fica
   *  clicável: prometer um detalhe que abre vazio é pior que não oferecer. */
  podeClicar?: (linha: T) => boolean;
}) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ key: string; desc: boolean }>(
    () => ({ key: ordemInicial ?? cols[0]?.key ?? "", desc: true }),
  );

  const filtradas = useMemo(() => {
    // Busca sem acento e por termos soltos. Comparar texto cru fazia "sirio" não
    // achar "SÍRIO" e "campinas hapvida" não achar "HAPVIDA CAMPINAS" — quem
    // digita o nome de um cliente não acerta a acentuação nem a ordem.
    const termos = normaliza(busca).split(/\s+/).filter(Boolean);
    const base = termos.length
      ? rows.filter((r) => {
          const alvo = cols.map((c) => normaliza(String(r[c.key] ?? ""))).join(" ");
          return termos.every((t) => alvo.includes(t));
        })
      : rows;
    const col = cols.find((c) => c.key === ordem.key);
    const numerica = col?.tipo === "money" || col?.tipo === "num" || col?.tipo === "dias";
    return [...base].sort((a, b) => {
      const va = a[ordem.key], vb = b[ordem.key];
      const cmp = numerica
        ? (Number(va ?? 0) - Number(vb ?? 0))
        : String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
      return ordem.desc ? -cmp : cmp;
    });
  }, [rows, cols, busca, ordem]);

  const totais = useMemo(() => {
    if (!totalizar?.length) return null;
    const acc: Record<string, number> = {};
    for (const k of totalizar) acc[k] = filtradas.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return acc;
  }, [filtradas, totalizar]);

  const valorFormatado = (c: Col<T>, r: T) => {
    const v = r[c.key];
    if (c.fmt) return c.fmt(v, r);
    switch (c.tipo) {
      case "money": return brl(v);
      case "num":   return num(v);
      case "date":  return dataBr(v);
      case "dias":  return v == null ? "—" : `${num(v)}d`;
      default:      return v == null || v === "" ? "—" : String(v);
    }
  };
  const alinhaDireita = (c: Col<T>) => c.tipo === "money" || c.tipo === "num" || c.tipo === "dias";

  const exportarCsv = () => {
    const cab = cols.map((c) => c.label).join(";");
    const linhas = filtradas.map((r) =>
      cols.map((c) => `"${String(valorFormatado(c, r)).replace(/"/g, '""')}"`).join(";"));
    const csv = "﻿" + [cab, ...linhas].join("\n");   // BOM: Excel-pt abre certo
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 transition-all">
      <header className="viz-head flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">{subtitle}</p>}
        </div>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar…"
          className="w-[150px] text-[11px] bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text placeholder:text-ww-textFaint"
        />
        <span className="text-[10.5px] text-ww-textFaint tabular-nums">
          {filtradas.length}{filtradas.length !== rows.length ? ` / ${rows.length}` : ""}
        </span>
        <button
          type="button" onClick={exportarCsv}
          className="shrink-0 px-2 py-0.5 text-[10.5px] font-semibold rounded border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition"
          title="Baixa exatamente as linhas filtradas, na ordem da tela"
        >
          CSV
        </button>
      </header>

      <div className="overflow-auto" style={{ maxHeight: altura }}>
        <table className="w-full text-[11.5px] border-collapse">
          {/* Cabeçalho fixo com sombra em vez de borda: border-bottom quebra no
              scroll com position:sticky. */}
          <thead className="sticky top-0 z-10 bg-ww-panel">
            <tr>
              {cols.map((c) => {
                const ativa = ordem.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={c.w ? { width: c.w, minWidth: c.w } : undefined}
                    className={`p-1.5 font-semibold text-[10px] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none transition-colors
                      shadow-[0_1px_0_0_rgb(var(--color-ww-border))]
                      ${alinhaDireita(c) ? "text-right" : "text-left"}
                      ${ativa ? "text-ww-accent" : "text-ww-textMuted hover:text-ww-text"}`}
                    onClick={() => setOrdem((o) =>
                      o.key === c.key ? { key: c.key, desc: !o.desc } : { key: c.key, desc: true })}
                    title="Clique pra ordenar"
                  >
                    {c.label}
                    {ativa && <span aria-hidden className="ml-1">{ordem.desc ? "↓" : "↑"}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={loading ? "opacity-40 transition-opacity" : "transition-opacity"}>
            {filtradas.length === 0 && (
              <tr><td colSpan={cols.length} className="p-6 text-center text-ww-textFaint text-[11.5px]">
                {loading ? "Carregando…" : "Nenhuma linha."}
              </td></tr>
            )}
            {filtradas.map((r, i) => {
              const clicavel = !!onLinhaClick && (podeClicar?.(r) ?? true);
              return (
              <tr key={i}
                  className={`viz-row ${clicavel ? "cursor-pointer" : ""}`}
                  onClick={clicavel ? () => onLinhaClick!(r) : undefined}
                  title={clicavel ? "Clique pra ver a memória de cálculo" : undefined}>
                {cols.map((c) => {
                  const texto = valorFormatado(c, r);
                  if (c.tipo === "badge") {
                    const tom = c.tom?.(r[c.key], r) ?? "neutro";
                    return (
                      <td key={c.key} className="p-1.5 border-b border-ww-border/50">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${TOM_CLASSE[tom]}`}>
                          {texto}
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td key={c.key}
                        className={`p-1.5 border-b border-ww-border/50 text-ww-text ${
                          alinhaDireita(c) ? "text-right tabular-nums" : ""}`}
                        title={texto.length > 28 ? texto : undefined}>
                      {texto}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
          {totais && (
            <tfoot className="sticky bottom-0 bg-ww-panel">
              <tr>
                {cols.map((c, i) => (
                  <td key={c.key}
                      className={`p-1.5 font-bold text-ww-text border-t border-ww-borderStrong ${
                        alinhaDireita(c) ? "text-right tabular-nums" : ""}`}>
                    {i === 0 ? "Total (filtrado)"
                      : totais[c.key] != null
                        ? (c.tipo === "money" ? brl(totais[c.key]) : num(totais[c.key]))
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
