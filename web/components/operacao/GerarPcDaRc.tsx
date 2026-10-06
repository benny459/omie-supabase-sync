"use client";
/* Atalho em Operação (06/10/26, Benny): gerar o pedido de compra que atende a
   RC sem sair da linha do PV/OS. Folha compacta, pré-preenchida da RC (itens,
   quantidades em aberto, valores, fornecedor sugerido, projeto, PV/OS); grava
   pelo MESMO caminho da folha de Compras (POST /api/compras/pedido →
   compras_salvar), com os itens ligados à RC — numeração, aprovação e travas
   são as de sempre. Itens que ficarem de fora continuam disponíveis para outro
   PC (ex.: outro fornecedor). */
import { useEffect, useMemo, useState } from "react";
import { money, gerarParcelas, hoje, addDias, TIPOS_FRETE, type Refs, type HistPreco } from "@/lib/compras";

type ItemRc = { id: number; seq: number; cod?: string | null; ncodProd?: number | null; desc: string; un?: string | null;
  qtd: number; vu?: number | null; ncm?: string | null; obs?: string | null; cov: number };
type RcFull = { id: number; num: string; emp: string; pv?: string | null; pvCliente?: string | null; proj?: string | null;
  projCod?: number | null; forn?: string | null; fornCod?: number | null; previsao?: string | null; comprador?: string | null;
  compradorCod?: number | null; itens: ItemRc[] };
type Forn = { cod: number; nome: string; fantasia?: string; cnpj?: string; ultCatCod?: string; ultCat?: string; ultContato?: string; ultParc?: string };
type Linha = { it: ItemRc; on: boolean; qtd: number; vu: number; verHist?: boolean };

const dBR = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("/") : d);
const normForn = (x: string | null | undefined) => (x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** "… · Fornecedor sugerido: OKI COMERCIO" na obs do item da RC (o CRM grava assim). */
const sugeridoNaObs = (obs?: string | null) => /Fornecedor sugerido:\s*([^·|]+)/i.exec(obs ?? "")?.[1]?.trim() || null;

/** Fornecedor mais frequente nas compras destes itens (desempate: o mais recente). */
function maisComprado(hist: Record<string, HistPreco[]>): string | null {
  const conta = new Map<string, { n: number; ult: string; nome: string }>();
  for (const h of Object.values(hist)) for (const x of h) {
    if (!x.f) continue;
    const k = normForn(x.f); const c = conta.get(k) ?? { n: 0, ult: "", nome: x.f };
    c.n += 1; if (x.d > c.ult) c.ult = x.d; conta.set(k, c);
  }
  return [...conta.values()].sort((a, b) => b.n - a.n || b.ult.localeCompare(a.ult))[0]?.nome ?? null;
}

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
}

