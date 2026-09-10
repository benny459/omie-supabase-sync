"use client";

// Grade editável — o "usar como planilha" pedido para materiais e orçamento.
//
// Três formas de entrada, e nenhuma exclui as outras:
//   1. digitar direto na célula, navegando com Tab / Enter / setas
//   2. colar do Excel (TSV), que expande a grade sozinha
//   3. subir XLSX (o botão fica com quem usa a grade, não aqui dentro)
//
// A decisão que manda no componente: colar é a operação MAIS comum e a que mais
// frustra quando não funciona. Então o paste é tratado no nível da GRADE, não do
// input — colar 40 linhas com o cursor numa célula tem que criar 40 linhas, e
// não enfiar tudo num campo só.
//
// Não é AG Grid nem react-table de propósito: a grade tem no máximo algumas
// centenas de linhas e cinco colunas. Uma dependência nova custaria mais em
// bundle e em manutenção do que o teclado que ela resolveria.

import { useCallback, useEffect, useRef, useState } from "react";

export type ColunaGrade = {
  key: string;
  label: string;
  /** Largura em px. Sem isso as colunas dançam ao digitar. */
  w: number;
  tipo?: "texto" | "num" | "moeda" | "data";
  /** Só leitura: calculada a partir de outras (ex.: total = qtd × unitário). */
  calculada?: (linha: Record<string, string>) => string;
  alinhaDireita?: boolean;
};

export type LinhaGrade = Record<string, string> & { _id: string };

const novoId = () => `l${Math.random().toString(36).slice(2, 9)}`;

export const linhaVazia = (cols: ColunaGrade[]): LinhaGrade =>
  Object.fromEntries([["_id", novoId()], ...cols.map((c) => [c.key, ""])]) as LinhaGrade;

/** Número a partir do que o usuário digitou. Aceita "1.234,56" e "1234.56" —
 *  quem cola do Excel brasileiro traz vírgula, quem digita rápido traz ponto. */
