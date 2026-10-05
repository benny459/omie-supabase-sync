import { notFound } from "next/navigation";
import ManualLayout from "@/components/manual/ManualLayout";
import ManualConteudo from "@/components/manual/ManualConteudo";
import { paginaPorSlug } from "@/lib/manual";

export const dynamic = "force-dynamic";

const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default async function ManualPagina({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = paginaPorSlug(slug);
  if (!p) notFound();
  const ultima = [p.atualizado, ...p.mudancas.map((m) => m.data)].filter(Boolean).sort().pop() ?? null;
  return (
    <ManualLayout atual={p.slug}>
      <div className="mn-cab">
        <div className="mn-migalha">Manual › {p.titulo}</div>
        <h1><span aria-hidden style={{ marginRight: 10 }}>{p.icone}</span>{p.titulo}</h1>
        <p className="mn-resumo">{p.resumo}</p>
        <div className="mn-meta">Última atualização: {dataBR(ultima)}</div>
      </div>
      <ManualConteudo corpo={p.corpo} />
      {p.mudancas.length > 0 && (
        <section className="mn-mudou">
          <h2>O que mudou recentemente</h2>
          <ul>
            {p.mudancas.map((m) => (
              <li key={m.hash}><span className="mn-data">{dataBR(m.data)}</span> {m.texto}</li>
            ))}
          </ul>
        </section>
      )}
    </ManualLayout>
  );
}
