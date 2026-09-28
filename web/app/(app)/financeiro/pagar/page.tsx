import { requireArea } from "@/lib/require-area";
import TitulosView from "@/components/TitulosView";

export const dynamic = "force-dynamic";

export default async function ContasPagarPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Pagar</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Títulos do Omie espelhados aqui. Todas as empresas; status calculado pelo Omie.
        </p>
      </div>
      <TitulosView tipo="pagar" />
    </div>
  );
}
