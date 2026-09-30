import ContasPagarView from "@/components/bi/ContasPagarView";
import { TelaContasPagarBiNavy } from "@/components/navy/tela/TelaContasBiNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function ContasPagarPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("financeiro");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaContasPagarBiNavy /><LinkClassica href="/bi/contas-pagar?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/contas-pagar" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Pagar</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Saldo quebrado por horizonte — vencido, a vencer e parcelas futuras contratadas.
          O card equivalente no Metabase somava tudo num número só.
        </p>
      </div>
      <ContasPagarView />
    </div>
  );
}
