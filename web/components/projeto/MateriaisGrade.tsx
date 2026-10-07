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
import AcertoItemEstoque, { type Compra, type Escolhido } from "@/components/faturamento/AcertoItemEstoque";
import "@/components/faturamento/nova-emissao.css";
import { CSS_CDL, KpisCompras, SugestoesVinculo, ForaDaLista, FluxoCompras, situacaoPc,
         type DadosCompras, type CasamentoPc } from "./ComprasDaLista";
import { supaBrowser } from "@/lib/supabase";
import { deHtml } from "@/lib/match-pc";
import { normGrupo, dataDoGrupo, aplicarDataGrupo, nomePadrao } from "@/lib/grupos-equipamento-puro";
import { estadoPc, dicaEstadoPc, LEGENDA_SITUACAO } from "@/lib/situacao-pc";
import { sinalEntrega, FOLGA_ENTREGA_DIAS, type SinalEntrega } from "@/lib/sinal-entrega";

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

/** Item do catálogo da lista (lib/catalogo-projeto): item NOSSO (código novo) ou, à parte, só do Omie. */
type Cat = {
  ncod_prod: number; codigo: string | null; codigo_omie?: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; ultima_compra: string | null; fornecedor: string | null;
  qtd_compras: number | null; entrega_dias: number | null; entrega_fonte: string | null;
  fat_dias: number | null; nativo?: boolean; via?: string | null; score?: number; motivo?: string; medidas_ok?: boolean;
};
type Casamento = { idx: number; status: "ok" | "conferir" | "sem"; manual?: boolean; melhor: Cat | null; alternativas: Cat[]; compra?: Cat[] };

/** Campos que o catálogo preenche na linha. `_match` e `_alts` só vivem na tela. */
const CAT_CAMPOS = ["cat_ncod_prod", "cat_codigo", "cat_valor_unit", "cat_fornecedor",
                    "cat_entrega_dias", "cat_fat_dias", "_match", "_alts", "_vu_fonte", "_cat_desc"];
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
const textoCasar = (item: string, modelo?: string | null) => [item, modelo].filter(Boolean).join(" ");

type ItemCpBase = { equipamento: string; item: string; qtd: number | null; modelo: string | null; custo_cp: number | null };
type GruposMeta = { cadastro: string[] | null; emUso: { nome: string; projetos: number }[];
  prazo: { data: string | null; fonte: string | null; grupos: string[] } };
type Seletor = { alvo: "cp"; k: number } | { alvo: "lista"; id: string };

