import { redirect } from "next/navigation";

// A recriação Navy virou a tela principal em 30/09/2026 (BoldAvulsosView com as
// vistas Lista · Linha do tempo · Tabela · Kanban · Edição). O endereço antigo
// continua a levar ao sítio certo.
export default function AvulsosNavyPage() {
  redirect("/avulsos");
}
