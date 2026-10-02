"use client";

/** "3043002 → hoje F0012 · <descrição atual>" — só quando o código mudou.
 *  Clique abre a ficha do item de hoje no Estoque. O código do documento fica como está. */

import { useEffect, useState } from "react";
import { resolverCodigo, codigoMudou, type CodigoHojeInfo } from "@/lib/codigos-client";

export default function CodigoHoje({ cod, desc = true }: { cod: string | null | undefined; desc?: boolean }) {
  const [i, setI] = useState<CodigoHojeInfo | null>(null);
  useEffect(() => { let vivo = true; resolverCodigo(cod).then((x) => { if (vivo) setI(x); }); return () => { vivo = false; }; }, [cod]);
  if (!codigoMudou(cod, i)) return null;
  const alvo = i!.codigo_atual ?? String(i!.n_cod_prod_atual);
  return (
    <a className="cod-hoje" href={`/estoque/${encodeURIComponent(alvo)}`} target="_blank" rel="noopener noreferrer"
      title={`${i!.mudou_de_item ? "Item mesclado em outro" : "Código mudou"} — abrir a ficha do item de hoje`}
      onClick={(e) => e.stopPropagation()}>
      <span className="mono">{cod}</span> → hoje <b className="mono">{alvo}</b>{desc && i!.descricao_atual ? <> · {i!.descricao_atual}</> : null}
    </a>
  );
}
