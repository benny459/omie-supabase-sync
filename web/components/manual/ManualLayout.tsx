import "./manual.css";
import type { ReactNode } from "react";
import { PAGINAS } from "@/lib/manual";
import ManualIndice, { type ItemIndice } from "./ManualIndice";

function semMarcacao(md: string) {
  return md.replace(/[#*>`|_\[\]()-]/g, " ").replace(/\s+/g, " ").slice(0, 6000);
}

export default function ManualLayout({ atual, children }: { atual: string | null; children: ReactNode }) {
  const itens: ItemIndice[] = PAGINAS.map((p) => ({
    slug: p.slug, titulo: p.titulo, icone: p.icone, area: p.area, texto: p.resumo + " " + semMarcacao(p.corpo),
  }));
  return (
    <div className="mn">
      <ManualIndice itens={itens} atual={atual} />
      <main className="mn-pagina">{children}</main>
    </div>
  );
}
