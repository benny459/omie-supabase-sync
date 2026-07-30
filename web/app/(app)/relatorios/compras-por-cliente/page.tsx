import { requireArea } from "@/lib/require-area";
import ComprasPorClienteView from "@/components/ComprasPorClienteView";

export const dynamic = "force-dynamic";

export default async function ComprasPorClientePage() {
  // Esconder do menu não basta: sem isto a URL direta continua abrindo.
  await requireArea("compras");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Rentabilidade por cliente</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          DRE consolidada por cliente: Receita (NFs Omie) − Compras (PCs aprovados) − Despesas op. − Mão de obra = Margem bruta.
          {" "}Custos operacionais e mão de obra vêm do app.waterworks (<code>bi.v_rentabilidade_cliente</code>).
        </p>
      </div>
      <ComprasPorClienteView />
    </div>
  );
}
