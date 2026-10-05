import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/require-area";
import Ficha360 from "@/components/cadastros/Ficha360";

export const dynamic = "force-dynamic";

/* Cadastros › Ficha 360 do cliente/fornecedor (05/10/26): todas as empresas do grupo, secções carregadas à vez. */
export default async function FichaCadastroPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("erp");
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  return <Suspense><Ficha360 id={id} /></Suspense>;
}
