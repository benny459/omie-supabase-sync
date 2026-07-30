import ContasReceberView from "@/components/bi/ContasReceberView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function ContasReceberPage() {
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Receber</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Títulos abertos, aging e emitido vs recebido. O recorte de carteira é um filtro
          explícito aqui — no Metabase estava fixo no SQL e aplicado de forma incoerente.
        </p>
      </div>
      <ContasReceberView />
    </div>
  );
}
