import { requireArea } from "@/lib/require-area";
import CadastrosEstoque from "@/components/navy/estoque/Cadastros";

export const dynamic = "force-dynamic";

/* Estoque › Cadastros (01/10/26): famílias com prefixo, revisão de famílias e códigos novos. ?aba=familias|revisao|codigos */
export default async function CadastrosPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  await requireArea("erp");
  const { aba } = await searchParams;
  return <CadastrosEstoque abaInicial={aba} />;
}
