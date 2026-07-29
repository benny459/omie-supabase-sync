import BoldAvulsosLoader from "@/components/BoldAvulsosLoader";

export const dynamic = "force-dynamic";

// v_pc_avulsos é pesada — count "estimated" evita SELECT count(*) sobre a view.
// SSR só renderiza shell; dados vêm via /api/list/rows (client-fetch) com skeleton.
export default function AvulsosPage() {
  return (
    <BoldAvulsosLoader view="v_pc_avulsos" modulo="avulsos" title="Vendas avulsas" countMode="estimated" />
  );
}
