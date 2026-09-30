import FluxoCaixaView from "@/components/bi/FluxoCaixaView";
import TelaFluxoNavy from "@/components/navy/tela/TelaFluxoNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function FluxoCaixaPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("financeiro");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaFluxoNavy /><LinkClassica href="/bi/fluxo-caixa?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/fluxo-caixa" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Fluxo de Caixa Projetado</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Saldo de hoje mais o que entra e sai a cada dia, pela data de previsão. Mostra onde a curva
          aperta antes de ela apertar.
        </p>
      </div>
      <FluxoCaixaView />
    </div>
  );
}
