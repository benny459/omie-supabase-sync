"use client";

/**
 * Conciliação bancária (05/10/26, sql/52) — extrato OFX × títulos do painel.
 *
 * Fluxo: importar o OFX da conta (dedupe por FITID) → cada movimento mostra
 * sugestões (valor igual ao saldo do título — ou à soma de várias parcelas do
 * mesmo documento/contraparte, em grupo —, vencimento a ±3 dias, CNPJ ou nº
 * do documento no histórico) → "aceitar" casa com um clique; "casar à mão"
 * permite escolher 1..n títulos e repartir o valor (split) → casar = baixa do
 * título (pagar/receber). "Desfazer" estorna as baixas; "ignorar" é para
 * tarifas, transferências entre contas e afins (com motivo).
 *
 * Painel "Casar" (05/10/26, sql/73): clicar num movimento pendente abre à direita os
 * candidatos de TODOS os títulos em aberto (Omie + painel) com motivos, busca livre
 * (nome, CNPJ, NF, PV/OS/PC, valor, vencimento), seleção múltipla com diferença
 * (juros/desconto/parcial), criar título, transferência e ignorar — ver CasarPainel.
 *
 * Importação (05/10/26): qualquer banco — OFX 1.x/2.x (vários extratos, cartão),
 * CSV ou XLSX com mapa de colunas guardado por conta. Assistente: arquivo →
 * prévia (conta detectada, período, saldos do arquivo, duplicados, lacuna ou
 * sobreposição com a última importação) → importar. Depois de importar rodam as
 * regras ("memo contém X → lançar com categoria Y / ignorar") e a conciliação
 * automática. Teclado: j/k (ou ↓/↑) navega, Enter aceita a 1ª sugestão, Esc fecha.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aviso, BotaoTela, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis, PaginaNavy,
  brl, cartao, ddmmaa, hojeISO, somaDias, type Kpi,
} from "./KitTela";
import { StatusPill, type Tom } from "../primitivos";
import { CasarHost, abrirCasar } from "../../financeiro/CasarPainel";

type Conta = { empresa: string; cod_cc: number; descricao: string; codigo_banco: string | null; numero_conta_corrente: string | null; tipo_conta_corrente: string | null };
type Sug = {
  natureza: "P" | "R"; titulo: string; contraparte: string | null; documento: string | null; vencimento: string | null; saldo: number; fase: string | null; score: number;
  /* Sugestão em grupo (sql/57): várias parcelas do mesmo documento/contraparte cuja soma bate com o movimento. */
  grupo?: boolean; itens?: { titulo: string; saldo: number; documento: string | null; vencimento: string | null; fase: string | null }[];
};
type BaixaMov = { id: number; natureza: string; titulo: string; documento: string | null; contraparte: string | null; valor: number; auto?: boolean };
type Mov = {
  id: number; data: string; valor: number; tipo: string | null; memo: string | null; nome: string | null; fitid: string;
  checknum: string | null; arquivo: string | null; casado: number; ignorado: boolean; ignorado_motivo: string | null;
  estado: "pendente" | "parcial" | "conciliado" | "omie" | "ignorado"; baixas: BaixaMov[]; sugestoes: Sug[];
  origem?: string | null; auto?: boolean; omie_titulo?: number | null; transferencia_par?: number | null;
};
type MovPrev = { data: string; valor: number; memo: string | null; nome: string | null; fitid: string };
type ExtPrev = {
  indice: number; banco: string | null; agencia: string | null; conta_arquivo: string | null; cartao: boolean;
  inicio: string | null; fim: string | null; n: number; entradas: number; saidas: number;
  saldo: { abertura: number | null; fechamento: number | null; movimento: number };
  conta: Conta | null; candidatos: Conta[]; lembrada: boolean;
  previa: { duplicados?: number; lacuna_dias?: number | null; sobreposicao?: boolean; saldo_confere?: boolean | null;
            saldo_anterior?: number | null; ultimo_extrato_ate?: string | null } | null;
  amostra: MovPrev[];
};
type Mapa = { data: number; valor: number; credito?: number; debito?: number; historico: number; documento?: number; nome?: number; saldo?: number; linha_inicial?: number; formato_data?: "dmy" | "ymd" | "mdy"; inverter_sinal?: boolean };
type Regra = { id: number; empresa: string | null; cod_cc: number | null; contem: string; natureza: "P" | "R" | null; acao: "ignorar" | "lancar"; categoria_cod: string | null; descricao: string | null; aplicacoes: number };
type Categoria = { codigo: string; descricao: string };
type Titulo = { natureza: "P" | "R"; titulo: string; contraparte: string | null; documento: string | null; vencimento: string | null; valor: number; valor_pago: number; saldo: number; fase: string | null };

const ESTADO: Record<Mov["estado"], { label: string; tom: Tom }> = {
  pendente: { label: "Pendente", tom: "warn" },
  parcial: { label: "Parcial", tom: "info" },
  conciliado: { label: "Conciliado", tom: "ok" },
  omie: { label: "Baixado no Omie", tom: "ok" },
  ignorado: { label: "Ignorado", tom: "off" },
};
const campo: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 10, fontSize: 13, border: "1px solid var(--ww-border-strong)",
  background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const pilula = (cor: string): React.CSSProperties => ({
  fontSize: 11.5, padding: "3px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--ww-border-strong)",
  background: "transparent", color: cor, whiteSpace: "nowrap",
});
const chaveConta = (c: { empresa: string; cod_cc: number }) => `${c.empresa}:${c.cod_cc}`;

