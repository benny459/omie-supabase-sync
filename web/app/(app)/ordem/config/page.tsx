// /ordem/config — configuração da Central de Ordem (só administrador).
import { redirect } from "next/navigation";
import { loadPerms } from "@/lib/require-area";
import ConfigOrdemTela from "@/components/ordem/ConfigOrdem";

export const dynamic = "force-dynamic";

export default async function ConfigOrdemPage() {
  const perms = await loadPerms();
  if (!perms) redirect("/login");
  if (!perms.is_admin) redirect("/ordem");
  return <ConfigOrdemTela />;
}
