"use client";

// Casca com abas da "Visão Geral".
//
// A descoberta que reorganizou o porte: no Metabase esse dashboard tem 13 ABAS,
// e várias são exatamente os mesmos cards dos dashboards standalone — "Contratos
// CT" é 6/6 igual ao dashboard 6, "Margem" é 4/4 igual ao 7. Ou seja, a Visão
// Geral não é um dashboard de 115 cards: é uma composição de domínios que também
// existem sozinhos.
//
// Então portamos POR DOMÍNIO e a aba vem de graça — cada seção aqui é o mesmo
// componente da página standalone, sem duplicar query nem view.
//
// Cada aba carrega seus próprios filtros de propósito: aba é um recorte
// diferente, e filtro compartilhado entre recortes que não conversam confunde
// mais do que ajuda.

import { useState } from "react";
import ContasReceberView from "./ContasReceberView";
import ContratosCtView from "./ContratosCtView";
import DreView from "./DreView";
import MargemProjetoView from "./MargemProjetoView";

type Aba = {
  key: string;
  label: string;
  /** Cards que a aba tinha no Metabase — referência de progresso. */
  cards: number;
  view?: React.ReactNode;
};

// Ordem e contagem conforme o Metabase (dashboard 2, tabela dashboard_tab).
const ABAS: Aba[] = [
  { key: "dre",        label: "DRE",              cards: 6,  view: <DreView /> },
  { key: "contratos",  label: "Contratos CT",     cards: 6,  view: <ContratosCtView /> },
  { key: "margem",     label: "Margem",           cards: 4,  view: <MargemProjetoView /> },
  { key: "geral",      label: "Visão Geral",      cards: 14 },
  { key: "faturamento",label: "Faturamento",      cards: 21 },
  { key: "receber",    label: "A Receber",        cards: 25, view: <ContasReceberView /> },
  { key: "pagar",      label: "A Pagar",          cards: 15 },
  { key: "compras",    label: "Compras",          cards: 14 },
  { key: "vendas",     label: "Vendas",           cards: 10 },
  { key: "atraso",     label: "Atraso",           cards: 4 },
  { key: "previsao",   label: "Previsão Receb.",  cards: 6 },
  { key: "aquisicao",  label: "Aquisição vs Rec.",cards: 5 },
  { key: "crm",        label: "CRM",              cards: 1 },
];

export default function VisaoGeralTabs() {
  const [ativa, setAtiva] = useState(ABAS[0].key);
  const aba = ABAS.find((a) => a.key === ativa)!;
  const prontas = ABAS.filter((a) => a.view);
  const cardsProntos = prontas.reduce((n, a) => n + a.cards, 0);
  const cardsTotal = ABAS.reduce((n, a) => n + a.cards, 0);

  return (
    <div className="min-w-0">
      {/* Progresso honesto: aba sem view aparece marcada, não escondida — some
          uma aba e o leitor acha que o dado não existe. */}
      <p className="text-[11px] text-ww-textFaint mb-2">
        {prontas.length} de {ABAS.length} abas portadas · {cardsProntos} de {cardsTotal} cards
      </p>

      <div className="flex flex-wrap gap-1 mb-3 border-b border-ww-border pb-2">
        {ABAS.map((a) => {
          const on = a.key === ativa;
          const pronta = !!a.view;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => setAtiva(a.key)}
              className={`px-2.5 py-1 text-[11.5px] rounded-md transition inline-flex items-center gap-1.5 ${
                on ? "bg-ww-accentSoft text-ww-accent font-bold"
                   : "text-ww-textMuted hover:bg-ww-rowHover"
              }`}
            >
              {a.label}
              {!pronta && (
                <span className="text-[9px] px-1 rounded bg-ww-border text-ww-textFaint font-semibold">
                  {a.cards}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {aba.view ?? (
        <div className="bg-ww-panel border border-ww-border rounded-lg p-6 text-center">
          <p className="text-[13px] font-semibold text-ww-text">Aba ainda não portada</p>
          <p className="text-[11.5px] text-ww-textMuted mt-1">
            “{aba.label}” tem {aba.cards} cards no Metabase. Enquanto não estiver aqui, use o
            dashboard equivalente no Metabase — ele segue no ar.
          </p>
        </div>
      )}
    </div>
  );
}
