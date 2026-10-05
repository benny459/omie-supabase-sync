import { requireArea } from "@/lib/require-area";
import TelaCadastros from "@/components/cadastros/TelaCadastros";

export const dynamic = "force-dynamic";

/* Cadastros › Fornecedores (05/10/26): o cadastro próprio do painel (cadastros.pessoas). */
export default async function FornecedoresPage() {
  await requireArea("erp");
  return <TelaCadastros papel="fornecedor" />;
}
