import { requirePermissao } from "@/lib/require-area";
import CadastrosEstoque from "@/components/navy/estoque/Cadastros";

export const dynamic = "force-dynamic";

/* Estoque › Catálogo (02/10/26; era "Cadastros"): famílias, revisão de famílias, códigos novos e fotos.
   ?aba=familias|revisao|codigos|fotos */
export default async function CatalogoPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  await requirePermissao("estoque.acesso");
  const { aba } = await searchParams;
  return <CadastrosEstoque abaInicial={aba} />;
}
