import SimplesView from "@/components/SimplesView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function SimplesPage() {
  await requireArea("financeiro");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Simples Nacional</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Projeção do DAS do mês em andamento — a alíquota já está travada no dia 1º,
          só a base se move.
        </p>
      </div>
      <SimplesView />
    </div>
  );
}
