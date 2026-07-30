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
import type { VizMode } from "@/lib/viz/palette";

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
