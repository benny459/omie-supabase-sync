import { requireArea } from "@/lib/require-area";
import TelaEstoqueNavy from "@/components/navy/tela/TelaEstoqueNavy";

export const dynamic = "force-dynamic";

/* Estoque › Movimentação (02/10/26): aba na 2ª linha do menu. */
export default async function Page() {
  await requireArea("erp");
  return <TelaEstoqueNavy aba="movs" />;
}
