"use client";

import EnviarAoCliente from "./EnviarAoCliente";
import { useEffect, useMemo, useRef, useState } from "react";
import AcertoItemEstoque from "./AcertoItemEstoque";
import type { ClienteFat, CondicaoFat, DocFat, ItemFat, OperacaoNfe, OperacaoTipo, ParcelaDoc, RetencoesFat, TransporteFat } from "@/lib/faturamento/montar";
import { BuscaPessoa, BuscaProposta, clienteDaPessoa, pessoaCompleta } from "@/components/vendas/BuscasCrmCadastro";
import { BotaoNovoProjeto } from "@/components/cadastros/NovoProjetoRapido";
import LocalizarNcm, { ncmFmt } from "@/components/fiscal/LocalizarNcm";
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

/** Parcela do fechamento de projeto (vendas.parcelas com nome do evento). */
export type ParcelaProj = { numero: number; descricao?: string | null; valor: number; percentual?: number | null; vencimento: string;
  faturamento_previsto?: string | null; faturada_em?: string | null };
export type Inicial = {
  /** chave da carteira (pv_omie:123 / venda:45) — emite pelo caminho da linha, com as travas do PV */
  chave?: string | null;
  documento: DocFat;
  /** PV/OS de projeto: parcelas do fechamento (a nota fatura uma ou mais) */
  parcelas_projeto?: ParcelaProj[] | null;
  tipo?: Tipo;
  origem_tipo?: string;
  origem_id?: string | null;
  rotulo?: string | null;
  /** seção a destacar ao abrir (link "editar" da gaveta, 05/10/26) */
  secao?: "cliente" | "recebimento" | "operacao" | "itens" | "infcpl" | null;
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
  // Banco/agência/conta saem também com PIX (05/10/26): o recibo nunca fica
  // sem os dados de pagamento, mesmo que a conta ainda não tenha chave PIX.
  if (formasUsadas.some((f) => f === "PIX" || FORMAS_BANCO.includes(f))) {
    if (c.banco && c.agencia && c.conta) linhas.push(`Transferência/depósito: ${BANCOS[c.banco] ?? `Banco ${c.banco}`} (${c.banco}) Ag ${c.agencia} CC ${c.conta}${quem}`);
    else if (formasUsadas.some((f) => FORMAS_BANCO.includes(f))) faltas.push(`a conta “${c.nome}” está sem banco/agência/conta`);
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
/** Sugestão do catálogo nativo para uma linha de item (05/10/26). */
type ItemCat = { codigo: string; codigo_omie: string | null; descricao: string; unidade: string; ncm: string | null; cest: string | null;
  origem: number | null; cmc: number | null; saldo: number | null; ultimo_preco: number | null; ultima_compra: string | null;
  ultima_venda: number | null; ultima_venda_em: string | null; via?: string | null; nativo?: boolean; n_cod_prod?: number | null };
/** Código de compra (produto do Omie fora do estoque nosso) — só entra na nota depois de vincular/cadastrar. */
type CodCompra = { n_cod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  ultima_compra: string | null; fornecedor: string | null; fornecedor_cod: number | null; ncm: string | null };
type DicaItem = { cmc: number | null; ultimo_preco: number | null; ultima_venda: number | null; saldo: number | null };
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dBRne = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
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

export default function NovaEmissao({ config, aberto, fechar, avisar, onEmitido, inicial, semProposta, homologacao, rascunhoId, devolucaoInicial }: {
  config: ConfigFat[]; aberto: boolean; fechar: () => void; avisar: (m: string) => void; onEmitido: () => void;
  inicial?: Inicial | null; semProposta?: boolean; homologacao?: boolean;
  /** Rascunho a continuar (05/10/26): restaura o estado salvo em orders.fat_rascunhos. */
  rascunhoId?: number | null;
  /** "Emitir NF de devolução" vindo da devolução de um PC (08/10/26, sql/146): abre a NF-e de
   *  devolução (de compra) com a busca da NF de entrada e o motivo preenchidos — não emite. */
  devolucaoInicial?: { nf?: string | null; motivo?: string | null; pc?: string | null } | null;
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
  /** forma/conta já definidas (pelo documento, modelo ou à mão) — o histórico do cliente não sobrescreve */
  const formaDefinida = useRef(false);
  const [parcs, setParcs] = useState<Parc[]>([]);
  /** condição vinda do PV/OS, resolvida contra o cadastro de condições quando as opções chegam */
  const condHint = useRef<{ codigo?: string | null; descricao?: string | null } | null>(null);
  /** formas diferentes por parcela (escondido por padrão: as parcelas herdam a forma geral) */
  const [formaPorParcela, setFormaPorParcela] = useState(false);
  /** autocompletar de itens: linha ativa, termo e sugestões; dicas (CMC/compra/venda/saldo) por linha */
  const [itBusca, setItBusca] = useState<{ n: number; q: string } | null>(null);
  // Localizador de NCM (05/10/26): linha aberta e NCMs que a tabela oficial recusou na última validação.
  const [ncmBox, setNcmBox] = useState<number | null>(null);
  const [ncmRuim, setNcmRuim] = useState<string[]>([]);
  const [itSug, setItSug] = useState<ItemCat[] | null>(null);
  const [itComp, setItComp] = useState<CodCompra[]>([]);
  /** acertar código de compra: cadastrar no estoque / vincular a item existente (linha n) */
  const [acerto, setAcerto] = useState<{ n: number; c: CodCompra } | null>(null);
  // linhas cujo código não é item nosso (vindas do CRM, de rascunho antigo ou digitadas) → chip "código de compra"
  const [semEst, setSemEst] = useState<Record<string, CodCompra | null>>({});
  const [ladoFechado, setLadoFechado] = useState(false);
  const [verOk, setVerOk] = useState(false);
  const [dicas, setDicas] = useState<Record<number, DicaItem>>({});
  const [conta, setConta] = useState<number | "">("");
  const [categoria, setCategoria] = useState("");
  const [projeto, setProjeto] = useState("");
  const [centro, setCentro] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [contrato, setContrato] = useState("");
  // Proposta do CRM de onde veio o pedido (09/10/26) — para a equipe saber o que está faturando.
  const [propOrigem, setPropOrigem] = useState<string | null>(null);
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
  /** Projeto: parcelas do fechamento e as que esta nota fatura (06/10/26). */
  const [parcsProj, setParcsProj] = useState<ParcelaProj[] | null>(null);
  const [parcelaDoc, setParcelaDoc] = useState<ParcelaDoc | null>(null);
  const iniRef = useRef<Inicial | null>(null);
  const [validando, setValidando] = useState(false);
  const [tx, setTx] = useState<null | { fase: "enviando" | "processando" | "final"; id?: number; inicio: number; e?: Record<string, unknown>; xml?: string | null; pdf?: string | null; receber?: Record<string, unknown>[]; erro?: string }>(null);
  const [agora, setAgora] = useState(Date.now());
  // ── Rascunho (05/10/26): salva o estado completo da folha para continuar depois.
  //    Quem acrescentar estado novo à folha: inclua-o em estadoRascunho() e aplicarRascunho().
  const [rascId, setRascId] = useState<number | null>(null);
  const [rascSalvoEm, setRascSalvoEm] = useState<string | null>(null);
  const [rascSalvando, setRascSalvando] = useState(false);
  const [rascDifs, setRascDifs] = useState<string[] | null>(null);
  const rascUltimo = useRef<string>("");
  const rascCarregando = useRef(false);
  const vivo = useRef(true);

  const cfg = config.find((c) => c.empresa === empresa);
  const prod = cfg?.ambiente === "producao" && cfg?.producao_liberada && !teste;
  const ehOs = tipo !== "nfe";
  const naoVenda = tipo === "nfe" && operacao !== "venda";
  const precisaParcelas = !naoVenda || geraCob;
  const rotTipo = naoVenda ? OP_ROT[operacao as Exclude<OperacaoTipo, "venda">] : TIPO[tipo];

  /** Limpa a folha (nada do documento anterior fica para trás: parcelas, condição, histórico…). */
  /** Projeto por parcela do fechamento (06/10/26): troca as parcelas faturadas nesta nota
   *  — o servidor remonta itens, valor, observações e prazo de recebimento. */
  async function trocarParcelas(nums: number[]) {
    const ini = iniRef.current;
    if (!ini?.chave || !nums.length) return;
    const r = await fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, chave: ini.chave, acao: "doc", parcelas: nums }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error || !r.documento) { setAviso(r.error ?? "Não consegui remontar a nota para essas parcelas"); return; }
    aplicarInicial({ ...ini, documento: r.documento, parcelas_projeto: r.parcelas_projeto ?? ini.parcelas_projeto ?? null });
  }

  function limparFolha() {
    setCli(VAZIO); setItens([ITEM0]); setParcs([]); setCond(""); condHint.current = null; setForma("BOL"); setConta("");
    setCategoria(""); setProjeto(""); setCentro(""); setVendedor(""); setContrato(""); setDesconto(0); setFrete(0); setOutras(0);
    setTransp({ modalidade: 9 }); setRet({ iss_retido: false }); setPedidoCli(""); setObs(""); setInfoContrib("");
    setHist(null); setPre(null); setAviso(null); setCliCodigo(""); setProposta(""); setPropOrigem(null); setBase(hoje());
    setNfRef(null); setNfBusca(""); setNfLista(null); setMotivo(""); setCliProjeto(""); setGeraCob(false);
    setFormaPorParcela(false); setItBusca(null); setItSug(null); setDicas({}); setParcelaDoc(null); setParcsProj(null);
  }

  /** Preenche a folha a partir de um PV/OS da carteira (gaveta ou "Faturar um existente"). */
  function aplicarInicial(ini: Inicial) {
    const d = ini.documento;
    limparFolha();
    iniRef.current = ini;
    setParcelaDoc(d.parcela_doc ?? null); setParcsProj(ini.parcelas_projeto ?? null);
    setModo("existente");
    setChave(ini.chave ?? null); setRotulo(ini.rotulo ?? d.rotulo ?? null);
    // OS do Omie (05/10/26): sempre recibo emitido pelo painel
    // OS (do Omie ou nativa) nunca abre como NF-e de produto: recibo, ou NFS-e quando a empresa usa NFS-e (06/10/26)
    setTipo(ini.chave?.startsWith("os_omie:") ? "recibo"
      : ini.tipo ?? (ini.origem_tipo === "os" || ini.origem_tipo === "os_omie" ? (cfg?.tipo_os === "nfse" ? "nfse" : "recibo") : "nfe"));
    setCli(d.cliente); setItens(d.itens.map((i) => ({ ...i, valor_desconto: undefined, valor_frete: undefined, valor_outras: undefined })));
    setDesconto(r2(d.itens.reduce((a, i) => a + (i.valor_desconto ?? 0), 0)));
    setFrete(r2(d.itens.reduce((a, i) => a + (i.valor_frete ?? 0), 0)));
    setOutras(r2(d.itens.reduce((a, i) => a + (i.valor_outras ?? 0), 0)));
    setTransp(d.transporte ?? { modalidade: 9 }); setPedidoCli(d.pedido_cliente ?? ""); setObs(d.observacoes ?? ""); setInfoContrib(d.info_contribuinte ?? "");
    const c = d.condicao;
    formaDefinida.current = !!c?.forma_recebimento;
    if (c?.forma_recebimento) setForma(c.forma_recebimento);
    if (c?.conta_corrente) setConta(c.conta_corrente);
    setCategoria(c?.categoria ?? "");
    setProjeto(c?.projeto ?? "");
    if (c?.vendedor) setVendedor(c.vendedor);
    if (c?.contrato) setContrato(c.contrato);
    setPropOrigem(d.proposta ?? c?.contrato ?? null);
    // condição do pedido (ex.: A28 · "Para 28 dias") — vira a condição escolhida, sem pedir de novo
    setCond(c?.codigo ?? "");
    condHint.current = c?.codigo || c?.descricao ? { codigo: c?.codigo ?? null, descricao: c?.descricao ?? null } : null;
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
    formaDefinida.current = false;
    setRascId(null); setRascSalvoEm(null); setRascDifs(null); rascUltimo.current = "";
    if (rascunhoId) {
      rascCarregando.current = true;
      limparFolha();
      fetch(`/api/faturamento/rascunhos?id=${rascunhoId}`, { cache: "no-store" }).then((x) => x.json()).then((j) => {
        const rr = j?.rascunho;
        if (!rr) { setAviso(j?.error ?? "Rascunho não encontrado"); return; }
        const p = rr.payload as Partial<EstadoRasc>;
        aplicarRascunho(p);
        setRascId(rr.id);
        setRascSalvoEm(new Date(rr.atualizado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
        window.setTimeout(() => { rascUltimo.current = JSON.stringify(estadoRef.current()); rascCarregando.current = false; conferirRascunho(p, rr.atualizado_em); }, 600);
      }).catch(() => { rascCarregando.current = false; });
    } else if (inicial) aplicarInicial(inicial);
    else if (devolucaoInicial) {
      limparFolha(); setTipo("nfe"); setModo("novo"); setChave(null); setRotulo(null); setOperacao("devolucao");
      if (devolucaoInicial.nf) setNfBusca(devolucaoInicial.nf);
      setMotivo(devolucaoInicial.motivo || "Mercadoria em desacordo com o pedido");
      if (devolucaoInicial.pc) setObs(`Devolução referente ao pedido de compra ${devolucaoInicial.pc}`);
    }
    else { limparFolha(); setOperacao("venda"); setTipo("nfe"); setModo("novo"); setChave(null); setRotulo(null); }
    if (inicial?.secao) {
      if (inicial.secao === "cliente") setVerCliente(true);
      const alvo = inicial.secao;
      window.setTimeout(() => {
        const el = document.getElementById(`ne-sec-${alvo}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ne-destaque");
        window.setTimeout(() => el.classList.remove("ne-destaque"), 2400);
        (el.querySelector("select, input") as HTMLElement | null)?.focus({ preventScroll: true });
      }, 350);
    }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") sair(); };
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("keydown", esc); };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (aberto) carregarProximos(empresa); }, [empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  // Condição do PV/OS → condição do cadastro (por código ou pelo nome, ex.: "Para 28 dias").
  useEffect(() => {
    const h = condHint.current;
    if (!opc || !h) return;
    const norm = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const achou = opc.condicoes.find((c) => h.codigo && c.codigo === h.codigo)
      ?? opc.condicoes.find((c) => h.descricao && norm(c.nome) === norm(h.descricao));
    if (achou) setCond(achou.codigo);
    condHint.current = null;
  }, [opc, cond]);

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
    aplicarInicial({ chave: d.chave, documento: r.documento, rotulo: d.rotulo, parcelas_projeto: r.parcelas_projeto ?? null,
      tipo: d.tipo === "PV" ? "nfe" : d.chave.startsWith("os_omie:") || cfg?.tipo_os !== "nfse" ? "recibo" : "nfse" });
  }

  function voltarNovo() {
    setModo("novo"); setChave(null); setRotulo(null); setBuscaExist(""); setParcsProj(null); setParcelaDoc(null); iniRef.current = null;
    setCli(VAZIO); setItens([ITEM0]); setParcs([]); setCliCodigo(""); setProposta("");
    setNfRef(null); setNfBusca(""); setNfLista(null); setMotivo(""); setCliProjeto(""); setGeraCob(false);
  }

  // Devolução: busca a NF de entrada (Focus + espelho do Omie)
  useEffect(() => {
    if (!aberto || operacao !== "devolucao" || nfBusca.trim().length < 2 || nfRef?.numero && nfBusca.startsWith(`${nfRef.numero} · `)) { setNfLista(null); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=nf_origem&emp=${empresa}&q=${encodeURIComponent(nfBusca.trim())}`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => setNfLista(j.notas ?? [])).catch(() => setNfLista([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [nfBusca, operacao, empresa, aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Escolheu a NF de origem: destinatário = fornecedor (cadastro) e itens da nota. */
  async function escolherNfOrigem(n: NfOrigem) {
    setNfRef({ chave: n.chave, numero: n.numero, serie: n.serie, emitente_doc: n.emitente_doc, emissao: n.emissao });
    setNfLista(null); setNfBusca(`${n.numero} · ${n.emitente ?? ""}`);
    if (n.itens.length) {
      setItens(n.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, unidade: i.unidade || "UN", ncm: i.ncm ?? "", cest: i.cest ?? null,
        quantidade: i.quantidade, quantidade_max: i.quantidade, valor_unitario: i.valor_unitario, origem: i.origem ?? 0,
        icms_aliquota: i.icms_aliquota, pis_cst: i.pis_cst, pis_aliquota: i.pis_aliquota, cofins_cst: i.cofins_cst, cofins_aliquota: i.cofins_aliquota,
        info_item: i.codigo ? `-${i.codigo}-` : null, ref_item: i.ref_item ?? null })));
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
        .then((x) => x.json()).then((j) => {
          const hs: Hist[] = j.historico ?? [];
          setHist(hs);
          // sem forma/conta definidas: herda do último faturamento do cliente (editável)
          const h = hs[0];
          if (h && !formaDefinida.current) {
            const f = h.condicao?.forma_recebimento ?? h.forma ?? h.parcelas?.[0]?.forma ?? null;
            const ct = h.condicao?.conta_corrente ?? h.conta_codigo ?? null;
            if (f) { setForma(f); setParcs((ps) => ps.map((p) => ({ ...p, forma: f }))); }
            if (ct) setConta(ct);
            if (f || ct) { formaDefinida.current = true; setAviso(`Forma e conta herdadas do último faturamento (${h.tipo} ${h.documento}) — confira em Recebimento.`); }
          }
        }).catch(() => setHist([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [docCli, empresa, aberto]);

  // Autocompletar de itens: catálogo nativo (código novo/Omie ou descrição).
  useEffect(() => {
    if (!aberto || !itBusca || itBusca.q.trim().length < 2) { setItSug(null); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=itens&emp=${empresa}&q=${encodeURIComponent(itBusca.q.trim())}${cliCodigo ? `&cli=${encodeURIComponent(cliCodigo)}` : ""}${tipo === "nfe" ? "&estoque=1" : ""}`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => { setItSug(j.itens ?? []); setItComp(j.compra ?? []); }).catch(() => { setItSug([]); setItComp([]); });
    }, 280);
    return () => window.clearTimeout(t);
  }, [itBusca, empresa, cliCodigo, aberto, tipo]);

  /** Escolheu um item do catálogo: preenche a linha. Remessa/conserto/devolução vão pelo custo médio
   *  (CMC → última compra); venda pelo último preço vendido a este cliente. Sempre editável. */
  function escolherItem(n: number, c: ItemCat, manterValor = false) {
    const custo = c.cmc ?? c.ultimo_preco ?? null;
    const vu = manterValor ? null : naoVenda ? custo : tipo === "nfe" ? c.ultima_venda : null;
    setItens((its) => its.map((x, i) => (i === n ? {
      ...x, codigo: c.codigo, descricao: c.descricao, unidade: c.unidade || "UN", ncm: c.ncm ?? x.ncm ?? "",
      cest: c.cest ?? x.cest ?? null, origem: c.origem ?? x.origem ?? 0, nativo: !!c.nativo,
      valor_unitario: vu != null ? Math.round(vu * 100) / 100 : x.valor_unitario,
    } : x)));
    setDicas((d) => ({ ...d, [n]: { cmc: c.cmc, ultimo_preco: c.ultimo_preco, ultima_venda: c.ultima_venda, saldo: c.saldo } }));
    setItBusca(null); setItSug(null); setItComp([]);
  }

  /** Depois de vincular/cadastrar: busca o item nativo pelo código novo e põe na linha. */
  async function usarNativo(n: number, codigo: string) {
    const j = await fetch(`/api/faturamento/nova?op=itens&emp=${empresa}&q=${encodeURIComponent(codigo)}${cliCodigo ? `&cli=${encodeURIComponent(cliCodigo)}` : ""}&estoque=1`, { cache: "no-store" })
      .then((x) => x.json()).catch(() => ({}));
    const it = ((j.itens ?? []) as ItemCat[]).find((x) => x.codigo.toUpperCase() === codigo.toUpperCase()) ?? (j.itens ?? [])[0];
    const antes = itens[n];
    // substitui a linha no lugar: quantidade e valor da linha continuam (05/10/26)
    if (it) {
      escolherItem(n, it, true);
      // grava a troca no PV/OS de origem e o de-para (06/10/26) — a próxima nota já vem com o item nosso
      if (antes?.codigo && it.n_cod_prod) gravarTroca(antes.codigo, antes.descricao ?? "", it.n_cod_prod, it.codigo);
    }
    setAcerto(null);
  }
  function gravarTroca(codigoAntigo: string, descricao: string, nCodProd: number, codigo: string) {
    if (codigoAntigo.trim().toUpperCase() === codigo.trim().toUpperCase()) return;
    fetch("/api/faturamento/nova", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "trocar_item", empresa, chave, codigo_antigo: codigoAntigo.trim(), descricao, n_cod_prod: nCodProd, codigo }) }).catch(() => {});
  }

  // Quais códigos das linhas não são item nosso — em TODO tipo (NF-e, recibo, NFS-e): o item nosso é o que
  // movimenta/organiza o estoque. Na NF-e a emissão é bloqueada (faltaEstoque); nos demais é aviso.
  const codsLinhas = [...new Set(itens.map((i) => (i.codigo ?? "").trim()).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!codsLinhas) { setSemEst({}); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=sem_estoque&emp=${empresa}&cods=${encodeURIComponent(codsLinhas)}`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => {
          setSemEst(Object.fromEntries(((j.sem ?? []) as { codigo: string; compra: CodCompra | null }[]).map((x) => [x.codigo.toUpperCase(), x.compra])));
          // código antigo que já aponta para um item nosso (ex.: id do Omie de um serviço → SV0013): troca sozinho
          const res = (j.resolvidos ?? []) as { codigo: string; codigo_nativo: string; n_cod_prod: number }[];
          if (res.length) {
            const mapa = new Map(res.map((r) => [r.codigo.trim().toUpperCase(), r]));
            setItens((its) => its.map((x) => {
              const r = mapa.get((x.codigo ?? "").trim().toUpperCase());
              return r ? { ...x, codigo: r.codigo_nativo, nativo: true } : x;
            }));
            for (const r of res) {
              const linha = itens.find((x) => (x.codigo ?? "").trim().toUpperCase() === r.codigo.trim().toUpperCase());
              gravarTroca(r.codigo, linha?.descricao ?? "", r.n_cod_prod, r.codigo_nativo);
            }
          }
        })
        .catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [codsLinhas, empresa]);
  const linhaCompra = (it: { codigo?: string | null }) => !!(it.codigo ?? "").trim() && (it.codigo ?? "").trim().toUpperCase() in semEst;
  /** Abre o acerto da linha: produto de compra do catálogo, ou os dados da própria linha. */
  function acertarLinha(n: number) {
    const it = itens[n];
    const c = semEst[(it.codigo ?? "").trim().toUpperCase()];
    setAcerto({ n, c: {
      n_cod_prod: c?.n_cod_prod ?? 0, codigo: c?.codigo ?? it.codigo ?? null, descricao: c?.descricao ?? it.descricao ?? "",
      unidade: c?.unidade || it.unidade || null, ultimo_preco: c?.ultimo_preco ?? (it.valor_unitario || null), ultima_compra: c?.ultima_compra ?? null,
      fornecedor: c?.fornecedor ?? null, fornecedor_cod: c?.fornecedor_cod ?? null, ncm: (it.ncm || c?.ncm) ?? null } });
  }

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
  const [pagEdit, setPagEdit] = useState<{ pix: boolean } | null>(null);
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
    setForma(f); formaDefinida.current = true;
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
      parcela_doc: parcelaDoc ?? null,
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
  /** NF-e movimenta estoque: toda linha precisa ser item do estoque nosso (busca/vínculo/cadastro). */
  function faltaEstoque(): string | null {
    if (tipo !== "nfe") return null;
    const ruim = itens.find((i) => !(i.codigo ?? "").trim());
    if (ruim) return "Há item sem código — escolha o item do estoque pela busca (nome ou código).";
    const comp = itens.find((i) => linhaCompra(i));
    if (comp) return `${comp.codigo} é código de compra — substitua por um item nosso (Criar item nosso ou Vincular, na linha).`;
    return null;
  }

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

  /** NF-e: todo item precisa de NCM de 8 dígitos que exista na tabela oficial. */
  const ncmDig = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
  function faltaNcm(): string | null {
    if (tipo !== "nfe") return null;
    const ruim = itens.find((i) => i.descricao && (ncmDig(i.ncm).length !== 8 || ncmRuim.includes(ncmDig(i.ncm))));
    return ruim ? `${ruim.descricao}: NCM ${ncmDig(ruim.ncm) ? "inválido" : "ausente"} — use “Localizar NCM” na linha do item.` : null;
  }

  async function validar() {
    setValidando(true); setPre(null);
    if (tipo === "nfe") {
      const unicos = [...new Set(itens.map((i) => ncmDig(i.ncm)).filter((d) => d.length === 8))];
      const res = await Promise.all(unicos.map((d) => fetch(`/api/fiscal/ncm?op=validar&ncm=${d}`).then((x) => x.json()).then((j) => [d, !!j.valido] as const).catch(() => [d, true] as const)));
      setNcmRuim(res.filter(([, ok]) => !ok).map(([d]) => d));
    }
    // OS do Omie: o pré-voo da linha também confere se já foi faturada (Omie/painel/NFS-e).
    const r = chave?.startsWith("os_omie:")
      ? await fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresa, chave, acao: "prevoo", documento: montarDocumento() }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))
      : await fetch("/api/faturamento/nova", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "previa", documento: montarDocumento(), tipo }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setValidando(false);
    const fv = faltaVenda();
    const locais: Checagem[] = fv ? [{ item: "Projeto / categoria / conta", ok: false, nivel: "erro", detalhe: fv }] : [];
    const semNcm = tipo === "nfe" ? itens.filter((i) => i.descricao && ncmDig(i.ncm).length !== 8) : [];
    for (const i of semNcm) locais.push({ item: "NCM", ok: false, nivel: "erro", detalhe: `${i.descricao}: NCM ausente — clique em “Localizar NCM” na linha do item` });
    const fe = faltaEstoque();
    if (fe) locais.push({ item: "Itens do estoque", ok: false, nivel: "erro", detalhe: fe });
    const fn = semNcm.length > 0 || !!fe;
    setPre(r.error ? { checagens: locais, pode_emitir: false, error: r.error }
      : { ...r, checagens: [...locais, ...(r.checagens ?? [])], pode_emitir: !!r.pode_emitir && !fv && !fn });
  }

  /** Venda/recibo/NFS-e: projeto e categoria de receita são obrigatórios (05/10/26);
   *  conta de recebimento obrigatória quando a forma deposita na conta. */
  function faltaVenda(): string | null {
    if (naoVenda) return null;
    if (!projeto) return "Escolha o projeto — obrigatório para emitir (venha do CRM ou use “+ Novo projeto”).";
    if (!categoria) return "Escolha a categoria de receita — obrigatória para emitir.";
    if (precisaParcelas && ["BOL", "PIX", "TRA", "TED", "DEP"].includes(forma) && conta === "") return "Escolha a conta de recebimento (onde o dinheiro vai cair).";
    return null;
  }

  /** Documento novo: o que falta para criar o PV/OS na sequência. */
  function faltaNovo(): string | null {
    if (modo !== "novo" || teste || naoVenda) return null;
    if (!cliCodigo) return "Escolha o cliente pela busca do cadastro (nome, fantasia ou CNPJ/CPF) — o PV/OS novo precisa do código do cadastro.";
    if (!proposta.trim()) {
      if (!semProposta) return "Escolha a proposta do CRM deste documento.";
      if (!semProp) return "Escolha a proposta do CRM ou marque “sem proposta” e informe o motivo.";
      if (semPropMotivo.trim().length < 5) return "Informe o motivo de lançar sem proposta (mín. 5 caracteres).";
    }
    return null;
  }

  async function emitirAgora() {
    const falta = faltaEstoque() ?? faltaNovo() ?? faltaOperacao() ?? faltaVenda();
    if (falta) { setAviso(falta); return; }
    const soCriaOs = modo === "novo" && !chave && tipo === "nfse" && !teste;
    if (!soCriaOs && precisaParcelas && !parcOk) { setAviso(`As parcelas (${fmt(somaParc)}) não somam o valor a receber (${fmt(liquido)}).`); return; }
    const numTxt = modo === "novo" && !teste
      ? (naoVenda ? ` (NF-e ${prox?.nfe ?? "?"})` : tipo === "nfe" ? ` (PV ${prox?.pv ?? "?"} · NF-e ${prox?.nfe ?? "?"})` : tipo === "recibo" ? ` (OS ${prox?.os ?? "?"} · Recibo ${prox?.recibo ?? "?"})` : ` (OS ${prox?.os ?? "?"})`)
      : chave?.startsWith("os_omie:") && !teste ? ` (Recibo ${prox?.recibo ?? "?"})` : "";
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
          body: JSON.stringify({ empresa, chave, acao: "emitir", documento, forcar_homologacao: teste }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }))
      : await fetch("/api/faturamento/emitir", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documento, tipo,
            novo: teste || naoVenda ? null : { cliente_codigo: cliCodigo, proposta: proposta.trim() || null, sem_proposta_motivo: proposta.trim() ? null : semPropMotivo.trim() },
            origem_tipo: teste ? "teste" : "manual",
            gerar_receber_homologacao: teste, forcar_homologacao: teste }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.criado) { setCriado(r.criado); carregarProximos(); }
    if (r.criado && !r.emissao && !r.error) {
      setTx({ fase: "final", inicio: Date.now(), e: { status: "os_criada", tipo: "os" } });
      marcarRascunho("emitido", null);
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
    const st = String(r?.emissao?.status ?? "");
    if (["autorizada", "autorizado", "emitida", "emitido"].includes(st)) marcarRascunho("emitido", id);
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

  function estadoRascunho() {
    return {
      v: 1, empresa, tipo, modo, cliCodigo, semProp, semPropMotivo, chave, rotulo, cli, itens, proposta, base, cond, forma,
      parcs, formaPorParcela, conta, categoria, projeto, centro, vendedor, contrato, desconto, frete, outras, transp, ret,
      pedidoCli, obs, infoContrib, operacao, nfRef, motivo, cliProjeto, geraCob, criado, parcelaDoc, parcsProj,
    };
  }
  type EstadoRasc = ReturnType<typeof estadoRascunho>;
  function aplicarRascunho(p: Partial<EstadoRasc>) {
    limparFolha();
    if (p.empresa) setEmpresa(p.empresa);
    if (p.tipo) setTipo(p.tipo); if (p.modo) setModo(p.modo); if (p.operacao) setOperacao(p.operacao);
    setCliCodigo(p.cliCodigo ?? ""); setSemProp(!!p.semProp); setSemPropMotivo(p.semPropMotivo ?? "");
    setChave(p.chave ?? null); setRotulo(p.rotulo ?? null); setCriado(p.criado ?? null);
    if (p.cli) setCli(p.cli); if (p.itens?.length) setItens(p.itens); setProposta(p.proposta ?? "");
    if (p.base) setBase(p.base); setCond(p.cond ?? ""); condHint.current = null; formaDefinida.current = true;
    if (p.forma) setForma(p.forma); setParcs(p.parcs ?? []); setFormaPorParcela(!!p.formaPorParcela);
    setConta(p.conta ?? ""); setCategoria(p.categoria ?? ""); setProjeto(p.projeto ?? ""); setCentro(p.centro ?? "");
    setVendedor(p.vendedor ?? ""); setContrato(p.contrato ?? ""); setDesconto(p.desconto ?? 0); setFrete(p.frete ?? 0); setOutras(p.outras ?? 0);
    if (p.transp) setTransp(p.transp); if (p.ret) setRet(p.ret); setPedidoCli(p.pedidoCli ?? ""); setObs(p.obs ?? ""); setInfoContrib(p.infoContrib ?? "");
    setNfRef(p.nfRef ?? null); setMotivo(p.motivo ?? ""); setCliProjeto(p.cliProjeto ?? ""); setGeraCob(!!p.geraCob);
    setParcelaDoc(p.parcelaDoc ?? null); setParcsProj(p.parcsProj ?? null);
    // Rascunho de projeto salvo antes de guardar a parcela (07/10/26): busca as parcelas do fechamento
    // de novo — sem elas a emissão não sabe qual parcela a nota fatura.
    if (p.chave && !p.parcelaDoc) {
      const chaveR = p.chave;
      fetch("/api/faturamento/carteira", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: p.empresa ?? empresa, chave: chaveR, acao: "doc" }) }).then((x) => x.json()).then((r) => {
        if (!r?.parcelas_projeto?.length || !r.documento) return;
        iniRef.current = { chave: chaveR, documento: r.documento, rotulo: p.rotulo ?? undefined, parcelas_projeto: r.parcelas_projeto } as Inicial;
        setParcsProj(r.parcelas_projeto); setParcelaDoc(r.documento.parcela_doc ?? null);
      }).catch(() => null);
    }
  }
  const temConteudo = () => !!(cli.nome || itens.some((i) => i.descricao));
  async function salvarRascunho(silencioso = false): Promise<boolean> {
    if (rascCarregando.current || !temConteudo()) return false;
    const est = estadoRascunho();
    const json = JSON.stringify(est);
    if (silencioso && json === rascUltimo.current) return true;
    setRascSalvando(true);
    const destinatario = cli.nome || null;
    const r = await fetch("/api/faturamento/rascunhos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rascId, empresa, tipo, operacao: tipo === "nfe" ? operacao : null, origem: chave ? "existente" : "novo",
        chave, rotulo, cliente_codigo: cliCodigo || null, cliente_nome: cli.nome || null, destinatario,
        projeto: projeto || null, valor_total: total, titulo: [rotulo, rotTipo, cli.nome].filter(Boolean).join(" · "), payload: est }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setRascSalvando(false);
    if (r.error) { if (!silencioso) avisar(`Rascunho: ${r.error}`); return false; }
    setRascId(r.id); rascUltimo.current = json;
    setRascSalvoEm(new Date(r.salvo_em ?? Date.now()).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    if (!silencioso) avisar(`Rascunho salvo — continue em Faturamento › Rascunhos`);
    return true;
  }
  function marcarRascunho(status: "emitido" | "descartado", emissaoId?: number | null) {
    if (!rascId) return;
    fetch("/api/faturamento/rascunhos", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rascId, status, emissao_id: emissaoId ?? null }) }).catch(() => null);
    rascUltimo.current = JSON.stringify(estadoRascunho());
  }
  /** Ao reabrir: o rascunho pode estar velho — compara CMC/saldo de hoje com o salvo e re-valida. */
  async function conferirRascunho(p: Partial<EstadoRasc>, salvoEm: string) {
    const difs: string[] = [];
    const naoV = p.tipo === "nfe" && p.operacao && p.operacao !== "venda";
    const lista = (p.itens ?? []).filter((i) => i.codigo).slice(0, 15);
    // em paralelo (em série levava ~15 s para 7 itens antes de revalidar)
    const resps = await Promise.all(lista.map((it) => fetch(`/api/faturamento/nova?op=itens&emp=${p.empresa ?? empresa}&q=${encodeURIComponent(it.codigo)}`, { cache: "no-store" })
      .then((x) => x.json()).catch(() => null)));
    for (const [k, it] of lista.entries()) {
      const r = resps[k];
      const a = ((r?.itens ?? []) as { codigo: string; codigo_omie?: string | null; cmc: number | null; saldo: number | null }[])
        .find((x) => x.codigo === it.codigo || x.codigo_omie === it.codigo);
      if (!a) continue;
      if (naoV && a.cmc != null && Math.abs(Number(a.cmc) - Number(it.valor_unitario)) > 0.009)
        difs.push(`${it.codigo}: o CMC mudou — hoje ${fmt(Number(a.cmc))} (no rascunho ${fmt(Number(it.valor_unitario))})`);
      if (a.saldo != null && Number(a.saldo) < Number(it.quantidade))
        difs.push(`${it.codigo}: disponível hoje ${a.saldo} (rascunho pede ${it.quantidade})`);
    }
    if (!vivo.current) return;
    setRascDifs([`Rascunho salvo em ${new Date(salvoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — revalidado agora.`, ...difs]);
    validarRef.current();
  }

  function sair() {
    vivo.current = false;
    if (tx && tx.fase !== "final" && tx.id) { avisar(`Emissão #${tx.id} continua processando — avisaremos aqui.`); acompanharEmFundo(tx.id, avisar, onEmitido); }
    // Fechar sem emitir: o rascunho fica salvo (só se há algo preenchido e mudou).
    if (!tx && temConteudo() && JSON.stringify(estadoRascunho()) !== rascUltimo.current) {
      salvarRascunho(true).then((ok) => { if (ok) avisar("Fechou sem emitir — o rascunho ficou salvo (Faturamento › Rascunhos)."); });
    }
    fechar();
  }

  function corrigir() {
    setTx(null); setPre(null); vivo.current = true;
    // O PV/OS novo já existe: reenviar emite sobre ele (não cria outro).
    if (criado) { setChave(`venda:${criado.id}`); setRotulo(criado.label); setModo("existente"); }
  }

  // Referência sempre atual do estado (o setTimeout do carregamento lê o estado já aplicado).
  const estadoRef = useRef(estadoRascunho);
  estadoRef.current = estadoRascunho;
  // a revalidação ao reabrir roda num timeout criado ANTES do rascunho ser aplicado: chama a validação
  // do render atual (senão valida a folha vazia — "Cliente sem nome · 0 itens", 05/10/26)
  const validarRef = useRef(validar);
  validarRef.current = validar;
  const salvarRef = useRef(salvarRascunho);
  salvarRef.current = salvarRascunho;
  // Salva sozinho a cada ~20 s quando há mudanças (nunca durante/depois da transmissão).
  useEffect(() => {
    if (!aberto) return;
    const t = window.setInterval(() => { if (!txRef.current) salvarRef.current(true); }, 20_000);
    return () => window.clearInterval(t);
  }, [aberto]);
  const txRef = useRef(tx);
  txRef.current = tx;

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
    const recibo = e.tipo === "recibo" || (!e.tipo && tipo === "recibo") || osCriada;
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
                    <EnviarAoCliente id={Number(e.id ?? tx.id) || null} />
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
        <div className={`ne-corpo${ladoFechado ? " lado-fechado" : ""}`}>
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
                  if (op) { setModo("novo"); setPre(null); setChave(null); setRotulo(null); setGeraCob(false); setParcs([]); setCond(""); }
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
                {propOrigem && <span title="Proposta do CRM que originou este pedido">· proposta <b>{propOrigem}</b></span>}
                {chave.startsWith("os_omie:") && !teste && prod && <b>· Recibo nº {prox?.recibo ?? "…"}</b>}
                {chave.startsWith("os_omie:") && teste && <span>· teste: numeração real não é usada</span>}
                {!inicial && <button className="ne-lk" onClick={() => { setChave(null); setRotulo(null); setCarteira(null); }}>trocar</button>}</div>}
              {homologacao && (!chave || chave.startsWith("os_omie:")) && (
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
                      <BuscaPessoa valor="" empresa={empresa} placeholder={cli.nome ? `${cli.nome} (escolhido) — digite para trocar` : undefined} onEscolher={async (c) => {
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
                  <BuscaPessoa valor="" empresa={empresa} placeholder={cli.nome ? `${cli.nome} (escolhido) — digite para trocar` : undefined} onEscolher={async (c) => {
                    const p = await pessoaCompleta(c.id);
                    setCliCodigo(String(c.codigo));
                    if (p) { setCli(clienteDaPessoa(p)); setVerCliente(false); } else setAviso("Não consegui abrir o cadastro escolhido");
                  }} />
                </label>
                {!teste && !proposta.trim() && semProposta && (
                  <div className="ne-semprop">
                    <label><input type="checkbox" checked={semProp} onChange={(e) => setSemProp(e.target.checked)} /> Sem proposta do CRM</label>
                    {semProp && <input className="ne-in" placeholder="Motivo (obrigatório)" value={semPropMotivo} onChange={(e) => setSemPropMotivo(e.target.value)} />}
                  </div>
                )}
                {!teste && !proposta.trim() && !semProposta && <span className="ne-dica" style={{ alignSelf: "end" }}>A proposta do CRM é obrigatória para um PV/OS novo.</span>}
              </div>
            )}
            {aviso && <div className="ne-aviso" onClick={() => setAviso(null)}>{aviso}</div>}
            {rascDifs && rascDifs.length > 0 && (
              <div className="ne-aviso" style={{ borderColor: "var(--f-warn, #f59e0b)" }} onClick={() => setRascDifs(null)} title="Clique para fechar">
                {rascDifs.map((d, k) => <div key={k} style={k === 0 ? { fontWeight: 600 } : undefined}>{k === 0 ? d : `• ${d}`}</div>)}
              </div>
            )}

            <section className="ne-sec" id="ne-sec-cliente">
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

            {parcsProj?.length ? (
              <section className="ne-sec" id="ne-sec-parcelas-projeto">
                <h3>Parcela do fechamento <small>projeto · a nota fatura a(s) parcela(s) marcada(s)</small></h3>
                <div className="ne-parc-proj">
                  {parcsProj.map((p) => {
                    const marcada = !!parcelaDoc?.numeros.includes(p.numero);
                    const feita = !!p.faturada_em;
                    return (
                      <label key={p.numero} className={`ne-pp${marcada ? " on" : ""}${feita ? " feita" : ""}`}>
                        <input type="checkbox" disabled={feita} checked={marcada || feita}
                          onChange={() => {
                            const atual = parcelaDoc?.numeros ?? [];
                            const nova = marcada ? atual.filter((n) => n !== p.numero) : [...atual, p.numero].sort((a, b) => a - b);
                            if (nova.length) void trocarParcelas(nova);
                          }} />
                        <b>{p.numero}/{parcsProj.length}</b>
                        <span className="ne-pp-nome">{p.descricao}</span>
                        <span>{fmt(Number(p.valor))}{p.percentual != null ? ` · ${Number(p.percentual).toLocaleString("pt-BR")}%` : ""}</span>
                        <span className="faint">{p.faturamento_previsto ? `fatura ${dBRne(p.faturamento_previsto)}` : "sem data de faturamento"} · vence {dBRne(p.vencimento)}</span>
                        <span className={feita ? "ne-pp-st ok" : "ne-pp-st"}>{feita ? "faturada" : marcada ? "nesta nota" : "a faturar"}</span>
                      </label>
                    );
                  })}
                </div>
                {parcelaDoc && <div className="faint" style={{ marginTop: 6 }}>Esta nota: {parcelaDoc.rotulo} — {fmt(parcelaDoc.total)} de {fmt(parcelaDoc.total_doc)}. Itens, observações e prazo de recebimento já seguem a parcela.</div>}
              </section>
            ) : null}

            <section className="ne-sec" id="ne-sec-itens">
              <h3>Itens <small>{itens.length} item(ns) · bruto {fmt(bruto)}</small></h3>
              {(() => {
                const devol = operacao === "devolucao" && naoVenda;
                // Grade que cabe na coluna da folha (05/10/26, pedido do Benny): dicas numa linha só, embaixo do item
                const cols = ["100px", "minmax(160px,1fr)", ...(tipo === "nfe" ? ["128px"] : []), "52px", "72px", ...(devol ? ["54px", "60px"] : []), "100px", "96px", "26px"].join(" ");
                return (
                  <div className="ne-itens" style={{ ["--ne-cols" as string]: cols }}>
                    <div className="ne-it-cab"><span>Código</span><span>Descrição</span>{tipo === "nfe" && <span>NCM</span>}<span>Un</span><span className="r">Qtd</span>
                      {devol && <><span className="r">Item NF</span><span className="r">ICMS %</span></>}<span className="r">Valor unit.</span><span className="r">Total</span><span /></div>
                    {itens.map((it, n) => {
                      const ncmMal = tipo === "nfe" && !!it.descricao && (ncmDig(it.ncm).length !== 8 || ncmRuim.includes(ncmDig(it.ncm)));
                      const dc = dicas[n];
                      const acima = operacao !== "devolucao" && dc?.saldo != null && it.quantidade > (dc.saldo ?? 0) && (dc.saldo ?? 0) > 0;
                      const partes: { t: string; ruim?: boolean }[] = [];
                      const ehCompra = linhaCompra(it);
                      if (tipo === "nfe" && it.codigo && it.nativo === false && !ehCompra) partes.push({ t: "código digitado à mão — escolha o item do estoque pela busca", ruim: true });
                      if ((it.unidade ?? "").trim().toUpperCase() === "MM" && /cabo|fio|eletroduto|mangueira|tubo|perfil|cordoalha/i.test(it.descricao ?? ""))
                        partes.push({ t: "unidade MM para este item? confira o cadastro (normalmente M)", ruim: true });
                      if (it.quantidade_max != null) partes.push({ t: `máx. ${it.quantidade_max} (NF de origem)`, ruim: it.quantidade > it.quantidade_max });
                      if (operacao !== "devolucao" && dc?.saldo != null) partes.push((dc.saldo ?? 0) < 0
                        ? { t: `disp. ${dc.saldo} — saldo do estoque inconsistente, conferir no Inventário (não bloqueia a nota)`, ruim: true }
                        : (dc.saldo ?? 0) === 0 ? { t: "saldo do item ainda não conferido (não bloqueia a nota)" }
                        : { t: `disp. ${dc.saldo}${acima ? " — acima do estoque" : ""}`, ruim: acima });
                      if (dc?.cmc != null) partes.push({ t: `CMC ${fmt(dc.cmc)}` });
                      if (dc?.ultimo_preco != null) partes.push({ t: `últ. compra ${fmt(dc.ultimo_preco)}` });
                      if (tipo === "nfe" && !naoVenda && dc?.ultima_venda != null) partes.push({ t: `últ. venda ${fmt(dc.ultima_venda)}` });
                      return (
                        <div key={n} className={`ne-it${ehCompra ? " compra" : ""}`}>
                          <div className="ne-it-lin">
                            <input className="ne-in ne-it-cod" aria-label="Código" value={it.codigo ?? ""} placeholder="código"
                              onChange={(e) => { setItens(itens.map((x, i) => (i === n ? { ...x, codigo: e.target.value, nativo: false } : x))); setItBusca({ n, q: e.target.value }); }}
                              onBlur={() => window.setTimeout(() => setItBusca((b) => (b?.n === n ? null : b)), 200)} />
                            <div className="ne-it-desc" style={{ position: "relative" }}><input className="ne-in" aria-label="Descrição" style={{ width: "100%" }} value={it.descricao ?? ""} placeholder="busque pelo nome ou código"
                              onChange={(e) => { setItens(itens.map((x, i) => (i === n ? { ...x, descricao: e.target.value, nativo: false } : x))); setItBusca({ n, q: e.target.value }); }}
                              onBlur={() => window.setTimeout(() => setItBusca((b) => (b?.n === n ? null : b)), 200)} />
                      {itBusca?.n === n && itSug && (
                        <div className="ne-exist-lista" style={{ position: "absolute", top: "100%", left: 0, minWidth: 460, zIndex: 6, maxHeight: 280 }}>
                          {itSug.length ? itSug.map((c) => (
                            <button key={`${c.codigo}-${c.codigo_omie}`} type="button" className="ne-exist-it" onMouseDown={(e) => { e.preventDefault(); escolherItem(n, c); }}>
                              <b>{c.codigo}</b>{c.codigo_omie && c.codigo_omie !== c.codigo ? <small> · Omie {c.codigo_omie}</small> : null} — {c.descricao}
                              <small style={{ display: "block", color: "var(--ww-text-muted)" }}>
                                {[c.ncm && `NCM ${c.ncm}`, c.cmc != null && `CMC ${fmt(c.cmc)}`, c.ultimo_preco != null && `últ. compra ${fmt(c.ultimo_preco)}`,
                                  c.ultima_venda != null && `vendido a este cliente ${fmt(c.ultima_venda)}`, c.saldo != null && `disp. ${c.saldo}`].filter(Boolean).join(" · ")}
                              </small>
                            </button>)) : <div style={{ padding: 8, fontSize: 12.5 }}>{tipo === "nfe" ? "Nenhum item do estoque com esse nome/código." : "Nenhum item no catálogo — preencha à mão."}</div>}
                          {tipo === "nfe" && itComp.length > 0 && (
                            <div className="ne-comp">
                              <div className="ne-comp-tit">Códigos de compra sem item nosso <small>— não movimentam estoque: cadastre no estoque ou vincule a um item existente</small></div>
                              {itComp.map((c) => (
                                <div key={c.n_cod_prod} className="ne-comp-it">
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <span className="ne-comp-cod">{c.codigo ?? c.n_cod_prod}</span> {c.descricao}
                                    <small style={{ display: "block" }}>{[c.fornecedor && `forn. ${c.fornecedor}`, c.ultimo_preco != null && `últ. compra ${fmt(c.ultimo_preco)}`,
                                      c.ultima_compra && new Date(`${c.ultima_compra}T12:00:00`).toLocaleDateString("pt-BR")].filter(Boolean).join(" · ")}</small>
                                  </div>
                                  <button type="button" className="ne-lk" onMouseDown={(e) => { e.preventDefault(); setAcerto({ n, c }); setItBusca(null); }}>Cadastrar no estoque</button>
                                  <button type="button" className="ne-lk" onMouseDown={(e) => { e.preventDefault(); setAcerto({ n, c }); setItBusca(null); }}>Vincular a existente</button>
                                </div>))}
                            </div>)}
                        </div>)}
                            </div>
                            {tipo === "nfe" && <div className="ne-it-ncm">
                              <input className={`ne-in${ncmMal ? " ruim" : ""}`} aria-label="NCM" placeholder="NCM" value={it.ncm ?? ""} title={ncmMal ? (ncmDig(it.ncm) ? "NCM inválido" : "sem NCM") : undefined}
                                onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, ncm: e.target.value } : x)))} />
                              <button type="button" className={`ne-ncm-lupa${ncmMal ? " ruim" : ""}`} title="Localizar NCM" aria-label="Localizar NCM" onClick={() => setNcmBox(n)}>🔍</button>
                            </div>}
                            <input className="ne-in" aria-label="Unidade" value={it.unidade ?? "UN"} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, unidade: e.target.value } : x)))} />
                            <input className={`ne-in num${(it.quantidade_max != null && it.quantidade > it.quantidade_max) || acima ? " ruim" : ""}`} aria-label="Quantidade" type="number" step="0.01" value={it.quantidade}
                              max={it.quantidade_max ?? undefined} title={it.quantidade_max != null ? `máx. ${it.quantidade_max} (NF de origem)` : undefined}
                              onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, quantidade: Number(e.target.value) } : x)))} />
                            {devol && <input className="ne-in num" aria-label="Item na NF de origem" type="number" min={1} title="nº do item na NF de origem" value={it.ref_item ?? n + 1}
                              onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, ref_item: Number(e.target.value) || null } : x)))} />}
                            {devol && <input className="ne-in num" aria-label="ICMS %" type="number" step="0.01" value={it.icms_aliquota ?? 0}
                              onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, icms_aliquota: Number(e.target.value) } : x)))} />}
                            <input className="ne-in num" aria-label="Valor unitário" type="number" step="0.01" value={it.valor_unitario} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, valor_unitario: Number(e.target.value) } : x)))} />
                            <span className="ne-it-tot">{fmt(it.quantidade * it.valor_unitario)}</span>
                            <button type="button" className="ne-it-rem" title="remover item" aria-label="remover item" onClick={() => { setItens(itens.length > 1 ? itens.filter((_, i) => i !== n) : [ITEM0]); setDicas({}); }}>×</button>
                          </div>
                          {ehCompra && <div className="ne-it-compra">
                            <span className="ne-chip-compra" title="Código que não é item do nosso estoque — não pode sair na nota">{semEst[(it.codigo ?? "").trim().toUpperCase()] ? "código de compra" : "código fora do estoque"}</span>
                            <span className="ne-dica">substitua por um item nosso:</span>
                            <button type="button" className="ne-btn" onClick={() => acertarLinha(n)}>Criar item nosso</button>
                            <button type="button" className="ne-btn" onClick={() => acertarLinha(n)}>Vincular a item existente</button>
                          </div>}
                          {(partes.length > 0 || ncmMal) && <div className="ne-it-dicas">
                            {ncmMal && <span className="ruim">{ncmDig(it.ncm) ? "NCM inválido" : "sem NCM"} — <button type="button" className="ne-lk" onClick={() => setNcmBox(n)}>localizar NCM</button></span>}
                            {partes.map((p, k) => <span key={k} className={p.ruim ? "ruim" : undefined}>{p.t}</span>)}
                          </div>}
                        </div>);
                    })}
                  </div>);
              })()}
              <div><button className="ne-lk" onClick={() => setItens([...itens, { ...ITEM0 }])}>+ item</button></div>
              <div className="ne-linha">
                {num("Desconto (R$)", desconto, setDesconto)}
                {tipo === "nfe" && num("Frete (R$)", frete, setFrete)}
                {num(tipo === "nfe" ? "Outras despesas (R$)" : "Acréscimo (R$)", outras, setOutras, 150)}
                <span style={{ marginLeft: "auto", fontSize: 13 }}>Total do documento <b style={{ fontSize: 16, marginLeft: 6 }}>{fmt(total)}</b></span>
              </div>
            </section>

            {precisaParcelas && <section className="ne-sec" id="ne-sec-recebimento">
              <h3>Recebimento <small>{naoVenda ? (operacao === "devolucao" ? "crédito a receber do fornecedor" : "cobrança desta remessa") : "as parcelas a receber são criadas exatamente assim"}</small></h3>
              <div className="ne-linha">
                {sel("Condição de pagamento", cond, (v) => aplicarCondicao(v), (opc?.condicoes ?? []).map((c) => ({ codigo: c.codigo, nome: c.nome })), 230, condHint.current ? "…" : "— escolha —")}
                <label className="ne-rot" style={{ width: 150 }}>Data base dos prazos
                  <input className="ne-in" type="date" value={base} onChange={(e) => setBase(e.target.value)} />
                </label>
              </div>
              <table className="ne-tab">
                <thead><tr><th>Nº</th><th>Vencimento</th><th>Prazo</th>{formaPorParcela && <th>Forma</th>}<th className="r">Valor</th><th className="r">%</th><th /></tr></thead>
                <tbody>{parcs.map((p, n) => (
                  <tr key={n}>
                    <td>{String(n + 1).padStart(2, "0")}/{String(parcs.length).padStart(2, "0")}</td>
                    <td><input className="ne-in" type="date" value={p.vencimento} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, vencimento: e.target.value } : x)))} /></td>
                    <td style={{ color: "var(--ww-text-muted)" }}>{diasEntre(base, p.vencimento)} dias</td>
                    {formaPorParcela && <td><select className="ne-in" value={p.forma} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, forma: e.target.value } : x)))}>
                      {(opc?.formas ?? [{ codigo: p.forma, nome: p.forma }]).map((f) => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
                    </select></td>}
                    <td className="r"><input className="ne-in num" style={{ width: 120 }} type="number" step="0.01" value={p.valor} onChange={(e) => setParcs(parcs.map((x, i) => (i === n ? { ...x, valor: Number(e.target.value) } : x)))} /></td>
                    <td className="r">{liquido ? ((p.valor / liquido) * 100).toFixed(1) : "0"}%</td>
                    <td><button className="ne-lk" onClick={() => setParcs(parcs.filter((_, i) => i !== n))}>remover</button></td>
                  </tr>))}
                </tbody>
              </table>
              <div className="ne-linha">
                <button className="ne-lk" onClick={() => setParcs([...parcs, { vencimento: somaDias(parcs.at(-1)?.vencimento ?? base, 30), valor: 0, forma }])}>+ parcela</button>
                <button className="ne-lk" onClick={redistribuir}>redistribuir valores</button>
                <label style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={formaPorParcela} onChange={(e) => { setFormaPorParcela(e.target.checked); if (!e.target.checked) setParcs(parcs.map((x) => ({ ...x, forma }))); }} />
                  formas diferentes por parcela
                </label>
                <span style={{ marginLeft: "auto", fontSize: 12.5, color: parcOk ? "var(--ww-text-muted)" : "#fca5a5", fontWeight: parcOk ? 400 : 700 }}>
                  Soma das parcelas {fmt(somaParc)} {parcOk ? "✓" : `≠ a receber ${fmt(liquido)}`}
                </span>
              </div>
              <div className="ne-linha ne-forma">
                {sel("Forma de recebimento", forma, (v) => { formaDefinida.current = true; setForma(v); setParcs(parcs.map((p) => ({ ...p, forma: v }))); }, opc?.formas ?? [{ codigo: "BOL", nome: "Boleto" }], 220, "—")}
                {sel("Conta de recebimento", conta, (v) => { formaDefinida.current = true; setConta(v === "" ? "" : Number(v)); }, opc?.contas ?? [], 260)}
                <span className="ne-dica" style={{ alignSelf: "end", maxWidth: 320 }}>Boleto, PIX, transferência… e a conta onde vai cair o dinheiro. A instrução de pagamento sai na nota e em cada parcela.</span>
              </div>
              <div className="ne-linha">
                {sel("Categoria de receita *", categoria, setCategoria, (opc?.categorias ?? []).map((c) => ({ codigo: c.codigo, nome: `${c.codigo} ${c.nome}` })), 260)}
                {sel("Projeto *", projeto, setProjeto, opc?.projetos ?? [], 260)}
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
              {(instr.linhas.length > 0 || instr.faltas.length > 0) && (
                <div className="ne-pag">
                  {instr.linhas.map((l) => <div key={l}>💳 {l} <small>— sai no documento e em cada parcela</small></div>)}
                  {instr.faltas.map((f) => (
                    <div key={f} className="falta">⚠ {f}.{" "}
                      {contaSel && <button className="ne-lk" onClick={() => setPagEdit({ pix: f.includes("PIX") })}>
                        {f.includes("PIX") ? `Cadastrar chave PIX em “${contaSel.nome}”` : `Completar dados bancários de “${contaSel.nome}”`}</button>}
                      {contaSel && <a className="ne-lk" style={{ marginLeft: 10, opacity: .75 }} href={`/cadastros/contas?emp=${empresa}&codigo=${contaSel.codigo}`} target="_blank" rel="noopener">abrir cadastro completo ↗</a>}
                    </div>
                  ))}
                  {pagEdit && contaSel && (
                    <ContaPagamentoInline empresa={empresa} conta={contaSel} pix={pagEdit.pix}
                      onFechar={() => setPagEdit(null)}
                      onSalvo={(d) => {
                        setOpc((o) => o ? { ...o, contas: o.contas.map((c) => c.codigo === contaSel.codigo ? { ...c, ...d } : c) } : o);
                        setPagEdit(null);
                      }} />
                  )}
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
              <section className="ne-sec" id="ne-sec-operacao">
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

            <section className="ne-sec" id="ne-sec-infcpl">
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

          {ladoFechado ? <aside className="ne-lado fechado"><button type="button" className="ne-lado-tog" title="Mostrar histórico e validação" onClick={() => setLadoFechado(false)}>‹</button></aside>
          : <aside className="ne-lado">
            <button type="button" className="ne-lado-tog" title="Recolher painel" onClick={() => setLadoFechado(true)}>›</button>
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
              {!precisaParcelas ? <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Sem cobrança — esta nota não gera contas a receber{naoVenda ? " (marque “Gerar cobrança” se precisar)" : ""}.</div> : parcs.length ? (
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
                  <div className="ne-chk">{pre.checagens.filter((c) => !c.ok || verOk).map((c, k) => (
                    <div key={k} className={c.ok ? "ok" : c.nivel === "erro" ? "err" : "av"}><span>{c.ok ? "✓" : c.nivel === "erro" ? "✕" : "!"}</span><span><b>{c.item}</b> — {c.detalhe}</span></div>))}
                    {pre.checagens.some((c) => c.ok) && <button type="button" className="ne-lk" style={{ fontSize: 12, textAlign: "left" }} onClick={() => setVerOk((v) => !v)}>
                      {verOk ? "esconder as verificações ok" : `✓ ${pre.checagens.filter((c) => c.ok).length} verificações ok`}</button>}
                  </div>
                )}
              </div>
            )}
          </aside>}
        </div>
          {ncmBox != null && itens[ncmBox] && (
          <LocalizarNcm emp={empresa} descricao={itens[ncmBox].descricao ?? ""} codigo={itens[ncmBox].codigo || null} atual={itens[ncmBox].ncm}
            onFechar={() => setNcmBox(null)}
            onEscolher={(ncm, salvo) => {
              const k = ncmBox; setNcmBox(null);
              setItens((its) => its.map((x, i) => (i === k ? { ...x, ncm } : x)));
              setNcmRuim((r) => r.filter((d) => d !== ncm));
              avisar(`NCM ${ncmFmt(ncm)} aplicado${salvo ? " e salvo no cadastro do item" : " nesta nota"}.`);
            }} />)}
          {acerto && (
            <div className="ne-acerto-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) setAcerto(null); }}>
              <AcertoItemEstoque empresa={empresa} compra={acerto.c} onFechar={() => setAcerto(null)} onPronto={(codigo) => usarNativo(acerto.n, codigo)} />
            </div>)}
        <div className="ne-rod">
          <span className="tot">Total <b>{fmt(total)}</b></span>
          {ehOs && totRet > 0 && <span className="tot">A receber <b>{fmt(liquido)}</b></span>}
          <span className="tot">{precisaParcelas ? `${parcs.length} parcela(s)` : "sem cobrança"}</span>
          <span style={{ flex: 1 }} />
          {rascSalvoEm && <span className="ne-dica" title="O rascunho salva sozinho a cada ~20 s">{rascSalvando ? "salvando…" : `rascunho salvo às ${rascSalvoEm}`}</span>}
          <button className="ne-btn" onClick={sair}>Cancelar</button>
          <button className="ne-btn" disabled={rascSalvando || !temConteudo() || !!tx} onClick={() => salvarRascunho(false)}
            title="Salva tudo o que foi preenchido para continuar depois — não emite e não reserva numeração">Salvar rascunho</button>
          <button className="ne-btn" disabled={validando} onClick={validar}>{validando ? "Validando…" : "Validar"}</button>
          {tipo !== "nfse" && <button className="ne-btn" disabled={!cli.nome || !itens.some((i) => i.descricao)} onClick={() => previaDocumento(montarDocumento(), tipo === "recibo" ? "recibo" : "nfe", avisar)}
            title="Ver como o documento vai sair — sem enviar nada à SEFAZ e sem gastar numeração">{tipo === "recibo" ? "Pré-visualizar recibo" : "Pré-visualizar DANFE"}</button>}
          {!naoVenda && faltaVenda() && <span className="ne-dica" style={{ color: "var(--ap-t-red)", maxWidth: 360 }}>{faltaVenda()}</span>}
          {!faltaVenda() && !faltaNcm() && faltaEstoque() && <span className="ne-dica" style={{ color: "var(--ap-t-red)", maxWidth: 360 }}>{faltaEstoque()}</span>}
          {!faltaVenda() && faltaNcm() && <span className="ne-dica" style={{ color: "var(--ap-t-red)", maxWidth: 360 }}>{faltaNcm()}</span>}
          <button className={`ne-btn ${prod ? "perigo" : "pri"}`} disabled={!cli.nome || !itens.some((i) => i.descricao) || (precisaParcelas && !parcOk) || !!faltaVenda() || !!faltaNcm() || !!faltaEstoque()}
            title={faltaVenda() ?? faltaNcm() ?? faltaEstoque() ?? undefined} onClick={emitirAgora}>
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


