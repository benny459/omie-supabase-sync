import ComprasCadeiaView from "@/components/bi/ComprasCadeiaView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function ComprasCadeiaPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Cadeia de Compras</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          O caminho do dinheiro de compra: título a pagar → pedido de compra → aprovação → PV/OS →
          nota pro cliente → recebimento. Mostra onde a cadeia trava — compra paga que nunca virou
          faturamento, projeto comprando mais do que vende, PC sem aprovação.
        </p>
      </div>
      <ComprasCadeiaView />
    </div>
  );
}
