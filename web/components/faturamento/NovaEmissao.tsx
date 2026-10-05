"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClienteFat, CondicaoFat, DocFat, ItemFat, RetencoesFat, TransporteFat } from "@/lib/faturamento/montar";
import { BuscaPessoa, BuscaProposta, clienteDaPessoa, pessoaCompleta } from "@/components/vendas/BuscasCrmCadastro";
import { BotaoNovoProjeto } from "@/components/cadastros/NovoProjetoRapido";
import "./nova-emissao.css";

/* Folha dedicada da Nova emissão (05/10/26). Pedido do Benny:
   1) "abre uma tela separada, uma caixa grande, não mistura com o resto";
   2) ao escolher o cliente, mostra os últimos faturamentos e deixa "usar como
      modelo" (mesma modalidade, vencimentos recalculados a partir de hoje);
   3) seção completa de Recebimento (condição, parcelas, forma, conta,
      categoria, projeto, centro de custo, vendedor, frete, retenções…) — as
      parcelas a receber são criadas exatamente daqui;
   4) depois de emitir, painel de transmissão com o retorno da SEFAZ. */

export type ConfigFat = { empresa: string; ativo: boolean; ambiente: string; producao_liberada: boolean; tipo_os: string };
type Tipo = "nfe" | "nfse" | "recibo";
const TIPO: Record<Tipo, string> = { nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo" };

export type Inicial = {
  /** chave da carteira (pv_omie:123 / venda:45) — emite pelo caminho da linha, com as travas do PV */
  chave?: string | null;
  documento: DocFat;
  tipo?: Tipo;
  origem_tipo?: string;
  origem_id?: string | null;
  rotulo?: string | null;
};

type Opc = { codigo: string; nome: string };
type Opcoes = {
  condicoes: (Opc & { dias: number[] | null })[];
  formas: (Opc & { tpag: string })[];
  contas: { codigo: number; nome: string; tipo?: string }[];
  categorias: Opc[]; projetos: Opc[]; centros: Opc[]; vendedores: Opc[];
};
type ParcelaHist = { numero?: string; vencimento?: string; valor?: number; dias?: number; forma?: string | null };
type Hist = {
  fonte: "omie" | "painel"; emissao: string | null; tipo: string; documento: string; numero_fiscal?: string | null; origem?: string | null;
  valor: number; itens: Partial<ItemFat>[]; parcelas: ParcelaHist[]; forma?: string | null; condicao?: CondicaoFat | null;
  categoria_codigo?: string | null; categoria?: string | null; conta_codigo?: number | null; conta?: string | null;
  projeto_codigo?: string | null; projeto?: string | null; vendedor_codigo?: string | null; contrato?: string | null;
  retem_iss?: boolean; valor_iss?: number;
};
type Parc = { vencimento: string; valor: number; forma: string };
type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };

const VAZIO: ClienteFat = { nome: "", cnpj: "", ie: "", email: "", logradouro: "", numero: "", bairro: "", municipio: "", uf: "SP", cep: "" };
const ITEM0: ItemFat = { codigo: "", descricao: "", quantidade: 1, valor_unitario: 0, unidade: "UN", ncm: "" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (base: string, d: number) => { const x = new Date(`${base}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000);
const dataBR = (s?: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const limpo = (s: string) => s.replace(/\|\|/g, " · ").replace(/\s+/g, " ").trim();

/** Divide um total em parcelas pelos prazos (a última absorve o arredondamento). */
function gerarParcelas(total: number, dias: number[], base: string, forma: string, pesos?: number[]): Parc[] {
  const ds = dias.length ? dias : [0];
  const ps = pesos && pesos.length === ds.length && pesos.some((p) => p > 0) ? pesos : ds.map(() => 1);
  const soma = ps.reduce((a, b) => a + b, 0);
  const out = ds.map((d, i) => ({ vencimento: somaDias(base, d), valor: r2((total * ps[i]) / soma), forma }));
  const dif = r2(total - out.reduce((a, p) => a + p.valor, 0));
  out[out.length - 1].valor = r2(out[out.length - 1].valor + dif);
  return out;
}

/** Rateia um valor pelos itens proporcionalmente ao bruto (último absorve centavos). */
function ratear(itens: ItemFat[], valor: number) {
  const brutos = itens.map((i) => r2(i.quantidade * i.valor_unitario));
  const tot = brutos.reduce((a, b) => a + b, 0);
  if (!valor || !tot) return itens.map(() => 0);
  const vs = brutos.map((b) => r2((valor * b) / tot));
  vs[vs.length - 1] = r2(vs[vs.length - 1] + (valor - vs.reduce((a, b) => a + b, 0)));
  return vs;
}

/** Dicas para as rejeições mais comuns da SEFAZ/Focus. */
function dicaRejeicao(msg: string): string | null {
  const m = msg.toLowerCase();
  if (/539|204|duplicidade/.test(m)) return "Número já usado na SEFAZ (duplicidade). Confira se a nota não foi emitida no Omie; o número reservado foi devolvido — reenvie.";
  if (/778|ncm/.test(m)) return "NCM inexistente ou inválido em algum item. Corrija o NCM no item (cadastro do produto) e reenvie.";
  if (/cep/.test(m)) return "CEP do destinatário inválido. Confira no cadastro do cliente.";
  if (/munic|ibge/.test(m)) return "Código IBGE do município inválido ou diferente da UF. Use a busca de CEP no cadastro do cliente.";
  if (/inscri|\bie\b|232|233|209/.test(m)) return "Inscrição estadual do destinatário inválida ou incompatível. Se o cliente é isento/não contribuinte, deixe a IE vazia.";
  if (/certificad/.test(m)) return "Problema no certificado digital A1 (vence 23/10/2026). Renove e envie o .pfx à Focus.";
  if (/schema|225/.test(m)) return "Algum campo está fora do formato da SEFAZ. Veja a mensagem completa e corrija o campo indicado.";
  return null;
}

/** Acompanha uma emissão depois que a folha foi fechada (toast quando terminar). */
function acompanharEmFundo(id: number, avisar: (m: string) => void, onFim: () => void) {
  let n = 0;
  const t = window.setInterval(async () => {
    n++;
    const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    const e = r?.emissao;
    if (e && e.status !== "processando") {
      window.clearInterval(t);
      avisar(e.status === "autorizada" ? `Emissão #${id} AUTORIZADA — nº ${e.numero ?? "?"}` : `Emissão #${id}: ${e.status}${e.mensagem ? ` — ${e.mensagem}` : ""}`);
      onFim();
    } else if (n > 120) window.clearInterval(t);
  }, 5000);
}

