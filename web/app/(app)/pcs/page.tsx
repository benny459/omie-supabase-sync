import { supaServer } from "@/lib/supabase-server";
import BoldAvulsosView from "@/components/BoldAvulsosViewClient";
import PcInlineAdd from "@/components/PcInlineAdd";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function PCsPage() {
  const supa = await supaServer();
  const { data, error, count } = await supa
    .from("v_pc_pcs")
    .select("*", { count: "exact" })
    .order("pc_etapa_code", { ascending: true, nullsFirst: false })
    .order("pc_numero",     { ascending: true, nullsFirst: false })
    .order("ncod_ped",      { ascending: true })
    .limit(1000);

  return (
    <>
      {error && (
        <div className="p-4 mb-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {error.message}
        </div>
      )}
      <div className="mb-3">
        <PcInlineAdd />
      </div>
      <BoldAvulsosView
        modulo="pcs"
        title="PCs Standalone"
        rows={data ?? []}
        totalCount={count ?? null}
      />
    </>
  );
}
