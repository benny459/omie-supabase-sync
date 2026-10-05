import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/require-area";
import FichaPessoa from "@/components/cadastros/FichaPessoa";

export const dynamic = "force-dynamic";

/* Cadastros › Ficha do cliente/fornecedor (05/10/26). */
export default async function FichaCadastroPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("erp");
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  return <Suspense><FichaPessoa id={id} /></Suspense>;
}
