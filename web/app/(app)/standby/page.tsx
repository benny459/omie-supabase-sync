// PCs Standby (admin) — standalone com projeto 40_VS/41_VP aguardando
// vinculação com PV. Tabela flat + tab pra force-sync PVs.

import { supaServer } from "@/lib/supabase-server";
import StandbyView, { type StandbyPc } from "@/components/StandbyView";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function StandbyPage() {
  const supa = await supaServer();
  const { data, error } = await supa
    .from("v_pc_standby")
    .select("empresa,pc_numero,ncod_ped,projeto_nome,nome_fornecedor,pc_etapa_texto,valor_total,dt_inclusao,dt_previsao")
    .order("dt_inclusao", { ascending: false, nullsFirst: false })
    .order("pc_numero",   { ascending: true,  nullsFirst: false })
    .limit(3000);

  // Dedup por pc_numero (view multiplica por item)
  const seen = new Set<string>();
  const pcs: StandbyPc[] = [];
  for (const r of (data ?? []) as StandbyPc[]) {
    const k = `${r.empresa}|${r.pc_numero}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pcs.push(r);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Standby & Force Sync</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          PCs aguardando vinculação (standalone 40_VS/41_VP) + refetch pontual de PCs/PVs específicos do Omie.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {error.message}
        </div>
      )}

      <StandbyView pcs={pcs} />
    </div>
  );
}
