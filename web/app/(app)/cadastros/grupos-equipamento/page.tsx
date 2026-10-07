import { requireArea } from "@/lib/require-area";
import TelaGruposEquipamento from "@/components/cadastros/TelaGruposEquipamento";

export const dynamic = "force-dynamic";

/* Cadastros › Geral › Grupos de equipamento (07/10/26, sql/100): nomes padrão
   dos grupos da lista de materiais ("Filtro Multimeios", "Osmose Reversa"…). */
export default async function Page() {
  await requireArea("erp");
  return <TelaGruposEquipamento />;
}
