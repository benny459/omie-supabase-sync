"use client";
// Pagamento antecipado de PC (06/10/26). Diálogo curto, sem abrir o pedido:
// valor (total ou parcial), data, Pix/TED com os dados do cadastro do fornecedor,
// conta pagadora. Cria um título a pagar ligado ao PC (nº "PC 7356-ANT"); as
// previsões do PC são abatidas pelo valor adiantado, então nada é pago duas vezes.
import { useEffect, useState } from "react";

type Dados = {
  pedido: { id: number; num: string; emp: string; forn?: string; valor: number; aprov?: string; cat?: string; catCod?: string; contaCod?: number; proj?: string; pv?: string };
  adiantado: number; titulos: { id: number; documento: string; valor: number; vencimento: string; pago: boolean }[];
  pessoa_id: number | null;
  pagamento: { pix_tipo?: string | null; pix_chave?: string | null; banco_compe?: string | null; agencia?: string | null; conta?: string | null; conta_tipo?: string | null } | null;
  contas: { cod_cc: number; descricao: string }[]; bancos: { compe: string; nome: string }[]; hoje: string;
};
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const TIPOS_PIX = [["cnpj", "CNPJ"], ["cpf", "CPF"], ["email", "E-mail"], ["telefone", "Telefone"], ["aleatoria", "Chave aleatória"]] as const;

