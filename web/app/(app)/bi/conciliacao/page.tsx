import ConciliacaoView from "@/components/bi/ConciliacaoView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function ConciliacaoPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Conciliação</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Faturamento (vendas) contra títulos a receber (financeiro), cruzados por OS. Mostra a nota
          que nunca virou título, a que virou por outro valor e a que atravessou a virada do mês —
          as três coisas que fazem o fechamento não bater.
        </p>
      </div>
      <ConciliacaoView />
    </div>
  );
}
