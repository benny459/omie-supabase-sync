import MargemVendaView from "@/components/bi/MargemVendaView";
import { TelaMargemVendaNavy } from "@/components/navy/tela/TelaMargensNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function MargemVendaPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaMargemVendaNavy /><LinkClassica href="/bi/margem-venda?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/margem-venda" novo />
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
