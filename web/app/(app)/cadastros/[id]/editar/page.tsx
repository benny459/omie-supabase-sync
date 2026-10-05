import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/require-area";
import FormPessoa from "@/components/cadastros/FormPessoa";

export const dynamic = "force-dynamic";

/* Cadastros › Editar cliente/fornecedor (05/10/26). */
export default async function EditarCadastroPage({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("erp");
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  return <Suspense><FormPessoa id={id} /></Suspense>;
}
