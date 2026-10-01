import { requireArea } from "@/lib/require-area";
import EstoqueView from "@/components/EstoqueView";
import TelaEstoqueNavy from "@/components/navy/tela/TelaEstoqueNavy";
import LinkClassica from "@/components/navy/tela/LinkClassica";

export const dynamic = "force-dynamic";

/* 30/09/26: tela Navy; a antiga em ?classica=1 para comparar.
   01/10/26: Estoque v2 — lista + ⌘K + ficha do item (/estoque/[codigo]); ?cliente= filtra pelos itens que o cliente usou. */
export default async function EstoquePage({ searchParams }: { searchParams: Promise<{ classica?: string; cliente?: string }> }) {
  await requireArea("erp");
  const { classica, cliente } = await searchParams;
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
