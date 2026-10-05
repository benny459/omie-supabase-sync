import { redirect } from "next/navigation";

/* Cadastros › Itens (05/10/26): o catálogo de itens é o do Estoque (códigos próprios). */
export default function ItensPage() {
  redirect("/estoque/catalogo");
}
