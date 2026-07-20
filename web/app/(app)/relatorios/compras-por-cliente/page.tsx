import ComprasPorClienteView from "@/components/ComprasPorClienteView";

export const dynamic = "force-dynamic";

export default function ComprasPorClientePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Compras por cliente (prévia)</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Contribuição do painel pra rentabilidade consolidada: compras aprovadas (PCs) e
          receita cruzada por cliente. O consolidado (receita − compras − custo) vive no{" "}
          <a href="https://metabase.waterworks.com.br/dashboard/9" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
            Metabase
          </a>.
        </p>
      </div>
      <ComprasPorClienteView />
    </div>
  );
}
