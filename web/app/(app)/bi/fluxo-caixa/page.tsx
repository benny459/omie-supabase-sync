import FluxoCaixaView from "@/components/bi/FluxoCaixaView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function FluxoCaixaPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
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
