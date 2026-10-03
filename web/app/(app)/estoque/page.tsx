import { redirect } from "next/navigation";
import { requirePermissao } from "@/lib/require-area";
import EstoqueView from "@/components/EstoqueView";
import TelaEstoqueNavy from "@/components/navy/tela/TelaEstoqueNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";

export const dynamic = "force-dynamic";

/* Links antigos (?aba=) das abas que viraram rotas em 02/10/26. */
const ABAS: Record<string, string> = {
  dups: "/estoque/duplicidades", duplicidades: "/estoque/duplicidades",
  movs: "/estoque/movimentacao", movimentacao: "/estoque/movimentacao",
  inv: "/estoque/inventario", inventario: "/estoque/inventario",
  cadastros: "/estoque/catalogo", catalogo: "/estoque/catalogo",
};

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar.
   01/10/26: Estoque v2 — lista + ⌘K + ficha do item (/estoque/[codigo]); ?cliente= filtra pelos itens que o cliente usou.
   02/10/26: Itens · Cadastros · Movimentação · Inventário · Duplicidades na 2ª linha do menu. */
export default async function EstoquePage({ searchParams }: { searchParams: Promise<{ classica?: string; cliente?: string; aba?: string }> }) {
  await requirePermissao("estoque.acesso");
  const { classica, cliente, aba } = await searchParams;
  if (aba && ABAS[aba]) redirect(ABAS[aba]);
  if (!classica) return (<><TelaEstoqueNavy clienteInicial={cliente ?? null} /><LinkClassica href="/estoque?classica=1" /></>);

  return (
    <div className="space-y-4">
      <LinkClassica href="/estoque" novo />
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Estoque</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Posição e movimentação espelhadas do Omie. Clique num produto pra ver o Kardex.
        </p>
      </div>
      <EstoqueView />
    </div>
  );
}
