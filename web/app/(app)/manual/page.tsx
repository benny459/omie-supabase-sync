import Link from "next/link";
import ManualLayout from "@/components/manual/ManualLayout";
import { PAGINAS } from "@/lib/manual";

export const metadata = { title: "Manual · Allka" };
export const dynamic = "force-dynamic";

/* Manual do usuário (05/10/26): uma página por aba da barra. Conteúdo em
   web/content/manual/*.md — toda mudança visível deve atualizar a página. */
export default function ManualInicio() {
  return (
    <ManualLayout atual={null}>
      <div className="mn-cab">
        <div className="mn-migalha">Manual</div>
        <h1>Manual da plataforma</h1>
        <p className="mn-resumo">Como usar cada área do sistema, passo a passo. Clique numa área ou use a busca à esquerda. Em qualquer tela, o botão <b>?</b> na barra abre a página daquela área.</p>
      </div>
      <div className="mn-cartoes">
        {PAGINAS.map((p) => (
          <Link key={p.slug} href={`/manual/${p.slug}`} className="mn-cartao">
            <span className="mn-ic" aria-hidden>{p.icone}</span>
            <b>{p.titulo}</b>
            <span>{p.resumo}</span>
          </Link>
        ))}
      </div>
    </ManualLayout>
  );
}
