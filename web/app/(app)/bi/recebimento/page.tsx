import RecebimentoView from "@/components/bi/RecebimentoView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function RecebimentoPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Faturamento → Recebimento</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          De cada mês faturado: quanto já entrou, quanto ainda vem e quando. Cada título a receber
          mostra de qual nota veio, e cada nota mostra em que estágio do ciclo está.
        </p>
      </div>
      <RecebimentoView />
    </div>
  );
}
