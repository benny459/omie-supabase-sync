import MargemProjetoView from "@/components/bi/MargemProjetoView";
import { TelaMargemProjetoNavy } from "@/components/navy/tela/TelaMargensNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function MargemProjetoPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  // Área BI nasce FECHADA no AREA_DEFAULT — só admin e quem tiver row explícita
  // em platform.user_area_access entra aqui.
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaMargemProjetoNavy /><LinkClassica href="/bi/margem-projeto?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/margem-projeto" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Margem por projeto</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Receita (itens vendidos + OS faturadas) menos títulos a pagar, por projeto.
          Porte nativo do dashboard equivalente no Metabase.
        </p>
      </div>
      <MargemProjetoView />
    </div>
  );
}
