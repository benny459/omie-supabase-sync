import FinanceiroView from "@/components/bi/FinanceiroView";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-4">
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
