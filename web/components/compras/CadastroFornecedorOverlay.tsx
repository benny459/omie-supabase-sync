"use client";
/**
 * Cadastro do fornecedor aberto POR CIMA da folha do pedido de compra (06/10/26):
 * edita e-mails, contatos etc. e, ao fechar, a folha continua como estava
 * (alterações não salvas incluídas) e relê os dados do fornecedor.
 * Janela sólida (regra do vidro: o que fica por cima nunca é transparente).
 */
import { Suspense, useEffect, useState } from "react";
import FormPessoa from "@/components/cadastros/FormPessoa";

export default function CadastroFornecedorOverlay({ emp, fornCod, cnpj, nome, onFechar }: {
  emp: string; fornCod: number | null; cnpj?: string | null; nome?: string | null; onFechar: (salvou: boolean) => void;
}) {
  const [pessoaId, setPessoaId] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    const qs = new URLSearchParams({ emp, ...(fornCod ? { cod: String(fornCod) } : {}), ...(cnpj ? { cnpj } : {}) });
    fetch(`/api/compras/fornecedor-cadastro?${qs}`).then((r) => r.json()).then((j) => setPessoaId(j?.id ?? null)).catch(() => setPessoaId(null));
  }, [emp, fornCod, cnpj]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div role="presentation" onClick={() => onFechar(false)}
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(6,10,18,.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Cadastro do fornecedor" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1100px, 96vw)", maxHeight: "92vh", overflow: "auto", borderRadius: 14,
          background: "rgb(var(--color-ww-panel, 15 26 44))", color: "var(--ww-text, inherit)",
          border: "1px solid var(--ww-border-strong, #28395a)", boxShadow: "0 30px 80px rgba(0,0,0,.5)", padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <b>Cadastro do fornecedor{nome ? ` · ${nome}` : ""}</b>
          <span style={{ flex: 1 }} />
          {pessoaId && <a className="btn sm" href={`/cadastros/${pessoaId}`} target="_blank" rel="noreferrer">ficha completa ↗</a>}
          <button className="btn sm" onClick={() => onFechar(false)}>Fechar ✕</button>
        </div>
        {pessoaId === undefined && <div className="muted" style={{ padding: 16 }}>Abrindo o cadastro…</div>}
        {pessoaId === null && <div className="aviso" style={{ margin: 8 }}>Este fornecedor ainda não tem cadastro no painel.
          <a className="linkbtn" href={`/cadastros/novo?papel=fornecedor&emp=${emp}${cnpj ? `&doc=${encodeURIComponent(cnpj)}` : ""}${nome ? `&razao=${encodeURIComponent(nome)}` : ""}`} target="_blank" rel="noreferrer"> Cadastrar ↗</a></div>}
        {pessoaId && (
          <Suspense>
            <FormPessoa id={pessoaId} emOverlay={{ onSalvo: () => onFechar(true), onFechar: () => onFechar(false) }} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
