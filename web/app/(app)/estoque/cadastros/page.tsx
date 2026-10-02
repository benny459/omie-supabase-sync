import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/* "Cadastros" virou "Catálogo" em 02/10/26 — links antigos continuam funcionando. */
export default async function CadastrosPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba } = await searchParams;
  redirect(`/estoque/catalogo${aba ? `?aba=${encodeURIComponent(aba)}` : ""}`);
}
