import { requireArea } from "@/lib/require-area";
import ErpListaView from "@/components/ErpListaView";

export const dynamic = "force-dynamic";

export default async function ErpVendasPage() {
  await requireArea("erp");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Vendas — PV / OS</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Pedidos de venda e ordens de serviço espelhados do Omie, com etapa, faturamento e NF.
          Clique num documento pra ver os itens.
        </p>
      </div>
      <ErpListaView modulo="vendas" />
    </div>
  );
}
