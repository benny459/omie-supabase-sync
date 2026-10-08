"use client";

// A lista de materiais do projeto — UMA tabela.
//
// ── O que estava errado ──────────────────────────────────────────────────────
// A tela mostrava a mesma lista duas vezes: esta grade (para escrever) e um
// bloco separado logo abaixo (para acompanhar). Os mesmos 36 itens, as mesmas
// colunas de item/qtd/modelo/PC, e o leitor tinha que descobrir qual mandava.
// A justificativa "uma é de escrita, outra de leitura" não sobreviveu à tela.
//
// Agora é uma só: as colunas da esquerda se editam, as da direita vêm do PC
// vinculado e são de leitura. O acompanhamento passa a ficar NA LINHA do item,
// que é onde ele responde alguma coisa.
//
// ── 07/10/26: a aba "Compras × lista" entrou aqui ────────────────────────────
// Duas telas para a mesma lista confundiam. Os KPIs (estimado × budget ×
// comprometido × pago × margem) vão no topo; cada linha mostra RC, pedido de
// compra (link), comprado (valor da linha do PC), situação (mesmas pílulas do
// Compras) e vínculo; sugestões de vínculo, vincular automático e Gerar RC
// ficam na barra. Linha antiga ligada só pelo nº do PC também mostra valor —
// a rota acha a linha do item dentro do PC (lib/lista-pc-linha).
//
// ── Catálogo: item NOSSO primeiro (07/10/26) ─────────────────────────────────
// O autocompletar e o "Casar com o catálogo" usam os itens do estoque nosso
// (código novo), como o Faturamento; código do Omie já vinculado vira o item
// nosso. Linha da CP sem casamento abre o seletor (sugestões, busca, criar item
// nosso) e a escolha vira de-para: o mesmo texto casa sozinho da próxima vez.
//
// ── Grupos de equipamento (07/10/26) ─────────────────────────────────────────
// "Necessário em" por grupo: a data do grupo preenche as linhas dele; linha com
// outra data fica marcada como data própria. A data mora na linha — é ela que a
// RC ("data limite") e o fluxo já leem.
//
// ── Grava pela MESMA rota do upload ──────────────────────────────────────────
// /api/rc-projetos/upload já fazia o sync destrutivo e já aceitava pc_numero.
// Uma rota "manual" separada criaria duas definições do que é a lista, e elas
// divergiriam no primeiro ajuste de regra.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import GradeEditavel, { linhaVazia, num, type ColunaGrade, type LinhaGrade, type SugestaoGrade } from "./GradeEditavel";
import PcPickerModal, { type PcSearchResult } from "./PcPickerModal";
import GerarPcDaLista, { type LinhaParaPc } from "./GerarPcDaLista";
import AdicionarItensModal, { type LinhaNova } from "./AdicionarItensModal";
import AcertoItemEstoque, { type Compra, type Escolhido } from "@/components/faturamento/AcertoItemEstoque";
import "@/components/faturamento/nova-emissao.css";
import { CSS_CDL, SugestoesVinculo, ForaDaLista, FluxoCompras, situacaoPc,
         type DadosCompras, type CasamentoPc } from "./ComprasDaLista";
import { supaBrowser } from "@/lib/supabase";
import { deHtml } from "@/lib/match-pc";
import { normGrupo, dataDoGrupo, aplicarDataGrupo, nomePadrao } from "@/lib/grupos-equipamento-puro";
import { estadoPc, dicaEstadoPc, LEGENDA_SITUACAO } from "@/lib/situacao-pc";
import { sinalEntrega, FOLGA_ENTREGA_DIAS, type SinalEntrega } from "@/lib/sinal-entrega";
import { textoCasar, SUG_MIN } from "@/lib/texto-casar";
import { planejarItem, prazoEfetivo, normFornecedor, type PrazoFornecedor, type PlanoItem } from "@/lib/planejamento-compras";
import PlanejamentoCompras, { resumoPlano, type ItemPlano } from "./PlanejamentoCompras";
import PrazosFornecedorModal from "./PrazosFornecedorModal";
import AgenteCompras from "./AgenteCompras";
import type { ResumoVivo } from "./PainelProjeto";

/** Cores dos grupos de equipamento (spec B v3): paleta de 8, estável pela ordem dos grupos.
 *  Com a migração sql/131 a cor gravada no cadastro (platform.equipamento_grupo.cor) vence. */
export const CORES_GRUPO = ["#6ea8ff", "#3ddc97", "#f5b547", "#b48cff", "#ff8fa3", "#5fd4e8", "#ffb36e", "#9ad36e"];

type ItemRow = {
  id: string; equipamento: string | null; item: string;
  qtd: number | null; modelo: string | null; observacao: string | null;
  pc_numero: string | null;
  nome_fornecedor: string | null;
  dt_previsao: string | null;
  nova_prev_materiais: string | null;
  mt_data_recebimento_nf: string | null;
  pc_etapa_texto: string | null;
  cat_ncod_prod: number | null; cat_codigo: string | null; cat_valor_unit: number | null;
  cat_fornecedor: string | null; cat_entrega_dias: number | null; cat_fat_dias: number | null;
  un: string | null; data_necessaria: string | null;
};
/** Sugestão gravada na linha (sql/127, 08/10/26). Lida à parte da view. */
type SugRow = { id: string; sug_ncod_prod: number | null; sug_codigo: string | null; sug_descricao: string | null;
  sug_fornecedor: string | null; sug_score: number | null; sug_status: "pendente" | "aceita" | "recusada" | null };

/** Item do catálogo da lista (lib/catalogo-projeto): item NOSSO (código novo) ou, à parte, só do Omie. */
type Cat = {
  ncod_prod: number; codigo: string | null; codigo_omie?: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; ultima_compra: string | null; fornecedor: string | null;
  qtd_compras: number | null; entrega_dias: number | null; entrega_fonte: string | null;
  fat_dias: number | null; nativo?: boolean; via?: string | null; score?: number; motivo?: string; medidas_ok?: boolean;
};
type Casamento = { idx: number; status: "ok" | "conferir" | "sem"; manual?: boolean; melhor: Cat | null; alternativas: Cat[]; compra?: Cat[] };

/** Campos que o catálogo preenche na linha. `_match` e `_alts` só vivem na tela; a
 *  sugestão (`_sug`, `_sug_status`) é gravada (sql/127) e também cai se o texto mudar. */
const CAT_CAMPOS = ["cat_ncod_prod", "cat_codigo", "cat_valor_unit", "cat_fornecedor",
                    "cat_entrega_dias", "cat_fat_dias", "_match", "_alts", "_vu_fonte", "_cat_desc",
                    "_sug", "_sug_status", "_omie_ncod"];
/** Chaves da linha (para a linha vazia — independe das colunas de leitura). */
const CHAVES = ["equipamento", "cat_codigo", "item", "qtd", "un", "data_necessaria", "observacao", "cat_valor_unit", "modelo", "pc_numero"];
const vazia = () => linhaVazia(CHAVES.map((key) => ({ key, label: "", w: 0 })));

const s = (v: unknown) => (v == null ? "" : String(v));
/** Valor para a célula no padrão brasileiro ("574,11"); num() lê de volta. */
const moeda = (v: number | null | undefined) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Preenche a linha com um item do catálogo. O valor vem do ÚLTIMO PREÇO PAGO
 *  (decisão do Benny, 30/09/2026); sem compra anterior, o que já havia fica. */
function camposDoCatalogo(c: Cat, match: "ok" | "conferir", alts: Cat[] = [], valorAtual = ""): Record<string, string> {
  return {
    cat_ncod_prod: s(c.ncod_prod), cat_codigo: s(c.codigo), _cat_desc: c.descricao ?? "",
    cat_valor_unit: c.ultimo_preco != null ? moeda(c.ultimo_preco) : valorAtual,
    _vu_fonte: c.ultimo_preco != null ? "catálogo" : "",
    cat_fornecedor: s(c.fornecedor), cat_entrega_dias: s(c.entrega_dias), cat_fat_dias: s(c.fat_dias),
    _match: match, _alts: alts.length ? JSON.stringify(alts) : "",
  };
}
/** Sugestão do catálogo (07/10/26, Benny): casamento provável (⚠ conferir com nota ≥ SUG_MIN)
 *  vai para a linha como SUGESTÃO — fica à vista, mas não é código confirmado: não conta
 *  como casado e o PC não sai com ela até alguém aceitar. Desde 08/10/26 (spec C) ela é
 *  GRAVADA na linha (sug_*, sug_status='pendente'): recarregar, gerar PC ou F5 não a apaga.
 *  Linha só do Omie guarda o produto do Omie em `_omie_ncod` enquanto a sugestão está pendente. */
function camposSugestao(c: Cat, alts: Cat[] = [], l?: LinhaGrade): Record<string, string> {
  const omie: Record<string, string> = l && l._match === "omie" && l.cat_ncod_prod ? { _omie_ncod: l.cat_ncod_prod } : {};
  return { ...omie, _match: "sug", _sug: JSON.stringify(c), _sug_status: "pendente", _alts: alts.length ? JSON.stringify(alts) : "", cat_ncod_prod: "", cat_codigo: "", _cat_desc: "" };
}
/** A linha pode receber sugestão automática? (spec C.3/C.8: sem código NOSSO — inclusive
 *  a que só tem produto do Omie —, sem sugestão pendente e não recusada.) */
const semCodigoNosso = (l: LinhaGrade) => !String(l.cat_codigo ?? "").trim() || l._match === "omie";
const elegivelSug = (l: LinhaGrade) => !!String(l.item ?? "").trim() && semCodigoNosso(l)
  && l._match !== "sug" && l._sug_status !== "recusada";
/** Sugestão gravada → campos da linha. */
function sugDaLinhaGravada(sg: SugRow | undefined, temCodigo: boolean): Record<string, string> {
  if (!sg?.sug_status) return {};
  const c: Cat = { ncod_prod: Number(sg.sug_ncod_prod), codigo: sg.sug_codigo, descricao: sg.sug_descricao ?? "", unidade: null,
    ultimo_preco: null, ultima_compra: null, fornecedor: sg.sug_fornecedor, qtd_compras: null, entrega_dias: null, entrega_fonte: null,
    fat_dias: null, score: sg.sug_score ?? undefined, nativo: true };
  const js = sg.sug_ncod_prod ? JSON.stringify(c) : "";
  if (sg.sug_status === "pendente" && !temCodigo && js) return { _match: "sug", _sug: js, _sug_status: "pendente" };
  return { _sug: js, _sug_status: sg.sug_status === "pendente" ? "" : sg.sug_status };
}
const lerSug = (l: Record<string, string>): Cat | null => { try { return l._sug ? JSON.parse(l._sug) as Cat : null; } catch { return null; } };
function sugestao(c: Cat): SugestaoGrade {
  const partes = [
    c.codigo ? `cód ${c.codigo}` : "sem código",
    c.via ? c.via : null,
    c.fornecedor, c.qtd_compras ? `${c.qtd_compras} compra(s)` : null,
    c.entrega_dias != null ? `entrega ~${c.entrega_dias}d` : null,
    c.fat_dias != null ? `fatura ${c.fat_dias}d` : null,
    c.medidas_ok === false ? "⚠ medida diferente" : null,
  ].filter(Boolean);
  return {
    chave: String(c.ncod_prod), titulo: c.descricao, detalhe: partes.join(" · "),
    direita: c.ultimo_preco != null ? brl(c.ultimo_preco) : "sem preço", dados: c,
  };
}

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const dia = (s: string | null | undefined) => {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(s);
};
const chaveItem = (eq: string, item: string) =>
  `${String(eq || "Geral").trim().toLowerCase()}|${String(item).trim().toLowerCase()}`;

type ItemCpBase = { equipamento: string; item: string; qtd: number | null; modelo: string | null; custo_cp: number | null };
type GruposMeta = { cadastro: string[] | null; cores?: Record<string, string> | null; emUso: { nome: string; projetos: number }[];
  prazo: { data: string | null; fonte: string | null; grupos: string[] } };
type Seletor = { alvo: "cp"; k: number } | { alvo: "lista"; id: string };

