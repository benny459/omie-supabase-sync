import BoldAvulsosLoader from "@/components/BoldAvulsosLoader";

export const dynamic = "force-dynamic";

export default function ProjetosPage() {
  return (
    <BoldAvulsosLoader view="v_pc_projetos" modulo="projetos" title="Projetos" countMode="exact" />
  );
}
