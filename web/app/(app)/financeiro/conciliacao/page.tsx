import { requirePermissao } from "@/lib/require-area";
import TelaConciliacaoBancaria from "@/components/navy/tela/TelaConciliacaoBancaria";

export const dynamic = "force-dynamic";

/* Conciliação bancária nativa (05/10/26, sql/52): extrato OFX × títulos do
   painel. A tela de conciliação do Omie continua em /bi/conciliacao. */
export default async function ConciliacaoBancariaPage() {
  await requirePermissao("financeiro.conciliar");
  return <TelaConciliacaoBancaria />;
}
