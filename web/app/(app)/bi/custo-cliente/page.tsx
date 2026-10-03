import CustoClienteView from "@/components/bi/CustoClienteView";
import TelaCustoClienteNavy from "@/components/navy/tela/TelaCustoClienteNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function CustoClientePage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaCustoClienteNavy /><LinkClassica href="/bi/custo-cliente?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/custo-cliente" novo />
      <div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Custo por Cliente</h1>
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
