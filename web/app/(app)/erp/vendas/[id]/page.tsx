import { requireArea } from "@/lib/require-area";
import TelaVendaDoc from "@/components/vendas/TelaVendaDoc";

export const dynamic = "force-dynamic";

/* PV / OS nativo do painel (P1, 05/10/26). */
export default async function VendaDocPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("erp");
  const { id } = await params;
  return <TelaVendaDoc id={Number(id) || null} />;
}
