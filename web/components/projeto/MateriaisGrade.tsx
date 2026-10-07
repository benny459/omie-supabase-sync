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
import * as XLSX from "xlsx";
import GradeEditavel, { linhaVazia, num, type ColunaGrade, type LinhaGrade, type SugestaoGrade } from "./GradeEditavel";
import PcPickerModal, { type PcSearchResult } from "./PcPickerModal";
import AcertoItemEstoque, { type Compra, type Escolhido } from "@/components/faturamento/AcertoItemEstoque";
import "@/components/faturamento/nova-emissao.css";
import { CSS_CDL, KpisCompras, SugestoesVinculo, ForaDaLista, FluxoCompras, situacaoPc,
         type DadosCompras, type CasamentoPc } from "./ComprasDaLista";
import { supaBrowser } from "@/lib/supabase";
import { deHtml } from "@/lib/match-pc";
import { normGrupo, dataDoGrupo, aplicarDataGrupo, nomePadrao } from "@/lib/grupos-equipamento-puro";

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
                    "cat_entrega_dias", "cat_fat_dias", "_match", "_alts", "_vu_fonte"];
/** Chaves da linha (para a linha vazia — independe das colunas de leitura). */
const CHAVES = ["equipamento", "item", "qtd", "un", "data_necessaria", "modelo", "pc_numero", "observacao", "cat_valor_unit"];
const vazia = () => linhaVazia(CHAVES.map((key) => ({ key, label: "", w: 0 })));

const s = (v: unknown) => (v == null ? "" : String(v));
/** Valor para a célula no padrão brasileiro ("574,11"); num() lê de volta. */
const moeda = (v: number | null | undefined) =>
  v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Preenche a linha com um item do catálogo. O valor vem do ÚLTIMO PREÇO PAGO
 *  (decisão do Benny, 30/09/2026); sem compra anterior, o que já havia fica. */
