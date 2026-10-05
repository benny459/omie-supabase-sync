import { requireArea } from "@/lib/require-area";
import TelaAuxiliar from "@/components/cadastros/TelaAuxiliar";

export const dynamic = "force-dynamic";

/* Cadastros › vendedores (05/10/26, sql/63): cadastro próprio do painel; o do Omie entrou como histórico. */
export default async function Page() {
  await requireArea("erp");
  return <TelaAuxiliar reg="vendedores" />;
}
