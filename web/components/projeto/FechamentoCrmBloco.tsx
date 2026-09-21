"use client";
// O fechamento do CRM dentro do workspace do projeto: o que a proposta
// combinou com o cliente é a premissa de tudo o que esta tela acompanha, e
// estava numa página à parte — quem abria o projeto tinha de saber que ela
// existia. Aqui aparece no Resumo, junto do resto.
import { useEffect, useState } from "react";
import CartaoFechamento from "./CartaoFechamentoCrm";
import type { FechamentoCrm } from "@/lib/crm-fechamento";

export default function FechamentoCrmBloco({ codigoProjeto, onCarregado }: {
  codigoProjeto: number; onCarregado?: (tem: boolean) => void;
}) {
  const [dados, setDados] = useState<{ fechamentos: FechamentoCrm[]; temCpmc: boolean[] } | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`/api/crm-fechamento?codigo=${codigoProjeto}`, { cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) { setErro(String(j?.error || r.status)); onCarregado?.(false); }
        else { setDados(j); onCarregado?.((j?.fechamentos?.length ?? 0) > 0); }
      } catch (e) { if (vivo) { setErro(e instanceof Error ? e.message : String(e)); onCarregado?.(false); } }
    })();
    return () => { vivo = false; };
  }, [codigoProjeto, onCarregado]);

  if (erro) {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-[12px] text-amber-800 dark:text-amber-200">
        Não consegui ler o fechamento no CRM: {erro}
      </div>
    );
  }
  if (!dados) {
    return <div className="text-[12px] text-ww-textMuted px-1">Lendo o fechamento no CRM…</div>;
  }
  /* Sem proposta linkada não há o que mostrar — e o aviso de como linkar
     pertence a quem foi procurar a página, não a quem abriu o projeto. */
  if (!dados.fechamentos.length) return null;

  return (
    <div className="space-y-3">
      {dados.fechamentos.map((f, i) => (
        <CartaoFechamento key={f.numero} f={f} temCpmc={dados.temCpmc[i]} />
      ))}
    </div>
  );
}
