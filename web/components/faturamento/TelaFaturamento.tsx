"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { PaginaNavy } from "@/components/navy/tela/KitTela";
import { limpo } from "@/lib/faturamento/montar";
import NovaEmissao, { type ConfigFat } from "@/components/faturamento/NovaEmissao";
import RegistrarNfse from "@/components/faturamento/RegistrarNfse";
import "./faturamento.css";

/* Faturamento PV & OS (05/10/2026) — conceito do mockup do Benny
   (faturamento-pv-os-mockup.html): controle do que já foi faturado e do que
   falta faturar. PV → NF-e mercantil (Focus), OS → NFS-e/recibo.
   Dados reais de orders.fat_carteira (Omie + nativos do painel); ações reais
   pelo /api/faturamento/carteira (Validar = pré-voo sem enviar, Ensaio =
   homologação, Emitir = ambiente da empresa — produção só com a chave do
   Benny). O Kanban mostra as etapas derivadas dos dados (não se arrasta). */

// ── tipos ────────────────────────────────────────────────────────────────────
type Nf = {
  id?: number; num: string; valor: number; status: string; data: string | null; ambiente: string;
  msg?: string | null; xml?: boolean; pdf?: boolean; fonte: "omie" | "painel" | "prefeitura";
  nfse_manual?: boolean; municipio?: string;
};
type Doc = {
  chave: string; codigo: number | string; tipo: "PV" | "OS"; rotulo: string; origem: string; etapa: string | null;
  cliente: string | null; oc: string | null; valor: number; emissao: string | null; faturado: number;
  nfs: Nf[]; pend: string[]; emite: boolean; emite_motivo?: string; descricao?: string | null;
  itens?: { desc: string | null; qtd: number | null; vt: number | null }[];
  /** OS: aceita NFS-e da prefeitura registrada no painel (sql/59). */
  nfse?: boolean; nfse_registrada?: boolean; aguarda_nfse?: boolean;
};
type St = "pend" | "pronto" | "emis" | "rej" | "parc" | "fat";
type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };
type Prevoo = { checagens: Checagem[]; payload: unknown; total: number; pode_emitir: boolean; ambiente: string; parcelas: { vencimento: string; valor: number }[] };
type ItemDoc = { codigo?: string; descricao: string; quantidade: number; valor_unitario: number; valor_frete?: number | null; valor_desconto?: number | null; ncm?: string | null; unidade?: string };
type Pront = {
  config: { ambiente: string; producao_liberada: boolean; natureza_operacao: string; nfe_serie_producao: string; nfe_proximo_producao: number | null; omie_nfe_desligado_em: string | null };
  focus: { habilita_nfe?: boolean; certificado_valido_ate?: string } | null;
  focus_erro: string | null; token_producao_env: boolean;
  ultima_nfe_omie: { numero: string; serie: string; emissao: string } | null;
  conflito_numeracao: string | null; pode_mudar: boolean;
};
type Emissao = {
  id: number; empresa: string; ambiente: string; tipo: string; origem_tipo: string; origem_id: string | null; origem_rotulo?: string | null;
  cliente: { nome?: string } | null; status: string; mensagem: string | null; numero: string | null; serie: string | null;
  valor_total: number; xml_path: string | null; pdf_path: string | null; receber_ids: string[] | null; created_at: string; ensaio?: boolean;
};

// ── formatação ───────────────────────────────────────────────────────────────
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v: number) => BRL.format(v || 0);
const fmtK = (v: number) => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return fmt(v);
};
const hoje = () => new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T12:00:00");
const dias = (iso: string | null) => (iso ? Math.round((hoje().getTime() - new Date(iso + "T12:00:00").getTime()) / 864e5) : 0);
const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—");
const curto = (s: string | null) => limpo(s ?? "").replace(/ S\.?\/?A\.?$| LTDA\.?$/i, "").replace("SOC BEN ISRAELITA BRAS HOSP", "HOSP.").replace("SOC .BENEF .DE SRAS.", "");
const saldo = (d: Doc) => Math.max(0, Number(d.valor) - Number(d.faturado));
const nfsAut = (d: Doc) => d.nfs.filter((n) => n.status === "autorizada" && n.ambiente === "producao");
/** OS que ainda não tem NFS-e registrada e tem saldo a faturar. */
const semNfse = (d: Doc) => d.tipo === "OS" && !!d.nfse && !d.nfse_registrada && status(d) !== "fat";

function status(d: Doc): St {
  if (Number(d.faturado) >= Number(d.valor) - 0.01 && Number(d.valor) > 0) return "fat";
  const painel = d.nfs.filter((n) => n.fonte === "painel");
  const ult = painel[painel.length - 1];
  if (ult && ult.status === "processando") return "emis";
  if (ult && (ult.status === "rejeitada" || ult.status === "erro")) return "rej";
  if (Number(d.faturado) > 0) return "parc";
  if (d.pend.length) return "pend";
  return "pronto";
}
const ST: Record<St, { l: string; c: string; col: string }> = {
  pend: { l: "Com pendência", c: "s-pend", col: "var(--f-mute)" },
  pronto: { l: "Pronto p/ faturar", c: "s-pronto", col: "var(--f-blue)" },
  emis: { l: "Em emissão", c: "s-emis", col: "var(--f-warn)" },
  rej: { l: "Rejeitada", c: "s-rej", col: "var(--f-bad)" },
  parc: { l: "Parcial", c: "s-parc", col: "var(--f-warn)" },
  fat: { l: "Faturado", c: "s-fat", col: "var(--f-ok)" },
};
const COLS: { k: St; t: string; hint: string; incl?: St[] }[] = [
  { k: "pend", t: "Com pendência", hint: "Cadastro ou valor — não emite" },
  { k: "pronto", t: "Pronto p/ faturar", hint: "Aguardando emissão" },
  { k: "emis", t: "Em emissão", hint: "Na Focus/SEFAZ ou rejeitado", incl: ["emis", "rej"] },
  { k: "parc", t: "Faturado parcial", hint: "Tem NF autorizada e saldo" },
  { k: "fat", t: "Faturado", hint: "100% coberto por NF autorizada" },
];
const ETAPA_PV: Record<string, string> = { "10": "Pedido", "20": "Separar", "50": "Faturar", "60": "Faturado", "70": "Entregue" };
const ETAPA_OS: Record<string, string> = { "10": "Em aberto", "20": "Execução", "30": "Executada", "50": "Faturar", "60": "Faturada" };
const etapaRot = (d: Doc) => (d.origem === "Omie" ? (d.tipo === "PV" ? ETAPA_PV : ETAPA_OS)[d.etapa ?? ""] ?? d.etapa : d.etapa) ?? "";

// ── períodos ─────────────────────────────────────────────────────────────────
function desdePeriodo(p: string): string {
  const h = hoje();
  const y = h.getFullYear(), m = h.getMonth();
  const d = p === "ano" ? new Date(y, 0, 1) : p === "tri" ? new Date(y, Math.floor(m / 3) * 3, 1) : new Date(y, m, 1);
  return d.toLocaleDateString("sv-SE");
}
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const EMPRESAS: Record<string, string> = { SF: "SafeWater", WW: "WaterWorks", CD: "CD" };