/** Dados de pagamento da conta (PIX / banco) editados ali mesmo na emissão — 05/10/26.
 *  Grava no cadastro da conta (Cadastros › Bancos e contas) sem sair da folha. */
function ContaPagamentoInline({ empresa, conta, pix, onFechar, onSalvo }: {
  empresa: string; conta: ContaRec; pix: boolean;
  onFechar: () => void; onSalvo: (d: Partial<ContaRec>) => void;
}) {
  const [tipo, setTipo] = useState(conta.pix_tipo ?? "");
  const [chave, setChave] = useState(conta.pix_chave ?? "");
  const [benef, setBenef] = useState(conta.beneficiario ?? "");
  const [banco, setBanco] = useState(conta.banco ?? "");
  const [ag, setAg] = useState(conta.agencia ?? "");
  const [cc, setCc] = useState(conta.conta ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    setErro(null);
    if (pix && !chave.trim()) { setErro("Informe a chave PIX"); return; }
    setSalvando(true);
    const dados: Partial<ContaRec> = pix
      ? { pix_tipo: tipo || null, pix_chave: chave.trim(), beneficiario: benef.trim() || null }
      : { banco: banco.trim() || null, agencia: ag.trim() || null, conta: cc.trim() || null, beneficiario: benef.trim() || null };
    try {
      const r = await fetch("/api/faturamento/nova", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "conta_pagamento", empresa, codigo: String(conta.codigo), dados }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || "Falha ao salvar");
      onSalvo(dados);
    } catch (e) { setErro((e as Error).message); } finally { setSalvando(false); }
  }
  return (
    <div className="ne-pag-inline" role="dialog" aria-label="Dados de pagamento da conta"
      style={{ marginTop: 8, padding: 12, border: "1px solid var(--f-line, rgba(255,255,255,.12))", borderRadius: 10, background: "var(--f-card2, rgba(255,255,255,.03))" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {pix ? "Chave PIX" : "Dados bancários"} de “{conta.nome}” <small style={{ opacity: .7, fontWeight: 400 }}>— grava no cadastro da conta</small>
      </div>
      <div className="ne-linha" style={{ flexWrap: "wrap", gap: 8 }}>
        {pix ? (<>
          <label className="ne-rot" style={{ width: 150 }}>Tipo da chave
            <select className="ne-in" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">—</option><option value="cnpj">CNPJ</option><option value="cpf">CPF</option>
              <option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Aleatória</option>
            </select></label>
          <label className="ne-rot" style={{ flex: 1, minWidth: 220 }}>Chave PIX
            <input className="ne-in" autoFocus value={chave} onChange={(e) => setChave(e.target.value)} placeholder="ex.: 12.345.678/0001-90" /></label>
        </>) : (<>
          <label className="ne-rot" style={{ width: 90 }}>Banco<input className="ne-in" value={banco} onChange={(e) => setBanco(e.target.value)} /></label>
          <label className="ne-rot" style={{ width: 110 }}>Agência<input className="ne-in" value={ag} onChange={(e) => setAg(e.target.value)} /></label>
          <label className="ne-rot" style={{ width: 150 }}>Conta<input className="ne-in" value={cc} onChange={(e) => setCc(e.target.value)} /></label>
        </>)}
        <label className="ne-rot" style={{ width: 220 }}>Beneficiário (opcional)
          <input className="ne-in" value={benef} onChange={(e) => setBenef(e.target.value)} /></label>
      </div>
      {erro && <div className="falta" style={{ marginTop: 6 }}>⚠ {erro}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="ne-btn pri" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar na conta"}</button>
        <button className="ne-btn" onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}
