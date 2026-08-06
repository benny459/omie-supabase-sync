"use client";

// Modo claro/escuro pro kit de gráficos.
//
// O tema escuro é SELECIONADO, não um flip automático do claro: SERIES_DARK são
// os mesmos 8 hues repassados pra banda escura e validados contra #141412. Por
// isso o kit precisa saber em qual modo está — não dá pra deixar o CSS resolver.
//
// O painel marca o tema com a classe `dark` no <html> (ver ThemeToggle), então
// observamos essa classe em vez do prefers-color-scheme: o toggle do usuário tem
// que vencer a preferência do sistema nos dois sentidos.

import { useEffect, useState } from "react";
import { TEMA_PADRAO, temaValido, type VizMode, type VizTema } from "@/lib/viz/palette";

export function useVizMode(): VizMode {
  // Começa no claro pra o server-render e o primeiro paint baterem; o effect
  // corrige antes de qualquer pintura relevante.
  const [mode, setMode] = useState<VizMode>("light");

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setMode(root.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return mode;
}

/**
 * Modo + tema de cor, juntos.
 *
 * O tema é marcado com `data-palette` no <html> (ver SeletorPaleta), e é
 * observado do mesmo jeito que a classe `dark`: por MutationObserver. Assim
 * trocar a paleta repinta TODOS os gráficos abertos na hora, sem recarregar a
 * página e sem cada tela precisar saber que existe um seletor.
 *
 * Um hook só devolvendo os dois porque quem desenha precisa sempre do par —
 * separar em dois hooks faria cada componente assinar dois observers.
 */
export function useVizTema(): { mode: VizMode; tema: VizTema } {
  const [estado, setEstado] = useState<{ mode: VizMode; tema: VizTema }>({
    mode: "light",
    tema: TEMA_PADRAO,
  });

  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setEstado({
        mode: root.classList.contains("dark") ? "dark" : "light",
        tema: temaValido(root.getAttribute("data-palette")),
      });
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["class", "data-palette"] });
    return () => obs.disconnect();
  }, []);

  return estado;
}
