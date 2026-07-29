import BoldAvulsosLoader from "@/components/BoldAvulsosLoader";
import PcInlineAdd from "@/components/PcInlineAdd";

export const dynamic = "force-dynamic";

export default function PCsPage() {
  return (
    <>
      <div className="mb-3">
        <PcInlineAdd />
      </div>
      <BoldAvulsosLoader view="v_pc_pcs" modulo="pcs" title="PCs Standalone" countMode="exact" />
    </>
  );
}