export default function MateriaisGrade({
  empresa, codigoProjeto, onGravado,
}: {
  empresa: string; codigoProjeto: number; onGravado?: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaGrade[]>([vazia()]);
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
  const [filtroPc, setFiltroPc] = useState<"todas" | "sem_pc" | "com_pc" | "risco" | "atrasado" | "pc_atrasado">("todas");
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
        prazoDias: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null,
      }));
    }
    return m;
  }, [linhas, cmpPorId, cmp]);
  dataGrupoRef.current = dataGrupo;

  // ── Seletor de item do catálogo (linha da CP ou da lista) ────────────────
  const [seletor, setSeletor] = useState<Seletor | null>(null);
  /** Linha sem PC com o "vincular" aberto (sugestões de vínculo + busca de PC). */
  const [vincLinha, setVincLinha] = useState<string | null>(null);
  const [vincBusca, setVincBusca] = useState<string[] | null>(null);
  const [painelDatas, setPainelDatas] = useState(false);

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
  /* 07/10/26 (redesenho pedido pelo Benny no PJ361): Código antes do Item; casado,
     o Item mostra a descrição do catálogo (o texto original fica na dica); a antiga
     coluna Catálogo virou o ícone ao lado do código; sem Modelo (o dado continua na
     linha); PC + situação + vínculo numa coluna só, com "vincular" na própria linha;
     tudo numa linha só, com reticências, e as colunas até o Item presas ao rolar. */
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
    { key: "equipamento", label: "Equipamento", w: 88, fixa: true,
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
    { key: "cat_codigo", label: "Código", w: 88, fixa: true, pularNoColar: true,
      limpaAoEditar: ["cat_ncod_prod", "_match", "_alts", "_cat_desc"],
      marca: (l) => (String(l.item ?? "").trim() && (!l.cat_ncod_prod || l._match === "omie")
        ? { classe: "bg-amber-500/15", etiqueta: l.cat_codigo ? "" : l._omie ? `Omie ${l._omie}` : "sem código",
            dica: l._omie ? `Só no Omie (${l._omie}), sem item do nosso estoque` : "Sem item do nosso estoque" } : null),
      acao: {
        rot: (l) => (l.cat_ncod_prod && l._match !== "omie" ? (l._match === "conferir" ? "⚠" : "✓") : "⌕"),
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
        return <span className="text-[10.5px] text-ww-textFaint">PC sem prev.</span>;
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
    { key: "cat_valor_unit", label: "Valor unit.", w: 84, tipo: "moeda", alinhaDireita: true,
      dicaCab: "Valor unitário estimado da linha. Vazio, vem do PC, senão do último preço do catálogo, senão do custo da RC (a origem aparece pequena na célula).",
      marca: (l) => {
        const f = l._vu_fonte;
        if (!f || !String(l.cat_valor_unit ?? "").trim()) return null;
        return { etiqueta: f === "pc" ? "PC" : f === "CP" ? "RC" : "cat.",
          dica: f === "pc" ? "Preço unitário da linha do pedido de compra" : f === "CP" ? "Custo da RC (composição de preço da proposta) — sem compra anterior" : "Último preço pago (catálogo)" };
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
        if (l.cat_fornecedor) return <span className="text-ww-textMuted italic">{l.cat_fornecedor}</span>;
        return <span className="text-ww-textFaint">—</span>;
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
  ], [empresa, cmp, cmpPorId, nomesPadrao, gruposMeta, abrirSeletorLista, PC, conversa, sinais, origemCp, cpNaoUsados]);

  /** A leitura inicial funcionou?
   *
   *  Falso enquanto não carregou e depois de qualquer falha. Salvar com isto
   *  falso mandaria uma lista vazia por cima do que está no banco — a rota já
   *  trava, mas a tela não deve nem tentar. */
  const [carregouOk, setCarregouOk] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    // compras do projeto saem JUNTO com a lista (não depois): é a chamada mais demorada
    const pCompras = carregarCompras();
    void carregarComentarios();
    try {
      const supa = supaBrowser();
      const approval = supa.schema("approval" as never);
      const itens = await approval.from("v_rc_projetos_itens")
        .select("id, equipamento, item, qtd, modelo, observacao, pc_numero, nome_fornecedor, dt_previsao, nova_prev_materiais, mt_data_recebimento_nf, pc_etapa_texto, cat_ncod_prod, cat_codigo, cat_valor_unit, cat_fornecedor, cat_entrega_dias, cat_fat_dias, un, data_necessaria")
        .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto)
        .order("equipamento", { ascending: true }).order("item", { ascending: true });
      // Sem marcar a carga como OK, a tela fica indistinguível de "projeto
      // vazio" — e foi assim que salvar por cima apagou lista alheia.
      if (itens.error) { setErro(itens.error.message); setCarregouOk(false); return; }
      const rows = (itens.data ?? []) as ItemRow[];
      setOriginal(rows.length);
      setLinhas([
        ...rows.map((r) => ({
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
        })) as LinhaGrade[],
        vazia(),
      ]);
      setSujo(false); setErro(null); setMarcadas(new Set()); setCarregouOk(true);
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
      setAviso(`${mudou} ajuste(s) automático(s) na lista: código do Omie trocado pelo item nosso e/ou valor unit. vazio preenchido (do PC, do catálogo ou da RC). A lista é salva sozinha em instantes.`);
    });
    return res; });
  }, [empresa, codigoProjeto, carregarCompras]);
  const enriquecerRef = useRef<typeof enriquecer | null>(null);
  enriquecerRef.current = enriquecer;

  useEffect(() => { void carregar(); }, [carregar]);

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

  const visiveis = useMemo(
    () => linhas.filter((l) => {
      if (!l.item?.trim()) return true; // a linha em branco do fim fica sempre
      if (equipFiltro && normGrupo(l.equipamento || "Geral") !== equipFiltro) return false;
      if (filtroPc === "com_pc" && !temPc(l)) return false;
      if (filtroPc === "sem_pc" && temPc(l)) return false;
      if (filtroPcNum && !cmpPorId.get(l._id)?.pcs.some((p) => p.pc === filtroPcNum)) return false;
      if (filtroPc === "risco" && sinais.get(l._id)?.nivel !== "risco") return false;
      if (filtroPc === "atrasado" && sinais.get(l._id)?.nivel !== "atrasado") return false;
      if (filtroPc === "pc_atrasado" && !((sinais.get(l._id)?.pcAtrasadoDias ?? 0) > 0)) return false;
      return true;
    }),
    [linhas, equipFiltro, filtroPc, temPc, sinais, filtroPcNum, cmpPorId]);

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
          items: validas.map((l) => ({
            equipamento: String(l.equipamento ?? "").trim() || "Geral",
            item: String(l.item ?? "").trim(),
            qtd: l.qtd?.trim() ? num(l.qtd) : null,
            un: String(l.un ?? "").trim() || null,
            data_necessaria: /^\d{4}-\d{2}-\d{2}$/.test(String(l.data_necessaria ?? "")) ? l.data_necessaria : null,
            modelo: String(l.modelo ?? "").trim() || null,
            observacao: String(l.observacao ?? "").trim() || null,
            pc_numero: String(l.pc_numero ?? "").trim() || null,
            cat_ncod_prod: l.cat_ncod_prod ? Number(l.cat_ncod_prod) : null,
            cat_codigo: l.cat_codigo || null,
            cat_valor_unit: String(l.cat_valor_unit ?? "").trim() ? num(l.cat_valor_unit) : null,
            cat_fornecedor: l.cat_fornecedor || null,
            cat_entrega_dias: l.cat_entrega_dias ? Number(l.cat_entrega_dias) : null,
            cat_fat_dias: l.cat_fat_dias ? Number(l.cat_fat_dias) : null,
          })),
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

  /** Casa com o catálogo (itens NOSSOS) as linhas com texto e sem vínculo. Aceita
   *  sozinho só o que é de-para gravado ou muito parecido; o resto fica "conferir". */
  const casarLinhas = useCallback(async (entrada: LinhaGrade[]) => {
    // 1º o código digitado/colado: código nosso (ou antigo/de compra já ligado a um item nosso) resolve direto
    let base = entrada;
    const comCodigo = base.map((l, i) => ({ l, i }))
      .filter(({ l }) => String(l.item ?? "").trim() && !l.cat_ncod_prod && String(l.cat_codigo ?? "").trim());
    if (comCodigo.length) {
      const achados = await Promise.all(comCodigo.map(async ({ l }) => {
        const cod = String(l.cat_codigo).trim().toUpperCase();
        const j = await fetch(`/api/catalogo/projeto?op=buscar&emp=${empresa}&q=${encodeURIComponent(cod)}&lim=5`).then((x) => x.json()).catch(() => ({})) as { itens?: Cat[] };
        const its = j.itens ?? [];
        return its.find((c) => String(c.codigo ?? "").toUpperCase() === cod)
          ?? its.find((c) => String(c.via ?? "").toUpperCase().split(/\s+/).includes(cod)) ?? null;
      }));
      base = [...base];
      comCodigo.forEach(({ l, i }, k) => { const c = achados[k]; if (c) base[i] = { ...l, ...camposDoCatalogo(c, "ok", [], l.cat_valor_unit ?? "") }; });
    }
    const alvo = base.map((l, i) => ({ l, i }))
      .filter(({ l }) => String(l.item ?? "").trim() && !l.cat_ncod_prod);
    if (!alvo.length) return base;
    const r = await fetch("/api/catalogo/projeto", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "casar", emp: empresa, textos: alvo.map(({ l }) => textoCasar(l.item, l.modelo)),
        custos: alvo.map(({ l }) => (String(l.cat_valor_unit ?? "").trim() ? num(l.cat_valor_unit) : null)) }),
    });
    const j = (await r.json()) as { casamentos?: Casamento[]; error?: string };
    if (!r.ok || !j.casamentos) throw new Error(j.error ?? r.statusText);
    const novas = [...base];
    let ok = 0, conf = 0, sem = 0;
    alvo.forEach(({ l, i }, k) => {
      const c = j.casamentos![k];
      if (!c?.melhor) { novas[i] = { ...l, _match: "sem" }; sem++; return; }
      novas[i] = { ...l, ...camposDoCatalogo(c.melhor, c.status === "ok" ? "ok" : "conferir",
        c.status === "ok" ? [] : c.alternativas, l.cat_valor_unit ?? "") };
      if (c.status === "ok") ok++; else conf++;
    });
    setAviso(`Catálogo: ${ok} item(ns) casado(s)`
      + (conf ? ` · ${conf} para CONFERIR (amarelo — clique na coluna Catálogo e escolha)` : "")
      + (sem ? ` · ${sem} sem correspondência (clique em "escolher" para procurar ou criar o item nosso)` : "") + ". A lista é salva sozinha em instantes.");
    return novas;
  }, [empresa]);

  /** "Usar item da CP" (07/10/26): a linha recebe o item da CP (texto, qtd, equipamento,
   *  custo da CP se não houver valor) e passa pelo catálogo — ✓ sozinho ou fica para o ⌕. */
  const usarItemCp = useCallback(async (rowId: string, k: number) => {
    const it = cpBase?.itens[k];
    if (!it) return;
    setUsarCpEm(null);
    const i = linhas.findIndex((x) => x._id === rowId);
    if (i < 0) return;
    const l = linhas[i];
    const eq = it.equipamento || l.equipamento || "Geral";
    const temValor = !!String(l.cat_valor_unit ?? "").trim();
    const nova = { ...l, item: it.item, modelo: it.modelo ?? l.modelo ?? "", equipamento: eq,
      qtd: it.qtd != null ? String(it.qtd) : l.qtd,
      cat_ncod_prod: "", cat_codigo: "", _match: "", _alts: "", _cat_desc: "", _omie: "",
      cat_valor_unit: temValor ? l.cat_valor_unit : (it.custo_cp != null ? moeda(it.custo_cp) : ""),
      _vu_fonte: temValor ? (l._vu_fonte ?? "") : (it.custo_cp != null ? "CP" : ""),
      data_necessaria: l.data_necessaria || (dataGrupoRef.current.get(normGrupo(eq)) ?? "") } as LinhaGrade;
    const out = [...linhas]; out[i] = nova;
    if (i === linhas.length - 1) out.push(vazia());
    setLinhas(out);
    setSujo(true);
    try {
      const [casada] = await casarLinhas([nova]);
      setLinhas((atual) => atual.map((x) => (x._id === rowId ? { ...x, ...casada, _id: rowId } : x)));
    } catch { /* fica sem código: resolve no ⌕ */ }
  }, [cpBase, casarLinhas, linhas]);

  // ── Aba "Itens da CP" ───────────────────────────────────────────────────
  // A CP (composição de preço da proposta no CRM) fica SEPARADA da lista: é
  // referência, não compromisso. Quem monta escolhe o que entra — "meio
  // caminho andado" sem colocar na lista o que não vai ser comprado.
  type ItemCp = { equipamento: string; item: string; qtd: number | null; modelo: string | null;
                  custo_cp: number | null; casamento: Casamento };
  const [subAba, setSubAba] = useState<"lista" | "cp">("lista");
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
      const base = baseColada ?? linhas;
      const novas = await casarLinhas(base);
      if (novas !== base) { setLinhas(novas); setSujo(true); }
      else if (!baseColada) setAviso("Todas as linhas já estão ligadas ao catálogo.");
    } catch (e) { setErro(`Não consegui casar com o catálogo: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setCasando(false); }
  }, [casarLinhas, linhas, importarAberto, carregarCp]);

  /** Depois de colar do Excel, casa sozinho — o paste chega ao estado no
   *  próximo render, então o efeito espera a lista nova. Linha colada sem data
   *  herda a data do grupo. */
  const [casarAposColar, setCasarAposColar] = useState(false);
  useEffect(() => {
    if (!casarAposColar) return;
    setCasarAposColar(false);
    const comData = linhas.map((l) => {
      if (!String(l.item ?? "").trim() || l.data_necessaria) return l;
      const g = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral"));
      return g ? { ...l, data_necessaria: g } : l;
    });
    setLinhas(comData);
    void casarAgora(comData);
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
        // sem item nosso certo: entra "sem código" (âmbar), com as sugestões guardadas para o ⌕
        novas.push({ ...base, _match: "sem", _alts: c?.alternativas?.length ? JSON.stringify(c.alternativas) : "" });
      }
    }
    if (!novas.length) { setAviso("Nada novo para adicionar — os marcados já estão na lista."); return; }
    setLinhas([...linhas.filter((l) => String(l.item ?? "").trim()), ...novas, vazia()]);
    setSujo(true);
    setCpMarcados(new Set());
    setImportarAberto(false);
    setSubAba("lista");
    const sem = novas.filter((l) => l._match === "sem").length;
    setAviso(`${novas.length} item(ns) da RC adicionados à lista${sem ? ` · ${sem} sem código (âmbar — resolva no ⌕ do Código)` : ""}. A lista é salva sozinha em instantes.`);
  }, [cp, cpMarcados, usoCp, linhas]);

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
          ? { ...l, ...camposDoCatalogo(item, "ok", [], l.cat_valor_unit ?? ""), ...(String(l.cat_valor_unit ?? "").trim() ? { cat_valor_unit: l.cat_valor_unit, _vu_fonte: l._vu_fonte ?? "" } : {}) }
          : l)));
        setSujo(true);
      }
      setAviso(`Item ${item.codigo ?? ""} escolhido — gravado para o texto "${texto.slice(0, 60)}" (casa sozinho da próxima vez).`);
    } catch (e) { setErro(`Não consegui gravar a escolha: ${e instanceof Error ? e.message : String(e)}`); }
  }, [linhas, cp, empresa]);

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
        + (j.novas - j.casados > 0 ? ` e ${j.novas - j.casados} para resolver (âmbar — clique em ⌕ no Código)` : "")
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
  const nRisco = validas.filter((l) => sinais.get(l._id)?.nivel === "risco").length;
  const nAtraso = validas.filter((l) => sinais.get(l._id)?.nivel === "atrasado").length;
  const nPcAtraso = validas.filter((l) => (sinais.get(l._id)?.pcAtrasadoDias ?? 0) > 0).length;
  const riscoGrupo = (k: string) => {
    const ls = validas.filter((l) => normGrupo(l.equipamento || "Geral") === k);
    return { risco: ls.filter((l) => sinais.get(l._id)?.nivel === "risco").length, atraso: ls.filter((l) => sinais.get(l._id)?.nivel === "atrasado").length };
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
      <header className="flex items-baseline gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Lista de materiais
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Importe os itens da RC uma vez, ajuste a lista (incluir/excluir/casar com o nosso código) e gere os pedidos de compra a partir dela.{" "}
            <span className="cursor-help text-ww-textFaint" title={"Digite ou cole do Excel as colunas Equipamento · Item · Qtd · Un · Necessário em · Valor unit.\nCom a linha de cabeçalho, também Código, Modelo, PC e Observação (a observação vira comentário).\nAo digitar o Item, o catálogo sugere os itens do nosso estoque com último preço, fornecedor e prazos.\nÀ direita de cada linha: o pedido de compra, o valor e a situação.\nOs pedidos de compra se acompanham em Operação › Projetos (por PC) e aqui, item a item."}>ⓘ</span>
          </p>
        </div>
      </header>
      <VendasFaixa empresa={empresa} codigo={codigoProjeto} />

      {/* Quanto vou gastar — KPIs que eram da aba "Compras × lista". */}
      {cmp && (
        <KpisCompras d={cmp} restante={restante}
          empresa={empresa} codigoProjeto={codigoProjeto} onRecarregar={() => void carregarCompras()} />
      )}
      {cmpErro && !cmp && <p className="text-[11px] text-rose-600">Compras do projeto indisponíveis: {cmpErro}</p>}

      {/* Barra de ações */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => void casarAgora()} disabled={salvando || casando}
          title="Liga cada linha ao item do nosso estoque: último preço pago, fornecedor e prazos médios. Escolhas feitas à mão não mudam."
          className="px-2 py-1 text-[11px] rounded-lg border border-emerald-400 dark:border-emerald-700
                     bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200
                     hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition disabled:opacity-40">
          {casando ? "…" : "⚡ Casar com o catálogo"}
        </button>
        <button type="button" onClick={() => void verSugestoes()} disabled={!!ocupado}
          title="Mostra as linhas parecidas com itens dos pedidos de compra do projeto, para você confirmar"
          className="px-2 py-1 text-[11px] rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
          {ocupado === "sug" ? "…" : "Ver sugestões de vínculo"}
        </button>
        <button type="button" onClick={() => void vincularAuto()} disabled={salvando || !!ocupado}
          title="Procura, nos pedidos de compra deste projeto, o item que corresponde a cada linha — e grava o vínculo"
          className="px-2 py-1 text-[11px] rounded-lg border border-sky-400 dark:border-sky-700
                     bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200
                     hover:bg-sky-100 dark:hover:bg-sky-900/50 transition disabled:opacity-40">
          {ocupado === "auto" ? "Vinculando…" : "⇄ Vincular PCs automaticamente"}
        </button>
        <button type="button" onClick={() => abrirGerarPc(paraPc)} disabled={!!ocupado || !paraPc.length}
          title={paraPc.length ? "Gera os pedidos de compra (um por fornecedor) com as linhas marcadas sem PC" : "Marque linhas sem PC na caixinha da esquerda"}
          className="px-2 py-1 text-[11px] rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 transition disabled:opacity-40">
          🧾 Gerar pedido de compra ({paraPc.length})
        </button>
        {/* Importar da RC o que falta (07/10/26, Benny): sempre à vista na barra da Lista. N = itens
            da RC "não usado"; abre o importar com eles marcados (casam com o catálogo antes). */}
        {!!cpBase?.itens.length && (
          <button type="button" onClick={() => levarParaLista(cpNaoUsados.map((x) => x.k))} disabled={!!ocupado || !cpNaoUsados.length}
            title={cpNaoUsados.length ? "Abre o importar com os itens da RC que ainda não estão na lista, já casados com o nosso catálogo" : "A lista já tem todos os itens da RC"}
            className="px-2 py-1 text-[11px] rounded-lg border border-emerald-500/60 text-emerald-800 dark:text-emerald-200 font-semibold hover:bg-emerald-500/10 transition disabled:opacity-50 disabled:font-normal">
            {cpNaoUsados.length ? `⤵ Importar da RC o que falta (${cpNaoUsados.length})` : "⤵ lista já tem todos os itens da RC"}
          </button>
        )}
        <span className="flex-1" />
        {sujo && !salvando && remocao == null && rascunhoDe == null && validas.length >= original && (
          <span className="text-[10.5px] text-ww-textFaint">salvando…</span>)}
        {salvando && <span className="text-[10.5px] text-ww-textFaint">salvando…</span>}
        {(rascunhoDe != null || (sujo && validas.length < original && remocao == null)) && (
          <button type="button" onClick={() => void salvar()} disabled={salvando}
            className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110 transition">
            {salvando ? "…" : "Salvar lista"}
          </button>
        )}
        <details className="relative">
          <summary className="list-none cursor-pointer px-2 py-1 text-[12px] rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover" title="Mais ações">⋯</summary>
          <div className="absolute right-0 mt-1 z-30 min-w-[230px] rounded-lg border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-xl p-1 text-[11.5px]">
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; exportar(); }} disabled={!validas.length}
              className="block w-full text-left px-2 py-1.5 rounded hover:bg-ww-rowHover disabled:opacity-40">Exportar Excel</button>
            {!!cmp?.fora_da_lista.length && (
              <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setSubAba("lista"); setForaAberto((v) => !v); }}
                className="block w-full text-left px-2 py-1.5 rounded hover:bg-ww-rowHover"
                title="Itens de PCs do projeto que nenhuma linha da lista cobre — já contam no comprometido">
                {foraAberto ? "Esconder" : "Ver"} PCs com itens fora da lista <span className="text-ww-textFaint">({cmp.fora_da_lista.length})</span></button>
            )}
          </div>
        </details>
      </div>

      {/* Grupos de equipamento (07/10/26, 2ª versão): só chips de filtro, cada um com a
          data do grupo embaixo; as datas se editam no painel "Datas por grupo". */}
      {filtroPcNum && (
        <div className="flex items-center gap-2 rounded-lg border border-ww-accent/50 bg-ww-accentSoft px-2.5 py-1.5 text-[11.5px]">
          <span>Mostrando só as linhas do <b className="font-mono">PC {filtroPcNum}</b></span>
          <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={() => setFiltroPcNum(null)}>ver a lista toda</button>
        </div>
      )}
      {grupos.length > 0 && (
        <div className="flex items-start gap-1.5 flex-wrap">
          <button type="button" onClick={() => setEquipFiltro(null)}
            className={`px-2.5 py-1 rounded-md border text-left transition ${
              !equipFiltro ? "border-ww-accent bg-ww-accentSoft" : "border-ww-border hover:bg-ww-rowHover"}`}>
            <span className={`block text-[11.5px] font-semibold ${!equipFiltro ? "text-ww-accent" : "text-ww-text"}`}>Todos <span className="tabular-nums font-normal opacity-70">{validas.length}</span></span>
            <span className="block text-[9.5px] text-ww-textFaint">todos os grupos</span>
          </button>
          {grupos.map((g) => (
            <button key={g.k} type="button" onClick={() => setEquipFiltro(equipFiltro === g.k ? null : g.k)}
              title={g.proprias ? `${g.proprias} linha(s) com data própria` : undefined}
              className={`px-2.5 py-1 rounded-md border text-left transition max-w-[220px] ${
                equipFiltro === g.k ? "border-ww-accent bg-ww-accentSoft" : "border-ww-border hover:bg-ww-rowHover"}`}>
              <span className={`block text-[11.5px] font-semibold truncate ${equipFiltro === g.k ? "text-ww-accent" : "text-ww-text"}`}>
                {g.nome} <span className="tabular-nums font-normal opacity-70">{g.n}</span>
              </span>
              <span className={`block text-[9.5px] tabular-nums ${g.data ? "text-ww-textFaint" : "text-amber-700 dark:text-amber-300"}`}>
                {g.data ? `necessário ${dia(g.data).slice(0, 5)}` : "sem data"}{g.proprias ? ` · ${g.proprias} própria(s)` : ""}
                {riscoGrupo(g.k).risco > 0 && <span className="text-amber-700 dark:text-amber-300"> · ⚠{riscoGrupo(g.k).risco}</span>}
                {riscoGrupo(g.k).atraso > 0 && <span className="text-rose-600 dark:text-rose-400"> · ✕{riscoGrupo(g.k).atraso}</span>}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => setPainelDatas(true)}
            className="self-center px-2 py-1 text-[11px] rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover">
            📅 Datas por grupo{semDataComItens.length ? ` (${semDataComItens.length} sem data)` : ""}
          </button>
          <span className="ml-auto self-center flex items-center gap-1 text-[11px]">
            {(["todas", "sem_pc", "com_pc", "risco", "atrasado", "pc_atrasado"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFiltroPc(k)}
                title={k === "risco" ? `Chegada com menos de ${FOLGA_ENTREGA_DIAS} dias de folga antes do necessário, ou PC sem previsão` : k === "atrasado" ? "Chega depois do necessário, ou o necessário já passou sem receber"
                  : k === "pc_atrasado" ? "A previsão do PC já passou e o item não chegou (pode ainda estar dentro do necessário)" : undefined}
                className={`px-2 py-0.5 rounded-full border transition ${filtroPc === k ? "border-ww-accent bg-ww-accent text-white"
                  : k === "risco" && nRisco ? "border-amber-500/60 text-amber-700 dark:text-amber-300" : (k === "atrasado" && nAtraso) || (k === "pc_atrasado" && nPcAtraso) ? "border-rose-500/60 text-rose-600 dark:text-rose-400"
                  : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {k === "todas" ? `Todas ${validas.length}` : k === "sem_pc" ? `Sem PC ${validas.length - nComPc}` : k === "com_pc" ? `Com PC ${nComPc}`
                  : k === "risco" ? `⚠ Em risco ${nRisco}` : k === "atrasado" ? `✕ Atrasados ${nAtraso}` : `PC atrasado ${nPcAtraso}`}
              </button>))}
          </span>
        </div>
      )}

      {/* Painel "Datas por grupo": uma linha por grupo. No celular vira folha de largura total. */}
      {/* Portal no body: no modo vidro o painel com desfoque vira o "bloco de referência"
          de position:fixed e a folha abriria presa dentro da lista. */}
      {painelDatas && createPortal(
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end sm:items-start justify-center sm:pt-[10vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPainelDatas(false); }}>
          <div role="dialog" aria-label="Datas por grupo"
            className="w-full sm:w-[min(760px,96vw)] max-h-[85vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-3.5 space-y-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <h4 className="text-[13px] font-semibold text-ww-text">Necessário em — por grupo de equipamento</h4>
                <p className="text-[11px] text-ww-textMuted">A data do grupo preenche “Necessário em” das linhas dele. Linha com outra data fica como <b>data própria</b> e não muda; linha nova do grupo herda a data. É a data que vai para o pedido de compra (previsão de entrega) e para o fluxo.</p>
              </div>
              <button type="button" className="ml-auto text-[12px] text-ww-accent hover:underline" onClick={() => setPainelDatas(false)}>fechar</button>
            </div>
            {sugestaoData && (
              <div className="flex items-center gap-2 flex-wrap rounded-lg border border-ww-border px-2.5 py-1.5 text-[11.5px]">
                <span className="text-ww-textMuted">Sugestão: <b className="text-ww-text">{dia(sugestaoData)}</b> — {gruposMeta?.prazo.fonte}</span>
                <button type="button" disabled={!semDataComItens.length}
                  className="ml-auto px-2 py-0.5 rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft disabled:opacity-40"
                  onClick={() => semDataComItens.forEach((g) => definirDataGrupo(g.k, sugestaoData))}>
                  Aplicar a todos os grupos sem data ({semDataComItens.length})
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ww-textMuted">
                <th className="py-1 pr-2">Grupo</th><th className="py-1 pr-2 text-right">Itens</th><th className="py-1 pr-2">Necessário em</th>
                <th className="py-1 pr-2">Data própria</th><th className="py-1 pr-2">Entrega</th><th className="py-1">Sugestão</th>
              </tr></thead>
              <tbody>
                {grupos.map((g) => {
                  const padrao = nomesPadrao.length ? nomePadrao(g.nome, nomesPadrao) : null;
                  return (
                    <tr key={g.k} className="border-t border-ww-border/60">
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold text-ww-text">{g.nome}</span>
                        {padrao && padrao !== g.nome && (
                          <button type="button" className="ml-1.5 text-[10.5px] text-amber-700 dark:text-amber-300 hover:underline"
                            title={`Trocar pelo nome padrão do cadastro: ${padrao}`} onClick={() => renomearGrupo(g.k, padrao)}>≈ {padrao}</button>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{g.n}</td>
                      <td className="py-1.5 pr-2">
                        <input type="date" value={g.data ?? ""} onChange={(e) => definirDataGrupo(g.k, e.target.value)}
                          className="bg-transparent border border-ww-border rounded px-1 py-0.5 text-[11.5px] text-ww-text" />
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">{g.proprias ? <span className="text-amber-700 dark:text-amber-300">{g.proprias} linha(s)</span> : <span className="text-ww-textFaint">—</span>}</td>
                      <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                        {riscoGrupo(g.k).risco > 0 && <span className="text-amber-700 dark:text-amber-300 mr-1.5">⚠ {riscoGrupo(g.k).risco} em risco</span>}
                        {riscoGrupo(g.k).atraso > 0 && <span className="text-rose-600 dark:text-rose-400">✕ {riscoGrupo(g.k).atraso} atrasada(s)</span>}
                        {!riscoGrupo(g.k).risco && !riscoGrupo(g.k).atraso && <span className="text-ww-textFaint">—</span>}
                      </td>
                      <td className="py-1.5">
                        {sugestaoData && g.data !== sugestaoData
                          ? <button type="button" className="text-ww-accent hover:underline" onClick={() => definirDataGrupo(g.k, sugestaoData)}>aplicar {dia(sugestaoData)}</button>
                          : <span className="text-ww-textFaint">—</span>}
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
            </div>
            <p className="text-[10.5px] text-ww-textFaint">Nomes padrão em Cadastros › Grupos de equipamento. A lista é salva sozinha em instantes.</p>
          </div>
        </div>
      , document.body)}

      {marcadas.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg border border-ww-accent/40 bg-ww-accentSoft text-[12px]">
          <strong className="text-ww-accent">{marcadas.size} item(ns) marcados</strong>
          <button type="button" onClick={() => setPicker(true)}
            className="px-2.5 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition">
            Vincular a um PC
          </button>
          <button type="button" onClick={() => abrirGerarPc(paraPc)} disabled={!paraPc.length || !!ocupado}
            className="px-2.5 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition disabled:opacity-40">
            🧾 Gerar pedido de compra ({paraPc.length})
          </button>
          <button type="button" onClick={() => excluirLinhas([...marcadas])}
            className="px-2.5 py-1 rounded-lg border border-rose-400/60 text-rose-700 dark:text-rose-300 text-[11.5px] hover:bg-rose-500/10 transition">
            🗑 Excluir {marcadas.size} linha{marcadas.size === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={() => setMarcadas(new Set())}
            className="text-[11px] text-ww-textMuted hover:text-ww-text">limpar</button>
        </div>
      )}

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

      {/* Lista × Itens da RC (07/10/26): a lista é o que se compra; a aba da RC é só o
          registro do plano original — o que entrou na lista e o que não foi usado. */}
      <div className="flex items-center gap-1 border-b border-ww-border">
        {([["lista", `Lista (${validas.length})`], ["cp", `Itens da RC${cpBase ? ` (${cpBase.itens.length})` : ""}`]] as const).map(([k, rot]) => (
          <button key={k} type="button" onClick={() => setSubAba(k)}
            className={`px-3 py-1.5 text-[11.5px] -mb-px border-b-2 transition ${
              subAba === k ? "border-ww-accent text-ww-text font-semibold" : "border-transparent text-ww-textMuted hover:text-ww-text"}`}>
            {rot}
          </button>
        ))}
        {subAba === "lista" && !carregando && (
          <button type="button" onClick={() => {
              const nova = { ...vazia(), equipamento: equipFiltro ? (grupos.find((g) => g.k === equipFiltro)?.nome ?? "") : "" } as LinhaGrade;
              setLinhas((ls) => [nova, ...ls]);
              setTimeout(() => (document.querySelector('[data-cel^="0-"]') as HTMLInputElement | null)?.focus(), 50);
            }}
            className="ml-auto mb-1 px-2 py-0.5 text-[11px] rounded-lg border border-ww-accent/60 text-ww-accent font-semibold hover:bg-ww-accentSoft transition">
            + Adicionar linha
          </button>
        )}
        {subAba === "cp" && cpBase?.proposta && (
          <span className="ml-auto text-[10.5px] text-ww-textFaint pb-1">
            composição de preço da proposta <strong>{cpBase.proposta}</strong> · registro do plano original
          </span>
        )}
      </div>

      {subAba === "cp" ? (
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
              return (
                <>
                {naoUsados.length > 0 && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <button type="button" onClick={() => levarParaLista(naoUsados)}
                      className="px-2.5 py-1 text-[11.5px] rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 transition">
                      ⤴ Exportar para a lista os que faltam ({naoUsados.length})
                    </button>
                    <span className="text-[10.5px] text-ww-textFaint">abre o importar com eles marcados — confira o código de cada um antes de adicionar</span>
                  </div>
                )}
                <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 520 }}>
                  <table className="w-full text-[11.5px] border-collapse">
                    <thead className="sticky top-0 bg-[rgb(var(--color-ww-panel))] text-ww-textMuted z-[1]">
                      <tr className="text-left">
                        <th className="p-1.5">Equipamento</th><th className="p-1.5">Item da RC</th><th className="p-1.5 text-right">Qtd</th>
                        <th className="p-1.5 text-right">Custo RC</th><th className="p-1.5 text-right">Total</th><th className="p-1.5">Na lista</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpBase.itens.map((i, k) => {
                        const l = usoCp.get(k);
                        const n = l ? validas.findIndex((x) => x._id === l._id) + 1 : 0;
                        return (
                          <tr key={k} className={`border-t border-ww-border/50 ${l ? "" : "opacity-60"}`}>
                            <td className="p-1.5 text-ww-textMuted">{i.equipamento}</td>
                            <td className="p-1.5 text-ww-text">{i.item}{i.modelo ? <span className="text-ww-textFaint"> · {i.modelo}</span> : null}</td>
                            <td className="p-1.5 text-right tabular-nums">{i.qtd ?? "—"}</td>
                            <td className="p-1.5 text-right tabular-nums">{brl(i.custo_cp)}</td>
                            <td className="p-1.5 text-right tabular-nums">{brl(tot(i))}</td>
                            <td className="p-1.5">{l
                              ? <span className="text-emerald-700 dark:text-emerald-300">✓ na lista{l.cat_codigo ? <> · <b className="font-mono">{l.cat_codigo}</b></> : " · sem código"}{n ? <span className="text-ww-textFaint"> · linha {n}</span> : null}</span>
                              : <span className="text-ww-textFaint">não usado <button type="button" className="ml-1 px-1.5 rounded border border-emerald-500/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                                  title="Levar este item para a lista (casa com o catálogo no modal)" onClick={() => levarParaLista([k])}>→ lista</button></span>}</td>
                          </tr>);
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-ww-border font-semibold">
                        <td className="p-1.5" colSpan={4}>Plano (RC): {cpBase.itens.length} item(ns) · {usoCp.size} na lista · {cpBase.itens.length - usoCp.size} não usado(s)</td>
                        <td className="p-1.5 text-right tabular-nums">{brl(plano)}</td>
                        <td className="p-1.5 text-[11px] font-normal text-ww-textMuted">na lista: {brl(usado)} pelo custo da RC · {brl(projUsado)} projetado</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </>);
            })()}
          <p className="text-[10.5px] text-ww-textFaint">A RC é a referência e a origem do budget de materiais. O que não está na lista aparece como “não usado”: leve um item com “→ lista” ou todos com “⤴ Exportar para a lista os que faltam” (casam com o nosso código antes de entrar). Na lista você exclui, inclui e casa.</p>
        </div>
      ) : carregando
        ? <p className="text-[11.5px] text-ww-textFaint py-3">Carregando a lista…</p>
        : <GradeEditavel cols={COLS} linhas={visiveis}
            colarExtras={[{ label: "Modelo", key: "modelo" }, { label: "PC", key: "pc_numero" }, { label: "PC nº", key: "pc_numero" }, { label: "Observação", key: "observacao" }, { label: "Obs", key: "observacao" }]}
            aoColar={() => setCasarAposColar(true)}
            onChange={(l) => {
              // Com filtro ativo, o que volta é só o pedaço visível — recompõe
              // com o resto para não apagar o que está escondido.
              if (equipFiltro || filtroPc !== "todas") {
                const ids = new Set(visiveis.map((x) => x._id));
                const ocultas = linhas.filter((x) => x.item?.trim() && !ids.has(x._id));
                setLinhas([...ocultas, ...l]);
              } else setLinhas(l);
              setSujo(true);
            }}
            altura={520}
            aoRemover={(id) => excluirLinhas([id])}
            selecao={{
              marcadas,
              podeMarcar: (l) => l._id.startsWith("db"),
              onAlternar: alternar,
              onTodas: (marcar) => setMarcadas(marcar
                ? new Set(visiveis.filter((l) => l._id.startsWith("db")).map((l) => l._id))
                : new Set()),
            }}
            vazioMsg="Digite, cole do Excel ou use o botão de planilha acima." />}

      {/* "Comprado fora da lista" saiu da tela (07/10/26, Benny): só pelo ⋯ › PCs com itens fora da
          lista, na aba Lista. O valor continua no comprometido do resumo (cada PC do projeto conta). */}
      {cmp && foraAberto && subAba === "lista" && <ForaDaLista fora={cmp.fora_da_lista} empresa={empresa} />}
      {cmp && <FluxoCompras d={cmp} />}

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

      {gerarPcLinhas && (
        <GerarPcDaLista empresa={empresa} codigoProjeto={codigoProjeto} linhas={gerarPcLinhas}
          onFechar={() => setGerarPcLinhas(null)}
          onFeito={(nums) => { setGerarPcLinhas(null); setMarcadas(new Set()); setAviso(`Pedido(s) de compra criado(s): ${nums.map((n) => `PC ${n}`).join(", ")} — já ligados às linhas da lista; seguem para aprovação.`); void carregar(); onGravado?.(); }} />
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
                <p className="text-[11px] text-ww-textMuted">Cada item da RC vem casado com o nosso catálogo (✓ certo · ⚠ conferir · sem correspondência). Resolva em “No catálogo”, marque o que entra e adicione. O que já está na lista fica apagado.</p></div>
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
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text"
                  title="Marca os itens casados (✓ ou escolhidos) que ainda não estão na lista"
                  onClick={() => setCpMarcados(new Set(cp.itens.map((it, k) => [it, k] as const)
                    .filter(([it, k]) => casado(it) && !usoCp.has(k)).map(([, k]) => k)))}>
                  marcar os casados que faltam
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
                      <th className="p-1.5 w-7"></th>
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
                                  : <span className="text-amber-700 dark:text-amber-300">⚠ conferir · <b>{m.codigo}</b> {m.descricao.length > 34 ? `${m.descricao.slice(0, 34)}…` : m.descricao}</span>}
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

/** Faixa só de leitura com os PV/OS do projeto (07/10/26, Benny procura as vendas na página
 *  do projeto): nº, valor e previsão de faturamento; as datas se mudam em Operação › Projetos. */
function VendasFaixa({ empresa, codigo }: { empresa: string; codigo: number }) {
  const [docs, setDocs] = useState<{ chave: string; rotulo: string; valor: number; fat_inicial: string | null; fat_nova: string | null; faturado: boolean; dt_fat: string | null; recebido: boolean }[] | null>(null);
  useEffect(() => {
    fetch(`/api/rc-projetos/vendas?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setDocs(j.docs ?? [])).catch(() => setDocs([]));
  }, [empresa, codigo]);
  if (!docs?.length) return null;
  const d2 = (v: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : "—");
  const tot = docs.reduce((a, d) => a + d.valor, 0);
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px] rounded-lg border border-ww-border bg-ww-panel px-2.5 py-1.5">
      <span className="text-ww-textMuted font-semibold mr-1">Vendas (PV/OS) {brl(tot)}:</span>
      {docs.map((d) => (
        <a key={d.chave || d.rotulo} href={`/faturamento?${new URLSearchParams({ abrir: d.chave, q: d.rotulo, emp: empresa })}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-ww-border hover:border-ww-accent"
          title={d.faturado ? `faturado em ${d2(d.dt_fat)}${d.recebido ? " · recebido" : ""}` : `previsão de faturamento ${d2(d.fat_nova ?? d.fat_inicial)}${d.fat_nova ? ` (inicial ${d2(d.fat_inicial)})` : ""}`}>
          <b className="font-mono">{d.rotulo}</b><span className="tabular-nums">{brl(d.valor)}</span>
          <span className={d.faturado ? "text-teal-600 dark:text-teal-400" : "text-ww-textMuted"}>{d.faturado ? (d.recebido ? "recebido" : "faturado") : `fat. ${d2(d.fat_nova ?? d.fat_inicial)}`}</span>
        </a>))}
      <a href="/projetos" className="ml-auto text-ww-accent hover:underline" title="As previsões (faturamento e recebimento) se mudam em Operação › Projetos, no projeto aberto">mudar datas em Operação › Projetos →</a>
    </div>
  );
}
