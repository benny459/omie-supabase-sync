import Link from "next/link";
import { requireArea } from "@/lib/require-area";
import TitulosView from "@/components/TitulosView";
import TelaTitulosNavy from "@/components/navy/tela/TelaTitulosNavy";

export const dynamic = "force-dynamic";

/* Desde 30/09/26 a tela é a recriação Navy (protótipo "Painel Allka finance").
   A antiga continua em ?classica=1 para comparar lado a lado — a Navy traz
   todos os campos dela, e é aí que se confere. */
export default async function ContasPagarPage({ searchParams }: { searchParams: Promise<{ classica?: string }> }) {
  await requireArea("erp");
  const { classica } = await searchParams;

  if (classica) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Contas a Pagar</h1>
            <p className="text-[12px] text-ww-textMuted mt-0.5">
              Títulos do Omie espelhados aqui. Todas as empresas; status calculado pelo Omie.
            </p>
          </div>
          <Link href="/financeiro/pagar" className="text-[12px] text-ww-accent underline underline-offset-2">Ver tela nova</Link>
        </div>
        <TitulosView tipo="pagar" />
      </div>
    );
  }

  return (
    <>
      <TelaTitulosNavy tipo="pagar" />
      <div style={{ textAlign: "right", marginTop: -36, fontSize: 12 }}>
        <Link href="/financeiro/pagar?classica=1" style={{ color: "var(--ww-text-faint)", textDecoration: "underline" }}>tela clássica</Link>
      </div>
    </>
  );
}
