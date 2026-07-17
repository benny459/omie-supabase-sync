// Página de faturamento diário — gráfico stacked bar por dia do período,
// segmentado por tipo (PV/OS) × categoria (Contrato/Projeto/Avulso/Outro).
// Todas as empresas SF/CD/WW. Só faturados (dt_fat + num_nfe/num_recibo).

import FaturamentoView from "@/components/FaturamentoView";

export const dynamic = "force-dynamic";

export default function FaturamentoPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Faturamento diário</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          NFs emitidas dia-a-dia por tipo (PV/OS) e categoria (Contrato/Projeto/Avulso/Outro).
          Todas as empresas.
        </p>
      </div>
      <FaturamentoView />
    </div>
  );
}
