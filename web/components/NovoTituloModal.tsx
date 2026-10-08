"use client";

// Modal "Nova conta" (a pagar ou a receber) via /api/financeiro/titulos/incluir.
// Pagar e receber nascem só no painel (05/10/26): a pagar em
// finance.pagar_previsto (origem manual, sql/67), a receber em finance.receber.
// O Omie não recebe nada.

import { useEffect, useRef, useState } from "react";
import { lerBoleto } from "@/lib/boleto";

type Cliente = { codigo_cliente_omie: number; nome_fantasia: string | null; razao_social: string | null; cnpj_cpf: string | null };
type Categoria = { codigo: string; descricao: string };
type Conta = { cod_cc: number; descricao: string };
type Projeto = { codigo: number; nome: string };

/* Tipos de documento e origens que o Omie aceita — a lista saiu do que já
   está lançado na base (finance.pesquisa_titulos), não de um catálogo
   inventado: são os 17 tipos e 8 origens que a empresa usa de facto. */
const TIPOS_DOC: [string, string][] = [
  ["NFE", "Nota fiscal eletrônica"],
  ["NFS", "Nota fiscal de serviço"],
  ["BOL", "Boleto"],
  ["PIX", "PIX"],
  ["FAT", "Fatura"],
  ["REC", "Recibo"],
  ["CTE", "Conhecimento de transporte"],
  ["DAS", "DAS — Simples Nacional"],
  ["DARE", "DARE"],
  ["ND", "Nota de débito"],
  ["ADI", "Adiantamento"],
  ["ANT", "Antecipação"],
  ["PED", "Pedido"],
  ["DEBA", "Débito automático"],
  ["FPGT", "Folha de pagamento"],
  ["CUSJ", "Custas judiciais"],
  ["99999", "Outros"],
];

const ORIGENS: [string, string][] = [
  ["MANP", "Lançamento manual"],
  ["COMP", "Compra"],
  ["ADCP", "Adiantamento"],
  ["CTEP", "Conhecimento de transporte"],
  ["DEVP", "Devolução"],
  ["BARP", "Arquivo de retorno"],
  ["RPTP", "Repetição / recorrência"],
  ["APIP", "API"],
];

const IMPOSTOS = [
  { chave: "pis" as const,    nome: "PIS" },
  { chave: "cofins" as const, nome: "COFINS" },
  { chave: "csll" as const,   nome: "CSLL" },
  { chave: "ir" as const,     nome: "IR" },
  { chave: "iss" as const,    nome: "ISS" },
  { chave: "inss" as const,   nome: "INSS" },
];
type ChaveImposto = (typeof IMPOSTOS)[number]["chave"];

