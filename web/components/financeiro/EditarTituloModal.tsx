"use client";

/**
 * Editar título a pagar / a receber (05/10/26, sql/80) — aberto pelo drawer e
 * pelo ✎ da linha nas telas Pagar v3 e Receber v1.
 *  · Omie: o ajuste fica no painel (finance.titulo_ajustes) e vale no BI, fluxo,
 *    conciliação, arquivo C6 e fichas; o Omie não é tocado. "Desfazer ajuste"
 *    volta ao valor original. Recorrência do Omie: "esta e as próximas".
 *  · Painel: edita a conta; série do painel aceita "esta / próximas / todas".
 *  · Previsão de PC: mudar o valor exige motivo (o total deixa de bater com o PC).
 * Valor nunca abaixo do que já foi pago — o servidor recusa.
 */
import { useEffect, useMemo, useState } from "react";

type Titulo = {
  ref: string; natureza: "P" | "R"; empresa: string; origem: "omie" | "manual" | "pc"; pc?: string | null;
  valor: number; pago: number; vencimento: string; previsao: string | null;
  categoria_cod: string | null; conta_cod: number | null; projeto_cod: string | number | null;
  contraparte_cod: number | null; contraparte_nome: string | null; documento: string | null; obs: string | null;
  serie: { tipo: "omie" | "painel"; id: string | number; proximas: number } | null;
  ajuste: { orig: { valor?: number; vencimento?: string }; novo?: Record<string, unknown>; motivo?: string | null; por?: string | null; em?: string | null } | null;
};
type Aux = { categorias: { codigo: string; descricao: string }[]; contas_correntes: { cod_cc: number; descricao: string }[]; projetos: { codigo: number; nome: string }[] };
type Cli = { codigo_cliente_omie: number; nome_fantasia: string | null; razao_social: string | null; cnpj_cpf: string | null };

