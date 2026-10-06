"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { limpo } from "@/lib/faturamento/montar";

/* Registrar NFS-e emitida na prefeitura (sql/59, 05/10/2026). A NFS-e é
   feita à mão no portal da prefeitura; aqui ela é registrada: liga às OS,
   guarda número/valores/retenções/PDF/XML e cria o contas a receber pelo
   LÍQUIDO (serviços − ISS retido − retenções federais). As parcelas vêm
   pré-preenchidas pela condição da OS e podem ser ajustadas. */

type OsPre = {
  chave: string; rotulo?: string; valor?: number; erro?: string; cliente_codigo?: number | string | null; cliente_nome?: string | null;
  cliente_doc?: string | null; categoria?: string | null; projeto?: string | null; condicao?: string | null;
  parcelas_dias?: number[]; parcelas_pct?: (number | null)[] | null; iss_retido?: boolean; valor_iss?: number; ret_inss?: number;
  aberta?: boolean; descricao?: string | null; ja_registrada?: { id: number; numero: string; municipio: string }[] | null;
  /** OS de projeto: parcelas do fechamento — uma NFS-e por parcela (06/10/26). */
  parcelas_projeto?: { numero: number; descricao: string | null; valor: number; vencimento: string; faturamento_previsto: string | null;
    faturada: boolean; prazo: number | null }[] | null;
};
type Pessoa = { codigo: number; razao: string; doc: string | null; cidade?: string | null };
type Parc = { vencimento: string; valor: string };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const n2 = (s: string | number) => { const v = typeof s === "number" ? s : Number(String(s).replace(/\./g, "").replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0; };
const txt = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const somaDias = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

export default function RegistrarNfse({ empresa, chaves, fechar, feito, avisar }: {
  empresa: string; chaves: string[]; fechar: () => void; feito: () => void; avisar: (m: string) => void;
}) {
  const [os, setOs] = useState<OsPre[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mun, setMun] = useState("");
  const [numero, setNumero] = useState("");
  const [verif, setVerif] = useState("");
  const [emissao, setEmissao] = useState(hojeISO());
  const [comp, setComp] = useState(hojeISO().slice(0, 7));
  const [valor, setValor] = useState("");
  const [issRet, setIssRet] = useState(false);
  const [iss, setIss] = useState("0,00");
  const [ret, setRet] = useState<Record<"ir" | "pis" | "cofins" | "csll" | "inss", string>>({ ir: "0,00", pis: "0,00", cofins: "0,00", csll: "0,00", inss: "0,00" });
  const [tom, setTom] = useState<Pessoa | null>(null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Pessoa[]>([]);
  const [parcs, setParcs] = useState<Parc[]>([]);
  const [parcEditada, setParcEditada] = useState(false);
  const [obs, setObs] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** OS de projeto: parcela do fechamento que esta NFS-e fatura (por chave da OS). */
  const [parcSel, setParcSel] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch(`/api/faturamento/nfse?empresa=${empresa}&prefill=${encodeURIComponent(chaves.join(","))}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => {
        if (j.error) { setErro(j.error); return; }
        const lista = (j.os ?? []) as OsPre[];
        setOs(lista);
        setMun(j.municipio_padrao ?? "");
        const ok = lista.filter((o) => !o.erro);
        // Projeto: valor = próxima parcela do fechamento por faturar; prazo = o do fechamento.
        const sel: Record<string, number> = {};
        for (const o of ok) {
          const prox = (o.parcelas_projeto ?? []).find((p) => !p.faturada);
          if (prox) { sel[o.chave] = prox.numero; o.valor = Number(prox.valor); o.parcelas_dias = [prox.prazo ?? 0]; o.parcelas_pct = null; }
        }
        setParcSel(sel);
        const total = ok.reduce((a, o) => a + Number(o.valor ?? 0), 0);
        setValor(txt(total));
        if (ok.some((o) => o.iss_retido)) setIssRet(true);
        setIss(txt(ok.reduce((a, o) => a + Number(o.valor_iss ?? 0), 0)));
        setRet((r) => ({ ...r, inss: txt(ok.reduce((a, o) => a + Number(o.ret_inss ?? 0), 0)) }));
        const p = ok[0];
        if (p?.cliente_codigo) setTom({ codigo: Number(p.cliente_codigo), razao: limpo(p.cliente_nome ?? ""), doc: p.cliente_doc ?? null });
      }).catch((e) => setErro(String(e)));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [empresa, chaves.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const okOs = useMemo(() => (os ?? []).filter((o) => !o.erro), [os]);
  const liquido = useMemo(() => n2(valor) - (issRet ? n2(iss) : 0) - n2(ret.ir) - n2(ret.pis) - n2(ret.cofins) - n2(ret.csll) - n2(ret.inss), [valor, issRet, iss, ret]);

  // parcelas sugeridas: dias/percentuais da 1ª OS a partir da emissão da NFS-e, sobre o líquido
  useEffect(() => {
    if (parcEditada || !okOs.length) return;
    const o = okOs[0];
    const dias = o.parcelas_dias?.length ? o.parcelas_dias : [0];
    const pct = o.parcelas_pct && o.parcelas_pct.every((x) => x != null) && o.parcelas_pct.length === dias.length ? (o.parcelas_pct as number[]) : null;
    const liq = Math.max(0, liquido);
    let acum = 0;
    const ps = dias.map((d, i) => {
      const v = i === dias.length - 1 ? Math.round((liq - acum) * 100) / 100 : Math.round(((pct ? (liq * pct[i]) / 100 : liq / dias.length)) * 100) / 100;
      acum += v;
      return { vencimento: somaDias(emissao, Number(d) || 0), valor: txt(v) };
    });
    setParcs(ps);
  }, [okOs, liquido, emissao, parcEditada]);

  useEffect(() => {
    if (busca.trim().length < 3) { setAchados([]); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/cadastros?papel=cliente&emp=${empresa}&q=${encodeURIComponent(busca.trim())}`, { cache: "no-store" })
        .then((r) => r.json()).then((j) => setAchados(((j.linhas ?? []) as Pessoa[]).slice(0, 8))).catch(() => setAchados([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [busca, empresa]);

  const somaParc = parcs.reduce((a, p) => a + n2(p.valor), 0);
  const jaReg = okOs.filter((o) => !(o.parcelas_projeto?.length)).flatMap((o) => (o.ja_registrada ?? []).map((r) => `${o.rotulo}: NFS-e ${r.numero} (${r.municipio})`));
  function escolherParcela(o: OsPre, numero: number) {
    const p = o.parcelas_projeto?.find((x) => x.numero === numero);
    if (!p) return;
    setParcSel((m) => ({ ...m, [o.chave]: numero }));
    setOs((l) => (l ?? []).map((x) => (x.chave === o.chave ? { ...x, valor: Number(p.valor), parcelas_dias: [p.prazo ?? 0], parcelas_pct: null } : x)));
    const outras = okOs.filter((x) => x.chave !== o.chave).reduce((a, x) => a + Number(x.valor ?? 0), 0);
    setValor(txt(outras + Number(p.valor))); setParcEditada(false);
  }
  const problemas = [
    !numero.trim() && "número da NFS-e",
    !mun.trim() && "município",
    !emissao && "data de emissão",
    n2(valor) <= 0 && "valor dos serviços",
    liquido <= 0 && "líquido > 0",
    !tom && "tomador",
    !parcs.length && "parcelas",
    Math.abs(somaParc - liquido) > 0.01 && `parcelas somam ${BRL.format(somaParc)} ≠ líquido ${BRL.format(liquido)}`,
    !pdf && !xml && "PDF ou XML da nota",
    jaReg.length > 0 && "OS já tem NFS-e registrada",
  ].filter(Boolean) as string[];

  async function salvar() {
    if (problemas.length) { avisar(`Falta: ${problemas.join(" · ")}`); return; }
    if (!window.confirm(`Registrar a NFS-e ${numero} (${mun}) de ${BRL.format(n2(valor))} — a receber ${BRL.format(liquido)} em ${parcs.length} parcela(s)?`)) return;
    setEnviando(true);
    const dados = {
      empresa, municipio: mun.trim(), numero: numero.trim(), codigo_verificacao: verif.trim() || null,
      data_emissao: emissao, competencia: comp ? `${comp}-01` : null,
      valor_servicos: n2(valor), iss_retido: issRet, valor_iss: n2(iss),
      ret_ir: n2(ret.ir), ret_pis: n2(ret.pis), ret_cofins: n2(ret.cofins), ret_csll: n2(ret.csll), ret_inss: n2(ret.inss),
      tomador: tom ? { codigo: tom.codigo, nome: tom.razao, doc: tom.doc } : null,
      os: okOs.map((o) => ({ chave: o.chave, rotulo: o.rotulo, valor: Number(o.valor ?? 0), categoria: o.categoria ?? null, projeto: o.projeto ?? null,
        ...(parcSel[o.chave] ? { parcelas: [parcSel[o.chave]] } : {}) })),
      parcelas: parcs.map((p) => ({ vencimento: p.vencimento, valor: n2(p.valor) })),
      observacao: obs.trim() || null,
    };
    const fd = new FormData();
    fd.append("dados", JSON.stringify(dados));
    if (pdf) fd.append("pdf", pdf);
    if (xml) fd.append("xml", xml);
    const r = await fetch("/api/faturamento/nfse", { method: "POST", body: fd }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setEnviando(false);
    if (r.error) { avisar(r.error); return; }
    avisar(`NFS-e ${r.registro.numero} registrada · ${r.registro.receber_ids?.length ?? 0} parcela(s) a receber criada(s)`);
    feito();
  }

  const campo = (rot: string, el: ReactNode, w?: number | string) => <label className="fld" style={{ width: w }}><span>{rot}</span>{el}</label>;
  const retCampo = (k: keyof typeof ret, rot: string) => campo(rot, <input className="inp r" value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: e.target.value })} />, 104);

  return (
    <>
      <div className="fpv-scrim" onClick={fechar} />
      <aside className="fpv-drawer fpv-form">
        <div className="dh">
          <button className="x" onClick={fechar}>✕</button>
          <div style={{ fontSize: 12, color: "var(--f-tx3)" }}>NFS-e emitida no portal da prefeitura · controle no painel (nada vai ao Omie nem à Focus)</div>
          <h2><span className="tag os">OS</span>Registrar NFS-e</h2>
          <div className="c">{okOs.map((o) => `${o.rotulo} · ${BRL.format(Number(o.valor ?? 0))}`).join("  ·  ") || "…"}</div>
        </div>
        <div className="db">
          {erro && <div className="alert bad">{erro}</div>}
          {(os ?? []).filter((o) => o.erro).map((o) => <div className="alert bad" key={o.chave}>{o.chave}: {o.erro}</div>)}
          {jaReg.map((j) => <div className="alert bad" key={j}>Já registrada — {j}</div>)}
          {okOs.some((o) => o.aberta === false) && <div className="alert">Atenção: há OS já faturada no Omie (recibo). Registre só se a NFS-e substitui/complementa esse faturamento.</div>}
          {!os ? <div className="orig">Carregando as OS…</div> : (
            <>
              <h4>Nota da prefeitura</h4>
              <div className="row">
                {campo("Nº da NFS-e", <input className="inp" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />, 130)}
                {campo("Código de verificação", <input className="inp" value={verif} onChange={(e) => setVerif(e.target.value)} />, 170)}
                {campo("Município (prefeitura)", <input className="inp" value={mun} onChange={(e) => setMun(e.target.value)} />, 170)}
                {campo("Emissão", <input className="inp" type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} />, 150)}
                {campo("Competência", <input className="inp" type="month" value={comp} onChange={(e) => setComp(e.target.value)} />, 150)}
              </div>

              <h4>Tomador</h4>
              {tom ? (
                <div className="row" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1 }}><b>{limpo(tom.razao)}</b><div className="orig">{tom.doc ?? "sem CNPJ/CPF"} · cód. {tom.codigo}</div></div>
                  <button className="btn ghost sm" onClick={() => { setTom(null); setBusca(""); }}>Trocar</button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <input className="inp" style={{ width: "100%" }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cadastro: nome, fantasia ou CNPJ/CPF (mín. 3 letras)" />
                  {achados.length > 0 && (
                    <div className="sug">
                      {achados.map((p) => (
                        <button key={p.codigo} type="button" onClick={() => { setTom(p); setAchados([]); }}>
                          <b>{limpo(p.razao)}</b><span>{p.doc ?? "—"} · {p.cidade ?? ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {okOs.filter((o) => o.parcelas_projeto?.length).map((o) => (
                <div key={o.chave} style={{ marginBottom: 10 }}>
                  <h4>{o.rotulo}: parcela do fechamento que esta NFS-e fatura</h4>
                  {o.parcelas_projeto!.map((p) => (
                    <label key={p.numero} className="fld chk" style={{ display: "flex", gap: 8, opacity: p.faturada ? 0.55 : 1 }}>
                      <input type="radio" name={`parc-${o.chave}`} disabled={p.faturada} checked={parcSel[o.chave] === p.numero} onChange={() => escolherParcela(o, p.numero)} />
                      <b>{p.numero}/{o.parcelas_projeto!.length}</b> {p.descricao} · {BRL.format(Number(p.valor))}
                      {p.faturamento_previsto ? ` · fatura ${p.faturamento_previsto.split("-").reverse().join("/")}` : ""}{p.faturada ? " · faturada" : ""}
                    </label>
                  ))}
                </div>
              ))}

              <h4>Valores e retenções</h4>
              <div className="row">
                {campo("Valor dos serviços", <input className="inp r" value={valor} onChange={(e) => setValor(e.target.value)} />, 150)}
                {campo("ISS", <input className="inp r" value={iss} onChange={(e) => setIss(e.target.value)} />, 110)}
                <label className="fld chk"><input type="checkbox" checked={issRet} onChange={(e) => setIssRet(e.target.checked)} /> ISS retido pelo tomador</label>
              </div>
              <div className="row">
                {retCampo("ir", "IR retido")}{retCampo("pis", "PIS retido")}{retCampo("cofins", "COFINS retido")}{retCampo("csll", "CSLL retido")}{retCampo("inss", "INSS retido")}
              </div>
              <div className="liq">
                A receber (líquido): <b className="mono">{BRL.format(liquido)}</b>
                <span className="orig"> = serviços {issRet ? "− ISS retido " : ""}− retenções federais. ISS não retido não abate.</span>
              </div>

              <h4>Parcelas a receber</h4>
              {parcs.map((p, i) => (
                <div className="row" key={i} style={{ alignItems: "flex-end" }}>
                  {campo(`${i + 1}ª vencimento`, <input className="inp" type="date" value={p.vencimento} onChange={(e) => { setParcEditada(true); setParcs(parcs.map((x, k) => (k === i ? { ...x, vencimento: e.target.value } : x))); }} />, 160)}
                  {campo("Valor", <input className="inp r" value={p.valor} onChange={(e) => { setParcEditada(true); setParcs(parcs.map((x, k) => (k === i ? { ...x, valor: e.target.value } : x))); }} />, 130)}
                  {parcs.length > 1 && <button className="btn ghost sm" onClick={() => { setParcEditada(true); setParcs(parcs.filter((_, k) => k !== i)); }}>remover</button>}
                </div>
              ))}
              <div className="row" style={{ alignItems: "center" }}>
                <button className="btn ghost sm" onClick={() => { setParcEditada(true); setParcs([...parcs, { vencimento: somaDias(emissao, 30 * (parcs.length + 1)), valor: "0,00" }]); }}>+ parcela</button>
                {parcEditada && <button className="btn ghost sm" onClick={() => setParcEditada(false)}>recalcular pela condição da OS</button>}
                <span className="orig" style={{ marginLeft: "auto", color: Math.abs(somaParc - liquido) > 0.01 ? "var(--f-bad)" : "var(--f-tx3)" }}>
                  soma {BRL.format(somaParc)}{okOs[0]?.condicao ? ` · condição da OS: ${okOs[0].condicao}` : ""}
                </span>
              </div>

              <h4>Arquivos da nota</h4>
              <div className="row">
                {campo("PDF da NFS-e", <input className="inp" type="file" accept="application/pdf,.pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />, 260)}
                {campo("XML (opcional)", <input className="inp" type="file" accept=".xml,text/xml,application/xml" onChange={(e) => setXml(e.target.files?.[0] ?? null)} />, 260)}
              </div>
              {campo("Observação", <input className="inp" style={{ width: "100%" }} value={obs} onChange={(e) => setObs(e.target.value)} />, "100%")}
            </>
          )}
        </div>
        <div className="df">
          <div className="sum">{problemas.length ? <span style={{ color: "var(--f-warn)" }}>Falta: {problemas.join(" · ")}</span> : <>A receber<b className="mono">{BRL.format(liquido)}</b></>}</div>
          <button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn pri" disabled={enviando || !os || problemas.length > 0} onClick={salvar}>{enviando ? "Registrando…" : "Registrar NFS-e"}</button>
        </div>
      </aside>
    </>
  );
}
