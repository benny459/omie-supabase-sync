import { redirect } from "next/navigation";

// A tela de "Faturamento → Recebimento" foi fundida em /bi/faturamento — é o
// mesmo dinheiro visto em dois momentos, e mantê-las separadas obrigava a
// procurar o documento de uma lista na outra.
//
// O redirect fica no lugar da página: links salvos, abas abertas e a memória
// muscular de quem já usava continuam funcionando. Remover a rota daria 404 sem
// explicar pra onde o conteúdo foi.
export default function RecebimentoPage() {
  redirect("/bi/faturamento");
}