export default function GerarPcDaRc({ rc, empresa, itensRc, onFechar, onFeito }: {
  rc: string; empresa: string;
  /** ids dos itens da RC escolhidos na linha (vazio = todos os que ainda faltam). */
  itensRc: number[];
  onFechar: () => void;
  onFeito: (num: string, id: number) => void;
}) {
  const [rcFull, setRcFull] = useState<RcFull | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [forn, setForn] = useState<Forn | null>(null);
  const [fornQ, setFornQ] = useState("");
  const [fornOps, setFornOps] = useState<Forn[]>([]);
  const [catCod, setCatCod] = useState("");
  const [parc, setParc] = useState("");
  const [previsao, setPrevisao] = useState(addDias(hoje(), 7));
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [fornOrigem, setFornOrigem] = useState<string | null>(null);
  const [hist, setHist] = useState<Record<string, HistPreco[]>>({});
  const [salvando, setSalvando] = useState(false);

  // Carrega a RC (com o que já está coberto por outros PCs) e as listas de Compras.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const abertas = await json<{ id: number; num: string }[]>(await fetch(`/api/compras/buscar?tipo=rc&q=${encodeURIComponent(rc)}`));
        const alvo = abertas.find((x) => x.num === rc);
        if (!alvo) throw new Error(`A RC ${rc} não está aberta em Compras (já atendida ou cancelada).`);
        const [full, rf] = await Promise.all([
          json<RcFull>(await fetch(`/api/compras/pedido?id=${alvo.id}`)),
          json<Refs>(await fetch(`/api/compras/refs?emp=${encodeURIComponent(empresa)}`)),
        ]);
        if (!vivo) return;
        setRcFull(full); setRefs(rf);
        setParc(rf.parcelas[0]?.cod ?? "");
        const escolhidos = new Set(itensRc);
        setLinhas(full.itens.map((it) => {
          const falta = Math.max(0, (Number(it.qtd) || 0) - (Number(it.cov) || 0));
          return { it, on: falta > 0 && (!escolhidos.size || escolhidos.has(it.id)), qtd: falta, vu: Number(it.vu) || 0 };
        }));
        // Histórico de preço de cada item (por código) — base da sugestão e dos preços por fornecedor.
        const cods = [...new Set(full.itens.map((it) => (it.cod ?? "").trim()).filter(Boolean))];
        const hs: Record<string, HistPreco[]> = {};
        await Promise.all(cods.map(async (c) => {
          const h = await json<HistPreco[]>(await fetch(`/api/compras/buscar?tipo=preco&q=${encodeURIComponent(c)}`)).catch(() => []);
          hs[c] = (h ?? []).filter((x) => x.n !== full.num);
        }));
        if (!vivo) return;
        setHist(hs);
        // Fornecedor sugerido (06/10/26, Benny): o da RC → o sugerido nos itens da RC → o que mais vendeu estes itens.
        const obsSug = full.itens.map((it) => sugeridoNaObs(it.obs)).find(Boolean) ?? null;
        const histSug = maisComprado(hs);
        const [sug, origem] = (full.forn ?? "").trim() ? [full.forn!.trim(), "fornecedor da RC"]
          : obsSug ? [obsSug, "sugerido nos itens da RC"]
          : histSug ? [histSug, "quem mais vendeu estes itens (histórico de compras)"] : [null, null];
        if (sug) {
          setFornQ(sug);
          const ops = await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(sug.slice(0, 30))}`)).catch(() => []);
          if (!vivo) return;
          const f = (full.fornCod ? ops.find((o) => o.cod === full.fornCod) : null)
            ?? ops.find((o) => normForn(o.nome) === normForn(sug) || normForn(o.fantasia) === normForn(sug)) ?? ops[0];
          if (f) { escolherForn(f, rf); setFornOrigem(origem); }
        }
      } catch (e) { if (vivo) setErro((e as Error).message); }
    })();
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rc, empresa]);

  function escolherForn(f: Forn, rf: Refs | null = refs) {
    setForn(f); setFornQ(f.fantasia || f.nome); setFornOps([]);
    if (f.ultCatCod) setCatCod(f.ultCatCod);
    if (f.ultParc && rf?.parcelas.some((p) => p.cod === f.ultParc)) setParc(f.ultParc);
  }

  // Busca de fornecedor (digitando).
  useEffect(() => {
    if (!fornQ.trim() || (forn && fornQ === (forn.fantasia || forn.nome))) { setFornOps([]); return; }
    let vivo = true;
    const t = window.setTimeout(async () => {
      const ops = await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(fornQ.trim())}`)).catch(() => []);
      if (vivo) setFornOps(ops); // resposta atrasada não reabre a lista depois de escolher
    }, 250);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [fornQ, forn, empresa]);

  const ativos = linhas.filter((l) => l.on && l.qtd > 0);
  const total = useMemo(() => Math.round(ativos.reduce((a, l) => a + l.qtd * l.vu, 0) * 100) / 100, [ativos]);
  const cat = refs?.categorias.find((c) => c.cod === catCod);
  const dias = refs?.parcelas.find((p) => p.cod === parc)?.dias ?? [0];

  const montar = () => ({
    tipo: "PC", emp: rcFull!.emp || empresa,
    fornCod: forn?.cod ?? null, forn: forn?.nome ?? "", cnpj: forn?.cnpj ?? null,
    catCod: cat?.cod ?? "", cat: cat?.desc ?? "",
    comprador: rcFull!.comprador ?? null, compradorCod: rcFull!.compradorCod ?? null,
    projCod: rcFull!.projCod ?? null, proj: rcFull!.proj ?? "",
    contaCod: null, conta: "", parc, previsao, contato: forn?.ultContato ?? null, numForn: null, contrato: null,
    obs: obs || null, obsInt: `Gerado em Operação a partir da RC ${rcFull!.num}${rcFull!.pv ? ` (${rcFull!.pv})` : ""}`,
    pv: rcFull!.pv ?? "", pvCliente: rcFull!.pvCliente ?? "", frete: { tipo: TIPOS_FRETE[5] },
    semRc: false, semRcMotivo: null, avulsa: false, avulsaMotivo: null,
    itens: ativos.map((l) => ({ id: null, cod: l.it.cod ?? "", ncodProd: l.it.ncodProd ?? null, desc: l.it.desc, un: l.it.un ?? "UN",
      qtd: l.qtd, vu: l.vu, desc0: 0, ipi: 0, st: 0, ncm: l.it.ncm ?? null, local: null, obs: l.it.obs ?? null, rc: { itemId: l.it.id } })),
    parcelas: gerarParcelas(total, dias, previsao || hoje()), deptos: [],
    origemDe: `Gerado a partir da RC ${rcFull!.num}`,
  });

  const criar = async () => {
    setErro(null);
    if (!forn) { setErro('O "Fornecedor" deve ser preenchido.'); return; }
    if (!cat) { setErro('A "Categoria da Compra" deve ser preenchida.'); return; }
    if (!ativos.length) { setErro("Escolha pelo menos 1 item com quantidade."); return; }
    const acima = ativos.find((l) => l.qtd > (Number(l.it.qtd) || 0) - (Number(l.it.cov) || 0) + 1e-9);
    if (acima) { setErro(`"${acima.it.desc}": a quantidade passa do que falta atender na RC.`); return; }
    setSalvando(true);
    try {
      const r = await json<{ id: number; num: string }>(await fetch("/api/compras/pedido", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(montar()),
      }));
      onFeito(r.num, r.id);
    } catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  };

  const bt = (pri = false): React.CSSProperties => ({ height: 34, padding: "0 14px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
    border: `1px solid ${pri ? "var(--ww-accent, #4f7cff)" : "var(--ww-border-strong)"}`, background: pri ? "var(--ww-accent, #4f7cff)" : "transparent",
    color: pri ? "#fff" : "var(--ww-text)" });
  const lab: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0, fontSize: 12, color: "var(--ww-text-muted)" };
  const inp: React.CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", height: 34, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken, var(--ww-panel))", color: "var(--ww-text)", padding: "0 10px", fontSize: 13 };

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(5,10,20,.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={`Gerar pedido de compra da RC ${rc}`} onClick={(e) => e.stopPropagation()}
        style={{ width: "min(860px, 96vw)", maxHeight: "92vh", overflow: "auto", background: "var(--ww-panel)", color: "var(--ww-text)",
          border: "1px solid var(--ww-border-strong)", borderRadius: 14, boxShadow: "0 30px 80px rgba(0,0,0,.45)", padding: 20, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Gerar pedido de compra</h3>
          <span style={{ color: "var(--ww-text-muted)", fontSize: 13 }}>
            atende a RC {rc}{rcFull?.pv ? ` · ${rcFull.pv}` : ""}{rcFull?.proj ? ` · ${rcFull.proj}` : ""}
          </span>
          <button style={{ ...bt(), marginLeft: "auto", height: 28, padding: "0 10px" }} onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        {!rcFull && !erro && <div style={{ color: "var(--ww-text-muted)" }}>Carregando a RC…</div>}
        {rcFull && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
              <label style={{ ...lab, position: "relative" }}>Fornecedor
                <input style={inp} value={fornQ} placeholder="nome, fantasia ou CNPJ"
                  onChange={(e) => { setFornQ(e.target.value); setForn(null); setFornOrigem(null); }} />
                {fornOps.length > 0 && (
                  <div style={{ position: "absolute", top: 58, left: 0, right: 0, zIndex: 2, background: "var(--ww-panel)", border: "1px solid var(--ww-border-strong)", borderRadius: 8, maxHeight: 220, overflow: "auto" }}>
                    {fornOps.map((f) => (
                      <button key={f.cod} type="button" onClick={() => escolherForn(f)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: 0, color: "var(--ww-text)", cursor: "pointer", fontSize: 13 }}>
                        {f.fantasia || f.nome}<small style={{ color: "var(--ww-text-muted)" }}>{f.fantasia && f.fantasia !== f.nome ? ` · ${f.nome}` : ""}{f.cnpj ? ` · ${f.cnpj}` : ""}</small>
                      </button>
                    ))}
                  </div>
                )}
                {forn && fornOrigem
                  ? <small style={{ color: "var(--ww-text-faint)" }}>sugestão: {fornOrigem}</small>
                  : rcFull.forn ? <small style={{ color: "var(--ww-text-faint)" }}>sugerido na RC: {rcFull.forn}</small> : null}
              </label>
              <label style={lab}>Categoria da compra
                <select style={inp} value={catCod} onChange={(e) => setCatCod(e.target.value)}>
                  <option value="">Selecione…</option>
                  {refs?.categorias.map((c) => <option key={c.cod} value={c.cod}>{c.cod} · {c.desc}</option>)}
                </select>
              </label>
              <label style={lab}>Condição
                <select style={inp} value={parc} onChange={(e) => setParc(e.target.value)}>
                  {refs?.parcelas.map((p) => <option key={p.cod} value={p.cod}>{p.desc}</option>)}
                </select>
              </label>
              <label style={lab}>Previsão de entrega
                <input type="date" style={inp} value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
                {rcFull.previsao && <small style={{ color: previsao > rcFull.previsao ? "var(--ww-danger, #ef4444)" : "var(--ww-text-faint)" }}>
                  data limite de entrega (RC): {rcFull.previsao.split("-").reverse().join("/")}{previsao > rcFull.previsao ? " — previsão passa do limite" : ""}</small>}
              </label>
            </div>

            <div style={{ border: "1px solid var(--ww-border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 80px 100px 100px", gap: 8, padding: "8px 10px", fontSize: 11.5, color: "var(--ww-text-muted)", background: "var(--ww-panel-sunken, transparent)" }}>
                <span /><span>Item da RC</span><span style={{ textAlign: "right" }}>Qtd</span><span style={{ textAlign: "right" }}>Valor unit.</span><span style={{ textAlign: "right" }}>Total</span>
              </div>
              {linhas.map((l, i) => {
                const falta = Math.max(0, (Number(l.it.qtd) || 0) - (Number(l.it.cov) || 0));
                const atendido = falta <= 0;
                return (
                  <div key={l.it.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 80px 100px 100px", gap: 8, padding: "8px 10px", alignItems: "center", borderTop: "1px solid var(--ww-border)", opacity: atendido ? 0.5 : 1 }}>
                    <input type="checkbox" checked={l.on && !atendido} disabled={atendido}
                      onChange={() => setLinhas((x) => x.map((y, k) => (k === i ? { ...y, on: !y.on } : y)))} />
                    <div style={{ fontSize: 13 }}>{l.it.desc}
                      <small style={{ display: "block", color: "var(--ww-text-faint)" }}>
                        {l.it.cod ? `${l.it.cod} · ` : ""}RC {l.it.qtd} {l.it.un ?? "UN"}{Number(l.it.cov) > 0 ? ` · ${l.it.cov} já em PC` : ""}{atendido ? " · já atendido" : ""}
                      </small>
                      {!atendido && <PrecoDoItem linha={l} hist={hist[(l.it.cod ?? "").trim()] ?? []} forn={forn}
                        alternar={() => setLinhas((x) => x.map((y, k) => (k === i ? { ...y, verHist: !y.verHist } : y)))} />}
                    </div>
                    <input type="number" min={0} max={falta} step="any" style={{ ...inp, textAlign: "right", height: 30 }} disabled={atendido || !l.on} value={l.qtd}
                      onChange={(e) => { const v = Number(e.target.value); setLinhas((x) => x.map((y, k) => (k === i ? { ...y, qtd: v } : y))); }} />
                    <input type="number" min={0} step="0.01" style={{ ...inp, textAlign: "right", height: 30 }} disabled={atendido || !l.on} value={l.vu}
                      onChange={(e) => { const v = Number(e.target.value); setLinhas((x) => x.map((y, k) => (k === i ? { ...y, vu: v } : y))); }} />
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.on && !atendido ? money(l.qtd * l.vu) : "—"}</span>
                  </div>
                );
              })}
            </div>

            <label style={lab}>Observação para o fornecedor (opcional)
              <input style={inp} value={obs} onChange={(e) => setObs(e.target.value)} />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--ww-text-muted)" }}>
                {ativos.length} ite{ativos.length === 1 ? "m" : "ns"} · total <b style={{ color: "var(--ww-text)" }}>{money(total)}</b>
                {" · "}{dias.length} parcela{dias.length === 1 ? "" : "s"} a partir da previsão
              </span>
              <span style={{ marginLeft: "auto" }} />
              <button style={bt()} onClick={onFechar} disabled={salvando}>Cancelar</button>
              <button style={{ ...bt(true), opacity: salvando || !ativos.length ? 0.6 : 1 }} onClick={() => void criar()} disabled={salvando || !ativos.length}>
                {salvando ? "Criando…" : "Criar pedido de compra"}
              </button>
            </div>
            <small style={{ color: "var(--ww-text-faint)" }}>
              O pedido nasce em Compras, ligado à RC e ao {rcFull.pv || "PV/OS"}, e segue a aprovação de sempre. Itens que ficarem de fora continuam disponíveis para outro pedido (ex.: outro fornecedor). Departamentos, frete e conta corrente podem ser completados depois na folha completa em Compras.
            </small>
          </>
        )}
        {erro && <div style={{ color: "var(--ww-danger, #ef4444)", fontSize: 13 }}>{erro}</div>}
      </div>
    </div>
  );
}

