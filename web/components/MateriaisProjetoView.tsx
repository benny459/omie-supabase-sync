"use client";

// Wrapper client-side da sub-página /projetos/:codigo/materiais.
// Foca em UMA coisa: controle de materiais (Lista RC em abas por equipamento).
// Fluxo Financeiro e Etapas do Projeto vivem no /projetos principal (bucket
// header + dot Cronograma). Sub-página fica enxuta pra evitar redundância.

import { useCallback, useState } from "react";
import RcProjetoItensBlock from "./RcProjetoItensBlock";
import RcProjetoUploadButton from "./RcProjetoUploadButton";

export default function MateriaisProjetoView({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  // Muda esta chave depois de cada upload → forces RcProjetoItensBlock a
  // remontar e refetchar (o bloco usa useEffect no mount pra carregar dados).
  const [refreshKey, setRefreshKey] = useState(0);
  const onUploadDone = useCallback(() => {
    setRefreshKey((k) => k + 1);
    // Lista RC muda itens que afetam Total lançado/Aprovado no card lateral.
    try {
      const ch = new BroadcastChannel("budget-updated");
      ch.postMessage({ empresa, codigoProjeto, at: Date.now() });
      ch.close();
    } catch { /* Safari <15 sem BroadcastChannel */ }
  }, [empresa, codigoProjeto]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <RcProjetoUploadButton empresa={empresa} codigoProjeto={codigoProjeto} onDone={onUploadDone} />
      </div>
      <RcProjetoItensBlock key={`rc-${refreshKey}`} empresa={empresa} codigoProjeto={codigoProjeto} />
    </div>
  );
}
