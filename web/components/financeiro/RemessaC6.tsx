"use client";

/**
 * "Gerar arquivo C6" (05/10/26) — monta o arquivo de pagamentos em lote do C6
 * Bank a partir dos títulos escolhidos no Contas a Pagar (lote, programação por
 * banco). Cada título vira uma linha do modelo oficial do C6, na aba certa:
 * Pix chave, Pix agência e conta, Boleto ou TED (ou o modelo "salários via Pix").
 * Mostra o que falta por linha, deixa completar ali mesmo e (opcional) guarda a
 * chave Pix / conta no cadastro do fornecedor. Nada vai ao banco: o arquivo é
 * baixado e enviado no portal do C6; a baixa vem depois pela conciliação.
 */
import { useEffect, useMemo, useState } from "react";

type Modalidade = "PIX_CHAVE" | "PIX_CONTA" | "BOLETO" | "TED";
type Banco = { compe: string; ispb: string; nome: string };
type Titulo = {
  ref: string; empresa: string; vencimento: string; previsao: string; valor: number; favorecido: string; doc: string;
  pessoa_id: number | null; barras: string | null; documento: string | null; categoria: string | null;
  pix_tipo: string | null; pix_chave: string | null; banco_compe: string | null; banco_ispb: string | null;
  agencia: string | null; conta: string | null; conta_tipo: string | null; titular_nome: string | null; titular_doc: string | null;
  enviado_remessa: number | null; enviado_em: string | null;
};
type Linha = {
  ref: string; pessoa_id: number | null; modalidade: Modalidade; nome: string; doc: string; chave: string; barras: string;
  compe: string; ispb: string; contaTipo: string; agencia: string; conta: string; finalidade: string;
  valor: number; data: string; descricao: string; incluir: boolean; empresa: string; venc: string; enviado: number | null;
};

