import { Suspense } from "react";
import { redirect } from "next/navigation";
import TelaRentabilidade from "@/components/navy/tela/TelaRentabilidade";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/* P6 (05/10/26): a cadeia de cada venda — PV/OS × compras × pago × recebido.
   Abre para quem vê BI ou Financeiro (a mesma regra da API). */
export default async function RentabilidadePage() {
  const perms = await loadPerms();
  if (!perms) redirect("/login");
  if (!canViewArea(perms, "bi") && !canViewArea(perms, "financeiro")) redirect("/");
  return <Suspense><TelaRentabilidade /></Suspense>;
}
