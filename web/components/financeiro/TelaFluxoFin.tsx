"use client";

/**
 * Fluxo de Caixa do Financeiro (08/10/26) — implantação do mockup
 * financeiro-fluxo-v3 (Benny). Fluxo POR EMPRESA com os bancos escolhidos
 * unificados, gráfico diário com zoom, cenários/simulador, dia a dia,
 * comparativo e demonstrativo. A marcação é a do mockup (fluxo-fin-markup.ts);
 * o comportamento vive em fluxo-fin-motor.ts, ligado a /api/financeiro/fluxo.
 * Clique num título em aberto da gaveta abre a edição; "lançar" um evento do
 * simulador abre o "+ Nova conta" já preenchido.
 */
import { useEffect, useRef, useState } from "react";
import EditarTituloModal from "./EditarTituloModal";
import NovoTituloModal from "../NovoTituloModal";
import { montarFluxo } from "./fluxo-fin-motor";
import { MARKUP_FLUXO } from "./fluxo-fin-markup";
import "./fluxo-fin.css";

type Lancar = { tipo: "pagar" | "receber"; empresa: string; valor: number; vencimento: string; obs: string; recorrencia: number };

export default function TelaFluxoFin({ podeEditar }: { podeEditar: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const motor = useRef<{ destruir: () => void; recarregar: () => void } | null>(null);
  const [editar, setEditar] = useState<string | null>(null);
  const [lancar, setLancar] = useState<Lancar | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = MARKUP_FLUXO;
    motor.current = montarFluxo({
      root: ref.current,
      podeEditar,
      onEditar: (r) => setEditar(r),
      onLancar: (x) => setLancar(x),
    });
    return () => motor.current?.destruir();
  }, [podeEditar]);

  return (
    <>
      <div className="ff1" ref={ref} />
      {editar && (
        <EditarTituloModal tipo={editar.startsWith("r:") ? "receber" : "pagar"} refTit={editar}
          onClose={() => setEditar(null)} onDone={() => { setEditar(null); motor.current?.recarregar(); }} />
      )}
      {lancar && (
        <NovoTituloModal tipo={lancar.tipo} inicial={lancar}
          onClose={() => setLancar(null)} onCreated={() => { setLancar(null); motor.current?.recarregar(); }} />
      )}
    </>
  );
}