/** Próximo dia útil (sáb/dom → segunda), em YYYY-MM-DD. */
function diaUtil(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function PagamentoAntecipado({ pedidoId, numero, empresa, fechar, feito }: {
  pedidoId?: number; numero?: string; empresa?: string; fechar: () => void; feito?: (msg: string) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [valor, setValor] = useState(""); const [data, setData] = useState("");
  const [forma, setForma] = useState<"PIX" | "TED">("PIX");
  const [pixTipo, setPixTipo] = useState("cnpj"); const [pixChave, setPixChave] = useState("");
  const [banco, setBanco] = useState(""); const [agencia, setAgencia] = useState(""); const [conta, setConta] = useState("");
  const [contaTipo, setContaTipo] = useState("corrente");
  const [cc, setCc] = useState(""); const [obs, setObs] = useState(""); const [salvarCad, setSalvarCad] = useState(true);

  useEffect(() => {
    const q = pedidoId ? `pedido=${pedidoId}` : `numero=${encodeURIComponent(numero ?? "")}${empresa ? `&emp=${empresa}` : ""}`;
    fetch(`/api/compras/antecipado?${q}`, { cache: "no-store" }).then((r) => r.json()).then((j: Dados & { error?: string }) => {
      if (j.error) { setErro(j.error); return; }
      setD(j);
      const saldo = Math.max(0, Math.round((j.pedido.valor - j.adiantado) * 100) / 100);
      setValor(saldo.toFixed(2).replace(".", ","));
      setData(diaUtil(j.hoje));
      const pg = j.pagamento ?? {};
      if (pg.pix_chave) { setForma("PIX"); setPixTipo(pg.pix_tipo || "cnpj"); setPixChave(pg.pix_chave); }
      else if (pg.banco_compe && pg.conta) setForma("TED");
      setBanco(pg.banco_compe ?? ""); setAgencia(pg.agencia ?? ""); setConta(pg.conta ?? ""); setContaTipo(pg.conta_tipo || "corrente");
      if (j.pedido.contaCod) setCc(String(j.pedido.contaCod));
    }).catch((e) => setErro(String(e)));
  }, [pedidoId, numero, empresa]);

  const saldo = d ? Math.max(0, d.pedido.valor - d.adiantado) : 0;
  const v = num(valor);
  const aprovado = d?.pedido.aprov === "aprovado";

  async function confirmar() {
    if (!d) return;
    setOcupado(true); setErro(null);
    const r = await fetch("/api/compras/antecipado", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedido_id: d.pedido.id, valor: v, data, forma, conta_cod: Number(cc) || null, obs: obs || null,
        pix_tipo: forma === "PIX" ? pixTipo : null, pix_chave: forma === "PIX" ? pixChave.trim() : null,
        banco_compe: forma === "TED" ? banco : null, agencia: forma === "TED" ? agencia : null, conta: forma === "TED" ? conta : null,
        conta_tipo: forma === "TED" ? contaTipo : null, pessoa_id: d.pessoa_id, salvar_cadastro: salvarCad }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    feito?.(`Pagamento antecipado lançado: ${r.documento} · ${brl(v)} — já está no Contas a Pagar (e na remessa C6).`);
    fechar();
  }

  return (
    <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", zIndex: 120 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="card2" role="dialog" aria-modal="true" aria-label="Pagamento antecipado"
        style={{ width: "min(560px,94vw)", display: "grid", gap: 12, maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <b style={{ fontSize: 16 }}>💸 Pagamento antecipado{d ? ` — PC ${d.pedido.num}` : ""}</b>
          <button className="btn sm" onClick={fechar}>Fechar ✕</button>
        </div>
        {!d && !erro && <span className="faint">Carregando…</span>}
        {d && <>
          <div style={{ fontSize: 13 }}>
            <b>{d.pedido.forn}</b>
            <div className="faint">PC {brl(d.pedido.valor)}{d.adiantado > 0 ? ` · já adiantado ${brl(d.adiantado)} · saldo ${brl(saldo)}` : ""}
              {d.pedido.proj ? ` · ${d.pedido.proj}` : ""}{d.pedido.pv ? ` · ${d.pedido.pv}` : ""}</div>
            {!aprovado && <div style={{ color: "var(--danger,#EF4444)", marginTop: 4 }}>PC ainda não aprovado — aprove antes de antecipar.</div>}
          </div>
          {d.titulos.length > 0 && (
            <div className="faint" style={{ fontSize: 12 }}>
              {d.titulos.map((t) => <div key={t.id}>{t.documento} · {brl(Number(t.valor))} · {t.vencimento.split("-").reverse().join("/")} · {t.pago ? "pago" : "a pagar"}</div>)}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label className="f"><span>Valor (R$)</span>
              <input className="in" id="antValor" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
              <span className="faint" style={{ fontSize: 11.5 }}>
                <button type="button" className="linkbtn" onClick={() => setValor(saldo.toFixed(2).replace(".", ","))}>saldo</button>{" · "}
                <button type="button" className="linkbtn" onClick={() => setValor((Math.round(saldo * 50) / 100).toFixed(2).replace(".", ","))}>50%</button>
              </span></label>
            <label className="f"><span>Data do pagamento</span>
              <input className="in" id="antData" type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["PIX", "TED"] as const).map((f) => (
              <button key={f} type="button" className={`btn sm${forma === f ? " pri" : ""}`} onClick={() => setForma(f)}>{f === "PIX" ? "Pix" : "TED / depósito"}</button>))}
          </div>
          {forma === "PIX" ? (
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10 }}>
              <label className="f"><span>Tipo de chave</span>
                <select className="in" id="antPixTipo" value={pixTipo} onChange={(e) => setPixTipo(e.target.value)}>
                  {TIPOS_PIX.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="f"><span>Chave Pix do fornecedor</span>
                <input className="in" id="antPixChave" value={pixChave} onChange={(e) => setPixChave(e.target.value)} placeholder="CNPJ, e-mail, telefone ou chave" /></label>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr 1fr .9fr", gap: 10 }}>
              <label className="f"><span>Banco</span>
                <select className="in" id="antBanco" value={banco} onChange={(e) => setBanco(e.target.value)}>
                  <option value="">—</option>{d.bancos.map((b) => <option key={b.compe} value={b.compe}>{b.compe} · {b.nome}</option>)}</select></label>
              <label className="f"><span>Agência</span><input className="in" id="antAg" value={agencia} onChange={(e) => setAgencia(e.target.value)} /></label>
              <label className="f"><span>Conta</span><input className="in" id="antConta" value={conta} onChange={(e) => setConta(e.target.value)} /></label>
              <label className="f"><span>Tipo</span>
                <select className="in" id="antContaTipo" value={contaTipo} onChange={(e) => setContaTipo(e.target.value)}>
                  <option value="corrente">Corrente</option><option value="poupanca">Poupança</option></select></label>
            </div>
          )}
          {d.pessoa_id && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={salvarCad} onChange={(e) => setSalvarCad(e.target.checked)} /> guardar no cadastro do fornecedor</label>}
          <label className="f"><span>Conta corrente pagadora</span>
            <select className="in" id="antCc" value={cc} onChange={(e) => setCc(e.target.value)}>
              <option value="">— escolha —</option>{d.contas.map((c) => <option key={c.cod_cc} value={c.cod_cc}>{c.descricao}</option>)}</select></label>
          <label className="f"><span>Observação (opcional)</span>
            <input className="in" id="antObs" value={obs} onChange={(e) => setObs(e.target.value)} /></label>
          <div className="faint" style={{ fontSize: 12 }}>
            Nº do documento: <b>PC {d.pedido.num}-ANT</b> · categoria {d.pedido.cat || d.pedido.catCod || "do PC"}. O título entra no Contas a Pagar e pode ir no
            arquivo C6. Quando a NF do pedido chegar, a previsão do PC já desconta o que foi adiantado. Pago = depois da baixa/conciliação.
          </div>
        </>}
        {erro && <div style={{ color: "var(--danger,#EF4444)", fontSize: 13 }}>{erro}</div>}
        {d && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={fechar}>Cancelar</button>
            <button className="btn pri" disabled={ocupado || !aprovado || v <= 0 || v > saldo + 0.01 || !cc || !data}
              onClick={confirmar}>{ocupado ? "Lançando…" : `Lançar pagamento antecipado · ${brl(v)}`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
