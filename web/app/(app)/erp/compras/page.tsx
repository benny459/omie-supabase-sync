import Link from "next/link";
import { requireArea } from "@/lib/require-area";
import ErpListaView from "@/components/ErpListaView";
import TelaCompras from "@/components/compras/TelaCompras";

export const dynamic = "force-dynamic";

/* Desde 01/10/2026 Compras é a tela do mockup (Kanban/Tabela, folha do
   pedido, requisição ⇄ pedido, NF pela Focus): o pedido nasce e vive no
   painel (schema compras). A lista antiga — espelho do Omie — continua em
   ?classica=1 para comparar. */
export default async function ErpComprasPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("erp");
  const { classica } = await searchParams;

  if (classica) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Compras — PC / RC</h1>
            <p className="text-[12px] text-ww-textMuted mt-0.5">
              Pedidos e requisições de compra espelhados do Omie, com etapa, recebimento e vínculo
              PV/OS (⚙ = vínculo por triangulação automática). Clique pra ver os itens.
            </p>
          </div>
          <Link href="/erp/compras" className="text-[12px] text-ww-accent underline underline-offset-2">Ver tela nova</Link>
        </div>
        <ErpListaView modulo="compras" />
      </div>
    );
  }

  return (
    <>
      <TelaCompras />
      <div style={{ textAlign: "right", marginTop: 8, fontSize: 12 }}>
        <Link href="/erp/compras?classica=1" style={{ color: "var(--ww-text-faint)", textDecoration: "underline" }}>tela clássica</Link>
      </div>
    </>
  );
}
