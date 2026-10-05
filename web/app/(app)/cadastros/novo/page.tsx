import { Suspense } from "react";
import { requireArea } from "@/lib/require-area";
import FormPessoa from "@/components/cadastros/FormPessoa";

export const dynamic = "force-dynamic";

/* Cadastros › Novo cliente/fornecedor (05/10/26). ?papel=cliente|fornecedor&emp=&doc=&razao= pré-preenchem. */
export default async function NovoCadastroPage() {
  await requireArea("erp");
  return <Suspense><FormPessoa /></Suspense>;
}
