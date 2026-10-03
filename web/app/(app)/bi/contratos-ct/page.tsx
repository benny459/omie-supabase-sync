import ContratosCtView from "@/components/bi/ContratosCtView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function ContratosCtPage() {
  await requireArea("bi");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Contratos CT</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Receita contratual (categoria 1.01.01) por contrato e por mês. Contrato = projeto
          cujo nome começa com CT. Porte nativo do dashboard equivalente no Metabase.
        </p>
      </div>
      <ContratosCtView />
    </div>
  );
}