/** "1.234,56" → 1234.56. Vazio vira 0. */
function paraNumero(v: string): number {
  const n = Number((v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
const moedaBR = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* Secção dobrável. O formulário passou de 9 para 21 campos; mostrar os 21
   abertos transformava "lançar uma conta" numa provação. O essencial fica à
   vista, o resto abre — e o cabeçalho resume o que está lá dentro, para não
   ser preciso abrir só para conferir. */
function Secao({ titulo, resumo, aberta, onToggle, children }: {
  titulo: string; resumo?: string; aberta: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-ww-border rounded-lg overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-ww-bg transition">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ww-textMuted">{titulo}</span>
        <span className="flex items-center gap-2 min-w-0">
          {!aberta && resumo && (
            <span className="text-[11px] text-ww-textFaint truncate max-w-[220px]">{resumo}</span>
          )}
          <span className="text-[9px] text-ww-textFaint">{aberta ? "▲" : "▼"}</span>
        </span>
      </button>
      {aberta && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

function hojeISO() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export default function NovoTituloModal({
  tipo, onClose, onCreated, inicial,
}: {
  tipo: "pagar" | "receber";
  onClose: () => void;
  onCreated: () => void;
  /** pré-preenchimento (08/10/26 — "lançar" um evento do simulador do Fluxo de Caixa) */
  inicial?: { empresa?: string; valor?: number; vencimento?: string; obs?: string; recorrencia?: number };
}) {
  const [empresa, setEmpresa] = useState(inicial?.empresa ?? "SF");
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [contraparte, setContraparte] = useState<Cliente | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);

  const [valor, setValor] = useState(inicial?.valor ? inicial.valor.toFixed(2).replace(".", ",") : "");
  const [vencimento, setVencimento] = useState(inicial?.vencimento ?? hojeISO());
  const [previsao, setPrevisao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [conta, setConta] = useState("");
  const [projeto, setProjeto] = useState("");
  const [numeroDoc, setNumeroDoc] = useState("");
  const [barras, setBarras] = useState("");
  const [barrasAviso, setBarrasAviso] = useState<string | null>(null);
  const [gerandoDoc, setGerandoDoc] = useState(false);
  const [obs, setObs] = useState(inicial?.obs ?? "");
  // Recorrência (sql/73): gera uma série de contas a partir do 1º vencimento.
  const [recFreq, setRecFreq] = useState(inicial?.recorrencia && inicial.recorrencia > 1 ? "mensal" : "");
  const [recModo, setRecModo] = useState<"n" | "ate" | "sem_fim">("n");
  const [recN, setRecN] = useState(inicial?.recorrencia && inicial.recorrencia > 1 ? String(inicial.recorrencia) : "12");
  const [recAte, setRecAte] = useState("");
  const [recDia, setRecDia] = useState("");
  const [recValor, setRecValor] = useState<"por_ocorrencia" | "dividir">("por_ocorrencia");

  // Campos do Omie que o formulário não pedia.
  const [tipoDoc, setTipoDoc] = useState("");
  const [origem, setOrigem] = useState("");
  const [numeroDocFiscal, setNumeroDocFiscal] = useState("");
  const [numeroParcela, setNumeroParcela] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [chaveNfe, setChaveNfe] = useState("");
  const [emissao, setEmissao] = useState("");
  const [entrada, setEntrada] = useState("");
  const [impostos, setImpostos] = useState<Record<ChaveImposto, string>>({
    pis: "", cofins: "", csll: "", ir: "", iss: "", inss: "",
  });
  const [secDoc, setSecDoc] = useState(false);
  const [secDatas, setSecDatas] = useState(false);
  const [secImp, setSecImp] = useState(false);
  const totalImpostos = IMPOSTOS.reduce((t, i) => t + paraNumero(impostos[i.chave]), 0);

  const [salvando, setSalvando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rotulo = tipo === "pagar" ? "Fornecedor" : "Cliente";

  // Cadastros fixos (categorias, contas, projetos) por empresa
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/financeiro/aux?empresa=${empresa}&tipo=${tipo}`);
        const j = await r.json();
        if (r.ok) {
          setCategorias(j.categorias ?? []);
          setContas(j.contas_correntes ?? []);
          setProjetos(j.projetos ?? []);
        }
      } catch { /* mantém listas atuais */ }
    })();
  }, [empresa, tipo]);

  // Busca de contraparte com debounce
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setClientes([]); return; }
    debounce.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/financeiro/aux?empresa=${empresa}&tipo=${tipo}&q=${encodeURIComponent(q.trim())}`);
        const j = await r.json();
        if (r.ok) setClientes(j.clientes ?? []);
      } catch { /* ignora */ }
      finally { setBuscando(false); }
    }, 350);
  }, [q, empresa, tipo]);

  async function salvar() {
    setErr(null);
    if (!contraparte) { setErr(`Escolha o ${rotulo.toLowerCase()}`); return; }
    const v = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!v || v <= 0) { setErr("Valor inválido"); return; }
    if (!vencimento) { setErr("Informe o vencimento"); return; }
    if (!categoria) { setErr("Escolha a categoria"); return; }
    if (!conta) { setErr("Escolha a conta corrente"); return; }
    if (tipo === "pagar" && !numeroDoc.trim() && !numeroDocFiscal.trim()) { setErr("Informe o nº do documento ou da nota fiscal (ou gere um)"); return; }
    const bd = barras.replace(/\D/g, "");
    if (bd && ![44, 47, 48].includes(bd.length)) { setErr("Código de barras deve ter 44, 47 ou 48 dígitos"); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/financeiro/titulos/incluir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo, empresa,
          codigo_cliente_fornecedor: contraparte.codigo_cliente_omie,
          valor_documento: v,
          data_vencimento: vencimento,
          data_previsao: previsao || undefined,
          recorrencia: recFreq ? {
            freq: recFreq, n: recModo === "n" ? Number(recN) || null : null, ate: recModo === "ate" ? recAte || null : null,
            sem_fim: recModo === "sem_fim", dia_fixo: recDia ? Number(recDia) : null, valor_modo: recValor,
          } : undefined,
          codigo_categoria: categoria,
          id_conta_corrente: Number(conta),
          codigo_projeto: projeto ? Number(projeto) : undefined,
          numero_documento: numeroDoc || undefined,
          codigo_barras: barras.replace(/\D/g, "") || undefined,
          observacao: obs || undefined,

          codigo_tipo_documento: tipoDoc || undefined,
          id_origem: origem || undefined,
          numero_documento_fiscal: numeroDocFiscal || undefined,
          numero_parcela: numeroParcela || undefined,
          numero_pedido: numeroPedido || undefined,
          chave_nfe: chaveNfe || undefined,
          data_emissao: emissao || undefined,
          data_entrada: entrada || undefined,
          // Valor preenchido implica retenção — o par vai junto ou nenhum vai.
          valor_pis: paraNumero(impostos.pis) || undefined,       retem_pis: paraNumero(impostos.pis) > 0,
          valor_cofins: paraNumero(impostos.cofins) || undefined, retem_cofins: paraNumero(impostos.cofins) > 0,
          valor_csll: paraNumero(impostos.csll) || undefined,     retem_csll: paraNumero(impostos.csll) > 0,
          valor_ir: paraNumero(impostos.ir) || undefined,         retem_ir: paraNumero(impostos.ir) > 0,
          valor_iss: paraNumero(impostos.iss) || undefined,       retem_iss: paraNumero(impostos.iss) > 0,
          valor_inss: paraNumero(impostos.inss) || undefined,     retem_inss: paraNumero(impostos.inss) > 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setOk(true);
      setTimeout(() => { onCreated(); onClose(); }, 800);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setSalvando(false); }
  }

  async function gerarDocumento() {
    setGerandoDoc(true); setErr(null);
    try {
      const r = await fetch("/api/financeiro/titulos/incluir", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "gerar_documento", tipo, empresa }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNumeroDoc(j.documento);
    } catch (e) { setErr((e as Error).message); } finally { setGerandoDoc(false); }
  }
  function mudarBarras(v: string) {
    setBarras(v);
    const l = lerBoleto(v);
    if (!v.replace(/\D/g, "")) { setBarrasAviso(null); return; }
    if (!l) { setBarrasAviso("44, 47 ou 48 dígitos"); return; }
    const lidos: string[] = [];
    if (l.valor && !valor.trim()) { setValor(l.valor.toFixed(2).replace(".", ",")); lidos.push("valor"); }
    if (l.vencimento && vencimento === hojeISO()) { setVencimento(l.vencimento); lidos.push("vencimento"); }
    setBarrasAviso([l.aviso, lidos.length ? `${lidos.join(" e ")} lidos do código de barras` : null,
      l.tipo === "concessionaria" ? "concessionária/tributo" : null].filter(Boolean).join(" · ") || "código válido");
  }

  const inputCls = "w-full px-3 py-2 border border-ww-border rounded-md bg-ww-bg text-[13px] text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40";
  const labelCls = "block text-[11px] font-medium text-ww-textMuted mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="bg-ww-panel border border-ww-border rounded-xl shadow-2xl max-w-2xl w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-ww-text text-[15px]">
              Nova conta a {tipo === "pagar" ? "pagar" : "receber"}
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              {tipo === "pagar" ? "Grava no painel e entra no Contas a Pagar, no BI e no fluxo de caixa na hora." : "Grava no painel e entra no Contas a Receber, no BI e no fluxo de caixa na hora."}
            </p>
          </div>
          <button onClick={onClose} className="text-ww-textFaint hover:text-ww-text text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Empresa</label>
            <select value={empresa} onChange={(e) => { setEmpresa(e.target.value); setContraparte(null); setQ(""); }} className={inputCls}>
              {["SF", "CD", "WW"].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Valor (R$) *</label>
            <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" className={inputCls} />
          </div>
        </div>

        <div className="relative">
          <label className={labelCls}>{rotulo} *</label>
          {contraparte ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border border-ww-accent/50 rounded-md bg-ww-accentSoft/30 text-[13px]">
              <span className="truncate text-ww-text font-medium">
                {contraparte.nome_fantasia || contraparte.razao_social}
                {contraparte.cnpj_cpf ? <span className="text-ww-textFaint font-normal"> · {contraparte.cnpj_cpf}</span> : null}
              </span>
              <button onClick={() => { setContraparte(null); setQ(""); }} className="text-ww-textFaint hover:text-ww-text">×</button>
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Buscar por nome ou CNPJ… (mín. 2 letras)" className={inputCls} />
              {(clientes.length > 0 || buscando) && q.trim().length >= 2 && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-ww-border bg-ww-panel shadow-xl">
                  {buscando && <div className="px-3 py-2 text-[12px] text-ww-textMuted">Buscando…</div>}
                  {clientes.map((c) => (
                    <button key={c.codigo_cliente_omie}
                      onClick={() => setContraparte(c)}
                      className="w-full text-left px-3 py-2 text-[12px] hover:bg-ww-rowHover text-ww-text">
                      <span className="font-medium">{c.nome_fantasia || c.razao_social}</span>
                      {c.cnpj_cpf && <span className="text-ww-textFaint"> · {c.cnpj_cpf}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{recFreq ? "1º vencimento *" : "Vencimento *"}</label>
            <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Previsão de {tipo === "pagar" ? "pagamento" : "recebimento"}</label>
            <input type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={inputCls} placeholder="= vencimento" disabled={!!recFreq} />
            <p className="text-[10.5px] text-ww-textFaint mt-1">
              {recFreq ? "Na recorrência a previsão de cada conta é o vencimento (ou o próximo dia útil)." :
                previsao && [0, 6].includes(new Date(previsao + "T00:00:00").getDay()) ? "⚠ fim de semana — o banco só processa no próximo dia útil" :
                "Vazia = vencimento; se cair em fim de semana ou feriado, vai para o próximo dia útil."}</p>
          </div>
        </div>

        <div className="border border-ww-border rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Recorrência</label>
              <select value={recFreq} onChange={(e) => setRecFreq(e.target.value)} className={inputCls}>
                <option value="">Não repete</option>
                <option value="semanal">Semanal</option><option value="mensal">Mensal</option><option value="bimestral">Bimestral</option>
                <option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
              </select>
            </div>
            {recFreq && (
              <div>
                <label className={labelCls}>Até</label>
                <select value={recModo} onChange={(e) => setRecModo(e.target.value as typeof recModo)} className={inputCls}>
                  <option value="n">Nº de ocorrências</option><option value="ate">Uma data final</option><option value="sem_fim">Sem fim (gera 12 e vai renovando)</option>
                </select>
              </div>
            )}
          </div>
          {recFreq && (
            <div className="grid grid-cols-3 gap-3">
              {recModo === "n" && <div><label className={labelCls}>Ocorrências</label><input value={recN} onChange={(e) => setRecN(e.target.value.replace(/\D/g, ""))} className={inputCls} /></div>}
              {recModo === "ate" && <div><label className={labelCls}>Data final</label><input type="date" value={recAte} onChange={(e) => setRecAte(e.target.value)} className={inputCls} /></div>}
              {recModo === "sem_fim" && <div />}
              {recFreq !== "semanal" ? (
                <div><label className={labelCls}>Dia fixo do mês</label><input value={recDia} onChange={(e) => setRecDia(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="= dia do 1º venc." className={inputCls} /></div>
              ) : <div />}
              <div><label className={labelCls}>Valor informado é</label>
                <select value={recValor} onChange={(e) => setRecValor(e.target.value as typeof recValor)} className={inputCls} disabled={recModo === "sem_fim"}>
                  <option value="por_ocorrencia">por ocorrência</option><option value="dividir">o total (dividir)</option>
                </select></div>
              <p className="col-span-3 text-[11px] text-ww-textMuted">
                {(() => {
                  const v = Number(valor.replace(/\./g, "").replace(",", ".")) || 0;
                  const n = recModo === "n" ? Number(recN) || 0 : null;
                  if (recModo === "sem_fim") return `Gera as próximas 12 contas de ${moedaBR(v)} e mantém sempre 12 à frente. Dá para editar ou encerrar a série depois.`;
                  if (n) return `${n} contas de ${moedaBR(recValor === "dividir" ? v / n : v)} (total ${moedaBR(recValor === "dividir" ? v : v * n)}). Edite depois: só esta, esta e as próximas, ou todas.`;
                  return "As contas vão até a data final.";
                })()}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Categoria *</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputCls}>
              <option value="">— Escolha —</option>
              {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.descricao}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Conta corrente *</label>
            <select value={conta} onChange={(e) => setConta(e.target.value)} className={inputCls}>
              <option value="">— Escolha —</option>
              {contas.map((c) => <option key={c.cod_cc} value={c.cod_cc}>{c.descricao}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Projeto</label>
            <select value={projeto} onChange={(e) => setProjeto(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {projetos.map((p) => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Nº documento{tipo === "pagar" ? " * (ou nº da NF)" : ""}</label>
            <div className="flex gap-2">
              <input value={numeroDoc} onChange={(e) => setNumeroDoc(e.target.value)} className={inputCls} />
              {tipo === "pagar" && (
                <button type="button" onClick={gerarDocumento} disabled={gerandoDoc}
                        title="Sem documento? Gera um nº único (PG-empresa-AAMM-sequência) para ficar registrado"
                        className="shrink-0 px-2 text-[11.5px] border border-ww-border rounded-md text-ww-text hover:bg-ww-bg">
                  {gerandoDoc ? "…" : "Gerar nº"}</button>
              )}
            </div>
          </div>
        </div>

        {tipo === "pagar" && (
          <div>
            <label className={labelCls}>Código de barras / linha digitável do boleto</label>
            <input value={barras} onChange={(e) => mudarBarras(e.target.value)} inputMode="numeric"
                   placeholder="cole aqui — 44, 47 ou 48 dígitos" className={`${inputCls} font-mono text-[12px]`} />
            {barrasAviso && <p className="text-[10.5px] text-ww-textFaint mt-1">{barrasAviso}</p>}
          </div>
        )}

        <p className="text-[11px] text-ww-textFaint">
          Emissão: {emissao ? new Date(emissao + "T12:00:00").toLocaleDateString("pt-BR")
            : <>hoje, {new Date().toLocaleDateString("pt-BR")} — data do lançamento (mude em Datas, se o documento for de outro dia)</>}
        </p>

        {/* ── Documento ────────────────────────────────────────────────── */}
        <Secao titulo="Documento" aberta={secDoc} onToggle={() => setSecDoc((v) => !v)}
               resumo={[tipoDoc, numeroDocFiscal, numeroParcela].filter(Boolean).join(" · ")}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tipo de documento</label>
              <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {TIPOS_DOC.map(([cod, nome]) => <option key={cod} value={cod}>{cod} · {nome}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Origem</label>
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {ORIGENS.map(([cod, nome]) => <option key={cod} value={cod}>{cod} · {nome}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Nº nota fiscal</label>
              <input value={numeroDocFiscal} onChange={(e) => setNumeroDocFiscal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Parcela</label>
              <input value={numeroParcela} onChange={(e) => setNumeroParcela(e.target.value)}
                     placeholder="ex.: 001/012" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Nº pedido / OS</label>
              <input value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Chave NFe</label>
              <input value={chaveNfe} onChange={(e) => setChaveNfe(e.target.value)}
                     placeholder="44 dígitos" className={`${inputCls} font-mono text-[11px]`} />
            </div>
          </div>
        </Secao>

        {/* ── Datas ───────────────────────────────────────────────────── */}
        <Secao titulo="Datas" aberta={secDatas} onToggle={() => setSecDatas((v) => !v)}
               resumo={[emissao && `emissão ${emissao}`, entrada && `entrada ${entrada}`].filter(Boolean).join(" · ")}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Emissão <span className="text-ww-textFaint">(vazia = hoje, data do lançamento)</span></label>
              <input type="date" value={emissao} onChange={(e) => setEmissao(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Entrada</label>
              <input type="date" value={entrada} onChange={(e) => setEntrada(e.target.value)} className={inputCls} />
            </div>
          </div>
        </Secao>

        {/* ── Impostos retidos ────────────────────────────────────────── */}
        <Secao titulo="Impostos retidos" aberta={secImp} onToggle={() => setSecImp((v) => !v)}
               resumo={totalImpostos > 0 ? `retido ${moedaBR(totalImpostos)}` : ""}>
          <div className="grid grid-cols-3 gap-3">
            {IMPOSTOS.map(({ chave, nome }) => (
              <div key={chave}>
                <label className={labelCls}>{nome}</label>
                <input
                  value={impostos[chave]}
                  onChange={(e) => setImpostos((cur) => ({ ...cur, [chave]: e.target.value }))}
                  placeholder="0,00"
                  className={`${inputCls} text-right tabular-nums`} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-ww-textFaint mt-2">
            Valor preenchido fica guardado na conta como retido.
          </p>
        </Secao>

        <div>
          <label className={labelCls}>Observação</label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className={inputCls} />
        </div>

        {err && <div className="text-[12px] text-rose-600 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">{err}</div>}
        {ok && <div className="text-[12px] text-emerald-600 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-3 py-2">✓ Conta criada no painel.</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] font-medium text-ww-textMuted hover:bg-ww-bg rounded-md transition">Cancelar</button>
          <button onClick={salvar} disabled={salvando || ok}
            className="px-4 py-1.5 text-[12px] font-semibold text-white bg-ww-accent hover:opacity-90 rounded-md shadow-sm transition disabled:opacity-40">
            {salvando ? "Gravando…" : "Criar conta"}
          </button>
        </div>
      </div>
    </div>
  );
}