export default function NovaEmissao({ config, aberto, fechar, avisar, onEmitido, inicial, admin }: {
  config: ConfigFat[]; aberto: boolean; fechar: () => void; avisar: (m: string) => void; onEmitido: () => void;
  inicial?: Inicial | null; admin?: boolean;
}) {
  const ativas = config.filter((c) => c.ativo);
  const [empresa, setEmpresa] = useState(ativas[0]?.empresa ?? "SF");
  const [tipo, setTipo] = useState<Tipo>("nfe");
  const [origemTipo, setOrigemTipo] = useState("manual");
  const [origemId, setOrigemId] = useState("");
  const [chave, setChave] = useState<string | null>(null);
  const [rotulo, setRotulo] = useState<string | null>(null);
  const [cli, setCli] = useState<ClienteFat>(VAZIO);
  const [itens, setItens] = useState<ItemFat[]>([ITEM0]);
  const [proposta, setProposta] = useState("");
  const [puxando, setPuxando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verCliente, setVerCliente] = useState(false);
  // recebimento
  const [opc, setOpc] = useState<Opcoes | null>(null);
  const [base, setBase] = useState(hoje());
  const [cond, setCond] = useState("");
  const [forma, setForma] = useState("BOL");
  const [parcs, setParcs] = useState<Parc[]>([]);
  const [conta, setConta] = useState<number | "">("");
  const [categoria, setCategoria] = useState("");
  const [projeto, setProjeto] = useState("");
  const [centro, setCentro] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [contrato, setContrato] = useState("");
  const [desconto, setDesconto] = useState(0);
  const [frete, setFrete] = useState(0);
  const [outras, setOutras] = useState(0);
  const [transp, setTransp] = useState<TransporteFat>({ modalidade: 9 });
  const [ret, setRet] = useState<RetencoesFat>({ iss_retido: false });
  const [pedidoCli, setPedidoCli] = useState("");
  const [obs, setObs] = useState("");
  const [infoContrib, setInfoContrib] = useState("");
  const [teste, setTeste] = useState(false);   // admin: força homologação
  // histórico
  const [hist, setHist] = useState<Hist[] | null>(null);
  // pré-voo e transmissão
  const [pre, setPre] = useState<{ checagens: Checagem[]; pode_emitir: boolean; error?: string } | null>(null);
  const [validando, setValidando] = useState(false);
  const [tx, setTx] = useState<null | { fase: "enviando" | "processando" | "final"; id?: number; inicio: number; e?: Record<string, unknown>; xml?: string | null; pdf?: string | null; receber?: Record<string, unknown>[]; erro?: string }>(null);
  const [agora, setAgora] = useState(Date.now());
  const vivo = useRef(true);

  const cfg = config.find((c) => c.empresa === empresa);
  const prod = cfg?.ambiente === "producao" && cfg?.producao_liberada && !teste;
  const ehOs = tipo !== "nfe";

  // abrir: carrega opções e o documento inicial (linha da carteira)
  useEffect(() => {
    if (!aberto) return;
    vivo.current = true;
    setTx(null); setPre(null);
    fetch(`/api/faturamento/nova?op=opcoes&emp=${empresa}`, { cache: "no-store" }).then((x) => x.json()).then((j) => { if (!j.error) setOpc(j); }).catch(() => null);
    if (inicial) {
      const d = inicial.documento;
      setChave(inicial.chave ?? null); setRotulo(inicial.rotulo ?? d.rotulo ?? null);
      setTipo(inicial.tipo ?? "nfe"); setOrigemTipo(inicial.origem_tipo ?? "manual"); setOrigemId(inicial.origem_id ?? "");
      setCli(d.cliente); setItens(d.itens.map((i) => ({ ...i, valor_desconto: undefined, valor_frete: undefined, valor_outras: undefined })));
      setDesconto(r2(d.itens.reduce((a, i) => a + (i.valor_desconto ?? 0), 0)));
      setFrete(r2(d.itens.reduce((a, i) => a + (i.valor_frete ?? 0), 0)));
      setOutras(r2(d.itens.reduce((a, i) => a + (i.valor_outras ?? 0), 0)));
      setTransp(d.transporte ?? { modalidade: 9 }); setPedidoCli(d.pedido_cliente ?? ""); setObs(d.observacoes ?? ""); setInfoContrib(d.info_contribuinte ?? "");
      const c = d.condicao;
      if (c?.forma_recebimento) setForma(c.forma_recebimento);
      if (c?.conta_corrente) setConta(c.conta_corrente);
      if (c?.categoria) setCategoria(c.categoria);
      if (c?.projeto) setProjeto(c.projeto);
      const dias = (c?.parcelas ?? []).map((p) => p.dias ?? 0);
      const tot = r2(d.itens.reduce((a, i) => a + i.quantidade * i.valor_unitario - (i.valor_desconto ?? 0) + (i.valor_frete ?? 0) + (i.valor_outras ?? 0), 0));
      setParcs(gerarParcelas(tot, dias.length ? dias : [0], hoje(), c?.forma_recebimento ?? "BOL"));
      setVerCliente(false);
    }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") sair(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // histórico do cliente quando o CNPJ/CPF muda
  const docCli = (cli.cnpj || cli.cpf || "").replace(/\D/g, "");
  useEffect(() => {
    if (!aberto || docCli.length < 11) { setHist(null); return; }
    setHist(null);
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=historico&emp=${empresa}&doc=${docCli}`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => setHist(j.historico ?? [])).catch(() => setHist([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [docCli, empresa, aberto]);

  // relógio do painel de transmissão
  useEffect(() => {
    if (!tx || tx.fase === "final") return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [tx]);

  const bruto = useMemo(() => r2(itens.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0)), [itens]);
  const total = r2(bruto - desconto + frete + outras);
  const totRet = ehOs ? r2((ret.iss_retido ? ret.iss ?? 0 : 0) + (ret.ir ?? 0) + (ret.pis ?? 0) + (ret.cofins ?? 0) + (ret.csll ?? 0) + (ret.inss ?? 0)) : 0;
  const liquido = r2(total - totRet);
  const somaParc = r2(parcs.reduce((a, p) => a + p.valor, 0));
  const parcOk = parcs.length > 0 && Math.abs(somaParc - liquido) < 0.005;

  function aplicarCondicao(codigo: string, tot = liquido) {
    setCond(codigo);
    const c = opc?.condicoes.find((x) => x.codigo === codigo);
    setParcs(gerarParcelas(tot, c?.dias ?? [0], base, forma));
  }
  function redistribuir() {
    const dias = parcs.length ? parcs.map((p) => diasEntre(base, p.vencimento)) : [0];
    setParcs(gerarParcelas(liquido, dias, base, forma).map((p, i) => ({ ...p, forma: parcs[i]?.forma ?? forma })));
  }

  async function puxarProposta(numero: string) {
    setPuxando(true); setAviso(null);
    const r = await fetch(`/api/vendas/proposta?numero=${encodeURIComponent(numero)}&emp=${empresa}`, { cache: "no-store" })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setPuxando(false);
    if (r.error) { setAviso(r.error); return; }
    if (r.disponivel === false) { setAviso(`${r.motivo} — preencha à mão.`); return; }
    if (r.pessoa) setCli(clienteDaPessoa(r.pessoa));
    const lado = tipo === "nfe" ? "PV" : "OS";
    type Ip = { lado: string; codigo: string | null; descricao: string; unidade: string; ncm: string | null; quantidade: number; valor_unitario: number };
    const doLado = (r.itens as Ip[]).filter((i) => i.lado === lado);
    const lista = (doLado.length ? doLado : (r.itens as Ip[])).map((i) => ({ codigo: i.codigo ?? "", descricao: i.descricao, quantidade: Number(i.quantidade) || 1,
      valor_unitario: Number(i.valor_unitario) || 0, unidade: i.unidade || "UN", ncm: i.ncm ?? "" }));
    if (lista.length) setItens(lista);
    const tot = r2(lista.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0));
    if (r.condicao?.dias?.length) setParcs(gerarParcelas(tot, r.condicao.dias as number[], base, forma));
    if (!obs) setObs(`Proposta ${numero}${r.proposta?.titulo ? ` — ${r.proposta.titulo}` : ""}`);
    setAviso([`Proposta ${numero} carregada`, !r.pessoa && "cliente não achado no cadastro — busque ou cadastre",
      r.misto && `proposta mista: carreguei só os itens de ${lado === "PV" ? "produto (NF-e)" : "serviço"}`].filter(Boolean).join(" · "));
  }

  /** "Usar como modelo": copia itens, modalidade (prazos e proporções), forma, conta, categoria, projeto… */
  function usarModelo(h: Hist) {
    const its = (h.itens ?? []).map((i) => ({
      codigo: String(i.codigo ?? ""), descricao: limpo(String(i.descricao ?? "")), ncm: i.ncm ?? "", unidade: i.unidade ?? "UN",
      quantidade: Number(i.quantidade) || 1, valor_unitario: Number(i.valor_unitario) || 0,
    }));
    if (its.length) setItens(its);
    if (h.tipo === "PV") setTipo("nfe"); else if (h.tipo === "OS") setTipo(cfg?.tipo_os === "nfse" ? "nfse" : "recibo");
    const c = h.condicao;
    const f = c?.forma_recebimento ?? h.forma ?? h.parcelas?.[0]?.forma ?? "BOL";
    setForma(f);
    setConta(c?.conta_corrente ?? h.conta_codigo ?? "");
    setCategoria(c?.categoria ?? h.categoria_codigo ?? "");
    setProjeto(c?.projeto ?? h.projeto_codigo ?? "");
    setVendedor(c?.vendedor ?? h.vendedor_codigo ?? "");
    setCentro(c?.centro_custo ?? "");
    if (h.contrato) setContrato(h.contrato);
    const retM: RetencoesFat = c?.retencoes ?? (h.retem_iss ? { iss_retido: true, iss: h.valor_iss ?? 0 } : { iss_retido: false });
    setRet(retM);
    const retTot = h.tipo === "OS" ? r2((retM.iss_retido ? retM.iss ?? 0 : 0) + (retM.ir ?? 0) + (retM.pis ?? 0) + (retM.cofins ?? 0) + (retM.csll ?? 0) + (retM.inss ?? 0)) : 0;
    setDesconto(0); setFrete(0); setOutras(0);
    const tot = r2((r2(its.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0)) || h.valor) - retTot);
    const ph = h.parcelas ?? [];
    const dias = ph.map((p) => Math.max(0, Number(p.dias ?? 0)));
    const pesos = ph.map((p) => Number(p.valor ?? 0));
    const base0 = hoje(); setBase(base0);
    setParcs(gerarParcelas(tot, dias.length ? dias : [0], base0, f, pesos).map((p, i) => ({ ...p, forma: ph[i]?.forma ?? f })));
    setCond("");
    setAviso(`Modelo: ${h.documento} de ${dataBR(h.emissao)} — prazos ${dias.join("/") || "à vista"} recalculados a partir de hoje. Revise e edite à vontade.`);
  }

  function montarDocumento(): DocFat {
    const vsD = ratear(itens, desconto), vsF = ratear(itens, frete), vsO = ratear(itens, outras);
    const its = itens.filter((i) => i.descricao).map((i, n) => ({
      ...i, valor_desconto: vsD[n] || undefined, valor_frete: vsF[n] || undefined, valor_outras: vsO[n] || undefined,
    }));
    const tpag = opc?.formas.find((f) => f.codigo === forma)?.tpag;
    const contaNome = opc?.contas.find((c) => c.codigo === conta)?.nome ?? null;
    const condNome = opc?.condicoes.find((c) => c.codigo === cond)?.nome;
    const condicao: CondicaoFat = {
      codigo: cond || null, descricao: condNome ?? undefined,
      parcelas: parcs.map((p) => ({ vencimento: p.vencimento, valor: p.valor, forma: p.forma, dias: diasEntre(base, p.vencimento) })),
      forma_pagamento: tpag && tpag !== "99" ? tpag : undefined,
      forma_recebimento: forma, conta_corrente: conta === "" ? null : Number(conta), conta_nome: contaNome,
      categoria: categoria || null, projeto: projeto || null, centro_custo: centro || null, vendedor: vendedor || null,
      contrato: contrato || null, retencoes: ehOs ? ret : null,
    };
    return {
      empresa, cliente: cli, itens: its, condicao,
      observacoes: (proposta.trim() && !obs.includes(proposta.trim()) ? `Proposta ${proposta.trim()}. ` : "") + obs || null,
      pedido_cliente: pedidoCli || null,
      transporte: tipo === "nfe" ? transp : null,
      info_contribuinte: infoContrib || null,
      rotulo: rotulo ?? null,
    };
  }

  async function validar() {
    setValidando(true); setPre(null);
    const r = await fetch("/api/faturamento/nova", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "previa", documento: montarDocumento() }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setValidando(false);
    setPre(r.error ? { checagens: [], pode_emitir: false, error: r.error } : r);
  }

  async function emitirAgora() {
    if (!parcOk) { setAviso(`As parcelas (${fmt(somaParc)}) não somam o valor a receber (${fmt(liquido)}).`); return; }
    const msg = prod
      ? `EMITIR ${TIPO[tipo]} DE PRODUÇÃO (documento fiscal real) para ${cli.nome} — ${fmt(total)}?`
      : `Emitir ${TIPO[tipo]} em HOMOLOGAÇÃO (sem valor fiscal)?`;
    if (!window.confirm(msg)) return;
    const documento = montarDocumento();
    setTx({ fase: "enviando", inicio: Date.now() });
    const r = chave
      ? await fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresa, chave, acao: "emitir", documento }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))
      : await fetch("/api/faturamento/emitir", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documento, tipo, origem_tipo: teste ? "teste" : origemTipo, origem_id: origemId || null,
            gerar_receber_homologacao: teste, forcar_homologacao: teste }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error || !r.emissao) { setTx({ fase: "final", inicio: Date.now(), erro: r.error ?? "Falha ao enviar" }); return; }
    const e = r.emissao as Record<string, unknown>;
    onEmitido();
    if (e.status === "processando") { setTx({ fase: "processando", id: Number(e.id), inicio: Date.now(), e }); acompanhar(Number(e.id), Date.now()); }
    else await finalizar(Number(e.id));
  }

  async function finalizar(id: number) {
    const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (!vivo.current) return;
    setTx((t) => ({ fase: "final", id, inicio: t?.inicio ?? Date.now(), e: r?.emissao, xml: r?.xml_url, pdf: r?.pdf_url, receber: r?.receber ?? [] }));
    onEmitido();
  }

  function acompanhar(id: number, inicio: number) {
    const passo = async () => {
      if (!vivo.current) return;
      const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const e = r?.emissao;
      if (e && e.status !== "processando") { await finalizar(id); return; }
      if (Date.now() - inicio > 180_000) {
        setTx((t) => t ? { ...t, e: { ...(t.e ?? {}), mensagem: "Ainda processando na SEFAZ — vamos avisar quando terminar." } } : t);
        acompanharEmFundo(id, avisar, onEmitido);
        return;
      }
      window.setTimeout(passo, 3000);
    };
    window.setTimeout(passo, 2500);
  }

  function sair() {
    vivo.current = false;
    if (tx && tx.fase !== "final" && tx.id) { avisar(`Emissão #${tx.id} continua processando — avisaremos aqui.`); acompanharEmFundo(tx.id, avisar, onEmitido); }
    fechar();
  }

  function corrigir() { setTx(null); setPre(null); vivo.current = true; }

  if (!aberto) return null;

  const campo = (k: keyof ClienteFat, rot: string, w = 160) => (
    <label className="ne-rot" style={{ width: w }}>{rot}
      <input className="ne-in" value={(cli[k] as string) ?? ""} onChange={(e) => setCli({ ...cli, [k]: e.target.value })} />
    </label>
  );
  const sel = (rot: string, v: string | number, set: (x: string) => void, lista: { codigo: string | number; nome: string }[], w = 200, vazio = "—") => (
    <label className="ne-rot" style={{ width: w }}>{rot}
      <select className="ne-in" value={v} onChange={(e) => set(e.target.value)}>
        <option value="">{vazio}</option>
        {lista.map((o) => <option key={String(o.codigo)} value={String(o.codigo)}>{o.nome}{typeof o.codigo === "string" && /^\d/.test(o.codigo) && o.codigo.length < 12 ? ` (${o.codigo})` : ""}</option>)}
      </select>
    </label>
  );
  const num = (rot: string, v: number | null | undefined, set: (n: number) => void, w = 120) => (
    <label className="ne-rot" style={{ width: w }}>{rot}
      <input className="ne-in num" type="number" step="0.01" value={v ?? 0} onChange={(e) => set(Number(e.target.value) || 0)} />
    </label>
  );

  // ── painel de transmissão ──
  if (tx) {
    const e = (tx.e ?? {}) as Record<string, string | number | null | undefined>;
    const st = String(e.status ?? (tx.erro ? "erro" : tx.fase === "enviando" ? "enviando" : "processando"));
    const okFinal = tx.fase === "final" && st === "autorizada";
    const mal = tx.fase === "final" && !okFinal;
    const seg = Math.round((agora - tx.inicio) / 1000);
    const msg = String(tx.erro ?? e.mensagem ?? "");
    const dica = mal ? dicaRejeicao(`${e.focus_status ?? ""} ${msg}`) : null;
    const recibo = e.tipo === "recibo";
    return (
      <div className="ne-fundo" onClick={(ev) => { if (ev.target === ev.currentTarget) sair(); }}>
        <div className="ne-folha" role="dialog" aria-label="Transmissão">
          <div className="ne-topo">
            <h2>{recibo ? "Recibo" : TIPO[tipo]} — transmissão</h2>
            <span className={`amb ${e.ambiente === "producao" || (!e.ambiente && prod) ? "prod" : "hom"}`}>{e.ambiente === "producao" || (!e.ambiente && prod) ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}</span>
            {tx.fase !== "final" && <span style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{seg}s</span>}
            <button className="ne-x" onClick={sair} aria-label="Fechar">✕</button>
          </div>
          <div className="ne-corpo" style={{ gridTemplateColumns: "1fr" }}>
            <div className="ne-tx">
              {!recibo && (
                <div className="ne-passos">
                  <div className={`ne-passo ${tx.fase === "enviando" ? "on" : "feito"}`}>1 · Enviando à Focus</div>
                  <div className={`ne-passo ${tx.fase === "processando" ? "on" : tx.fase === "final" ? (mal && !e.id ? "mal" : "feito") : ""}`}>2 · Processando na SEFAZ</div>
                  <div className={`ne-passo ${okFinal ? "feito" : mal ? "mal" : ""}`}>3 · {okFinal ? "Autorizada" : mal ? (st === "rejeitada" ? "Rejeitada" : st === "cancelada" ? "Cancelada" : "Erro") : "Resultado"}</div>
                </div>
              )}
              {tx.fase !== "final" && (
                <div className="ne-resultado proc"><h3>{tx.fase === "enviando" ? "Enviando…" : "Aguardando a SEFAZ…"}</h3>
                  <div style={{ fontSize: 13 }}>{msg || "Isso costuma levar de 5 a 30 segundos. Pode fechar esta janela — avisamos quando terminar."}</div></div>
              )}
              {okFinal && (
                <div className="ne-resultado ok">
                  <h3>✓ {recibo ? "Recibo gerado" : `${TIPO[tipo]} autorizada`}</h3>
                  <div className="ne-kv">
                    <span>Número / série</span><span><b>{String(e.numero ?? "—")}</b> / {String(e.serie ?? "—")}</span>
                    {e.chave && <><span>Chave de acesso</span><span className="ne-mono">{String(e.chave)} <button className="ne-lk" onClick={() => { navigator.clipboard.writeText(String(e.chave)); avisar("Chave copiada"); }}>copiar</button></span></>}
                    {e.protocolo && <><span>Protocolo</span><span className="ne-mono">{String(e.protocolo)}</span></>}
                    <span>Autorizada em</span><span>{e.autorizada_em ? new Date(String(e.autorizada_em)).toLocaleString("pt-BR") : "—"}</span>
                    <span>Valor</span><span>{fmt(Number(e.valor_total ?? 0))}</span>
                  </div>
                  <div className="ne-linha">
                    {tx.pdf && <a className="ne-btn" href={tx.pdf} target="_blank" rel="noopener">{recibo ? "Abrir recibo" : "Baixar DANFE (PDF)"}</a>}
                    {tx.xml && <a className="ne-btn" href={tx.xml} target="_blank" rel="noopener">Baixar XML</a>}
                    {(tx.pdf || tx.xml) && <button className="ne-btn" onClick={() => { navigator.clipboard.writeText(String(tx.pdf ?? tx.xml)); avisar("Link copiado (vale por algumas horas)"); }}>Copiar link</button>}
                    {e.chave && !recibo && <a className="ne-btn" href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=" target="_blank" rel="noopener"
                      onClick={() => navigator.clipboard.writeText(String(e.chave))}>Consultar na SEFAZ (chave copiada)</a>}
                    <button className="ne-btn" disabled title="Depende do Resend (RESEND_API_KEY)">Enviar ao cliente</button>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, margin: "6px 0" }}>Contas a receber criadas</div>
                    {(tx.receber ?? []).length ? (
                      <table className="ne-tab"><thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th className="r">Valor</th></tr></thead>
                        <tbody>{(tx.receber ?? []).map((p) => (
                          <tr key={String(p.id)}><td>{String(p.numero_parcela)}</td><td>{dataBR(String(p.vencimento))}</td>
                            <td>{String((p.extras as Record<string, unknown> | null)?.forma ?? "—")}</td><td className="r">{fmt(Number(p.valor))}</td></tr>))}
                        </tbody></table>
                    ) : <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{e.ambiente === "homologacao" && !teste ? "Homologação: nenhuma parcela criada." : "Nenhuma parcela registrada ainda."}</div>}
                    <a className="ne-lk" href="/financeiro/receber" style={{ display: "inline-block", marginTop: 8 }}>Abrir Contas a Receber →</a>
                  </div>
                </div>
              )}
              {mal && (
                <div className="ne-resultado mal">
                  <h3>✕ {st === "rejeitada" ? "Rejeitada pela SEFAZ" : "Não foi possível emitir"}</h3>
                  <div style={{ fontSize: 13.5 }}>{e.focus_status ? <b>{String(e.focus_status)}: </b> : null}{msg || "Sem mensagem da SEFAZ."}</div>
                  {dica && <div className="ne-aviso">💡 {dica}</div>}
                  {!recibo && <div style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>O número reservado foi devolvido à sequência (nenhuma nota ficou registrada na SEFAZ).</div>}
                  <div className="ne-linha"><button className="ne-btn pri" onClick={corrigir}>Corrigir e reenviar</button></div>
                </div>
              )}
            </div>
          </div>
          <div className="ne-rod"><span style={{ flex: 1 }} /><button className="ne-btn" onClick={sair}>{tx.fase === "final" ? "Fechar" : "Fechar e avisar depois"}</button></div>
        </div>
      </div>
    );
  }

  // ── formulário ──
  return (
    <div className="ne-fundo" onClick={(ev) => { if (ev.target === ev.currentTarget) sair(); }}>
      <div className="ne-folha" role="dialog" aria-label="Nova emissão">
        <div className="ne-topo">
          <h2>{rotulo ? `Emitir ${TIPO[tipo]} — ${rotulo}` : "Nova emissão"}</h2>
          <span className={`amb ${prod ? "prod" : "hom"}`}>{prod ? "PRODUÇÃO — documento fiscal real" : "HOMOLOGAÇÃO — sem valor fiscal"}</span>
          <button className="ne-x" onClick={sair} aria-label="Fechar">✕</button>
        </div>
        <div className="ne-corpo">
          <div className="ne-main">
            <div className="ne-linha">
              <label className="ne-rot" style={{ width: 80 }}>Empresa
                <select className="ne-in" value={empresa} disabled={!!chave} onChange={(e) => setEmpresa(e.target.value)}>
                  {ativas.map((c) => <option key={c.empresa} value={c.empresa}>{c.empresa}</option>)}
                </select>
              </label>
              <label className="ne-rot" style={{ width: 220 }}>Documento
                <select className="ne-in" value={tipo} disabled={!!chave} onChange={(e) => setTipo(e.target.value as Tipo)}>
                  <option value="nfe">NF-e mercantil (produtos / PV)</option>
                  <option value="recibo">Recibo de prestação (OS)</option>
                  <option value="nfse">NFS-e (OS)</option>
                </select>
              </label>
              {!chave && <>
                <label className="ne-rot" style={{ width: 110 }}>Origem
                  <select className="ne-in" value={origemTipo} onChange={(e) => setOrigemTipo(e.target.value)}>
                    <option value="manual">Manual</option><option value="pv">PV</option><option value="os">OS</option>
                  </select>
                </label>
                <label className="ne-rot" style={{ width: 110 }}>Nº PV/OS<input className="ne-in" value={origemId} onChange={(e) => setOrigemId(e.target.value)} /></label>
              </>}
              {admin && !chave && (
                <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginLeft: "auto", color: "var(--ww-text-muted)" }}>
                  <input type="checkbox" checked={teste} onChange={(e) => setTeste(e.target.checked)} /> Teste (forçar homologação)
                </label>
              )}
            </div>

            {!chave && (
              <div className="ne-linha">
                <label className="ne-rot" style={{ width: 300 }}>{puxando ? "Proposta do CRM — carregando…" : "Proposta do CRM (puxa cliente, itens e condição)"}
                  <BuscaProposta valor={proposta} onTexto={setProposta} onEscolher={(p) => { setProposta(p.numero); puxarProposta(p.numero); }} />
                </label>
                <label className="ne-rot" style={{ width: 380 }}>Cliente do cadastro (nome, fantasia ou CNPJ/CPF)
                  <BuscaPessoa valor="" empresa={empresa} onEscolher={async (c) => {
                    const p = await pessoaCompleta(c.id);
                    if (p) { setCli(clienteDaPessoa(p)); setVerCliente(false); } else setAviso("Não consegui abrir o cadastro escolhido");
                  }} />
                </label>
              </div>
            )}
            {aviso && <div className="ne-aviso" onClick={() => setAviso(null)}>{aviso}</div>}

            <section className="ne-sec">
              <h3>Cliente {cli.nome ? <small>{cli.nome} · {cli.cnpj || cli.cpf} · {cli.municipio}/{cli.uf}</small> : <small>escolha no cadastro acima</small>}
                <button className="ne-lk" style={{ marginLeft: "auto" }} onClick={() => setVerCliente((v) => !v)}>{verCliente ? "recolher" : "ver/editar dados"}</button></h3>
              {(verCliente || !cli.nome) && (
                <div className="ne-linha">
                  {campo("nome", "Razão social", 300)}{campo("cnpj", "CNPJ", 150)}{campo("cpf", "CPF", 130)}{campo("ie", "Inscrição estadual", 140)}{campo("email", "E-mail", 230)}
                  {campo("logradouro", "Logradouro", 250)}{campo("numero", "Nº", 70)}{campo("complemento", "Compl.", 110)}{campo("bairro", "Bairro", 150)}
                  {campo("municipio", "Município", 160)}{campo("codigo_municipio", "Cód. IBGE", 100)}{campo("uf", "UF", 50)}{campo("cep", "CEP", 100)}
                </div>
              )}
            </section>

            <section className="ne-sec">
              <h3>Itens <small>{itens.length} item(ns) · bruto {fmt(bruto)}</small></h3>
              <table className="ne-tab">
                <thead><tr><th>Código</th><th>Descrição</th>{tipo === "nfe" && <th>NCM</th>}<th>Un</th><th className="r">Qtd</th><th className="r">Valor unit.</th><th className="r">Total</th><th /></tr></thead>
                <tbody>{itens.map((it, n) => (
                  <tr key={n}>
                    <td><input className="ne-in" style={{ width: 110 }} value={it.codigo ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, codigo: e.target.value } : x)))} /></td>
                    <td><input className="ne-in" style={{ width: "100%", minWidth: 220 }} value={it.descricao ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, descricao: e.target.value } : x)))} /></td>
                    {tipo === "nfe" && <td><input className="ne-in" style={{ width: 96 }} value={it.ncm ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, ncm: e.target.value } : x)))} /></td>}
                    <td><input className="ne-in" style={{ width: 56 }} value={it.unidade ?? "UN"} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, unidade: e.target.value } : x)))} /></td>
                    <td><input className="ne-in num" style={{ width: 80 }} type="number" step="0.01" value={it.quantidade} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, quantidade: Number(e.target.value) } : x)))} /></td>
                    <td><input className="ne-in num" style={{ width: 110 }} type="number" step="0.01" value={it.valor_unitario} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, valor_unitario: Number(e.target.value) } : x)))} /></td>
                    <td className="r">{fmt(it.quantidade * it.valor_unitario)}</td>
                    <td><button className="ne-lk" onClick={() => setItens(itens.length > 1 ? itens.filter((_, i) => i !== n) : [ITEM0])}>remover</button></td>
                  </tr>))}
                </tbody>
              </table>
              <div><button className="ne-lk" onClick={() => setItens([...itens, { ...ITEM0 }])}>+ item</button></div>
              <div className="ne-linha">
                {num("Desconto (R$)", desconto, setDesconto)}
                {tipo === "nfe" && num("Frete (R$)", frete, setFrete)}
                {num(tipo === "nfe" ? "Outras despesas (R$)" : "Acréscimo (R$)", outras, setOutras, 150)}
                <span style={{ marginLeft: "auto", fontSize: 13 }}>Total do documento <b style={{ fontSize: 16, marginLeft: 6 }}>{fmt(total)}</b></span>
              </div>
            </section>

            <section className="ne-sec">
              <h3>Recebimento <small>as parcelas a receber são criadas exatamente assim</small></h3>
              <div className="ne-linha">
                {sel("Condição de pagamento", cond, (v) => aplicarCondicao(v), (opc?.condicoes ?? []).map((c) => ({ codigo: c.codigo, nome: c.nome })), 230, "— escolha —")}
                <label className="ne-rot" style={{ width: 150 }}>Data base dos prazos
                  <input className="ne-in" type="date" value={base} onChange={(e) => setBase(e.target.value)} />
                </label>
                {sel("Forma de recebimento", forma, (v) => { setForma(v); setParcs(parcs.map((p) => ({ ...p, forma: v }))); }, opc?.formas ?? [{ codigo: "BOL", nome: "Boleto" }], 190, "—")}
                {sel("Conta de recebimento", conta, (v) => setConta(v === "" ? "" : Number(v)), opc?.contas ?? [], 230)}
              </div>
              <div className="ne-linha">
                {sel("Categoria de receita", categoria, setCategoria, (opc?.categorias ?? []).map((c) => ({ codigo: c.codigo, nome: `${c.codigo} ${c.nome}` })), 260)}
                {sel("Projeto", projeto, setProjeto, opc?.projetos ?? [], 260)}
                <div style={{ alignSelf: "flex-end", paddingBottom: 2 }}>
                  <BotaoNovoProjeto compacto rotulo="+ Novo projeto" empresa={empresa}
                    sugestao={{ nome: cli.nome || null, clienteNome: cli.nome || null, orcamento: total || null }}
                    onCriado={(p) => {
                      setOpc((o) => (o && !o.projetos.some((x) => String(x.codigo) === String(p.codigo))
                        ? { ...o, projetos: [{ codigo: String(p.codigo), nome: p.nome }, ...o.projetos] } : o));
                      setProjeto(String(p.codigo));
                    }} />
                </div>
                {sel("Centro de custo", centro, setCentro, opc?.centros ?? [], 200)}
                {sel("Vendedor", vendedor, setVendedor, opc?.vendedores ?? [], 170)}
                <label className="ne-rot" style={{ width: 160 }}>Contrato (CT)<input className="ne-in" value={contrato} onChange={(e) => setContrato(e.target.value)} /></label>
              </div>
              <table className="ne-tab">
                <thead><tr><th>Nº</th><th>Vencimento</th><th>Prazo</th><th>Forma</th><th className="r">Valor</th><th className="r">%</th><th /></tr></thead>
                <tbody>{parcs.map((p, n) => (
                  <tr key={n}>
                    <td>{String(n + 1).padStart(2, "0")}/{String(parcs.length).padStart(2, "0")}</td>
                    <td><input className="ne-in" type="date" value={p.vencimento} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, vencimento: e.target.value } : x)))} /></td>
                    <td style={{ color: "var(--ww-text-muted)" }}>{diasEntre(base, p.vencimento)} dias</td>
                    <td><select className="ne-in" value={p.forma} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, forma: e.target.value } : x)))}>
                      {(opc?.formas ?? [{ codigo: p.forma, nome: p.forma }]).map((f) => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
                    </select></td>
                    <td className="r"><input className="ne-in num" style={{ width: 120 }} type="number" step="0.01" value={p.valor} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, valor: Number(e.target.value) } : x)))} /></td>
                    <td className="r">{liquido ? ((p.valor / liquido) * 100).toFixed(1) : "0"}%</td>
                    <td><button className="ne-lk" onClick={() => setParcs(parcs.filter((_, i) => i !== n))}>remover</button></td>
                  </tr>))}
                </tbody>
              </table>
              <div className="ne-linha">
                <button className="ne-lk" onClick={() => setParcs([...parcs, { vencimento: somaDias(parcs.at(-1)?.vencimento ?? base, 30), valor: 0, forma }])}>+ parcela</button>
                <button className="ne-lk" onClick={redistribuir}>redistribuir valores</button>
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: parcOk ? "var(--ww-text-muted)" : "#fca5a5", fontWeight: parcOk ? 400 : 700 }}>
                  Soma das parcelas {fmt(somaParc)} {parcOk ? "✓" : `≠ a receber ${fmt(liquido)}`}
                </span>
              </div>
            </section>

            {ehOs && (
              <section className="ne-sec">
                <h3>Retenções <small>o que o tomador retém sai do valor a receber</small></h3>
                <div className="ne-linha">
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={!!ret.iss_retido} onChange={(e) => setRet({ ...ret, iss_retido: e.target.checked })} /> ISS retido pelo tomador
                  </label>
                  {num("ISS (R$)", ret.iss, (v) => setRet({ ...ret, iss: v }), 110)}{num("IR (R$)", ret.ir, (v) => setRet({ ...ret, ir: v }), 100)}
                  {num("PIS (R$)", ret.pis, (v) => setRet({ ...ret, pis: v }), 100)}{num("COFINS (R$)", ret.cofins, (v) => setRet({ ...ret, cofins: v }), 110)}
                  {num("CSLL (R$)", ret.csll, (v) => setRet({ ...ret, csll: v }), 100)}{num("INSS (R$)", ret.inss, (v) => setRet({ ...ret, inss: v }), 100)}
                  <span style={{ marginLeft: "auto", fontSize: 13 }}>A receber <b style={{ marginLeft: 6 }}>{fmt(liquido)}</b></span>
                </div>
              </section>
            )}

            {tipo === "nfe" && (
              <section className="ne-sec">
                <h3>Transporte</h3>
                <div className="ne-linha">
                  <label className="ne-rot" style={{ width: 230 }}>Modalidade do frete
                    <select className="ne-in" value={transp.modalidade} onChange={(e) => setTransp({ ...transp, modalidade: Number(e.target.value) })}>
                      <option value={9}>9 · Sem frete</option><option value={0}>0 · Emitente (CIF)</option><option value={1}>1 · Destinatário (FOB)</option>
                      <option value={2}>2 · Terceiros</option><option value={3}>3 · Próprio (remetente)</option><option value={4}>4 · Próprio (destinatário)</option>
                    </select>
                  </label>
                  {transp.modalidade !== 9 && <>
                    <label className="ne-rot" style={{ width: 240 }}>Transportadora<input className="ne-in" value={transp.nome ?? ""} onChange={(e) => setTransp({ ...transp, nome: e.target.value })} /></label>
                    <label className="ne-rot" style={{ width: 150 }}>CNPJ<input className="ne-in" value={transp.cnpj ?? ""} onChange={(e) => setTransp({ ...transp, cnpj: e.target.value })} /></label>
                    <label className="ne-rot" style={{ width: 60 }}>UF<input className="ne-in" value={transp.uf ?? ""} onChange={(e) => setTransp({ ...transp, uf: e.target.value })} /></label>
                    <label className="ne-rot" style={{ width: 90 }}>Volumes<input className="ne-in num" type="number" value={transp.volumes?.[0]?.quantidade ?? ""}
                      onChange={(e) => setTransp({ ...transp, volumes: [{ ...(transp.volumes?.[0] ?? {}), quantidade: Number(e.target.value) || null }] })} /></label>
                    <label className="ne-rot" style={{ width: 110 }}>Peso bruto (kg)<input className="ne-in num" type="number" step="0.01" value={transp.volumes?.[0]?.peso_bruto ?? ""}
                      onChange={(e) => setTransp({ ...transp, volumes: [{ ...(transp.volumes?.[0] ?? {}), peso_bruto: Number(e.target.value) || null }] })} /></label>
                  </>}
                </div>
              </section>
            )}

            <section className="ne-sec">
              <h3>Informações complementares</h3>
              <div className="ne-linha">
                <label className="ne-rot" style={{ width: 180 }}>Pedido do cliente (OC)<input className="ne-in" value={pedidoCli} onChange={(e) => setPedidoCli(e.target.value)} /></label>
                {tipo === "nfe" && <label className="ne-rot" style={{ flex: 1, minWidth: 260 }}>Inf. contribuinte (ex.: CONFORME OC Nº …)<input className="ne-in" value={infoContrib} onChange={(e) => setInfoContrib(e.target.value)} /></label>}
              </div>
              <label className="ne-rot">Observações
                <textarea className="ne-in" style={{ height: 64, padding: 8 }} value={obs} onChange={(e) => setObs(e.target.value)} />
              </label>
              {tipo === "nfe" && <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Entram automaticamente: e-mail do destinatário, o texto do Simples Nacional (“Documento emitido por ME ou EPP…”) e “Consumidor Final” quando couber.</div>}
            </section>
          </div>

          <aside className="ne-lado">
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Últimos faturamentos {cli.nome ? <span style={{ fontWeight: 400, color: "var(--ww-text-muted)" }}>· {cli.nome.slice(0, 28)}</span> : null}</div>
              {!docCli ? <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Escolha o cliente para ver o histórico.</div>
                : hist == null ? <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Carregando…</div>
                : !hist.length ? <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Nenhum faturamento anterior para este CNPJ/CPF.</div>
                : (
                  <div className="ne-hist">{hist.map((h, k) => (
                    <div key={k} className="ne-h">
                      <div className="t"><span><span className={`pill ${h.tipo === "OS" ? "os" : ""}`}>{h.tipo}</span> {h.documento}</span><span>{fmt(Number(h.valor))}</span></div>
                      <div className="s">{dataBR(h.emissao)} · {h.origem ?? "—"} · {h.fonte === "omie" ? "Omie" : "Painel"}</div>
                      <div className="s" title={(h.itens ?? []).map((i) => limpo(String(i.descricao ?? ""))).join(" | ")}>
                        {(h.itens ?? []).length ? `${(h.itens ?? []).length} item(ns): ${limpo(String(h.itens[0]?.descricao ?? "")).slice(0, 60)}` : "sem itens no espelho"}
                      </div>
                      <div className="s">{(h.parcelas ?? []).length} parcela(s) · {(h.parcelas ?? []).map((p) => `${p.dias ?? 0}d`).join("/")} · {h.parcelas?.[0]?.forma ?? h.forma ?? "—"}{h.conta ? ` · ${h.conta}` : ""}</div>
                      <div><button className="ne-lk" onClick={() => usarModelo(h)}>Usar como modelo →</button></div>
                    </div>))}
                  </div>
                )}
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Prévia das contas a receber</div>
              {parcs.length ? (
                <table className="ne-tab"><tbody>{parcs.map((p, n) => (
                  <tr key={n}><td>{n + 1}/{parcs.length}</td><td>{dataBR(p.vencimento)}</td><td>{p.forma}</td><td className="r">{fmt(p.valor)}</td></tr>))}
                  <tr><td colSpan={3} style={{ fontWeight: 700 }}>Total a receber</td><td className="r" style={{ fontWeight: 700 }}>{fmt(somaParc)}</td></tr>
                </tbody></table>
              ) : <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Escolha a condição de pagamento.</div>}
              <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", marginTop: 6 }}>
                {[opc?.contas.find((c) => c.codigo === conta)?.nome, categoria && `cat. ${categoria}`, opc?.projetos.find((p) => p.codigo === projeto)?.nome].filter(Boolean).join(" · ") || "Conta, categoria e projeto: escolha em Recebimento."}
              </div>
            </div>

            {pre && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Validação {pre.error ? "" : pre.pode_emitir ? "✓ pronta para emitir" : "— há pendências"}</div>
                {pre.error ? <div className="ne-aviso mal">{pre.error}</div> : (
                  <div className="ne-chk">{pre.checagens.map((c, k) => (
                    <div key={k} className={c.ok ? "ok" : c.nivel === "erro" ? "err" : "av"}><span>{c.ok ? "✓" : c.nivel === "erro" ? "✕" : "!"}</span><span><b>{c.item}</b> — {c.detalhe}</span></div>))}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
        <div className="ne-rod">
          <span className="tot">Total <b>{fmt(total)}</b></span>
          {ehOs && totRet > 0 && <span className="tot">A receber <b>{fmt(liquido)}</b></span>}
          <span className="tot">{parcs.length} parcela(s)</span>
          <span style={{ flex: 1 }} />
          <button className="ne-btn" onClick={sair}>Cancelar</button>
          <button className="ne-btn" disabled={validando} onClick={validar}>{validando ? "Validando…" : "Validar"}</button>
          <button className={`ne-btn ${prod ? "perigo" : "pri"}`} disabled={!cli.nome || !itens.some((i) => i.descricao) || !parcOk} onClick={emitirAgora}>
            {`Emitir ${TIPO[tipo]}${prod ? " (PRODUÇÃO)" : " (homologação)"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
