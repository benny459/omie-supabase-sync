import CustoClienteView from "@/components/bi/CustoClienteView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function CustoClientePage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Custo por Cliente</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Quanto custa atender cada cliente: despesas lançadas na OS, combustível e pedágio rateados
          por km, e o tempo dos técnicos. Lido direto do app de serviços; a receita vem do Omie, e o
          cruzamento é pelo código do cliente.
        </p>
      </div>
      <CustoClienteView />
    </div>
  );
}
