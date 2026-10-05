import { requirePermissao } from "@/lib/require-area";
import TelaVinculosCompra from "@/components/estoque/TelaVinculosCompra";

export const dynamic = "force-dynamic";

/* Estoque › Códigos de compra (05/10/26): vincular/cadastrar os produtos comprados que não são item nosso. */
export default async function Page() {
  await requirePermissao("estoque.acesso");
  return <TelaVinculosCompra />;
}
