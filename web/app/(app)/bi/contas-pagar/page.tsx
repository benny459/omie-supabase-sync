import ContasPagarView from "@/components/bi/ContasPagarView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function ContasPagarPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Pagar</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Saldo quebrado por horizonte — vencido, a vencer e parcelas futuras contratadas.
          O card equivalente no Metabase somava tudo num número só.
        </p>
      </div>
      <ContasPagarView />
    </div>
  );
}
