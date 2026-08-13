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
          Cada venda avulsa confrontada com o custo de compra do seu PV/OS, e alarme quando alguma
          sai abaixo do custo. Cobre tudo que passa pelo fluxo de avulsos — inclusive Revenda e
          Contratuais, que também são avulsos. Aqui a receita é a <strong>faturada (NF)</strong>;
          na tela de Vendas Avulsas é o valor do PV, então as duas divergem em faturamento parcial.
        </p>
      </div>
      <MargemVendaView />
    </div>
  );
}
