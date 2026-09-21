// /projetos/[codigo]/fechamento — o resumo do fechamento vindo do CRM.
// Acessada pelo botão "Fechamento CRM" no bucket do /projetos. Mostra o que
// foi confirmado ao ganhar a proposta linkada a este projeto e oferece o
// CP/MC Excel para download — é a porta da engenharia de planejamento, sem
// precisar de acesso ao CRM.

import Link from "next/link";
import { fetchFechamentosDoProjeto, cpmcExiste, type FechamentoCrm } from "@/lib/crm-fechamento";
import CartaoFechamento from "@/components/projeto/CartaoFechamentoCrm";

export const dynamic = "force-dynamic";

type Params = { codigo: string };

export default async function ProjetoFechamentoPage({ params }: { params: Promise<Params> }) {
  const { codigo } = await params;
  const codigoProjeto = Number(codigo);
  if (!Number.isFinite(codigoProjeto) || codigoProjeto <= 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-rose-700">Código de projeto inválido.</p>
        <Link href="/projetos" className="text-sky-700 underline text-sm">← Voltar para Projetos</Link>
      </div>
    );
  }

  let fechamentos: FechamentoCrm[] = [];
  let erro = "";
  try {
    fechamentos = await fetchFechamentosDoProjeto(codigoProjeto);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  const existencia = await Promise.all(fechamentos.map((f) => cpmcExiste(f.cpmcUrl)));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold">Fechamento do CRM</h1>
          <p className="text-[12px] text-ww-muted">
            O que foi confirmado ao ganhar a proposta linkada a este projeto — e o CP/MC Excel para o planejamento.
          </p>
        </div>
        <Link href="/projetos" className="text-sky-700 dark:text-sky-300 underline text-sm">← Voltar para Projetos</Link>
      </div>

      {erro && (
        <div className="border border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 rounded-md px-4 py-3 text-[13px]">
          Não consegui falar com o CRM: {erro}
        </div>
      )}
      {!erro && !fechamentos.length && (
        <div className="border border-ww-border bg-ww-panel rounded-md px-4 py-4 text-[13px] text-ww-muted">
          Nenhuma proposta do CRM está linkada a este projeto ainda. O link é
          feito no CRM, no <strong>resumo do fechamento</strong> da proposta
          (campo &quot;Projeto no painel&quot;) — feito isso, o resumo e o
          download aparecem aqui na hora.
        </div>
      )}
      {fechamentos.map((f, i) => (
        <CartaoFechamento key={f.numero} f={f} temCpmc={existencia[i]} />
      ))}
    </div>
  );
}
