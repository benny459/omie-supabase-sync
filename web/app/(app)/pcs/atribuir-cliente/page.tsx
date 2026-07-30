import { requireArea } from "@/lib/require-area";
import AtribuirClienteView from "@/components/AtribuirClienteView";

export const dynamic = "force-dynamic";

export default async function AtribuirClientePage() {
  // Esconder do menu não basta: sem isto a URL direta continua abrindo.
  await requireArea("compras");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Atribuir cliente aos PCs standalone</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          PCs aprovados sem PV origem (projetos genéricos como 47_CONTRATUAL) precisam ter cliente(s) atribuídos pra virarem rentabilidade.
          Múltiplos clientes por PC com rateio percentual (soma 100%). SafeWater (#2226456549) válido pra overhead do escritório.
        </p>
      </div>
      <AtribuirClienteView />
    </div>
  );
}