export default function TelaFaturamento() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [config, setConfig] = useState<ConfigFat[]>([]);
  const [pront, setPront] = useState<Pront | null>(null);
  const [emissoes, setEmissoes] = useState<Emissao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState("SF");
  const [periodo, setPeriodo] = useState("mes");
  const [tipo, setTipo] = useState<"all" | "PV" | "OS">("all");
  const [view, setView] = useState<"list" | "kanban" | "emissoes" | "nfse">("list");
  const [regNfse, setRegNfse] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [orig, setOrig] = useState("");
  const [fst, setFst] = useState<"" | St>("");
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [kpi, setKpi] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: "emissao", d: -1 });
  const [aberto, setAberto] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verPront, setVerPront] = useState(false);

  const avisar = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 4200); }, []);

  const carregar = useCallback(async () => {
    try {
      const [a, b, c, d] = await Promise.all([
        fetch(`/api/faturamento/carteira?empresa=${empresa}&desde=${desdePeriodo(periodo)}`, { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/faturamento/config", { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/faturamento/prontidao?empresa=${empresa}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/faturamento/emissoes", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (a.error) throw new Error(a.error);
      setDocs(a.docs ?? []);
      setConfig(b.config ?? []);
      if (c && !c.error) setPront(c);
      setEmissoes((d.emissoes ?? []).filter((e: Emissao) => e.empresa === empresa));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [empresa, periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  const cfg = config.find((c) => c.empresa === empresa);
  const prod = cfg?.ambiente === "producao" && !!cfg?.producao_liberada;
  const empresas = config.filter((c) => c.ativo).map((c) => c.empresa);

  // ── recortes ──
  const base = useMemo(() => (docs ?? []).filter((d) => tipo === "all" || d.tipo === tipo), [docs, tipo]);
  const filtrados = useMemo(() => base.filter((d) => {
    const st = status(d);
    if (orig && d.origem !== orig) return false;
    if (fst && st !== fst) return false;
    if (kpi) {
      if (kpi === "saldo" && st === "fat") return false;
      if (kpi === "fat" && Number(d.faturado) === 0) return false;
      if (kpi === "parc" && st !== "parc") return false;
      if (kpi === "pend" && !["pend", "rej"].includes(st)) return false;
      if (kpi === "old" && (st === "fat" || dias(d.emissao) <= 30)) return false;
    }
    if (chips.has("semoc") && d.oc) return false;
    if (chips.has("old") && dias(d.emissao) <= 30) return false;
    if (chips.has("saldo") && st === "fat") return false;
    if (chips.has("semnfse") && !semNfse(d)) return false;
    if (q) {
      const h = `${d.rotulo} ${d.cliente ?? ""} ${d.oc ?? ""} ${d.descricao ?? ""} ${d.nfs.map((n) => n.num).join(" ")}`.toLowerCase();
      if (!h.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [base, orig, fst, kpi, chips, q]);

  const ordenados = useMemo(() => {
    const k = sort.k, dir = sort.d;
    const val = (d: Doc): number | string => k === "saldo" ? saldo(d) : k === "pct" ? Number(d.faturado) / (Number(d.valor) || 1)
      : k === "valor" || k === "faturado" ? Number(d[k]) : k === "emissao" ? d.emissao ?? "" : k === "doc" ? d.rotulo : (d.cliente ?? "");
    return [...filtrados].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  }, [filtrados, sort]);

  // ── ações ──
  async function agir(d: Doc, acao: "prevoo" | "ensaio" | "emitir" | "doc") {
    if (acao === "emitir") {
      const msg = prod
        ? `EMITIR ${d.tipo === "PV" ? "NF-e" : "nota"} DE PRODUÇÃO (documento fiscal real) do ${d.rotulo} — ${limpo(d.cliente ?? "")} — ${fmt(saldo(d))}?`
        : `Emitir o ${d.rotulo} em HOMOLOGAÇÃO (sem valor fiscal)?`;
      if (!window.confirm(msg)) return null;
    }
    setOcupado(`${acao}:${d.chave}`);
    const r = await fetch("/api/faturamento/carteira", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresa, chave: d.chave, acao }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(null);
    if (r.error && acao !== "prevoo") { avisar(`${d.rotulo}: ${r.error}`); return null; }
    if (acao === "ensaio" || acao === "emitir") {
      const e = r.emissao;
      avisar(`${acao === "ensaio" ? "Ensaio (homologação)" : "Emissão"} #${e.id} · ${d.rotulo}: ${e.status}${e.numero ? ` nº ${e.numero}` : ""}${e.mensagem ? ` — ${e.mensagem}` : ""}`);
      carregar();
    }
    return r;
  }

  async function validarLote() {
    const lista = ordenados.filter((d) => sel.has(d.chave) && d.emite);
    let ok = 0, ruim = 0;
    for (const d of lista) {
      const r = await agir(d, "prevoo");
      if (r && r.pode_emitir) ok++; else ruim++;
    }
    avisar(`Validação em lote: ${ok} pronto(s) para emitir · ${ruim} com pendência${lista.length < sel.size ? ` · ${sel.size - lista.length} OS do Omie fora do lote` : ""}`);
  }

  function exportar() {
    const linhas = [["Tipo", "Documento", "Origem", "Cliente", "OC", "Emissão", "Valor", "Faturado", "Falta faturar", "Status", "Notas"]]
      .concat(ordenados.map((d) => [d.tipo, d.rotulo, d.origem, limpo(d.cliente ?? ""), d.oc ?? "", dataBR(d.emissao),
        String(d.valor).replace(".", ","), String(d.faturado).replace(".", ","), String(saldo(d).toFixed(2)).replace(".", ","),
        ST[status(d)].l, d.nfs.map((n) => n.num).join(" / ")]));
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `faturamento-${empresa}-${desdePeriodo(periodo)}.csv`;
    a.click();
  }

  const docAberto = aberto ? (docs ?? []).find((d) => d.chave === aberto) ?? null : null;
  const h = hoje();
  const rotPeriodo: Record<string, string> = { mes: `${MESES[h.getMonth()]}/${String(h.getFullYear()).slice(2)}`, tri: "Trimestre", ano: String(h.getFullYear()) };

  return (
    <PaginaNavy>
      <div className="fpv">
        <div className="head">
          <div>
            <div className="crumb">Financeiro › Faturamento</div>
            <h1>Pedidos &amp; Ordens de Serviço</h1>
            <div className="sub">
              Controle do que já foi faturado e do que falta faturar · PV → NF-e mercantil · OS → NFS-e ·{" "}
              {prod ? <b className="prod">{empresa} em PRODUÇÃO</b> : <b>{empresa} em homologação</b>}
            </div>
          </div>
          <div className="actions">
            <button className="btn" onClick={exportar}>Exportar</button>
            <button className="btn" onClick={() => { setDocs(null); carregar(); }}>Recarregar</button>
            <button className="btn" onClick={() => setVerPront((v) => !v)}>Prontidão</button>
            <button className="btn pri" onClick={() => setNova((v) => !v)}>{nova ? "Fechar" : "+ Nova emissão"}</button>
          </div>
        </div>

        {erro && <div className="alert bad" onClick={() => setErro(null)}>{erro}</div>}
        <Prontidao p={pront} empresa={empresa} aberto={verPront} onMudou={carregar} />
        {nova && (
          <div style={{ marginBottom: 16 }}>
            <NovaEmissao config={config} ocupado={ocupado === "nova"} onEmitir={async (body) => {
              setOcupado("nova");
              const r = await fetch("/api/faturamento/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
                .then((x) => x.json()).catch((e) => ({ error: String(e) }));
              setOcupado(null);
              if (r.error) { avisar(r.error); return; }
              avisar(`Emissão #${r.emissao.id}: ${r.emissao.status}${r.emissao.mensagem ? ` — ${r.emissao.mensagem}` : ""}`);
              setNova(false); carregar();
            }} />
          </div>
        )}

        <div className="toolbar">
          <div className="seg">
            {(["all", "PV", "OS"] as const).map((t) => (
              <button key={t} className={tipo === t ? "on" : ""} onClick={() => setTipo(t)}>
                {t !== "all" && <span className="dot" style={{ background: t === "PV" ? "var(--f-pv)" : "var(--f-os)" }} />}
                {t === "all" ? "Todos" : t === "PV" ? "PV · Produto" : "OS · Serviço"}
                <span className="ct">{(docs ?? []).filter((d) => t === "all" || d.tipo === t).length}</span>
              </button>
            ))}
          </div>
          <div className="seg">
            {(["mes", "tri", "ano"] as const).map((p) => (
              <button key={p} className={periodo === p ? "on" : ""} onClick={() => setPeriodo(p)} title="Período do faturado (a carteira em aberto aparece sempre)">{rotPeriodo[p]}</button>
            ))}
          </div>
          {empresas.length > 1 && (
            <div className="seg">
              {empresas.map((e) => <button key={e} className={empresa === e ? "on" : ""} onClick={() => setEmpresa(e)}>{EMPRESAS[e] ?? e}</button>)}
            </div>
          )}
        </div>

        {!docs ? <div className="empty">Carregando a carteira…</div> : (
          <>
            <Kpis base={base} todos={docs} kpi={kpi} setKpi={setKpi} />
            <Mix docs={docs} base={base} />
          </>
        )}

        <div className="filters">
          <div className="seg">
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>☰ Lista</button>
            <button className={view === "kanban" ? "on" : ""} onClick={() => setView("kanban")}>▦ Kanban</button>
            <button className={view === "emissoes" ? "on" : ""} onClick={() => setView("emissoes")}>⎙ Emissões</button>
            <button className={view === "nfse" ? "on" : ""} onClick={() => setView("nfse")}>🏛 NFS-e registradas</button>
          </div>
          <div className="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar PV, OS, cliente, OC, NF…" />
          </div>
          {view !== "emissoes" && view !== "nfse" && <>
            <select className="sel" value={orig} onChange={(e) => setOrig(e.target.value)}>
              <option value="">Origem: todas</option><option>Omie</option><option>Painel</option><option>CRM</option>
            </select>
            <select className="sel" value={fst} onChange={(e) => setFst(e.target.value as St | "")}>
              <option value="">Status: todos</option>
              {(Object.keys(ST) as St[]).map((k) => <option key={k} value={k}>{ST[k].l}</option>)}
            </select>
            {([["semoc", "Sem OC"], ["old", "> 30 dias"], ["saldo", "Só com saldo"], ["semnfse", `OS sem NFS-e · ${(docs ?? []).filter(semNfse).length}`]] as const).map(([k, l]) => (
              <button key={k} className={`chipf ${chips.has(k) ? "on" : ""}`} title={k === "semnfse" ? "OS faturáveis sem NFS-e registrada (emitida na prefeitura)" : undefined}
                onClick={() => setChips((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{l}</button>
            ))}
          </>}
        </div>
        {view === "list" && sel.size > 0 && (
          <div className="bulk">
            <span><b>{sel.size}</b> selecionados · saldo <b>{fmt((docs ?? []).filter((d) => sel.has(d.chave)).reduce((a, d) => a + saldo(d), 0))}</b></span>
            <span style={{ marginLeft: "auto" }} />
            <button className="btn sm" onClick={() => setSel(new Set())}>Limpar</button>
            <button className="btn sm w" disabled={!!ocupado} onClick={validarLote}>{ocupado ? "Validando…" : "Validar lote"}</button>
            {(() => {
              const oss = (docs ?? []).filter((d) => sel.has(d.chave) && semNfse(d));
              return oss.length > 0 && oss.length === sel.size
                ? <button className="btn sm" onClick={() => setRegNfse(oss.map((d) => d.chave))}>Registrar NFS-e ({oss.length} OS)</button> : null;
            })()}
          </div>
        )}

        {view === "list" && (docs ? <Lista rows={ordenados} sel={sel} setSel={setSel} sort={sort} setSort={setSort} abrir={setAberto} ocupado={ocupado} agir={agir} prod={prod} registrar={(d) => setRegNfse([d.chave])} /> : null)}
        {view === "kanban" && (docs ? <Kanban rows={filtrados} abrir={setAberto} /> : null)}
        {view === "emissoes" && <Emissoes lista={emissoes} q={q} onMudou={carregar} avisar={avisar} />}
        {view === "nfse" && <NfseRegistradas empresa={empresa} q={q} onMudou={carregar} avisar={avisar} />}

        <p style={{ color: "var(--f-tx3)", fontSize: 12, marginTop: 12 }}>
          Carteira: PV/OS em aberto (todas as datas) + faturados no período. PV do Omie fatura pelo painel (NF-e, Focus). NFS-e: emita no portal da prefeitura e registre-a aqui (Registrar NFS-e) — cria o contas a receber pelo líquido e marca a OS como faturada no painel.
          Envio ao cliente por e-mail depende do Resend (RESEND_API_KEY) — até lá, abra o PDF/XML e envie o link.
        </p>

        {docAberto && <Gaveta d={docAberto} empresa={empresa} prod={prod} ocupado={ocupado} agir={agir} fechar={() => setAberto(null)} avisar={avisar} onMudou={carregar}
          registrar={() => { setRegNfse([docAberto.chave]); setAberto(null); }} />}
        {regNfse && <RegistrarNfse empresa={empresa} chaves={regNfse} avisar={avisar} fechar={() => setRegNfse(null)}
          feito={() => { setRegNfse(null); setSel(new Set()); carregar(); }} />}
        {toast && <div className="fpv-toast" onClick={() => setToast(null)}>{toast}</div>}
      </div>
    </PaginaNavy>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
function Anel({ p, cor }: { p: number; cor: string }) {
  const r = 17, c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--f-line)" strokeWidth="5" />
      <circle cx="22" cy="22" r={r} fill="none" stroke={cor} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * Math.min(1, p)} ${c}`} transform="rotate(-90 22 22)" />
    </svg>
  );
}

function Kpis({ base, kpi, setKpi }: { base: Doc[]; todos: Doc[]; kpi: string | null; setKpi: (k: string | null) => void }) {
  const tot = base.reduce((a, d) => a + Number(d.valor), 0);
  const fat = base.reduce((a, d) => a + Number(d.faturado), 0);
  const comSaldo = base.filter((d) => status(d) !== "fat");
  const sal = comSaldo.reduce((a, d) => a + saldo(d), 0);
  const parc = base.filter((d) => status(d) === "parc");
  const pend = base.filter((d) => ["pend", "rej"].includes(status(d)));
  const old = base.filter((d) => status(d) !== "fat" && dias(d.emissao) > 30);
  const nAut = base.reduce((a, d) => a + nfsAut(d).length, 0);
  const sl = (t: string) => base.filter((d) => d.tipo === t).reduce((a, d) => a + saldo(d), 0);
  const K: { k: string | null; lb: string; v: string; m: ReactNode; acc?: string; extra?: ReactNode; anel?: ReactNode }[] = [
    {
      k: "saldo", lb: "Falta faturar", v: fmtK(sal), m: <><b>{comSaldo.length}</b> documentos com saldo</>, acc: "var(--f-blue)",
      extra: <>
        <div className="split"><span style={{ flex: sl("PV") || 0.01, background: "var(--f-pv)" }} /><span style={{ flex: sl("OS") || 0.01, background: "var(--f-os)" }} /></div>
        <div className="m" style={{ marginTop: 6 }}><span style={{ color: "var(--f-pv)" }}>PV {fmtK(sl("PV"))}</span> · <span style={{ color: "var(--f-os)" }}>OS {fmtK(sl("OS"))}</span></div>
      </>,
    },
    { k: "fat", lb: "Já faturado (período)", v: fmtK(fat), m: <><b>{nAut}</b> notas autorizadas</>, acc: "var(--f-ok)" },
    { k: null, lb: "% da carteira faturada", v: `${tot ? Math.round((fat / tot) * 100) : 0}%`, m: <>de {fmtK(tot)} em carteira</>, anel: <Anel p={tot ? fat / tot : 0} cor="var(--f-ok)" /> },
    { k: "parc", lb: "Saldo de parciais", v: fmtK(parc.reduce((a, d) => a + saldo(d), 0)), m: <><b>{parc.length}</b> docs parcialmente faturados</>, acc: "var(--f-warn)" },
    { k: "pend", lb: "Travado (pendência/rejeição)", v: fmtK(pend.reduce((a, d) => a + saldo(d), 0)), m: <><b>{pend.length}</b> docs precisam de ação</>, acc: "var(--f-bad)" },
    { k: "old", lb: "Saldo > 30 dias", v: fmtK(old.reduce((a, d) => a + saldo(d), 0)), m: <><b>{old.length}</b> docs envelhecendo</>, acc: "var(--f-warn)" },
  ];
  return (
    <section className="kpis">
      {K.map((x) => (
        <button key={x.lb} type="button" className={`kpi ${x.k ? "click" : ""} ${kpi && kpi === x.k ? "active" : ""}`}
          onClick={() => x.k && setKpi(kpi === x.k ? null : x.k)}>
          {x.acc && <span className="accent" style={{ background: x.acc }} />}
          {x.anel}
          <div className="lb">{x.lb}</div>
          <div className="v mono">{x.v}</div>
          <div className="m">{x.m}</div>
          {x.extra}
        </button>
      ))}
    </section>
  );
}

// ── PV × OS + aging ──────────────────────────────────────────────────────────
function Mix({ docs, base }: { docs: Doc[]; base: Doc[] }) {
  const linha = (t: "PV" | "OS", lbl: string, sub: string) => {
    const arr = docs.filter((d) => d.tipo === t);
    const T = arr.reduce((a, d) => a + Number(d.valor), 0) || 1;
    const F = arr.reduce((a, d) => a + Number(d.faturado), 0);
    const P = arr.filter((d) => status(d) === "parc").reduce((a, d) => a + saldo(d), 0);
    const R = arr.filter((d) => ["pronto", "emis"].includes(status(d))).reduce((a, d) => a + saldo(d), 0);
    const X = arr.filter((d) => ["pend", "rej"].includes(status(d))).reduce((a, d) => a + saldo(d), 0);
    const seg = (v: number, c: string) => <div style={{ width: `${(v / T) * 100}%`, background: c }} title={fmt(v)}>{v / T > 0.12 ? `${Math.round((v / T) * 100)}%` : ""}</div>;
    return (
      <div className="typerow" key={t}>
        <div className="nm"><b><span className={`tag ${t.toLowerCase()}`}>{t}</span> {lbl}</b><span>{sub}</span></div>
        <div className="stack">{seg(F, "var(--f-ok)")}{seg(P, "var(--f-warn)")}{seg(R, "var(--f-blue)")}{seg(X, "var(--f-mute)")}</div>
        <div className="tot mono">{fmtK(T - F)}<span>falta de {fmtK(T)}</span></div>
      </div>
    );
  };
  const abertos = base.filter((d) => status(d) !== "fat");
  const tS = abertos.reduce((a, d) => a + saldo(d), 0) || 1;
  const faixas: [string, number, number, string][] = [["0–15 dias", 0, 15, "var(--f-ok)"], ["16–30 dias", 16, 30, "var(--f-blue)"], ["31–60 dias", 31, 60, "var(--f-warn)"], ["> 60 dias", 61, 1e9, "var(--f-bad)"]];
  const porCli: Record<string, number> = {};
  abertos.forEach((d) => { const k = curto(d.cliente) || "—"; porCli[k] = (porCli[k] || 0) + saldo(d); });
  const top = Object.entries(porCli).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const mx = top[0]?.[1] || 1;
  return (
    <section className="mix">
      <div className="panel">
        <h3>Faturado × a faturar por tipo <small>carteira em aberto + faturado no período</small></h3>
        {linha("PV", "Produto", "NF-e mercantil · Focus")}
        {linha("OS", "Serviço", "NFS-e / recibo")}
        <div className="legend">
          <span><i style={{ background: "var(--f-ok)" }} />Faturado</span>
          <span><i style={{ background: "var(--f-warn)" }} />Saldo de parcial</span>
          <span><i style={{ background: "var(--f-blue)" }} />Pronto p/ faturar</span>
          <span><i style={{ background: "var(--f-mute)" }} />Com pendência</span>
        </div>
      </div>
      <div className="panel">
        <h3>Aging do saldo a faturar <small>dias desde a emissão do PV / abertura da OS</small></h3>
        <div className="aging">
          {faixas.map(([l, a, z, c]) => {
            const xs = abertos.filter((d) => { const x = dias(d.emissao); return x >= a && x <= z; });
            const v = xs.reduce((s, d) => s + saldo(d), 0);
            return (
              <div className="ag" key={l}>
                <div className="t">{l}</div><div className="n mono">{fmtK(v)}</div><div className="t">{xs.length} docs</div>
                <div className="bar"><i style={{ width: `${(v / tS) * 100}%`, background: c }} /></div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: "var(--f-tx3)", marginBottom: 8 }}>Maiores saldos por cliente</div>
          {top.map(([k, v]) => (
            <div className="topcli" key={k}><span className="nm" title={k}>{k}</span><span className="tr"><i style={{ width: `${(v / mx) * 100}%` }} /></span><b className="mono" style={{ width: 92, textAlign: "right" }}>{fmtK(v)}</b></div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Lista ────────────────────────────────────────────────────────────────────
function Prog({ d, largura = 130 }: { d: Doc; largura?: number | string }) {
  const p = Number(d.valor) ? Number(d.faturado) / Number(d.valor) : 0;
  const c = status(d) === "fat" ? "var(--f-ok)" : "var(--f-warn)";
  return (
    <div className="prog" style={{ width: largura }}>
      <div className="b"><i style={{ width: `${Math.min(1, p) * 100}%`, background: c }} /></div>
      <div className="l"><span>{Math.round(p * 100)}%</span><span>{nfsAut(d).length} NF</span></div>
    </div>
  );
}

function Idade({ d }: { d: Doc }) {
  const x = dias(d.emissao);
  if (status(d) === "fat") return <span className="age" style={{ color: "var(--f-tx3)" }}>{dataBR(d.emissao)}</span>;
  return <><span className={`age ${x > 60 ? "hot" : x > 30 ? "warm" : ""}`}>{x} dias</span><small style={{ display: "block", color: "var(--f-tx3)", fontSize: 11 }}>{dataBR(d.emissao)}</small></>;
}

function Acoes({ d, ocupado, agir, abrir, prod, registrar }: { d: Doc; ocupado: string | null; agir: (d: Doc, a: "prevoo" | "ensaio" | "emitir") => unknown; abrir: (k: string) => void; prod: boolean; registrar: (d: Doc) => void }) {
  const st = status(d);
  const ocup = (a: string) => ocupado === `${a}:${d.chave}`;
  const pare = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };
  if (st === "fat") return <button className="btn ghost sm" onClick={pare(() => abrir(d.chave))}>Notas</button>;
  const btnNfse = semNfse(d) ? <button className="btn sm" style={{ borderColor: "var(--f-os)", color: "var(--f-os)" }} disabled={!!ocupado} onClick={pare(() => registrar(d))}>Registrar NFS-e</button> : null;
  if (!d.emite || d.aguarda_nfse) return btnNfse ?? <span className="orig" title={d.emite_motivo}>fatura no Omie</span>;
  if (st === "pend") return <button className="btn ghost sm" onClick={pare(() => abrir(d.chave))}>Resolver</button>;
  if (st === "rej") return <button className="btn ghost sm" style={{ color: "var(--f-bad)" }} onClick={pare(() => abrir(d.chave))}>Ver rejeição</button>;
  if (st === "emis") return <button className="btn ghost sm" onClick={pare(() => abrir(d.chave))}>Atualizar</button>;
  return <>
    {d.tipo === "OS" && btnNfse}
    <button className="btn ghost sm" disabled={!!ocupado} onClick={pare(() => abrir(d.chave))}>Validar</button>
    <button className="btn sm pri" disabled={!!ocupado} onClick={pare(() => { agir(d, "emitir"); })}>
      {ocup("emitir") ? "Emitindo…" : `${st === "parc" ? "Emitir saldo" : `Emitir ${d.tipo === "PV" ? "NF-e" : "NFS-e"}`}${prod ? "" : " (homolog.)"}`}
    </button>
  </>;
}

function Lista({ rows, sel, setSel, sort, setSort, abrir, ocupado, agir, prod, registrar }: {
  rows: Doc[]; sel: Set<string>; setSel: (s: Set<string>) => void; sort: { k: string; d: 1 | -1 }; setSort: (s: { k: string; d: 1 | -1 }) => void;
  abrir: (k: string) => void; ocupado: string | null; agir: (d: Doc, a: "prevoo" | "ensaio" | "emitir") => unknown; prod: boolean; registrar: (d: Doc) => void;
}) {
  const [limite, setLimite] = useState(200);
  if (!rows.length) return <div className="tablebox"><div className="empty">Nenhum documento com esses filtros.</div></div>;
  const th = (k: string, l: string, cls = "") => (
    <th className={cls} onClick={() => setSort({ k, d: sort.k === k ? (sort.d === 1 ? -1 : 1) : -1 })}>{l}{sort.k === k ? (sort.d > 0 ? " ↑" : " ↓") : ""}</th>
  );
  const tot = rows.reduce((a, d) => a + Number(d.valor), 0), fat = rows.reduce((a, d) => a + Number(d.faturado), 0);
  const selecionaveis = rows.filter((d) => status(d) !== "fat");
  const todos = selecionaveis.length > 0 && selecionaveis.every((d) => sel.has(d.chave));
  return (
    <div className="tablebox">
      <table className="fl">
        <thead><tr>
          <th style={{ width: 34 }} onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="cb" checked={todos} onChange={() => {
              const n = new Set(sel); selecionaveis.forEach((d) => (todos ? n.delete(d.chave) : n.add(d.chave))); setSel(n);
            }} />
          </th>
          {th("doc", "Documento")}{th("cliente", "Cliente / OC")}{th("emissao", "Idade")}{th("valor", "Valor total", "r")}
          {th("faturado", "Faturado", "r")}{th("saldo", "Falta faturar", "r")}{th("pct", "Cobertura")}<th>Status</th><th className="r">Ações</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, limite).map((d) => {
            const st = status(d); const sd = saldo(d);
            const rej = d.nfs.filter((n) => n.fonte === "painel" && (n.status === "rejeitada" || n.status === "erro")).slice(-1)[0];
            return (
              <tr key={d.chave} className={`row ${sel.has(d.chave) ? "sel" : ""}`} onClick={() => abrir(d.chave)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="cb" checked={sel.has(d.chave)} disabled={st === "fat"}
                    onChange={() => { const n = new Set(sel); if (n.has(d.chave)) n.delete(d.chave); else n.add(d.chave); setSel(n); }} />
                </td>
                <td>
                  <div className="doc"><span className={`tag ${d.tipo.toLowerCase()}`}>{d.tipo}</span><b>{d.rotulo}</b></div>
                  <div className="orig">{d.origem} · {etapaRot(d)}</div>
                </td>
                <td>
                  <div className="cli" title={limpo(d.cliente ?? "")}>{limpo(d.cliente ?? "—")}
                    <small>{d.oc ? `OC ${d.oc}` : <span style={{ color: "var(--f-warn)" }}>sem OC</span>}{d.descricao ? ` · ${d.descricao}` : ""}</small>
                  </div>
                  {st !== "fat" && d.pend.map((p) => <div className="flag" key={p}>⚠ {p}</div>)}
                  {st === "rej" && rej && <div className="flag bad">✕ {rej.msg ?? "rejeitada"}</div>}
                </td>
                <td><Idade d={d} /></td>
                <td className="r mono">{fmt(Number(d.valor))}</td>
                <td className="r mono" style={{ color: Number(d.faturado) ? "var(--f-ok)" : "var(--f-tx3)" }}>{Number(d.faturado) ? fmt(Number(d.faturado)) : "—"}</td>
                <td className="r mono" style={{ fontWeight: 650, color: sd > 0.01 ? "var(--f-tx)" : "var(--f-tx3)" }}>{sd > 0.01 ? fmt(sd) : "—"}</td>
                <td><Prog d={d} /></td>
                <td>{d.aguarda_nfse && st !== "fat"
                  ? <span className="pill s-nfse"><i />Aguardando NFS-e (prefeitura)</span>
                  : <span className={`pill ${ST[st].c}`}><i />{ST[st].l}</span>}
                  {d.nfse_registrada && <div className="orig" style={{ color: "var(--f-os)" }}>NFS-e registrada</div>}</td>
                <td><div className="rowact"><Acoes d={d} ocupado={ocupado} agir={agir} abrir={abrir} prod={prod} registrar={registrar} /></div></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td /><td colSpan={3}>{rows.length} documentos{rows.length > limite && <button className="btn ghost sm" onClick={() => setLimite((l) => l + 300)}>ver mais</button>}</td>
          <td className="r mono">{fmt(tot)}</td><td className="r mono" style={{ color: "var(--f-ok)" }}>{fmt(fat)}</td><td className="r mono">{fmt(tot - fat)}</td>
          <td colSpan={3}><div className="prog" style={{ width: 200 }}><div className="b"><i style={{ width: `${tot ? (fat / tot) * 100 : 0}%`, background: "var(--f-ok)" }} /></div><div className="l"><span>{tot ? Math.round((fat / tot) * 100) : 0}% faturado</span></div></div></td>
        </tr></tfoot>
      </table>
    </div>
  );
}

// ── Kanban (etapas derivadas dos dados — não se arrasta) ─────────────────────
function Kanban({ rows, abrir }: { rows: Doc[]; abrir: (k: string) => void }) {
  return (
    <div className="kanban">
      {COLS.map((c) => {
        const inc = c.incl ?? [c.k];
        const xs = rows.filter((d) => inc.includes(status(d)));
        const v = (d: Doc) => (c.k === "fat" ? Number(d.valor) : saldo(d));
        const sal = xs.reduce((a, d) => a + v(d), 0);
        const pvS = xs.filter((d) => d.tipo === "PV").reduce((a, d) => a + v(d), 0);
        return (
          <div className="col" key={c.k}>
            <div className="colh">
              <div className="t"><span className="dot" style={{ background: ST[c.k].col }} />{c.t}<span className="n">{xs.length}</span></div>
              <div className="val mono">{fmtK(sal)}</div>
              <div className="mini"><i style={{ width: `${sal ? (pvS / sal) * 100 : 0}%`, background: "var(--f-pv)" }} /><i style={{ width: `${sal ? ((sal - pvS) / sal) * 100 : 0}%`, background: "var(--f-os)" }} /></div>
              <div className="hint">{c.k === "fat" ? "valor faturado" : c.k === "parc" ? "saldo restante" : "a faturar"} · {c.hint}</div>
            </div>
            <div className="cards">
              {xs.slice(0, 120).map((d) => {
                const st = status(d); const x = dias(d.emissao);
                const rej = d.nfs.filter((n) => n.fonte === "painel").slice(-1)[0];
                return (
                  <button type="button" className="kcard" key={d.chave} onClick={() => abrir(d.chave)}>
                    <span className="stripe" style={{ background: d.tipo === "PV" ? "var(--f-pv)" : "var(--f-os)" }} />
                    <div className="top"><span className={`tag ${d.tipo.toLowerCase()}`}>{d.tipo}</span><b>{d.rotulo}</b><span className="val mono">{fmt(st === "fat" ? Number(d.valor) : saldo(d))}</span></div>
                    <div className="cl" title={limpo(d.cliente ?? "")}>{curto(d.cliente)}</div>
                    {(st === "parc" || st === "fat") && <Prog d={d} largura="100%" />}
                    {st !== "fat" && d.pend.map((p) => <div className="flag" key={p}>⚠ {p}</div>)}
                    {st === "rej" && <div className="flag bad">✕ {rej?.msg ?? "rejeitada"}</div>}
                    {st === "emis" && <div className="flag">⟳ Aguardando SEFAZ</div>}
                    <div className="meta"><span>{d.oc ? `OC ${d.oc}` : "sem OC"}</span><span>{d.origem}</span>
                      <span className={`r ${st !== "fat" && x > 60 ? "age hot" : st !== "fat" && x > 30 ? "age warm" : ""}`}>{st === "fat" ? `✓ ${nfsAut(d).length} NF` : `${x}d`}</span></div>
                  </button>
                );
              })}
              {xs.length === 0 && <div className="empty" style={{ padding: 20, fontSize: 12 }}>—</div>}
              {xs.length > 120 && <div className="orig" style={{ textAlign: "center" }}>+{xs.length - 120} na lista</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Gaveta do documento ──────────────────────────────────────────────────────
function Gaveta({ d, empresa, prod, ocupado, agir, fechar, avisar, onMudou, registrar }: {
  d: Doc; empresa: string; prod: boolean; ocupado: string | null;
  agir: (d: Doc, a: "prevoo" | "ensaio" | "emitir" | "doc") => Promise<Record<string, unknown> | null>;
  fechar: () => void; avisar: (m: string) => void; onMudou: () => void; registrar: () => void;
}) {
  const st = status(d); const sd = saldo(d);
  const nf = d.tipo === "PV" ? "NF-e" : "NFS-e";
  const [itens, setItens] = useState<ItemDoc[] | null>(null);
  const [pre, setPre] = useState<(Prevoo & { error?: string }) | null>(null);
  const [verJson, setVerJson] = useState(false);
  const [links, setLinks] = useState<Record<number, { xml?: string | null; pdf?: string | null }>>({});

  useEffect(() => {
    setItens(null); setPre(null);
    if (!d.emite) return;
    agir(d, "doc").then((r) => { if (r && r.documento) setItens(((r.documento as { itens: ItemDoc[] }).itens) ?? []); });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [d.chave]); // eslint-disable-line react-hooks/exhaustive-deps

  async function validar() {
    const r = await agir(d, "prevoo");
    if (r) setPre(r as unknown as Prevoo & { error?: string });
  }
  async function arquivoNfse(id: number, qual: "xml" | "pdf") {
    const r = await fetch(`/api/faturamento/nfse/${id}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) { avisar(r.error); return; }
    const url = qual === "xml" ? r.xml_url : r.pdf_url;
    if (url) window.open(url, "_blank", "noopener"); else avisar("Arquivo não enviado no registro");
  }
  async function arquivo(id: number, qual: "xml" | "pdf") {
    let l = links[id];
    if (!l?.[qual]) {
      const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
      if (r.error) { avisar(r.error); return; }
      l = { xml: r.xml_url, pdf: r.pdf_url }; setLinks((m) => ({ ...m, [id]: l })); onMudou();
    }
    const url = l?.[qual];
    if (url) window.open(url, "_blank", "noopener"); else avisar("Arquivo ainda não disponível");
  }
  async function atualizar(id: number) {
    const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) avisar(r.error); else { avisar(`Emissão #${id}: ${r.emissao.status}${r.emissao.mensagem ? ` — ${r.emissao.mensagem}` : ""}`); onMudou(); }
  }

  const itensOs = d.itens ?? [];
  const pc = (s: string) => s === "autorizada" ? ["var(--f-ok-s)", "var(--f-ok)"] : s === "rejeitada" || s === "erro" ? ["var(--f-bad-s)", "var(--f-bad)"] : s === "cancelada" ? ["var(--f-mute-s)", "var(--f-tx3)"] : ["var(--f-warn-s)", "var(--f-warn)"];
  return (
    <>
      <div className="fpv-scrim" onClick={fechar} />
      <aside className="fpv-drawer">
        <div className="dh">
          <button className="x" onClick={fechar}>✕</button>
          <div style={{ fontSize: 12, color: "var(--f-tx3)" }}>{d.origem} · {EMPRESAS[empresa] ?? empresa} · {d.tipo === "PV" ? `Pedido de venda → ${nf} mercantil` : `Ordem de serviço → ${nf}`} · {etapaRot(d)}</div>
          <h2><span className={`tag ${d.tipo.toLowerCase()}`}>{d.tipo}</span>{d.rotulo} <span className={`pill ${ST[st].c}`} style={{ fontSize: 11.5 }}><i />{ST[st].l}</span></h2>
          <div className="c">{limpo(d.cliente ?? "—")}{d.oc ? ` · OC ${d.oc}` : ""}{d.descricao ? <><br /><span style={{ color: "var(--f-tx3)" }}>{d.descricao}</span></> : null}</div>
          <div className="dgrid">
            <div><span>Valor total</span><b className="mono">{fmt(Number(d.valor))}</b></div>
            <div><span>Faturado</span><b className="mono" style={{ color: "var(--f-ok)" }}>{fmt(Number(d.faturado))}</b></div>
            <div><span>Falta faturar</span><b className="mono" style={{ color: sd > 0.01 ? "var(--f-warn)" : "var(--f-tx3)" }}>{fmt(sd)}</b></div>
          </div>
          <div style={{ marginTop: 12 }}><Prog d={d} largura="100%" /></div>
        </div>

        <div className="db">
          {st !== "fat" && d.pend.map((p) => <div className="alert" key={p}>⚠ {p} — resolva no cadastro antes de emitir.</div>)}
          {!d.emite && st !== "fat" && <div className="alert info">{d.emite_motivo}</div>}
          {d.nfs.filter((n) => n.fonte === "painel" && (n.status === "rejeitada" || n.status === "erro")).slice(-1).map((n) => (
            <div className="alert bad" key={n.id}>✕ {n.msg ?? "Rejeitada"}</div>
          ))}

          {pre && (
            <>
              <h4>Validação (pré-voo — nada foi enviado)</h4>
              {pre.error ? <div className="alert bad">{pre.error}</div> : (
                <>
                  <div className={`alert ${pre.pode_emitir ? "ok" : "bad"}`}>{pre.pode_emitir ? "Pronto para emitir" : "Pendências — não emite"} · total {fmt(pre.total)} · {pre.ambiente === "producao" ? "PRODUÇÃO" : "homologação"}</div>
                  {pre.checagens.map((c, k) => (
                    <div className="chk" key={k}>
                      <span style={{ color: c.ok ? "var(--f-ok)" : c.nivel === "erro" ? "var(--f-bad)" : "var(--f-warn)", fontWeight: 700 }}>{c.ok ? "✓" : c.nivel === "erro" ? "✕" : "!"}</span>{" "}
                      {c.item}: <span style={{ color: "var(--f-tx3)" }}>{c.detalhe}</span>
                    </div>
                  ))}
                  {pre.parcelas?.length > 0 && <div className="chk" style={{ marginTop: 8 }}><b>Contas a receber que nascem:</b> {pre.parcelas.map((p) => `${dataBR(p.vencimento)} ${fmt(p.valor)}`).join(" · ")}</div>}
                  {!!pre.payload && <div><button className="btn ghost sm" onClick={() => setVerJson((v) => !v)}>{verJson ? "Esconder" : "Ver"} JSON que vai à Focus</button></div>}
                  {verJson && <pre>{JSON.stringify(pre.payload, null, 1)}</pre>}
                </>
              )}
            </>
          )}

          <h4>Itens</h4>
          {d.emite ? (itens === null ? <div className="orig">Carregando itens…</div> : (
            <table className="it">
              <thead><tr><th>Item</th><th className="r">Qtd</th><th className="r">Unit.</th><th className="r">Total</th></tr></thead>
              <tbody>
                {itens.map((it, i) => {
                  const t = it.quantidade * it.valor_unitario + Number(it.valor_frete ?? 0) - Number(it.valor_desconto ?? 0);
                  return (
                    <tr key={i}>
                      <td>{limpo(it.descricao)}<div style={{ fontSize: 11, color: "var(--f-tx3)" }}>{it.codigo ?? ""}{it.ncm ? ` · NCM ${it.ncm}` : ""}{it.valor_frete ? ` · frete ${fmt(Number(it.valor_frete))}` : ""}</div></td>
                      <td className="r mono">{it.quantidade} {it.unidade ?? ""}</td>
                      <td className="r mono">{fmt(it.valor_unitario)}</td>
                      <td className="r mono">{fmt(t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )) : (
            <table className="it">
              <thead><tr><th>Serviço</th><th className="r">Qtd</th><th className="r">Total</th></tr></thead>
              <tbody>{itensOs.map((it, i) => <tr key={i}><td>{limpo(it.desc ?? "")}</td><td className="r mono">{it.qtd ?? ""}</td><td className="r mono">{fmt(Number(it.vt ?? 0))}</td></tr>)}</tbody>
            </table>
          )}

          <h4>Notas vinculadas ({d.nfs.length})</h4>
          {d.nfs.length ? d.nfs.map((n, k) => {
            const c = pc(n.status);
            return (
              <div className="nf" key={`${n.num}-${k}`}>
                <div className="ic" style={{ background: c[0], color: c[1] }}>{n.num.startsWith("NF-e") ? "NF-e" : n.num.startsWith("Recibo") ? "REC" : "NFS"}</div>
                <div className="info"><b>{n.num}</b>
                  <span>{dataBR(n.data)} · {n.status}{n.ambiente !== "producao" ? " · homologação" : ""} · {n.fonte === "omie" ? "Omie" : n.fonte === "prefeitura" ? `prefeitura${n.municipio ? ` de ${n.municipio}` : ""} · registrada no painel` : "painel"}{n.msg && n.status !== "autorizada" ? ` · ${n.msg}` : ""}</span></div>
                <b className="mono">{fmt(Number(n.valor))}</b>
                {n.nfse_manual ? <>
                  {n.id && n.xml && <button className="btn ghost sm" onClick={() => arquivoNfse(n.id!, "xml")}>XML</button>}
                  {n.id && n.pdf && <button className="btn ghost sm" onClick={() => arquivoNfse(n.id!, "pdf")}>PDF</button>}
                </> : <>
                {n.id && n.status === "processando" && <button className="btn ghost sm" onClick={() => atualizar(n.id!)}>Atualizar</button>}
                {n.id && n.xml && <button className="btn ghost sm" onClick={() => arquivo(n.id!, "xml")}>XML</button>}
                {n.id && n.pdf && <button className="btn ghost sm" onClick={() => arquivo(n.id!, "pdf")}>{n.num.startsWith("Recibo") ? "Recibo" : "PDF"}</button>}
                </>}
              </div>
            );
          }) : <div className="orig" style={{ fontSize: 12.5 }}>Nenhuma nota emitida ainda.</div>}

          <h4>Histórico</h4>
          <div className="timeline">
            <div className="ok">{d.tipo === "PV" ? "Pedido lançado" : "OS aberta"}<small>{dataBR(d.emissao)} · {d.origem}</small></div>
            {d.nfs.map((n, k) => <div key={k} className={n.status === "autorizada" ? "ok" : ""}>{n.num} — {n.status}<small>{dataBR(n.data)} · {fmt(Number(n.valor))}</small></div>)}
            {sd > 0.01 && <div>Saldo de {fmt(sd)} aguardando faturamento<small>há {dias(d.emissao)} dias</small></div>}
          </div>
        </div>

        <div className="df">
          {sd > 0.01 && d.emite ? (
            <>
              <div className="sum">Emitir agora<b className="mono">{fmt(sd)}</b></div>
              {semNfse(d) && <button className="btn" onClick={registrar}>Registrar NFS-e</button>}
              <button className="btn" disabled={!!ocupado} onClick={validar}>{ocupado === `prevoo:${d.chave}` ? "Validando…" : "Validar"}</button>
              {d.origem === "Omie" && d.tipo === "PV" && <button className="btn" disabled={!!ocupado} onClick={() => agir(d, "ensaio")}>{ocupado === `ensaio:${d.chave}` ? "Enviando…" : "Ensaio"}</button>}
              <button className="btn pri" disabled={!!ocupado || st === "pend" || st === "emis" || (pre != null && !pre.error && !pre.pode_emitir)}
                onClick={async () => { const r = await agir(d, "emitir"); if (r) fechar(); }}>
                {ocupado === `emitir:${d.chave}` ? "Emitindo…" : `Emitir ${nf}${Number(d.faturado) > 0 ? " do saldo" : ""}${prod ? "" : " (homolog.)"}`}
              </button>
            </>
          ) : sd > 0.01 ? (
            <><div className="sum">{d.emite_motivo}</div>
              {semNfse(d) && <button className="btn pri" onClick={registrar}>Registrar NFS-e</button>}</>
          ) : (
            <><div className="sum">Documento 100% faturado<b style={{ color: "var(--f-ok)" }}>✓ {nfsAut(d).length} nota(s)</b></div>
              <button className="btn" disabled title="Depende do Resend (RESEND_API_KEY)">Enviar ao cliente</button></>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Prontidão da NF-e de produção ────────────────────────────────────────────
function Prontidao({ p, empresa, aberto, onMudou }: { p: Pront | null; empresa: string; aberto: boolean; onMudou: () => void }) {
  if (!p) return null;
  const cert = p.focus?.certificado_valido_ate ? Math.floor((new Date(p.focus.certificado_valido_ate).getTime() - Date.now()) / 864e5) : null;
  const prod = p.config.ambiente === "producao" && p.config.producao_liberada;
  async function omie(v: boolean) {
    const txt = v ? `Confirma que a emissão de NF-e da ${empresa} FOI DESLIGADA NO OMIE e que ninguém mais vai emitir NF-e da ${empresa} por lá?` : "Desfazer a confirmação (volta a bloquear a produção)?";
    if (!window.confirm(txt)) return;
    const r = await fetch("/api/faturamento/prontidao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresa, omie_desligado: v }) }).then((x) => x.json());
    if (r.error) window.alert(r.error); else onMudou();
  }
  const itens = [
    { rot: "Focus: NF-e habilitada", ok: !!p.focus?.habilita_nfe, det: p.focus_erro ?? (p.focus?.habilita_nfe ? "sim" : "não") },
    { rot: "Token de produção", ok: p.token_producao_env, det: p.token_producao_env ? "configurado na Vercel" : `falta FOCUS_TOKEN_${empresa}` },
    { rot: "Certificado A1", ok: cert != null && cert > 0, det: p.focus?.certificado_valido_ate ? `vence ${dataBR(p.focus.certificado_valido_ate)} (${cert} dias)` : "—" },
    { rot: "Última NF-e no Omie", ok: true, det: p.ultima_nfe_omie ? `nº ${Number(p.ultima_nfe_omie.numero)} série ${Number(p.ultima_nfe_omie.serie)} em ${dataBR(p.ultima_nfe_omie.emissao)}` : "—" },
    { rot: "Próxima NF-e do painel", ok: !p.conflito_numeracao, det: p.conflito_numeracao ?? `nº ${p.config.nfe_proximo_producao} série ${p.config.nfe_serie_producao}` },
    { rot: "Omie desligado para NF-e", ok: !!p.config.omie_nfe_desligado_em, det: p.config.omie_nfe_desligado_em ? `confirmado em ${new Date(p.config.omie_nfe_desligado_em).toLocaleString("pt-BR")}` : "não confirmado" },
    { rot: "Chave de produção", ok: prod, det: prod ? "LIGADA — emite NF-e real" : "desligada (homologação)" },
  ];
  const faltam = itens.filter((i) => !i.ok).length;
  return (
    <>
      {cert != null && cert <= 20 && (
        <div className={`alert ${cert <= 7 ? "bad" : ""}`}>
          Certificado A1 da {empresa} vence em {cert} dia(s) ({dataBR(p.focus!.certificado_valido_ate!)}). Sem ele a Focus não emite: renove e envie o novo .pfx à Focus antes disso.
        </div>
      )}
      {aberto && (
        <div className="pront">
          <div className="hd">
            <b style={{ fontSize: 14 }}>NF-e mercantil {empresa} — prontidão para produção</b>
            <span className={`pill ${prod ? "s-fat" : "s-emis"}`}><i />{prod ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}</span>
            <span className="orig">{faltam ? `${faltam} item(ns) pendente(s)` : "tudo pronto"}</span>
            <span style={{ flex: 1 }} />
            {p.pode_mudar && (p.config.omie_nfe_desligado_em
              ? <button className="btn sm" onClick={() => omie(false)}>Desfazer &quot;Omie desligado&quot;</button>
              : <button className="btn sm" onClick={() => omie(true)}>Confirmar: Omie desligado para NF-e</button>)}
          </div>
          <div className="grid">
            {itens.map((i) => (
              <div className="it" key={i.rot}>
                <span style={{ color: i.ok ? "var(--f-ok)" : "var(--f-bad)", fontWeight: 700 }}>{i.ok ? "✓" : "✕"}</span> <b>{i.rot}</b>
                <div>{i.det}</div>
              </div>
            ))}
          </div>
          <div className="orig" style={{ marginTop: 8 }}>Natureza: {p.config.natureza_operacao} · a chave de produção é ligada só pelo Benny.</div>
        </div>
      )}
    </>
  );
}

// ── Emissões (histórico de todas as notas do painel) ─────────────────────────
const TIPO_DOC: Record<string, string> = { nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo" };
const ST_EM: Record<string, string> = { rascunho: "s-pend", processando: "s-emis", autorizada: "s-fat", rejeitada: "s-rej", cancelada: "s-pend", erro: "s-rej" };

function Emissoes({ lista, q, onMudou, avisar }: { lista: Emissao[] | null; q: string; onMudou: () => void; avisar: (m: string) => void }) {
  const [ocup, setOcup] = useState<number | null>(null);
  if (!lista) return <div className="tablebox"><div className="empty">Carregando…</div></div>;
  const vis = lista.filter((e) => !q || [e.cliente?.nome, e.numero, e.origem_id, e.origem_rotulo, String(e.id)].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())));
  async function abrir(e: Emissao, qual: "xml" | "pdf") {
    setOcup(e.id);
    const r = await fetch(`/api/faturamento/emissoes/${e.id}`, { cache: "no-store" }).then((x) => x.json()).catch((er) => ({ error: String(er) }));
    setOcup(null);
    if (r.error) { avisar(r.error); return; }
    const url = qual === "xml" ? r.xml_url : r.pdf_url;
    if (url) window.open(url, "_blank", "noopener"); else avisar("Arquivo ainda não disponível");
  }
  async function atualizar(e: Emissao) {
    setOcup(e.id);
    const r = await fetch(`/api/faturamento/emissoes/${e.id}`, { cache: "no-store" }).then((x) => x.json()).catch((er) => ({ error: String(er) }));
    setOcup(null);
    if (r.error) avisar(r.error); else onMudou();
  }
  async function cancelar(e: Emissao) {
    const just = window.prompt("Justificativa do cancelamento (mín. 15 caracteres):", "Teste de homologação cancelado pelo painel");
    if (!just) return;
    setOcup(e.id);
    const r = await fetch(`/api/faturamento/emissoes/${e.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "cancelar", justificativa: just }) }).then((x) => x.json());
    setOcup(null);
    if (r.error) avisar(r.error); else onMudou();
  }
  return (
    <div className="tablebox">
      {vis.length === 0 ? <div className="empty">Nenhuma emissão.</div> : (
        <table className="fl">
          <thead><tr><th>#</th><th>Data</th><th>Documento</th><th>Origem</th><th>Cliente</th><th className="r">Valor</th><th>Status</th><th className="r">Ações</th></tr></thead>
          <tbody>
            {vis.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.id}</td>
                <td>{new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td><b>{TIPO_DOC[e.tipo] ?? e.tipo}</b> {e.numero ? `nº ${e.numero}` : ""}{e.serie && e.tipo !== "recibo" ? ` · série ${e.serie}` : ""}
                  <div className="orig" style={{ color: e.ambiente === "producao" ? "var(--f-ok)" : "var(--f-warn)", fontWeight: 600 }}>{e.empresa} · {e.ambiente === "producao" ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}{e.ensaio ? " · ENSAIO" : ""}</div></td>
                <td>{e.origem_rotulo ?? (e.origem_id ? `${e.origem_tipo.toUpperCase()} ${e.origem_id}` : e.origem_tipo)}</td>
                <td><div className="cli">{limpo(e.cliente?.nome ?? "")}</div></td>
                <td className="r mono">{fmt(Number(e.valor_total))}</td>
                <td style={{ maxWidth: 300 }}>
                  <span className={`pill ${ST_EM[e.status] ?? "s-pend"}`}><i />{e.status}</span>
                  {e.receber_ids?.length ? <span className="orig"> · {e.receber_ids.length} parcela(s) a receber</span> : null}
                  {e.mensagem && <div className="orig" style={{ marginTop: 3 }}>{e.mensagem}</div>}
                </td>
                <td><div className="rowact">
                  {e.xml_path && <button className="btn ghost sm" disabled={ocup === e.id} onClick={() => abrir(e, "xml")}>XML</button>}
                  {e.pdf_path && <button className="btn ghost sm" disabled={ocup === e.id} onClick={() => abrir(e, "pdf")}>{e.tipo === "recibo" ? "Recibo" : "PDF"}</button>}
                  {["processando", "autorizada"].includes(e.status) && e.tipo !== "recibo" && <button className="btn ghost sm" disabled={ocup === e.id} onClick={() => atualizar(e)}>{ocup === e.id ? "…" : "Atualizar"}</button>}
                  {e.status === "autorizada" && e.ambiente === "homologacao" && <button className="btn ghost sm danger" disabled={ocup === e.id} onClick={() => cancelar(e)}>Cancelar</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── NFS-e emitidas na prefeitura e registradas no painel (sql/59) ───────────
type RegNfse = {
  id: number; municipio: string; numero: string; codigo_verificacao: string | null; data_emissao: string; competencia: string | null;
  valor_servicos: number; valor_liquido: number; iss_retido: boolean; valor_iss: number; tomador_nome: string | null; tomador_doc: string | null;
  os: { chave: string; rotulo: string; valor: number }[]; parcelas: { vencimento: string; valor: number }[]; receber_ids: string[] | null;
  pdf_path: string | null; xml_path: string | null; status: "registrada" | "cancelada"; criado_por: string | null; criado_em: string;
  cancelado_em: string | null; cancelado_por: string | null; cancelado_motivo: string | null; observacao: string | null;
};

function NfseRegistradas({ empresa, q, onMudou, avisar }: { empresa: string; q: string; onMudou: () => void; avisar: (m: string) => void }) {
  const [lista, setLista] = useState<RegNfse[] | null>(null);
  const [ocup, setOcup] = useState<number | null>(null);
  const carregar = useCallback(() => {
    fetch(`/api/faturamento/nfse?empresa=${empresa}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => { if (j.error) avisar(j.error); setLista(j.registros ?? []); }).catch((e) => avisar(String(e)));
  }, [empresa, avisar]);
  useEffect(() => { carregar(); }, [carregar]);
  if (!lista) return <div className="tablebox"><div className="empty">Carregando…</div></div>;
  const vis = lista.filter((r) => !q || [r.numero, r.municipio, r.tomador_nome, r.codigo_verificacao, ...r.os.map((o) => o.rotulo)]
    .some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())));
  async function arquivo(r: RegNfse, qual: "pdf" | "xml") {
    setOcup(r.id);
    const j = await fetch(`/api/faturamento/nfse/${r.id}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcup(null);
    if (j.error) { avisar(j.error); return; }
    const url = qual === "pdf" ? j.pdf_url : j.xml_url;
    if (url) window.open(url, "_blank", "noopener"); else avisar("Arquivo não enviado no registro");
  }
  async function cancelar(r: RegNfse) {
    const motivo = window.prompt(`Cancelar o registro da NFS-e ${r.numero}? As parcelas a receber (sem baixa) são apagadas e a OS volta a "a faturar".\nMotivo:`, "");
    if (!motivo) return;
    setOcup(r.id);
    const j = await fetch(`/api/faturamento/nfse/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "cancelar", motivo }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcup(null);
    if (j.error) { avisar(j.error); return; }
    avisar(`Registro da NFS-e ${r.numero} cancelado`);
    carregar(); onMudou();
  }
  const ativas = vis.filter((r) => r.status === "registrada");
  return (
    <div className="tablebox nfse-reg">
      <div className="orig" style={{ padding: "10px 14px" }}>
        {ativas.length} NFS-e registrada(s) · serviços {fmt(ativas.reduce((a, r) => a + Number(r.valor_servicos), 0))} · a receber {fmt(ativas.reduce((a, r) => a + Number(r.valor_liquido), 0))}
      </div>
      {vis.length === 0 ? <div className="empty">Nenhuma NFS-e registrada ainda. Use “Registrar NFS-e” numa OS da carteira.</div> : (
        <table className="fl">
          <thead><tr><th>NFS-e</th><th>Emissão</th><th>OS</th><th>Tomador</th><th className="r">Serviços</th><th className="r">A receber</th><th>Status</th><th className="r">Ações</th></tr></thead>
          <tbody>
            {vis.map((r) => (
              <tr key={r.id} style={r.status === "cancelada" ? { opacity: 0.55 } : undefined}>
                <td><b>NFS-e {r.numero}</b><span className="orig">{r.municipio}{r.codigo_verificacao ? ` · verif. ${r.codigo_verificacao}` : ""}</span></td>
                <td>{dataBR(r.data_emissao)}{r.competencia && <span className="orig">comp. {r.competencia.slice(5, 7)}/{r.competencia.slice(0, 4)}</span>}</td>
                <td>{r.os.map((o) => <div key={o.chave}><span className="tag os">OS</span> {o.rotulo}</div>)}</td>
                <td><div className="cli">{limpo(r.tomador_nome ?? "—")}<small>{r.tomador_doc ?? ""}</small></div></td>
                <td className="r mono">{fmt(Number(r.valor_servicos))}{r.iss_retido && <span className="orig">ISS retido {fmt(Number(r.valor_iss))}</span>}</td>
                <td className="r mono">{fmt(Number(r.valor_liquido))}<span className="orig">{r.parcelas.map((p) => `${dataBR(p.vencimento)}`).join(" · ")}</span></td>
                <td>{r.status === "registrada"
                  ? <span className="pill s-fat"><i />registrada</span>
                  : <><span className="pill s-pend"><i />cancelada</span><span className="orig">{r.cancelado_motivo}</span></>}
                  <span className="orig">por {r.criado_por ?? "—"}</span></td>
                <td><div className="rowact">
                  {r.pdf_path && <button className="btn ghost sm" disabled={ocup === r.id} onClick={() => arquivo(r, "pdf")}>PDF</button>}
                  {r.xml_path && <button className="btn ghost sm" disabled={ocup === r.id} onClick={() => arquivo(r, "xml")}>XML</button>}
                  {r.status === "registrada" && <button className="btn ghost sm danger" disabled={ocup === r.id} onClick={() => cancelar(r)}>Cancelar</button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
