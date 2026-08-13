import MargemVendaView from "@/components/bi/MargemVendaView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function MargemVendaPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Margem por Venda</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Cada venda confrontada com o custo de compra ligado ao seu PV/OS. Abre nas avulsas, que é
          onde a margem varia mais, e alarma quando alguma sai abaixo do custo.
        </p>
      </div>
      <MargemVendaView />
    </div>
  );
}
