import { supaServer } from "@/lib/supabase-server";
import BoldAvulsosView from "@/components/BoldAvulsosViewClient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Server: 1 call rápida (1000 rows). View v_pc_avulsos é pesada — 2 calls
// paralelas no SSR estouram timeout do Vercel ou demoram >10s. O cliente
// completa o resto em background via useEffect (ver BoldAvulsosView).
export default async function AvulsosPage() {
  const supa = await supaServer();
  const { data, error, count } = await supa
    .from("v_pc_avulsos")
    .select("*", { count: "exact" })
    .order("pv_os_label", { ascending: true, nullsFirst: false })
    .order("ncod_ped",    { ascending: true })
    .limit(1000);

  return (
    <>
      {error && (
        <div className="p-4 mb-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {error.message}
        </div>
      )}
      <BoldAvulsosView
        modulo="avulsos"
        title="Vendas avulsas"
        rows={data ?? []}
        totalCount={count ?? null}
      />
    </>
  );
}
