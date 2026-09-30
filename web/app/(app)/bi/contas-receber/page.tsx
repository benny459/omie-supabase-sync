import ContasReceberView from "@/components/bi/ContasReceberView";
import { TelaContasReceberBiNavy } from "@/components/navy/tela/TelaContasBiNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function ContasReceberPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaContasReceberBiNavy /><LinkClassica href="/bi/contas-receber?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/contas-receber" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Receber</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Títulos abertos, aging e emitido vs recebido. O recorte de carteira é um filtro
          explícito aqui — no Metabase estava fixo no SQL e aplicado de forma incoerente.
        </p>
      </div>
      <ContasReceberView />
    </div>
  );
}
