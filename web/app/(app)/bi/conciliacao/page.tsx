import ConciliacaoView from "@/components/bi/ConciliacaoView";
import TelaConciliacaoNavy from "@/components/navy/tela/TelaConciliacaoNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy (bancária + faturamento × AR). A antiga fica em
   ?classica=1 para comparar. */
export default async function ConciliacaoPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("bi");
  const { classica } = await searchParams;
  if (!classica) return (<><TelaConciliacaoNavy /><LinkClassica href="/bi/conciliacao?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/bi/conciliacao" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Conciliação</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Faturamento (vendas) contra títulos a receber (financeiro), cruzados por OS. Mostra a nota
          que nunca virou título, a que virou por outro valor e a que atravessou a virada do mês —
          as três coisas que fazem o fechamento não bater.
        </p>
      </div>
      <ConciliacaoView />
    </div>
  );
}