export default function MateriaisGrade({
  empresa, codigoProjeto, onGravado, recarregarRef, onResumo, pedidoEtapa,
}: {
  empresa: string; codigoProjeto: number; onGravado?: () => void;
  /** Números ao vivo para o painel do topo do projeto (spec B.0 v3). */
  onResumo?: (r: ResumoVivo | null) => void;
  /** "ver planejamento →" do painel do topo: abre a etapa Planejamento. */
  pedidoEtapa?: { etapa: "plan"; n: number } | null;
  /** A tela do projeto recarrega a grade por aqui (em vez de remontá-la — spec C.2). */
  recarregarRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [linhas, setLinhas] = useState<LinhaGrade[]>([vazia()]);
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  /** Exclusão pedida pelo 🗑 (07/10/26): grava sozinha depois de alguns segundos,
   *  com "Desfazer" até lá. `antes` = a grade antes de excluir. */
  const [remocao, setRemocao] = useState<{ n: number; comPc: number; antes: LinhaGrade[]; erro?: string } | null>(null);
  const remocaoRef = useRef(false);
  const [foraAberto, setForaAberto] = useState(false);
  const [original, setOriginal] = useState(0);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [equipFiltro, setEquipFiltro] = useState<string | null>(null);
  /** ?pc=N vindo de Projetos: só as linhas daquele PC (07/10/26). */
  const [filtroPcNum, setFiltroPcNum] = useState<string | null>(null);
  /** Filtros da lista (spec B.5 v3): Todos · Sem código · Sem PC · Atrasados/em risco ("Com sugestão"
   *  saiu: a coluna "Compatibilizar com o estoque" resolve isso). */
  const [filtroPc, setFiltroPc] = useState<"todas" | "sem_cod" | "sem_pc" | "risco">("todas");
  /** Rascunho não salvo encontrado neste navegador ao abrir (ms de quando foi feito). */
  const [rascunhoDe, setRascunhoDe] = useState<number | null>(null);
  const chaveRascunho = `painel.materiais.rascunho.${empresa}.${codigoProjeto}`;
  /** Conta as mudanças da grade: o salvamento automático só limpa o "não salvo"
   *  se ninguém mexeu enquanto ele gravava. */
  const versaoRef = useRef(0);
  useEffect(() => { versaoRef.current += 1; }, [linhas]);

  // ── Compras do projeto (antiga aba "Compras × lista") ────────────────────
  const [cmp, setCmp] = useState<DadosCompras | null>(null);
  const [cmpErro, setCmpErro] = useState<string | null>(null);
  const [sugestoes, setSugestoes] = useState<CasamentoPc[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const cmpPorId = useMemo(() => new Map((cmp?.itens ?? []).map((l) => [`db${l.id}`, l])), [cmp]);

  /* ── A CP no projeto (07/10/26, Benny): RC e CP são a mesma coisa — a tela só fala
     "RC". A RC é o plano: dá a ideia inicial e o budget; os itens entram na lista pelo
     "Importar para a lista" ou pelo "Usar item da RC" da linha. Origem da linha = "RC"
     (veio da RC — pelo vínculo com a RC em Compras ou pelo mesmo texto) ou "novo". */
  const [cpBase, setCpBase] = useState<{ proposta: string | null; itens: ItemCpBase[] } | null>(null);
  const normT = (t: string | null | undefined) => String(t ?? "").trim().toLowerCase();
  const cpPorChave = useMemo(() => new Set((cpBase?.itens ?? []).map((i) => chaveItem(i.equipamento, i.item))), [cpBase]);
  const cpPorTexto = useMemo(() => new Set((cpBase?.itens ?? []).flatMap((i) => [normT(i.item), normT(textoCasar(i.item, i.modelo))])), [cpBase]);
  const origemCp = useCallback((l: Record<string, string>): string | null => {
    const c = cmpPorId.get(String(l._id ?? ""));
    if (c?.rc) return `RC ${c.rc}`;
    if (!String(l.item ?? "").trim()) return null;
    if (cpPorChave.has(chaveItem(l.equipamento, l.item)) || cpPorTexto.has(normT(l.item))) return cpBase?.proposta ? `RC da proposta ${cpBase.proposta}` : "RC";
    return null;
  }, [cmpPorId, cpPorChave, cpPorTexto, cpBase]);
  /** Para cada item da CP, a linha da lista que o usa. Cada linha atende UM item da CP:
   *  primeiro o mesmo equipamento + item; depois, só pelo texto, entre as linhas que
   *  sobraram (o mesmo item em 3 equipamentos não é "usado" 3 vezes por uma linha só). */
  const usoCp = useMemo(() => {
    const m = new Map<number, LinhaGrade>();
    const itens = cpBase?.itens ?? [];
    const comItem = linhas.filter((l) => String(l.item ?? "").trim());
    const tomadas = new Set<LinhaGrade>();
    itens.forEach((i, k) => {
      const ch = chaveItem(i.equipamento, i.item);
      const l = comItem.find((x) => !tomadas.has(x) && chaveItem(x.equipamento, x.item) === ch);
      if (l) { m.set(k, l); tomadas.add(l); }
    });
    itens.forEach((i, k) => {
      if (m.has(k)) return;
      const ts = new Set([normT(i.item), normT(textoCasar(i.item, i.modelo))]);
      const l = comItem.find((x) => !tomadas.has(x) && ts.has(normT(x.item)));
      if (l) { m.set(k, l); tomadas.add(l); }
    });
    return m;
  }, [linhas, cpBase]);
  const cpNaoUsados = useMemo(() => (cpBase?.itens ?? []).map((i, k) => ({ i, k })).filter(({ k }) => !usoCp.has(k)), [cpBase, usoCp]);
  /** Linha que está escolhendo "Usar item da CP". */
  const [usarCpEm, setUsarCpEm] = useState<string | null>(null);
  const [usarCpBusca, setUsarCpBusca] = useState("");
  const carregarCompras = useCallback(async () => {
    // até 3 tentativas: o banco às vezes estoura o tempo enquanto as MVs de compras atualizam
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(`/api/rc-projetos/compras?empresa=${empresa}&codigo=${codigoProjeto}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setCmp(j as DadosCompras); setCmpErro(null);
        return j as DadosCompras;
      } catch (e) {
        setCmpErro(t < 2 ? `${(e as Error).message} — tentando de novo…` : (e as Error).message);
        if (t < 2) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return null;
  }, [empresa, codigoProjeto]);
  const postCompras = useCallback(async (corpo: Record<string, unknown>) => {
    const r = await fetch("/api/rc-projetos/compras", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, codigo: codigoProjeto, ...corpo }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  }, [empresa, codigoProjeto]);

  // ── Grupos de equipamento ───────────────────────────────────────────────
  const [gruposMeta, setGruposMeta] = useState<GruposMeta | null>(null);
  useEffect(() => {
    fetch(`/api/rc-projetos/grupos?codigo_projeto=${codigoProjeto}`, { cache: "no-store" })
      .then((x) => x.json()).then((j) => { if (!j.error) setGruposMeta(j as GruposMeta); }).catch(() => {});
  }, [codigoProjeto]);
  const nomesPadrao = useMemo(() => gruposMeta?.cadastro ?? [], [gruposMeta]);

  /** Data de cada grupo = a mais comum entre as linhas dele. */
  const dataGrupo = useMemo(() => {
    const m = new Map<string, (string | null)[]>();
    for (const l of linhas) if (String(l.item ?? "").trim()) {
      const k = normGrupo(l.equipamento || "Geral");
      m.set(k, [...(m.get(k) ?? []), l.data_necessaria || null]);
    }
    return new Map([...m.entries()].map(([k, ds]) => [k, dataDoGrupo(ds)]));
  }, [linhas]);
  const dataGrupoRef = useRef(dataGrupo);

  /** Prazo de entrega por fornecedor (spec E): histórico × manual (⏱ Prazos por fornecedor). */
  const [prazos, setPrazos] = useState<Map<string, PrazoFornecedor>>(new Map());
  const [prazosAberto, setPrazosAberto] = useState(false);
  /** Agente de compras (spec F): itens enviados por "✨ Planejar com o agente" (destaque), o
   *  lote agendado cujo PC está sendo gerado pela folha, e um contador de recargas. */
  const [forcados, setForcados] = useState<Set<string>>(new Set());
  const loteGerandoRef = useRef<string | null>(null);
  const [recargas, setRecargas] = useState(0);
  const carregarPrazos = useCallback(async () => {
    try {
      const j = await fetch(`/api/compras/fornecedor-prazo?emp=${encodeURIComponent(empresa)}`, { cache: "no-store" }).then((x) => x.json()) as
        { fornecedores?: { norm: string; nome: string; historico: number | null; manual: number | null }[] };
      setPrazos(new Map((j.fornecedores ?? []).map((f) => [f.norm, { norm: f.norm, nome: f.nome, historico: f.historico, manual: f.manual }])));
    } catch { /* sem prazos: vale o do item e os 15 dias */ }
  }, [empresa]);
  useEffect(() => { void carregarPrazos(); }, [carregarPrazos]);

  /** Sinal de entrega de cada linha: a compra chega a tempo do "Necessário em"? (07/10/26) */
  const sinais = useMemo(() => {
    const m = new Map<string, SinalEntrega | null>();
    if (!cmp) return m; // sem as compras não dá para saber se chega a tempo
    for (const l of linhas) {
      if (!String(l.item ?? "").trim()) continue;
      const c = cmpPorId.get(l._id);
      const p = c?.pcs[0];
      m.set(l._id, sinalEntrega({
        necessario: l.data_necessaria || null,
        recebidoEm: p?.dt_rec ?? null, recebido: !!p && ((Number(p.qtd_recebida) || 0) > 0 || p.etapa === "60" || p.etapa === "80"),
        temPc: !!c?.pcs.length, previsaoPc: p?.previsao ?? null,
        // sem PC: hoje + prazo EFETIVO (manual do fornecedor → item → histórico → 15d, spec E)
        prazoDias: prazoEfetivo({ prazoItem: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null, fornecedor: l.cat_fornecedor, prazos }).prazo,
      }));
    }
    return m;
  }, [linhas, cmpPorId, cmp, prazos]);
  dataGrupoRef.current = dataGrupo;

  // ── Seletor de item do catálogo (linha da CP ou da lista) ────────────────
  const [seletor, setSeletor] = useState<Seletor | null>(null);
  /** Linha sem PC com o "vincular" aberto (sugestões de vínculo + busca de PC). */
  const [vincLinha, setVincLinha] = useState<string | null>(null);
  const [vincBusca, setVincBusca] = useState<string[] | null>(null);

  // ── 💬 Comentários das linhas (sql/101; antes era a coluna Observação) ──
  type Coment = { id: number | string; autor: string; texto: string; criado_em: string; origem?: string };
  const [coments, setComents] = useState<Record<string, Coment[]>>({});
  const [comentPendente, setComentPendente] = useState(false);
  const [comentLinha, setComentLinha] = useState<string | null>(null);
  const [comentTexto, setComentTexto] = useState("");
  const [comentando, setComentando] = useState(false);
  /** Conversa da linha: a observação gravada na linha (Excel/planilha) entra como
   *  primeiro comentário enquanto não estiver na conversa. */
  const conversa = useCallback((l: Record<string, string>): Coment[] => {
    const id = String(l._id ?? "");
    const lista = id.startsWith("db") ? (coments[id.slice(2)] ?? []) : [];
    const obs = String(l.observacao ?? "").trim();
    if (obs && !lista.some((c) => c.texto.trim() === obs)) {
      return [{ id: "obs", autor: "observação da lista", texto: obs, criado_em: "", origem: "observacao" }, ...lista];
    }
    return lista;
  }, [coments]);
  const carregarComentarios = useCallback(async () => {
    const j = await fetch(`/api/rc-projetos/comentarios?empresa=${empresa}&codigo_projeto=${codigoProjeto}`, { cache: "no-store" })
      .then((x) => x.json()).catch(() => null) as { comentarios?: Record<string, Coment[]>; pendente?: boolean } | null;
    if (j?.comentarios) { setComents(j.comentarios); setComentPendente(!!j.pendente); }
  }, [empresa, codigoProjeto]);
  const comentar = useCallback(async (linhaId: string) => {
    const texto = comentTexto.trim();
    if (!texto) return;
    setComentando(true);
    try {
      const r = await fetch("/api/rc-projetos/comentarios", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, item_id: linhaId.slice(2), texto }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setComents((m) => ({ ...m, [linhaId.slice(2)]: [...(m[linhaId.slice(2)] ?? []), j.comentario as Coment] }));
      setComentTexto("");
    } catch (e) { setErro(`Não consegui gravar o comentário: ${(e as Error).message}`); }
    finally { setComentando(false); }
  }, [comentTexto, empresa, codigoProjeto]);
  const abrirSeletorLista = useCallback((id: string) => setSeletor({ alvo: "lista", id }), []);

  // ── Colunas ───────────────────────────────────────────────────────────────
  // As editáveis à esquerda; à direita, o catálogo e o bloco do PC (leitura,
  // com fundo próprio para se ver que vêm do mesmo lugar).
  const PC = "bg-sky-500/[0.05]";
  /* Aceitar / recusar sugestões de código (07/10/26, Benny). Aceitar = o código vira
     confirmado na linha e o de-para (texto → item nosso) é gravado, como a escolha à mão. */
  const [aceiteDesfazer, setAceiteDesfazer] = useState<{ n: number; antes: LinhaGrade[] } | null>(null);
  /** Por que o salvamento automático está parado (null = salva sozinho). Preenchido mais
   *  abaixo; os avisos usam para não prometer "salva sozinha" quando não salva (spec C.6). */
  const semAutosaveRef = useRef<string | null>(null);
  const fraseSalvar = () => (semAutosaveRef.current
    ? ` ⚠ Não está salvando sozinha (${semAutosaveRef.current}) — clique em Salvar lista.`
    : " A lista é salva sozinha em instantes.");
  /** Aceita, por linha, o item escolhido (spec B.6 v3: o que está selecionado no select da coluna
   *  "Compatibilizar com o estoque"; sem escolha explícita, a sugestão gravada). */
  const aceitarEscolhas = useCallback(async (pares: { id: string; c: Cat }[]) => {
    const porId = new Map(pares.map((x) => [x.id, x.c]));
    const semCod = (l: LinhaGrade) => !String(l.cat_codigo ?? "").trim() || l._match === "omie";
    const escolhidas = linhasRef.current.filter((l) => porId.has(l._id) && semCod(l));
    if (!escolhidas.length) return;
    const antes = linhasRef.current;
    setLinhas((atual) => atual.map((l) => {
      const c = porId.get(l._id);
      if (!c || (String(l.cat_codigo ?? "").trim() && l._match !== "omie")) return l;
      const temValor = !!String(l.cat_valor_unit ?? "").trim();
      return { ...l, ...camposDoCatalogo(c, "ok", [], l.cat_valor_unit ?? ""), _sug: JSON.stringify(c), _sug_status: "aceita", _omie_ncod: "", _omie: "",
        ...(temValor ? { cat_valor_unit: l.cat_valor_unit, _vu_fonte: l._vu_fonte ?? "" } : {}) };
    }));
    setSujo(true);
    setAceiteDesfazer({ n: escolhidas.length, antes });
    setAviso(`${escolhidas.length} sugestão(ões) aceita(s) — viraram código confirmado.${fraseSalvar()}`);
    // de-para: da próxima vez o mesmo texto casa sozinho. Esperado e conferido (spec C.7) —
    // antes ia em segundo plano e uma falha passava em silêncio.
    const res = await Promise.all(escolhidas.map(async (l) => {
      try {
        const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "vincular", emp: empresa, texto: textoCasar(l.item, l.modelo), ncod_prod: porId.get(l._id)!.ncod_prod }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); return String((j as { error?: string }).error ?? r.statusText); }
        return null;
      } catch (e) { return (e as Error).message; }
    }));
    const falhas = res.filter(Boolean);
    if (falhas.length) setErro(`O código foi aceito na lista, mas ${falhas.length} de-para não gravou (o mesmo texto não vai casar sozinho da próxima vez): ${falhas[0]}`);
  }, [empresa]);
  const aceitarSugestoes = useCallback((ids: string[]) => aceitarEscolhas(ids.map((id) => {
    const l = linhasRef.current.find((x) => x._id === id);
    const c = l && l._match === "sug" ? lerSug(l) : null;
    return c ? { id, c } : null;
  }).filter((x): x is { id: string; c: Cat } => !!x)), [aceitarEscolhas]);
  /** Recusar = "não é item nosso" (spec C.1 / B.6 v3): fica gravado — o casamento automático não
   *  sugere de novo para a linha e ela sai da coluna "Compatibilizar". Vale também para a linha
   *  sem nenhuma candidata. */
  const recusarSugestao = useCallback((id: string) => {
    setLinhas((atual) => atual.map((l) => {
      if (l._id !== id || (String(l.cat_codigo ?? "").trim() && l._match !== "omie")) return l;
      const omie: Record<string, string> = l._omie_ncod ? { cat_ncod_prod: l._omie_ncod, _match: "omie", _omie_ncod: "" }
        : l._match === "omie" ? {} : { _match: "sem" };
      return { ...l, _sug_status: "recusada", ...omie } as LinhaGrade;
    }));
    setSujo(true);
  }, []);
  /* 07/10/26 (redesenho pedido pelo Benny no PJ361): Código antes do Item; casado,
     o Item mostra a descrição do catálogo (o texto original fica na dica); a antiga
     coluna Catálogo virou o ícone ao lado do código; sem Modelo (o dado continua na
     linha); PC + situação + vínculo numa coluna só, com "vincular" na própria linha;
     tudo numa linha só, com reticências, e as colunas até o Item presas ao rolar. */
  const planoDaLinha = useCallback((l: Record<string, string>) => (String(l.item ?? "").trim()
    ? planejarItem({ necessario: l.data_necessaria || null, temPc: !!cmpPorId.get(l._id)?.pcs.length || !!String(l.pc_numero ?? "").trim(),
        prazoItem: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null, fornecedor: l.cat_fornecedor, prazos })
    : null), [cmpPorId, prazos]);
  const COLS: ColunaGrade[] = useMemo(() => [
    // Origem da linha: selo "RC" (veio da RC) — vazio = item novo, digitado na lista.
    { key: "_orig", label: "Orig.", w: 30, fixa: true,
      dicaCab: "Origem da linha: RC = veio da RC (composição de preço da proposta) do projeto; vazio = item novo, digitado na lista.",
      dica: (l) => origemCp(l) ?? (String(l.item ?? "").trim() ? "novo — não veio da RC" : undefined),
      render: (l) => {
        const o = origemCp(l);
        if (!o) return null;
        const c = cmpPorId.get(l._id);
        return c?.rc
          ? <a target="_blank" rel="noreferrer" href={`/erp/compras?abrir=${c.rc}&tipo=RC&emp=${empresa}`}
              className="inline-block px-0.5 rounded bg-emerald-500/20 text-[8.5px] font-bold text-emerald-700 dark:text-emerald-300 hover:text-ww-accent">RC</a>
          : <span className="inline-block px-0.5 rounded bg-emerald-500/20 text-[8.5px] font-bold text-emerald-700 dark:text-emerald-300">RC</span>;
      } },
    // Fora do colar por posição (spec D): a ordem sem cabeçalho é Código · Item · Qtd · Un ·
    // Necessário em · Valor unit.; o grupo vem da linha onde se cola (herdarNoColar) ou do cabeçalho.
    { key: "equipamento", label: "Equipamento", w: 88, fixa: true, pularNoColar: true,
      dica: (l) => l.equipamento || undefined,
      // Nome livre, mas sugere os padrões do cadastro e os já usados nos projetos.
      autocompletar: {
        buscar: async (q) => {
          const t = normGrupo(q);
          const vistos = new Set<string>();
          const out: SugestaoGrade[] = [];
          for (const n of nomesPadrao) if (normGrupo(n).includes(t) && !vistos.has(normGrupo(n))) { vistos.add(normGrupo(n)); out.push({ chave: `c${n}`, titulo: n, detalhe: "nome padrão", dados: n }); }
          for (const u of gruposMeta?.emUso ?? []) if (normGrupo(u.nome).includes(t) && !vistos.has(normGrupo(u.nome))) { vistos.add(normGrupo(u.nome)); out.push({ chave: `u${u.nome}`, titulo: u.nome, detalhe: `usado em ${u.projetos} projeto(s)`, dados: u.nome }); }
          return out.slice(0, 10);
        },
        aoEscolher: (sg) => ({ equipamento: String(sg.dados) }),
      } },
    // Código NOSSO (estoque/ALLKA), nunca o do Omie. O ícone diz a situação do
    // casamento (✓ / ⚠ conferir / ⌕ sem) e abre o seletor do catálogo.
    /* 08/10/26 (spec B.6 v3): a sugestão saiu da célula Código e foi para a coluna provisória
       "Compatibilizar com o estoque", logo à direita. Aqui fica o código confirmado ou "sem código". */
    { key: "cat_codigo", label: "Código", w: 88, fixa: true,
      limpaAoEditar: ["cat_ncod_prod", "_match", "_alts", "_cat_desc", "_sug", "_sug_status", "_omie_ncod"],
      dica: (l) => { const c = l._match === "sug" ? lerSug(l) : null; return c ? [`Sugestão do catálogo: ${c.codigo ?? ""} — ${c.descricao}`, c.fornecedor ? `fornecedor ${c.fornecedor}` : "", c.motivo ? `por quê: ${c.motivo}` : "", "✓ aceita (vira o código e ensina o de-para) · ✕ recusa (não volta a sugerir) · clique no texto para escolher outro"].filter(Boolean).join("\n") : undefined; },
      marca: (l) => (l._match === "sug" && lerSug(l)
        ? { classe: "bg-amber-500/15", etiqueta: "sugestão", dica: "Há uma sugestão de código na coluna Compatibilizar com o estoque" }
        : String(l.item ?? "").trim() && (!l.cat_ncod_prod || l._match === "omie")
        ? { classe: "bg-amber-500/15", etiqueta: l.cat_codigo ? "" : l._omie ? `Omie ${l._omie}` : "sem código",
            dica: l._omie ? `Só no Omie (${l._omie}), sem item do nosso estoque` : "Sem item do nosso estoque" } : null),
      acao: {
        rot: (l) => (l._match === "sug" ? "⚠" : l.cat_ncod_prod && l._match !== "omie" ? (l._match === "conferir" ? "⚠" : "✓") : "⌕"),
        classe: (l) => (l.cat_ncod_prod && l._match !== "omie" ? (l._match === "conferir" ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-400") : "text-amber-700 dark:text-amber-300"),
        dica: (l) => (l.cat_ncod_prod && l._match !== "omie"
          ? (l._match === "conferir" ? "Casamento incerto — clique para conferir ou trocar" : "Item do nosso estoque — clique para trocar")
          : "Escolher o item do catálogo (sugestões, busca, criar item nosso)"),
        fn: (l) => abrirSeletorLista(l._id), mostrar: (l) => !!String(l.item ?? "").trim() },
      autocompletar: {
        buscar: async (q) => {
          const r = await fetch(`/api/catalogo/projeto?op=buscar&emp=${empresa}&q=${encodeURIComponent(q)}&lim=10`);
          if (!r.ok) return [];
          const j = (await r.json()) as { itens?: Cat[] };
          return (j.itens ?? []).map(sugestao);
        },
        aoEscolher: (sg, linha) => camposDoCatalogo(sg.dados as Cat, "ok", [], linha.cat_valor_unit ?? ""),
      } },
    { key: "item",        label: "Item",        w: 224, fixa: true,
      // "RC" na célula: usar um item da RC ainda não usado nesta linha (07/10/26)
      acao: { rot: "RC", dica: "Usar item da RC nesta linha (os itens da RC que ainda não estão na lista)",
        classe: () => "text-ww-textFaint text-[8.5px] opacity-0 group-hover:opacity-70 hover:!opacity-100",
        fn: (l) => setUsarCpEm(l._id), mostrar: (l) => cpNaoUsados.length > 0 && !origemCp(l) },
      // Casado: mostra a descrição do item do catálogo; o texto original (que é a
      // chave da linha e do de-para) volta ao editar e fica na dica.
      exibir: (l) => (l.cat_ncod_prod && l._match !== "omie" && l._cat_desc ? l._cat_desc : null),
      dica: (l) => [l._cat_desc && l._cat_desc !== l.item ? `Texto original: ${l.item}` : l.item, l.modelo ? `Modelo: ${l.modelo}` : ""].filter(Boolean).join(" · ") || undefined,
      limpaAoEditar: CAT_CAMPOS,
      autocompletar: {
        buscar: async (q) => {
          const r = await fetch(`/api/catalogo/projeto?op=buscar&emp=${empresa}&q=${encodeURIComponent(q)}&lim=12`);
          if (!r.ok) return [];
          const j = (await r.json()) as { itens?: Cat[] };
          return (j.itens ?? []).map(sugestao);
        },
        aoEscolher: (sg, linha) => {
          const c = sg.dados as Cat;
          return { item: c.descricao, ...camposDoCatalogo(c, "ok", [], linha.cat_valor_unit ?? "") };
        },
        iniciais: (linha) => {
          if (linha._match !== "conferir" || !linha._alts) return [];
          try { return (JSON.parse(linha._alts) as Cat[]).map(sugestao); } catch { return []; }
        },
      } },
    { key: "qtd",         label: "Qtd",         w: 46, tipo: "num", alinhaDireita: true },
    { key: "un",          label: "Un",          w: 34 },
    { key: "data_necessaria", label: "Necessário em", w: 102, tipo: "data",
      marca: (l) => {
        const g = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral")) ?? null;
        if (!g) return null;
        if (!l.data_necessaria) return { dica: `Sem data — ao salvar, herda a do grupo (${dia(g)})` };
        if (l.data_necessaria !== g) return { classe: "bg-amber-500/10", dica: `Data própria — o grupo está em ${dia(g)}` };
        return null;
      } },
    { key: "cat_valor_unit", label: "Valor unit.", w: 84, tipo: "moeda", alinhaDireita: true,
      dicaCab: "Valor unitário estimado da linha. Vazio, vem do PC, senão do último preço do catálogo, senão do custo da RC (a origem aparece pequena na célula).",
      marca: (l) => {
        const f = l._vu_fonte;
        if (!f || !String(l.cat_valor_unit ?? "").trim()) return null;
        return { etiqueta: f === "pc" ? "PC" : f === "CP" ? "RC" : "cat.",
          dica: f === "pc" ? "Preço unitário da linha do pedido de compra" : f === "CP" ? "Custo da RC (composição de preço da proposta) — sem compra anterior" : "Último preço pago (catálogo)" };
      } },
    /* Comprar até (08/10/26, spec E): necessário em − prazo efetivo − folga. Sem PC: ✕ atrasado,
       ⚠ comprar agora (até 7 dias), ✓ em N dias. Com PC vale o sinal de entrega do PC. */
    { key: "_comprar", label: "Comprar até", w: 96,
      dicaCab: `Comprar até = necessário em − prazo do fornecedor − ${FOLGA_ENTREGA_DIAS} dias de folga. Prazo: o ajustado em ⏱ Prazos por fornecedor, senão o do item no catálogo, senão o histórico do fornecedor, senão 15 dias (estimado).`,
      dica: (l) => {
        const pl = planoDaLinha(l);
        if (!pl || !pl.comprarAte) return undefined;
        const fonte = pl.fonte === "manual" ? "ajustado para o fornecedor" : pl.fonte === "item" ? "do item (catálogo)" : pl.fonte === "historico" ? "histórico do fornecedor" : "estimado (sem fornecedor/histórico)";
        return `prazo ${pl.prazo}d — ${fonte} · folga ${FOLGA_ENTREGA_DIAS}d${pl.prazo > 60 && pl.fonte !== "manual" ? " · ⚠ prazo alto — confira em ⏱ Prazos por fornecedor" : ""}`;
      },
      render: (l) => {
        const pl = planoDaLinha(l);
        if (!pl || !pl.comprarAte || pl.status === "compc") return <span className="text-ww-textFaint">—</span>;
        const cls = pl.status === "atrasado" ? "text-rose-600 dark:text-rose-400" : pl.status === "agora" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400";
        return <span className="text-[11px] leading-tight"><b className="tabular-nums text-ww-text">{dia(pl.comprarAte)}</b><br /><small className={cls}>{pl.texto}{pl.estimado ? " · est." : ""}</small></span>;
      } },
    /* Chegada prevista (07/10/26, Benny): a data em que o item chega, ao lado do Necessário em,
       e o sinal ✓/⚠/✕ compara as duas. "PC atrasado" (previsão do PC vencida sem chegar)
       aparece aqui, na chegada — não como alarme da necessidade. */
    { key: "_cheg", label: "Chegada prev.", w: 92,
      dicaCab: "Quando o item chega: previsão do PC · data do recebimento · sem PC, ≈ hoje + prazo médio do catálogo. PC atrasado = a previsão do PC passou e nada chegou.",
      dica: (l) => sinais.get(l._id)?.motivo,
      render: (l) => {
        const sg = sinais.get(l._id);
        if (!sg) return null;
        if (sg.recebido) return <span className="text-[11px] leading-tight"><span className="text-teal-600 dark:text-teal-400">{sg.chegada ? dia(sg.chegada) : "✓"}</span><br /><small className="text-ww-textFaint">recebido</small></span>;
        if (sg.previsaoPc && sg.pcAtrasadoDias > 0) return <span className="text-[11px] leading-tight"><span className="text-rose-600 dark:text-rose-400 font-semibold">{dia(sg.previsaoPc)}</span><br /><small className="text-rose-600 dark:text-rose-400">PC atrasado {sg.pcAtrasadoDias}d</small></span>;
        if (sg.previsaoPc) return <span className="text-[11px]">{dia(sg.previsaoPc)}</span>;
        if (sg.estimada && sg.chegada) return <span className="text-[11px] italic text-ww-textMuted">≈ {dia(sg.chegada)}</span>;
        return <span className="text-[10.5px] text-ww-textFaint">{sg.estimada ? "sem prazo" : "PC sem prev."}</span>;
      } },
    { key: "_ent", label: "", w: 22,
      dicaCab: `Prazo × necessidade: ✓ chega com folga (≥ ${FOLGA_ENTREGA_DIAS} dias) · ⚠ menos de ${FOLGA_ENTREGA_DIAS} dias ou PC sem previsão · ✕ chega depois do necessário. PC atrasado conta como chegada hoje.`,
      dica: (l) => sinais.get(l._id)?.motivo,
      render: (l) => {
        const sg = sinais.get(l._id);
        if (!sg || !l.data_necessaria) return null;
        return sg.nivel === "ok" ? <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
          : sg.nivel === "risco" ? <span className="text-amber-600 dark:text-amber-300 font-bold">⚠</span>
          : <span className="text-rose-600 dark:text-rose-400 font-bold">✕</span>;
      } },
    // Projetado × Comprado (PC) × Δ — o que se esperava gastar, o que o PC custou e a diferença.
    { key: "_proj", label: "Projetado", w: 90, alinhaDireita: true,
      dicaCab: "Projetado = Qtd × Valor unit. da linha — quanto se espera gastar com este item.",
      dica: (l) => (l._vu_fonte ? `Qtd × valor unit. (${l._vu_fonte === "pc" ? "do PC" : l._vu_fonte === "CP" ? "da RC" : "do catálogo"})` : "Qtd × valor unit."),
      calculada: (l) => {
        const t = num(l.qtd) * num(l.cat_valor_unit);
        return t ? brl(t) : "";
      } },
    // ── Bloco do PC (leitura) ──
    { key: "_pc", label: "PC", w: 72, classe: `${PC} border-l border-ww-border`,
      dicaCab: "Pedido de compra desta linha — clique para abrir. Sem PC: “+ vincular”.",
      dica: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) return l.pc_numero ? `PC ${l.pc_numero} (não encontrado no Compras)` : undefined;
        const v = c.vinculo_via;
        const via = v === "rc" ? "pela RC" : v === "codigo" ? "pelo código" : v === "descricao" ? `pela descrição ${Math.round(Number(c.vinculo_score ?? 0) * 100)}%` : v === "manual" ? "manual" : "pelo nº do PC";
        return `${c.pcs.map((p) => `PC ${p.pc}${p.fornecedor ? ` — ${p.fornecedor}` : ""}`).join("\n")}\nVínculo ${via}`;
      },
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) {
          if (!l._id.startsWith("db") || !String(l.item ?? "").trim()) return null;
          if (!cmp) return l.pc_numero ? <span className="font-mono text-[11px] text-ww-textFaint" title="Carregando as compras do projeto…">{l.pc_numero}</span> : null;
          // nº de PC digitado/importado que não virou vínculo: é SUGESTÃO, com outra cara
          return l.pc_numero
            ? <button type="button" onClick={() => setVincLinha(l._id)}
                className="px-1 rounded border border-dashed border-amber-500/70 text-[10px] italic text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                title={`Sugestão: PC ${l.pc_numero} (digitado na lista, não está vinculado a nenhum pedido) — clique para vincular`}>
                sug. {l.pc_numero}
              </button>
            : <button type="button" onClick={() => setVincLinha(l._id)}
                className="text-[10.5px] text-ww-accent hover:underline" title="Ligar esta linha a um pedido de compra (sugestões ou busca)">
                + vincular
              </button>;
        }
        return (
          <span className="inline-flex items-center gap-1">
            <a target="_blank" rel="noreferrer" href={`/erp/compras?abrir=${c.pcs[0].pc}&tipo=PC&emp=${empresa}`}
              className="font-mono text-[12.5px] font-bold text-ww-text hover:text-ww-accent hover:underline" title="Abrir o pedido de compra">
              {c.pcs[0].pc}
            </a>
            {c.pcs.length > 1 && <span className="text-[10px] text-ww-textMuted">+{c.pcs.length - 1}</span>}
          </span>);
      } },
    { key: "_sit", label: "Situação ⓘ", w: 120, classe: PC,
      dicaCab: `Situação real do pedido (aprovação + etapa da compra) — as mesmas cores do Compras e do /pcs:\n${LEGENDA_SITUACAO}`,
      dica: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) return l.pc_numero ? `Sugestão: PC ${l.pc_numero} — ainda não vinculado` : undefined;
        return c.pcs.map((p) => `PC ${p.pc}: ${dicaEstadoPc(p)}`).join("\n");
      },
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) {
          if (!cmp) return l.pc_numero ? <span className="text-[10.5px] text-ww-textFaint">carregando…</span> : null;
          if (l.pc_numero && l._id.startsWith("db")) return (
            <button type="button" onClick={() => setVincLinha(l._id)} className="text-[10.5px] italic text-ww-accent hover:underline">sugestão · vincular</button>);
          return c?.rc ? <span className="text-ww-textMuted text-[10.5px]" title={`RC ${c.rc} em Compras, ainda sem PC`}>na RC</span> : null;
        }
        const st = estadoPc(c.pcs[0]);
        const pode = c.vinculo_via === "codigo" || c.vinculo_via === "descricao" || c.vinculo_via === "manual";
        return (
          <span className="inline-flex items-center gap-1 max-w-full">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white truncate" style={{ background: st.cor }}>{st.rot}</span>
            {pode && <button type="button" title="Desfazer o vínculo com o PC" className="text-[10px] text-ww-textFaint hover:text-rose-500"
              onClick={() => void desvincularRef.current?.(c.id)}>✕</button>}
          </span>);
      } },
    { key: "_forn", label: "Fornecedor", w: 104, classe: PC,
      dica: (l) => {
        const c = cmpPorId.get(l._id);
        const f = c?.pcs.map((p) => p.fornecedor).filter(Boolean).join(", ");
        const prazos = l.cat_entrega_dias || l.cat_fat_dias ? ` · entrega ~${l.cat_entrega_dias || "—"}d, fatura ${l.cat_fat_dias || "—"}d` : "";
        return f ? `${f} (do PC)` : l.cat_fornecedor ? `Sugerido pelo catálogo: ${l.cat_fornecedor}${prazos}` : undefined;
      },
      render: (l) => {
        const c = cmpPorId.get(l._id);
        const f = c?.pcs.map((p) => p.fornecedor).filter(Boolean)[0];
        if (f) return <span className="text-ww-text">{f}</span>;
        const pl = planoDaLinha(l);
        if (l.cat_fornecedor) return <span className="text-ww-textMuted italic">{l.cat_fornecedor}{pl ? <small className="not-italic text-ww-textFaint"> · {pl.prazo}d</small> : null}</span>;
        return <span className="text-ww-textFaint">— <small>(prazo estimado {pl?.prazo ?? 15}d)</small></span>;
      } },
    { key: "_comprado", label: "Comprado (PC)", w: 96, alinhaDireita: true, classe: PC,
      dicaCab: "Comprado (PC) = valor da linha deste item no pedido de compra (qtd × preço do PC, com IPI/ST e desconto).",
      dica: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c || c.valor_pc == null) return undefined;
        const vu = c.pcs.find((p) => p.valor_unit != null)?.valor_unit;
        const qPc = c.pcs.reduce((a, p) => a + (Number(p.qtd) || 0), 0);
        return [vu != null ? `${brl(vu)}/un no PC` : "", qPc ? `qtd do PC: ${qPc} · na lista: ${num(l.qtd) || "—"}` : ""].filter(Boolean).join(" · ");
      },
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c || c.valor_pc == null) return <span className="text-ww-textFaint">—</span>;
        const q = num(l.qtd);
        const qPc = c.pcs.reduce((a, p) => a + (Number(p.qtd) || 0), 0);
        const dif = qPc > 0 && q > 0 && Math.abs(qPc - q) > 1e-6;
        return <span>{dif && <span className="text-amber-600 dark:text-amber-300 mr-1 cursor-help" title={`Qtd do PC diferente da lista: ${qPc} no PC × ${q} na lista`}>≠</span>}{brl(c.valor_pc)}</span>;
      } },
    { key: "_delta", label: "Δ", w: 70, alinhaDireita: true, classe: PC,
      dicaCab: "Δ = Comprado (PC) − Projetado. Verde: comprou abaixo do projetado; vermelho: acima.",
      render: (l) => {
        const c = cmpPorId.get(l._id);
        const proj = num(l.qtd) * num(l.cat_valor_unit);
        if (!c || c.valor_pc == null || !proj) return <span className="text-ww-textFaint">—</span>;
        const d = Math.round((Number(c.valor_pc) - proj) * 100) / 100;
        if (Math.abs(d) < 0.01) return <span className="text-ww-textFaint" title="Comprado igual ao projetado">=</span>;
        return <span className={d > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
          title={`${d > 0 ? "Acima" : "Abaixo"} do projetado (${Math.round((d / proj) * 100)}%)`}>{d > 0 ? "+" : "−"}{brl(Math.abs(d)).replace("R$", "").trim()}</span>;
      } },
    // 💬 Comentários (antiga Observação) — conversa curta por linha
    { key: "_obs", label: "💬", w: 30,
      dicaCab: "Comentários da linha (antiga Observação) — quem escreveu e quando.",
      render: (l) => {
        if (!String(l.item ?? "").trim()) return null;
        const n = conversa(l).length;
        return (
          <button type="button" onClick={() => setComentLinha(l._id)} title={n ? `${n} comentário(s)` : "Comentar"}
            className={`relative text-[13px] leading-none ${n ? "" : "opacity-30 hover:opacity-80"}`}>
            💬{n > 0 && <span className="absolute -top-1.5 -right-2 min-w-[14px] px-0.5 rounded-full bg-ww-accent text-white text-[9px] font-bold leading-[14px] text-center">{n}</span>}
          </button>);
      } },
  ], [empresa, cmp, cmpPorId, nomesPadrao, gruposMeta, abrirSeletorLista, PC, conversa, sinais, origemCp, cpNaoUsados, planoDaLinha]);

  /** A leitura inicial funcionou?
   *
   *  Falso enquanto não carregou e depois de qualquer falha. Salvar com isto
   *  falso mandaria uma lista vazia por cima do que está no banco — a rota já
   *  trava, mas a tela não deve nem tentar. */
  const [carregouOk, setCarregouOk] = useState(false);
  /** Linhas (id + texto) que já passaram pelo casamento automático nesta tela. */
  const sugTentadasRef = useRef<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    // compras do projeto saem JUNTO com a lista (não depois): é a chamada mais demorada
    const pCompras = carregarCompras();
    void carregarComentarios();
    try {
      const supa = supaBrowser();
      const approval = supa.schema("approval" as never);
      // a sugestão gravada (sql/127) vem da tabela, em paralelo — sem a migração, segue sem ela
      const [itens, sugs] = await Promise.all([
        approval.from("v_rc_projetos_itens")
          .select("id, equipamento, item, qtd, modelo, observacao, pc_numero, nome_fornecedor, dt_previsao, nova_prev_materiais, mt_data_recebimento_nf, pc_etapa_texto, cat_ncod_prod, cat_codigo, cat_valor_unit, cat_fornecedor, cat_entrega_dias, cat_fat_dias, un, data_necessaria")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto)
          .order("equipamento", { ascending: true }).order("item", { ascending: true }),
        approval.from("rc_projetos_itens")
          .select("id, sug_ncod_prod, sug_codigo, sug_descricao, sug_fornecedor, sug_score, sug_status")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto).not("sug_status", "is", null),
      ]);
      const sugPorId = new Map(((sugs.error ? [] : sugs.data ?? []) as SugRow[]).map((x) => [x.id, x]));
      // Sem marcar a carga como OK, a tela fica indistinguível de "projeto
      // vazio" — e foi assim que salvar por cima apagou lista alheia.
      if (itens.error) { setErro(itens.error.message); setCarregouOk(false); return; }
      const rows = (itens.data ?? []) as ItemRow[];
      setOriginal(rows.length);
      /* Recarregar não apaga o que só vive na tela (spec C.2): por _id, a sugestão ainda não
         gravada e as alternativas do casamento ficam; a seleção também. */
      const antes = new Map(linhasRef.current.map((l) => [l._id, l]));
      setLinhas([
        ...rows.map((r) => {
          const id = `db${r.id}`;
          const temCod = !!String(r.cat_codigo ?? "").trim();
          const gravada = sugDaLinhaGravada(sugPorId.get(r.id), temCod);
          const prev = antes.get(id);
          const manter: Record<string, string> = {};
          if (prev && !gravada._match && !temCod && prev._match === "sug" && prev._sug && prev.item === (r.item ?? "")) {
            Object.assign(manter, { _match: "sug", _sug: prev._sug, _sug_status: "pendente", _omie_ncod: prev._omie_ncod ?? "" });
          }
          if (prev?._alts && !temCod) manter._alts = prev._alts;
          if (prev?._k) manter._k = prev._k;
          const omiePend = gravada._match === "sug" && r.cat_ncod_prod ? { _omie_ncod: s(r.cat_ncod_prod), cat_ncod_prod: "" } : {};
          return ({
          _id: `db${r.id}`,
          equipamento: r.equipamento ?? "",
          item: r.item ?? "",
          qtd: r.qtd == null ? "" : String(r.qtd),
          un: r.un ?? "",
          data_necessaria: r.data_necessaria ? String(r.data_necessaria).slice(0, 10) : "",
          modelo: r.modelo ?? "",
          pc_numero: r.pc_numero ?? "",
          observacao: r.observacao ?? "",
          // Campos de leitura viajam junto na linha, prefixados com _ para não
          // serem confundidos com o que vai pro banco no salvar.
          _fornecedor: deHtml(r.nome_fornecedor ?? ""),
          _prev_efetiva: r.nova_prev_materiais ?? r.dt_previsao ?? "",
          cat_ncod_prod: s(r.cat_ncod_prod), cat_codigo: s(r.cat_codigo),
          cat_valor_unit: moeda(r.cat_valor_unit), cat_fornecedor: deHtml(s(r.cat_fornecedor)),
          cat_entrega_dias: s(r.cat_entrega_dias), cat_fat_dias: s(r.cat_fat_dias),
          _match: r.cat_ncod_prod ? "ok" : "", _alts: "", _vu_fonte: "",
          ...gravada, ...omiePend, ...manter,
        }); }) as LinhaGrade[],
        vazia(),
      ]);
      const idsNovos = new Set(rows.map((r) => `db${r.id}`));
      setRecargas((n) => n + 1);
      setSujo(false); setErro(null); setMarcadas((m) => new Set([...m].filter((x) => idsNovos.has(x)))); setCarregouOk(true);
      /* Lista colada e não salva sumia no primeiro recarregar — "Atualizar
         versão", F5, fechar a aba. Aconteceu mais de uma vez (PJ359, PJ362–364,
         set/2026): o banco nunca recebeu essas listas. Agora o que não foi
         salvo fica guardado neste navegador e volta aqui, à vista. */
      let comRascunho = false;
      try {
        const bruto = window.localStorage.getItem(`painel.materiais.rascunho.${empresa}.${codigoProjeto}`);
        if (bruto) {
          const r = JSON.parse(bruto) as { em: number; linhas: LinhaGrade[] };
          if (Array.isArray(r.linhas) && r.linhas.some((l) => String(l.item ?? "").trim())) {
            setLinhas(r.linhas);
            setSujo(true);
            setRascunhoDe(r.em);
            comRascunho = true;
          }
        }
      } catch { /* storage bloqueado: segue sem rascunho */ }
      if (!comRascunho) void enriquecerRef.current?.(rows, pCompras);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCarregouOk(false);
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto, carregarCompras, carregarComentarios]);

  /* Depois de carregar (07/10/26): traz as compras do projeto e completa as linhas
     que chegaram "vazias" — código do Omie que já tem item nosso vira o item
     nosso (código novo); valor unit. vazio vem do PC, senão do último preço do
     catálogo, senão do custo da RC (a estimativa da própria lista). O que muda
     é salvo sozinho, como qualquer edição. */
  const enriquecer = useCallback(async (rows: ItemRow[], pCompras?: Promise<DadosCompras | null>) => {
    const [dados, resolv, cpRes] = await Promise.all([
      pCompras ?? carregarCompras(),
      (async () => {
        const ids = [...new Set(rows.map((r) => Number(r.cat_ncod_prod)).filter((x) => x > 0))];
        if (!ids.length) return {} as Record<string, Cat>;
        const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "resolver", emp: empresa, ids }) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        return r?.itens ? (r.itens as Record<string, Cat>) : null; // null = não deu para saber (não mexe em nada)
      })(),
      // a CP da proposta (sem casar): estimativa de reserva, origem "CP" das linhas e a aba Itens da CP
      fetch(`/api/rc-projetos/itens-cp?codigo_projeto=${codigoProjeto}&sem_casar=1`).then((x) => x.json()).catch(() => ({})),
    ]);
    { const cr = cpRes as { proposta?: string | null; itens?: ItemCpBase[] }; setCpBase({ proposta: cr.proposta ?? null, itens: cr.itens ?? [] }); }
    const custoCp = new Map<string, number>();
    for (const i of ((cpRes as { itens?: { equipamento: string; item: string; custo_cp: number | null }[] }).itens ?? [])) {
      if (i.custo_cp != null) custoCp.set(chaveItem(i.equipamento, i.item), Number(i.custo_cp));
    }
    const porId = new Map((dados?.itens ?? []).map((l) => [`db${l.id}`, l]));
    /* 07/10/26 (PJ366 continuava com MAN7MLA no banco): o "mudou" era contado dentro do
       atualizador do setLinhas, que o React roda depois — a checagem logo abaixo via 0 e a
       lista nunca era marcada para salvar. Agora o aviso e o "salvar" saem de dentro dele. */
    setLinhas((atual) => { let mudou = 0; const res = atual.map((l) => {
      if (!l._id.startsWith("db") || !String(l.item ?? "").trim()) return l;
      const novo: LinhaGrade = { ...l };
      // código do Omie → item nosso
      const nat = l.cat_ncod_prod && resolv ? resolv[l.cat_ncod_prod] : undefined;
      if (nat) novo._cat_desc = nat.descricao;
      // produto só do Omie, sem item nosso: o código do Omie sai da coluna Código (fica de dica) e a linha pede o seletor
      if (l.cat_ncod_prod && resolv && !nat && l._match !== "omie") {
        novo._omie = l.cat_codigo ?? ""; novo.cat_codigo = ""; novo._match = "omie";
        if (l.cat_codigo) mudou++;
      }
      if (nat && (String(nat.ncod_prod) !== l.cat_ncod_prod || (nat.codigo ?? "") !== l.cat_codigo)) {
        novo.cat_ncod_prod = String(nat.ncod_prod); novo.cat_codigo = nat.codigo ?? "";
        if (!novo.cat_fornecedor && nat.fornecedor) novo.cat_fornecedor = nat.fornecedor;
        if (!novo.cat_entrega_dias && nat.entrega_dias != null) novo.cat_entrega_dias = String(nat.entrega_dias);
        if (!novo.cat_fat_dias && nat.fat_dias != null) novo.cat_fat_dias = String(nat.fat_dias);
        mudou++;
      }
      // valor unit.: do PC → do catálogo → da CP
      const pcVu = porId.get(l._id)?.pcs.find((p) => p.valor_unit != null)?.valor_unit;
      if (!String(l.cat_valor_unit ?? "").trim()) {
        if (pcVu != null) { novo.cat_valor_unit = moeda(pcVu); novo._vu_fonte = "pc"; mudou++; }
        else if (nat?.ultimo_preco != null) { novo.cat_valor_unit = moeda(nat.ultimo_preco); novo._vu_fonte = "catálogo"; mudou++; }
        else if (custoCp.has(chaveItem(l.equipamento, l.item))) { novo.cat_valor_unit = moeda(custoCp.get(chaveItem(l.equipamento, l.item))); novo._vu_fonte = "CP"; mudou++; }
      } else if (pcVu != null && Math.abs(num(l.cat_valor_unit) - pcVu) < 0.005) novo._vu_fonte = "pc";
      return novo;
    });
    if (mudou) queueMicrotask(() => {
      setSujo(true);
      setAviso(`${mudou} ajuste(s) automático(s) na lista: código do Omie trocado pelo item nosso e/ou valor unit. vazio preenchido (do PC, do catálogo ou da RC).${fraseSalvar()}`);
    });
    return res; });
  }, [empresa, codigoProjeto, carregarCompras]);
  const enriquecerRef = useRef<typeof enriquecer | null>(null);
  enriquecerRef.current = enriquecer;

  useEffect(() => { void carregar(); }, [carregar]);
  // a tela do projeto recarrega por aqui (upload de planilha) — sem remontar a grade
  useEffect(() => {
    if (!recarregarRef) return;
    recarregarRef.current = () => { void carregar(); };
    return () => { recarregarRef.current = null; };
  }, [recarregarRef, carregar]);

  // Guarda o que não foi salvo, a cada mudança.
  useEffect(() => {
    if (!sujo) return;
    try {
      window.localStorage.setItem(chaveRascunho, JSON.stringify({ em: Date.now(), linhas }));
    } catch { /* cota cheia ou storage bloqueado */ }
  }, [sujo, linhas, chaveRascunho]);

  // Sair, recarregar ou clicar "Atualizar versão" com lista não salva: o
  // navegador pergunta antes.
  useEffect(() => {
    if (!sujo) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sujo]);

  const descartarRascunho = useCallback(() => {
    try { window.localStorage.removeItem(chaveRascunho); } catch { /* */ }
    setRascunhoDe(null);
    void carregar();
  }, [chaveRascunho, carregar]);

  const validas = useMemo(() => linhas.filter((l) => String(l.item ?? "").trim()), [linhas]);
  const comPc = validas.filter((l) => String(l.pc_numero ?? "").trim()).length;
  const temPc = useCallback((l: LinhaGrade) => !!cmpPorId.get(l._id)?.pcs.length || !!String(l.pc_numero ?? "").trim(), [cmpPorId]);
  /** Planejamento por item (spec E): comprar até e status, recalculado a cada edição. */
  const planos = useMemo(() => {
    const m = new Map<string, PlanoItem>();
    for (const l of validas) m.set(l._id, planejarItem({ necessario: l.data_necessaria || null, temPc: temPc(l),
      prazoItem: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null, fornecedor: l.cat_fornecedor, prazos }));
    return m;
  }, [validas, temPc, prazos]);
  const itensPlano: ItemPlano[] = useMemo(() => validas.map((l) => ({
    id: l._id, item: l._cat_desc || l.item, qtd: num(l.qtd), un: l.un || "", vu: num(l.cat_valor_unit),
    fornecedor: l.cat_fornecedor || null, necessario: l.data_necessaria || null, temPc: temPc(l),
    pcAtrasa: sinais.get(l._id)?.nivel === "atrasado" && temPc(l), plano: planos.get(l._id)!,
  })), [validas, temPc, planos, sinais]);
  const resumoP = useMemo(() => resumoPlano(itensPlano), [itensPlano]);

  /** Em risco / atrasados: chegada apertada ou atrasada, PC atrasado, ou (sem PC) já devia
   *  ter comprado / comprar nos próximos 7 dias (spec E). */
  const emRisco = useCallback((l: LinhaGrade) => {
    const sg = sinais.get(l._id);
    if (sg && (sg.nivel === "risco" || sg.nivel === "atrasado" || sg.pcAtrasadoDias > 0)) return true;
    const pl = planoDaLinha(l);
    return !!pl && (pl.status === "atrasado" || pl.status === "agora");
  }, [sinais, planoDaLinha]);
  const visiveis = useMemo(() => {
    const vis = linhas.filter((l) => {
      if (!l.item?.trim()) return true; // a linha em branco do fim fica sempre
      if (equipFiltro && normGrupo(l.equipamento || "Geral") !== equipFiltro) return false;
      if (filtroPc === "sem_pc" && temPc(l)) return false;
      if (filtroPcNum && !cmpPorId.get(l._id)?.pcs.some((p) => p.pc === filtroPcNum)) return false;
      if (filtroPc === "risco" && !emRisco(l)) return false;
      if (filtroPc === "sem_cod" && !semCodigoNosso(l)) return false;
      return true;
    });
    /* Agrupadas por equipamento (spec B.3: a data do grupo fica no cabeçalho do grupo, na
       própria grade). Ordem dos grupos = a da 1ª aparição; dentro do grupo, a ordem de sempre;
       a linha em branco fica no fim. */
    const ordem = new Map<string, number>();
    for (const l of vis) if (l.item?.trim()) { const k = normGrupo(l.equipamento || "Geral"); if (!ordem.has(k)) ordem.set(k, ordem.size); }
    const pos = (l: LinhaGrade) => (l.item?.trim() ? ordem.get(normGrupo(l.equipamento || "Geral"))! : Number.MAX_SAFE_INTEGER);
    return vis.map((l, i) => ({ l, i })).sort((a, b) => pos(a.l) - pos(b.l) || a.i - b.i).map((x) => x.l);
  }, [linhas, equipFiltro, filtroPc, temPc, emRisco, filtroPcNum, cmpPorId]);

  const salvar = useCallback(async (confirmarRemocao = false, silencioso = false) => {
    const versaoInicio = versaoRef.current;
    if (!carregouOk) {
      setErro("A lista não chegou a carregar. Recarregue a página antes de salvar — "
            + "gravar agora apagaria o que está no projeto.");
      return;
    }
    const intencional = remocaoRef.current;
    if (validas.length < original && !intencional) {
      if (silencioso) return; // remoção que não veio do 🗑 não é automática: pede o botão Salvar
      const ok = window.confirm(
        `A lista tem ${original} item(ns) gravado(s) e você está salvando ${validas.length}.\n\n` +
        `${original - validas.length} item(ns) serão REMOVIDOS do projeto. Confirma?`);
      if (!ok) return;
    }
    setSalvando(true); setErro(null); if (!silencioso) setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          confirmar_remocao: confirmarRemocao || intencional,
          esvaziar: intencional && validas.length === 0,
          items: validas.map((l) => {
            const sg = lerSug(l);
            const st = l._match === "sug" && sg ? "pendente" : (l._sug_status === "aceita" || l._sug_status === "recusada" ? l._sug_status : null);
            return {
            // linha já gravada vai POR ID (spec C.9); a nova leva a ref para voltar com o id (C.5)
            ...(l._id.startsWith("db") ? { id: l._id.slice(2) } : { ref: l._id }),
            equipamento: String(l.equipamento ?? "").trim() || "Geral",
            item: String(l.item ?? "").trim(),
            qtd: l.qtd?.trim() ? num(l.qtd) : null,
            un: String(l.un ?? "").trim() || null,
            data_necessaria: /^\d{4}-\d{2}-\d{2}$/.test(String(l.data_necessaria ?? "")) ? l.data_necessaria : null,
            modelo: String(l.modelo ?? "").trim() || null,
            observacao: String(l.observacao ?? "").trim() || null,
            pc_numero: String(l.pc_numero ?? "").trim() || null,
            cat_ncod_prod: l.cat_ncod_prod ? Number(l.cat_ncod_prod) : l._omie_ncod ? Number(l._omie_ncod) : null,
            cat_codigo: l.cat_codigo || null,
            cat_valor_unit: String(l.cat_valor_unit ?? "").trim() ? num(l.cat_valor_unit) : null,
            cat_fornecedor: l.cat_fornecedor || null,
            cat_entrega_dias: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null,
            cat_fat_dias: l.cat_fat_dias ? Number(l.cat_fat_dias) : null,
            sug_status: st,
            sug_ncod_prod: st && sg ? sg.ncod_prod : null, sug_codigo: st && sg ? sg.codigo ?? null : null,
            sug_descricao: st && sg ? sg.descricao ?? null : null, sug_fornecedor: st && sg ? sg.fornecedor ?? null : null,
            sug_score: st && sg && sg.score != null ? sg.score : null,
          }; }),
        }),
      });
      const j = await r.json();
      // 409 = a rota recusou uma remoção em massa. Mostra o tamanho do estrago
      // em número, não em "tem certeza?" — a pergunta genérica é a que se
      // responde no automático.
      if (r.status === 409 && j.error === "remocao_em_massa") {
        if (window.confirm(`${j.mensagem}\n\nGravar assim mesmo?`)) {
          await salvarRef.current?.(true);
        }
        return;
      }
      if (!r.ok) {
        setErro(j.error ?? r.statusText);
        // exclusão pelo 🗑 que não gravou: o aviso fica com Desfazer e Tentar de novo
        if (intencional) setRemocao((x) => (x ? { ...x, erro: String(j.error ?? r.statusText) } : x));
        return;
      }
      /* A linha nova ganha o id do banco na hora (spec C.5): PC, situação, marcar e
         comentar funcionam sem F5. `_k` segura a chave do React (a linha não remonta). */
      const refs = (j.refs ?? {}) as Record<string, string>;
      if (Object.keys(refs).length) {
        setLinhas((ls) => ls.map((l) => (refs[l._id] ? { ...l, _id: `db${refs[l._id]}`, _k: l._k || l._id } : l)));
        setMarcadas((m) => new Set([...m].map((x) => (refs[x] ? `db${refs[x]}` : x))));
      }
      if (silencioso) {
        // Gravado sem recarregar a grade (quem está digitando não perde o foco).
        try { window.localStorage.removeItem(`painel.materiais.rascunho.${empresa}.${codigoProjeto}`); } catch { /* */ }
        setRascunhoDe(null);
        setOriginal(validas.length);
        if (versaoRef.current === versaoInicio) setSujo(false);
        if (intencional) {
          remocaoRef.current = false; setRemocao(null);
          const rem = Number(j.total_deletados ?? 0);
          setAviso(`${rem} linha(s) excluída(s) — recuperável em "Itens removidos". Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
          void carregarCompras();
          return;
        }
        setAviso(`Salvo automaticamente às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
        void carregarCompras();
        return;
      }
      remocaoRef.current = false; setRemocao(null);
      const removidos = Number(j.total_deletados ?? 0);
      setAviso(`${validas.length} item(ns) gravado(s)${comPc ? `, ${comPc} com PC vinculado` : ""}`
        + (removidos > 0 ? ` · ${removidos} removido(s), recuperável em "Itens removidos"` : "") + ".");
      try { window.localStorage.removeItem(`painel.materiais.rascunho.${empresa}.${codigoProjeto}`); } catch { /* */ }
      setRascunhoDe(null);
      await carregar();
      onGravado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, validas, original, comPc, carregar, carregarCompras, onGravado, carregouOk]);

  /** Ref para o salvar poder rechamar a si mesmo depois da confirmação, sem
   *  entrar na lista de dependências do próprio useCallback. */
  const salvarRef = useRef<((c?: boolean, silencioso?: boolean) => Promise<void>) | null>(null);
  salvarRef.current = salvar;

  /* Salvamento automático (06/10/26): 2,5 s depois da última mudança a lista
     vai para o banco sozinha — lista nunca mais se perde. Só não salva sozinho
     quando há item a REMOVER (isso pede o botão Salvar, com a confirmação). */
  /** Por que não está salvando sozinha (spec C.6) — aparece como chip com o botão Salvar. */
  const semAutosave = useMemo(() => {
    if (!carregouOk) return "a lista não carregou";
    if (rascunhoDe) return "lista recuperada deste navegador — confira";
    if (remocao?.erro) return "a exclusão não gravou";
    const intencional = remocao != null && remocaoRef.current;
    if (!intencional && validas.length < original) return `${original - validas.length} linha(s) a menos que no banco — confirme`;
    if (!intencional && !validas.length) return "lista vazia";
    return null;
  }, [carregouOk, rascunhoDe, remocao, validas.length, original]);
  semAutosaveRef.current = semAutosave;
  useEffect(() => {
    if (!sujo || !carregouOk || salvando || rascunhoDe) return;
    const intencional = remocao != null && remocaoRef.current;
    if (remocao?.erro) return;   // falhou: espera o "Tentar de novo" ou o "Desfazer"
    if (!intencional && (validas.length < original || !validas.length)) return;
    const t = window.setTimeout(() => { void salvarRef.current?.(false, true); }, intencional ? 6000 : 2500);
    return () => window.clearTimeout(t);
  }, [linhas, sujo, carregouOk, salvando, validas.length, original, rascunhoDe, remocao]);

  /** 🗑 da linha e "Excluir N linhas" (07/10/26): tira da grade e grava sozinho em 6 s;
   *  até lá dá para desfazer. O que sai vai para a lixeira (Itens removidos). */
  const excluirLinhas = useCallback((ids: string[]) => {
    const alvo = new Set(ids);
    const sai = linhas.filter((l) => alvo.has(l._id) && String(l.item ?? "").trim());
    const resto = linhas.filter((l) => !alvo.has(l._id));
    if (!resto.some((l) => !String(l.item ?? "").trim())) resto.push(vazia());
    setLinhas(resto);
    setMarcadas((p) => { const n = new Set(p); for (const id of ids) n.delete(id); return n; });
    if (!sai.length) return;
    const gravadas = sai.filter((l) => l._id.startsWith("db")).length;
    setSujo(true);
    if (gravadas) {
      remocaoRef.current = true;
      setRemocao((r) => ({ n: (r?.n ?? 0) + sai.length, comPc: (r?.comPc ?? 0) + sai.filter((l) => !!cmpPorId.get(l._id)?.pcs.length || !!String(l.pc_numero ?? "").trim()).length,
        antes: r?.antes ?? linhas }));
    }
  }, [linhas, cmpPorId]);
  const desfazerExclusao = useCallback(() => {
    if (!remocao) return;
    remocaoRef.current = false;
    setLinhas(remocao.antes);
    setRemocao(null);
    setAviso("Exclusão desfeita.");
  }, [remocao]);

  // ── Catálogo ────────────────────────────────────────────────────────────
  const [casando, setCasando] = useState(false);

  /* Sugestão automática (spec C.4, 08/10/26): roda sempre que aparece linha sem código
     ainda não tentada (chave derivada dos ids + textos — não é mais "uma vez por carga"),
     e uma falha da API vira aviso com "tentar de novo" em vez de sumir em silêncio. O
     resultado entra POR ID, só nas linhas que continuam sem código (spec C.3). */
  const [sugErro, setSugErro] = useState<string | null>(null);
  const [sugTentativa, setSugTentativa] = useState(0);
  const [sugBuscando, setSugBuscando] = useState(false);
  const alvoAuto = useMemo(() => linhas.filter((l) => elegivelSug(l) && l._match !== "sem" && !l._omie_ncod
    && !sugTentadasRef.current.has(`${l._id}|${textoCasar(l.item, l.modelo)}`)), [linhas]);
  const chaveAuto = alvoAuto.map((l) => `${l._id}|${textoCasar(l.item, l.modelo)}`).join("\n");
  useEffect(() => {
    if (!carregouOk || carregando || !chaveAuto) return;
    let vivo = true;
    const t = window.setTimeout(async () => {
      const alvo = linhasRef.current.filter((l) => elegivelSug(l) && l._match !== "sem" && !l._omie_ncod
        && !sugTentadasRef.current.has(`${l._id}|${textoCasar(l.item, l.modelo)}`));
      if (!alvo.length) return;
      const textos = alvo.map((l) => textoCasar(l.item, l.modelo));
      setSugBuscando(true);
      try {
        const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "casar", emp: empresa, textos, custos: alvo.map(() => null) }) });
        const j = (await r.json().catch(() => ({}))) as { casamentos?: Casamento[]; error?: string };
        if (!r.ok || !j.casamentos) throw new Error(j.error ?? `${r.status} ${r.statusText}`);
        if (!vivo) return;
        alvo.forEach((l, k) => sugTentadasRef.current.add(`${l._id}|${textos[k]}`));
        const porId = new Map<string, { txt: string; c: Casamento | undefined }>();
        alvo.forEach((l, k) => porId.set(l._id, { txt: textos[k], c: j.casamentos![k] }));
        let n = 0;
        setLinhas((atual) => atual.map((l) => {
          const x = porId.get(l._id);
          if (!x || !elegivelSug(l) || textoCasar(l.item, l.modelo) !== x.txt) return l;
          const c = x.c;
          if (c?.melhor && (c.status === "ok" || (c.melhor.score ?? 0) >= SUG_MIN)) { n++; return { ...l, ...camposSugestao(c.melhor, c.alternativas ?? [], l) }; }
          if (c?.alternativas?.length) return { ...l, _alts: JSON.stringify(c.alternativas) };
          return l;
        }));
        setSugErro(null);
        // a sugestão é gravada (sql/127): marca para o salvamento automático
        queueMicrotask(() => { if (n) setSujo(true); });
      } catch (e) {
        if (vivo) setSugErro((e as Error).message || "falha na busca");
      } finally { if (vivo) setSugBuscando(false); }
    }, 700);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [carregouOk, carregando, chaveAuto, empresa, sugTentativa]);

  /** Casa com o catálogo (itens NOSSOS) as linhas com texto e sem código nosso. Aceita
   *  sozinho só o que é de-para gravado ou muito parecido; o resto vira SUGESTÃO.
   *  Devolve as mudanças POR ID (spec C.3) — quem chama aplica com aplicarCasamento,
   *  nunca trocando a lista inteira por uma cópia antiga. Recusadas ficam de fora. */
  const casarLinhas = useCallback(async (entrada: LinhaGrade[]) => {
    const res = new Map<string, { txt: string; patch: Record<string, string> }>();
    const invalidos: string[] = [];
    // 1º o código digitado/colado: código nosso (ou antigo/de compra já ligado a um item nosso) resolve direto
    // (spec D: colado só com o código, sem descrição, também resolve — a descrição vem do catálogo)
    const comCodigo = entrada.filter((l) => !l.cat_ncod_prod && String(l.cat_codigo ?? "").trim() && l._match !== "omie");
    if (comCodigo.length) {
      const achados = await Promise.all(comCodigo.map(async (l) => {
        const cod = String(l.cat_codigo).trim().toUpperCase();
        const j = await fetch(`/api/catalogo/projeto?op=buscar&emp=${empresa}&q=${encodeURIComponent(cod)}&lim=5`).then((x) => x.json()).catch(() => ({})) as { itens?: Cat[] };
        const its = j.itens ?? [];
        return its.find((c) => String(c.codigo ?? "").toUpperCase() === cod)
          ?? its.find((c) => String(c.via ?? "").toUpperCase().split(/\s+/).includes(cod)) ?? null;
      }));
      comCodigo.forEach((l, k) => {
        const c = achados[k];
        const txt = textoCasar(l.item, l.modelo);
        if (c) {
          const temValor = !!String(l.cat_valor_unit ?? "").trim();
          res.set(l._id, { txt, patch: { ...camposDoCatalogo(c, "ok", [], l.cat_valor_unit ?? ""), _sug_status: "", _omie_ncod: "",
            ...(String(l.item ?? "").trim() ? {} : { item: c.descricao }), ...(temValor ? { cat_valor_unit: l.cat_valor_unit, _vu_fonte: l._vu_fonte ?? "" } : {}) } });
        } else if (String(l.item ?? "").trim()) {
          // código que não é nosso: a linha entra sem código (e passa pelo casamento pelo texto)
          invalidos.push(String(l.cat_codigo).trim());
          res.set(l._id, { txt, patch: { cat_codigo: "", _cod_colado: String(l.cat_codigo).trim() } });
        } else invalidos.push(String(l.cat_codigo).trim());
      });
    }
    const porCod = res.size;
    const alvo = entrada.filter((l) => (!res.has(l._id) || res.get(l._id)!.patch._cod_colado) && String(l.item ?? "").trim()
      && (semCodigoNosso(l) || !!res.get(l._id)?.patch._cod_colado) && l._sug_status !== "recusada" && l._match !== "sug");
    let ok = 0, conf = 0, sem = 0;
    if (alvo.length) {
      const r = await fetch("/api/catalogo/projeto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "casar", emp: empresa, textos: alvo.map((l) => textoCasar(l.item, l.modelo)),
          custos: alvo.map((l) => (String(l.cat_valor_unit ?? "").trim() ? num(l.cat_valor_unit) : null)) }),
      });
      const j = (await r.json()) as { casamentos?: Casamento[]; error?: string };
      if (!r.ok || !j.casamentos) throw new Error(j.error ?? r.statusText);
      alvo.forEach((l, k) => {
        const c = j.casamentos![k];
        const txt = textoCasar(l.item, l.modelo);
        sugTentadasRef.current.add(`${l._id}|${txt}`);
        const put = (patch: Record<string, string>) => res.set(l._id, { txt, patch: { ...(res.get(l._id)?.patch ?? {}), ...patch } });
        if (!c?.melhor) { put(l._match === "omie" ? {} : { _match: "sem" }); sem++; return; }
        if (c.status === "ok") { put({ ...camposDoCatalogo(c.melhor, "ok", [], l.cat_valor_unit ?? ""), _sug_status: "", _omie_ncod: "" }); ok++; return; }
        if ((c.melhor.score ?? 0) >= SUG_MIN) { put(camposSugestao(c.melhor, c.alternativas, l)); conf++; return; }
        put({ ...(l._match === "omie" ? {} : { _match: "sem" }), _alts: c.alternativas?.length ? JSON.stringify(c.alternativas) : "" }); sem++;
      });
    }
    const vazio = !comCodigo.length && !alvo.length;
    if (!vazio) setAviso(`Catálogo: ${porCod - invalidos.length > 0 ? `${porCod - invalidos.length} pelo código digitado · ` : ""}${ok} item(ns) casado(s)`
      + (invalidos.length ? ` · ${invalidos.length} código(s) que não são do nosso estoque (${invalidos.slice(0, 5).join(", ")}${invalidos.length > 5 ? "…" : ""}) — a linha entra sem código` : "")
      + (conf ? ` · ${conf} com SUGESTÃO (na coluna âmbar "Compatibilizar com o estoque" — ✓ aceita, ✕ não é item nosso, ou "✓ aceitar as melhores")` : "")
      + (sem ? ` · ${sem} sem correspondência (na coluna "Compatibilizar com o estoque": ⌕ buscar ou ＋ criar o item nosso)` : "") + "." + fraseSalvar());
    return { res, vazio };
  }, [empresa]);
  /** Aplica o resultado do casamento por id, só se o texto da linha não mudou no meio. */
  const aplicarCasamento = useCallback((res: Map<string, { txt: string; patch: Record<string, string> }>) => {
    if (!res.size) return;
    setLinhas((ls) => ls.map((l) => {
      const x = res.get(l._id);
      if (!x || textoCasar(l.item, l.modelo) !== x.txt) return l;
      return { ...l, ...x.patch } as LinhaGrade;
    }));
    setSujo(true);
  }, []);

  /** "Usar item da CP" (07/10/26): a linha recebe o item da CP (texto, qtd, equipamento,
   *  custo da CP se não houver valor) e passa pelo catálogo — ✓ sozinho ou fica para o ⌕. */
  const usarItemCp = useCallback(async (rowId: string, k: number) => {
    const it = cpBase?.itens[k];
    if (!it) return;
    setUsarCpEm(null);
    const l = linhasRef.current.find((x) => x._id === rowId);
    if (!l) return;
    const eq = it.equipamento || l.equipamento || "Geral";
    const temValor = !!String(l.cat_valor_unit ?? "").trim();
    const nova = { ...l, item: it.item, modelo: it.modelo ?? l.modelo ?? "", equipamento: eq,
      qtd: it.qtd != null ? String(it.qtd) : l.qtd,
      cat_ncod_prod: "", cat_codigo: "", _match: "", _alts: "", _cat_desc: "", _omie: "", _sug: "", _sug_status: "", _omie_ncod: "",
      cat_valor_unit: temValor ? l.cat_valor_unit : (it.custo_cp != null ? moeda(it.custo_cp) : ""),
      _vu_fonte: temValor ? (l._vu_fonte ?? "") : (it.custo_cp != null ? "CP" : ""),
      data_necessaria: l.data_necessaria || (dataGrupoRef.current.get(normGrupo(eq)) ?? "") } as LinhaGrade;
    setLinhas((ls) => {
      const out = ls.map((x) => (x._id === rowId ? nova : x));
      if (ls[ls.length - 1]?._id === rowId) out.push(vazia());
      return out;
    });
    setSujo(true);
    try { aplicarCasamento((await casarLinhas([nova])).res); }
    catch { /* fica sem código: resolve no ⌕ */ }
  }, [cpBase, casarLinhas, aplicarCasamento]);

  // ── Aba "Itens da CP" ───────────────────────────────────────────────────
  // A CP (composição de preço da proposta no CRM) fica SEPARADA da lista: é
  // referência, não compromisso. Quem monta escolhe o que entra — "meio
  // caminho andado" sem colocar na lista o que não vai ser comprado.
  type ItemCp = { equipamento: string; item: string; qtd: number | null; modelo: string | null;
                  custo_cp: number | null; casamento: Casamento };
  /** Etapas (08/10/26, spec B.1): ① Itens da RC · ② Lista de materiais · ③ Planejamento.
   *  Abre em ② quando a lista já tem itens; senão em ① (de onde a lista nasce). */
  const [subAba, setSubAba] = useState<"rc" | "lista" | "plan">("lista");
  const etapaInicialFeita = useRef(false);
  /** "⤵ Importar para a lista" (07/10/26): itens da CP com o casamento automático. */
  const [importarAberto, setImportarAberto] = useState(false);
  const [cp, setCp] = useState<{ proposta: string | null; itens: ItemCp[] } | null>(null);
  const [cpMarcados, setCpMarcados] = useState<Set<number>>(new Set());
  const [cpCarregando, setCpCarregando] = useState(false);
  const [cpErro, setCpErro] = useState<string | null>(null);
  /** Itens da RC a marcar quando o modal de importar abrir (aba Itens da RC → "levar para a lista"). */
  const [preMarcar, setPreMarcar] = useState<number[] | null>(null);
  useEffect(() => { if (cp && preMarcar) { setCpMarcados(new Set(preMarcar)); setPreMarcar(null); } }, [cp, preMarcar]);
  const levarParaLista = (ks: number[]) => {
    setPreMarcar(ks); setImportarAberto(true);   // o modal carrega a RC sozinho; a marcação entra quando chegar
    if (cp) { setCpMarcados(new Set(ks)); setPreMarcar(null); }
  };

  const naLista = useMemo(() => new Set(validas.map((l) => chaveItem(l.equipamento, l.item))), [validas]);
  /** Só entra na lista o que está casado: ✓ automático ou escolhido à mão. */
  const casado = (it: ItemCp) => it.casamento?.status === "ok" && !!it.casamento.melhor;

  const carregarCp = useCallback(async () => {
    setCpCarregando(true); setCpErro(null);
    try {
      const r = await fetch(`/api/rc-projetos/itens-cp?codigo_projeto=${codigoProjeto}`);
      const j = (await r.json()) as { proposta?: string | null; itens?: ItemCp[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setCp({ proposta: j.proposta ?? null, itens: j.itens ?? [] });
      setCpMarcados(new Set());
      return j.itens ?? [];
    } catch (e) {
      setCpErro(e instanceof Error ? e.message : String(e));
      return null;
    } finally { setCpCarregando(false); }
  }, [codigoProjeto]);
  useEffect(() => { if (importarAberto && !cp && !cpCarregando) void carregarCp(); },
    [importarAberto, cp, cpCarregando, carregarCp]);

  const casarAgora = useCallback(async (baseColada?: LinhaGrade[]) => {
    setCasando(true); setErro(null);
    try {
      if (importarAberto) {
        // a CP recasa inteira; escolha feita à mão (de-para) volta igual
        const its = await carregarCp();
        if (its) {
          const ok = its.filter((i) => i.casamento?.status === "ok").length;
          const man = its.filter((i) => i.casamento?.manual).length;
          setAviso(`RC recasada com o catálogo: ${ok} de ${its.length} casado(s)${man ? ` (${man} por escolha sua)` : ""}.`);
        }
        return;
      }
      // a lista atual é só a ENTRADA (textos); o resultado volta por id e entra em cima
      // do estado mais novo — o que se digitou enquanto o catálogo respondia não se perde
      const { res, vazio } = await casarLinhas(baseColada ?? linhasRef.current);
      aplicarCasamento(res);
      if (vazio && !baseColada) setAviso("Todas as linhas já estão ligadas ao catálogo (ou tiveram a sugestão recusada).");
    } catch (e) { setErro(`Não consegui casar com o catálogo: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setCasando(false); }
  }, [casarLinhas, aplicarCasamento, importarAberto, carregarCp]);

  /** Depois de colar do Excel, casa sozinho — o paste chega ao estado no
   *  próximo render, então o efeito espera a lista nova. Linha colada sem data
   *  herda a data do grupo. */
  const [casarAposColar, setCasarAposColar] = useState(false);
  useEffect(() => {
    if (!casarAposColar) return;
    setCasarAposColar(false);
    const comData = (l: LinhaGrade) => {
      if (!String(l.item ?? "").trim() || l.data_necessaria) return l;
      const g = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral"));
      return g ? { ...l, data_necessaria: g } : l;
    };
    setLinhas((ls) => ls.map(comData));
    void casarAgora(linhas.map(comData));
  }, [casarAposColar, casarAgora, linhas]);

  const adicionarDaCp = useCallback(() => {
    if (!cp) return;
    const novas: LinhaGrade[] = [];
    for (const k of [...cpMarcados].sort((a, b) => a - b)) {
      const it = cp.itens[k];
      if (!it || usoCp.has(k)) continue;
      const c = it.casamento;
      const base: LinhaGrade = {
        ...vazia(), equipamento: it.equipamento, item: it.item,
        qtd: it.qtd != null ? String(it.qtd) : "", modelo: it.modelo ?? "",
        // Sem compra anterior, o custo usado na CP é o melhor valor que há.
        cat_valor_unit: it.custo_cp != null ? moeda(it.custo_cp) : "",
        _vu_fonte: it.custo_cp != null ? "CP" : "",
        data_necessaria: dataGrupoRef.current.get(normGrupo(it.equipamento || "Geral")) ?? "",
      };
      if (casado(it)) {
        const campos = camposDoCatalogo(c.melhor!, "ok", [], base.cat_valor_unit);
        novas.push({ ...base, ...campos, _vu_fonte: campos._vu_fonte || base._vu_fonte });
      } else {
        // sem item nosso certo: provável → entra com SUGESTÃO; senão "sem código" (âmbar), com as alternativas para o ⌕
        if (c?.melhor && (c.melhor.score ?? 0) >= SUG_MIN) novas.push({ ...base, ...camposSugestao(c.melhor, c.alternativas ?? []) });
        else novas.push({ ...base, _match: "sem", _alts: c?.alternativas?.length ? JSON.stringify(c.alternativas) : "" });
      }
    }
    if (!novas.length) { setAviso("Nada novo para adicionar — os marcados já estão na lista."); return; }
    setLinhas((ls) => [...ls.filter((l) => String(l.item ?? "").trim()), ...novas, vazia()]);
    setSujo(true);
    setCpMarcados(new Set());
    setImportarAberto(false);
    setSubAba("lista");
    const sem = novas.filter((l) => l._match === "sem").length;
    const sg = novas.filter((l) => l._match === "sug").length;
    setAviso(`${novas.length} item(ns) da RC adicionados à lista${sg ? ` · ${sg} com sugestão de código (na coluna "Compatibilizar com o estoque": ✓ ou "✓ aceitar as melhores")` : ""}${sem ? ` · ${sem} sem código (resolva na coluna "Compatibilizar com o estoque")` : ""}. ${fraseSalvar()}`);
  }, [cp, cpMarcados, usoCp]);

  /** Escolha no seletor: grava o de-para (texto → item nosso) e aplica na linha. */
  const escolher = useCallback(async (sel: Seletor, it: Escolhido) => {
    const linhaLista = sel.alvo === "lista" ? linhas.find((l) => l._id === sel.id) : null;
    const itCp = sel.alvo === "cp" ? cp?.itens[sel.k] : null;
    const texto = linhaLista ? textoCasar(linhaLista.item, linhaLista.modelo) : itCp ? textoCasar(itCp.item, itCp.modelo) : "";
    setSeletor(null);
    try {
      const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "vincular", emp: empresa, texto, ncod_prod: it.n_cod_prod }) });
      const j = (await r.json()) as { item?: Cat | null; error?: string };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      const item: Cat = j.item ?? { ncod_prod: it.n_cod_prod, codigo: it.codigo, descricao: it.descricao, unidade: null, ultimo_preco: null,
        ultima_compra: null, fornecedor: null, qtd_compras: null, entrega_dias: null, entrega_fonte: null, fat_dias: null, nativo: true };
      if (sel.alvo === "cp" && cp) {
        const norm = (t: string) => t.trim().toLowerCase();
        // o de-para vale para o texto: as outras linhas da CP com o mesmo texto casam junto
        setCp({ ...cp, itens: cp.itens.map((x) => (norm(textoCasar(x.item, x.modelo)) === norm(texto)
          ? { ...x, casamento: { idx: x.casamento?.idx ?? 0, status: "ok", manual: true, melhor: item, alternativas: [item], compra: [] } } : x)) });
      } else if (linhaLista) {
        setLinhas((atual) => atual.map((l) => (l._id === linhaLista._id
          ? { ...l, ...camposDoCatalogo(item, "ok", [], l.cat_valor_unit ?? ""), _sug: "", _sug_status: "", _omie_ncod: "", ...(String(l.cat_valor_unit ?? "").trim() ? { cat_valor_unit: l.cat_valor_unit, _vu_fonte: l._vu_fonte ?? "" } : {}) }
          : l)));
        setSujo(true);
      }
      setAviso(`Item ${item.codigo ?? ""} escolhido — gravado para o texto "${texto.slice(0, 60)}" (casa sozinho da próxima vez).`);
    } catch (e) { setErro(`Não consegui gravar a escolha: ${e instanceof Error ? e.message : String(e)}`); }
  }, [linhas, cp, empresa]);
  const escolherRef = useRef<typeof escolher | null>(null);
  escolherRef.current = escolher;

  /** Estimado das linhas que ainda não viraram RC/PC — entra no projetado. */
  const restante = useMemo(() => validas.filter((l) => { const c = cmpPorId.get(l._id); return !c?.rc && !c?.pcs.length; })
    .reduce((a, l) => a + num(l.qtd) * num(l.cat_valor_unit), 0), [validas, cmpPorId]);

  // ── Vínculo lista ↔ PC e Gerar RC (vieram da antiga aba "Compras × lista") ──
  const vincularAuto = useCallback(async () => {
    setOcupado("auto"); setErro(null); setAviso(null);
    try {
      // 06/10/26: casa contra os PCs do painel E os do Omie (compras.*), por
      // código e por descrição com as mesmas medidas; dúvidas ficam para conferir.
      const j = await postCompras({ acao: "autolink", aplicar: true }) as { aplicados?: number; casamentos?: CasamentoPc[] };
      const duv = (j.casamentos ?? []).filter((c) => !c.auto);
      setSugestoes(duv.length ? duv : null);
      setAviso(j.aplicados
        ? `${j.aplicados} linha(s) ligadas aos pedidos de compra do projeto` + (duv.length ? ` · ${duv.length} parecida(s) para você confirmar` : "")
        : (duv.length ? `Nada vinculado com certeza; ${duv.length} parecida(s) para confirmar.` : "Nenhum item novo para vincular."));
      await carregar();
      onGravado?.();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [postCompras, carregar, onGravado]);
  const verSugestoes = useCallback(async () => {
    setOcupado("sug"); setErro(null);
    try {
      const j = await postCompras({ acao: "autolink", aplicar: false }) as { casamentos?: CasamentoPc[] };
      setSugestoes(j.casamentos ?? []);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [postCompras]);
  /** Sugestões de vínculo de TODAS as linhas (sem aplicar) — o "vincular" da linha filtra a dela. */
  const [sugTodas, setSugTodas] = useState<CasamentoPc[] | null>(null);
  useEffect(() => {
    if (!vincLinha || sugTodas) return;
    postCompras({ acao: "autolink", aplicar: false })
      .then((j: { casamentos?: CasamentoPc[] }) => setSugTodas(j.casamentos ?? []))
      .catch(() => setSugTodas([]));
  }, [vincLinha, sugTodas, postCompras]);
  useEffect(() => { setSugTodas(null); }, [cmp]);
  const confirmarSugestao = useCallback(async (c: CasamentoPc) => {
    setOcupado(`v${c.lista_id}`);
    try {
      await postCompras({ acao: "vincular", lista_id: c.lista_id, pc_item_id: c.pc_item_id });
      setSugestoes((x) => (x ?? []).filter((y) => y.lista_id !== c.lista_id));
      await carregarCompras();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [postCompras, carregarCompras]);
  const desvincular = useCallback(async (id: string) => {
    setOcupado(`d${id}`);
    try { await postCompras({ acao: "desvincular", lista_id: id }); await carregar(); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [postCompras, carregar]);
  const desvincularRef = useRef<typeof desvincular | null>(null);
  desvincularRef.current = desvincular;

  /** Linhas marcadas que podem virar RC: gravadas, sem RC e sem PC. */
  /* ── PC pela lista e RC → lista (07/10/26) ── */
  const [gerarPcLinhas, setGerarPcLinhas] = useState<LinhaParaPc[] | null>(null);
  /** Linhas marcadas que podem virar PC: gravadas e sem PC (com ou sem RC — a RC fica de origem). */
  const paraPc = useMemo(() => [...marcadas].filter((id) => {
    if (!id.startsWith("db")) return false;
    const c = cmpPorId.get(id);
    const l = linhas.find((x) => x._id === id);
    return !c?.pcs.length && !String(l?.pc_numero ?? "").trim();
  }), [marcadas, cmpPorId, linhas]);
  const abrirGerarPc = useCallback((ids: string[]) => {
    if (sujo) { setErro("Há alterações não salvas — salve a lista antes de gerar o pedido de compra."); return; }
    const ls = ids.map((id) => linhas.find((x) => x._id === id)).filter((x): x is LinhaGrade => !!x).map((l) => ({
      id: l._id.slice(2), item: l._cat_desc || l.item, codigo: l.cat_codigo || "", qtd: num(l.qtd), vu: num(l.cat_valor_unit),
      fornecedor: l.cat_fornecedor || "", necessario: l.data_necessaria || null, un: l.un || "UN" }));
    if (!ls.length) { setErro("Marque linhas sem PC para gerar o pedido de compra."); return; }
    setGerarPcLinhas(ls);
  }, [sujo, linhas]);
  const [rcsAbertas, setRcsAbertas] = useState<{ id: number; num: string; valor: number; itens: number; na_lista: number }[] | null>(null);
  const [rcsCarregando, setRcsCarregando] = useState(false);
  const abrirTrazerRc = useCallback(async () => {
    setRcsCarregando(true); setRcsAbertas([]);
    try { const j = await postCompras({ acao: "rcs_do_projeto" }) as { rcs: { id: number; num: string; valor: number; itens: number; na_lista: number }[] }; setRcsAbertas(j.rcs ?? []); }
    catch (e) { setErro((e as Error).message); setRcsAbertas(null); }
    finally { setRcsCarregando(false); }
  }, [postCompras]);
  const importarRc = useCallback(async (rcId: number) => {
    if (sujo) { setErro("Há alterações não salvas — salve a lista antes de importar a RC."); return; }
    setOcupado(`rc${rcId}`);
    try {
      const j = await postCompras({ acao: "importar_rc", rc_id: rcId }) as { rc: string; novas: number; casados: number; ligadas: number };
      setAviso(`RC ${j.rc}: ${j.novas} linha(s) nova(s) na lista, ${j.casados} já com o código do nosso estoque`
        + (j.novas - j.casados > 0 ? ` e ${j.novas - j.casados} para resolver (na coluna "Compatibilizar com o estoque")` : "")
        + `${j.ligadas ? `; ${j.ligadas} já existente(s) ligada(s) à RC` : ""}. A RC fica como origem; os pedidos saem da lista.`);
      setRcsAbertas(null);
      setImportarAberto(false);
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [postCompras, sujo, carregar]);

  /* Vindo de Projetos (07/10/26): ?rc=N marca os itens daquela RC sem PC e abre o gerador;
     ?pc=N mostra só as linhas daquele PC. */
  const rcUrlFeito = useRef(false);
  useEffect(() => {
    try { const pc = new URLSearchParams(window.location.search).get("pc"); if (pc) setFiltroPcNum(pc); } catch { /* */ }
  }, []);
  useEffect(() => {
    if (rcUrlFeito.current || !cmp || !carregouOk) return;
    let rc: string | null = null;
    try { rc = new URLSearchParams(window.location.search).get("rc"); } catch { /* */ }
    if (!rc) { rcUrlFeito.current = true; return; }
    rcUrlFeito.current = true;
    const ids = linhas.filter((l) => l._id.startsWith("db") && cmpPorId.get(l._id)?.rc === rc && !cmpPorId.get(l._id)?.pcs.length && !String(l.pc_numero ?? "").trim()).map((l) => l._id);
    if (!ids.length) { setAviso(`Nenhuma linha da lista vem da RC ${rc} sem PC — use “Importar itens da RC” para trazer os itens dela.`); return; }
    setMarcadas(new Set(ids));
    abrirGerarPc(ids);
  }, [cmp, carregouOk, linhas, cmpPorId, abrirGerarPc]);

  const paraRc = useMemo(() => [...marcadas].filter((id) => {
    if (!id.startsWith("db")) return false;
    const c = cmpPorId.get(id);
    const l = linhas.find((x) => x._id === id);
    return !c?.rc && !c?.pcs.length && !String(l?.pc_numero ?? "").trim();
  }), [marcadas, cmpPorId, linhas]);
  const gerarRc = useCallback(async () => {
    if (!paraRc.length) return;
    if (sujo) { setErro("Há alterações não salvas — salve a lista antes de gerar a RC."); return; }
    if (!window.confirm(`Gerar uma requisição de compra (RC) com ${paraRc.length} linha(s) da lista?\n\nA RC entra em Compras com o número sequencial e cada linha fica ligada à lista — os pedidos de compra feitos a partir dela aparecem aqui sozinhos.`)) return;
    setOcupado("rc"); setErro(null); setAviso(null);
    try {
      const j = await postCompras({ acao: "gerar_rc", ids: paraRc.map((id) => id.slice(2)) }) as { rc: string; linhas: number };
      setAviso(`RC ${j.rc} criada com ${j.linhas} linha(s). Abra em Compras para gerar o pedido de compra.`);
      setMarcadas(new Set());
      await carregarCompras();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  }, [paraRc, sujo, postCompras, carregarCompras]);

  const vincular = useCallback(async (pc: PcSearchResult) => {
    const ids = (vincBusca ?? Array.from(marcadas))
      .filter((id) => id.startsWith("db"))
      .map((id) => id.slice(2));
    setPicker(false); setVincBusca(null);
    if (!ids.length) return;
    setSalvando(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/itens/bulk-link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, ids, pc_numero: pc.pc_numero }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? "falha ao vincular"); return; }
      setAviso(`${j.updated} item(ns) vinculados ao PC ${pc.pc_numero}` +
               (j.substituidos > 0 ? ` — ${j.substituidos} tinha(m) PC anterior, sobrescrito` : ""));
      await carregar();
      onGravado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [marcadas, vincBusca, empresa, codigoProjeto, carregar, onGravado]);

  const exportar = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const dados = validas.map((l) => {
      const c = cmpPorId.get(l._id);
      return {
        Equipamento: l.equipamento, Item: l.item, Qtd: l.qtd, Un: l.un, "Necessário em": l.data_necessaria, Modelo: l.modelo,
        "Valor unit.": l.cat_valor_unit ? num(l.cat_valor_unit) : "",
        Total: num(l.qtd) * num(l.cat_valor_unit) || "",
        "Código": l.cat_codigo, "Fornecedor sugerido": l.cat_fornecedor,
        "Entrega (d)": l.cat_entrega_dias, "Fatura (d)": l.cat_fat_dias,
        Origem: origemCp(l) ?? "novo", PC: c?.pcs.map((p) => p.pc).join(", ") || l.pc_numero,
        Fornecedor: c?.pcs.map((p) => p.fornecedor).filter(Boolean).join(", ") || l._fornecedor,
        Comprado: c?.valor_pc ?? "",
        Situação: c?.pcs.map((p) => situacaoPc(p).t).join(", ") ?? "",
        Observação: conversa(l).map((c) => (c.origem === "observacao" && c.id === "obs" ? c.texto : `${c.autor.split("@")[0]}: ${c.texto}`)).join(" | "),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Materiais");
    XLSX.writeFile(wb, `materiais-projeto-${codigoProjeto}.xlsx`);
  }, [validas, codigoProjeto, cmpPorId, conversa]);

  const alternar = useCallback((id: string, _i: number, _shift: boolean) => {
    setMarcadas((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  // ── Faixa "Grupos de equipamento" ────────────────────────────────────────
  type Grupo = { k: string; nome: string; n: number; data: string | null; proprias: number; daCp: boolean };
  const grupos: Grupo[] = useMemo(() => {
    const m = new Map<string, Grupo>();
    for (const l of validas) {
      const k = normGrupo(l.equipamento || "Geral");
      const g = m.get(k) ?? { k, nome: String(l.equipamento || "Geral").trim(), n: 0, data: null, proprias: 0, daCp: false };
      g.n++;
      m.set(k, g);
    }
    // grupos da CP ainda sem itens na lista não aparecem (eram o "SW 0")
    for (const g of m.values()) {
      g.data = dataGrupo.get(g.k) ?? null;
      g.proprias = g.data ? validas.filter((l) => normGrupo(l.equipamento || "Geral") === g.k && l.data_necessaria && l.data_necessaria !== g.data).length : 0;
    }
    return [...m.values()].sort((a, b) => Number(a.daCp) - Number(b.daCp) || a.nome.localeCompare(b.nome));
  }, [validas, gruposMeta, dataGrupo]);

  const definirDataGrupo = useCallback((k: string, nova: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nova)) return;
    const antiga = dataGrupoRef.current.get(k) ?? null;
    setLinhas((atual) => {
      const idx = atual.map((l, i) => ({ l, i })).filter(({ l }) => String(l.item ?? "").trim() && normGrupo(l.equipamento || "Geral") === k);
      const novas = aplicarDataGrupo(idx.map(({ l }) => l.data_necessaria ?? ""), antiga, nova);
      const out = [...atual];
      idx.forEach(({ l, i }, j) => { out[i] = { ...l, data_necessaria: novas[j] }; });
      return out;
    });
    setSujo(true);
  }, []);
  const renomearGrupo = useCallback((k: string, nome: string) => {
    setLinhas((atual) => atual.map((l) => (String(l.item ?? "").trim() && normGrupo(l.equipamento || "Geral") === k ? { ...l, equipamento: nome } : l)));
    if (equipFiltro === k) setEquipFiltro(normGrupo(nome));
    setSujo(true);
  }, [equipFiltro]);
  const sugestaoData = gruposMeta?.prazo.data ?? null;
  const semDataComItens = grupos.filter((g) => g.n > 0 && !g.data);

  const nComPc = validas.filter(temPc).length;
  const nSemCod = validas.filter(semCodigoNosso).length;
  const nCod = validas.length - nSemCod;
  const riscoGrupo = (k: string) => {
    const ls = validas.filter((l) => normGrupo(l.equipamento || "Geral") === k);
    return { risco: ls.filter((l) => sinais.get(l._id)?.nivel === "risco").length, atraso: ls.filter((l) => sinais.get(l._id)?.nivel === "atrasado").length };
  };


  // ── Cor de cada grupo (spec B.2 v3) ─────────────────────────────────────────
  /* Paleta de 8 pela ordem dos grupos (estável enquanto os grupos não mudam). Com a migração
     sql/131 o cadastro devolve a cor gravada (platform.equipamento_grupo.cor) e ela vence. */
  const [gruposNovos, setGruposNovos] = useState<{ k: string; nome: string; data: string | null }[]>([]);
  const gruposChips = useMemo(() => {
    const out = grupos.map((g) => ({ k: g.k, nome: g.nome, n: g.n, data: g.data }));
    for (const g of gruposNovos) if (!out.some((x) => x.k === g.k)) out.push({ ...g, n: 0 });
    return out;
  }, [grupos, gruposNovos]);
  /* A cor de um grupo não muda enquanto a tela está aberta: quem já tem cor fica com ela; grupo
     novo pega a primeira cor livre da paleta (criar "Filtro Polidor" não repinta os outros). */
  const coresRef = useRef(new Map<string, string>());
  const coresGrupo = useMemo(() => {
    const m = coresRef.current;
    for (const g of gruposChips) {
      const gravada = gruposMeta?.cores?.[g.k];
      if (gravada) { m.set(g.k, gravada); continue; }
      if (m.has(g.k)) continue;
      const usadas = new Set(gruposChips.map((x) => m.get(x.k)).filter(Boolean));
      m.set(g.k, CORES_GRUPO.find((c) => !usadas.has(c)) ?? CORES_GRUPO[m.size % CORES_GRUPO.length]);
    }
    return new Map(m);
  }, [gruposChips, gruposMeta]);
  const corGrupo = useCallback((k: string) => coresGrupo.get(k) ?? CORES_GRUPO[0], [coresGrupo]);

  // ── "+ equipamento" e "mover para equipamento" (spec B.2 / B.4 v3) ─────────
  const [novoGrupo, setNovoGrupo] = useState<{ nome: string; data: string } | null>(null);
  const criarGrupo = useCallback(() => {
    if (!novoGrupo) return;
    const nome = novoGrupo.nome.trim().replace(/\s+/g, " ");
    if (nome.length < 2) { setErro("Dê um nome ao equipamento."); return; }
    const k = normGrupo(nome);
    const data = /^\d{4}-\d{2}-\d{2}$/.test(novoGrupo.data) ? novoGrupo.data : "";
    const ids = new Set([...marcadas]);
    if (ids.size) {
      setLinhas((ls) => ls.map((l) => (ids.has(l._id) ? { ...l, equipamento: nome, data_necessaria: data || l.data_necessaria } : l)));
      setAviso(`Equipamento "${nome}" criado com ${ids.size} item(ns).${fraseSalvar()}`);
      setMarcadas(new Set());
      setSujo(true);
    } else {
      // grupo novo sem itens: aparece como chip e ganha uma linha vazia, pronta para digitar
      setGruposNovos((gs) => (gs.some((g) => g.k === k) ? gs : [...gs, { k, nome, data: data || null }]));
      setLinhas((ls) => [{ ...vazia(), equipamento: nome, data_necessaria: data } as LinhaGrade, ...ls]);
      setAviso(`Equipamento "${nome}" criado — digite os itens na linha nova (ou use + Adicionar itens).`);
      // as linhas em branco ficam no fim da grade: a nova é a penúltima (a última é a vazia de sempre)
      setTimeout(() => { const cs = [...document.querySelectorAll<HTMLInputElement>('[data-cel$="-2"]')]; cs[cs.length - 2]?.focus(); }, 150);
    }
    setFiltroPc("todas"); setEquipFiltro(k); setNovoGrupo(null);
  }, [novoGrupo, marcadas]); // eslint-disable-line react-hooks/exhaustive-deps
  const moverParaGrupo = useCallback((nome: string) => {
    const ids = new Set([...marcadas]);
    if (!ids.size || !nome) return;
    const k = normGrupo(nome);
    const destino = dataGrupoRef.current.get(k) ?? gruposNovos.find((g) => g.k === k)?.data ?? null;
    setLinhas((ls) => ls.map((l) => {
      if (!ids.has(l._id)) return l;
      // a linha que herdava a data do grupo antigo passa a herdar a do novo; data própria fica
      const antiga = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral")) ?? null;
      const herda = !l.data_necessaria || l.data_necessaria === antiga;
      return { ...l, equipamento: nome, ...(herda && destino ? { data_necessaria: destino } : {}) };
    }));
    setSujo(true);
    setAviso(`${ids.size} item(ns) movido(s) para ${nome}.${fraseSalvar()}`);
    setMarcadas(new Set());
  }, [marcadas, gruposNovos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Coluna provisória "Compatibilizar com o estoque" (spec B.6 v3) ─────────
  /* Aparece sozinha enquanto houver linha sem código nosso e não recusada; some sozinha quando a
     última é resolvida; volta se entrar item novo sem código. O ⚡ da barra mostra/oculta à mão
     (colSugManual: null = automático). Aberta à mão, mostra também as linhas já com código, para
     trocar ou tirar o código. */
  const pendentesSug = useMemo(() => validas.filter((l) => semCodigoNosso(l) && l._sug_status !== "recusada"), [validas]);
  const [colSugManual, setColSugManual] = useState<boolean | null>(null);
  const nPendAnt = useRef(0);
  useEffect(() => {
    const n = pendentesSug.length;
    if (n === 0 && colSugManual !== true) setColSugManual(null);          // resolveu tudo → volta ao automático (fecha)
    else if (n > nPendAnt.current && colSugManual === false) setColSugManual(null); // entrou item novo sem código → volta
    nPendAnt.current = n;
  }, [pendentesSug.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const colSugAberta = colSugManual === null ? pendentesSug.length > 0 : colSugManual;
  /** Candidatas de cada linha: a sugestão gravada + as alternativas do casamento (sem repetir). */
  const candidatas = useCallback((l: LinhaGrade): Cat[] => {
    const out: Cat[] = []; const vistos = new Set<number>();
    const add = (c: Cat | null | undefined) => { if (c && c.ncod_prod && !vistos.has(Number(c.ncod_prod))) { vistos.add(Number(c.ncod_prod)); out.push(c); } };
    if (l._match === "sug") add(lerSug(l));
    try { (l._alts ? JSON.parse(l._alts) as Cat[] : []).forEach(add); } catch { /* */ }
    return out.slice(0, 4);
  }, []);
  /** Alternativas das linhas que JÁ têm código (só com a coluna aberta à mão): o casamento é
   *  só leitura e fica na tela, não vai para a linha (não marca a lista para salvar). */
  const [altsCod, setAltsCod] = useState<Record<string, Cat[]>>({});
  useEffect(() => {
    if (colSugManual !== true) return;
    const falta = linhasRef.current.filter((l) => String(l.item ?? "").trim() && !semCodigoNosso(l) && !altsCod[l._id]);
    if (!falta.length) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "casar", emp: empresa, textos: falta.map((l) => textoCasar(l.item, l.modelo)), custos: falta.map(() => null) }) });
        const j = (await r.json().catch(() => ({}))) as { casamentos?: Casamento[] };
        if (!vivo || !j.casamentos) return;
        const m: Record<string, Cat[]> = {};
        falta.forEach((l, k) => { const c = j.casamentos![k]; m[l._id] = [c?.melhor, ...(c?.alternativas ?? [])].filter((x): x is Cat => !!x); });
        setAltsCod((a) => ({ ...a, ...m }));
      } catch { /* sem alternativas: fica buscar no estoque e tirar o código */ }
    })();
    return () => { vivo = false; };
  }, [colSugManual, validas.length, empresa]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Escolha no select da coluna: candidata (vira a sugestão da linha), buscar ou criar. */
  const [escolhaSug, setEscolhaSug] = useState<Record<string, number>>({});
  const reverRecusa = useCallback((id: string) => {
    for (const k of [...sugTentadasRef.current]) if (k.startsWith(`${id}|`)) sugTentadasRef.current.delete(k);
    setLinhas((ls) => ls.map((l) => (l._id === id ? { ...l, _sug_status: "", ...(l._match === "omie" ? {} : { _match: "" }) } as LinhaGrade : l)));
    setSujo(true);
  }, []);
  const tirarCodigo = useCallback((id: string) => {
    for (const k of [...sugTentadasRef.current]) if (k.startsWith(`${id}|`)) sugTentadasRef.current.delete(k);
    setLinhas((ls) => ls.map((l) => (l._id === id ? { ...l, cat_ncod_prod: "", cat_codigo: "", _cat_desc: "", _match: "", _alts: "", _sug: "", _sug_status: "",
      _omie: "", _omie_ncod: "", cat_fornecedor: "", cat_entrega_dias: "", cat_fat_dias: "" } as LinhaGrade : l)));
    setSujo(true);
    setAviso(`Código removido — a linha volta à compatibilização.${fraseSalvar()}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const melhorDe = useCallback((l: LinhaGrade): Cat | null => {
    const cs = candidatas(l);
    const i = escolhaSug[l._id];
    return (i != null ? cs[i] : null) ?? (l._match === "sug" ? lerSug(l) : null) ?? cs[0] ?? null;
  }, [candidatas, escolhaSug]);
  const aceitarMelhores = useCallback(() => {
    const pares = pendentesSug.map((l) => ({ id: l._id, c: melhorDe(l) })).filter((x): x is { id: string; c: Cat } => !!x.c);
    if (!pares.length) { setAviso("Nenhuma linha pendente tem candidata no estoque — use ⌕ buscar ou ＋ criar."); return; }
    void aceitarEscolhas(pares);
  }, [pendentesSug, melhorDe, aceitarEscolhas]);
  const SEL = "max-w-[230px] min-w-0 rounded-md border border-amber-500/50 bg-[rgb(var(--color-ww-panel))] px-1 py-0.5 text-[11px] text-ww-text";
  const BT = "shrink-0 w-[22px] h-[22px] rounded-md border border-ww-border text-[12px] leading-none";
  const colunaSug: ColunaGrade = useMemo(() => ({
    key: "_compat", label: "Compatibilizar com o estoque", w: 372, fixa: true,
    classe: "border-x border-dashed border-amber-500/50",
    fundo: "color-mix(in srgb, rgb(var(--color-ww-panel)) 87%, #f5b547)",
    dicaCab: "Coluna provisória: aparece sozinha quando há item sem código do nosso estoque e some quando todos estão resolvidos. ✓ aceita o item selecionado (ensina o de-para) · ✕ = não é item nosso.",
    cab: (<span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-[11px] text-amber-700 dark:text-amber-300">
      Compatibilizar com o estoque
      <button type="button" onClick={aceitarMelhores} title="Aceita a melhor sugestão de todas as linhas pendentes"
        className="px-1.5 py-px rounded border border-ww-border text-ww-text hover:border-ww-accent">✓ aceitar as melhores</button>
      <button type="button" onClick={() => setColSugManual(false)} className="px-1 text-ww-textMuted hover:text-ww-text">ocultar</button>
    </span>),
    render: (l0) => {
      const l = l0 as LinhaGrade;
      if (!String(l.item ?? "").trim()) return null;
      if (!semCodigoNosso(l)) {
        // linha já com código só aparece aqui com a coluna aberta à mão (para trocar ou tirar o código)
        if (colSugManual !== true) return null;
        const alts = (altsCod[l._id] ?? candidatas(l)).filter((a) => String(a.ncod_prod) !== String(l.cat_ncod_prod));
        return (
          <select className={SEL} value="" data-compat="cod" title="Código atual; abra para trocar por outro item do estoque"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "buscar") abrirSeletorLista(l._id);
              else if (v === "limpar") tirarCodigo(l._id);
              else if (v) { const c = alts[Number(v)]; if (c) void escolherRef.current?.({ alvo: "lista", id: l._id }, { n_cod_prod: c.ncod_prod, codigo: c.codigo ?? "", descricao: c.descricao }); }
            }}>
            <option value="">✓ {l.cat_codigo} · mantido</option>
            {alts.map((a, i) => <option key={a.ncod_prod} value={String(i)}>trocar por {a.codigo ?? "s/ cód"} · {a.descricao}</option>)}
            <option value="buscar">⌕ buscar no estoque…</option>
            <option value="limpar">✕ tirar o código</option>
          </select>);
      }
      if (l._sug_status === "recusada") return (
        <span className="text-[11px] text-ww-textFaint" data-compat="recusada">sem item nosso ·{" "}
          <button type="button" className="text-ww-accent hover:underline" onClick={() => abrirSeletorLista(l._id)}>escolher</button> ·{" "}
          <button type="button" className="hover:underline" onClick={() => reverRecusa(l._id)}>rever</button></span>);
      const cs = candidatas(l);
      const atual = melhorDe(l);
      const idx = atual ? cs.findIndex((c) => c.ncod_prod === atual.ncod_prod) : -1;
      return (
        <span className="flex items-center gap-1.5 min-w-0" data-compat="pendente">
          <select className={`${SEL} ${atual ? "font-semibold !text-amber-700 dark:!text-amber-300" : ""}`} value={idx >= 0 ? String(idx) : ""}
            title="Melhor sugestão primeiro; abra para escolher outra, buscar no estoque ou criar o item"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "buscar" || v === "novo") { abrirSeletorLista(l._id); return; }
              if (v === "") return;
              setEscolhaSug((m) => ({ ...m, [l._id]: Number(v) }));
            }}>
            {cs.map((a, i) => <option key={a.ncod_prod} value={String(i)}>{a.codigo ?? "s/ cód"} · {a.descricao} ({Math.round((a.score ?? 0) * 100)}%)</option>)}
            {!cs.length && <option value="">{sugBuscando ? "procurando no estoque…" : "nenhuma parecida no estoque"}</option>}
            <option value="buscar">⌕ buscar no estoque…</option>
            <option value="novo">＋ criar item novo no estoque</option>
          </select>
          {atual && <button type="button" className={`${BT} text-emerald-700 dark:text-emerald-300 hover:border-emerald-500`} title={`Aceitar ${atual.codigo ?? ""}`}
            onClick={() => void aceitarEscolhas([{ id: l._id, c: atual }])}>✓</button>}
          <button type="button" className={`${BT} text-ww-textMuted hover:text-rose-500 hover:border-rose-400`} title="Não é item nosso (fica sem código)"
            onClick={() => recusarSugestao(l._id)}>✕</button>
        </span>);
    },
  }), [colSugManual, aceitarMelhores, altsCod, candidatas, melhorDe, abrirSeletorLista, tirarCodigo, reverRecusa, aceitarEscolhas, recusarSugestao, sugBuscando]); // eslint-disable-line react-hooks/exhaustive-deps
  const colunasGrade = useMemo(() => {
    if (!colSugAberta) return COLS;
    const i = COLS.findIndex((c) => c.key === "cat_codigo");
    return [...COLS.slice(0, i + 1), colunaSug, ...COLS.slice(i + 1)];
  }, [COLS, colSugAberta, colunaSug]);

  // ── Painel do topo ao vivo e "ver planejamento →" ───────────────────────────
  useEffect(() => {
    onResumo?.({ restante, semana: resumoP.semana, nAtr: resumoP.atr.length, nAg: resumoP.ag.length });
  }, [onResumo, restante, resumoP]);
  useEffect(() => () => onResumo?.(null), [onResumo]);
  useEffect(() => { if (pedidoEtapa) { etapaInicialFeita.current = true; setSubAba(pedidoEtapa.etapa); } }, [pedidoEtapa]);

  /* Etapa inicial (spec B.1): projeto sem lista abre em ① Itens da RC; com lista, em ②. */
  useEffect(() => {
    if (etapaInicialFeita.current || !carregouOk || carregando) return;
    etapaInicialFeita.current = true;
    setSubAba(validas.length ? "lista" : "rc");
  }, [carregouOk, carregando, validas.length]);

  /** "+ Adicionar itens ▾" (spec B.2 / D). */
  const [addModal, setAddModal] = useState<"cat" | "colar" | null>(null);
  const menuAdicionar: { rot: string; sub: string; fn: () => void }[] = [
    { rot: "🔎 Escolher do estoque / catálogo", sub: "busca por código ou descrição, marca vários", fn: () => setAddModal("cat") },
    { rot: "📋 Colar do Excel", sub: "cola 10, 15 linhas de uma vez, com ou sem cabeçalho", fn: () => setAddModal("colar") },
    { rot: "⬇ Baixar modelo Excel com nossos códigos", sub: "aba Lista para preencher + aba Códigos do estoque (para PROCV)",
      fn: () => { window.location.href = `/api/rc-projetos/modelo?emp=${encodeURIComponent(empresa)}`; } },
  ];
  /** Linhas do modal "Adicionar itens" → grade. As sem código passam pelo casamento automático. */
  const adicionarLinhasNovas = useCallback((novas: LinhaNova[], modo: "cat" | "colar") => {
    const rows: LinhaGrade[] = novas.map((n) => {
      const base = { ...vazia(), equipamento: n.equipamento, item: n.item, qtd: n.qtd, un: n.un, data_necessaria: n.data_necessaria,
        cat_valor_unit: n.cat_valor_unit, _vu_fonte: "" } as LinhaGrade;
      if (!n.cat) return base;
      const campos = camposDoCatalogo(n.cat as unknown as Cat, "ok", [], n.cat_valor_unit);
      return { ...base, ...campos, ...(n.cat_valor_unit ? { cat_valor_unit: n.cat_valor_unit, _vu_fonte: modo === "cat" ? "catálogo" : "" } : {}) } as LinhaGrade;
    });
    setLinhas((ls) => [...ls.filter((l) => String(l.item ?? "").trim()), ...rows, vazia()]);
    setSujo(true);
    setAddModal(null);
    setSubAba("lista"); setFiltroPc("todas"); setFiltroPcNum(null);
    const semCod = rows.filter((r) => !r.cat_ncod_prod).length;
    const inval = novas.filter((n) => n.codigo_invalido).length;
    setAviso(`${rows.length} item(ns) adicionados${modo === "cat" ? " do estoque" : " do Excel"}${semCod ? ` · ${semCod} sem código vão passar pelo catálogo (sugestão na coluna "Compatibilizar com o estoque")` : ""}${inval ? ` · ${inval} código(s) colado(s) não são do nosso estoque` : ""}.${fraseSalvar()}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** "⋯" (spec B.2): tudo o que saiu da barra continua aqui. */
  const menuMais: { rot: string; dica?: string; off?: boolean; fn: () => void }[] = [
    { rot: ocupado === "auto" ? "⇄ Vinculando…" : "⇄ Vincular PCs automaticamente", off: salvando || !!ocupado, dica: "Procura, nos pedidos de compra deste projeto, o item de cada linha — e grava o vínculo", fn: () => void vincularAuto() },
    { rot: ocupado === "sug" ? "Procurando…" : "Ver sugestões de vínculo com PCs", off: !!ocupado, dica: "Linhas parecidas com itens dos PCs do projeto, para você confirmar (também no “+ vincular” de cada linha)", fn: () => void verSugestoes() },
    { rot: "Exportar Excel", off: !validas.length, fn: exportar },
    { rot: salvando ? "Salvando…" : "Salvar agora", off: salvando || !carregouOk, fn: () => void salvar() },
    { rot: "⏱ Prazos por fornecedor", dica: "Histórico × prazo usado no planejamento (comprar até)", fn: () => setPrazosAberto(true) },
    { rot: casando ? "Casando…" : "Casar com o catálogo de novo", off: casando || salvando, dica: "Refaz as sugestões das linhas sem código (as recusadas ficam de fora)", fn: () => void casarAgora() },
    ...(cmp?.fora_da_lista.length ? [{ rot: `${foraAberto ? "Esconder" : "Ver"} PCs com itens fora da lista (${cmp.fora_da_lista.length})`, dica: "Itens de PCs do projeto que nenhuma linha da lista cobre — já contam no comprometido", fn: () => setForaAberto((v) => !v) }] : []),
  ];

  /** Cabeçalho do grupo na grade (spec B.3): nome, itens e a data "necessário em" do grupo,
   *  editável aqui mesmo — muda as linhas que herdam (as de data própria ficam). */
  const cabecalhoGrupo = (k: string, ls: LinhaGrade[]) => {
    const g = grupos.find((x) => x.k === k);
    const padrao = g && nomesPadrao.length ? nomePadrao(g.nome, nomesPadrao) : null;
    const rg = riscoGrupo(k);
    return (<>
      <i aria-hidden className="inline-block w-[9px] h-[9px] rounded-full" style={{ background: corGrupo(k) }} />
      <b className="text-ww-text">{g?.nome ?? (ls[0]?.equipamento || "Geral")}</b>
      <span className="text-ww-textFaint">{ls.length} {ls.length === 1 ? "item" : "itens"}</span>
      <span className="text-ww-textMuted">· necessário em</span>
      <input type="date" value={g?.data ?? ""} onChange={(e) => definirDataGrupo(k, e.target.value)} data-grupo-data={k}
        title="Muda a data de todos os itens do grupo que herdam (os de data própria ficam)"
        className={`bg-transparent border rounded px-1 py-0 text-[11.5px] text-ww-text ${g?.data ? "border-ww-border" : "border-amber-500/70"}`} />
      {g && g.proprias > 0 && <span className="text-amber-700 dark:text-amber-300 text-[10.5px]">{g.proprias} com data própria</span>}
      {!g?.data && sugestaoData && <button type="button" className="text-[10.5px] text-ww-accent hover:underline" title={gruposMeta?.prazo.fonte ?? ""} onClick={() => definirDataGrupo(k, sugestaoData)}>aplicar {dia(sugestaoData)} (entrega prevista)</button>}
      {rg.risco > 0 && <span className="text-amber-700 dark:text-amber-300 text-[10.5px]">⚠ {rg.risco} em risco</span>}
      {rg.atraso > 0 && <span className="text-rose-600 dark:text-rose-400 text-[10.5px]">✕ {rg.atraso} atrasada(s)</span>}
      {padrao && g && padrao !== g.nome && <button type="button" className="text-[10.5px] text-amber-700 dark:text-amber-300 hover:underline" title={`Trocar pelo nome padrão do cadastro: ${padrao}`} onClick={() => renomearGrupo(k, padrao)}>≈ {padrao}</button>}
    </>);
  };

  // ── Seletor aberto ──────────────────────────────────────────────────────
  const seletorDados = useMemo(() => {
    if (!seletor) return null;
    if (seletor.alvo === "cp") {
      const it = cp?.itens[seletor.k];
      if (!it) return null;
      return { texto: textoCasar(it.item, it.modelo), custo: it.custo_cp, cas: it.casamento };
    }
    const l = linhas.find((x) => x._id === seletor.id);
    if (!l) return null;
    let alts: Cat[] = [];
    try { alts = l._alts ? JSON.parse(l._alts) as Cat[] : []; } catch { /* */ }
    return { texto: textoCasar(l.item, l.modelo), custo: String(l.cat_valor_unit ?? "").trim() ? num(l.cat_valor_unit) : null,
      cas: alts.length ? { idx: 0, status: "conferir" as const, melhor: alts[0], alternativas: alts, compra: [] } : null };
  }, [seletor, cp, linhas]);

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-2.5">
      <style>{CSS_CDL}</style>
      {/* Etapas = controle segmentado compacto (spec B.2 v3), numa linha só, com a contagem dentro. */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-[10px] border border-ww-border overflow-hidden bg-ww-rowHover/50" role="tablist" data-etapas>
          {([
            ["rc", "Itens da RC", cpBase ? String(cpBase.itens.length) : ""],
            ["lista", "Lista", String(validas.length)],
            ["plan", "Planejamento", resumoP.nSemana ? `${resumoP.nSemana} para agir` : ""],
          ] as const).map(([k, rot, n], i) => (
            <button key={k} type="button" role="tab" aria-selected={subAba === k} onClick={() => setSubAba(k)} data-etapa={k}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] transition ${i ? "border-l border-ww-border" : ""} ${
                subAba === k ? "bg-ww-accent text-white font-semibold" : "text-ww-textMuted hover:text-ww-text"}`}>
              {rot}{n && <span className={`text-[11px] ${subAba === k ? "opacity-90" : "opacity-80"}`}>{n}</span>}
            </button>))}
        </div>
        <span className="text-[11.5px] text-ww-textMuted">
          {subAba === "rc" ? "vêm do CRM · conferir e levar para a lista"
            : subAba === "lista" ? "o que vamos comprar de fato · códigos, datas, PCs · clique num equipamento para filtrar"
            : "quando pedir cada item para chegar no prazo · o agente monta os lotes"}
        </span>
        <span className="ml-auto text-[11px] text-ww-textMuted">
          <a href={`/projetos?${new URLSearchParams({ empresa, abrir: String(codigoProjeto) })}`} className="text-ww-accent hover:underline"
            title="Vendas (PV/OS) e as previsões de faturamento e recebimento ficam no cartão do projeto em Operação › Projetos">vendas e datas em Operação › Projetos →</a>{" "}
          <span className="cursor-help text-ww-textFaint" title={"Na grade: digite, ou cole do Excel com Ctrl+V a partir da célula selecionada.\nSem cabeçalho a ordem é Código · Item · Qtd · Un · Necessário em · Valor unit.\nCom a linha de cabeçalho, também Equipamento, Modelo, PC e Observação (a observação vira comentário).\nAo digitar o Item ou o Código, o catálogo sugere os itens do nosso estoque com último preço, fornecedor e prazos.\nÀ direita de cada linha: o pedido de compra, o valor e a situação."}>ⓘ</span>
        </span>
      </div>
      {cmpErro && !cmp && <p className="text-[11px] text-rose-600">Compras do projeto indisponíveis: {cmpErro}</p>}

      {erro && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">
          <strong>Erro:</strong> {erro}
        </div>
      )}
      {aviso && (
        <div className="p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[12px] text-emerald-700 dark:text-emerald-300">
          {aviso}
        </div>
      )}
      {rascunhoDe != null && (
        <div className="flex items-center gap-3 flex-wrap p-2.5 rounded-lg border border-amber-500/50 bg-amber-500/15 text-[12px] text-amber-900 dark:text-amber-100">
          <span>
            <strong>Lista NÃO salva recuperada</strong> — feita neste navegador em{" "}
            {new Date(rascunhoDe).toLocaleString("pt-BR")}. Ainda não está no sistema: confira e clique em <strong>Salvar lista</strong>.
          </span>
          <button type="button" onClick={descartarRascunho}
            className="ml-auto text-[11px] underline opacity-80 hover:opacity-100">descartar rascunho</button>
        </div>
      )}

      {subAba === "rc" && (
        <div className="space-y-2">
          {!cpBase ? <p className="text-[11.5px] text-ww-textFaint py-3">Lendo a RC no CRM…</p>
            : !cpBase.proposta ? (
              <p className="text-[12px] text-ww-textMuted py-3">
                Este projeto não tem proposta ligada no CRM. No CRM, ligue a proposta ao projeto no fechamento (Recebimento → projeto do painel).
              </p>)
            : (() => {
              const tot = (i: ItemCpBase) => (Number(i.qtd) || 0) * (Number(i.custo_cp) || 0);
              const plano = cpBase.itens.reduce((a, i) => a + tot(i), 0);
              const usado = cpBase.itens.reduce((a, i, k) => a + (usoCp.has(k) ? tot(i) : 0), 0);
              const projUsado = [...usoCp.values()].reduce((a, l) => a + num(l.qtd) * num(l.cat_valor_unit), 0);
              const naoUsados = cpBase.itens.map((_, k) => k).filter((k) => !usoCp.has(k));
              let grp = "";
              return (
                <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-ww-textMuted">Itens da proposta <b className="font-mono text-ww-text">{cpBase.proposta}</b> (composição de preço — o plano e o budget). Os que já estão na lista aparecem com ✓.</span>
                  <button type="button" onClick={() => levarParaLista(naoUsados)} disabled={!naoUsados.length}
                    title="Abre o importar com os itens que faltam marcados — cada um já casado com o nosso catálogo"
                    className="ml-auto px-2.5 py-1 text-[11.5px] rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 transition disabled:opacity-40">
                    ⤵ Levar para a lista os que faltam ({naoUsados.length})
                  </button>
                </div>
                <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 560 }}>
                  <table className="w-full text-[11.5px] border-collapse">
                    <thead className="sticky top-0 bg-[rgb(var(--color-ww-panel))] text-ww-textMuted z-[1]">
                      <tr className="text-left">
                        <th className="p-1.5 w-8">#</th><th className="p-1.5">Equipamento</th><th className="p-1.5">Item da RC</th><th className="p-1.5 text-right">Qtd</th>
                        <th className="p-1.5 text-right">Custo RC</th><th className="p-1.5 text-right">Total</th><th className="p-1.5">Na lista</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpBase.itens.map((i, k) => {
                        const l = usoCp.get(k);
                        const n = l ? validas.findIndex((x) => x._id === l._id) + 1 : 0;
                        const cab = grp !== i.equipamento ? <tr key={`g${k}`} className="bg-ww-rowHover/70"><td colSpan={7} className="px-2 py-1 text-[11px] font-semibold text-ww-textMuted">{i.equipamento || "Geral"}</td></tr> : null;
                        grp = i.equipamento;
                        return [cab, (
                          <tr key={k} className={`border-t border-ww-border/50 ${l ? "" : "opacity-70"}`}>
                            <td className="p-1.5 text-ww-textFaint tabular-nums">{k + 1}</td>
                            <td className="p-1.5 text-ww-textMuted">{i.equipamento}</td>
                            <td className="p-1.5 text-ww-text">{i.item}{i.modelo ? <span className="text-ww-textFaint"> · {i.modelo}</span> : null}</td>
                            <td className="p-1.5 text-right tabular-nums">{i.qtd ?? "—"}</td>
                            <td className="p-1.5 text-right tabular-nums">{brl(i.custo_cp)}</td>
                            <td className="p-1.5 text-right tabular-nums">{brl(tot(i))}</td>
                            <td className="p-1.5">{l
                              ? <span className="text-emerald-700 dark:text-emerald-300">✓ na lista{l.cat_codigo ? <> · <b className="font-mono">{l.cat_codigo}</b></> : " · sem código"}{n ? <span className="text-ww-textFaint"> · linha {n}</span> : null}</span>
                              : <button type="button" className="px-1.5 rounded border border-emerald-500/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                                  title="Levar este item para a lista (casa com o catálogo no importar)" onClick={() => levarParaLista([k])}>→ lista</button>}</td>
                          </tr>)];
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-ww-border font-semibold">
                        <td className="p-1.5" colSpan={5}>Plano (RC): {cpBase.itens.length} item(ns) · {usoCp.size} na lista · {cpBase.itens.length - usoCp.size} não usado(s)</td>
                        <td className="p-1.5 text-right tabular-nums">{brl(plano)}</td>
                        <td className="p-1.5 text-[11px] font-normal text-ww-textMuted">na lista: {brl(usado)} pelo custo da RC · {brl(projUsado)} projetado</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </>);
            })()}
          <p className="text-[10.5px] text-ww-textFaint">A RC é a referência e a origem do budget de materiais — aqui só se lê. Leve um item com “→ lista” ou todos com “⤵ Levar para a lista os que faltam” (casam com o nosso código antes de entrar). Na etapa Lista você exclui, inclui e compatibiliza com o estoque.</p>
        </div>
      )}

      {subAba === "lista" && (<>
      {/* Equipamentos = chips coloridos + toolbar única à direita (spec B.2/B.3 v3). */}
      <div className="flex items-center gap-2 flex-wrap" data-chips>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => setEquipFiltro(null)} data-grupo-chip=""
            className={`inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full border text-[12px] transition ${!equipFiltro ? "border-ww-textMuted bg-ww-rowHover text-ww-text" : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            <b className="font-medium text-ww-text">Todos</b><span className="text-[11px] opacity-80">{validas.length}</span>
          </button>
          {gruposChips.map((g) => {
            const cor = corGrupo(g.k);
            const al = validas.filter((l) => normGrupo(l.equipamento || "Geral") === g.k && emRisco(l)).length;
            const on = equipFiltro === g.k;
            return (
              <button key={g.k} type="button" data-grupo-chip={g.k} onClick={() => setEquipFiltro(on ? null : g.k)}
                title={`${g.nome}${g.data ? ` · necessário em ${dia(g.data)}` : ""}${al ? ` · ${al} atrasado(s)/em risco` : ""} — clique para filtrar`}
                className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[12px] transition ${on ? "text-ww-text" : "border-ww-border bg-ww-rowHover/50 text-ww-textMuted hover:text-ww-text"}`}
                style={on ? { borderColor: cor, background: `color-mix(in srgb, ${cor} 14%, transparent)` } : undefined}>
                <i aria-hidden className="inline-block w-[9px] h-[9px] rounded-full" style={{ background: cor }} />
                <b className="font-medium text-ww-text">{g.nome}</b><span className="text-[11px] opacity-80">{g.n}</span>
                {al > 0 && <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">✕{al}</span>}
              </button>);
          })}
          <button type="button" data-novo-grupo onClick={() => setNovoGrupo({ nome: "", data: "" })}
            title={marcadas.size ? `Cria um equipamento novo com os ${marcadas.size} item(ns) marcados` : "Cria um equipamento (grupo) novo na lista"}
            className="inline-flex items-center px-2.5 py-1 rounded-full border border-dashed border-ww-accent/70 text-[12px] text-ww-accent hover:bg-ww-accentSoft">+ equipamento</button>
        </div>
        <span className="flex-1" />
        <details className="relative" data-menu="adicionar">
          <summary className="list-none cursor-pointer px-2.5 py-1 text-[12px] rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 select-none">+ Adicionar itens ▾</summary>
          <div className="absolute right-0 mt-1 z-30 min-w-[290px] rounded-lg border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-xl p-1 text-[11.5px]">
            {menuAdicionar.map((m) => (
              <button key={m.rot} type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; m.fn(); }}
                className="block w-full text-left px-2 py-1.5 rounded hover:bg-ww-rowHover">
                {m.rot}<small className="block text-[10.5px] text-ww-textFaint">{m.sub}</small>
              </button>))}
          </div>
        </details>
        <button type="button" data-compat-toggle onClick={() => setColSugManual(colSugAberta ? false : true)}
          title="Mostra/oculta a coluna de compatibilização com o estoque. Ela abre sozinha quando há item sem código."
          className={`px-2.5 py-1 text-[12px] rounded-lg border transition ${colSugAberta ? "border-amber-500/70 text-amber-800 dark:text-amber-200 bg-amber-500/10" : "border-ww-border text-ww-text hover:border-ww-accent"}`}>
          {colSugAberta ? "⚡ ocultar compatibilização" : `⚡ Compatibilizar (${pendentesSug.length})`}
        </button>
        <details className="relative" data-menu="mais">
          <summary className="list-none cursor-pointer px-2 py-1 text-[12px] rounded-lg text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover" title="Mais ações">⋯</summary>
          <div className="absolute right-0 mt-1 z-30 min-w-[260px] rounded-lg border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-xl p-1 text-[11.5px]">
            {menuMais.map((m) => (
              <button key={m.rot} type="button" disabled={m.off} onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; m.fn(); }}
                className="block w-full text-left px-2 py-1.5 rounded hover:bg-ww-rowHover disabled:opacity-40" title={m.dica}>
                {m.rot}
              </button>))}
          </div>
        </details>
      </div>

      {/* Barra de seleção (spec B.4 v3): só com itens marcados. */}
      {marcadas.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-2.5 py-1.5 rounded-[10px] border border-ww-accent bg-ww-accentSoft text-[12px]" data-selbar>
          <span><b className="text-ww-text">{marcadas.size}</b> marcados</span>
          <button type="button" onClick={() => { loteGerandoRef.current = null; abrirGerarPc(paraPc); }} disabled={!paraPc.length || !!ocupado}
            title={paraPc.length ? "Gera os pedidos de compra (um por fornecedor) com as linhas marcadas sem PC" : "As marcadas já têm PC"}
            className="px-2 py-0.5 rounded-md bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition disabled:opacity-40">
            🧾 Comprar agora{paraPc.length !== marcadas.size ? ` (${paraPc.length})` : ""}
          </button>
          <button type="button" disabled={!paraPc.length} data-planejar
            onClick={() => { setForcados(new Set(paraPc)); setSubAba("plan"); setAviso(`${paraPc.length} item(ns) enviados ao agente — os lotes com eles ficam destacados.`); setMarcadas(new Set());
              setTimeout(() => document.querySelector("[data-agente]")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }}
            title="O agente coloca os itens marcados num lote com a data certa de pedir (um PC por fornecedor por data)"
            className="px-2 py-0.5 rounded-md border border-ww-border bg-[rgb(var(--color-ww-panel))] text-[11.5px] text-ww-text hover:border-ww-accent disabled:opacity-40">
            ✨ Planejar com o agente
          </button>
          <select value="" data-mover onChange={(e) => { const v = e.target.value; if (v === "__novo") setNovoGrupo({ nome: "", data: "" }); else if (v) moverParaGrupo(v); }}
            className="rounded-md border border-ww-border bg-[rgb(var(--color-ww-panel))] px-1.5 py-0.5 text-[11.5px] text-ww-text">
            <option value="">mover para equipamento…</option>
            {gruposChips.map((g) => <option key={g.k} value={g.nome}>{g.nome}</option>)}
            <option value="__novo">+ novo equipamento…</option>
          </select>
          {[...marcadas].some((id) => linhas.find((l) => l._id === id)?._match === "sug") && (
            <button type="button" onClick={() => void aceitarSugestoes([...marcadas])}
              className="px-2 py-0.5 rounded-md border border-amber-500/70 text-amber-800 dark:text-amber-200 text-[11.5px] hover:bg-amber-500/10 transition">
              ✓ Aceitar sugestões dos marcados ({[...marcadas].filter((id) => linhas.find((l) => l._id === id)?._match === "sug").length})
            </button>
          )}
          <button type="button" onClick={() => setPicker(true)} title="Ligar as marcadas a um pedido de compra que já existe"
            className="px-2 py-0.5 rounded-md text-[11.5px] text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover">⇄ vincular a um PC</button>
          <button type="button" onClick={() => excluirLinhas([...marcadas])}
            className="px-2 py-0.5 rounded-md text-[11.5px] text-ww-textMuted hover:text-rose-500 hover:bg-rose-500/10">🗑 Excluir</button>
          <span className="flex-1" />
          <button type="button" onClick={() => setMarcadas(new Set())} className="text-[11px] text-ww-textMuted hover:text-ww-text">limpar</button>
        </div>
      )}

      {filtroPcNum && (
        <div className="flex items-center gap-2 rounded-lg border border-ww-accent/50 bg-ww-accentSoft px-2.5 py-1.5 text-[11.5px]">
          <span>Mostrando só as linhas do <b className="font-mono">PC {filtroPcNum}</b></span>
          <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setFiltroPcNum(null)}>ver a lista toda</button>
        </div>
      )}
      {/* Filtros = segmentado pequeno "mostrar" (spec B.5 v3) — sem cor de grupo. */}
      <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
        <span className="text-[11px] text-ww-textMuted">mostrar</span>
        <div className="inline-flex rounded-lg border border-ww-border overflow-hidden" data-filtros>
          {(["todas", "sem_cod", "sem_pc", "risco"] as const).map((k, i) => {
            const n = k === "sem_cod" ? nSemCod : k === "sem_pc" ? validas.length - nComPc : k === "risco" ? validas.filter(emRisco).length : null;
            return (
              <button key={k} type="button" onClick={() => setFiltroPc(k)} data-filtro={k}
                title={k === "risco" ? `Sem PC e já devia ter comprado ou comprar nos próximos 7 dias; ou chega com menos de ${FOLGA_ENTREGA_DIAS} dias de folga, depois do necessário, ou o PC está atrasado` : undefined}
                className={`px-2.5 py-0.5 transition ${i ? "border-l border-ww-border" : ""} ${filtroPc === k ? "bg-[rgb(var(--color-ww-panel))] text-ww-text shadow-[inset_0_0_0_1px_rgb(var(--color-ww-accent))]" : k === "risco" ? "text-rose-600 dark:text-rose-400" : "text-ww-textMuted hover:text-ww-text"}`}>
                {k === "todas" ? "Todos" : k === "sem_cod" ? "⌕ Sem código" : k === "sem_pc" ? "Sem PC" : "✕ Atrasados / em risco"}
                {n != null && <span className="ml-1 text-[10.5px] opacity-80">{n}</span>}
              </button>);
          })}
        </div>
        <span className="flex-1" />
        {sugBuscando && <span className="text-[10.5px] text-ww-textFaint">buscando sugestões…</span>}
        {sugErro && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-rose-500/50 bg-rose-500/10 text-[10.5px] text-rose-700 dark:text-rose-300" title={sugErro}>
            Não consegui buscar sugestões
            <button type="button" className="underline font-semibold" onClick={() => { setSugErro(null); setSugTentativa((n) => n + 1); }}>tentar de novo</button>
          </span>)}
        {colSugAberta && pendentesSug.length > 0
          ? <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">⚠ {pendentesSug.length} item(ns) sem código — compatibilize na coluna âmbar; ela some quando terminar</span>
          : <span className="text-[10.5px] text-ww-textFaint">✓ {nCod} com código · ⌕ {nSemCod} sem código</span>}
        {sujo && !salvando && !semAutosave && remocao == null && <span className="text-[10.5px] text-ww-textFaint">salvando…</span>}
        {salvando && <span className="text-[10.5px] text-ww-textFaint">salvando…</span>}
        {/* Salvamento automático parado: diz por quê e oferece o botão (spec C.6) */}
        {sujo && semAutosave && !salvando && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-500/60 bg-amber-500/10 text-[10.5px] text-amber-800 dark:text-amber-200"
            title="Enquanto isto estiver aqui, as mudanças NÃO vão para o sistema sozinhas">
            ⚠ não está salvando: {semAutosave}
          </span>)}
        {sujo && semAutosave && semAutosave !== "a lista não carregou" && (
          <button type="button" onClick={() => void salvar()} disabled={salvando}
            className="px-2.5 py-0.5 text-[11.5px] rounded-lg border border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110 transition">
            {salvando ? "…" : "Salvar lista"}
          </button>
        )}
      </div>

      {aceiteDesfazer && (
        <div className="flex items-center gap-3 flex-wrap p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[12px] text-emerald-800 dark:text-emerald-200">
          <span>{aceiteDesfazer.n} sugestão(ões) aceita(s) — viraram código confirmado.</span>
          <button type="button" onClick={() => { setLinhas(aceiteDesfazer.antes); setSujo(true); setAceiteDesfazer(null); setAviso("Aceite desfeito — as linhas voltaram a sugestão."); }}
            className="ml-auto px-2 py-0.5 rounded border border-emerald-500/60 font-semibold hover:bg-emerald-500/10">Desfazer</button>
          <button type="button" onClick={() => setAceiteDesfazer(null)} className="text-[11px] opacity-70 hover:opacity-100">ok</button>
        </div>
      )}
      {remocao && (
        <div className="flex items-center gap-3 flex-wrap p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-800 dark:text-rose-200">
          <span>{remocao.n} linha(s) excluída(s){remocao.comPc ? ` (${remocao.comPc} com PC — o pedido de compra não muda)` : ""}
            {remocao.erro ? <> · <b>não gravou</b>: {remocao.erro}</> : " · grava em instantes"}</span>
          {remocao.erro && <button type="button" onClick={() => { setRemocao((x) => (x ? { ...x, erro: undefined } : x)); setErro(null); void salvarRef.current?.(true, true); }}
            className="ml-auto px-2 py-0.5 rounded border border-rose-400/60 hover:bg-rose-500/10">Tentar de novo</button>}
          <button type="button" onClick={desfazerExclusao} className={`${remocao.erro ? "" : "ml-auto "}px-2 py-0.5 rounded border border-rose-400/60 font-semibold hover:bg-rose-500/10`}>Desfazer</button>
        </div>
      )}
      {sujo && validas.length < original && !remocao && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Você tinha {original} item(ns) e agora há {validas.length}. Salvar vai <strong>remover</strong> a
          diferença — a lista gravada passa a ser exatamente o que está nesta grade.
        </div>
      )}

      {sugestoes && (
        <SugestoesVinculo sugestoes={sugestoes} ocupado={ocupado} onConfirmar={(c) => void confirmarSugestao(c)} onFechar={() => setSugestoes(null)} />
      )}

      {carregando
        ? <p className="text-[11.5px] text-ww-textFaint py-3">Carregando a lista…</p>
        : <GradeEditavel cols={colunasGrade} linhas={visiveis} botaoLinha={false} herdarNoColar={["equipamento"]}
            grupo={{ de: (l) => (String(l.item ?? "").trim() ? normGrupo(l.equipamento || "Geral") : null), cab: cabecalhoGrupo, cor: corGrupo }}
            corLinha={(l) => (String(l.item ?? "").trim() || l.equipamento ? corGrupo(normGrupo(l.equipamento || "Geral")) : null)}
            colarExtras={[{ label: "Equipamento", key: "equipamento" }, { label: "Grupo", key: "equipamento" }, { label: "Modelo", key: "modelo" }, { label: "PC", key: "pc_numero" }, { label: "PC nº", key: "pc_numero" }, { label: "Observação", key: "observacao" }, { label: "Obs", key: "observacao" }]}
            aoColar={() => setCasarAposColar(true)}
            onChange={(l) => {
              // Com filtro ativo, o que volta é só o pedaço visível — recompõe
              // com o resto para não apagar o que está escondido.
              if (equipFiltro || filtroPc !== "todas" || filtroPcNum) {
                const ids = new Set(visiveis.map((x) => x._id));
                const ocultas = linhas.filter((x) => x.item?.trim() && !ids.has(x._id));
                setLinhas([...ocultas, ...l]);
              } else setLinhas(l);
              setSujo(true);
            }}
            altura={560}
            aoRemover={(id) => excluirLinhas([id])}
            selecao={{
              marcadas,
              podeMarcar: (l) => l._id.startsWith("db"),
              onAlternar: alternar,
              onTodas: (marcar) => setMarcadas(marcar
                ? new Set(visiveis.filter((l) => l._id.startsWith("db")).map((l) => l._id))
                : new Set()),
            }}
            vazioMsg="Digite, cole do Excel (Ctrl+V) ou use + Adicionar itens." />}

      {/* "Comprado fora da lista" saiu da tela (07/10/26, Benny): só pelo ⋯ › PCs com itens fora da
          lista. O valor continua no comprometido do resumo (cada PC do projeto conta). */}
      {cmp && foraAberto && <ForaDaLista fora={cmp.fora_da_lista} empresa={empresa} />}
      {cmp && <FluxoCompras d={cmp} />}
      </>)}

      {subAba === "plan" && (
        <PlanejamentoCompras itens={itensPlano} podeGerar={!sujo} onAbrirPrazos={() => setPrazosAberto(true)}
          onGerarPc={(ids) => { loteGerandoRef.current = null; abrirGerarPc(ids.filter((id) => id.startsWith("db"))); }}>
          <AgenteCompras empresa={empresa} codigo={codigoProjeto} itens={itensPlano} forcados={forcados} podeGerar={!sujo} recarregarToken={recargas}
            onGerarPc={(ids, loteId) => { loteGerandoRef.current = loteId; abrirGerarPc(ids.filter((id) => id.startsWith("db"))); }} />
        </PlanejamentoCompras>
      )}
      {prazosAberto && (
        <PrazosFornecedorModal empresa={empresa} prazos={prazos}
          daLista={[...validas.filter((l) => l.cat_fornecedor && !temPc(l)).reduce((m, l) => m.set(l.cat_fornecedor, (m.get(l.cat_fornecedor) ?? 0) + 1), new Map<string, number>())]
            .map(([nome, itens]) => ({ nome, itens })).sort((a, b) => b.itens - a.itens)}
          onFechar={() => setPrazosAberto(false)}
          onSalvo={(alt) => {
            // reflete na hora (o planejamento recalcula) e relê do servidor
            setPrazos((m) => { const n = new Map(m); for (const a of alt) { const k = normFornecedor(a.nome); const p = n.get(k); n.set(k, { norm: k, nome: p?.nome ?? a.nome, historico: p?.historico ?? null, manual: a.manual }); } return n; });
            setPrazosAberto(false);
            setAviso(`Prazos salvos (${alt.length}) — o planejamento foi recalculado.`);
            void carregarPrazos();
          }} />
      )}

      {comentLinha && createPortal((() => {
        const l = linhas.find((x) => x._id === comentLinha);
        if (!l) return null;
        const conv = conversa(l);
        const salva = l._id.startsWith("db");
        const quem = (a: string) => (a.includes("@") ? a.split("@")[0] : a);
        return (
          <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-start justify-center sm:pt-[14vh]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setComentLinha(null); }}>
            <div role="dialog" aria-label="Comentários da linha"
              className="w-full sm:w-[min(520px,96vw)] max-h-[80vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-3.5 space-y-2 text-[12px]">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-ww-text">💬 Comentários</h4>
                  <p className="text-[11px] text-ww-textMuted truncate">{l.cat_codigo ? `${l.cat_codigo} · ` : ""}{l._cat_desc || l.item}</p>
                </div>
                <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setComentLinha(null)}>fechar</button>
              </div>
              {!conv.length && <p className="text-ww-textFaint">Nenhum comentário nesta linha.</p>}
              {conv.map((c) => (
                <div key={String(c.id)} className="rounded-lg border border-ww-border/70 px-2.5 py-1.5">
                  <div className="text-[10.5px] text-ww-textMuted">
                    <b className="text-ww-text">{quem(c.autor)}</b>{c.criado_em ? ` · ${new Date(c.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                    {c.origem === "observacao" && <span className="text-ww-textFaint"> · observação da lista</span>}
                  </div>
                  <div className="text-ww-text whitespace-pre-wrap">{c.texto}</div>
                </div>))}
              {comentPendente
                ? <p className="text-[11px] text-amber-700 dark:text-amber-300">Comentários ainda não ativados (migração sql/101 pendente) — por enquanto aparece só a observação da linha.</p>
                : !salva
                  ? <p className="text-[11px] text-ww-textFaint">Salve a lista para comentar esta linha.</p>
                  : <div className="space-y-1.5">
                      <textarea value={comentTexto} onChange={(e) => setComentTexto(e.target.value)} rows={3} autoFocus
                        placeholder="Escreva um comentário…"
                        className="w-full rounded-lg border border-ww-border bg-transparent px-2 py-1.5 text-[12px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
                      <div className="flex justify-end">
                        <button type="button" disabled={!comentTexto.trim() || comentando}
                          onClick={() => void comentar(l._id)}
                          className="px-3 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold disabled:opacity-40">
                          {comentando ? "Gravando…" : "Comentar"}
                        </button>
                      </div>
                    </div>}
            </div>
          </div>);
      })(), document.body)}

      {vincLinha && createPortal((() => {
        const l = linhas.find((x) => x._id === vincLinha);
        const sug = (sugTodas ?? []).filter((c) => `db${c.lista_id}` === vincLinha);
        return (
          <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-start justify-center sm:pt-[12vh]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setVincLinha(null); }}>
            <div role="dialog" aria-label="Vincular a um PC"
              className="w-full sm:w-[min(640px,96vw)] max-h-[80vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-3.5 space-y-2 text-[12px]">
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-ww-text">Vincular a um pedido de compra</h4>
                  <p className="text-[11px] text-ww-textMuted truncate">{l?.cat_codigo ? `${l.cat_codigo} · ` : ""}{l?._cat_desc || l?.item}</p>
                </div>
                <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setVincLinha(null)}>fechar</button>
              </div>
              <div className="text-[11px] font-semibold text-ww-text">Itens de PC do projeto parecidos com esta linha</div>
              {sugTodas == null ? <p className="text-ww-textFaint">procurando…</p>
                : !sug.length ? <p className="text-ww-textFaint">Nenhum item de PC parecido — procure o PC abaixo.</p>
                : sug.map((c) => (
                  <div key={`${c.pc_item_id}`} className="flex items-center gap-2 border-t border-ww-border/60 pt-1.5">
                    <div className="min-w-0 flex-1">
                      <b>PC {c.pc}</b> — {c.desc_pc}
                      <span className="block text-[10.5px] text-ww-textMuted">{c.via === "codigo" ? "código igual" : `semelhança ${Math.round(Number(c.score) * 100)}%`}{!c.medidas_ok && c.via !== "codigo" ? " · medidas diferentes" : ""}</span>
                    </div>
                    <button type="button" disabled={ocupado === `v${c.lista_id}`}
                      className="px-2 py-0.5 rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft"
                      onClick={() => void confirmarSugestao(c).then(() => setVincLinha(null))}>Vincular</button>
                  </div>))}
              <div className="pt-1.5 border-t border-ww-border/60">
                <button type="button" className="px-2.5 py-1 rounded-lg border border-ww-border hover:bg-ww-rowHover"
                  onClick={() => { setVincBusca([vincLinha]); setVincLinha(null); setPicker(true); }}>
                  Procurar PC por número ou fornecedor…
                </button>
              </div>
            </div>
          </div>);
      })(), document.body)}

      {novoGrupo && createPortal(
        <div className="fixed inset-0 z-[120] bg-black/45 flex items-start justify-center pt-[14vh] px-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setNovoGrupo(null); }}>
          <div role="dialog" aria-label="Novo equipamento" className="w-full max-w-[460px] rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl text-[12px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ww-border">
              <b className="text-[14px] text-ww-text">Novo equipamento (grupo)</b>
              <button type="button" className="text-ww-textMuted hover:text-ww-text" onClick={() => setNovoGrupo(null)}>✕</button>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              <label className="block text-[11px] text-ww-textMuted">Nome
                <input autoFocus list="grupos-cadastro" value={novoGrupo.nome} placeholder="ex.: Filtro Polidor, Tanque de contato…"
                  onChange={(e) => setNovoGrupo({ ...novoGrupo, nome: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") criarGrupo(); }}
                  className="mt-1 block w-full rounded-md border border-ww-border bg-transparent px-2 py-1 text-[12.5px] text-ww-text" />
              </label>
              <datalist id="grupos-cadastro">
                {[...new Set([...nomesPadrao, ...(gruposMeta?.emUso ?? []).map((u) => u.nome)])].map((n) => <option key={n} value={n} />)}
              </datalist>
              <label className="block text-[11px] text-ww-textMuted">Necessário em
                <input type="date" value={novoGrupo.data} onChange={(e) => setNovoGrupo({ ...novoGrupo, data: e.target.value })}
                  className="mt-1 block rounded-md border border-ww-border bg-transparent px-2 py-1 text-[12.5px] text-ww-text" />
              </label>
              <p className="text-[11px] text-ww-textFaint">{marcadas.size
                ? `Os ${marcadas.size} item(ns) marcados na lista entram neste grupo.`
                : "Nenhum item marcado: o grupo nasce com uma linha vazia para digitar."} Depois dá para mover mais itens pela barra de seleção.</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-ww-border">
              <button type="button" className="px-3 py-1 rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text" onClick={() => setNovoGrupo(null)}>Cancelar</button>
              <button type="button" className="px-3 py-1 rounded-lg bg-ww-accent text-white font-semibold disabled:opacity-40" disabled={novoGrupo.nome.trim().length < 2} onClick={criarGrupo}>Criar</button>
            </div>
          </div>
        </div>, document.body)}
      {addModal && (
        <AdicionarItensModal empresa={empresa} modoInicial={addModal}
          grupos={[...gruposChips].sort((a, b) => Number(b.k === equipFiltro) - Number(a.k === equipFiltro)).map((g) => ({ k: g.k, nome: g.nome, data: g.data }))}
          onAdicionar={adicionarLinhasNovas} onFechar={() => setAddModal(null)} />
      )}
      {gerarPcLinhas && (
        <GerarPcDaLista empresa={empresa} codigoProjeto={codigoProjeto} linhas={gerarPcLinhas}
          onFechar={() => { loteGerandoRef.current = null; setGerarPcLinhas(null); }}
          onFeito={(nums) => {
            // lote agendado do agente que virou PC pela folha: marca "gerado" (spec F)
            const lote = loteGerandoRef.current; loteGerandoRef.current = null;
            if (lote && nums[0]) void fetch("/api/rc-projetos/lotes", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ acao: "gerado", empresa, codigo: codigoProjeto, id: lote, pedido_num: nums[0] }) }).catch(() => null);
            setGerarPcLinhas(null); setMarcadas(new Set()); setAviso(`Pedido(s) de compra criado(s): ${nums.map((n) => `PC ${n}`).join(", ")} — já ligados às linhas da lista; seguem para aprovação.`); void carregar(); onGravado?.(); }} />
      )}
      {usarCpEm && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-start justify-center sm:pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setUsarCpEm(null); }}>
          <div role="dialog" aria-label="Usar item da RC" className="w-full sm:w-[min(720px,96vw)] max-h-[80vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-3.5 space-y-2 text-[12px]">
            <div className="flex items-start gap-2">
              <div><h4 className="text-[13px] font-semibold text-ww-text">Usar item da RC nesta linha</h4>
                <p className="text-[11px] text-ww-textMuted">Itens da RC que ainda não estão na lista. A linha recebe descrição, qtd, equipamento e o custo da RC (se não tiver valor) e passa pelo catálogo.</p></div>
              <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setUsarCpEm(null)}>fechar</button>
            </div>
            <input autoFocus placeholder="filtrar…" value={usarCpBusca} onChange={(e) => setUsarCpBusca(e.target.value)}
              className="w-full rounded-md border border-ww-border bg-transparent px-2 py-1 text-[12px] text-ww-text" />
            {cpNaoUsados.filter(({ i }) => !usarCpBusca.trim() || normT(`${i.equipamento} ${i.item} ${i.modelo ?? ""}`).includes(normT(usarCpBusca))).map(({ i, k }) => (
              <button key={k} type="button" onClick={() => void usarItemCp(usarCpEm, k)}
                className="w-full text-left flex items-center gap-2 border-t border-ww-border/60 pt-1.5 hover:bg-ww-rowHover rounded px-1">
                <span className="text-ww-textMuted w-32 truncate" title={i.equipamento}>{i.equipamento}</span>
                <span className="flex-1 truncate" title={i.item}>{i.item}{i.modelo ? <span className="text-ww-textFaint"> · {i.modelo}</span> : null}</span>
                <span className="tabular-nums text-ww-textMuted">{i.qtd ?? "—"} × {brl(i.custo_cp)}</span>
              </button>))}
            {!cpNaoUsados.length && <p className="text-ww-textFaint">Todos os itens da RC já estão na lista.</p>}
          </div>
        </div>, document.body)}
      {importarAberto && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-end sm:items-start justify-center sm:pt-[5vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) setImportarAberto(false); }}>
          <div role="dialog" aria-label="Importar para a lista" className="w-full sm:w-[min(1100px,97vw)] max-h-[90vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-3.5 space-y-2.5 text-[12px]">
            <div className="flex items-start gap-2">
              <div><h4 className="text-[14px] font-semibold text-ww-text">Importar itens da RC para a lista</h4>
                <p className="text-[11px] text-ww-textMuted">Cada item da RC vem casado com o nosso catálogo (✓ certo · ⚠ sugestão · sem correspondência). Sugestão entra na lista como sugestão (âmbar) — aceite lá na coluna “Compatibilizar com o estoque” (✓ ou “✓ aceitar as melhores”). Marque o que entra e adicione; o que já está na lista fica apagado.<br /><span className="text-ww-textFaint">No catálogo: <b className="text-emerald-600">✓</b> casado sozinho · <b className="text-sky-600">✋</b> já escolhido à mão antes (o de-para guardou a escolha para este texto) · <b className="text-amber-600">⚠</b> sugestão · “sem correspondência” = nada parecido no estoque.</span></p></div>
              <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setImportarAberto(false)}>fechar</button>
            </div>
            {/* RC já lançada em Compras (nº da RC): entra com o vínculo, para os PCs cobrirem a RC */}
            {rcsAbertas && rcsAbertas.length > 0 && (
              <div className="rounded-lg border border-ww-border p-2.5 space-y-1">
                <div className="text-[11.5px] font-semibold text-ww-text">RC lançada em Compras <small className="font-normal text-ww-textFaint">— traz os itens já ligados ao documento da RC (os PCs gerados pela lista ficam cobrindo a RC)</small></div>
                {rcsAbertas.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 border-t border-ww-border/60 pt-1.5">
                    <div className="flex-1"><b>RC {r.num}</b> <span className="text-ww-textMuted">· {r.itens} item(ns), {r.na_lista} já na lista · {brl(r.valor)}</span></div>
                    <button type="button" disabled={!!ocupado} onClick={() => void importarRc(r.id)}
                      className="px-2 py-0.5 rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft disabled:opacity-40">
                      {ocupado === `rc${r.id}` ? "…" : `Trazer ${r.itens - r.na_lista} (casando com o catálogo)`}
                    </button>
                  </div>))}
              </div>
            )}
            <div className="space-y-2">
          {cpCarregando && <p className="text-[11.5px] text-ww-textFaint py-3">Lendo a RC no CRM e casando com o catálogo…</p>}
          {cpErro && <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">Não consegui trazer a RC: {cpErro}</div>}
          {cp && !cp.proposta && (
            <p className="text-[12px] text-ww-textMuted py-3">
              Este projeto não tem proposta ligada no CRM. No CRM, ligue a proposta ao projeto no fechamento (Recebimento → projeto do painel).
            </p>
          )}
          {cp?.proposta && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={adicionarDaCp} disabled={!cpMarcados.size}
                  className="px-3 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition disabled:opacity-40">
                  Adicionar {cpMarcados.size || ""} à lista
                </button>
                <button type="button" className="text-[11px] text-ww-accent hover:underline"
                  title="Marca TODOS os itens da RC que ainda não estão na lista (com código, com sugestão e sem código)"
                  onClick={() => setCpMarcados(new Set(cp.itens.map((_, k) => k).filter((k) => !usoCp.has(k))))}>
                  marcar todos que faltam ({cp.itens.filter((_, k) => !usoCp.has(k)).length})
                </button>
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text"
                  title="Marca só os que faltam e já têm código do nosso estoque (✓ automático ou ✋ escolhido antes)"
                  onClick={() => setCpMarcados(new Set(cp.itens.map((it, k) => [it, k] as const)
                    .filter(([it, k]) => casado(it) && !usoCp.has(k)).map(([, k]) => k)))}>
                  só os que já têm código
                </button>
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => setCpMarcados(new Set())}>limpar</button>
                <span className="text-[10.5px] text-ww-textFaint">
                  {cp.itens.filter(casado).length} de {cp.itens.length} casado(s)
                </span>
                <button type="button" className="ml-auto text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => void carregarCp()}>↻ reler a RC</button>
              </div>
              <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 480 }}>
                <table className="w-full text-[11.5px] border-collapse">
                  <thead className="sticky top-0 bg-ww-panel text-ww-textMuted z-[1]">
                    <tr className="text-left">
                      <th className="p-1.5 w-7">{(() => {
                        const falta = cp.itens.map((_, k) => k).filter((k) => !usoCp.has(k));
                        const todos = falta.length > 0 && falta.every((k) => cpMarcados.has(k));
                        return <input type="checkbox" title="Marcar / desmarcar todos os que faltam" checked={todos} disabled={!falta.length}
                          onChange={() => setCpMarcados(todos ? new Set() : new Set(falta))} />;
                      })()}</th>
                      <th className="p-1.5">Equipamento</th>
                      <th className="p-1.5">Item da RC</th>
                      <th className="p-1.5 text-right">Qtd</th>
                      <th className="p-1.5 text-right">Custo RC</th>
                      <th className="p-1.5">No catálogo</th>
                      <th className="p-1.5 text-right">Últ. preço</th>
                      <th className="p-1.5">Fornecedor</th>
                      <th className="p-1.5">Entrega · Fatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cp.itens.map((it, k) => {
                      const ja = usoCp.has(k);
                      const c = it.casamento;
                      const m = c?.melhor;
                      const st = c?.status ?? "sem";
                      const ok = casado(it);
                      return (
                        <tr key={k} className={`border-t border-ww-border/50 ${ja ? "opacity-50" : ""}`}>
                          <td className="p-1.5 text-center">
                            {ja ? <span title="Já está na lista">✓</span>
                              : <input type="checkbox" checked={cpMarcados.has(k)}
                                  title={ok ? "Adicionar à lista" : "Sem item nosso casado — entra como “sem código” (âmbar) para resolver depois; ou case agora em “No catálogo”"}
                                  onChange={() => setCpMarcados((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />}
                          </td>
                          <td className="p-1.5 text-ww-textMuted">{it.equipamento}</td>
                          <td className="p-1.5 text-ww-text">{it.item}{it.modelo ? <span className="text-ww-textFaint"> · {it.modelo}</span> : null}</td>
                          <td className="p-1.5 text-right tabular-nums">{it.qtd ?? "—"}</td>
                          <td className="p-1.5 text-right tabular-nums">{brl(it.custo_cp)}</td>
                          <td className="p-1.5">
                            <button type="button" disabled={ja} onClick={() => setSeletor({ alvo: "cp", k })}
                              className="text-left hover:underline disabled:no-underline max-w-[300px]"
                              title={m ? `${m.codigo ?? ""} — ${m.descricao}${m.motivo ? ` (${m.motivo})` : ""} · clique para trocar` : "Clique para procurar, escolher ou criar o item nosso"}>
                              {!m ? <span className="text-ww-textFaint">sem correspondência · <span className="text-ww-accent">escolher</span></span>
                                : st === "ok"
                                  ? <span className="text-ww-textMuted">{c.manual ? <span className="text-sky-700 dark:text-sky-300" title="Escolhido à mão (de-para)">✋ </span> : <span className="text-emerald-600 dark:text-emerald-400">✓ </span>}
                                      <b className="text-ww-text">{m.codigo}</b> {m.descricao.length > 40 ? `${m.descricao.slice(0, 40)}…` : m.descricao}</span>
                                  : <span className="text-amber-700 dark:text-amber-300">⚠ <b>{m.codigo}</b> {(m.score ?? 0) >= SUG_MIN ? `(sugestão ${Math.round((m.score ?? 0) * 100)}%)` : "(conferir)"} {m.descricao.length > 30 ? `${m.descricao.slice(0, 30)}…` : m.descricao}</span>}
                            </button>
                          </td>
                          <td className="p-1.5 text-right tabular-nums">{m ? brl(m.ultimo_preco) : "—"}</td>
                          <td className="p-1.5 text-ww-textMuted">{m?.fornecedor ?? "—"}</td>
                          <td className="p-1.5 text-ww-textMuted tabular-nums">
                            {m ? `${m.entrega_dias != null ? `${m.entrega_dias}d` : "—"} · ${m.fat_dias != null ? `${m.fat_dias}d` : "—"}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10.5px] text-ww-textFaint">
                Clique em “No catálogo” para resolver o que ficou ⚠ conferir ou sem correspondência (sugestões, busca, criar item nosso) —
                a escolha fica gravada para o mesmo texto. Item sem código marcado entra “sem código” (âmbar) para resolver depois; desmarque
                para pular. O valor vem do último preço pago; sem compra anterior, do custo da RC. Itens já na lista ficam apagados.
              </p>
            </>
          )}
            </div>
          </div>
        </div>, document.body)}
      {picker && createPortal(
        <PcPickerModal empresa={empresa} codigoProjeto={codigoProjeto}
          title={vincBusca ? "Vincular a linha a um PC" : `Vincular ${marcadas.size} item(ns) a um PC`}
          onClose={() => { setPicker(false); setVincBusca(null); }} onConfirm={vincular} />
      , document.body)}

      {seletor && seletorDados && createPortal(
        <div className="ne-acerto-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) setSeletor(null); }}>
          <AcertoItemEstoque empresa={empresa} modo="lista"
            compra={{ n_cod_prod: 0, codigo: null, descricao: seletorDados.texto, unidade: null, ultimo_preco: seletorDados.custo ?? null, fornecedor: null, ncm: null }}
            sugeridas={seletorDados.cas?.alternativas?.length
              ? seletorDados.cas.alternativas.map((a) => ({ id: a.ncod_prod, cod: a.codigo ?? "", desc: a.descricao, un: a.unidade ?? "", score: a.score ?? 0, motivo: a.motivo ?? "" }))
              : undefined}
            compraAlternativas={(seletorDados.cas?.compra ?? []).map((c): Compra => ({ n_cod_prod: c.ncod_prod, codigo: c.codigo, descricao: c.descricao,
              unidade: c.unidade, ultimo_preco: c.ultimo_preco, fornecedor: c.fornecedor, ncm: null }))}
            onFechar={() => setSeletor(null)}
            onEscolhido={(it) => void escolher(seletor, it)} />
        </div>
      , document.body)}
    </section>
  );
}
