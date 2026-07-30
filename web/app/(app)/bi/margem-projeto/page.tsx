import MargemProjetoView from "@/components/bi/MargemProjetoView";
import { requireArea } from "@/lib/require-area";

export const dynamic = "force-dynamic";

export default async function MargemProjetoPage() {
  // Área BI nasce FECHADA no AREA_DEFAULT — só admin e quem tiver row explícita
  // em platform.user_area_access entra aqui.
  await requireArea("bi");

  return (
    <div className="space-y-4">
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
