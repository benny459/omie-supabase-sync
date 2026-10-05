import { requireArea } from "@/lib/require-area";
import TelaDuplicidades from "@/components/cadastros/TelaDuplicidades";

export const dynamic = "force-dynamic";

/* Cadastros › Duplicidades (05/10/26, sql/59): duplicados que já existem — mesclar, agrupar ou "não é duplicado". */
export default async function DuplicidadesPage() {
  await requireArea("erp");
  return <TelaDuplicidades />;
}
