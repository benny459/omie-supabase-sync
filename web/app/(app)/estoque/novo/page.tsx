import { requirePermissao } from "@/lib/require-area";
import CadastroItem from "@/components/navy/estoque/CadastroItem";

export const dynamic = "force-dynamic";

/* Estoque › Novo item (01/10/26): cadastro no painel (+ cópia no Omie para a SF). */
export default async function NovoItemPage() {
  await requirePermissao("estoque.acesso");
  return <CadastroItem />;
}
