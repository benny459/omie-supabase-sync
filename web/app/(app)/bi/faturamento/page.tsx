import FaturamentoBiView from "@/components/bi/FaturamentoBiView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function FaturamentoBiPage() {
  await requireArea("vendas");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Faturamento — analítico</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Totais, mix por categoria e prazos (DSO e concedido). Não confundir com
          “Faturamento” em Relatórios, que é o diário operacional.
        </p>
      </div>
      <FaturamentoBiView />
    </div>
  );
}
