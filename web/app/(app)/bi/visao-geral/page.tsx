import VisaoGeralTabs from "@/components/bi/VisaoGeralTabs";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function VisaoGeralPage() {
  await requireArea("bi");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Visão Geral</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Porte do dashboard consolidado do Metabase, que tem 13 abas. As já portadas
          reaproveitam as mesmas views das páginas standalone — não há query duplicada.
        </p>
      </div>
      <VisaoGeralTabs />
    </div>
  );
}
