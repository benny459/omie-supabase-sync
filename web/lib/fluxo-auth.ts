// Quem vê o Fluxo de Caixa (08/10/26): a chave própria (padrão: sim para a área ERP)
// + ver contas a pagar OU a receber.
import { NextResponse } from "next/server";
import { exigir } from "@/lib/financeiro-baixas";

export async function exigirFluxo() {
  const a = await exigir("financeiro.ver_fluxo");
  if (a instanceof NextResponse) return a;
  if (!a.pode["financeiro.ver_pagar"] && !a.pode["financeiro.ver_receber"]) {
    return NextResponse.json({ error: "Sem permissão (financeiro.ver_pagar ou ver_receber)" }, { status: 403 });
  }
  return a;
}
