"use client";

/**
 * Conta recorrente (05/10/26, sql/73): mostra as ocorrências da série e deixa
 * editar "só esta", "esta e as próximas" ou "todas", encerrar a série ou
 * excluí-la (só sem pagamentos). Ocorrências já pagas nunca mudam.
 */
import { useEffect, useState } from "react";

type Oc = { id: string | number; seq: number; vencimento: string; previsao: string; valor: number; cancelado: boolean; pago: boolean };
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dbr = (iso: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—");

export default function SerieDialog({ serieId, refAtual, onClose, onDone }: { serieId: string; refAtual: string; onClose: () => void; onDone: () => void }) {
  const [oc, setOc] = useState<Oc[]>([]);
  const [regra, setRegra] = useState<Record<string, unknown>>({});
  const [encerrada, setEncerrada] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [escopo, setEscopo] = useState<"esta" | "proximas" | "todas">("proximas");
  const [valor, setValor] = useState("");
  const [venc, setVenc] = useState("");
  const [obs, setObs] = useState("");
  const [indo, setIndo] = useState(false);
  const idAtual = refAtual.replace(/^[pr]:/, "");

  async function carregar() {
    const r = await fetch(`/api/financeiro/series?id=${serieId}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error ?? "Erro"); return; }
    setOc(j.ocorrencias ?? []); setRegra(j.serie?.regra ?? {}); setEncerrada(j.serie?.encerrada_em ?? null);
    const atual = (j.ocorrencias ?? []).find((o: Oc) => String(o.id) === idAtual);
    if (atual) { setValor(String(atual.valor).replace(".", ",")); setVenc(atual.vencimento); }
  }
  useEffect(() => { carregar(); }, [serieId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: Record<string, unknown>, ok: string) {
    setIndo(true); setErro(""); setMsg("");
    const r = await fetch("/api/financeiro/series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serie_id: serieId, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErro(j.error ?? "Erro"); else { setMsg(ok + (j.puladas_pagas ? ` (${j.puladas_pagas} já paga(s) ficaram como estavam)` : "")); await carregar(); onDone(); }
    setIndo(false);
  }

  function salvar() {
    const campos: Record<string, unknown> = {};
    const atual = oc.find((o) => String(o.id) === idAtual);
    const v = Number(valor.replace(/\./g, "").replace(",", "."));
    if (v > 0 && (!atual || Math.abs(v - Number(atual.valor)) > 0.004)) campos.valor = v;
    if (escopo === "esta" && venc && atual && venc !== atual.vencimento) campos.vencimento = venc;
    if (obs.trim()) campos.obs = obs.trim();
    if (!Object.keys(campos).length) { setErro("Nada mudou"); return; }
    post({ acao: "editar", id: idAtual, escopo, campos }, "Série atualizada.");
  }

  const pagas = oc.filter((o) => o.pago).length;
  const freq = String(regra.freq ?? "");
  return (
    <div className="cp3">
      <div className="ov on" onClick={onClose} />
      <div className="modal on" style={{ width: "min(720px,95vw)" }}>
        <div className="dh"><div><h3 style={{ margin: 0 }}>Conta recorrente</h3>
          <div className="sub2" style={{ marginTop: 3 }}>{freq} · {oc.length} ocorrências · {pagas} paga(s){regra.sem_fim ? " · sem fim (sempre 12 à frente)" : ""}{encerrada ? ` · encerrada em ${new Date(encerrada).toLocaleDateString("pt-BR")}` : ""}</div></div>
          <button className="btn" style={{ height: 34 }} onClick={onClose}>✕</button></div>
        <div className="dbody" style={{ overflow: "auto" }}>
          {erro && <div className="verdict bloq" style={{ marginBottom: 10 }}><b>Atenção</b><span>{erro}</span></div>}
          {msg && <div className="verdict ok" style={{ marginBottom: 10 }}><b>Feito</b><span>{msg}</span></div>}
          <div className="frm" style={{ marginBottom: 12 }}>
            <label>Aplicar a
              <select value={escopo} onChange={(e) => setEscopo(e.target.value as typeof escopo)}>
                <option value="esta">Só esta ocorrência</option><option value="proximas">Esta e as próximas</option><option value="todas">Todas (as não pagas)</option>
              </select></label>
            <label>Valor<input className="num" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
            {escopo === "esta" && <label>Vencimento<input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></label>}
            <label className="full">Observação<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional" /></label>
          </div>
          <div className="gl" style={{ maxHeight: 280, overflow: "auto" }}>
            {oc.map((o) => (
              <div key={String(o.id)} style={{ opacity: o.cancelado ? 0.45 : 1, fontWeight: String(o.id) === idAtual ? 700 : 400 }}>
                <span className="num">{o.seq}</span>
                <span>venc {dbr(o.vencimento)} <span className="sub2">· previsão {dbr(o.previsao)}{o.pago ? " · paga" : o.cancelado ? " · cancelada" : ""}</span></span>
                <span className="num" style={{ textAlign: "right" }}>{brl(o.valor)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="df">
          <button className="btn danger" disabled={indo || !!encerrada} onClick={() => confirm("Encerrar a série? As ocorrências em aberto sem pagamento são canceladas; as pagas ficam.") && post({ acao: "encerrar" }, "Série encerrada.")}>Encerrar série</button>
          <button className="btn danger" disabled={indo || pagas > 0} title={pagas ? "Tem ocorrência paga — use Encerrar" : ""} onClick={() => confirm("Excluir a série inteira?") && post({ acao: "excluir" }, "Série excluída.")}>Excluir série</button>
          <span style={{ marginLeft: "auto" }} />
          <button className="btn" onClick={onClose}>Fechar</button>
          <button className="btn ok" disabled={indo} onClick={salvar}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
