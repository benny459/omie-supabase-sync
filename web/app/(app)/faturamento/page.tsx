import { requirePermissao } from "@/lib/require-area";
import TelaFaturamento from "@/components/faturamento/TelaFaturamento";

export const dynamic = "force-dynamic";

/* Faturamento pela Focus NFe (P5 do ciclo de vendas avulsas, 05/10/26):
   emissão de NF-e (PV), NFS-e ou recibo (OS) sem Omie. Homologação por padrão. */
export default async function FaturamentoPage() {
  await requirePermissao("financeiro.editar_titulo");
  return <TelaFaturamento />;
}
