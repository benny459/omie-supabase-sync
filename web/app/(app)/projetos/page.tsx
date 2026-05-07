import { supaServer } from "@/lib/supabase-server";
import BoldAvulsosView from "@/components/BoldAvulsosViewClient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function ProjetosPage() {
  const supa = await supaServer();
  const { data, error, count } = await supa
    .from("v_pc_projetos")
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
        modulo="projetos"
        title="Projetos"
        rows={data ?? []}
        totalCount={count ?? null}
      />
    </>
  );
}
