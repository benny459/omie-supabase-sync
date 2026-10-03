import { requirePermissao } from "@/lib/require-area";
import CadastroItem from "@/components/navy/estoque/CadastroItem";

export const dynamic = "force-dynamic";

/* Estoque › Editar cadastro do item (01/10/26). */
export default async function EditarItemPage({ params }: { params: Promise<{ codigo: string }> }) {
  await requirePermissao("estoque.acesso");
  const { codigo } = await params;
  return <CadastroItem codigo={decodeURIComponent(codigo)} />;
}
