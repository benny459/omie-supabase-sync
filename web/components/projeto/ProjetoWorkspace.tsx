"use client";

// A tela do projeto: três números fixos e seis abas.
//
// ── O que estava espalhado ───────────────────────────────────────────────────
// Materiais era uma sub-página; Fluxo Financeiro era um modal de upload no
// bucket do /projetos; Escopo, outro modal. Três portas para o mesmo projeto,
// e nenhuma delas mostrava o que a outra sabia — dava para aprovar compra sem
// nunca ter visto o plano de caixa, porque o plano vivia atrás de outro botão.
//
// ── E o que ficou espalhado depois ───────────────────────────────────────────
// Juntar tudo numa aba só resolveu o primeiro problema e criou outro: treze
// números em três faixas de cartões antes da primeira tabela, com a mesma
// aparência, e nada dizendo por onde começar.
//
// Agora os TRÊS números que definem o projeto — quanto fechei, quanto vou
// gastar, quanto sobra — ficam fixos acima das abas, porque são a pergunta que
// não muda de aba para aba. O resto virou um assunto por aba.
//
// ── Por que os KPIs carregam separado ────────────────────────────────────────
// Eles saem só do PLANO, que é tabela própria e responde rápido. O fluxo do
// Omie leva dezenas de segundos (a view de projetos não empurra o filtro).
// Carregar os dois juntos faria os três números esperarem por algo de que não
// precisam — e eles são o que a pessoa veio ver.

import { useCallback, useEffect, useState } from "react";
// RcProjetoItensBlock não é mais montado — a lista virou uma tabela só.
// O arquivo continua no repositório caso falte alguma função dele.
import RcProjetoUploadButton from "@/components/RcProjetoUploadButton";
import FluxoProjetoView, { type AbaProjeto } from "./FluxoProjetoView";
import MateriaisGrade from "./MateriaisGrade";
import FechamentoCrmBloco from "./FechamentoCrmBloco";
import { KpisProjeto } from "./ResumoProjeto";
import type { PlanoCompleto } from "./PlanoFechamento";

type Aba = "resumo" | "fluxo" | "materiais";

/* Três abas, não seis. As antigas "Condições comerciais", "Faturamento &
   recebimento" e "Compras / Omie" não eram assuntos separados: eram partes
   da mesma pergunta. Condições é a premissa do Resumo; faturamento e compras
   do Omie são os dois lados do Fluxo. Cada aba agora responde uma pergunta
   inteira, e o que se abre é uma tela só em vez de seis meias-telas. */
const ABAS: Array<{ k: Aba; label: string; dica: string; partes: AbaProjeto[] }> = [
  { k: "resumo",    label: "Resumo",
    dica: "o fechamento que veio do CRM, onde o dinheiro parou e as premissas do plano",
    partes: ["resumo", "condicoes"] },
  { k: "fluxo",     label: "Fluxo de caixa",
    dica: "plano, previsto e realizado no mesmo eixo — com o faturamento e as compras do Omie",
    partes: ["fluxo", "faturamento", "omie"] },
  { k: "materiais", label: "Lista de materiais",
    dica: "itens do projeto, vínculo com PC e status de recebimento",
    partes: [] },
];
export default function ProjetoWorkspace({
  empresa, codigoProjeto, nomeProjeto, abaInicial = "resumo",
}: {
  empresa: string; codigoProjeto: number; nomeProjeto?: string; abaInicial?: Aba;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);
  /** Sobe a cada gravação de materiais: o bloco de itens carrega no mount, e
   *  remontar é o jeito mais simples de ele refletir o que acabou de ser
   *  gravado sem duplicar a lógica de fetch. */
  const [chave, setChave] = useState(0);

  /** O plano, para os KPIs do topo. Leitura barata e independente do fluxo. */
  const [plano, setPlano] = useState<PlanoCompleto | null>(null);
  const carregarPlano = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/rc-projetos/plano?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      if (r.ok) setPlano((await r.json()) as PlanoCompleto);
    } catch { /* sem plano, os KPIs mostram traço */ }
  }, [empresa, codigoProjeto]);
  useEffect(() => { void carregarPlano(); }, [carregarPlano, chave]);

  /** O teto vigente. Aqui o manual não é conhecido (vive no payload do fluxo),
   *  então vale o do plano — e a aba Resumo, que tem os dois, corrige. */
  const cab = plano?.plano ?? null;
  const tetoPlano = cab
    ? Number(cab.custo_materiais ?? 0) + Number(cab.custo_mao_obra ?? 0)
      + Number(cab.custo_despesas ?? 0)
    : 0;

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
      {/* Os três números que não mudam de aba para aba. */}
      <KpisProjeto plano={plano} teto={tetoPlano > 0 ? tetoPlano : null}
        podeEditar={false} />

      {/* Abas como sublinhado, não como pílulas coloridas: seis pílulas com
          ponto de cor cada uma competiriam com os KPIs logo acima. A cor fica
          reservada ao que é dado. */}
      <div className="flex items-center gap-1 flex-wrap border-b border-ww-border">
        {ABAS.map(({ k, label, dica }) => (
          <button key={k} type="button" onClick={() => setAba(k)} title={dica}
            className={`px-3 py-2 text-[12px] -mb-px border-b-2 transition-colors ${
              aba === k
                ? "border-ww-accent text-ww-text font-semibold"
                : "border-transparent text-ww-textMuted hover:text-ww-text"}`}>
            {label}
          </button>
        ))}

        {/* Um upload por aba, e só. A aba Fluxo tinha DOIS botões de importar
            planilha, para arquivos diferentes; o import do fechamento passou a
            cobrir os dois e este ficou só em Materiais. */}
        {aba === "materiais" && (
          <div className="ml-auto pb-1.5">
            <RcProjetoUploadButton empresa={empresa} codigoProjeto={codigoProjeto} onDone={aposGravar} />
          </div>
        )}
      </div>

      {/* O fechamento do CRM abre o Resumo: é a premissa de tudo o que vem
          depois — o que foi vendido, quando fatura, o que se reservou para
          gastar — e o CP/MC para baixar. */}
      {aba === "resumo" && <FechamentoCrmBloco codigoProjeto={codigoProjeto} />}

      {aba !== "materiais" && (
        <FluxoProjetoView empresa={empresa} codigoProjeto={codigoProjeto}
          nomeProjeto={nomeProjeto}
          abas={ABAS.find((a) => a.k === aba)?.partes ?? ["resumo"]} />
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
