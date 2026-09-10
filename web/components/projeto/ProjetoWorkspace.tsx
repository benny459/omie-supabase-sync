"use client";

// A tela do projeto, com tudo no mesmo lugar.
//
// ── O que estava espalhado ───────────────────────────────────────────────────
// Materiais era uma sub-página; Fluxo Financeiro era um modal de upload no
// bucket do /projetos; Escopo, outro modal. Três portas para o mesmo projeto,
// e nenhuma delas mostrava o que a outra sabia — dava para aprovar compra sem
// nunca ter visto o plano de caixa, porque o plano vivia atrás de outro botão.
//
// Agora é uma tela com abas. A ordem não é arbitrária: Fluxo primeiro porque é
// ele que destrava a aprovação das compras, e é a pergunta que traz a maioria
// das pessoas aqui.

import { useCallback, useState } from "react";
// RcProjetoItensBlock não é mais montado — a lista virou uma tabela só.
// O arquivo continua no repositório caso falte alguma função dele.
import RcProjetoUploadButton from "@/components/RcProjetoUploadButton";
import FluxoFinanceiroUploadButton from "@/components/FluxoFinanceiroUploadButton";
import FluxoProjetoView from "./FluxoProjetoView";
import MateriaisGrade from "./MateriaisGrade";

type Aba = "fluxo" | "materiais";

const ABAS = [
  { k: "fluxo" as const, label: "Fluxo financeiro",
    dica: "o previsto do projeto, a aprovação e o confronto com o caixa",
    ponto: "bg-sky-500",
    on:  "bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold ring-1 ring-sky-500/45 shadow-sm",
    off: "text-ww-textMuted hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-500/[0.08]" },
  { k: "materiais" as const, label: "Lista de materiais",
    dica: "itens do projeto, vínculo com PC e status de recebimento",
    ponto: "bg-emerald-500",
    on:  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold ring-1 ring-emerald-500/45 shadow-sm",
    off: "text-ww-textMuted hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/[0.08]" },
];

export default function ProjetoWorkspace({
  empresa, codigoProjeto, nomeProjeto, abaInicial = "fluxo",
}: {
  empresa: string; codigoProjeto: number; nomeProjeto?: string; abaInicial?: Aba;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  /** Sobe a cada gravação de materiais: o bloco de itens carrega no mount, e
   *  remontar é o jeito mais simples de ele refletir o que acabou de ser
   *  gravado sem duplicar a lógica de fetch. */
  const [chave, setChave] = useState(0);

  const aposGravar = useCallback(() => {
    setChave((k) => k + 1);
    // O card lateral de budget vive em outra tela e escuta este canal.
    try {
      const ch = new BroadcastChannel("budget-updated");
      ch.postMessage({ empresa, codigoProjeto, at: Date.now() });
      ch.close();
    } catch { /* Safari antigo sem BroadcastChannel */ }
  }, [empresa, codigoProjeto]);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel/80 backdrop-blur-sm border border-ww-border rounded-xl px-2.5 py-2 shadow-sm">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-ww-bg/60 border border-ww-border/60">
          {ABAS.map(({ k, label, dica, ponto, on, off }) => (
            <button key={k} type="button" onClick={() => setAba(k)} title={dica}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] rounded-md transition-all duration-150 ${
                aba === k ? on : off}`}>
              <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${ponto} ${
                aba === k ? "opacity-100" : "opacity-45"}`} />
              {label}
            </button>
          ))}
        </div>

        {/* A planilha continua existindo — virou UM dos caminhos, não a porta.
            Fica ao lado da aba a que pertence pra não parecer ação global. */}
        <div className="ml-auto flex items-center gap-2">
          {aba === "materiais"
            ? <RcProjetoUploadButton empresa={empresa} codigoProjeto={codigoProjeto} onDone={aposGravar} />
            : <FluxoFinanceiroUploadButton empresa={empresa} codigoProjeto={codigoProjeto} />}
        </div>
      </div>

      {aba === "fluxo" && (
        <FluxoProjetoView empresa={empresa} codigoProjeto={codigoProjeto} nomeProjeto={nomeProjeto} />
      )}

      {/* UMA tabela. Antes havia duas com os mesmos itens — a grade para
          escrever e um bloco abaixo para acompanhar — e o leitor tinha que
          descobrir qual mandava. O acompanhamento (fornecedor, previsão,
          status) virou coluna na própria linha do item, junto com o budget, a
          exportação e o vínculo em lote que só existiam no bloco antigo.
          RcProjetoItensBlock continua no repositório, sem uso, caso falte algo. */}
      {aba === "materiais" && (
        <MateriaisGrade key={`mat-${chave}`} empresa={empresa}
          codigoProjeto={codigoProjeto} onGravado={aposGravar} />
      )}
    </div>
  );
}
