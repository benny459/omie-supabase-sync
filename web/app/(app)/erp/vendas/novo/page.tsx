import { requireArea } from "@/lib/require-area";
import TelaVendaDoc from "@/components/vendas/TelaVendaDoc";

export const dynamic = "force-dynamic";

/* Novo PV / OS no painel (P1, 05/10/26) — sem Omie. */
export default async function NovaVendaPage() {
  await requireArea("erp");
  return <TelaVendaDoc id={null} />;
}
