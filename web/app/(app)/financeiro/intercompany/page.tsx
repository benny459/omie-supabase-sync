import { requirePermissao } from "@/lib/require-area";
import TelaIntercompany from "@/components/financeiro/TelaIntercompany";

export const dynamic = "force-dynamic";

export default async function IntercompanyPage() {
  await requirePermissao("financeiro.ver_pagar");
  return <TelaIntercompany />;
}
