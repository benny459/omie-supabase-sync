"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClienteFat, CondicaoFat, DocFat, ItemFat, OperacaoNfe, OperacaoTipo, RetencoesFat, TransporteFat } from "@/lib/faturamento/montar";
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
  contas: ContaRec[];
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
/** Conta de recebimento com os dados de pagamento (cadastros › bancos e contas). */
type ContaRec = { codigo: number; nome: string; tipo?: string; banco?: string | null; agencia?: string | null; conta?: string | null;
  pix_tipo?: string | null; pix_chave?: string | null; beneficiario?: string | null };
const BANCOS: Record<string, string> = { "001": "Banco do Brasil", "033": "Santander", "104": "Caixa", "237": "Bradesco", "260": "Nubank", "301": "Conta Simples", "336": "C6 Bank", "341": "Itaú", "450": "Omie.CASH", "077": "Inter", "208": "BTG" };
const FORMAS_BANCO = ["TRA", "TED", "DEP"];
/** Instrução de pagamento para o documento e para cada parcela (05/10/26):
 *  PIX → chave da conta; transferência/depósito → banco, agência e conta. */
function instrucoes(formasUsadas: string[], c: ContaRec | undefined) {
  const linhas: string[] = []; const faltas: string[] = [];
  if (!c) return { linhas, faltas: formasUsadas.some((f) => f === "PIX" || FORMAS_BANCO.includes(f)) ? ["escolha a conta de recebimento"] : [] };
  const quem = c.beneficiario ? ` — favorecido ${c.beneficiario}` : "";
  if (formasUsadas.includes("PIX")) {
    if (c.pix_chave) linhas.push(`Pagamento via PIX: chave ${c.pix_tipo ? `${c.pix_tipo.toUpperCase()} ` : ""}${c.pix_chave}${quem}`);
    else faltas.push(`a conta “${c.nome}” não tem chave PIX cadastrada`);
  }
  if (formasUsadas.some((f) => FORMAS_BANCO.includes(f))) {
    if (c.banco && c.agencia && c.conta) linhas.push(`Transferência/depósito: ${BANCOS[c.banco] ?? `Banco ${c.banco}`} (${c.banco}) Ag ${c.agencia} CC ${c.conta}${quem}`);
    else faltas.push(`a conta “${c.nome}” está sem banco/agência/conta`);
  }
  return { linhas, faltas };
}
type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };
/** Próximos números (sem consumir) — orders.fat_proximos. */
type Prox = { pv?: number; os?: number; nfe?: number | null; nfe_serie?: string; recibo?: number | null; ambiente?: string };
/** Linha da carteira para "Faturar um PV/OS existente". */
type CartDoc = { chave: string; tipo: "PV" | "OS"; rotulo: string; cliente: string | null; valor: number; faturado: number; emite: boolean; emite_motivo?: string; aguarda_nfse?: boolean };
/** NF-e que não é venda (05/10/26) — devolução de compra, simples remessa e
 *  remessa p/ conserto, como a SF emitia no Omie (CFOP 5.202/6.202, 5.949/6.949,
 *  5.915/6.915). Numeração: a mesma série da NF-e de venda. */
const OP_ROT: Record<Exclude<OperacaoTipo, "venda">, string> = {
  devolucao: "NF-e de devolução (de compra)", remessa: "NF-e de simples remessa", conserto: "NF-e de remessa p/ conserto",
};
const OP_DICA: Record<Exclude<OperacaoTipo, "venda">, string> = {
  devolucao: "Devolve ao fornecedor itens de uma NF de entrada (CFOP 5.202/6.202). Referencia a NF de origem; sem cobrança.",
  remessa: "Envia material sem venda (CFOP 5.949/6.949) — para o projeto/cliente, com motivo. Sem cobrança.",
  conserto: "Envia um bem para conserto ou reparo (CFOP 5.915/6.915). Sem cobrança.",
};
const MOTIVOS: Record<Exclude<OperacaoTipo, "venda">, string[]> = {
  devolucao: ["Mercadoria em desacordo com o pedido", "Mercadoria com defeito / avaria", "Quantidade enviada a maior", "Item cancelado pelo comprador"],
  remessa: ["Remessa de material para instalação/obra do projeto", "Remessa de material para manutenção/reposição", "Remessa em demonstração", "Remessa para teste"],
  conserto: ["Remessa para conserto/reparo", "Remessa para manutenção em garantia"],
};
type NfOrigem = { fonte: "focus" | "omie"; chave: string; numero: string; serie: string | null; emissao: string | null; emitente: string | null;
  emitente_doc: string; valor: number; natureza: string | null; itens: (ItemFat & { cest?: string | null })[] };
