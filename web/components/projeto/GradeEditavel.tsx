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
import { createPortal } from "react-dom";

/** Uma sugestão do autocompletar. `dados` volta intacto para aoEscolher. */
export type SugestaoGrade = {
  chave: string; titulo: string; detalhe?: string; direita?: string; dados: unknown;
};

export type ColunaGrade = {
  key: string;
  label: string;
  /** Largura em px. Sem isso as colunas dançam ao digitar. */
  w: number;
  tipo?: "texto" | "num" | "moeda" | "data";
  /** Só leitura: calculada a partir de outras (ex.: total = qtd × unitário). */
  calculada?: (linha: Record<string, string>) => string;
  /** Só leitura, com marcação própria — para status em pílula, link, badge.
   *  Vence `calculada`. Existe porque um status vindo do ERP perde sentido
   *  virando texto puro: "31d atraso" e "Conferido" precisam se distinguir de
   *  relance, não depois de ler. */
  render?: (linha: Record<string, string>) => React.ReactNode;
  alinhaDireita?: boolean;
  /** Autocompletar enquanto se digita: setas navegam, Enter escolhe, Esc fecha.
   *  `iniciais` mostra sugestões já prontas ao entrar na célula (ex.: as
   *  alternativas de um casamento duvidoso). */
  autocompletar?: {
    buscar: (texto: string) => Promise<SugestaoGrade[]>;
    aoEscolher: (s: SugestaoGrade, linha: LinhaGrade) => Record<string, string>;
    iniciais?: (linha: LinhaGrade) => SugestaoGrade[];
  };
  /** Chaves da linha zeradas quando o usuário digita nesta coluna (ex.: o
   *  vínculo com o catálogo deixa de valer se o texto do item mudou). */
  limpaAoEditar?: string[];
  /** Marca na célula editável (07/10/26): data própria fora da data do grupo,
   *  valor que veio do PC… `etiqueta` aparece pequena no canto da célula. */
  marca?: (linha: LinhaGrade) => { classe?: string; dica?: string; etiqueta?: string } | null;
  /** Classe extra da coluna inteira (cabeçalho e células) — para agrupar à vista
   *  as colunas de leitura que vêm do mesmo lugar (ex.: o bloco do PC). */
  classe?: string;
  /** Fora do colar por POSIÇÃO (07/10/26): coluna nova no meio não pode deslocar
   *  o "Equipamento · Item · Qtd…" de sempre. Com cabeçalho no que se cola, entra. */
  pularNoColar?: boolean;
  /** Botãozinho dentro da célula editável (ex.: abrir o seletor do catálogo). */
  acao?: { rot: string | ((linha: LinhaGrade) => string); dica: string | ((linha: LinhaGrade) => string); fn: (linha: LinhaGrade) => void;
           mostrar?: (linha: LinhaGrade) => boolean; classe?: (linha: LinhaGrade) => string };
  /** Coluna presa à esquerda ao rolar para o lado (07/10/26). Só as primeiras. */
  fixa?: boolean;
  /** Texto mostrado quando a célula NÃO está em edição (ex.: a descrição do item
   *  do catálogo no lugar do texto digitado). Ao focar, volta o valor real. */
  exibir?: (linha: LinhaGrade) => string | null | undefined;
  /** Dica (title) da célula. */
  dica?: (linha: LinhaGrade) => string | undefined;
  /** Dica do cabeçalho (o que a coluna significa). */
  dicaCab?: string;
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
  selecao, aoColar, colarExtras = [], aoRemover,
}: {
  /** Quem usa decide como remover (ex.: lista de materiais com "Desfazer"). Sem isso, tira da grade. */
  aoRemover?: (id: string) => void;
  /** Colunas que não aparecem na grade mas entram no colar COM cabeçalho (ex.: Modelo, PC). */
  colarExtras?: { label: string; key: string }[];
  /** Chamado depois de um paste que trouxe linhas (ex.: casar com o catálogo). */
  aoColar?: () => void;
  cols: ColunaGrade[];
  linhas: LinhaGrade[];
  onChange: (linhas: LinhaGrade[]) => void;
  altura?: number;
  vazioMsg?: string;
  /** Ativa a coluna de caixinhas. Só faz sentido em linha que já existe no
   *  banco — marcar uma linha em branco pra vincular a um PC não significaria
   *  nada, então `podeMarcar` decide quais aceitam marca. */
  selecao?: {
    marcadas: Set<string>;
    podeMarcar: (linha: LinhaGrade) => boolean;
    onAlternar: (id: string, indice: number, comShift: boolean) => void;
    onTodas: (marcar: boolean) => void;
  };
}) {
  /** Célula com foco, para navegação por teclado. */
  const [foco, setFoco] = useState<{ l: number; c: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const editaveis = cols.filter((c) => !c.calculada && !c.render);

  const setCel = useCallback((li: number, key: string, valor: string) => {
    const limpa = cols.find((c) => c.key === key)?.limpaAoEditar ?? [];
    const novas = linhas.map((l, i) => (i === li
      ? { ...l, ...Object.fromEntries(limpa.map((k) => [k, ""])), [key]: valor } : l));
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

    // Primeira linha é cabeçalho (2+ nomes de coluna)? Então cada coluna vai pelo
    // NOME — inclusive as que ficam fora do colar por posição.
    const nrm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const alvosNome: { label: string; key: string }[] = [...editaveis, ...colarExtras];
    const porNome = grade[0].map((c) => alvosNome.find((e) => nrm(e.label) === nrm(c) || nrm(e.key) === nrm(c)));
    const comCabecalho = porNome.filter(Boolean).length >= 2;
    const corpo = comCabecalho ? grade.slice(1) : grade;
    const posicionais = editaveis.filter((e, i) => !e.pularNoColar || i === ci);
    const ini = Math.max(0, posicionais.indexOf(editaveis[ci]));

    const novas = [...linhas];
    corpo.forEach((cells, dl) => {
      const alvo = li + dl;
      while (novas.length <= alvo) novas.push(linhaVazia(cols));
      cells.forEach((valor, dc) => {
        const col = comCabecalho ? porNome[dc] : posicionais[ini + dc];
        if (!col) return;   // passou da última coluna: descarta em vez de embaralhar
        novas[alvo] = { ...novas[alvo], [col.key]: valor.trim().replace(/^"|"$/g, "") };
      });
    });
    // Sempre deixa uma linha em branco no fim, pra continuar digitando.
    if (Object.entries(novas[novas.length - 1]).some(([k, v]) => k !== "_id" && v)) {
      novas.push(linhaVazia(cols));
    }
    onChange(novas);
    aoColar?.();
  }, [linhas, cols, editaveis, onChange, aoColar, colarExtras]);

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
        cols.every((c) => c.calculada || c.render || !String(l[c.key] ?? "").trim()));
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

  // ── Autocompletar ────────────────────────────────────────────────────────
  const [ac, setAc] = useState<{
    li: number; key: string; itens: SugestaoGrade[]; ativo: number; el: HTMLElement;
  } | null>(null);
  // A posição é medida a cada render (e a cada rolagem): a grade muda de
  // altura enquanto se digita, e uma posição guardada deixava o menu fora da tela.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ac) return;
    const f = () => setTick((t) => t + 1);
    window.addEventListener("scroll", f, true);
    window.addEventListener("resize", f);
    return () => { window.removeEventListener("scroll", f, true); window.removeEventListener("resize", f); };
  }, [ac]);
  const buscaSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abrirAc = (li: number, key: string, itens: SugestaoGrade[], el: HTMLElement) => {
    if (!itens.length) { setAc(null); return; }
    setAc({ li, key, itens, ativo: 0, el });
  };
  const buscarAc = (li: number, col: ColunaGrade, texto: string, el: HTMLElement) => {
    if (!col.autocompletar) return;
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 2) { setAc(null); return; }
    const seq = ++buscaSeq.current;
    timer.current = setTimeout(async () => {
      try {
        const itens = await col.autocompletar!.buscar(texto.trim());
        if (seq === buscaSeq.current) abrirAc(li, col.key, itens, el);
      } catch { /* sem sugestão, segue digitando */ }
    }, 220);
  };
  const escolherAc = (s: SugestaoGrade) => {
    if (!ac) return;
    const col = cols.find((c) => c.key === ac.key);
    if (!col?.autocompletar) return;
    const alvo = linhas[ac.li];
    const patch = col.autocompletar.aoEscolher(s, alvo);
    const novas = linhas.map((l, i) => (i === ac.li ? { ...l, ...patch } : l));
    if (ac.li === linhas.length - 1) novas.push(linhaVazia(cols));
    onChange(novas);
    setAc(null);
  };

  const tecla = (e: React.KeyboardEvent, l: number, c: number) => {
    if (ac && ac.li === l && ac.key === editaveis[c]?.key) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAc({ ...ac, ativo: Math.min(ac.ativo + 1, ac.itens.length - 1) }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAc({ ...ac, ativo: Math.max(ac.ativo - 1, 0) }); return; }
      if (e.key === "Enter") { e.preventDefault(); escolherAc(ac.itens[ac.ativo]); setTimeout(() => irPara(l, c + 1), 0); return; }
      if (e.key === "Escape") { e.preventDefault(); setAc(null); return; }
      if (e.key === "Tab") setAc(null);
    }
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

  // Colunas presas à esquerda: caixinha, # e as `fixa` iniciais, com fundo opaco.
  const W_SEL = 28, W_NUM = 28;
  const esq = new Map<string, number>();
  {
    let x = (selecao ? W_SEL : 0) + W_NUM;
    for (const c of cols) { if (!c.fixa) break; esq.set(c.key, x); x += c.w; }
  }
  const ultimaFixa = [...esq.keys()].pop();
  const larguraTotal = (selecao ? W_SEL : 0) + W_NUM + 24 + cols.reduce((a, c) => a + c.w, 0);
  const OPACO = "bg-[rgb(var(--color-ww-panel))]";
  const fixo = (left: number, z: number) => ({ position: "sticky" as const, left, zIndex: z });
  const sombra = (k: string) => (k === ultimaFixa ? "shadow-[2px_0_0_0_rgb(var(--color-ww-border))]" : "");
  const txt = (v: unknown) => (typeof v === "function" ? undefined : (v as string));

  const removerLinha = (li: number) => {
    if (aoRemover) { aoRemover(linhas[li]._id); return; }
    const novas = linhas.filter((_, i) => i !== li);
    onChange(novas.length ? novas : [linhaVazia(cols)]);
  };

  return (
    <div ref={wrapRef} className="border border-ww-border rounded-lg overflow-hidden">
      {ac && typeof document !== "undefined" && createPortal(
        <div
          style={(() => {
            const r = ac.el.getBoundingClientRect();
            const embaixo = window.innerHeight - r.bottom;
            const largura = Math.min(Math.max(r.width, 560), window.innerWidth - 16);
            const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
            // Sem espaço embaixo, abre para cima da célula.
            return embaixo < 240 && r.top > embaixo
              ? { position: "fixed" as const, left, bottom: window.innerHeight - r.top + 2, width: largura, zIndex: 300, maxHeight: Math.min(320, r.top - 8) }
              : { position: "fixed" as const, left, top: r.bottom + 2, width: largura, zIndex: 300, maxHeight: Math.min(320, embaixo - 8) };
          })()}
          className="overflow-auto rounded-lg border border-ww-border bg-ww-panel shadow-2xl text-[11.5px]"
          onMouseDown={(e) => e.preventDefault()}>
          {ac.itens.map((s, i) => (
            <button key={s.chave} type="button" onClick={() => escolherAc(s)}
              onMouseEnter={() => setAc({ ...ac, ativo: i })}
              className={`w-full text-left px-2.5 py-1.5 flex items-start gap-2 border-b border-ww-border/40 last:border-0 ${
                i === ac.ativo ? "bg-ww-accentSoft" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="block text-ww-text truncate">{s.titulo}</span>
                {s.detalhe && <span className="block text-[10.5px] text-ww-textMuted truncate">{s.detalhe}</span>}
              </span>
              {s.direita && <span className="shrink-0 tabular-nums text-ww-text font-semibold">{s.direita}</span>}
            </button>
          ))}
          <div className="px-2.5 py-1 text-[10px] text-ww-textFaint">↑↓ escolhe · Enter aplica · Esc fecha</div>
        </div>,
        document.body)}
      <div className="overflow-auto" style={{ maxHeight: altura }}>
        <table className="text-[11.5px] border-collapse" style={{ tableLayout: "fixed", width: larguraTotal, minWidth: "100%" }}>
          <thead className="sticky top-0 z-10 bg-ww-panel">
            <tr>
              {selecao && (
                <th style={{ width: W_SEL, ...(esq.size ? fixo(0, 21) : {}) }}
                    className={`p-1.5 shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${OPACO}`}>
                  <input type="checkbox" aria-label="Marcar todas"
                    checked={linhas.filter(selecao.podeMarcar).length > 0
                             && linhas.filter(selecao.podeMarcar).every((l) => selecao.marcadas.has(l._id))}
                    onChange={(e) => selecao.onTodas(e.target.checked)}
                    className="cursor-pointer" />
                </th>
              )}
              <th style={{ width: W_NUM, ...(esq.size ? fixo(selecao ? W_SEL : 0, 21) : {}) }}
                  className={`p-1.5 text-[10px] text-ww-textFaint shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${OPACO}`}>#</th>
              {cols.map((c) => (
                <th key={c.key} title={c.dicaCab} style={{ width: c.w, minWidth: c.w, ...(esq.has(c.key) ? fixo(esq.get(c.key)!, 21) : {}) }}
                    className={`p-1.5 text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted whitespace-nowrap overflow-hidden text-ellipsis shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
                      c.alinhaDireita ? "text-right" : "text-left"} ${OPACO} ${(c.classe ?? "").replace(/(^|\s)bg-\S+/g, " ")}`}>
                  {c.label}
                </th>
              ))}
              <th style={{ width: 24 }} className={`shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${OPACO}`} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, li) => (
              <tr key={linha._id} className="viz-row group">
                {selecao && (
                  <td style={esq.size ? fixo(0, 5) : undefined} className={`p-1 text-center border-b border-ww-border/40 ${esq.size ? OPACO : ""}`}>
                    {selecao.podeMarcar(linha) && (
                      <input type="checkbox" checked={selecao.marcadas.has(linha._id)}
                        onChange={() => { /* controlado no onClick, pra ler o shift */ }}
                        onClick={(e) => selecao.onAlternar(linha._id, li, e.shiftKey)}
                        className="cursor-pointer" />
                    )}
                  </td>
                )}
                <td style={esq.size ? fixo(selecao ? W_SEL : 0, 5) : undefined}
                    className={`p-1 text-center text-[10px] text-ww-textFaint tabular-nums border-b border-ww-border/40 ${esq.size ? OPACO : ""}`}>
                  {li + 1}
                </td>
                {cols.map((c) => {
                  if (c.render) {
                    return (
                      <td key={c.key} title={c.dica?.(linha)} style={esq.has(c.key) ? fixo(esq.get(c.key)!, 5) : undefined}
                          className={`p-1.5 border-b border-ww-border/40 whitespace-nowrap overflow-hidden text-ellipsis ${
                            esq.has(c.key) ? `${OPACO} ${sombra(c.key)}` : "bg-ww-rowHover/40"} ${
                            c.alinhaDireita ? "text-right tabular-nums" : ""} ${c.classe ?? ""}`}>
                        {c.render(linha)}
                      </td>
                    );
                  }
                  if (c.calculada) {
                    return (
                      <td key={c.key} title={c.dica?.(linha)}
                          className={`p-1.5 text-right tabular-nums text-ww-textMuted border-b border-ww-border/40 bg-ww-rowHover/40 whitespace-nowrap overflow-hidden ${c.classe ?? ""}`}>
                        {c.calculada(linha)}
                      </td>
                    );
                  }
                  const ci = editaveis.findIndex((x) => x.key === c.key);
                  const mk = c.marca?.(linha) ?? null;
                  const emEdicao = foco?.l === li && foco?.c === ci;
                  const mostrado = !emEdicao && c.exibir ? (c.exibir(linha) ?? linha[c.key] ?? "") : (linha[c.key] ?? "");
                  const ac2 = c.acao && (c.acao.mostrar?.(linha) ?? true) ? c.acao : null;
                  const fx = esq.has(c.key);
                  return (
                    <td key={c.key} style={fx ? fixo(esq.get(c.key)!, 5) : undefined}
                        className={`p-0 border-b border-ww-border/40 relative ${fx ? `${OPACO} ${sombra(c.key)}` : ""} ${mk?.classe ?? ""} ${c.classe ?? ""}`}
                        title={[mk?.dica, c.dica?.(linha)].filter(Boolean).join(" · ") || undefined}>
                      {mk?.etiqueta && (
                        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] leading-none text-ww-textFaint">{mk.etiqueta}</span>
                      )}
                      {ac2 && (
                        <button type="button" tabIndex={-1} title={typeof ac2.dica === "function" ? ac2.dica(linha) : ac2.dica} onClick={() => ac2.fn(linha)}
                          className={`absolute right-0.5 top-1/2 -translate-y-1/2 px-1 text-[11px] hover:text-ww-accent ${ac2.classe?.(linha) ?? "text-ww-textFaint"}`}>
                          {typeof ac2.rot === "function" ? ac2.rot(linha) : txt(ac2.rot)}
                        </button>
                      )}
                      <input
                        data-cel={`${li}-${ci}`}
                        value={mostrado}
                        onChange={(e) => { setCel(li, c.key, e.target.value); buscarAc(li, c, e.target.value, e.currentTarget); }}
                        onFocus={(e) => {
                          setFoco({ l: li, c: ci });
                          const ini = c.autocompletar?.iniciais?.(linha) ?? [];
                          if (ini.length) abrirAc(li, c.key, ini, e.currentTarget);
                        }}
                        onBlur={() => {
                          setTimeout(() => setAc((a) => (a && a.li === li && a.key === c.key ? null : a)), 180);
                          // célula com `exibir` volta a mostrar o texto de exibição ao sair
                          if (c.exibir) setTimeout(() => setFoco((f) => (f && f.l === li && f.c === ci && document.activeElement?.getAttribute("data-cel") !== `${li}-${ci}` ? null : f)), 200);
                        }}
                        onKeyDown={(e) => tecla(e, li, ci)}
                        type={c.tipo === "data" ? "date" : "text"}
                        inputMode={c.tipo === "num" || c.tipo === "moeda" ? "decimal" : undefined}
                        className={`w-full bg-transparent px-1.5 py-1.5 text-ww-text outline-none text-ellipsis
                          focus:bg-ww-accentSoft focus:ring-1 focus:ring-ww-accent rounded-sm ${
                          c.alinhaDireita ? "text-right tabular-nums" : ""} ${ac2 ? "pr-5" : ""}`}
                      />
                    </td>
                  );
                })}
                <td className="p-0 border-b border-ww-border/40 text-center">
                  <button type="button" onClick={() => removerLinha(li)}
                    title="Excluir linha"
                    className="opacity-0 group-hover:opacity-100 text-ww-textFaint hover:text-rose-500 transition px-1 text-[12px]">
                    🗑
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
          {linhas.filter((l) => cols.some((c) => !c.calculada && !c.render && l[c.key]?.trim())).length} preenchida(s)
          · Tab/Enter navega · <strong>Ctrl+V cola do Excel</strong> a partir da célula selecionada
        </span>
        {linhas.length <= 1 && (
          <span className="ml-auto text-[10.5px] text-ww-textFaint">{vazioMsg}</span>
        )}
      </div>
    </div>
  );
}
