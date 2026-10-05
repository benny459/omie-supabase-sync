import Link from "next/link";
import { requirePermissao } from "@/lib/require-area";
import TitulosView from "@/components/TitulosView";
import TelaTitulosNavy from "@/components/navy/tela/TelaTitulosNavy";
import TelaReceberV1 from "@/components/financeiro/TelaReceberV1";

export const dynamic = "force-dynamic";

/* Desde 05/10/26 a tela é a v1 do mockup "contas-a-receber-v1" (previsão ×
   vencimento, situação de cobrança, histórico do cliente, receber/lote,
   cobrança, conciliação de créditos). A Navy de 30/09 fica em ?navy=1 e a
   antiga em ?classica=1. */
export default async function ContasReceberPage({ searchParams }: { searchParams: Promise<{ classica?: string; navy?: string }> }) {
  await requirePermissao("financeiro.ver_receber");
  const { classica, navy } = await searchParams;

  if (classica) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Contas a Receber</h1>
            <p className="text-[12px] text-ww-textMuted mt-0.5">
              Títulos do Omie espelhados aqui. Todas as empresas; status calculado pelo Omie.
            </p>
          </div>
          <Link href="/financeiro/receber" className="text-[12px] text-ww-accent underline underline-offset-2">Ver tela nova</Link>
        </div>
        <TitulosView tipo="receber" />
      </div>
    );
  }

  if (!navy) return <TelaReceberV1 />;

  return (
    <>
      <TelaTitulosNavy tipo="receber" />
      <div style={{ textAlign: "right", marginTop: -36, fontSize: 12 }}>
        <Link href="/financeiro/receber?classica=1" style={{ color: "var(--ww-text-faint)", textDecoration: "underline" }}>tela clássica</Link>
      </div>
    </>
  );
}
