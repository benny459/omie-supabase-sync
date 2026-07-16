// Force Sync — TODOS os PCs, PVs e OSs sem exceção.
// Uso principal: buscar 1 número específico, selecionar, disparar refetch pontual
// (ConsultarPedCompra / ConsultarPedido) via workflow_dispatch.
// Auto-refresh 1h no cliente.

import { supaServer } from "@/lib/supabase-server";
import StandbyView, { type StandbyPc, type StandbyPv } from "@/components/StandbyView";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function StandbyPage() {
  const supa = await supaServer();

  // Sem LIMIT — v_pcs_all_flat tem ~4.5k, v_pvs_all_flat tem ~4.8k.
  // Paginação é client-side (100/página).
  const [pcsRes, pvsRes] = await Promise.all([
    supa.from("v_pcs_all_flat")
      .select("empresa,pc_numero,ncod_ped,projeto_nome,nome_fornecedor,pc_etapa_texto,valor_total,dt_inclusao,dt_previsao")
      .order("_dt_inclusao_d", { ascending: false, nullsFirst: false })
      .order("pc_numero",      { ascending: true,  nullsFirst: false })
      .range(0, 19999),
    supa.from("v_pvs_all_flat")
      .select("empresa,pv_os_label,pv_os_tipo,pv_cliente_fantasia,projeto_nome,pv_data_previsao,pv_valor_total,pv_etapa_texto,pv_dt_fat,pv_num_nfe,pv_emissao")
      .order("_pv_emissao_d", { ascending: false, nullsFirst: false })
      .range(0, 19999),
  ]);

  // Dedup PCs por segurança (view já dedupe, mas garante)
  const seenPc = new Set<string>();
  const pcs: StandbyPc[] = [];
  for (const r of (pcsRes.data ?? []) as StandbyPc[]) {
    const k = `${r.empresa}|${r.pc_numero}`;
    if (seenPc.has(k)) continue;
    seenPc.add(k);
    pcs.push(r);
  }

  const pvs: StandbyPv[] = (pvsRes.data ?? []) as StandbyPv[];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Force Sync — PCs / PVs / OSs</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Todos os pedidos do Omie. Busque, selecione e dispare refetch pontual (Consultar API). Tabela atualiza sozinha a cada 1h.
        </p>
      </div>

      {(pcsRes.error || pvsRes.error) && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
          <strong>Erro:</strong> {pcsRes.error?.message ?? pvsRes.error?.message}
        </div>
      )}

      <StandbyView pcs={pcs} pvs={pvs} />
    </div>
  );
}
