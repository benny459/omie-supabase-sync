"use client";

// A porta do Cesar na barra de cima.
//
// Antes era uma pílula flutuante no rodapé, fixa no meio da tela. Ela passava
// por cima do conteúdo — na tela de Projetos caía bem em cima da linha do
// pipeline — e um controle permanente que tapa dado é um controle no lugar
// errado, por mais bonito que seja. A barra superior já é onde moram os outros
// controles globais (versão, sync, paleta, tema); o Cesar é mais um deles.
//
// Discreto de propósito: mesma moldura de 28px do tema e da paleta, com o
// gradiente do avatar dentro para ser reconhecível de relance. O nome aparece
// no title, não ocupando largura permanente.

import { useCesar } from "./CesarProvider";

export default function BotaoCesar() {
  const { abrir, aberto } = useCesar();
  return (
    <button
      type="button"
      onClick={() => abrir()}
      aria-pressed={aberto}
      title="Cesar — analista financeiro. Pergunte sobre caixa, recebíveis, margem ou despesa."
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition ${
        aberto
          ? "border-ww-accent/70 bg-ww-accent/15"
          : "border-ww-border bg-ww-panel hover:bg-ww-rowHover"}`}
    >
      <span
        aria-hidden
        className={`w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-bold text-white
                    bg-gradient-to-br from-sky-500 to-violet-500 transition-opacity ${
                      aberto ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`}
      >
        C
      </span>
    </button>
  );
}