function camposDoCatalogo(c: Cat, match: "ok" | "conferir", alts: Cat[] = [], valorAtual = ""): Record<string, string> {
  return {
    cat_ncod_prod: s(c.ncod_prod), cat_codigo: s(c.codigo),
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
  const [original, setOriginal] = useState(0);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [equipFiltro, setEquipFiltro] = useState<string | null>(null);
  const [filtroPc, setFiltroPc] = useState<"todas" | "sem_pc" | "com_pc">("todas");
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
  const carregarCompras = useCallback(async () => {
    try {
      const r = await fetch(`/api/rc-projetos/compras?empresa=${empresa}&codigo=${codigoProjeto}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setCmp(j as DadosCompras); setCmpErro(null);
      return j as DadosCompras;
    } catch (e) { setCmpErro((e as Error).message); return null; }
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
  dataGrupoRef.current = dataGrupo;

  // ── Seletor de item do catálogo (linha da CP ou da lista) ────────────────
  const [seletor, setSeletor] = useState<Seletor | null>(null);
  const abrirSeletorLista = useCallback((id: string) => setSeletor({ alvo: "lista", id }), []);

  // ── Colunas ───────────────────────────────────────────────────────────────
  // As editáveis à esquerda; à direita, o catálogo e o bloco do PC (leitura,
  // com fundo próprio para se ver que vêm do mesmo lugar).
  const PC = "bg-sky-500/[0.05]";
  const COLS: ColunaGrade[] = useMemo(() => [
    { key: "equipamento", label: "Equipamento", w: 130,
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
    { key: "item",        label: "Item",        w: 260,
      // Digitar busca no catálogo — itens NOSSOS primeiro (código novo); linha
      // amarela ("conferir") mostra as alternativas assim que a célula recebe o foco.
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
    { key: "qtd",         label: "Qtd",         w: 56, tipo: "num", alinhaDireita: true },
    { key: "un",          label: "Un",          w: 44 },
    { key: "data_necessaria", label: "Necessário em", w: 116, tipo: "data",
      marca: (l) => {
        const g = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral")) ?? null;
        if (!g) return null;
        if (!l.data_necessaria) return { etiqueta: `grupo ${dia(g)}`, dica: "Sem data — ao salvar, herda a data do grupo" };
        if (l.data_necessaria !== g) return { classe: "bg-amber-500/10", etiqueta: "data própria", dica: `Data própria — o grupo está em ${dia(g)}` };
        return null;
      } },
    { key: "modelo",      label: "Modelo",      w: 110 },
    { key: "pc_numero",   label: "PC nº",       w: 64 },
    { key: "observacao",  label: "Observação",  w: 120 },
    { key: "cat_valor_unit", label: "Valor unit.", w: 92, tipo: "moeda", alinhaDireita: true,
      marca: (l) => {
        const f = l._vu_fonte;
        if (!f) return null;
        return { etiqueta: f === "pc" ? "do PC" : f === "CP" ? "da CP" : "catálogo",
          dica: f === "pc" ? "Preço unitário da linha do pedido de compra" : f === "CP" ? "Custo da composição de preço (CP) — sem compra anterior" : "Último preço pago (catálogo)" };
      } },
    { key: "_total", label: "Total", w: 92, alinhaDireita: true,
      calculada: (l) => {
        const t = num(l.qtd) * num(l.cat_valor_unit);
        return t ? brl(t) : "";
      } },
    // ── Catálogo (item nosso, fornecedor sugerido e prazos médios) — clique troca ──
    { key: "_cat", label: "Catálogo", w: 170,
      render: (l) => {
        if (!String(l.item ?? "").trim()) return null;
        const prazos = l.cat_entrega_dias || l.cat_fat_dias
          ? ` · ${l.cat_entrega_dias ? `${l.cat_entrega_dias}d` : "—"}/${l.cat_fat_dias ? `${l.cat_fat_dias}d` : "—"}` : "";
        const corpo = l._match === "conferir"
          ? <span className="text-amber-700 dark:text-amber-300">⚠ conferir · {l.cat_codigo || "—"}</span>
          : l._match === "sem" || !l.cat_ncod_prod
            ? <span className="text-ww-textFaint">{l._match === "sem" ? "sem correspondência" : "—"} · escolher</span>
            : <span className="text-ww-textMuted"><span className="text-emerald-600 dark:text-emerald-400">✓</span> {l.cat_codigo || "item"} · {l.cat_fornecedor || "sem compra anterior"}<span className="tabular-nums">{prazos}</span></span>;
        return (
          <button type="button" onClick={() => abrirSeletorLista(l._id)} className="text-left w-full truncate hover:underline"
            title="Escolher/trocar o item do catálogo (sugestões, busca, criar item nosso). Fornecedor sugerido · entrega/fatura médias.">
            {corpo}
          </button>);
      } },
    // ── Bloco do PC (leitura) ──
    { key: "_rc", label: "RC", w: 62, classe: `${PC} border-l border-ww-border`,
      render: (l) => {
        const c = cmpPorId.get(l._id);
        return c?.rc
          ? <a className="text-ww-accent hover:underline" target="_blank" rel="noreferrer" href={`/erp/compras?abrir=${c.rc}&tipo=RC&emp=${empresa}`}>{c.rc}</a>
          : <span className="text-ww-textFaint">—</span>;
      } },
    { key: "_pc", label: "Pedido de compra", w: 190, classe: PC,
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) return <span className="text-ww-textFaint">{l.pc_numero ? `PC ${l.pc_numero}` : "sem PC"}</span>;
        return (
          <span className="flex flex-col gap-0.5">
            {c.pcs.map((p) => (
              <span key={`${p.pc}-${p.pedido_id}`} className="block min-w-0">
                <a className="cdl-chip-pc" target="_blank" rel="noreferrer" href={`/erp/compras?abrir=${p.pc}&tipo=PC&emp=${empresa}`}
                  title="Abrir o pedido de compra">PC {p.pc}</a>{" "}
                <span className="text-ww-textMuted" title={p.fornecedor ?? undefined}>{p.fornecedor ?? "—"}</span>
                <span className="block text-[10px] text-ww-textFaint tabular-nums">
                  {p.dt_rec ? `recebido ${dia(p.dt_rec)}${p.qtd_recebida != null ? ` · ${p.qtd_recebida} un` : ""}` : `prev. ${dia(p.previsao)}`}
                </span>
              </span>))}
          </span>);
      } },
    { key: "_comprado", label: "Comprado", w: 112, alinhaDireita: true, classe: PC,
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c || c.valor_pc == null) return <span className="text-ww-textFaint">—</span>;
        const q = num(l.qtd);
        const qPc = c.pcs.reduce((a, p) => a + (Number(p.qtd) || 0), 0);
        const vu = c.pcs.find((p) => p.valor_unit != null)?.valor_unit;
        return (
          <span className="block">
            {brl(c.valor_pc)}
            {vu != null && <span className="block text-[10px] text-ww-textFaint">{brl(vu)}/un</span>}
            {qPc > 0 && q > 0 && Math.abs(qPc - q) > 1e-6 && <span className="block text-[10px] text-amber-700 dark:text-amber-300" title="Quantidade do PC diferente da lista">PC {qPc} × lista {q}</span>}
          </span>);
      } },
    { key: "_sit", label: "Situação", w: 150, classe: PC,
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c?.pcs.length) return c?.rc ? <span className="text-ww-textMuted">em RC</span> : <span className="text-ww-textFaint">—</span>;
        return (
          <span className="flex flex-wrap gap-0.5">
            {c.pcs.map((p) => { const st = situacaoPc(p); return (
              <span key={`${p.pc}-${p.pedido_id}`} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: st.cor }}>{st.t}</span>); })}
          </span>);
      } },
    { key: "_vinc", label: "Vínculo", w: 92, classe: PC,
      render: (l) => {
        const c = cmpPorId.get(l._id);
        if (!c) return null;
        const v = c.vinculo_via;
        const t = v === "rc" ? "pela RC" : v === "codigo" ? "código" : v === "descricao" ? `descrição ${Math.round(Number(c.vinculo_score ?? 0) * 100)}%`
          : v === "manual" ? "manual" : c.pcs.length ? "nº do PC" : "";
        const pode = v === "codigo" || v === "descricao" || v === "manual";
        return (
          <span className="text-ww-textMuted text-[11px]">{t}
            {pode && <button type="button" className="ml-1 text-ww-accent hover:underline" onClick={() => void desvincularRef.current?.(c.id)}>desfazer</button>}
          </span>);
      } },
  ], [empresa, cmpPorId, nomesPadrao, gruposMeta, abrirSeletorLista, PC]);

  /** A leitura inicial funcionou?
   *
   *  Falso enquanto não carregou e depois de qualquer falha. Salvar com isto
   *  falso mandaria uma lista vazia por cima do que está no banco — a rota já
   *  trava, mas a tela não deve nem tentar. */
  const [carregouOk, setCarregouOk] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
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
      if (!comRascunho) void enriquecerRef.current?.(rows);
      else void carregarCompras();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCarregouOk(false);
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto, carregarCompras]);

  /* Depois de carregar (07/10/26): traz as compras do projeto e completa as linhas
     que chegaram "vazias" — código do Omie que já tem item nosso vira o item
     nosso (código novo); valor unit. vazio vem do PC, senão do último preço do
     catálogo, senão do custo da CP (a estimativa da própria lista). O que muda
     é salvo sozinho, como qualquer edição. */
  const enriquecer = useCallback(async (rows: ItemRow[]) => {
    const [dados, resolv, cpRes] = await Promise.all([
      carregarCompras(),
      (async () => {
        const ids = [...new Set(rows.map((r) => Number(r.cat_ncod_prod)).filter((x) => x > 0))];
        if (!ids.length) return {} as Record<string, Cat>;
        const r = await fetch("/api/catalogo/projeto", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "resolver", emp: empresa, ids }) }).then((x) => x.json()).catch(() => ({}));
        return (r.itens ?? {}) as Record<string, Cat>;
      })(),
      rows.some((r) => r.cat_valor_unit == null)
        ? fetch(`/api/rc-projetos/itens-cp?codigo_projeto=${codigoProjeto}&sem_casar=1`).then((x) => x.json()).catch(() => ({}))
        : Promise.resolve({}),
    ]);
    const custoCp = new Map<string, number>();
    for (const i of ((cpRes as { itens?: { equipamento: string; item: string; custo_cp: number | null }[] }).itens ?? [])) {
      if (i.custo_cp != null) custoCp.set(chaveItem(i.equipamento, i.item), Number(i.custo_cp));
    }
    const porId = new Map((dados?.itens ?? []).map((l) => [`db${l.id}`, l]));
    let mudou = 0;
    setLinhas((atual) => atual.map((l) => {
      if (!l._id.startsWith("db") || !String(l.item ?? "").trim()) return l;
      const novo: LinhaGrade = { ...l };
      // código do Omie → item nosso
      const nat = l.cat_ncod_prod ? resolv[l.cat_ncod_prod] : undefined;
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
    }));
    if (mudou) {
      setSujo(true);
      setAviso(`${mudou} ajuste(s) automático(s) na lista: código do Omie trocado pelo item nosso e/ou valor unit. vazio preenchido (do PC, do catálogo ou da CP). A lista é salva sozinha em instantes.`);
    }
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
      return true;
    }),
    [linhas, equipFiltro, filtroPc, temPc]);

  const salvar = useCallback(async (confirmarRemocao = false, silencioso = false) => {
    const versaoInicio = versaoRef.current;
    if (!carregouOk) {
      setErro("A lista não chegou a carregar. Recarregue a página antes de salvar — "
            + "gravar agora apagaria o que está no projeto.");
      return;
    }
    if (validas.length < original) {
      if (silencioso) return; // remoção nunca é automática: pede o botão Salvar
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
          confirmar_remocao: confirmarRemocao,
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
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      if (silencioso) {
        // Gravado sem recarregar a grade (quem está digitando não perde o foco).
        try { window.localStorage.removeItem(`painel.materiais.rascunho.${empresa}.${codigoProjeto}`); } catch { /* */ }
        setRascunhoDe(null);
        setOriginal(validas.length);
        if (versaoRef.current === versaoInicio) setSujo(false);
        setAviso(`Salvo automaticamente às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`);
        void carregarCompras();
        return;
      }
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
    if (validas.length < original || !validas.length) return;
    const t = window.setTimeout(() => { void salvarRef.current?.(false, true); }, 2500);
    return () => window.clearTimeout(t);
  }, [linhas, sujo, carregouOk, salvando, validas.length, original, rascunhoDe]);

  // ── Catálogo ────────────────────────────────────────────────────────────
  const [casando, setCasando] = useState(false);

  /** Casa com o catálogo (itens NOSSOS) as linhas com texto e sem vínculo. Aceita
   *  sozinho só o que é de-para gravado ou muito parecido; o resto fica "conferir". */
  const casarLinhas = useCallback(async (base: LinhaGrade[]) => {
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

  // ── Aba "Itens da CP" ───────────────────────────────────────────────────
  // A CP (composição de preço da proposta no CRM) fica SEPARADA da lista: é
  // referência, não compromisso. Quem monta escolhe o que entra — "meio
  // caminho andado" sem colocar na lista o que não vai ser comprado.
  type ItemCp = { equipamento: string; item: string; qtd: number | null; modelo: string | null;
                  custo_cp: number | null; casamento: Casamento };
  const [subAba, setSubAba] = useState<"lista" | "cp">("lista");
  const [cp, setCp] = useState<{ proposta: string | null; itens: ItemCp[] } | null>(null);
  const [cpMarcados, setCpMarcados] = useState<Set<number>>(new Set());
  const [cpCarregando, setCpCarregando] = useState(false);
  const [cpErro, setCpErro] = useState<string | null>(null);

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
  useEffect(() => { if (subAba === "cp" && !cp && !cpCarregando) void carregarCp(); },
    [subAba, cp, cpCarregando, carregarCp]);

  const casarAgora = useCallback(async () => {
    setCasando(true); setErro(null);
    try {
      if (subAba === "cp") {
        // a CP recasa inteira; escolha feita à mão (de-para) volta igual
        const its = await carregarCp();
        if (its) {
          const ok = its.filter((i) => i.casamento?.status === "ok").length;
          const man = its.filter((i) => i.casamento?.manual).length;
          setAviso(`CP recasada com o catálogo: ${ok} de ${its.length} casado(s)${man ? ` (${man} por escolha sua)` : ""}.`);
        }
        return;
      }
      const novas = await casarLinhas(linhas);
      if (novas !== linhas) { setLinhas(novas); setSujo(true); }
      else setAviso("Todas as linhas já estão ligadas ao catálogo.");
    } catch (e) { setErro(`Não consegui casar com o catálogo: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setCasando(false); }
  }, [casarLinhas, linhas, subAba, carregarCp]);

  /** Depois de colar do Excel, casa sozinho — o paste chega ao estado no
   *  próximo render, então o efeito espera a lista nova. Linha colada sem data
   *  herda a data do grupo. */
  const [casarAposColar, setCasarAposColar] = useState(false);
  useEffect(() => {
    if (!casarAposColar) return;
    setCasarAposColar(false);
    setLinhas((atual) => atual.map((l) => {
      if (!String(l.item ?? "").trim() || l.data_necessaria) return l;
      const g = dataGrupoRef.current.get(normGrupo(l.equipamento || "Geral"));
      return g ? { ...l, data_necessaria: g } : l;
    }));
    void casarAgora();
  }, [casarAposColar, casarAgora]);

  const adicionarDaCp = useCallback(() => {
    if (!cp) return;
    const novas: LinhaGrade[] = [];
    for (const k of [...cpMarcados].sort((a, b) => a - b)) {
      const it = cp.itens[k];
      if (!it || naLista.has(chaveItem(it.equipamento, it.item)) || !casado(it)) continue;
      const c = it.casamento;
      const base: LinhaGrade = {
        ...vazia(), equipamento: it.equipamento, item: it.item,
        qtd: it.qtd != null ? String(it.qtd) : "", modelo: it.modelo ?? "",
        // Sem compra anterior, o custo usado na CP é o melhor valor que há.
        cat_valor_unit: it.custo_cp != null ? moeda(it.custo_cp) : "",
        _vu_fonte: it.custo_cp != null ? "CP" : "",
        observacao: `CP ${cp.proposta ?? ""}`.trim(),
        data_necessaria: dataGrupoRef.current.get(normGrupo(it.equipamento || "Geral")) ?? "",
      };
      const campos = camposDoCatalogo(c.melhor!, "ok", [], base.cat_valor_unit);
      novas.push({ ...base, ...campos, _vu_fonte: campos._vu_fonte || base._vu_fonte });
    }
    if (!novas.length) { setAviso("Nada novo para adicionar — os marcados já estão na lista ou ainda não foram casados."); return; }
    setLinhas([...linhas.filter((l) => String(l.item ?? "").trim()), ...novas, vazia()]);
    setSujo(true);
    setCpMarcados(new Set());
    setSubAba("lista");
    setAviso(`${novas.length} item(ns) da CP adicionados à lista. A lista é salva sozinha em instantes.`);
  }, [cp, cpMarcados, naLista, linhas]);

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

  const estimado = useMemo(() => validas.reduce((a, l) => a + num(l.qtd) * num(l.cat_valor_unit), 0), [validas]);
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
    const ids = Array.from(marcadas)
      .filter((id) => id.startsWith("db"))
      .map((id) => id.slice(2));
    setPicker(false);
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
  }, [marcadas, empresa, codigoProjeto, carregar, onGravado]);

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
        RC: c?.rc ?? "", PC: c?.pcs.map((p) => p.pc).join(", ") || l.pc_numero,
        Fornecedor: c?.pcs.map((p) => p.fornecedor).filter(Boolean).join(", ") || l._fornecedor,
        Comprado: c?.valor_pc ?? "",
        Situação: c?.pcs.map((p) => situacaoPc(p).t).join(", ") ?? "",
        Observação: l.observacao,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Materiais");
    XLSX.writeFile(wb, `materiais-projeto-${codigoProjeto}.xlsx`);
  }, [validas, codigoProjeto, cmpPorId]);

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
    for (const nome of gruposMeta?.prazo.grupos ?? []) {
      const k = normGrupo(nome);
      if (!m.has(k)) m.set(k, { k, nome, n: 0, data: null, proprias: 0, daCp: true });
    }
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
            Digite ou cole do Excel as colunas <strong>Equipamento · Item · Qtd · Modelo · PC · Observação</strong> (e, se quiser, Valor unit.).
            Ao digitar o Item, o catálogo sugere os <strong>itens do nosso estoque</strong> (código novo) com último preço, fornecedor e prazos;
            à direita, o que já foi comprado: RC, pedido de compra, valor e situação.
          </p>
        </div>
      </header>

      {/* Quanto vou gastar — KPIs que eram da aba "Compras × lista". */}
      {cmp && (
        <KpisCompras d={cmp} estimado={estimado} restante={restante} linhas={validas.length}
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
        <button type="button" onClick={() => void gerarRc()} disabled={!!ocupado || !paraRc.length}
          title={paraRc.length ? "Cria a requisição de compra (RC) em Compras com as linhas marcadas sem RC/PC" : "Marque linhas sem RC/PC na caixinha da esquerda"}
          className="px-2 py-1 text-[11px] rounded-lg border border-ww-accent text-ww-accent hover:bg-ww-accentSoft transition disabled:opacity-40">
          {ocupado === "rc" ? "Gerando…" : `Gerar RC (${paraRc.length})`}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={exportar} disabled={!validas.length}
          className="px-2 py-1 text-[11px] rounded-lg border border-ww-border text-ww-textMuted
                     hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
          Exportar Excel
        </button>
        <button type="button" onClick={() => void salvar()} disabled={salvando || !sujo}
          title={sujo ? "Grava a lista inteira" : "Nada mudou desde a última gravação"}
          className={`px-2.5 py-1 text-[11.5px] rounded-lg border transition ${
            sujo ? "border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110"
                 : "border-ww-border text-ww-textFaint cursor-not-allowed"}`}>
          {salvando ? "…" : "Salvar lista"}
        </button>
      </div>

      {/* Grupos de equipamento: filtro + "necessário em" do grupo. Os nomes vêm
          da coluna Equipamento (e da CP); a data do grupo preenche as linhas. */}
      {(grupos.length > 0) && (
        <div className="rounded-lg border border-ww-border bg-ww-bg/30 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <strong className="text-ww-text">Grupos de equipamento</strong>
            <span className="text-ww-textFaint">clique no nome para filtrar · a data do grupo preenche “Necessário em” das linhas dele</span>
            {sugestaoData && semDataComItens.length > 0 && (
              <button type="button" className="text-ww-accent hover:underline" title={gruposMeta?.prazo.fonte ?? undefined}
                onClick={() => semDataComItens.forEach((g) => definirDataGrupo(g.k, sugestaoData))}>
                usar {dia(sugestaoData)} ({gruposMeta?.prazo.fonte}) nos {semDataComItens.length} grupo(s) sem data
              </button>
            )}
            <span className="ml-auto flex items-center gap-1">
              {(["todas", "sem_pc", "com_pc"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setFiltroPc(k)}
                  className={`px-2 py-0.5 rounded-full border transition ${filtroPc === k ? "border-ww-accent bg-ww-accent text-white" : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                  {k === "todas" ? `Todas ${validas.length}` : k === "sem_pc" ? `Sem PC ${validas.length - nComPc}` : `Com PC ${nComPc}`}
                </button>))}
            </span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" onClick={() => setEquipFiltro(null)}
              className={`px-2 py-1 text-[11px] rounded-md border transition ${
                !equipFiltro ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold" : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
              Todos <span className="tabular-nums opacity-70">{validas.length}</span>
            </button>
            {grupos.map((g) => {
              const padrao = nomesPadrao.length ? nomePadrao(g.nome, nomesPadrao) : null;
              return (
                <div key={g.k} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] ${
                  equipFiltro === g.k ? "border-ww-accent bg-ww-accentSoft" : "border-ww-border"} ${g.daCp ? "opacity-70" : ""}`}>
                  <button type="button" onClick={() => setEquipFiltro(equipFiltro === g.k ? null : g.k)} disabled={!g.n}
                    className={`font-semibold ${equipFiltro === g.k ? "text-ww-accent" : "text-ww-text"} hover:underline disabled:no-underline`}
                    title={g.daCp ? "Equipamento da CP ainda sem itens na lista" : "Filtrar a lista por este grupo"}>
                    {g.nome} <span className="tabular-nums font-normal opacity-70">{g.n}</span>
                  </button>
                  {padrao && padrao !== g.nome && g.n > 0 && (
                    <button type="button" className="text-amber-700 dark:text-amber-300 hover:underline" title={`Usar o nome padrão do cadastro: ${padrao}`}
                      onClick={() => renomearGrupo(g.k, padrao)}>≈ {padrao}</button>
                  )}
                  <label className="flex items-center gap-1 text-ww-textMuted" title="Necessário em (do grupo)">
                    <span className="sr-only">Necessário em</span>
                    <input type="date" value={g.data ?? ""} disabled={!g.n}
                      onChange={(e) => definirDataGrupo(g.k, e.target.value)}
                      className="bg-transparent border border-ww-border rounded px-1 py-0.5 text-[11px] text-ww-text w-[118px] disabled:opacity-40" />
                  </label>
                  {g.proprias > 0 && <span className="text-[10px] text-amber-700 dark:text-amber-300" title="Linhas com data própria, diferente da do grupo">{g.proprias} com data própria</span>}
                  {!g.data && g.n > 0 && sugestaoData && (
                    <button type="button" className="text-[10px] text-ww-accent hover:underline" title={gruposMeta?.prazo.fonte ?? undefined}
                      onClick={() => definirDataGrupo(g.k, sugestaoData)}>usar {dia(sugestaoData)}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {marcadas.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg border border-ww-accent/40 bg-ww-accentSoft text-[12px]">
          <strong className="text-ww-accent">{marcadas.size} item(ns) marcados</strong>
          <button type="button" onClick={() => setPicker(true)}
            className="px-2.5 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition">
            Vincular a um PC
          </button>
          <button type="button" onClick={() => void gerarRc()} disabled={!paraRc.length || !!ocupado}
            title={paraRc.length < marcadas.size ? `${marcadas.size - paraRc.length} marcada(s) já têm RC/PC e ficam de fora` : undefined}
            className="px-2.5 py-1 rounded-lg border border-ww-accent text-ww-accent text-[11.5px] font-semibold hover:bg-ww-panel transition disabled:opacity-40">
            Gerar RC ({paraRc.length})
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
      {sujo && rascunhoDe == null && validas.length >= original && (
        <div className="p-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11.5px] text-amber-800 dark:text-amber-200">
          Alterações <strong>ainda não salvas</strong> — clique em <strong>Salvar lista</strong> para gravar no sistema.
        </div>
      )}
      {sujo && validas.length < original && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Você tinha {original} item(ns) e agora há {validas.length}. Salvar vai <strong>remover</strong> a
          diferença — a lista gravada passa a ser exatamente o que está nesta grade.
        </div>
      )}

      {sugestoes && (
        <SugestoesVinculo sugestoes={sugestoes} ocupado={ocupado} onConfirmar={(c) => void confirmarSugestao(c)} onFechar={() => setSugestoes(null)} />
      )}

      {/* Minha lista × Itens da CP: a CP é referência, a lista é o que se compra. */}
      <div className="flex items-center gap-1 border-b border-ww-border">
        {([["lista", `Minha lista (${validas.length})`], ["cp", `Itens da CP${cp ? ` (${cp.itens.length})` : ""}`]] as const).map(([k, rot]) => (
          <button key={k} type="button" onClick={() => setSubAba(k)}
            className={`px-3 py-1.5 text-[11.5px] -mb-px border-b-2 transition ${
              subAba === k ? "border-ww-accent text-ww-text font-semibold" : "border-transparent text-ww-textMuted hover:text-ww-text"}`}>
            {rot}
          </button>
        ))}
        {subAba === "cp" && cp?.proposta && (
          <span className="ml-auto text-[10.5px] text-ww-textFaint pb-1">
            composição de preço da proposta <strong>{cp.proposta}</strong> · case cada item e marque o que vai usar
          </span>
        )}
      </div>

      {subAba === "cp" ? (
        <div className="space-y-2">
          {cpCarregando && <p className="text-[11.5px] text-ww-textFaint py-3">Lendo a CP no CRM e casando com o catálogo…</p>}
          {cpErro && <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">Não consegui trazer a CP: {cpErro}</div>}
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
                  Adicionar {cpMarcados.size || ""} à minha lista
                </button>
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text"
                  title="Marca os itens casados (✓ ou escolhidos) que ainda não estão na lista"
                  onClick={() => setCpMarcados(new Set(cp.itens.map((it, k) => [it, k] as const)
                    .filter(([it]) => casado(it) && !naLista.has(chaveItem(it.equipamento, it.item))).map(([, k]) => k)))}>
                  marcar todos os que faltam
                </button>
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => setCpMarcados(new Set())}>limpar</button>
                <span className="text-[10.5px] text-ww-textFaint">
                  {cp.itens.filter(casado).length} de {cp.itens.length} casado(s)
                </span>
                <button type="button" className="ml-auto text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => void carregarCp()}>↻ reler a CP</button>
              </div>
              <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 480 }}>
                <table className="w-full text-[11.5px] border-collapse">
                  <thead className="sticky top-0 bg-ww-panel text-ww-textMuted z-[1]">
                    <tr className="text-left">
                      <th className="p-1.5 w-7"></th>
                      <th className="p-1.5">Equipamento</th>
                      <th className="p-1.5">Item da CP</th>
                      <th className="p-1.5 text-right">Qtd</th>
                      <th className="p-1.5 text-right">Custo CP</th>
                      <th className="p-1.5">No catálogo</th>
                      <th className="p-1.5 text-right">Últ. preço</th>
                      <th className="p-1.5">Fornecedor</th>
                      <th className="p-1.5">Entrega · Fatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cp.itens.map((it, k) => {
                      const ja = naLista.has(chaveItem(it.equipamento, it.item));
                      const c = it.casamento;
                      const m = c?.melhor;
                      const st = c?.status ?? "sem";
                      const ok = casado(it);
                      return (
                        <tr key={k} className={`border-t border-ww-border/50 ${ja ? "opacity-50" : ""}`}>
                          <td className="p-1.5 text-center">
                            {ja ? <span title="Já está na minha lista">✓</span>
                              : <input type="checkbox" checked={cpMarcados.has(k)} disabled={!ok}
                                  title={ok ? "Marcar para adicionar à minha lista" : "Case o item primeiro — clique em “No catálogo” e escolha (ou crie) o item nosso"}
                                  className={ok ? "" : "cursor-not-allowed"}
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
                Só entra na lista o item casado (✓ automático ou ✋ escolhido). Clique em “No catálogo” para escolher entre as sugestões,
                procurar outro item ou criar o item nosso — a escolha fica gravada para o mesmo texto. Ao adicionar, o valor vem do último
                preço pago (sem compra anterior, o custo da CP).
              </p>
            </>
          )}
        </div>
      ) : carregando
        ? <p className="text-[11.5px] text-ww-textFaint py-3">Carregando a lista…</p>
        : <GradeEditavel cols={COLS} linhas={visiveis}
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
            selecao={{
              marcadas,
              podeMarcar: (l) => l._id.startsWith("db"),
              onAlternar: alternar,
              onTodas: (marcar) => setMarcadas(marcar
                ? new Set(visiveis.filter((l) => l._id.startsWith("db")).map((l) => l._id))
                : new Set()),
            }}
            vazioMsg="Digite, cole do Excel ou use o botão de planilha acima." />}

      {cmp && <ForaDaLista fora={cmp.fora_da_lista} empresa={empresa} />}
      {cmp && <FluxoCompras d={cmp} />}

      {picker && (
        <PcPickerModal empresa={empresa} codigoProjeto={codigoProjeto}
          title={`Vincular ${marcadas.size} item(ns) a um PC`}
          onClose={() => setPicker(false)} onConfirm={vincular} />
      )}

      {seletor && seletorDados && (
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
      )}
    </section>
  );
}
