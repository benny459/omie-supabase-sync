import { requireArea } from "@/lib/require-area";
import RelatoriosView from "@/components/RelatoriosView";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  // Esconder do menu não basta: sem isto a URL direta continua abrindo.
  await requireArea("vendas");

  return <RelatoriosView />;
}
