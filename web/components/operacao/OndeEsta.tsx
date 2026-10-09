"use client";

// "Onde está?" (09/10/26) — o vazio das telas da Operação deixa de ser só
// "Nada com estes filtros": diz onde o número procurado vive e leva até lá.
// 1) Na própria tela, fora dos filtros/aba atuais → botão "mostrar".
// 2) Noutra tela da Operação → link que abre a tela já com a busca.
// 3) Em lugar nenhum → diz isso (e se existe no Omie / Compras).

import { useEffect, useState } from "react";
import { TELA_LABEL, type RespostaOndeEsta, type TelaOp } from "@/lib/onde-esta";

export default function OndeEsta({ q, modulo, naTela, onMostrarTudo }: {
  q: string;
  modulo: TelaOp;
  /** Quantos cartões desta tela batem com a busca se tirar filtros, aba e ★ ativos. */
  naTela: number;
  onMostrarTudo: () => void;
}) {
  const termo = q.trim();
  const [resp, setResp] = useState<RespostaOndeEsta | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    setResp(null);
    if (termo.length < 2) return;
    let vivo = true;
    const t = setTimeout(() => {
      setCarregando(true);
      fetch(`/api/operacao/onde-esta?${new URLSearchParams({ q: termo, de: modulo })}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: RespostaOndeEsta | null) => { if (vivo) setResp(j); })
        .catch(() => { /* sem guia: fica o vazio de sempre */ })
        .finally(() => { if (vivo) setCarregando(false); });
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, modulo]);

  const caixa: React.CSSProperties = {
    margin: "12px auto", maxWidth: 720, padding: "14px 16px", textAlign: "left",
    border: "1px solid var(--ww-border, rgba(127,127,127,.3))", borderRadius: 10,
    background: "var(--ww-surface-2, transparent)", color: "var(--ww-text)", fontSize: 13, lineHeight: 1.5,
  };
  const outras = (resp?.achados ?? []).filter((a) => a.tela !== modulo);
  const daqui = (resp?.achados ?? []).filter((a) => a.tela === modulo);

  if (!termo) return null;
  return (
    <div data-onde-esta style={caixa}>
      {naTela > 0 && (
        <div style={{ marginBottom: outras.length ? 10 : 0 }}>
          <b>"{termo}" está nesta tela</b>, mas fora da aba/filtros atuais ({naTela} {naTela === 1 ? "resultado" : "resultados"}).{" "}
          <button className="linkbtn" onClick={onMostrarTudo}>Mostrar (aba Todos, sem filtros) →</button>
        </div>
      )}
      {outras.length > 0 && (
        <div>
          <b>Não está em {TELA_LABEL[modulo]} — está em outra tela:</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {outras.map((a) => (
              <li key={a.href + a.onde} style={{ margin: "3px 0" }}>
                {a.oQue} está em <b>{TELA_LABEL[a.tela]} › {a.onde}</b>
                {a.faturado ? " · faturado" : ""}
                {a.escondido ? " · escondido em \"PCs excluídos\"" : ""}{" "}
                <a href={a.href} className="linkbtn" style={{ whiteSpace: "nowrap" }}>Abrir em {TELA_LABEL[a.tela]} →</a>
              </li>
            ))}
          </ul>
          {resp?.mais && <div style={{ color: "var(--ww-text-faint)", fontSize: 12, marginTop: 4 }}>Há mais resultados — refine a busca.</div>}
          {modulo === "pcs" && (
            <div style={{ color: "var(--ww-text-faint)", fontSize: 12, marginTop: 6 }}>
              PCs standalone mostra só PCs sem PV/OS e sem projeto (PJ, 40_VS, 41_VP); os outros ficam em Vendas avulsas ou Projetos.
            </div>
          )}
        </div>
      )}
      {naTela === 0 && !outras.length && daqui.some((a) => a.escondido) && (
        <div>"{termo}" está nesta tela, mas escondido em <b>"PCs excluídos"</b> — reexiba-o por lá para voltar à lista.</div>
      )}
      {naTela === 0 && !outras.length && !daqui.some((a) => a.escondido) && (
        carregando || !resp ? (
          <div style={{ color: "var(--ww-text-faint)" }}>Procurando "{termo}" nas outras telas…</div>
        ) : daqui.length ? (
          <div>"{termo}" é desta tela, mas a lista ainda está carregando ou atualizando — espere alguns segundos ou recarregue a página.</div>
        ) : resp.fora ? (
          <div>
            {resp.fora.msg}
            {resp.fora.href && <> <a href={resp.fora.href} className="linkbtn">{resp.fora.hrefLabel ?? "Abrir"} →</a></>}
          </div>
        ) : null
      )}
    </div>
  );
}