const DICA: Record<Tipo, string> = {
  nfe: "Cria o PV na sequência e emite a NF-e na SEFAZ (Focus).",
  recibo: "Cria a OS na sequência e gera o recibo de prestação de serviço.",
  nfse: "Cria a OS na sequência; a NFS-e é emitida no portal da prefeitura e registrada depois (Registrar NFS-e).",
};

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
  const [modo, setModo] = useState<"novo" | "existente">("novo");
  const [prox, setProx] = useState<Prox | null>(null);
  const [cliCodigo, setCliCodigo] = useState("");
  const [semProp, setSemProp] = useState(false);
  const [semPropMotivo, setSemPropMotivo] = useState("");
  const [carteira, setCarteira] = useState<CartDoc[] | null>(null);
  const [buscaExist, setBuscaExist] = useState("");
  const [criado, setCriado] = useState<{ id: number; label: string } | null>(null);
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
  // NF-e não-venda (devolução / simples remessa / conserto)
  const [operacao, setOperacao] = useState<OperacaoTipo>("venda");
  const [nfRef, setNfRef] = useState<NonNullable<OperacaoNfe["nf_ref"]> | null>(null);
  const [nfBusca, setNfBusca] = useState("");
  const [nfLista, setNfLista] = useState<NfOrigem[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cliProjeto, setCliProjeto] = useState("");
  const [geraCob, setGeraCob] = useState(false);
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
  const naoVenda = tipo === "nfe" && operacao !== "venda";
  const precisaParcelas = !naoVenda || geraCob;
  const rotTipo = naoVenda ? OP_ROT[operacao as Exclude<OperacaoTipo, "venda">] : TIPO[tipo];

  /** Preenche a folha a partir de um PV/OS da carteira (gaveta ou "Faturar um existente"). */
  function aplicarInicial(ini: Inicial) {
    const d = ini.documento;
    setModo("existente");
    setChave(ini.chave ?? null); setRotulo(ini.rotulo ?? d.rotulo ?? null);
    setTipo(ini.tipo ?? "nfe");
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

  function recarregarOpcoes() {
    fetch(`/api/faturamento/nova?op=opcoes&emp=${empresa}`, { cache: "no-store" }).then((x) => x.json()).then((j) => { if (!j.error) setOpc(j); }).catch(() => null);
  }
  // Voltou de outra aba (ex.: cadastrou a chave PIX): atualiza contas e próximos números.
  useEffect(() => {
    if (!aberto) return;
    const f = () => { recarregarOpcoes(); carregarProximos(); };
    window.addEventListener("focus", f);
    return () => window.removeEventListener("focus", f);
  }, [aberto, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  function carregarProximos(emp = empresa) {
    fetch(`/api/faturamento/nova?op=proximos&emp=${emp}`, { cache: "no-store" }).then((x) => x.json())
      .then((j) => { if (!j.error) setProx(j); }).catch(() => null);
  }

  // abrir: carrega opções, próximos números e o documento inicial (linha da carteira)
  useEffect(() => {
    if (!aberto) return;
    vivo.current = true;
    setTx(null); setPre(null); setCriado(null);
    fetch(`/api/faturamento/nova?op=opcoes&emp=${empresa}`, { cache: "no-store" }).then((x) => x.json()).then((j) => { if (!j.error) setOpc(j); }).catch(() => null);
    carregarProximos();
    if (inicial) aplicarInicial(inicial);
    else { setModo("novo"); setChave(null); setRotulo(null); }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") sair(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (aberto) carregarProximos(empresa); }, [empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Faturar um PV/OS existente": carteira a faturar (nativos e Omie)
  useEffect(() => {
    if (!aberto || modo !== "existente" || chave || carteira) return;
    fetch(`/api/faturamento/carteira?empresa=${empresa}`, { cache: "no-store" }).then((x) => x.json())
      .then((j) => setCarteira(((j.docs ?? []) as CartDoc[]).filter((d) => Number(d.valor) - Number(d.faturado ?? 0) > 0.005)))
      .catch(() => setCarteira([]));
  }, [aberto, modo, chave, carteira, empresa]);

  async function escolherExistente(d: CartDoc) {
    setAviso(null);
    if (!d.emite && !d.aguarda_nfse) { setAviso(`${d.rotulo}: ${d.emite_motivo ?? "não emite pelo painel"}`); return; }
    const r = await fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, chave: d.chave, acao: "doc" }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error || !r.documento) { setAviso(r.error ?? "Não consegui abrir o documento"); return; }
    aplicarInicial({ chave: d.chave, documento: r.documento, rotulo: d.rotulo,
      tipo: d.tipo === "PV" ? "nfe" : (cfg?.tipo_os === "nfse" ? "nfse" : "recibo") });
  }

  function voltarNovo() {
    setModo("novo"); setChave(null); setRotulo(null); setBuscaExist("");
    setCli(VAZIO); setItens([ITEM0]); setParcs([]); setCliCodigo(""); setProposta("");
    setNfRef(null); setNfBusca(""); setNfLista(null); setMotivo(""); setCliProjeto(""); setGeraCob(false);
  }

  // Devolução: busca a NF de entrada (Focus + espelho do Omie)
  useEffect(() => {
    if (!aberto || operacao !== "devolucao" || nfBusca.trim().length < 2) { setNfLista(null); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=nf_origem&emp=${empresa}&q=${encodeURIComponent(nfBusca.trim())}`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => setNfLista(j.notas ?? [])).catch(() => setNfLista([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [nfBusca, operacao, empresa, aberto]);

  /** Escolheu a NF de origem: destinatário = fornecedor (cadastro) e itens da nota. */
  async function escolherNfOrigem(n: NfOrigem) {
    setNfRef({ chave: n.chave, numero: n.numero, serie: n.serie, emitente_doc: n.emitente_doc, emissao: n.emissao });
    setNfLista(null); setNfBusca(`${n.numero} · ${n.emitente ?? ""}`);
    if (n.itens.length) {
      setItens(n.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, unidade: i.unidade || "UN", ncm: i.ncm ?? "", cest: i.cest ?? null,
        quantidade: i.quantidade, quantidade_max: i.quantidade, valor_unitario: i.valor_unitario, origem: i.origem ?? 0,
        icms_aliquota: i.icms_aliquota, pis_cst: i.pis_cst, pis_aliquota: i.pis_aliquota, cofins_cst: i.cofins_cst, cofins_aliquota: i.cofins_aliquota,
        info_item: i.codigo ? `-${i.codigo}-` : null })));
    } else setAviso("Esta NF não tem os itens no sistema (só o resumo). Informe os itens devolvidos e a alíquota de ICMS da nota de origem.");
    if (n.emitente_doc) {
      const r = await fetch(`/api/faturamento/nova?op=pessoa_doc&emp=${empresa}&doc=${n.emitente_doc}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const p = r?.id ? await pessoaCompleta(r.id) : null;
      if (p) { setCli(clienteDaPessoa(p)); setCliCodigo(String(r.codigo ?? "")); setVerCliente(false); }
      else { setCli({ ...VAZIO, nome: n.emitente ?? "", cnpj: n.emitente_doc }); setVerCliente(true);
        setAviso("Fornecedor sem cadastro completo — preencha o endereço do destinatário (ou cadastre-o em Cadastros › Fornecedores)."); }
    }
  }

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
  const contaSel = opc?.contas.find((c) => c.codigo === conta);
  const formasUsadas = Array.from(new Set([forma, ...parcs.map((p) => p.forma)].filter(Boolean)));
  const instr = instrucoes(formasUsadas, contaSel);

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
    if (r.pessoa) { setCli(clienteDaPessoa(r.pessoa)); if (r.pessoa.codigo != null) setCliCodigo(String(r.pessoa.codigo)); }
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
      parcelas: precisaParcelas ? parcs.map((p) => ({ vencimento: p.vencimento, valor: p.valor, forma: p.forma, dias: diasEntre(base, p.vencimento) })) : [],
      forma_pagamento: precisaParcelas && tpag && tpag !== "99" ? tpag : undefined,
      forma_recebimento: forma, conta_corrente: conta === "" ? null : Number(conta), conta_nome: contaNome,
      categoria: categoria || null, projeto: projeto || null, centro_custo: centro || null, vendedor: vendedor || null,
      contrato: contrato || null, retencoes: ehOs ? ret : null,
      instrucao_pagamento: instr.linhas.join(" | ") || null,
    };
    return {
      empresa, cliente: cli, itens: its, condicao,
      observacoes: (proposta.trim() && !obs.includes(proposta.trim()) ? `Proposta ${proposta.trim()}. ` : "") + obs || null,
      pedido_cliente: pedidoCli || null,
      transporte: tipo === "nfe" ? transp : null,
      info_contribuinte: infoContrib || null,
      rotulo: rotulo ?? null,
      operacao: naoVenda ? {
        tipo: operacao, nf_ref: operacao === "devolucao" ? nfRef : null, motivo: motivo.trim() || null,
        projeto_codigo: operacao !== "devolucao" ? projeto || null : null,
        projeto_nome: operacao !== "devolucao" ? opc?.projetos.find((x) => x.codigo === projeto)?.nome ?? null : null,
        cliente_projeto: operacao !== "devolucao" ? cliProjeto.trim() || null : null,
        gera_cobranca: geraCob,
      } : null,
    };
  }

  /** NF-e não-venda: o que falta antes de emitir. */
  function faltaOperacao(): string | null {
    if (!naoVenda) return null;
    if (!cli.nome || !(cli.cnpj || cli.cpf)) return "Escolha o destinatário.";
    if (operacao === "devolucao") {
      if ((nfRef?.chave ?? "").replace(/\D/g, "").length !== 44) return "Escolha a NF de origem (ou cole a chave de 44 dígitos).";
      const passou = itens.find((i) => i.quantidade_max != null && i.quantidade > i.quantidade_max);
      if (passou) return `${passou.descricao}: a quantidade passa da NF de origem (${passou.quantidade_max}).`;
    } else if (!projeto) return "Escolha o projeto da remessa.";
    if (motivo.trim().length < 3) return "Informe o motivo.";
    return null;
  }

  async function validar() {
    setValidando(true); setPre(null);
    const r = await fetch("/api/faturamento/nova", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "previa", documento: montarDocumento() }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setValidando(false);
    setPre(r.error ? { checagens: [], pode_emitir: false, error: r.error } : r);
  }

  /** Documento novo: o que falta para criar o PV/OS na sequência. */
  function faltaNovo(): string | null {
    if (modo !== "novo" || teste || naoVenda) return null;
    if (!cliCodigo) return "Escolha o cliente pela busca do cadastro (nome, fantasia ou CNPJ/CPF) — o PV/OS novo precisa do código do cadastro.";
    if (!proposta.trim()) {
      if (!admin) return "Escolha a proposta do CRM deste documento.";
      if (!semProp) return "Escolha a proposta do CRM ou marque “sem proposta” e informe o motivo.";
      if (semPropMotivo.trim().length < 5) return "Informe o motivo de lançar sem proposta (mín. 5 caracteres).";
    }
    return null;
  }

  async function emitirAgora() {
    const falta = faltaNovo() ?? faltaOperacao();
    if (falta) { setAviso(falta); return; }
    const soCriaOs = modo === "novo" && !chave && tipo === "nfse" && !teste;
    if (!soCriaOs && precisaParcelas && !parcOk) { setAviso(`As parcelas (${fmt(somaParc)}) não somam o valor a receber (${fmt(liquido)}).`); return; }
    const numTxt = modo === "novo" && !teste
      ? (naoVenda ? ` (NF-e ${prox?.nfe ?? "?"})` : tipo === "nfe" ? ` (PV ${prox?.pv ?? "?"} · NF-e ${prox?.nfe ?? "?"})` : tipo === "recibo" ? ` (OS ${prox?.os ?? "?"} · Recibo ${prox?.recibo ?? "?"})` : ` (OS ${prox?.os ?? "?"})`) : "";
    const msg = soCriaOs
      ? `Criar a OS${numTxt} para ${cli.nome}? A NFS-e será emitida na prefeitura e registrada depois.`
      : prod
        ? `EMITIR ${rotTipo} DE PRODUÇÃO (documento fiscal real)${numTxt} para ${cli.nome} — ${fmt(total)}?`
        : `Emitir ${rotTipo} em HOMOLOGAÇÃO (sem valor fiscal)?${modo === "novo" && !naoVenda ? " Nenhum PV/OS será criado (teste)." : ""}`;
    if (!window.confirm(msg)) return;
    const documento = montarDocumento();
    setTx({ fase: "enviando", inicio: Date.now() });
    const r = chave
      ? await fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresa, chave, acao: "emitir", documento }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))
      : await fetch("/api/faturamento/emitir", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documento, tipo,
            novo: teste || naoVenda ? null : { cliente_codigo: cliCodigo, proposta: proposta.trim() || null, sem_proposta_motivo: proposta.trim() ? null : semPropMotivo.trim() },
            origem_tipo: teste ? "teste" : "manual",
            gerar_receber_homologacao: teste, forcar_homologacao: teste }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.criado) { setCriado(r.criado); carregarProximos(); }
    if (r.criado && !r.emissao && !r.error) {
      setTx({ fase: "final", inicio: Date.now(), e: { status: "os_criada", tipo: "os" } });
      onEmitido();
      return;
    }
    if (r.error || !r.emissao) { setTx({ fase: "final", inicio: Date.now(), erro: r.error ?? "Falha ao enviar" }); if (r.criado) onEmitido(); return; }
    const e = r.emissao as Record<string, unknown>;
    carregarProximos();
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

  function corrigir() {
    setTx(null); setPre(null); vivo.current = true;
    // O PV/OS novo já existe: reenviar emite sobre ele (não cria outro).
    if (criado) { setChave(`venda:${criado.id}`); setRotulo(criado.label); setModo("existente"); }
  }

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
    const osCriada = tx.fase === "final" && st === "os_criada";
    const okFinal = tx.fase === "final" && st === "autorizada";
    const mal = tx.fase === "final" && !okFinal && !osCriada;
    const seg = Math.round((agora - tx.inicio) / 1000);
    const msg = String(tx.erro ?? e.mensagem ?? "");
    const dica = mal ? dicaRejeicao(`${e.focus_status ?? ""} ${msg}`) : null;
    const recibo = e.tipo === "recibo" || osCriada;
    return (
      <div className="ne-fundo" onClick={(ev) => { if (ev.target === ev.currentTarget) sair(); }}>
        <div className="ne-folha" role="dialog" aria-label="Transmissão">
          <div className="ne-topo">
            <h2>{recibo ? "Recibo" : rotTipo} — transmissão</h2>
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
              {osCriada && (
                <div className="ne-resultado ok">
                  <h3>✓ {criado?.label ?? "OS"} criada</h3>
                  <div style={{ fontSize: 13.5 }}>Emita a NFS-e no portal da prefeitura e registre-a aqui: na carteira, abra <b>{criado?.label}</b> › <b>Registrar NFS-e</b>. O contas a receber é criado no registro, pelo líquido.</div>
                </div>
              )}
              {okFinal && (
                <div className="ne-resultado ok">
                  <h3>✓ {recibo ? "Recibo gerado" : `${rotTipo} autorizada`}</h3>
                  <div className="ne-kv">
                    {(criado || e.origem_rotulo) && <><span>{tipo === "nfe" ? "Pedido (PV)" : "Ordem de serviço"}</span><span><b>{criado?.label ?? String(e.origem_rotulo)}</b>{criado ? " — criado agora, na sequência" : ""}</span></>}
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
                  {criado && <div className="ne-aviso">{criado.label} foi criado e continua <b>aberto</b> na carteira — corrija e emita de lá (ou aqui, em “Faturar um PV/OS existente”).</div>}
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
          <h2>{rotulo ? `Emitir ${rotTipo} — ${rotulo}` : "Nova emissão"}</h2>
          <span className={`amb ${prod ? "prod" : "hom"}`}>{prod ? "PRODUÇÃO — documento fiscal real" : "HOMOLOGAÇÃO — sem valor fiscal"}</span>
          <button className="ne-x" onClick={sair} aria-label="Fechar">✕</button>
        </div>
        <div className="ne-corpo">
          <div className="ne-main">
            {!chave && !naoVenda && (
              <div className="ne-modo" role="tablist">
                <button role="tab" className={modo === "novo" ? "on" : ""} onClick={() => modo !== "novo" && voltarNovo()}>Novo documento</button>
                <button role="tab" className={modo === "existente" ? "on" : ""} onClick={() => { setModo("existente"); setCarteira(null); }}>Faturar um PV/OS existente</button>
              </div>
            )}
            <div className="ne-linha">
              <label className="ne-rot" style={{ width: 80 }}>Empresa
                <select className="ne-in" value={empresa} disabled={!!chave} onChange={(e) => setEmpresa(e.target.value)}>
                  {ativas.map((c) => <option key={c.empresa} value={c.empresa}>{c.empresa}</option>)}
                </select>
              </label>
              <label className="ne-rot" style={{ width: 280 }}>Tipo de documento
                <select className="ne-in" value={naoVenda ? `nfe:${operacao}` : tipo} disabled={!!chave} onChange={(e) => {
                  const [t, op] = e.target.value.split(":");
                  setTipo(t as Tipo); setOperacao((op as OperacaoTipo) ?? "venda");
                  if (op) { setModo("novo"); setPre(null); }
                }}>
                  <option value="nfe">NF-e (venda de produtos)</option>
                  <option value="nfe:devolucao">{OP_ROT.devolucao}</option>
                  <option value="nfe:remessa">{OP_ROT.remessa}</option>
                  <option value="nfe:conserto">{OP_ROT.conserto}</option>
                  <option value="recibo">Recibo de serviço (OS)</option>
                  <option value="nfse">NFS-e da prefeitura (registrar)</option>
                </select>
                <span className="ne-dica">{naoVenda ? OP_DICA[operacao as Exclude<OperacaoTipo, "venda">] : DICA[tipo]}</span>
              </label>
              {modo === "novo" && !chave && (
                <div className="ne-nums" title="O número final é confirmado na emissão (outra emissão pode usar este antes)">
                  {teste ? <span>Teste: nenhum PV/OS é criado e a numeração real não é usada</span> : <>
                    <span className="k">Será gerado</span>
                    {tipo === "nfe" && !naoVenda && <b>PV nº {prox?.pv ?? "…"} · NF-e nº {prox?.nfe ?? "…"}{prox?.nfe_serie ? ` (série ${prox.nfe_serie})` : ""}</b>}
                    {naoVenda && <b>NF-e nº {prox?.nfe ?? "…"}{prox?.nfe_serie ? ` (série ${prox.nfe_serie})` : ""} <small>(sem PV — mesma série da venda)</small></b>}
                    {tipo === "recibo" && <b>OS nº {prox?.os ?? "…"} · Recibo nº {prox?.recibo ?? "…"}</b>}
                    {tipo === "nfse" && <b>OS nº {prox?.os ?? "…"} <small>(NFS-e registrada depois)</small></b>}
                    <span className="s">número automático — confirmado na emissão</span>
                  </>}
                </div>
              )}
              {chave && rotulo && <div className="ne-nums"><span className="k">Faturando</span><b>{rotulo}</b>
                {!inicial && <button className="ne-lk" onClick={() => { setChave(null); setRotulo(null); setCarteira(null); }}>trocar</button>}</div>}
              {admin && !chave && (
                <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginLeft: "auto", color: "var(--ww-text-muted)" }}>
                  <input type="checkbox" checked={teste} onChange={(e) => setTeste(e.target.checked)} /> Teste (forçar homologação)
                </label>
              )}
            </div>

            {modo === "existente" && !chave && (
              <div className="ne-exist">
                <input className="ne-in" autoFocus placeholder="Buscar PV/OS a faturar: número ou cliente…" value={buscaExist} onChange={(e) => setBuscaExist(e.target.value)} />
                <div className="ne-exist-lista">
                  {carteira == null ? <div className="s">Carregando a carteira…</div> : (() => {
                    const t = buscaExist.trim().toLowerCase().replace(/^(pv|os)\s*/, "");
                    const l = carteira.filter((d) => !t || d.rotulo.toLowerCase().includes(t) || (d.cliente ?? "").toLowerCase().includes(t)).slice(0, 40);
                    return l.length ? l.map((d) => (
                      <button key={d.chave} className="ne-exist-item" onClick={() => escolherExistente(d)}>
                        <span className={`tag ${d.tipo === "PV" ? "pv" : "os"}`}>{d.tipo}</span>
                        <b>{d.rotulo}</b><span className="c">{d.cliente ?? "—"}</span>
                        <span className="v">{fmt(Number(d.valor) - Number(d.faturado ?? 0))}</span>
                      </button>
                    )) : <div className="s">Nada a faturar com “{buscaExist}”.</div>;
                  })()}
                </div>
              </div>
            )}

            {naoVenda && (
              <section className="ne-sec ne-op">
                <h3>{OP_ROT[operacao as Exclude<OperacaoTipo, "venda">]} <small>{operacao === "devolucao" ? "finalidade 4 · referencia a NF de origem" : "sem venda · ligada ao projeto"}</small></h3>
                {operacao === "devolucao" ? (
                  <div className="ne-linha" style={{ alignItems: "flex-start" }}>
                    <label className="ne-rot" style={{ width: 420, position: "relative" }}>NF de origem (nº, fornecedor, CNPJ ou chave)
                      <input className="ne-in" placeholder="ex.: 757793 ou COMERCIAL ELETRICA" value={nfBusca} onChange={(e) => { setNfBusca(e.target.value); setNfRef(null); }} />
                      {nfLista && (
                        <div className="ne-exist-lista" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, maxHeight: 260 }}>
                          {nfLista.length ? nfLista.map((n) => (
                            <button key={n.chave} className="ne-exist-item" onClick={() => escolherNfOrigem(n)}>
                              <span className="tag pv">{n.fonte === "focus" ? "Focus" : "Omie"}</span>
                              <b>NF {n.numero}</b><span className="c">{n.emitente ?? "—"} · {dataBR(n.emissao)} · {n.itens.length ? `${n.itens.length} item(ns)` : "sem itens"}</span>
                              <span className="v">{fmt(Number(n.valor))}</span>
                            </button>
                          )) : <div className="s">Nenhuma NF de entrada com “{nfBusca}”. Cole a chave de 44 dígitos ao lado.</div>}
                        </div>
                      )}
                    </label>
                    <label className="ne-rot" style={{ width: 380 }}>Chave da NF de origem (44 dígitos)
                      <input className="ne-in ne-mono" value={nfRef?.chave ?? ""} onChange={(e) => {
                        const ch = e.target.value.replace(/\D/g, "").slice(0, 44);
                        setNfRef(ch ? { ...(nfRef ?? {}), chave: ch, numero: nfRef?.numero ?? (ch.length === 44 ? String(Number(ch.slice(25, 34))) : null),
                          serie: nfRef?.serie ?? (ch.length === 44 ? String(Number(ch.slice(22, 25))) : null),
                          emitente_doc: nfRef?.emitente_doc ?? (ch.length === 44 ? ch.slice(6, 20) : null), emissao: nfRef?.emissao ?? null } : null);
                      }} />
                      {nfRef?.chave && <span className="ne-dica">NF {nfRef.numero ?? "?"} série {nfRef.serie ?? "?"}{nfRef.emitente_doc ? ` · emitente ${nfRef.emitente_doc}` : ""}</span>}
                    </label>
                  </div>
                ) : (
                  <div className="ne-linha">
                    <label className="ne-rot" style={{ width: 380 }}>Destinatário (cliente ou fornecedor do cadastro)
                      <BuscaPessoa valor="" empresa={empresa} onEscolher={async (c) => {
                        const p = await pessoaCompleta(c.id);
                        setCliCodigo(String(c.codigo));
                        if (p) { const cl = clienteDaPessoa(p); setCli(cl); setVerCliente(false); if (!cliProjeto) setCliProjeto(cl.nome); }
                        else setAviso("Não consegui abrir o cadastro escolhido");
                      }} />
                    </label>
                    {sel("Projeto *", projeto, setProjeto, opc?.projetos ?? [], 280)}
                    <div style={{ alignSelf: "flex-end", paddingBottom: 2 }}>
                      <BotaoNovoProjeto compacto rotulo="+ Novo projeto" empresa={empresa}
                        sugestao={{ nome: cliProjeto || cli.nome || null, clienteNome: cliProjeto || cli.nome || null, orcamento: total || null }}
                        onCriado={(p) => {
                          setOpc((o) => (o && !o.projetos.some((x) => String(x.codigo) === String(p.codigo))
                            ? { ...o, projetos: [{ codigo: String(p.codigo), nome: p.nome }, ...o.projetos] } : o));
                          setProjeto(String(p.codigo));
                        }} />
                    </div>
                    <label className="ne-rot" style={{ width: 260 }}>Para qual cliente<input className="ne-in" placeholder="cliente do projeto" value={cliProjeto} onChange={(e) => setCliProjeto(e.target.value)} /></label>
                  </div>
                )}
                <div className="ne-linha">
                  <label className="ne-rot" style={{ flex: 1, minWidth: 320 }}>Motivo *
                    <input className="ne-in" list={`motivos-${operacao}`} placeholder="escolha ou escreva" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    <datalist id={`motivos-${operacao}`}>{MOTIVOS[operacao as Exclude<OperacaoTipo, "venda">].map((m) => <option key={m} value={m} />)}</datalist>
                  </label>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", alignSelf: "flex-end", paddingBottom: 6 }}>
                    <input type="checkbox" checked={geraCob} onChange={(e) => setGeraCob(e.target.checked)} />
                    {operacao === "devolucao" ? "Gerar crédito a receber do fornecedor (abater/reembolso)" : "Gerar cobrança (contas a receber)"}
                  </label>
                </div>
                <div className="ne-dica">{operacao === "devolucao"
                  ? "Sai com finalidade 4 (devolução), a NF de origem referenciada, CSOSN 900 com o ICMS pela alíquota da nota de origem e “Motivo da Devolucao” nas informações complementares — como o Omie."
                  : "Sai sem cobrança (pagamento 90) e com “Projeto · Cliente · Motivo” nas informações complementares, como o Omie emitia (CSOSN 102)."}</div>
              </section>
            )}

            {modo === "novo" && !chave && !naoVenda && (
              <div className="ne-linha">
                <label className="ne-rot" style={{ width: 300 }}>{puxando ? "Proposta do CRM — carregando…" : "Proposta do CRM (puxa cliente, itens e condição)"}
                  <BuscaProposta valor={proposta} onTexto={setProposta} onEscolher={(p) => { setProposta(p.numero); setSemProp(false); puxarProposta(p.numero); }} />
                </label>
                <label className="ne-rot" style={{ width: 380 }}>Cliente do cadastro (nome, fantasia ou CNPJ/CPF)
                  <BuscaPessoa valor="" empresa={empresa} onEscolher={async (c) => {
                    const p = await pessoaCompleta(c.id);
                    setCliCodigo(String(c.codigo));
                    if (p) { setCli(clienteDaPessoa(p)); setVerCliente(false); } else setAviso("Não consegui abrir o cadastro escolhido");
                  }} />
                </label>
                {!teste && !proposta.trim() && admin && (
                  <div className="ne-semprop">
                    <label><input type="checkbox" checked={semProp} onChange={(e) => setSemProp(e.target.checked)} /> Sem proposta do CRM (admin)</label>
                    {semProp && <input className="ne-in" placeholder="Motivo (obrigatório)" value={semPropMotivo} onChange={(e) => setSemPropMotivo(e.target.value)} />}
                  </div>
                )}
                {!teste && !proposta.trim() && !admin && <span className="ne-dica" style={{ alignSelf: "end" }}>A proposta do CRM é obrigatória para um PV/OS novo.</span>}
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
                <thead><tr><th>Código</th><th>Descrição</th>{tipo === "nfe" && <th>NCM</th>}<th>Un</th><th className="r">Qtd</th>{operacao === "devolucao" && naoVenda && <th className="r">ICMS %</th>}<th className="r">Valor unit.</th><th className="r">Total</th><th /></tr></thead>
                <tbody>{itens.map((it, n) => (
                  <tr key={n}>
                    <td><input className="ne-in" style={{ width: 110 }} value={it.codigo ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, codigo: e.target.value } : x)))} /></td>
                    <td><input className="ne-in" style={{ width: "100%", minWidth: 220 }} value={it.descricao ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, descricao: e.target.value } : x)))} /></td>
                    {tipo === "nfe" && <td><input className="ne-in" style={{ width: 96 }} value={it.ncm ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, ncm: e.target.value } : x)))} /></td>}
                    <td><input className="ne-in" style={{ width: 56 }} value={it.unidade ?? "UN"} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, unidade: e.target.value } : x)))} /></td>
                    <td><input className="ne-in num" style={{ width: 80 }} type="number" step="0.01" value={it.quantidade}
                      max={it.quantidade_max ?? undefined} title={it.quantidade_max != null ? `máx. ${it.quantidade_max} (NF de origem)` : undefined}
                      onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, quantidade: Number(e.target.value) } : x)))} />
                      {it.quantidade_max != null && <div className="ne-dica" style={it.quantidade > it.quantidade_max ? { color: "#fca5a5" } : undefined}>máx. {it.quantidade_max}</div>}</td>
                    {operacao === "devolucao" && naoVenda && <td><input className="ne-in num" style={{ width: 64 }} type="number" step="0.01" value={it.icms_aliquota ?? 0}
                      onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, icms_aliquota: Number(e.target.value) } : x)))} /></td>}
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

            {precisaParcelas && <section className="ne-sec">
              <h3>Recebimento <small>{naoVenda ? (operacao === "devolucao" ? "crédito a receber do fornecedor" : "cobrança desta remessa") : "as parcelas a receber são criadas exatamente assim"}</small></h3>
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
              {(instr.linhas.length > 0 || instr.faltas.length > 0) && (
                <div className="ne-pag">
                  {instr.linhas.map((l) => <div key={l}>💳 {l} <small>— sai no documento e em cada parcela</small></div>)}
                  {instr.faltas.map((f) => (
                    <div key={f} className="falta">⚠ {f}.{" "}
                      {contaSel && <a className="ne-lk" href={`/cadastros/contas?emp=${empresa}&codigo=${contaSel.codigo}`} target="_blank" rel="noopener">
                        {f.includes("PIX") ? "Cadastrar chave PIX nesta conta" : "Completar dados bancários"} ↗</a>}
                      {contaSel && <button className="ne-lk" style={{ marginLeft: 10 }} onClick={recarregarOpcoes}>já cadastrei — atualizar</button>}
                    </div>
                  ))}
                </div>
              )}
            </section>}

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
          <span className="tot">{precisaParcelas ? `${parcs.length} parcela(s)` : "sem cobrança"}</span>
          <span style={{ flex: 1 }} />
          <button className="ne-btn" onClick={sair}>Cancelar</button>
          <button className="ne-btn" disabled={validando} onClick={validar}>{validando ? "Validando…" : "Validar"}</button>
          {tipo !== "nfse" && <button className="ne-btn" disabled={!cli.nome || !itens.some((i) => i.descricao)} onClick={() => previaDocumento(montarDocumento(), tipo === "recibo" ? "recibo" : "nfe", avisar)}
            title="Ver como o documento vai sair — sem enviar nada à SEFAZ e sem gastar numeração">{tipo === "recibo" ? "Pré-visualizar recibo" : "Pré-visualizar DANFE"}</button>}
          <button className={`ne-btn ${prod ? "perigo" : "pri"}`} disabled={!cli.nome || !itens.some((i) => i.descricao) || (precisaParcelas && !parcOk)} onClick={emitirAgora}>
            {`Emitir ${naoVenda ? OP_ROT[operacao as Exclude<OperacaoTipo, "venda">] : TIPO[tipo]}${prod ? " (PRODUÇÃO)" : " (homologação)"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Prévia (05/10/26): abre o DANFE/recibo do documento como está na folha,
 *  numa aba nova, sem enviar nada à SEFAZ e sem reservar número. */
export async function previaDocumento(documento: unknown, tipo: "nfe" | "recibo", avisar?: (m: string) => void) {
  const w = window.open("", "_blank");
  if (w) w.document.write("<p style='font:14px Arial;padding:24px'>Gerando prévia…</p>");
  const r = await fetch("/api/faturamento/previa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "html", documento, tipo }) }).catch(() => null);
  const html = r ? await r.text() : "<p>Falha ao gerar a prévia</p>";
  if (!r || !r.ok) avisar?.("Não foi possível gerar a prévia");
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
}
