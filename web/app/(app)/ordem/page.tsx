// /ordem — Central de Ordem ("Meu dia") e /ordem?m=<módulo> — a aba "Central de Ordem" de cada módulo.
// Quem vê o quê decide-se no servidor (/api/ordem, lib/ordem/acesso.ts); enquanto o
// administrador não liga a Central, só ele a vê (pré-visualização).
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { loadPerms } from "@/lib/require-area";
import CentralOrdem from "@/components/ordem/CentralOrdem";

export const dynamic = "force-dynamic";

export default async function OrdemPage() {
  const perms = await loadPerms();
  if (!perms) redirect("/login");
  return (
    <Suspense fallback={null}>
      <CentralOrdem />
    </Suspense>
  );
}