export default function TelaConciliacaoBancaria() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [conta, setConta] = useState("");
  const [de, setDe] = useState(() => somaDias(hojeISO(), -30));
  const [ate, setAte] = useState(hojeISO());
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [titulos, setTitulos] = useState<Titulo[]>([]);
  const [podeBaixar, setPodeBaixar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [estadoSel, setEstadoSel] = useState<Mov["estado"] | "">("pendente");
  const [soAuto, setSoAuto] = useState(false);
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [previa, setPrevia] = useState<{ arquivo: File; formato: string; extratos: ExtPrev[]; mapa: Mapa | null; contas: Conta[] } | null>(null);
  const [mapear, setMapear] = useState<{ arquivo: File; cabecalho: string[]; amostra: unknown[][]; mapa: Mapa } | null>(null);
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [verRegras, setVerRegras] = useState(false);
  const inputArq = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/financeiro/ofx").then((r) => r.json()).then((j) => {
      if (j.error) { setErro(j.error); return; }
      const cs = (j.contas ?? []) as Conta[];
      setContas(cs);
      try {
        const g = localStorage.getItem("concil-conta");
        if (g && cs.some((c) => chaveConta(c) === g)) { setConta(g); return; }
      } catch { /* sem storage */ }
      const c6 = cs.find((c) => c.tipo_conta_corrente === "CC" && c.codigo_banco === "336") ?? cs.find((c) => c.tipo_conta_corrente === "CC");
      if (c6) setConta(chaveConta(c6));
    }).catch((e) => setErro((e as Error).message));
  }, []);

  const carregar = useCallback(async () => {
    if (!conta) return;
    const [empresa, cod] = conta.split(":");
    setErro(null);
    try {
      const r = await fetch(`/api/financeiro/conciliacao?empresa=${empresa}&cod_cc=${cod}&de=${de}&ate=${ate}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMovs(j.movimentos ?? []); setTitulos(j.titulos ?? []); setPodeBaixar(!!j.pode_baixar);
    } catch (e) { setErro((e as Error).message); }
  }, [conta, de, ate]);
  useEffect(() => { setMovs(null); carregar(); }, [carregar, refresh]);
  // o painel "Casar" avisa quando muda alguma coisa
  useEffect(() => {
    const h = () => carregar();
    window.addEventListener("conc:atualizar", h);
    return () => window.removeEventListener("conc:atualizar", h);
  }, [carregar]);
  useEffect(() => { try { if (conta) localStorage.setItem("concil-conta", conta); } catch { /* ok */ } }, [conta]);

  /** Passo 1: prévia (nada é gravado). CSV/XLSX sem mapa → passo de mapear colunas. */
  async function previaArquivo(arquivo: File, mapa?: Mapa | null, escolhida?: Conta) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo); fd.append("modo", "previa");
      if (mapa) fd.append("mapa", JSON.stringify(mapa));
      if (escolhida) { fd.append("empresa", escolhida.empresa); fd.append("cod_cc", String(escolhida.cod_cc)); }
      const r = await fetch("/api/financeiro/ofx", { method: "POST", body: fd });
      const j = await r.json();
      if (r.status === 409 && j.precisa_mapa) { setPrevia(null); setMapear({ arquivo, cabecalho: j.cabecalho ?? [], amostra: j.amostra ?? [], mapa: j.mapa }); return; }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMapear(null);
      setPrevia({ arquivo, formato: j.formato, extratos: j.extratos ?? [], mapa: j.mapa ?? mapa ?? null, contas: j.contas ?? contas });
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); if (inputArq.current) inputArq.current.value = ""; }
  }

  /** Passo 2: importar um extrato da prévia na conta escolhida. */
  async function importar(ext: ExtPrev, contaImp: Conta, lembrar: boolean) {
    if (!previa) return;
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", previa.arquivo); fd.append("modo", "importar"); fd.append("extrato", String(ext.indice));
      fd.append("empresa", contaImp.empresa); fd.append("cod_cc", String(contaImp.cod_cc));
      if (lembrar) fd.append("lembrar", "1");
      if (previa.mapa) fd.append("mapa", JSON.stringify(previa.mapa));
      const r = await fetch("/api/financeiro/ofx", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const partes = [`${previa.arquivo.name}: ${j.novos} novo(s), ${j.duplicados} já existiam · ${j.conta.descricao} (${j.conta.empresa})`];
      if (j.regras && (j.regras.lancados || j.regras.ignorados)) partes.push(`regras: ${j.regras.lancados} lançado(s), ${j.regras.ignorados} ignorado(s)`);
      if (j.auto && j.auto.conciliados) partes.push(`conciliação automática: ${j.auto.conciliados}`);
      if (j.avisos?.length) partes.push(`⚠ ${j.avisos.join(" ")}`);
      setAviso(partes.join(" · "));
      const resto = previa.extratos.filter((x) => x.indice !== ext.indice);
      setPrevia(resto.length ? { ...previa, extratos: resto } : null);
      const k = chaveConta(j.conta);
      if (j.de && j.de < de) setDe(j.de);
      if (j.ate && j.ate > ate) setAte(j.ate);
      if (k !== conta) setConta(k); else setRefresh((n) => n + 1);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  const carregarRegras = useCallback(async () => {
    try {
      const r = await fetch("/api/financeiro/conciliacao?regras=1");
      const j = await r.json();
      if (r.ok) setRegras(j.regras ?? []);
    } catch { /* ok */ }
  }, []);
  useEffect(() => { if (verRegras) carregarRegras(); }, [verRegras, carregarRegras, refresh]);

  async function acao(corpo: object, ok: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(ok); setRefresh((n) => n + 1);
      return true;
    } catch (e) { setErro((e as Error).message); return false; }
    finally { setOcupado(false); }
  }

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (movs ?? []).filter((m) => (!estadoSel || m.estado === estadoSel) && (!soAuto || !!m.auto) &&
      (!t || `${m.memo ?? ""} ${m.nome ?? ""} ${m.valor} ${m.checknum ?? ""}`.toLowerCase().includes(t)));
  }, [movs, estadoSel, soAuto, q]);

  const kpis: Kpi[] = useMemo(() => {
    const ms = movs ?? [];
    const soma = (f: (m: Mov) => boolean) => ms.filter(f).reduce((s, m) => s + Math.abs(m.valor), 0);
    const n = (e: Mov["estado"]) => ms.filter((m) => m.estado === e).length;
    return [
      { rotulo: "Entradas", valor: brl(soma((m) => m.valor > 0)), sub: `${ms.filter((m) => m.valor > 0).length} lançamentos` },
      { rotulo: "Saídas", valor: brl(soma((m) => m.valor < 0)), sub: `${ms.filter((m) => m.valor < 0).length} lançamentos` },
      { rotulo: "Pendentes", hero: true, valor: String(n("pendente") + n("parcial")), sub: brl(ms.filter((m) => m.estado === "pendente" || m.estado === "parcial").reduce((s, m) => s + Math.abs(m.valor) - m.casado, 0)) + " a casar" },
      { rotulo: "Conciliados", valor: String(n("conciliado") + n("omie")),
        sub: `${ms.filter((m) => m.auto).length} automáticos · ${n("omie")} baixados no Omie · ${n("ignorado")} ignorados` },
    ];
  }, [movs]);

  const contaSel = contas.find((c) => chaveConta(c) === conta);

  // teclado: j/k ou ↓/↑ navegam, Enter aceita a 1ª sugestão do aberto, Esc fecha
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "SELECT" || alvo.tagName === "TEXTAREA")) return;
      if (!lista.length) return;
      const i = lista.findIndex((m) => m.id === aberto);
      const ir = (mm: Mov) => { setAberto(mm.id); if (mm.estado === "pendente" || mm.estado === "parcial") abrirCasar(mm.id); };
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); ir(lista[Math.min(i + 1, lista.length - 1)]); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); ir(lista[Math.max(i - 1, 0)]); }
      else if (e.key === "Escape") setAberto(null);
      else if (e.key === "Enter" && i >= 0 && podeBaixar && !ocupado) {
        const m = lista[i]; const s1 = m.sugestoes[0];
        if (!s1 || m.estado !== "pendente" || (s1.natureza === "P" && s1.fase !== "liberado")) return;
        e.preventDefault();
        const resto = Math.round((Math.abs(m.valor) - m.casado) * 100) / 100;
        const itens = s1.grupo && s1.itens?.length ? s1.itens.map((x) => ({ titulo: x.titulo, valor: x.saldo })) : [{ titulo: s1.titulo, valor: Math.min(s1.saldo, resto) }];
        acao({ acao: "conciliar", movimento_id: m.id, itens }, `Conciliado: ${s1.contraparte ?? ""}`).then((okk) => {
          if (okk && i + 1 < lista.length) setAberto(lista[i + 1].id);
        });
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  /** Aceita de uma vez o 1º candidato (Omie + painel, ≥ 80 pts, sem empate, valor exato) dos pendentes visíveis. */
  async function aceitarEmLote() {
    const alvo = lista.filter((m) => m.estado === "pendente").map((m) => m.id).slice(0, 25);
    if (!alvo.length) { setAviso("Nenhum movimento pendente neste filtro."); return; }
    if (!window.confirm(`Procurar e aceitar o 1º candidato seguro (80+ pontos, valor exato, sem empate) de ${alvo.length} movimento(s)?`)) return;
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "aceitar_lote", movimentos: alvo, limiar: 80 }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(`${j.conciliados} movimento(s) conciliados em lote · ${j.pulados?.length ?? 0} deixados para conferir${j.erros?.length ? ` · ${j.erros.length} com erro` : ""}.`);
      setRefresh((n) => n + 1);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  return (
    <PaginaNavy>
      <CasarHost />
      <CabecalhoTela
        area="Financeiro"
        titulo="Conciliação bancária"
        sub={<>Extrato (OFX de qualquer banco, CSV ou planilha) × títulos do painel · casar = baixa do título{contaSel ? ` · ${contaSel.descricao} (${contaSel.empresa})` : ""}</>}
        acoes={<>
          <input ref={inputArq} type="file" accept=".ofx,.OFX,.qfx,.csv,.txt,.xlsx,.xls,application/x-ofx" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) previaArquivo(f); }} />
          <BotaoTela onClick={() => setVerRegras((v) => !v)}>{verRegras ? "Fechar regras" : "Regras"}</BotaoTela>
          {podeBaixar && <BotaoTela disabled={ocupado} onClick={aceitarEmLote} title="Aceita o 1º candidato seguro (80+ pontos, valor exato, sem empate) dos pendentes visíveis — até 25 por vez">Aceitar sugestões</BotaoTela>}
          {contaSel && (
            <BotaoTela disabled={ocupado} title="Concilia sozinho só o que é praticamente certo: valor exato + CNPJ ou nº do documento, ou soma exata das parcelas do mesmo documento"
              onClick={async () => {
                setOcupado(true); setErro(null); setAviso(null);
                try {
                  const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ acao: "auto", empresa: contaSel.empresa, cod_cc: contaSel.cod_cc, de, ate }) });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
                  setAviso(`Conciliação automática: ${j.conciliados ?? 0} movimento(s) casados${j.pulados ? `, ${j.pulados} deixados para conferir` : ""}.`);
                  setRefresh((n) => n + 1);
                } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
              }}>Conciliar automaticamente</BotaoTela>
          )}
          <BotaoTela primario disabled={ocupado} onClick={() => inputArq.current?.click()}>{ocupado ? "Aguarde…" : "Importar extrato"}</BotaoTela>
        </>}
      />

      <FaixaFiltros busca={q} onBusca={setQ} placeholder="Histórico, valor, documento… (clique num pendente para casar · j/k navega · / busca no painel)">
        <select value={conta} onChange={(e) => setConta(e.target.value)} style={campo} title="Conta corrente">
          {!conta && <option value="">Escolha a conta…</option>}
          {contas.map((c) => <option key={chaveConta(c)} value={chaveConta(c)}>{c.empresa} · {c.descricao}</option>)}
        </select>
        <CampoData valor={de} onChange={setDe} title="De" />
        <span style={{ color: "var(--ww-text-faint)", fontSize: 12 }}>→</span>
        <CampoData valor={ate} onChange={setAte} title="Até" />
        <ChipFiltro ativo={!estadoSel} onClick={() => setEstadoSel("")}>Todos</ChipFiltro>
        {(Object.keys(ESTADO) as Mov["estado"][]).map((k) => (
          <ChipFiltro key={k} ativo={estadoSel === k} onClick={() => setEstadoSel(estadoSel === k ? "" : k)}>
            {ESTADO[k].label} · {(movs ?? []).filter((m) => m.estado === k).length}
          </ChipFiltro>
        ))}
        <ChipFiltro ativo={soAuto} onClick={() => setSoAuto((v) => !v)}>
          Conciliados automaticamente · {(movs ?? []).filter((m) => m.auto).length}
        </ChipFiltro>
      </FaixaFiltros>

      {erro && <Aviso>{erro}</Aviso>}
      {aviso && <Aviso tone="ok">{aviso}</Aviso>}

      {mapear && (
        <MapearColunas dados={mapear} ocupado={ocupado} onCancelar={() => setMapear(null)}
          onConfirmar={(m) => previaArquivo(mapear.arquivo, m, contaSel)} />
      )}
      {previa && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {previa.extratos.map((x) => (
            <PreviaExtrato key={x.indice} x={x} arquivo={previa.arquivo.name} formato={previa.formato}
              contas={previa.contas.length ? previa.contas : contas} ocupado={ocupado}
              onImportar={(c, lembrar) => importar(x, c, lembrar)}
              onRecalcular={(c) => previaArquivo(previa.arquivo, previa.mapa, c)}
              onCancelar={() => setPrevia(null)} />
          ))}
        </div>
      )}
      {verRegras && (
        <PainelRegras regras={regras} contaSel={contaSel} ocupado={ocupado} acao={acao}
          aplicar={() => acao({ acao: "regras_aplicar", empresa: contaSel?.empresa, cod_cc: contaSel?.cod_cc, de, ate }, "Regras aplicadas aos pendentes")} />
      )}

      {movs && <GradeKpis kpis={kpis} />}
      {!movs && !erro && conta && <Carregando />}
      {movs && !lista.length && (
        <div style={{ ...cartao, padding: 20, fontSize: 13, color: "var(--ww-text-muted)" }}>
          {movs.length ? "Nenhum movimento neste filtro." : "Nenhum movimento desta conta no período — importe o OFX do banco."}
        </div>
      )}

      {!!lista.length && (
        <div style={{ ...cartao, padding: 0, overflow: "hidden" }}>
          {lista.map((m) => (
            <LinhaMov key={m.id} m={m} titulos={titulos} aberto={aberto === m.id} podeBaixar={podeBaixar} ocupado={ocupado}
              empresa={contaSel?.empresa ?? "SF"} codCc={contaSel?.cod_cc ?? null}
              onToggle={() => {
                if ((m.estado === "pendente" || m.estado === "parcial") && aberto !== m.id) { setAberto(m.id); abrirCasar(m.id); return; }
                setAberto(aberto === m.id ? null : m.id);
              }} acao={acao} />
          ))}
        </div>
      )}
    </PaginaNavy>
  );
}

function LinhaMov({ m, titulos, aberto, podeBaixar, ocupado, onToggle, acao, empresa, codCc }: {
  m: Mov; titulos: Titulo[]; aberto: boolean; podeBaixar: boolean; ocupado: boolean; empresa: string; codCc: number | null;
  onToggle: () => void; acao: (corpo: object, ok: string) => Promise<boolean>;
}) {
  const restante = Math.round((Math.abs(m.valor) - m.casado) * 100) / 100;
  const nat = m.valor < 0 ? "P" : "R";
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState("");
  const [forcar, setForcar] = useState(false);
  const cands = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return titulos.filter((x) => x.natureza === nat && (!t || `${x.contraparte ?? ""} ${x.documento ?? ""} ${x.saldo}`.toLowerCase().includes(t))).slice(0, 40);
  }, [titulos, nat, busca]);
  const somaSel = Object.values(sel).reduce((s, v) => s + (Number(v.replace(",", ".")) || 0), 0);
  const selNaoLiberado = nat === "P" && Object.keys(sel).some((k) => titulos.find((x) => x.titulo === k && x.natureza === "P")?.fase !== "liberado");
  const top = m.sugestoes[0];

  return (
    <div style={{ borderBottom: "1px solid var(--ww-border)" }}>
      <div onClick={onToggle} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto auto", gap: 12, alignItems: "center", padding: "10px 16px", cursor: "pointer" }}>
        <span style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{ddmmaa(m.data)}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, color: "var(--ww-text)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.memo || m.nome || m.tipo || "—"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>
            {m.nome && m.memo ? `${m.nome} · ` : ""}{m.checknum ? `doc ${m.checknum} · ` : ""}
            {m.estado === "ignorado" ? `ignorado: ${m.ignorado_motivo ?? ""}` :
              m.estado === "omie" ? `já baixado no Omie${m.omie_titulo ? ` · título ${m.omie_titulo}` : ""} — sem nova baixa` :
              m.baixas.length ? m.baixas.map((b) => `${b.documento ?? b.titulo} (${brl(b.valor)})`).join(" + ") :
              top ? `sugestão: ${top.contraparte ?? ""} · ${top.documento ?? ""}` : "sem sugestão"}
          </span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: m.valor < 0 ? "var(--ww-crit-text)" : "var(--ww-ok-text)", textAlign: "right" }}>
          {m.valor < 0 ? "−" : "+"}{brl(Math.abs(m.valor))}
          {m.estado === "parcial" && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--ww-text-faint)" }}>falta {brl(restante)}</span>}
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {(m.estado === "pendente" || m.estado === "parcial") && podeBaixar && (
            <button type="button" style={pilula("var(--ww-accent-text)")} onClick={(e) => { e.stopPropagation(); abrirCasar(m.id); }}>casar…</button>
          )}
          <StatusPill tone={ESTADO[m.estado].tom}>{ESTADO[m.estado].label}</StatusPill>
        </span>
      </div>

      {aberto && (
        <div style={{ padding: "4px 16px 14px 112px", display: "flex", flexDirection: "column", gap: 10 }}>
          {!!m.baixas.length && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Casado com:</span>
              {m.auto && <StatusPill tone="info">automático</StatusPill>}
              {m.baixas.map((b) => <span key={b.id} style={{ fontSize: 12, color: "var(--ww-text)" }}>{b.contraparte ?? ""} · {b.documento ?? b.titulo} · {brl(b.valor)}</span>)}
              <button type="button" disabled={ocupado} style={pilula("var(--ww-crit-text)")}
                onClick={() => acao({ acao: "desfazer", movimento_id: m.id, motivo: "Desfeito na tela de conciliação" }, "Conciliação desfeita — baixas estornadas")}>
                desfazer
              </button>
            </div>
          )}

          {m.estado !== "ignorado" && m.estado !== "omie" && restante > 0.004 && podeBaixar && (<>
            {!!m.sugestoes.length && (
              <div>
                <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginBottom: 4 }}>Sugestões</div>
                {m.sugestoes.map((s) => {
                  const valor = Math.min(s.saldo, restante);
                  const naoLib = s.natureza === "P" && s.fase !== "liberado";
                  // Grupo: um movimento paga várias parcelas — aceitar já divide pelos saldos.
                  const itens = s.grupo && s.itens?.length
                    ? s.itens.map((i) => ({ titulo: i.titulo, valor: i.saldo }))
                    : [{ titulo: s.titulo, valor }];
                  return (
                    <div key={s.titulo} style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
                      <span style={{ color: "var(--ww-text)", flex: 1, minWidth: 0 }}>
                        {s.grupo && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ww-accent-text)" }}>GRUPO · </span>}
                        {s.contraparte ?? "—"} · {s.documento ?? ""} · venc. {ddmmaa(s.vencimento)} · {s.grupo ? "soma" : "saldo"} {brl(s.saldo)}
                        {s.grupo && s.itens && (
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--ww-text-faint)" }}>
                            {s.itens.map((i) => `${i.documento ?? i.titulo} ${brl(i.saldo)}`).join(" + ")}
                          </span>
                        )}
                        {naoLib && <span style={{ color: "var(--ww-warn-text)" }}> · ainda não liberado ({s.fase})</span>}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>{s.score} pts</span>
                      <button type="button" disabled={ocupado || naoLib} title={naoLib ? "Use \"casar à mão\" com forçar + motivo" : undefined}
                        style={pilula("var(--ww-ok-text)")}
                        onClick={() => acao({ acao: "conciliar", movimento_id: m.id, itens },
                                            `Conciliado: ${s.contraparte ?? ""} ${brl(s.grupo ? s.saldo : valor)}${s.grupo ? ` em ${itens.length} títulos` : ""}`)}>
                        aceitar {brl(s.grupo ? s.saldo : valor)}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Casar à mão ({nat === "P" ? "contas a pagar" : "contas a receber"} do painel)</span>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar…" style={{ ...campo, padding: "3px 8px", fontSize: 12 }} />
              </div>
              {!cands.length && <div style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Nenhum título do painel em aberto deste lado.</div>}
              {cands.map((x) => {
                const marcado = x.titulo in sel;
                return (
                  <label key={x.titulo} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 12.5, color: "var(--ww-text)" }}>
                    <input type="checkbox" checked={marcado} onChange={(e) => {
                      const n = { ...sel };
                      if (e.target.checked) n[x.titulo] = Math.min(x.saldo, Math.max(restante - somaSel, 0)).toFixed(2); else delete n[x.titulo];
                      setSel(n);
                    }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{x.contraparte ?? "—"} · {x.documento ?? ""} · venc. {ddmmaa(x.vencimento)} · saldo {brl(x.saldo)}{x.natureza === "P" && x.fase !== "liberado" ? ` · ${x.fase}` : ""}</span>
                    {marcado && <input value={sel[x.titulo]} onChange={(e) => setSel({ ...sel, [x.titulo]: e.target.value })} inputMode="decimal"
                      style={{ ...campo, width: 110, padding: "3px 8px", fontSize: 12 }} />}
                  </label>
                );
              })}
              {!!Object.keys(sel).length && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: Math.abs(somaSel - restante) < 0.005 ? "var(--ww-ok-text)" : "var(--ww-text-muted)" }}>
                    {brl(somaSel)} de {brl(restante)}
                  </span>
                  {selNaoLiberado && (<>
                    <label style={{ fontSize: 12, color: "var(--ww-warn-text)", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> forçar (título não liberado)
                    </label>
                    {forcar && <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo" style={{ ...campo, padding: "3px 8px", fontSize: 12 }} />}
                  </>)}
                  <button type="button" disabled={ocupado || somaSel <= 0 || somaSel > restante + 0.004 || (selNaoLiberado && (!forcar || !motivo.trim()))}
                    style={pilula("var(--ww-ok-text)")}
                    onClick={async () => {
                      const itens = Object.entries(sel).map(([titulo, v]) => ({ titulo, valor: Number(v.replace(",", ".")), forcar: forcar && selNaoLiberado, ...(forcar && motivo.trim() ? { obs: motivo.trim() } : {}) }));
                      if (await acao({ acao: "conciliar", movimento_id: m.id, itens }, `Conciliado em ${itens.length} título(s)`)) { setSel({}); setForcar(false); setMotivo(""); }
                    }}>
                    conciliar selecionados
                  </button>
                </div>
              )}
            </div>
          </>)}
          {!podeBaixar && m.estado !== "conciliado" && <div style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Sem permissão para baixar títulos — só visualização.</div>}

          {!m.baixas.length && m.estado !== "omie" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {m.ignorado && m.transferencia_par ? (
                <button type="button" disabled={ocupado} style={pilula("var(--ww-text-muted)")}
                  onClick={() => acao({ acao: "transferencia_desfazer", movimento_id: m.id }, "Transferência desfeita nos dois extratos")}>desfazer transferência</button>
              ) : m.ignorado ? (
                <button type="button" disabled={ocupado} style={pilula("var(--ww-text-muted)")}
                  onClick={() => acao({ acao: "reativar", movimento_id: m.id }, "Movimento reativado")}>reativar</button>
              ) : (<>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo para ignorar (tarifa, transferência…)"
                  style={{ ...campo, padding: "3px 8px", fontSize: 12, width: 280 }} />
                <button type="button" disabled={ocupado || !motivo.trim()} style={pilula("var(--ww-text-muted)")}
                  onClick={() => acao({ acao: "ignorar", movimento_id: m.id, motivo }, "Movimento ignorado")}>ignorar</button>
              </>)}
            </div>
          )}
          {m.estado !== "ignorado" && m.estado !== "omie" && restante > 0.004 && podeBaixar && (
            <AcoesExtra m={m} restante={restante} empresa={empresa} codCc={codCc} ocupado={ocupado} acao={acao} />
          )}
          <div style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>FITID {m.fitid}{m.arquivo ? ` · ${m.arquivo}` : ""}</div>
        </div>
      )}
    </div>
  );
}


// ── Lançar título a partir do movimento / criar regra ──────────────────────
const cacheCategorias = new Map<string, Categoria[]>();
function useCategorias(empresa: string, nat: "P" | "R") {
  const chave = `${empresa}:${nat}`;
  const [lista, setLista] = useState<Categoria[]>(() => cacheCategorias.get(chave) ?? []);
  useEffect(() => {
    if (cacheCategorias.has(chave)) { setLista(cacheCategorias.get(chave)!); return; }
    fetch(`/api/financeiro/aux?empresa=${empresa}&tipo=${nat === "P" ? "pagar" : "receber"}`).then((r) => r.json()).then((j) => {
      const cs = ((j.categorias ?? []) as { codigo: string; descricao: string }[]).map((c) => ({ codigo: c.codigo, descricao: c.descricao }));
      cacheCategorias.set(chave, cs); setLista(cs);
    }).catch(() => null);
  }, [chave, empresa, nat]);
  return lista;
}

function AcoesExtra({ m, restante, empresa, codCc, ocupado, acao }: {
  m: Mov; restante: number; empresa: string; codCc: number | null; ocupado: boolean;
  acao: (corpo: object, ok: string) => Promise<boolean>;
}) {
  const nat = m.valor < 0 ? "P" : "R";
  const cats = useCategorias(empresa, nat);
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState("");
  const [regra, setRegra] = useState(false);
  const [contem, setContem] = useState(() => (m.memo ?? m.nome ?? "").replace(/\d{3,}.*$/, "").trim().slice(0, 40));
  const [acaoRegra, setAcaoRegra] = useState<"lancar" | "ignorar">("lancar");
  const [soConta, setSoConta] = useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px dashed var(--ww-border)", paddingTop: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Sem título? Lançar {nat === "P" ? "despesa" : "receita"} de {brl(restante)}:</span>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...campo, padding: "3px 8px", fontSize: 12, maxWidth: 280 }}>
          <option value="">categoria…</option>
          {cats.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
        </select>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="descrição (tarifa, juros, rendimento…)"
          style={{ ...campo, padding: "3px 8px", fontSize: 12, width: 220 }} />
        <button type="button" disabled={ocupado || !cat} style={pilula("var(--ww-ok-text)")}
          onClick={() => acao({ acao: "lancar", movimento_id: m.id, categoria: cat, descricao: desc || m.memo }, `Lançado e conciliado: ${brl(restante)}`)}>
          lançar e conciliar
        </button>
        <button type="button" style={pilula("var(--ww-text-muted)")} onClick={() => setRegra((v) => !v)}>{regra ? "fechar regra" : "criar regra…"}</button>
      </div>
      {regra && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "var(--ww-text-muted)" }}>
          <span>Sempre que o histórico contiver</span>
          <input value={contem} onChange={(e) => setContem(e.target.value)} style={{ ...campo, padding: "3px 8px", fontSize: 12, width: 200 }} />
          <select value={acaoRegra} onChange={(e) => setAcaoRegra(e.target.value as "lancar" | "ignorar")} style={{ ...campo, padding: "3px 8px", fontSize: 12 }}>
            <option value="lancar">lançar na categoria escolhida acima</option>
            <option value="ignorar">ignorar (transferência, etc.)</option>
          </select>
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={soConta} onChange={(e) => setSoConta(e.target.checked)} /> só nesta conta
          </label>
          <button type="button" disabled={ocupado || contem.trim().length < 3 || (acaoRegra === "lancar" && !cat)} style={pilula("var(--ww-accent-text)")}
            onClick={() => acao({ acao: "regra_criar", contem, acao_regra: acaoRegra, categoria: cat || null, descricao: desc || null,
              natureza: nat, empresa, cod_cc: soConta ? codCc : null }, `Regra criada: "${contem}" — vale para as próximas importações (e "Aplicar regras")`)}>
            salvar regra
          </button>
        </div>
      )}
    </div>
  );
}

// ── Assistente de importação ───────────────────────────────────────────────
function PreviaExtrato({ x, arquivo, formato, contas, ocupado, onImportar, onRecalcular, onCancelar }: {
  x: ExtPrev; arquivo: string; formato: string; contas: Conta[]; ocupado: boolean;
  onImportar: (c: Conta, lembrar: boolean) => void; onRecalcular: (c: Conta) => void; onCancelar: () => void;
}) {
  const [sel, setSel] = useState(x.conta ? chaveConta(x.conta) : "");
  const [lembrar, setLembrar] = useState(!x.lembrada);
  const escolhida = contas.find((c) => chaveConta(c) === sel) ?? null;
  const p = x.previa;
  const avisos: { t: string; tom: "warn" | "crit" | "ok" }[] = [];
  if (p?.duplicados) avisos.push({ t: `${p.duplicados} de ${x.n} lançamento(s) já estão no painel — não serão duplicados`, tom: "warn" });
  if (p?.lacuna_dias) avisos.push({ t: `Buraco de ${p.lacuna_dias} dia(s) desde o último extrato importado (até ${ddmmaa(p.ultimo_extrato_ate ?? null)})`, tom: "crit" });
  if (p?.sobreposicao) avisos.push({ t: `Período sobrepõe a última importação (até ${ddmmaa(p.ultimo_extrato_ate ?? null)})`, tom: "warn" });
  if (p?.saldo_confere === false) avisos.push({ t: `Saldo não emenda: o arquivo abre com ${brl(x.saldo.abertura ?? 0)} e a última importação fechou com ${brl(p.saldo_anterior ?? 0)}`, tom: "crit" });
  if (p?.saldo_confere === true) avisos.push({ t: "Saldo emenda com a última importação", tom: "ok" });
  const cor = { warn: "var(--ww-warn-text)", crit: "var(--ww-crit-text)", ok: "var(--ww-ok-text)" };
  return (
    <div style={{ ...cartao, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ww-text)" }}>Prévia · {arquivo}</span>
        <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>
          {formato.toUpperCase()}{x.cartao ? " · cartão" : ""} · banco {x.banco ?? "?"} · ag. {x.agencia ?? "?"} · conta {x.conta_arquivo ?? "?"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, fontSize: 12.5, color: "var(--ww-text)" }}>
        <span>Período<br /><b>{ddmmaa(x.inicio)} → {ddmmaa(x.fim)}</b></span>
        <span>Lançamentos<br /><b>{x.n}</b></span>
        <span>Entradas<br /><b style={{ color: "var(--ww-ok-text)" }}>{brl(x.entradas)}</b></span>
        <span>Saídas<br /><b style={{ color: "var(--ww-crit-text)" }}>{brl(x.saidas)}</b></span>
        <span>Saldo inicial (arquivo)<br /><b>{x.saldo.abertura == null ? "—" : brl(x.saldo.abertura)}</b></span>
        <span>Saldo final (arquivo)<br /><b>{x.saldo.fechamento == null ? "—" : brl(x.saldo.fechamento)}</b></span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Conta:</span>
        <select value={sel} onChange={(e) => { setSel(e.target.value); const c = contas.find((k) => chaveConta(k) === e.target.value); if (c) onRecalcular(c); }}
          style={{ ...campo, minWidth: 260 }}>
          <option value="">{x.candidatos.length ? "escolha (várias combinam)…" : "não achei — escolha…"}</option>
          {x.candidatos.length > 0 && <optgroup label="Combinam com o arquivo">
            {x.candidatos.map((c) => <option key={"c" + chaveConta(c)} value={chaveConta(c)}>{c.empresa} · {c.descricao}</option>)}
          </optgroup>}
          <optgroup label="Todas as contas">
            {contas.map((c) => <option key={chaveConta(c)} value={chaveConta(c)}>{c.empresa} · {c.descricao}</option>)}
          </optgroup>
        </select>
        {x.lembrada && <StatusPill tone="info">conta lembrada</StatusPill>}
        {!x.lembrada && x.conta_arquivo && (
          <label style={{ fontSize: 12, color: "var(--ww-text-muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> lembrar esta conta para este banco/agência/conta
          </label>
        )}
        <a href="/cadastros/contas" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ww-accent-text)" }}>+ cadastrar conta</a>
      </div>
      {!!avisos.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {avisos.map((a, i) => <span key={i} style={{ fontSize: 12.5, color: cor[a.tom] }}>{a.tom === "ok" ? "✓" : "⚠"} {a.t}</span>)}
        </div>
      )}
      <div style={{ maxHeight: 180, overflow: "auto", borderTop: "1px solid var(--ww-border)" }}>
        {x.amostra.map((m) => (
          <div key={m.fitid} style={{ display: "grid", gridTemplateColumns: "70px 1fr auto", gap: 8, fontSize: 12, padding: "3px 0", color: "var(--ww-text-2)" }}>
            <span>{ddmmaa(m.data)}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.memo ?? m.nome ?? "—"}</span>
            <span style={{ color: m.valor < 0 ? "var(--ww-crit-text)" : "var(--ww-ok-text)" }}>{brl(m.valor)}</span>
          </div>
        ))}
        {x.n > x.amostra.length && <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", padding: "3px 0" }}>… e mais {x.n - x.amostra.length}</div>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <BotaoTela primario disabled={ocupado || !escolhida} onClick={() => escolhida && onImportar(escolhida, lembrar && !x.lembrada)}>
          Importar {x.n} lançamento(s){p?.duplicados ? ` (${x.n - p.duplicados} novos)` : ""}
        </BotaoTela>
        <BotaoTela onClick={onCancelar}>Cancelar</BotaoTela>
      </div>
    </div>
  );
}

const CAMPOS_MAPA: { k: keyof Mapa; rotulo: string; obrig?: boolean }[] = [
  { k: "data", rotulo: "Data", obrig: true }, { k: "historico", rotulo: "Histórico", obrig: true },
  { k: "valor", rotulo: "Valor (com sinal)" }, { k: "credito", rotulo: "Crédito" }, { k: "debito", rotulo: "Débito" },
  { k: "documento", rotulo: "Documento" }, { k: "nome", rotulo: "Favorecido / pagador" }, { k: "saldo", rotulo: "Saldo" },
];

function MapearColunas({ dados, ocupado, onConfirmar, onCancelar }: {
  dados: { arquivo: File; cabecalho: string[]; amostra: unknown[][]; mapa: Mapa }; ocupado: boolean;
  onConfirmar: (m: Mapa) => void; onCancelar: () => void;
}) {
  const [m, setM] = useState<Mapa>(dados.mapa);
  const ok = m.data >= 0 && m.historico >= 0 && (m.valor >= 0 || (m.credito ?? -1) >= 0 || (m.debito ?? -1) >= 0);
  return (
    <div style={{ ...cartao, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ww-text)" }}>Colunas do extrato · {dados.arquivo.name}</div>
      <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Diga o que é cada coluna. O mapa fica guardado para esta conta e é usado nas próximas importações.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {CAMPOS_MAPA.map((c) => (
          <label key={c.k} style={{ fontSize: 12, color: "var(--ww-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
            {c.rotulo}{c.obrig ? " *" : ""}
            <select value={(m[c.k] as number | undefined) ?? -1} onChange={(e) => setM({ ...m, [c.k]: Number(e.target.value) })} style={{ ...campo, padding: "3px 8px", fontSize: 12 }}>
              <option value={-1}>—</option>
              {dados.cabecalho.map((h, i) => <option key={i} value={i}>{h || `coluna ${i + 1}`}</option>)}
            </select>
          </label>
        ))}
        <label style={{ fontSize: 12, color: "var(--ww-text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          Data em
          <select value={m.formato_data ?? "dmy"} onChange={(e) => setM({ ...m, formato_data: e.target.value as Mapa["formato_data"] })} style={{ ...campo, padding: "3px 8px", fontSize: 12 }}>
            <option value="dmy">dia/mês/ano</option><option value="mdy">mês/dia/ano</option><option value="ymd">ano-mês-dia</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--ww-text-muted)", display: "inline-flex", gap: 4, alignItems: "center", alignSelf: "end" }}>
          <input type="checkbox" checked={!!m.inverter_sinal} onChange={(e) => setM({ ...m, inverter_sinal: e.target.checked })} /> inverter sinal
        </label>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>{dados.cabecalho.map((h, i) => <th key={i} style={{ padding: "4px 8px", borderBottom: "1px solid var(--ww-border)", color: "var(--ww-text-muted)", textAlign: "left" }}>{h || i + 1}</th>)}</tr></thead>
          <tbody>{dados.amostra.map((l, i) => <tr key={i}>{dados.cabecalho.map((_, j) => <td key={j} style={{ padding: "3px 8px", color: "var(--ww-text-2)", whiteSpace: "nowrap" }}>{String((l as unknown[])[j] ?? "")}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <BotaoTela primario disabled={ocupado || !ok} onClick={() => onConfirmar(m)}>Ver prévia</BotaoTela>
        <BotaoTela onClick={onCancelar}>Cancelar</BotaoTela>
      </div>
    </div>
  );
}

function PainelRegras({ regras, contaSel, ocupado, acao, aplicar }: {
  regras: Regra[] | null; contaSel: Conta | undefined; ocupado: boolean;
  acao: (corpo: object, ok: string) => Promise<boolean>; aplicar: () => void;
}) {
  return (
    <div style={{ ...cartao, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ww-text)", flex: 1 }}>Regras de conciliação</span>
        <BotaoTela disabled={ocupado || !contaSel} onClick={aplicar}>Aplicar regras agora</BotaoTela>
      </div>
      <div style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>
        Rodam a cada importação e de hora em hora. Crie uma regra a partir de um movimento ("criar regra…").
      </div>
      {regras === null && <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Carregando…</span>}
      {regras && !regras.length && <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Nenhuma regra ainda.</span>}
      {regras?.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--ww-text)" }}>
          <span style={{ flex: 1 }}>
            contém <b>"{r.contem}"</b>{r.natureza ? (r.natureza === "P" ? " (saídas)" : " (entradas)") : ""} →{" "}
            {r.acao === "ignorar" ? "ignorar" : `lançar ${r.categoria_cod ?? ""}${r.descricao ? ` · ${r.descricao}` : ""}`}
            <span style={{ color: "var(--ww-text-faint)" }}> · {r.empresa ?? "todas"}{r.cod_cc ? " · só uma conta" : ""} · usada {r.aplicacoes}×</span>
          </span>
          <button type="button" disabled={ocupado} style={pilula("var(--ww-crit-text)")}
            onClick={() => acao({ acao: "regra_remover", id: r.id }, "Regra removida")}>remover</button>
        </div>
      ))}
    </div>
  );
}