/** Debaixo de cada item: o máximo da RC (▲/▼) e o que ESTE fornecedor já cobrou pelo item. */
function PrecoDoItem({ linha, hist, forn, alternar }: { linha: Linha; hist: HistPreco[]; forn: Forn | null; alternar: () => void }) {
  const max = Number(linha.it.vu) || 0;
  const vu = Number(linha.vu) || 0;
  const chip = (cor: string, txt: string) => (
    <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, border: `1px solid ${cor}`, color: cor, whiteSpace: "nowrap" }}>{txt}</span>);
  let vsMax: React.ReactNode = null;
  if (max > 0 && vu > 0) {
    const pct = ((vu - max) / max) * 100;
    vsMax = Math.abs(vu - max) < 0.005 ? chip("var(--ww-text-muted)", "= máximo da RC")
      : vu > max ? chip("var(--ww-danger, #ef4444)", `▲ ${pct.toFixed(2).replace(".", ",")}% acima do máximo da RC (máx ${money(max)})`)
      : chip("var(--ww-success, #22c55e)", `▼ redução de ${money((max - vu) * (linha.qtd || 1))} (${Math.abs(pct).toFixed(2).replace(".", ",")}%) vs máximo da RC`);
  }
  const doForn = forn ? hist.filter((x) => x.f && normForn(x.f) === normForn(forn.nome)) : [];
  const ult = doForn[0];
  const geral = hist[0];
  const min = doForn.length ? Math.min(...doForn.map((x) => x.vu)) : null;
  const avg = doForn.length ? doForn.reduce((a, x) => a + x.vu, 0) / doForn.length : null;
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 4, fontSize: 11.5, color: "var(--ww-text-muted)" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {vsMax}
        {forn && (ult
          ? <span>{forn.fantasia || forn.nome}: último <b style={{ color: "var(--ww-text)" }}>{money(ult.vu)}</b> em {dBR(ult.d)} (PC {ult.n}) · mín {money(min)} · média {money(avg)} · {doForn.length} compra{doForn.length === 1 ? "" : "s"}</span>
          : <span>{forn.fantasia || forn.nome}: sem compras deste item{geral ? <> · último geral {money(geral.vu)} em {dBR(geral.d)}{geral.f ? ` (${geral.f})` : ""}</> : ""}</span>)}
        {!forn && geral && <span>último {money(geral.vu)} em {dBR(geral.d)}{geral.f ? ` · ${geral.f}` : ""}</span>}
        {hist.length > 0 && <button type="button" onClick={alternar}
          style={{ background: "none", border: 0, padding: 0, color: "var(--ww-accent, #4f7cff)", cursor: "pointer", fontSize: 11.5, textDecoration: "underline" }}>
          {linha.verHist ? "fechar histórico" : `histórico (${hist.length})`}</button>}
      </div>
      {linha.verHist && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead><tr style={{ color: "var(--ww-text-faint)", textAlign: "left" }}><th>Data</th><th>PC</th><th>Fornecedor</th><th style={{ textAlign: "right" }}>Qtd</th><th style={{ textAlign: "right" }}>Valor unit.</th></tr></thead>
          <tbody>{hist.map((x, j) => {
            const deste = !!forn && !!x.f && normForn(x.f) === normForn(forn.nome);
            return (
              <tr key={j} style={{ color: deste ? "var(--ww-text)" : undefined, fontWeight: deste ? 600 : 400 }}>
                <td>{dBR(x.d)}</td><td>{x.n}</td><td>{x.f ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{x.q}</td><td style={{ textAlign: "right" }}>{money(x.vu)}</td>
              </tr>);
          })}</tbody>
        </table>
      )}
    </div>
  );
}
