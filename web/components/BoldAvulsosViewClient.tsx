"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// Carrega BoldAvulsosView so no client (sem SSR) pra evitar hydration
// mismatch causado por Intl.NumberFormat e new Date() entre Node e browser.
// O painel e logado, nao tem SEO; SSR aqui so prejudica.
const BoldAvulsosView = dynamic(() => import("./BoldAvulsosView"), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-sm text-ww-textMuted">Carregando painel...</div>
  ),
});

export default function BoldAvulsosViewClient(props: ComponentProps<typeof BoldAvulsosView>) {
  return <BoldAvulsosView {...props} />;
}
