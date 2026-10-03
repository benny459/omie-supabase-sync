import SimplesView from "@/components/SimplesView";
import TelaSimplesNavy from "@/components/navy/tela/TelaSimplesNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar. */
export default async function SimplesPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaSimplesNavy /><LinkClassica href="/bi/simples?classica=1" /></>);
  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/simples" novo />
      <div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Simples Nacional</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Projeção do DAS do mês em andamento — a alíquota já está travada no dia 1º,
          só a base se move.
        </p>
      </div>
      <SimplesView />
    </div>
  );
}
