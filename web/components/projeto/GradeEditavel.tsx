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

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lerColagem } from "@/lib/colar-grade";

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
  /** Fora do colar por POSIÇÃO: com cabeçalho no que se cola, entra pelo nome. */
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
  /** Conteúdo por cima da célula editável enquanto ela não está em edição (08/10/26:
   *  a sugestão do catálogo dentro da célula Código, com ✓ e ✕). Clicar fora dos
   *  botões dele entra na edição normal da célula. */
  sobrepor?: (linha: LinhaGrade) => React.ReactNode | null;
  /** Cabeçalho com conteúdo próprio (08/10/26: a coluna "Compatibilizar com o estoque" tem
   *  botões no cabeçalho). Sem isso vale `label`. */
  cab?: React.ReactNode;
  /** Fundo próprio da coluna (CSS), opaco — vale também para coluna presa (08/10/26: a coluna
   *  provisória âmbar "Compatibilizar com o estoque"). */
  fundo?: string;
  /** Texto de ajuda na célula vazia (ex.: "cole do Excel aqui (Ctrl+V)" na linha em branco). */
  placeholder?: (linha: LinhaGrade) => string | undefined;
};

/** Ação no passar do mouse na linha (ao lado do 🗑) — ex.: "inserir linha abaixo". */
export type AcaoLinha = { rot: string; dica: string; fn: () => void };

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
  selecao, aoColar, colarExtras = [], aoRemover, botaoLinha = true, grupo, herdarNoColar = [], corLinha,
  colsTodas, acoesLinha, escala = 1, ajustarLargura = false, cabecalhoNaPagina = false, linhaEmBranco,
}: {
  /** A linha conta como "em branco" para o colar? (padrão: todas as editáveis vazias). A lista de
   *  materiais diz "sem item e sem código" — a linha nova do grupo já nasce com grupo e data. */
  linhaEmBranco?: (l: LinhaGrade) => boolean;
  /** Todas as colunas, inclusive as ocultas pelo usuário (08/10/26): o colar POR POSIÇÃO segue
   *  a ordem completa (Código · Item · Qtd…) mesmo com colunas escondidas. Sem isso = `cols`. */
  colsTodas?: ColunaGrade[];
  /** Ações da linha no passar do mouse, ao lado do 🗑. */
  acoesLinha?: (l: LinhaGrade) => AcaoLinha[];
  /** Tamanho da letra (08/10/26): 1 = normal. Escala fonte e altura da linha juntas. */
  escala?: number;
  /** Encolhe as colunas (com reticências) para caber na largura da tela, sem rolagem lateral. */
  ajustarLargura?: boolean;
  /** Sem caixa de rolagem própria: a grade usa a altura da página e só o cabeçalho das colunas
   *  fica preso no topo (abaixo da barra do painel) ao rolar. */
  cabecalhoNaPagina?: boolean;
  /** Cor da borda esquerda da linha (08/10/26, spec B v3: a cor do grupo de equipamento). */
  corLinha?: (l: LinhaGrade) => string | null | undefined;
  /** Chaves que a linha colada sem valor herda da linha onde a colagem começou (ex.: equipamento). */
  herdarNoColar?: string[];
  /** Botão "+ linha" do rodapé. A lista de materiais não usa (08/10/26, spec B.2): a grade
   *  já cria a linha nova ao digitar/Enter na última. */
  botaoLinha?: boolean;
  /** Linhas de cabeçalho de grupo (08/10/26, spec B.3): antes de cada mudança de `de(linha)`
   *  entra uma linha larga com `cab(chave, linhas do grupo)`. `de` = null não abre grupo. */
  grupo?: { de: (l: LinhaGrade) => string | null; cab: (chave: string, linhas: LinhaGrade[]) => React.ReactNode;
    /** cor do grupo — borda esquerda do cabeçalho */ cor?: (chave: string) => string | null | undefined;
    /** linha no fim de cada grupo (08/10/26: "+ linha · + [3] linhas") */
    rodape?: (chave: string, linhas: LinhaGrade[]) => React.ReactNode };
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
    // Primeira linha é cabeçalho (2+ nomes de coluna)? Então cada coluna vai pelo NOME —
    // inclusive as que ficam fora do colar por posição. Sem cabeçalho, pela posição a
    // partir da célula focada (coluna `pularNoColar` focada começa na 1ª posicional).
    // Parser comum com o modal "Adicionar itens" (lib/colar-grade): datas dd/mm/aaaa viram ISO.
    // Colunas ocultas pelo usuário continuam no colar: a ordem por posição é a da grade inteira.
    const todasEd = (colsTodas ?? cols).filter((c) => !c.calculada && !c.render);
    const alvosNome = [...todasEd, ...colarExtras.map((x) => ({ ...x, tipo: todasEd.find((e) => e.key === x.key)?.tipo }))];
    const posicionais = todasEd.filter((e) => !e.pularNoColar);
    const vaziaEm = (l: LinhaGrade | undefined) => !l || (linhaEmBranco ? linhaEmBranco(l) : cols.every((c) => c.calculada || c.render || !String(l[c.key] ?? "").trim()));
    const inserir = vaziaEm(linhas[li]);
    let ini = Math.max(0, posicionais.findIndex((e) => e.key === editaveis[ci]?.key));
    // Linha em branco + bloco mais largo do que cabe a partir da célula: são linhas inteiras do
    // Excel (Código · Item · Qtd…) — começa na 1ª coluna, não onde o cursor está.
    const largura = Math.max(...texto.replace(/\r/g, "").split("\n").filter((x) => x.trim()).map((x) => x.split(x.includes("\t") ? "\t" : ";").length), 0);
    if (inserir && largura > posicionais.length - ini) ini = 0;
    const { linhas: lidas } = lerColagem(texto, alvosNome, posicionais, ini);
    if (!lidas.length) return;
    // Colunas herdadas (ex.: o grupo de equipamento): a linha colada sem valor recebe o da
    // linha onde a colagem começou, senão o da linha de cima.
    const ancora = (k: string) => String(linhas[li]?.[k] ?? "").trim() || String(linhas[li - 1]?.[k] ?? "").trim();
    const herda: Record<string, string> = Object.fromEntries(herdarNoColar.map((k) => [k, ancora(k)]).filter(([, v]) => v));

    const novas = [...linhas];
    /* Colou numa linha EM BRANCO (08/10/26): as linhas coladas entram ali e logo abaixo, como
       linhas NOVAS — nada do que vem depois (outro grupo, linhas preenchidas) é sobrescrito.
       Colar em cima de linhas preenchidas segue como planilha: sobrescreve a partir dali. */
    lidas.forEach((vals, dl) => {
      const alvo = li + dl;
      if (inserir && dl > 0 && alvo < novas.length) novas.splice(alvo, 0, linhaVazia(cols));
      while (novas.length <= alvo) novas.push(linhaVazia(cols));
      const base = novas[alvo];
      const extra: Record<string, string> = Object.fromEntries(Object.entries(herda).filter(([k]) => !String(base[k] ?? "").trim() && !vals[k]));
      novas[alvo] = { ...base, ...extra, ...vals };
    });
    // Sempre deixa uma linha em branco no fim, pra continuar digitando.
    if (Object.entries(novas[novas.length - 1]).some(([k, v]) => k !== "_id" && v)) {
      novas.push(linhaVazia(cols));
    }
    onChange(novas);
    aoColar?.();
  }, [linhas, cols, colsTodas, editaveis, onChange, aoColar, colarExtras, herdarNoColar, linhaEmBranco]);

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
      const primeiraVazia = linhas.findIndex((l) => (linhaEmBranco ? linhaEmBranco(l)
        : cols.every((c) => c.calculada || c.render || !String(l[c.key] ?? "").trim())));
      const li = foco?.l ?? (primeiraVazia >= 0 ? primeiraVazia : linhas.length);
      colar(texto, li, foco?.c ?? 0);
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [colar, foco, linhas, cols, linhaEmBranco]);

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
  const W_SEL = 28, W_NUM = 28, W_FIM = acoesLinha ? 44 : 24;
  /* Caber na largura (08/10/26): as colunas encolhem na mesma proporção (até 50%) para a grade
     caber sem rolagem lateral; o texto que não cabe ganha reticências e a dica mostra inteiro.
     A escala (A− / A / A+) usa `zoom`: fonte, altura da linha e larguras crescem juntas. */
  const [larguraDisp, setLarguraDisp] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !ajustarLargura) return;
    const ro = new ResizeObserver(() => setLarguraDisp(el.clientWidth));
    ro.observe(el);
    setLarguraDisp(el.clientWidth);
    return () => ro.disconnect();
  }, [ajustarLargura]);
  const z = escala > 0 ? escala : 1;
  const fixoW = (selecao ? W_SEL : 0) + W_NUM + W_FIM;
  const somaCols = cols.reduce((a, c) => a + c.w, 0);
  const caber = ajustarLargura && larguraDisp > 0 ? (larguraDisp / z - fixoW - 2 - cols.length * 2) / somaCols : 1;
  const fator = Math.max(0.5, Math.min(1, caber));
  const wc = (c: ColunaGrade) => Math.max(16, Math.floor(c.w * fator));
  const esq = new Map<string, number>();
  {
    let x = (selecao ? W_SEL : 0) + W_NUM;
    for (const c of cols) { if (!c.fixa) break; esq.set(c.key, x); x += wc(c); }
  }
  const ultimaFixa = [...esq.keys()].pop();
  const larguraTotal = Math.max(fixoW + cols.reduce((a, c) => a + wc(c), 0), ajustarLargura && larguraDisp ? Math.floor(larguraDisp / z) - 2 : 0);

  /* Cabeçalho preso na PÁGINA (08/10/26): sem caixa de rolagem vertical, o thead desliza com
     transform para ficar logo abaixo da barra do painel (.ab, sticky) enquanto a grade passa. */
  const tabelaRef = useRef<HTMLTableElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    if (!cabecalhoNaPagina) return;
    let raf = 0;
    const ajustar = () => {
      raf = 0;
      const t = tabelaRef.current, h = theadRef.current;
      if (!t || !h) return;
      const barra = document.querySelector(".ab") as HTMLElement | null;
      const topo = barra && getComputedStyle(barra).position !== "static" ? Math.max(0, barra.getBoundingClientRect().bottom) : 0;
      const r = t.getBoundingClientRect();
      const hh = h.getBoundingClientRect().height;
      const desl = Math.max(0, Math.min(topo - r.top, r.height - hh * 2));
      h.style.transform = desl > 0 ? `translateY(${desl / z}px)` : "";
      h.classList.toggle("shadow-[0_2px_6px_rgba(0,0,0,0.12)]", desl > 0);
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(ajustar); };
    ajustar();
    window.addEventListener("scroll", pedir, true);
    window.addEventListener("resize", pedir);
    return () => { window.removeEventListener("scroll", pedir, true); window.removeEventListener("resize", pedir); if (raf) cancelAnimationFrame(raf); };
  }, [cabecalhoNaPagina, z, linhas.length]);
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
          role="listbox"
          // Opaco também no modo vidro (08/10/26): a lista ficava transparente sobre a grade.
          className="overflow-auto rounded-lg border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl text-[11.5px]"
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
      <div className="overflow-auto" style={cabecalhoNaPagina ? { overflowY: "hidden" } : { maxHeight: altura }}>
        <table ref={tabelaRef} className="text-[11.5px] border-collapse" data-escala={z}
          style={{ tableLayout: "fixed", width: larguraTotal, ...(ajustarLargura ? {} : { minWidth: "100%" }), ...(z !== 1 ? { zoom: z } : {}) }}>
          <thead ref={theadRef} className={`${cabecalhoNaPagina ? "relative z-20" : "sticky top-0 z-10"} bg-ww-panel`}>
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
                <th key={c.key} title={c.dicaCab} data-colkey={c.key} style={{ width: wc(c), minWidth: wc(c), ...(esq.has(c.key) ? fixo(esq.get(c.key)!, 21) : {}), ...(c.fundo ? { background: c.fundo } : {}) }}
                    className={`p-1.5 text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted whitespace-nowrap overflow-hidden text-ellipsis shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
                      c.alinhaDireita ? "text-right" : "text-left"} ${OPACO} ${(c.classe ?? "").replace(/(^|\s)bg-\S+/g, " ")}`}>
                  {c.cab ?? c.label}
                </th>
              ))}
              <th style={{ width: W_FIM }} className={`shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${OPACO}`} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, li) => {
              const gk = grupo ? grupo.de(linha) : null;
              const abreGrupo = gk != null && (li === 0 || grupo!.de(linhas[li - 1]) !== gk);
              const fechaGrupo = gk != null && !!grupo?.rodape && (li === linhas.length - 1 || grupo.de(linhas[li + 1]) !== gk);
              const acoes = acoesLinha?.(linha) ?? [];
              return (<Fragment key={linha._k || linha._id}>
              {abreGrupo && (
                <tr className="viz-grp">
                  <td colSpan={(selecao ? 1 : 0) + 1 + cols.length + 1} className="p-0 border-b border-ww-border/60 bg-ww-rowHover/70"
                    style={grupo!.cor?.(gk!) ? { boxShadow: `inset 3px 0 0 0 ${grupo!.cor(gk!)}` } : undefined}>
                    <div style={{ position: "sticky", left: 0 }} className="inline-flex items-center gap-2 px-2 py-1 text-[11.5px]">
                      {grupo!.cab(gk!, linhas.filter((x) => grupo!.de(x) === gk))}
                    </div>
                  </td>
                </tr>)}
              <tr className="viz-row group">
                {selecao && (
                  <td style={{ ...(esq.size ? fixo(0, 5) : {}), ...(corLinha?.(linha) ? { boxShadow: `inset 3px 0 0 0 ${corLinha(linha)}` } : {}) }} className={`p-1 text-center border-b border-ww-border/40 ${esq.size ? OPACO : ""}`}>
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
                      <td key={c.key} title={c.dica?.(linha)} style={{ ...(esq.has(c.key) ? fixo(esq.get(c.key)!, 5) : {}), ...(c.fundo ? { background: c.fundo } : {}) }}
                          className={`p-1.5 border-b border-ww-border/40 whitespace-nowrap overflow-hidden text-ellipsis ${
                            c.fundo ? sombra(c.key) : esq.has(c.key) ? `${OPACO} ${sombra(c.key)}` : "bg-ww-rowHover/40"} ${
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
                  const sob = !emEdicao && c.sobrepor ? c.sobrepor(linha) : null;
                  return (
                    <td key={c.key} style={fx ? fixo(esq.get(c.key)!, 5) : undefined}
                        className={`p-0 border-b border-ww-border/40 relative ${fx ? `${OPACO} ${sombra(c.key)}` : ""} ${mk?.classe ?? ""} ${c.classe ?? ""}`}
                        title={[mk?.dica, c.dica?.(linha)].filter(Boolean).join(" · ") || undefined}>
                      {sob && (
                        <div className={`absolute inset-0 z-[1] flex items-center px-0.5 ${fx ? OPACO : "bg-[rgb(var(--color-ww-panel))]"}`}
                          onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; const inp = (e.currentTarget.parentElement?.querySelector("input")) as HTMLInputElement | null; inp?.focus(); }}>
                          {sob}
                        </div>
                      )}
                      {mk?.etiqueta && !sob && (
                        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] leading-none text-ww-textFaint">{mk.etiqueta}</span>
                      )}
                      {ac2 && (
                        <button type="button" tabIndex={-1} title={typeof ac2.dica === "function" ? ac2.dica(linha) : ac2.dica} onClick={() => ac2.fn(linha)}
                          className={`absolute right-0.5 top-1/2 -translate-y-1/2 px-1 text-[11px] hover:text-ww-accent ${ac2.classe?.(linha) ?? "text-ww-textFaint"}`}>
                          {typeof ac2.rot === "function" ? ac2.rot(linha) : txt(ac2.rot)}
                        </button>
                      )}
                      <input
                        data-cel={`${li}-${ci}`} data-lid={linha._id} data-col={c.key}
                        placeholder={c.placeholder?.(linha)}
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
                        className={`w-full bg-transparent px-1.5 py-1.5 text-ww-text outline-none text-ellipsis placeholder:text-ww-textFaint placeholder:italic placeholder:text-[10.5px]
                          focus:bg-ww-accentSoft focus:ring-1 focus:ring-ww-accent rounded-sm ${
                          c.alinhaDireita ? "text-right tabular-nums" : ""} ${ac2 ? "pr-5" : ""}`}
                      />
                    </td>
                  );
                })}
                <td className="p-0 border-b border-ww-border/40 text-center whitespace-nowrap">
                  {acoes.map((a) => (
                    <button key={a.rot} type="button" onClick={a.fn} title={a.dica} data-acao-linha={a.rot}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ww-textFaint hover:text-ww-accent transition px-0.5 text-[12px] font-semibold">
                      {a.rot}
                    </button>))}
                  <button type="button" onClick={() => removerLinha(li)}
                    title="Excluir linha"
                    className="opacity-0 group-hover:opacity-100 text-ww-textFaint hover:text-rose-500 transition px-1 text-[12px]">
                    🗑
                  </button>
                </td>
              </tr>
              {fechaGrupo && (
                <tr className="viz-grp-fim" data-grupo-fim={gk!}>
                  <td colSpan={(selecao ? 1 : 0) + 1 + cols.length + 1} className="p-0 border-b border-ww-border/60"
                    style={grupo!.cor?.(gk!) ? { boxShadow: `inset 3px 0 0 0 ${grupo!.cor(gk!)}` } : undefined}>
                    <div style={{ position: "sticky", left: 0 }} className="inline-flex items-center gap-2 px-2 py-0.5 text-[11px]">
                      {grupo!.rodape!(gk!, linhas.filter((x) => grupo!.de(x) === gk))}
                    </div>
                  </td>
                </tr>)}
              </Fragment>);
            })}
          </tbody>
        </table>
      </div>
      <div className="px-2 py-1.5 border-t border-ww-border bg-ww-panel flex items-center gap-3">
        {botaoLinha && <button type="button" onClick={() => onChange([...linhas, linhaVazia(cols)])}
          className="text-[11px] text-ww-accent hover:underline font-semibold">
          + linha
        </button>}
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
