import { Suspense } from "react";
import { redirect } from "next/navigation";
import TelaConferenciaCorte from "@/components/navy/tela/TelaConferenciaCorte";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/* Conferência do corte financeiro (05/10/26): DRE e saldos nativos × Omie. */
export default async function ConferenciaCortePage() {
  const perms = await loadPerms();
  if (!perms) redirect("/login");
  if (!canViewArea(perms, "bi") && !canViewArea(perms, "financeiro")) redirect("/");
  return <Suspense><TelaConferenciaCorte /></Suspense>;
}
