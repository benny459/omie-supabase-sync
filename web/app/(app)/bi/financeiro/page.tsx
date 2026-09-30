import FinanceiroView from "@/components/bi/FinanceiroView";
import TelaVisaoNavy from "@/components/navy/tela/TelaVisaoNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";

export const dynamic = "force-dynamic";

/* 30/09/26: Visão financeira Navy (as abas Análise, Recebíveis e Fluxo da
   tela antiga continuam lá dentro). A antiga inteira em ?classica=1. */
export default async function Page({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  const { classica } = await searchParams;
  if (!classica) return (<><TelaVisaoNavy /><LinkClassica href="/bi/financeiro?classica=1" /></>);
  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/financeiro" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Financeiro</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5 max-w-[860px]">
          Fluxo, análise e recebíveis numa tela só. A natureza do título é filtro, não tela — por
          isso um aging em vez de dois. A aba Fluxo mantém a mesa de reagendamento inteira:
          duas curvas, simulação de atrasos, rateio em datas e envio ao Omie.
        </p>
      </div>
      <FinanceiroView />
    </div>
  );
}
