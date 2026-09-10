"use client";

// Painel de altura ajustável pelo usuário.
//
// ── O problema ───────────────────────────────────────────────────────────────
// A altura de um gráfico é escolhida por quem escreve o código, uma vez, sem
// saber quantas linhas o dado vai ter naquele dia. Um ranking de 3 fornecedores
// e um de 25 recebem a mesma moldura: o primeiro sobra vazio, o segundo rola
// dentro de uma janela pequena. Nenhum valor fixo acerta os dois.
//
// ── A escolha ────────────────────────────────────────────────────────────────
// Ajustar ALTURA, não largura. Cada painel ocupa a largura toda e eles ficam
// empilhados, então esticar um empurra os de baixo e encolher puxa de volta —
// que é o comportamento pedido. Redimensionar largura exigiria um grid livre e
// traria o problema clássico do dashboard arrastável: layout que quebra sozinho
// e nunca mais volta ao estado original.
//
// A altura persiste em localStorage por `id`. Sem isso o ajuste se perde no
// próximo F5 e o recurso vira enfeite.
//
// Acessível pelo teclado: a alça é focável e responde a ↑/↓ (e Home pra voltar
// ao padrão). Arrastar com o mouse não pode ser o único caminho.

import { useCallback, useEffect, useRef, useState } from "react";

const CHAVE = (id: string) => `ww:painel-altura:${id}`;

export default function PainelRedim({
  id, padrao, min = 160, max = 900, children,
}: {
  /** Identidade estável do painel — é a chave da preferência salva. Mudar isto
   *  zera o ajuste do usuário, então não derive de título traduzível. */
  id: string;
  padrao: number;
  min?: number;
  max?: number;
  /** Recebe a altura corrente pra repassar ao gráfico/tabela. */
  children: (altura: number) => React.ReactNode;
}) {
  const [altura, setAltura] = useState(padrao);
  const [arrastando, setArrastando] = useState(false);
  /** Só depois de ler o localStorage é que a altura salva vale. Ler direto no
   *  useState quebraria a hidratação: o servidor não tem localStorage e o HTML
   *  sairia com uma altura diferente da do cliente. */
  const [pronto, setPronto] = useState(false);
  const inicio = useRef({ y: 0, h: 0 });

  useEffect(() => {
    const salvo = Number(localStorage.getItem(CHAVE(id)));
    if (salvo >= min && salvo <= max) setAltura(salvo);
    setPronto(true);
  }, [id, min, max]);

  const grava = useCallback((h: number) => {
    setAltura(h);
    if (pronto) localStorage.setItem(CHAVE(id), String(h));
  }, [id, pronto]);

  const limita = useCallback(
    (h: number) => Math.min(max, Math.max(min, Math.round(h))), [min, max]);

  const aoPuxar = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    inicio.current = { y: e.clientY, h: altura };
    setArrastando(true);
  };
  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastando) return;
    setAltura(limita(inicio.current.h + (e.clientY - inicio.current.y)));
  };
  const aoSoltar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arrastando) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setArrastando(false);
    grava(altura);
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 60 : 20;
    if (e.key === "ArrowDown") { e.preventDefault(); grava(limita(altura + passo)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); grava(limita(altura - passo)); }
    else if (e.key === "Home") { e.preventDefault(); grava(padrao); }
  };

  const ajustado = altura !== padrao;

  return (
    <div className="relative group/painel">
      {children(altura)}

      {/* Alça: faixa fina colada na base do painel. Fica quase invisível até o
          ponteiro chegar perto — controle de layout não pode disputar atenção
          com o dado. A área de toque é maior que o traço desenhado. */}
      <div
        role="separator"
        aria-label="Ajustar altura do painel"
        aria-orientation="horizontal"
        aria-valuenow={altura} aria-valuemin={min} aria-valuemax={max}
        tabIndex={0}
        onPointerDown={aoPuxar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onKeyDown={aoTeclar}
        onDoubleClick={() => grava(padrao)}
        title={ajustado
          ? `${altura}px · arraste, use ↑/↓ ou dê duplo clique pra voltar ao padrão`
          : `${altura}px · arraste ou use ↑/↓ pra mudar a altura`}
        className="absolute left-0 right-0 -bottom-1.5 h-3 flex items-center justify-center
                   cursor-ns-resize touch-none select-none focus:outline-none z-10"
      >
        <span
          aria-hidden
          className={`h-[3px] rounded-full transition-all duration-150 ${
            arrastando
              ? "w-24 bg-ww-accent"
              : "w-12 bg-ww-border opacity-0 group-hover/painel:opacity-100 group-focus-within/painel:opacity-100 hover:!w-24 hover:bg-ww-accent/70"}`}
        />
      </div>
    </div>
  );
}