const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v: number) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => Number(String(s).replace(/\s/g, "").replace(/\./g, "").replace(",", ".")) || 0;
const dbr = (iso?: string | null) => (iso ? new Date(String(iso).slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR") : "—");
const s = (v: unknown) => (v == null ? "" : String(v));

export default function EditarTituloModal({ tipo, refTit, onClose, onDone }: { tipo: "pagar" | "receber"; refTit: string; onClose: () => void; onDone: () => void }) {
  const [t, setT] = useState<Titulo | null>(null);
  const [aux, setAux] = useState<Aux>({ categorias: [], contas_correntes: [], projetos: [] });
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const [f, setF] = useState({ valor: "", vencimento: "", previsao: "", categoria_cod: "", conta_cod: "", projeto_cod: "", documento: "", obs: "", motivo: "" });
  const [escopo, setEscopo] = useState<"esta" | "proximas" | "todas">("esta");
  const [cli, setCli] = useState<{ cod: number; nome: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Cli[]>([]);
  const api = `/api/financeiro/${tipo}`;
  const rotCp = tipo === "pagar" ? "Fornecedor" : "Cliente";

  async function carregar() {
    const r = await fetch(`${api}?editar=${encodeURIComponent(refTit)}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Erro ao abrir o título"); return; }
    const x = j.titulo as Titulo;
    setT(x);
    setF({ valor: fmt(x.valor), vencimento: s(x.vencimento).slice(0, 10), previsao: s(x.previsao).slice(0, 10), categoria_cod: s(x.categoria_cod),
      conta_cod: s(x.conta_cod), projeto_cod: s(x.projeto_cod), documento: s(x.documento), obs: s(x.obs), motivo: "" });
    setCli(x.contraparte_cod ? { cod: x.contraparte_cod, nome: x.contraparte_nome ?? "" } : null);
    const a = await fetch(`/api/financeiro/aux?empresa=${x.empresa}&tipo=${tipo}`).then((y) => y.json()).catch(() => null);
    if (a) setAux({ categorias: a.categorias ?? [], contas_correntes: a.contas_correntes ?? [], projetos: a.projetos ?? [] });
  }
  useEffect(() => { carregar(); }, [refTit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!t || busca.trim().length < 2) { setAchados([]); return; }
    const h = setTimeout(async () => {
      const r = await fetch(`/api/financeiro/aux?empresa=${t.empresa}&tipo=${tipo}&q=${encodeURIComponent(busca.trim())}`).then((y) => y.json()).catch(() => null);
      setAchados(r?.clientes ?? []);
    }, 250);
    return () => clearTimeout(h);
  }, [busca, t, tipo]);

  const omie = t?.origem === "omie", pc = t?.origem === "pc";
  const vNovo = num(f.valor);
  const mudouValor = !!t && Math.abs(vNovo - Number(t.valor)) > 0.004;
  const temSerie = !!t?.serie && t.serie.proximas > 0;
  const so = escopo === "esta";
  const abaixo = !!t && mudouValor && vNovo < Number(t.pago) - 0.004;
  // categoria/conta/projeto que não estão nas listas (inativos) continuam visíveis
  const catOpts = useMemo(() => (f.categoria_cod && !aux.categorias.some((c) => c.codigo === f.categoria_cod) ? [{ codigo: f.categoria_cod, descricao: f.categoria_cod }] : []).concat(aux.categorias), [aux, f.categoria_cod]);

  async function post(body: Record<string, unknown>) {
    setIndo(true); setErro("");
    const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: refTit, ...body }) });
    const j = await r.json().catch(() => ({}));
    setIndo(false);
    if (!r.ok) { setErro(j.error ?? "Erro"); return null; }
    return j;
  }

  async function salvar() {
    if (!t) return;
    const c: Record<string, unknown> = {};
    if (mudouValor) c.valor = Math.round(vNovo * 100) / 100;
    if (so && f.vencimento && f.vencimento !== s(t.vencimento).slice(0, 10)) c.vencimento = f.vencimento;
    if (so && f.previsao && f.previsao !== s(t.previsao).slice(0, 10) && !(c.vencimento && f.previsao === f.vencimento)) c.previsao = f.previsao;
    if (f.categoria_cod !== s(t.categoria_cod)) c.categoria_cod = f.categoria_cod || null;
    if (f.conta_cod !== s(t.conta_cod)) c.conta_cod = f.conta_cod ? Number(f.conta_cod) : null;
    if (f.projeto_cod !== s(t.projeto_cod)) c.projeto_cod = f.projeto_cod || null;
    if (!omie && f.documento !== s(t.documento)) c.documento = f.documento;
    if (f.obs !== s(t.obs)) c.obs = f.obs;
    if (t.origem === "manual" && cli && cli.cod !== t.contraparte_cod) c.contraparte_cod = cli.cod;
    if (!Object.keys(c).length) { setErro("Nada mudou"); return; }
    if (abaixo) { setErro(`O valor não pode ficar abaixo do que já foi pago (${brl(t.pago)})`); return; }
    if (pc && mudouValor && f.motivo.trim().length < 5) { setErro("Previsão de PC: escreva o motivo para mudar o valor"); return; }
    const j = await post({ acao: "editar", campos: c, escopo, motivo: f.motivo.trim() || null });
    if (!j) return;
    onDone(); onClose();
  }

  async function desfazer() {
    if (!t?.ajuste || !confirm(`Voltar ao valor original do Omie (${brl(Number(t.ajuste.orig?.valor ?? 0))})?`)) return;
    const j = await post({ acao: "desfazer_ajuste" });
    if (!j) return;
    onDone(); onClose();
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="cp3">
      <div className="ov on" onClick={onClose} />
      <div className="modal on" style={{ width: "min(680px,95vw)" }}>
        <div className="dh"><div><h3 style={{ margin: 0 }}>Editar {tipo === "pagar" ? "conta a pagar" : "conta a receber"}</h3>
          <div className="sub2" style={{ marginTop: 3 }}>{t ? `${t.empresa} · ${t.contraparte_nome ?? "—"} · ${omie ? "título do Omie" : pc ? `previsão do PC ${t.pc ?? ""}` : "conta do painel"}` : "carregando…"}</div></div>
          <button className="btn" style={{ height: 34 }} onClick={onClose}>✕</button></div>
        <div className="dbody" style={{ overflow: "auto" }}>
          {erro && <div className="verdict bloq" style={{ marginBottom: 10 }}><b>Atenção</b><span>{erro}</span></div>}
          {t && omie && <div className="verdict dir" style={{ marginBottom: 10 }}><b>Título do Omie</b><span>A alteração fica no painel e vale no BI, no fluxo de caixa, na conciliação, no arquivo C6 e nas fichas. O Omie não é alterado.</span></div>}
          {t && pc && <div className="verdict nf" style={{ marginBottom: 10 }}><b>Previsão de PC</b><span>Mudar o valor faz o total das parcelas deixar de bater com o pedido de compra — diga o motivo.</span></div>}
          {t?.ajuste && <div className="box" style={{ marginBottom: 10 }}><h4>Ajustado no painel</h4>
            <div className="sub2">valor original {brl(Number(t.ajuste.orig?.valor ?? 0))}{t.ajuste.orig?.vencimento && omie ? ` · venc. original ${dbr(t.ajuste.orig.vencimento)}` : ""}{t.ajuste.por ? ` · por ${String(t.ajuste.por).split("@")[0]}` : ""}{t.ajuste.em ? ` em ${new Date(t.ajuste.em).toLocaleDateString("pt-BR")}` : ""}{t.ajuste.motivo ? ` · ${t.ajuste.motivo}` : ""}</div>
            {omie && <div style={{ marginTop: 8 }}><button className="btn sm" disabled={indo} onClick={desfazer}>Desfazer ajuste</button></div>}</div>}
          {t && (
            <div className="frm">
              {temSerie && <label className="full">Aplicar a
                <select value={escopo} onChange={(e) => setEscopo(e.target.value as typeof escopo)}>
                  <option value="esta">Só esta</option>
                  <option value="proximas">Esta e as próximas desta série ({t.serie!.proximas} em aberto)</option>
                  {t.serie!.tipo === "painel" && <option value="todas">Todas as não pagas da série</option>}
                </select></label>}
              <label>Valor<input className={`num ${abaixo ? "need" : ""}`} value={f.valor} onChange={set("valor")} />
                {t.pago > 0.004 && <span className="sub2">já pago {brl(t.pago)} — não pode ficar abaixo</span>}</label>
              <label>Vencimento<input type="date" value={f.vencimento} onChange={set("vencimento")} disabled={!so} title={so ? "" : "Vencimento só se muda nesta ocorrência"} /></label>
              <label>Previsão de {tipo === "pagar" ? "pagamento" : "recebimento"}<input type="date" value={f.previsao} onChange={set("previsao")} disabled={!so} /></label>
              <label>Categoria<select value={f.categoria_cod} onChange={set("categoria_cod")}><option value="">—</option>{catOpts.map((c) => <option key={c.codigo} value={c.codigo}>{c.descricao} ({c.codigo})</option>)}</select></label>
              <label>Conta corrente<select value={f.conta_cod} onChange={set("conta_cod")}><option value="">—</option>
                {f.conta_cod && !aux.contas_correntes.some((c) => String(c.cod_cc) === f.conta_cod) && <option value={f.conta_cod}>{f.conta_cod}</option>}
                {aux.contas_correntes.map((c) => <option key={c.cod_cc} value={String(c.cod_cc)}>{c.descricao}</option>)}</select></label>
              <label>Projeto<select value={f.projeto_cod} onChange={set("projeto_cod")}><option value="">—</option>
                {f.projeto_cod && !aux.projetos.some((p) => String(p.codigo) === f.projeto_cod) && <option value={f.projeto_cod}>{f.projeto_cod}</option>}
                {aux.projetos.map((p) => <option key={p.codigo} value={String(p.codigo)}>{p.nome}</option>)}</select></label>
              {!omie && <label>Documento<input value={f.documento} onChange={set("documento")} /></label>}
              {t.origem === "manual" && <label className="full">{rotCp}
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={cli ? `${cli.nome} — digite para trocar` : "buscar por nome ou CNPJ"} />
                {achados.length > 0 && <div className="gl" style={{ maxHeight: 160, overflow: "auto", marginTop: 4 }}>
                  {achados.map((c) => <div key={c.codigo_cliente_omie} style={{ cursor: "pointer" }} onClick={() => { setCli({ cod: c.codigo_cliente_omie, nome: c.nome_fantasia || c.razao_social || "" }); setBusca(""); setAchados([]); }}>
                    <span>{c.nome_fantasia || c.razao_social}</span><span className="sub2">{c.cnpj_cpf}</span></div>)}</div>}
                {cli && <span className="sub2">atual: {cli.nome}</span>}</label>}
              <label className="full">Observação<input value={f.obs} onChange={set("obs")} /></label>
              <label className="full">Motivo{pc && mudouValor ? " (obrigatório)" : " (opcional, fica no histórico)"}<input className={pc && mudouValor && f.motivo.trim().length < 5 ? "need" : ""} value={f.motivo} onChange={set("motivo")} placeholder="Ex.: valor deste mês veio diferente" /></label>
            </div>
          )}
        </div>
        <div className="df">
          <span style={{ marginLeft: "auto" }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn ok" disabled={indo || !t} onClick={salvar}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
