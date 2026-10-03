import ComprasCadeiaView from "@/components/bi/ComprasCadeiaView";
import { TelaCadeiaComprasNavy } from "@/components/navy/tela/TelaMargensNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function ComprasCadeiaPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaCadeiaComprasNavy /><LinkClassica href="/bi/compras-cadeia?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/compras-cadeia" novo />
      <div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Cadeia de Compras</h1>
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