const MOD_LABEL: Record<Modalidade, string> = { PIX_CHAVE: "Pix (chave)", PIX_CONTA: "Pix (agência e conta)", BOLETO: "Boleto", TED: "TED" };
const FINALIDADES = [
  "01 - Crédito em conta", "02 - Transferência entre contas de mesma titularidade", "03 - Pagamento a concessionárias de serviço público",
  "04 - Pagamento de impostos, tributos e taxas", "05 - Pagamento de aluguéis e taxas de condomínio", "06 - Pagamento de duplicatas e títulos",
  "07 - Pagamento de fornecedores", "08 - Pagamento de mensalidade escolar", "09 - Depósito judicial", "10 - Pensão alimentícia",
  "11 - Pagamento de operações de crédito por cliente", "12 - Operação de câmbio - Não interbancária ",
];
const TIPOS_CONTA = ["Conta Corrente", "Conta Poupança", "Conta Pagamento"];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dbr = (iso: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—");
const dig = (s: string) => s.replace(/\D/g, "");

function faltando(l: Linha, hoje: string, modelo: "contas" | "salarios"): string[] {
  const e: string[] = [];
  if (!(l.valor > 0)) e.push("valor");
  if (!l.data) e.push("data"); else if (l.data < hoje) e.push("data no passado");
  if (modelo === "salarios" && (l.modalidade === "BOLETO" || l.modalidade === "TED")) e.push("salários: só Pix");
  if (l.modalidade === "PIX_CHAVE") { if (!l.chave.trim()) e.push("chave Pix"); if (!l.nome) e.push("nome"); }
  if (l.modalidade === "PIX_CONTA" || l.modalidade === "TED") {
    if (!l.nome) e.push("nome");
    if (![11, 14].includes(dig(l.doc).length)) e.push("CPF/CNPJ");
    if (l.modalidade === "PIX_CONTA" ? !l.ispb : !l.compe) e.push("banco");
    if (!TIPOS_CONTA.includes(l.contaTipo)) e.push("tipo de conta");
    if (!dig(l.agencia)) e.push("agência");
    if (!dig(l.conta)) e.push("conta");
    if (l.modalidade === "TED" && !l.finalidade) e.push("finalidade");
  }
  if (l.modalidade === "BOLETO" && ![44, 47, 48].includes(dig(l.barras).length)) e.push("código de barras");
  return e;
}

export default function RemessaC6({ refs, onClose, onDone }: { refs: string[]; onClose: () => void; onDone: () => void }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [hoje, setHoje] = useState(new Date().toLocaleDateString("sv-SE"));
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [modelo, setModelo] = useState<"contas" | "salarios">("contas");
  const [salvarCad, setSalvarCad] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [feito, setFeito] = useState<{ id: number; nome: string; url: string | null; n: number; total: number } | null>(null);
  const [errosSrv, setErrosSrv] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/financeiro/remessa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "previa", refs }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
        if (!vivo) return;
        const h: string = j.hoje; setHoje(h);
        setBancos(j.bancos ?? []);
        setLinhas(((j.titulos ?? []) as Titulo[]).map((t) => {
          const temConta = !!(t.banco_compe && t.agencia && t.conta);
          const modalidade: Modalidade = t.barras ? "BOLETO" : t.pix_chave ? "PIX_CHAVE" : temConta ? "PIX_CONTA" : "PIX_CHAVE";
          return {
            ref: t.ref, pessoa_id: t.pessoa_id, modalidade, nome: t.titular_nome || t.favorecido || "", doc: t.titular_doc || t.doc || "",
            chave: t.pix_chave ?? "", barras: t.barras ?? "", compe: t.banco_compe ?? "", ispb: t.banco_ispb ?? "",
            contaTipo: t.conta_tipo || "Conta Corrente", agencia: t.agencia ?? "", conta: t.conta ?? "",
            finalidade: "07 - Pagamento de fornecedores", valor: Number(t.valor) || 0,
            data: (t.previsao && t.previsao > h ? t.previsao : h),
            descricao: t.documento ? `Pagamento NF ${t.documento}` : "Pagamento de contas",
            incluir: !t.enviado_remessa, empresa: t.empresa, venc: t.vencimento, enviado: t.enviado_remessa,
          };
        }));
      } catch (e) { setErro((e as Error).message); }
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [refs]);

  const ativos = linhas.filter((l) => l.incluir);
  const pend = useMemo(() => Object.fromEntries(linhas.map((l) => [l.ref, faltando(l, hoje, modelo)])), [linhas, hoje, modelo]);
  const comErro = ativos.filter((l) => pend[l.ref].length);
  const total = ativos.reduce((s, l) => s + l.valor, 0);
  const porMod = (m: Modalidade) => ativos.filter((l) => l.modalidade === m).length;
  const set = (ref: string, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.ref === ref ? { ...l, ...p } : l)));
  const setTodasData = (d: string) => setLinhas((ls) => ls.map((l) => ({ ...l, data: d })));

  async function gerar() {
    setGerando(true); setErro(""); setErrosSrv({});
    try {
      const r = await fetch("/api/financeiro/remessa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        // C6 é conta da SF: títulos da CD/WW pagos por ela viram intercompany na baixa (05/10/26).
        acao: "gerar", modelo, salvar_cadastro: salvarCad, empresa: "SF",
        linhas: ativos.map((l) => ({ ref: l.ref, pessoa_id: l.pessoa_id, modalidade: l.modalidade, nome: l.nome, doc: dig(l.doc), chave: l.chave.trim(),
          barras: dig(l.barras), ispb: l.ispb, compe: l.compe, contaTipo: l.contaTipo, agencia: dig(l.agencia), conta: l.conta.replace(/[^\dXx-]/g, ""),
          finalidade: l.finalidade, valor: l.valor, data: l.data,
          descricao: l.empresa !== "SF" && !l.descricao.startsWith(l.empresa + " ") ? `${l.empresa} · ${l.descricao}`.slice(0, 140) : l.descricao })),
      }) });
      const j = await r.json();
      if (!r.ok) {
        if (j.erros) setErrosSrv(Object.fromEntries((j.erros as { ref: string; faltando: string[] }[]).map((e) => [e.ref, e.faltando])));
        throw new Error(j.error ?? "HTTP " + r.status);
      }
      setFeito(j);
      if (j.url) { const a = document.createElement("a"); a.href = j.url; a.download = j.nome; document.body.appendChild(a); a.click(); a.remove(); }
      onDone();
    } catch (e) { setErro((e as Error).message); }
    setGerando(false);
  }

  const inp = { background: "var(--bg)", border: "1px solid var(--line2)", borderRadius: 7, padding: "5px 7px", color: "var(--tx)", fontSize: 12, width: "100%" } as const;
  const bancoSel = (l: Linha) => (
    <select style={inp} value={l.modalidade === "TED" ? l.compe : l.ispb} onChange={(e) => {
      const b = bancos.find((x) => (l.modalidade === "TED" ? x.compe : x.ispb) === e.target.value);
      set(l.ref, { compe: b?.compe ?? "", ispb: b?.ispb ?? "" });
    }}>
      <option value="">Banco…</option>
      {bancos.map((b) => <option key={b.compe} value={l.modalidade === "TED" ? b.compe : b.ispb}>{b.compe} · {b.nome}</option>)}
    </select>
  );

  return (
    <div className="cp3">
      <div className="ov on" onClick={onClose} />
      <div className="modal on" style={{ width: "min(1280px,97vw)", maxHeight: "92vh" }}>
        <div className="dh">
          <div>
            <h3 style={{ margin: 0 }}>Gerar arquivo C6 — pagamentos em lote</h3>
            <div className="sub2" style={{ marginTop: 3 }}>Modelo oficial do C6 (portal › Pagamentos › enviar planilha). Nada é enviado ao banco daqui; a baixa vem pela conciliação.</div>
          </div>
          <button className="btn" style={{ height: 34 }} onClick={onClose}>✕</button>
        </div>
        <div className="dbody" style={{ overflow: "auto" }}>
          {carregando ? <div className="carregando">Carregando títulos…</div> : feito ? (
            <div className="verdict ok"><b>Arquivo gerado — remessa #{feito.id}</b>
              <span>{feito.n} pagamentos · {brl(feito.total)}. Os títulos ficaram marcados como “enviado ao C6”. {feito.url ? <a className="link" href={feito.url} download={feito.nome}>Baixar de novo ({feito.nome})</a> : null}</span></div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                <label className="sub2">Modelo<br />
                  <select style={{ ...inp, width: 260 }} value={modelo} onChange={(e) => setModelo(e.target.value as "contas" | "salarios")}>
                    <option value="contas">Pagamentos de contas (Pix, boleto, TED)</option>
                    <option value="salarios">Salários via Pix</option>
                  </select></label>
                <label className="sub2">Mesma data de pagamento para todos<br />
                  <input type="date" style={{ ...inp, width: 170 }} min={hoje} onChange={(e) => e.target.value && setTodasData(e.target.value)} /></label>
                <label className="sub2" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={salvarCad} onChange={(e) => setSalvarCad(e.target.checked)} /> guardar chave Pix / conta no cadastro do fornecedor</label>
              </div>
              {erro && <div className="verdict bloq" style={{ marginBottom: 10 }}><b>Não gerou</b><span>{erro}</span></div>}
              <div className="tbl">
                <table className="num" style={{ width: "100%" }}>
                  <thead><tr>
                    <th style={{ width: 28 }} /><th>Favorecido</th><th style={{ width: 150 }}>Forma</th><th>Dados de pagamento</th>
                    <th style={{ width: 120 }}>Data pagto</th><th className="r" style={{ width: 120 }}>Valor</th><th style={{ width: 200 }}>Descrição</th>
                  </tr></thead>
                  <tbody>
                    {linhas.map((l) => {
                      const f = [...(pend[l.ref] ?? []), ...(errosSrv[l.ref] ?? []).filter((x) => !(pend[l.ref] ?? []).includes(x))];
                      return (
                        <tr key={l.ref} style={{ opacity: l.incluir ? 1 : 0.45, verticalAlign: "top" }}>
                          <td><input type="checkbox" checked={l.incluir} onChange={(e) => set(l.ref, { incluir: e.target.checked })} /></td>
                          <td>
                            <input style={inp} value={l.nome} onChange={(e) => set(l.ref, { nome: e.target.value })} />
                            <div className="sub2">{l.empresa}{l.empresa !== "SF" ? <span style={{ color: "var(--ap-t-violet)" }}> (pago pela SF · intercompany)</span> : null} · venc {dbr(l.venc)}{l.enviado ? <span style={{ color: "#f59e0b" }}> · já foi na remessa #{l.enviado}</span> : null}</div>
                            {l.incluir && f.length ? <div style={{ color: "var(--ap-t-red)", fontSize: 11.5, marginTop: 3 }}>falta: {f.join(", ")}
                              {l.pessoa_id && !f.every((x) => ["valor", "data", "data no passado"].includes(x))
                                ? <> · <a className="link" href={`/cadastros/${l.pessoa_id}/editar#pagamento`} target="_blank" rel="noreferrer">completar no cadastro ↗</a></> : null}</div> : null}
                          </td>
                          <td>
                            <select style={inp} value={l.modalidade} onChange={(e) => set(l.ref, { modalidade: e.target.value as Modalidade })}>
                              {(modelo === "salarios" ? ["PIX_CHAVE", "PIX_CONTA"] : ["PIX_CHAVE", "PIX_CONTA", "BOLETO", "TED"]).map((m) => <option key={m} value={m}>{MOD_LABEL[m as Modalidade]}</option>)}
                            </select>
                          </td>
                          <td>
                            {l.modalidade === "PIX_CHAVE" && <input style={inp} placeholder="Chave Pix (CPF/CNPJ, e-mail, +5511912345678 ou aleatória)" value={l.chave} onChange={(e) => set(l.ref, { chave: e.target.value })} />}
                            {l.modalidade === "BOLETO" && <input style={inp} placeholder="Código de barras / linha digitável" value={l.barras} onChange={(e) => set(l.ref, { barras: e.target.value })} />}
                            {(l.modalidade === "PIX_CONTA" || l.modalidade === "TED") && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 4 }}>
                                {bancoSel(l)}
                                <input style={inp} placeholder="CPF/CNPJ" value={l.doc} onChange={(e) => set(l.ref, { doc: e.target.value })} />
                                <select style={inp} value={l.contaTipo} onChange={(e) => set(l.ref, { contaTipo: e.target.value })}>{TIPOS_CONTA.map((t) => <option key={t}>{t}</option>)}</select>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 4 }}>
                                  <input style={inp} placeholder="Agência" value={l.agencia} onChange={(e) => set(l.ref, { agencia: e.target.value })} />
                                  <input style={inp} placeholder="Conta-dígito" value={l.conta} onChange={(e) => set(l.ref, { conta: e.target.value })} />
                                </div>
                                {l.modalidade === "TED" && <select style={{ ...inp, gridColumn: "1/-1" }} value={l.finalidade} onChange={(e) => set(l.ref, { finalidade: e.target.value })}>{FINALIDADES.map((x) => <option key={x}>{x}</option>)}</select>}
                              </div>
                            )}
                          </td>
                          <td><input type="date" style={inp} min={hoje} value={l.data} onChange={(e) => set(l.ref, { data: e.target.value })} /></td>
                          <td className="r"><input style={{ ...inp, textAlign: "right" }} value={l.valor.toFixed(2).replace(".", ",")} onChange={(e) => set(l.ref, { valor: Number(e.target.value.replace(/\./g, "").replace(",", ".")) || 0 })} /></td>
                          <td><input style={inp} value={l.descricao} onChange={(e) => set(l.ref, { descricao: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="df" style={{ alignItems: "center" }}>
          {!feito && !carregando && (
            <span className="sub2" style={{ marginRight: "auto" }}>
              {ativos.length} pagamentos · <b className="num" style={{ color: "var(--tx)" }}>{brl(total)}</b>
              {(["PIX_CHAVE", "PIX_CONTA", "BOLETO", "TED"] as Modalidade[]).filter(porMod).map((m) => ` · ${MOD_LABEL[m]}: ${porMod(m)}`).join("")}
              {comErro.length ? <span style={{ color: "var(--ap-t-red)" }}> · {comErro.length} com dados faltando</span> : null}
            </span>
          )}
          <button className="btn" onClick={onClose}>{feito ? "Fechar" : "Cancelar"}</button>
          {!feito && <button className="btn ok" disabled={gerando || carregando || !ativos.length || comErro.length > 0} onClick={gerar}>{gerando ? "Gerando…" : `Gerar e baixar arquivo (${ativos.length})`}</button>}
        </div>
      </div>
    </div>
  );
}
