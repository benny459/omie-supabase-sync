import { redirect } from "next/navigation";
import { requirePermissao } from "@/lib/require-area";
import { permissoesDe } from "@/lib/acessos";
import TelaFluxoFin from "@/components/financeiro/TelaFluxoFin";

export const dynamic = "force-dynamic";

/* Fluxo de Caixa do Financeiro (08/10/26 — financeiro-fluxo-v3). A visão BI de
   escopo fixo continua em /bi/financeiro; esta é a operacional, por empresa.
   Quem vê: "Ver fluxo de caixa" + ver contas a pagar ou a receber. */
export default async function FluxoCaixaPage() {
  const perms = await requirePermissao("financeiro.ver_fluxo");
  const pode = await permissoesDe(perms);
  if (!pode["financeiro.ver_pagar"] && !pode["financeiro.ver_receber"]) redirect("/");
  return <TelaFluxoFin podeEditar={!!pode["financeiro.editar_titulo"]} />;
}
