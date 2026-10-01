import { requireArea } from "@/lib/require-area";
import FichaItemNavy from "@/components/navy/estoque/FichaItemNavy";

export const dynamic = "force-dynamic";

/* Estoque v2 (01/10/26): ficha do item — deep link /estoque/<código do produto>[?aba=mov|compras|forn|auditoria]. */
export default async function FichaItemPage({ params, searchParams }: {
  params: Promise<{ codigo: string }>; searchParams: Promise<{ aba?: string }>;
}) {
  await requireArea("erp");
  const [{ codigo }, { aba }] = await Promise.all([params, searchParams]);
  return <FichaItemNavy codigo={decodeURIComponent(codigo)} abaInicial={aba} />;
}