export function num(v: string | undefined): number {
  if (!v) return 0;
  const limpo = String(v).replace(/[^\d,.-]/g, "");
  // Se tem vírgula E ponto, o último separador é o decimal.
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let normal = limpo;
  if (ultimaVirgula > -1 && ultimoPonto > -1) {
    normal = ultimaVirgula > ultimoPonto
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo.replace(/,/g, "");
  } else if (ultimaVirgula > -1) {
    normal = limpo.replace(",", ".");
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export default function GradeEditavel({
  cols, linhas, onChange, altura = 340, vazioMsg = "Digite, cole do Excel ou suba a planilha.",
}: {
  cols: ColunaGrade[];
  linhas: LinhaGrade[];
  onChange: (linhas: LinhaGrade[]) => void;
  altura?: number;
  vazioMsg?: string;
}) {
  /** Célula com foco, para navegação por teclado. */
  const [foco, setFoco] = useState<{ l: number; c: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const editaveis = cols.filter((c) => !c.calculada);

  const setCel = useCallback((li: number, key: string, valor: string) => {
    const novas = linhas.map((l, i) => (i === li ? { ...l, [key]: valor } : l));
    // Digitou na última linha? Cria a próxima. Planilha nunca "acaba" — ter que
    // clicar em "+ linha" a cada item quebra o ritmo de quem está digitando.
    if (li === linhas.length - 1 && valor.trim()) novas.push(linhaVazia(cols));
    onChange(novas);
  }, [linhas, cols, onChange]);

  /** Cola TSV/CSV a partir da célula focada, expandindo a grade.
   *
   *  Colar é onde a maioria das grades falha: ou joga o bloco inteiro numa
   *  célula, ou ignora as linhas que passam do que existe. Aqui o bloco é
   *  distribuído a partir da célula atual e a grade cresce conforme precisa. */
  const colar = useCallback((texto: string, li: number, ci: number) => {
    const grade = texto
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((l, i, arr) => l.trim() !== "" || i < arr.length - 1)
      .map((l) => (l.includes("\t") ? l.split("\t") : l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)));
    if (!grade.length) return;

    const novas = [...linhas];
    grade.forEach((cells, dl) => {
      const alvo = li + dl;
      while (novas.length <= alvo) novas.push(linhaVazia(cols));
      cells.forEach((valor, dc) => {
        const col = editaveis[ci + dc];
        if (!col) return;   // passou da última coluna: descarta em vez de embaralhar
        novas[alvo] = { ...novas[alvo], [col.key]: valor.trim().replace(/^"|"$/g, "") };
      });
    });
    // Sempre deixa uma linha em branco no fim, pra continuar digitando.
    if (Object.entries(novas[novas.length - 1]).some(([k, v]) => k !== "_id" && v)) {
      novas.push(linhaVazia(cols));
    }
    onChange(novas);
  }, [linhas, cols, editaveis, onChange]);

  /** Paste capturado no CONTÊINER: o navegador entrega o evento ao input, e
   *  tratar só lá faria o bloco inteiro cair numa célula. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      const texto = e.clipboardData?.getData("text/plain") ?? "";
      if (!texto.includes("\t") && !texto.includes("\n")) return;  // 1 valor: comportamento normal
      e.preventDefault();
      // Sem célula focada, cola no FIM — nunca na linha 1.
      //
      // O padrão antigo era (0,0): quem tinha 12 itens na lista, copiava mais
      // dois do Excel e colava sem clicar em nada perdia os dois primeiros
      // itens, sobrescritos em silêncio. Colar sem foco é "acrescentar isto
      // aqui", não "substituir o começo".
      const primeiraVazia = linhas.findIndex((l) =>
        cols.every((c) => c.calculada || !String(l[c.key] ?? "").trim()));
      const li = foco?.l ?? (primeiraVazia >= 0 ? primeiraVazia : linhas.length);
      colar(texto, li, foco?.c ?? 0);
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [colar, foco, linhas, cols]);

  const irPara = (l: number, c: number) => {
    const alvo = wrapRef.current?.querySelector<HTMLInputElement>(`[data-cel="${l}-${c}"]`);
    alvo?.focus();
    alvo?.select();
  };

  const tecla = (e: React.KeyboardEvent, l: number, c: number) => {
    const ultimaCol = editaveis.length - 1;
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey && c === ultimaCol)) {
      e.preventDefault();
      if (l + 1 >= linhas.length) onChange([...linhas, linhaVazia(cols)]);
      setTimeout(() => irPara(l + 1, e.key === "Enter" ? c : 0), 0);
    } else if (e.key === "ArrowDown" && l < linhas.length - 1) {
      e.preventDefault(); irPara(l + 1, c);
    } else if (e.key === "ArrowUp" && l > 0) {
      e.preventDefault(); irPara(l - 1, c);
    }
  };

  const removerLinha = (li: number) => {
    const novas = linhas.filter((_, i) => i !== li);
    onChange(novas.length ? novas : [linhaVazia(cols)]);
  };

  return (
    <div ref={wrapRef} className="border border-ww-border rounded-lg overflow-hidden">
      <div className="overflow-auto" style={{ maxHeight: altura }}>
        <table className="w-full text-[11.5px] border-collapse">
          <thead className="sticky top-0 z-10 bg-ww-panel">
            <tr>
              <th style={{ width: 34 }}
                  className="p-1.5 text-[10px] text-ww-textFaint shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">#</th>
              {cols.map((c) => (
                <th key={c.key} style={{ width: c.w, minWidth: c.w }}
                    className={`p-1.5 text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
                      c.alinhaDireita ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
              <th style={{ width: 30 }} className="shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, li) => (
              <tr key={linha._id} className="viz-row group">
                <td className="p-1 text-center text-[10px] text-ww-textFaint tabular-nums border-b border-ww-border/40">
                  {li + 1}
                </td>
                {cols.map((c) => {
                  if (c.calculada) {
                    return (
                      <td key={c.key}
                          className="p-1.5 text-right tabular-nums text-ww-textMuted border-b border-ww-border/40 bg-ww-rowHover/40">
                        {c.calculada(linha)}
                      </td>
                    );
                  }
                  const ci = editaveis.findIndex((x) => x.key === c.key);
                  return (
                    <td key={c.key} className="p-0 border-b border-ww-border/40">
                      <input
                        data-cel={`${li}-${ci}`}
                        value={linha[c.key] ?? ""}
                        onChange={(e) => setCel(li, c.key, e.target.value)}
                        onFocus={() => setFoco({ l: li, c: ci })}
                        onKeyDown={(e) => tecla(e, li, ci)}
                        type={c.tipo === "data" ? "date" : "text"}
                        inputMode={c.tipo === "num" || c.tipo === "moeda" ? "decimal" : undefined}
                        className={`w-full bg-transparent px-1.5 py-1.5 text-ww-text outline-none
                          focus:bg-ww-accentSoft focus:ring-1 focus:ring-ww-accent rounded-sm ${
                          c.alinhaDireita ? "text-right tabular-nums" : ""}`}
                      />
                    </td>
                  );
                })}
                <td className="p-0 border-b border-ww-border/40 text-center">
                  <button type="button" onClick={() => removerLinha(li)}
                    title="Remover linha"
                    className="opacity-0 group-hover:opacity-100 text-ww-textFaint hover:text-rose-500 transition px-1">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-2 py-1.5 border-t border-ww-border bg-ww-panel flex items-center gap-3">
        <button type="button" onClick={() => onChange([...linhas, linhaVazia(cols)])}
          className="text-[11px] text-ww-accent hover:underline font-semibold">
          + linha
        </button>
        <span className="text-[10.5px] text-ww-textFaint">
          {linhas.filter((l) => cols.some((c) => !c.calculada && l[c.key]?.trim())).length} preenchida(s)
          · Tab/Enter navega · <strong>Ctrl+V cola do Excel</strong> a partir da célula selecionada
        </span>
        {linhas.length <= 1 && (
          <span className="ml-auto text-[10.5px] text-ww-textFaint">{vazioMsg}</span>
        )}
      </div>
    </div>
  );
}
