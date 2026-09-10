// Mockup do Financeiro consolidado — desenho para aprovação. Não lê nem grava.
import FinanceiroMockup from "@/components/mockup/FinanceiroMockup";

export default function Page() {
  return (
    <div className="min-h-screen bg-ww-bg p-5">
      <div className="max-w-[1560px] mx-auto space-y-4">
        <div>
          <h1 className="text-[19px] font-bold text-ww-text tracking-[-0.4px]">
            Financeiro <span className="text-ww-textFaint">(proposta consolidada)</span>
          </h1>
          <p className="text-[12px] text-ww-textMuted mt-1 max-w-[820px]">
            Substitui três telas — Fluxo de Caixa, Contas a Pagar e Contas a Receber — por uma,
            com três abas e um seletor de lado. A natureza do título vira <strong>filtro</strong>,
            não tela: é isso que elimina os gráficos repetidos.
          </p>
        </div>
        <FinanceiroMockup />
      </div>
    </div>
  );
}
