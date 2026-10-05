import { requireArea } from "@/lib/require-area";
import TelaCadastros from "@/components/cadastros/TelaCadastros";

export const dynamic = "force-dynamic";

/* Cadastros › Transportadoras (05/10/26): as pessoas com papel de transportadora (cadastros.pessoas). */
export default async function TransportadorasPage() {
  await requireArea("erp");
  return <TelaCadastros papel="transportadora" />;
}
