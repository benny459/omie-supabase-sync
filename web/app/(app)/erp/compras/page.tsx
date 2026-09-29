import { requireArea } from "@/lib/require-area";
import ErpListaView from "@/components/ErpListaView";

export const dynamic = "force-dynamic";

export default async function ErpComprasPage() {
  await requireArea("erp");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Compras — PC / RC</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Pedidos e requisições de compra espelhados do Omie, com etapa, recebimento e vínculo
          PV/OS (⚙ = vínculo por triangulação automática). Clique pra ver os itens.
        </p>
      </div>
      <ErpListaView modulo="compras" />
    </div>
  );
}
