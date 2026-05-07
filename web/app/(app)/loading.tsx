// Mostrado IMEDIATAMENTE pelo Next durante navegações entre módulos enquanto
// o server-render da próxima rota não terminou. Sem isso o clique no sidebar
// dá impressão de "travado" porque pages são force-dynamic e refazem a query.
export default function Loading() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="h-7 w-48 bg-ww-rowHover rounded animate-pulse" />
          <div className="h-3 w-32 bg-ww-rowHover/60 rounded mt-2 animate-pulse" />
        </div>
        <div className="h-10 w-[420px] max-w-full bg-ww-rowHover/60 rounded-lg animate-pulse" />
      </div>

      {/* Caixas PV-Status / PC-Aprovação skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-stretch">
        <div className="md:col-span-2 h-[120px] bg-ww-panel border border-ww-border rounded-xl animate-pulse" />
        <div className="md:col-span-4 h-[120px] bg-ww-panel border border-ww-border rounded-xl animate-pulse" />
      </div>

      {/* Lista de buckets skeleton */}
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[88px] bg-ww-panel border-2 border-ww-border rounded-[12px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
