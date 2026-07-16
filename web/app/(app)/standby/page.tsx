// PCs Standby (admin) — standalone com projeto 40_VS/41_VP aguardando
// vinculação com PV. Util quando o sync incremental do Omie perde updates
// em pedidos antigos: usuário abre aqui, identifica o PC específico, e
// pode disparar uma atualização pontual.

import { supaServer } from "@/lib/supabase-server";
import BoldAvulsosView from "@/components/BoldAvulsosViewClient";
import StandbyForceSync from "@/components/StandbyForceSync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function StandbyPage() {
  const supa = await supaServer();
  const { data, error, count } = await supa
    .from("v_pc_standby")
    .select("*", { count: "exact" })
    .order("dt_inclusao", { ascending: false, nullsFirst: false })
    .order("pc_numero",   { ascending: true,  nullsFirst: false })
    .limit(2000);

  return (
    <>
      <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
        <div className="flex items-start gap-2">
          <span className="text-[16px] leading-none mt-0.5">⏸</span>
          <div className="text-[12px] text-amber-900 dark:text-amber-100">
            <div className="font-bold mb-0.5">PCs em Standby — aguardando vinculação</div>
            <div className="opacity-90 leading-snug">
              PCs standalone (sem PV/OS vinculado) com projeto <code>40_VS</code> ou <code>41_VP</code>.
              Ficam ocultos do painel principal até um PV avulso ser criado no Omie e vinculado
              via <code>pc_numero_manual</code>. Casos antigos que ficaram esquecidos ou o sync
              incremental não atualizou aparecem aqui pra revisão pontual.
            </div>
          </div>
        </div>
      </div>
      <StandbyForceSync />
      {error && (
        <div className="p-4 mb-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {error.message}
        </div>
      )}
      <BoldAvulsosView
        modulo="pcs"
        title="PCs Standby"
        rows={data ?? []}
        totalCount={count ?? null}
      />
    </>
  );
}
