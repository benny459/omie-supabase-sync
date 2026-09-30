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
// ── O que veio junto do bloco antigo ─────────────────────────────────────────
// Budget, exportar Excel e vincular vários itens a um PC de uma vez. Nenhum
// deles dependia da tabela duplicada — dependiam dos dados, que continuam aqui.
//
// ── Grava pela MESMA rota do upload ──────────────────────────────────────────
// /api/rc-projetos/upload já fazia o sync destrutivo e já aceitava pc_numero.
// Uma rota "manual" separada criaria duas definições do que é a lista, e elas
// divergiriam no primeiro ajuste de regra.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import GradeEditavel, { linhaVazia, num, type ColunaGrade, type LinhaGrade, type SugestaoGrade } from "./GradeEditavel";
import PcPickerModal, { type PcSearchResult } from "./PcPickerModal";
import { supaBrowser } from "@/lib/supabase";

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
};

/** Item do catálogo de compras do Omie (orders.mv_catalogo_compra). */
type Cat = {
  ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; ultima_compra: string | null; fornecedor: string | null;
  qtd_compras: number | null; entrega_dias: number | null; entrega_fonte: string | null;
  fat_dias: number | null; score?: number; medidas_ok?: boolean;
};
type Casamento = { idx: number; status: "ok" | "conferir" | "sem"; melhor: Cat | null; alternativas: Cat[] };

/** Campos que o catálogo preenche na linha. `_match` e `_alts` só vivem na tela. */
const CAT_CAMPOS = ["cat_ncod_prod", "cat_codigo", "cat_valor_unit", "cat_fornecedor",
                    "cat_entrega_dias", "cat_fat_dias", "_match", "_alts"];

const s = (v: unknown) => (v == null ? "" : String(v));
/** Preenche a linha com um item do catálogo. O valor vem do ÚLTIMO PREÇO PAGO
 *  (decisão do Benny, 30/09/2026); sem compra anterior, o que já havia fica. */
function camposDoCatalogo(c: Cat, match: "ok" | "conferir", alts: Cat[] = [], valorAtual = ""): Record<string, string> {
  return {
    cat_ncod_prod: s(c.ncod_prod), cat_codigo: s(c.codigo),
    cat_valor_unit: c.ultimo_preco != null ? String(c.ultimo_preco) : valorAtual,
    cat_fornecedor: s(c.fornecedor), cat_entrega_dias: s(c.entrega_dias), cat_fat_dias: s(c.fat_dias),
    _match: match, _alts: alts.length ? JSON.stringify(alts) : "",
  };
}
function sugestao(c: Cat): SugestaoGrade {
  const partes = [
    c.codigo ? `cód ${c.codigo}` : "só cadastro",
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
type Resumo = {
  valor_budget: number | null; valor_comprometido: number | null;
  valor_restante: number | null; qtd_itens: number | null; qtd_itens_com_pc: number | null;
};

const brl = (v: number | null) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const dia = (s: string | null | undefined) => {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(s);
};

/** Situação da entrega do item, a partir do PC vinculado. Vira pílula porque
 *  "31d atraso" e "Conferido" precisam se distinguir de relance.
 *
 *  Recebe o registro cru da grade (sem exigir `_id`): a coluna de leitura é
 *  chamada tanto com a linha inteira quanto com o que o render entrega. */
function statusDe(l: Record<string, string>) {
  if (!l.pc_numero?.trim()) return { rot: "sem PC", classe: "text-ww-textFaint" };
  if (l._recebido) return { rot: "Recebido", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30" };
  const prev = l._prev_efetiva;
  if (!prev) return { rot: "sem previsão", classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30" };
  const dias = Math.floor((Date.now() - new Date(`${prev}T12:00:00`).getTime()) / 86400000);
  if (dias > 0) return { rot: `${dias}d atraso`, classe: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30" };
  return { rot: "A caminho", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30" };
}

export default function MateriaisGrade({
  empresa, codigoProjeto, onGravado,
}: {
  empresa: string; codigoProjeto: number; onGravado?: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaGrade[]>([linhaVazia([])]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  const [original, setOriginal] = useState(0);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState(false);
  const [equipFiltro, setEquipFiltro] = useState<string | null>(null);
  /** Rascunho não salvo encontrado neste navegador ao abrir (ms de quando foi feito). */
  const [rascunhoDe, setRascunhoDe] = useState<number | null>(null);
  const chaveRascunho = `painel.materiais.rascunho.${empresa}.${codigoProjeto}`;

  // ── Colunas ───────────────────────────────────────────────────────────────
  // As quatro primeiras se editam; as três últimas vêm do PC e são de leitura.
  // A fronteira é visível: célula de leitura tem fundo próprio.
  const COLS: ColunaGrade[] = useMemo(() => [
    { key: "equipamento", label: "Equipamento", w: 150 },
    { key: "item",        label: "Item",        w: 300,
      // Digitar busca no catálogo do Omie; linha amarela ("conferir") mostra
      // as alternativas assim que a célula recebe o foco.
      limpaAoEditar: CAT_CAMPOS,
      autocompletar: {
        buscar: async (q) => {
          const r = await fetch(`/api/catalogo/buscar?q=${encodeURIComponent(q)}&lim=12`);
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
    { key: "qtd",         label: "Qtd",         w: 62, tipo: "num", alinhaDireita: true },
    { key: "modelo",      label: "Modelo",      w: 140 },
    { key: "pc_numero",   label: "PC",          w: 84 },
    { key: "observacao",  label: "Observação",  w: 150 },
    // ── Do catálogo do Omie (último preço pago, fornecedor, prazos médios) ──
    { key: "cat_valor_unit", label: "Valor unit.", w: 92, tipo: "moeda", alinhaDireita: true },
    { key: "_total", label: "Total", w: 96, alinhaDireita: true,
      calculada: (l) => {
        const t = num(l.qtd) * num(l.cat_valor_unit);
        return t ? brl(t) : "";
      } },
    { key: "_cat", label: "Fornecedor sugerido", w: 190,
      render: (l) => {
        if (l._match === "conferir") return (
          <span className="text-amber-700 dark:text-amber-300" title="O texto é parecido, mas não é certeza — clique no Item e escolha na lista">
            ⚠ conferir · <span className="text-ww-textMuted">{l.cat_fornecedor || "—"}</span>
          </span>);
        if (l._match === "sem") return <span className="text-ww-textFaint" title="Nada parecido no catálogo do Omie">sem correspondência</span>;
        if (!l.cat_ncod_prod) return <span className="text-ww-textFaint">—</span>;
        return (
          <span className="text-ww-textMuted" title={l.cat_codigo ? `Código Omie ${l.cat_codigo}` : undefined}>
            <span className="text-emerald-600 dark:text-emerald-400">✓</span> {l.cat_fornecedor || "sem compra anterior"}
          </span>);
      } },
    { key: "_prazos", label: "Entrega · Fatura", w: 100,
      render: (l) => (l.cat_entrega_dias || l.cat_fat_dias
        ? <span className="text-ww-textMuted tabular-nums">{l.cat_entrega_dias ? `${l.cat_entrega_dias}d` : "—"} · {l.cat_fat_dias ? `${l.cat_fat_dias}d` : "—"}</span>
        : <span className="text-ww-textFaint">—</span>) },
    { key: "_fornecedor", label: "Fornecedor",  w: 180,
      render: (l) => <span className="text-ww-textMuted">{l._fornecedor || "—"}</span> },
    { key: "_prev",       label: "Prev. PC",    w: 90,
      render: (l) => (
        <span className="text-ww-textMuted tabular-nums">
          {dia(l._prev_efetiva)}
          {l._nova_prev && <span className="block text-[9.5px] text-ww-accent">reprogramado</span>}
        </span>
      ) },
    { key: "_status",     label: "Status",      w: 104,
      render: (l) => {
        const s = statusDe(l);
        return <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.classe}`}>{s.rot}</span>;
      } },
  ], []);

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
      const [itens, res] = await Promise.all([
        approval.from("v_rc_projetos_itens")
          .select("id, equipamento, item, qtd, modelo, observacao, pc_numero, nome_fornecedor, dt_previsao, nova_prev_materiais, mt_data_recebimento_nf, pc_etapa_texto, cat_ncod_prod, cat_codigo, cat_valor_unit, cat_fornecedor, cat_entrega_dias, cat_fat_dias")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto)
          .order("equipamento", { ascending: true }).order("item", { ascending: true }),
        approval.from("v_rc_projetos_resumo")
          .select("valor_budget, valor_comprometido, valor_restante, qtd_itens, qtd_itens_com_pc")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto).maybeSingle(),
      ]);
      // Sem marcar a carga como OK, a tela fica indistinguível de "projeto
      // vazio" — e foi assim que salvar por cima apagou lista alheia.
      if (itens.error) { setErro(itens.error.message); setCarregouOk(false); return; }
      const rows = (itens.data ?? []) as ItemRow[];
      setOriginal(rows.length);
      setResumo((res.data as Resumo | null) ?? null);
      setLinhas([
        ...rows.map((r) => ({
          _id: `db${r.id}`,
          equipamento: r.equipamento ?? "",
          item: r.item ?? "",
          qtd: r.qtd == null ? "" : String(r.qtd),
          modelo: r.modelo ?? "",
          pc_numero: r.pc_numero ?? "",
          observacao: r.observacao ?? "",
          // Campos de leitura viajam junto na linha, prefixados com _ para não
          // serem confundidos com o que vai pro banco no salvar.
          _fornecedor: r.nome_fornecedor ?? "",
          _prev_efetiva: r.nova_prev_materiais ?? r.dt_previsao ?? "",
          _nova_prev: r.nova_prev_materiais ?? "",
          _recebido: r.mt_data_recebimento_nf ?? "",
          cat_ncod_prod: s(r.cat_ncod_prod), cat_codigo: s(r.cat_codigo),
          cat_valor_unit: s(r.cat_valor_unit), cat_fornecedor: s(r.cat_fornecedor),
          cat_entrega_dias: s(r.cat_entrega_dias), cat_fat_dias: s(r.cat_fat_dias),
          _match: r.cat_ncod_prod ? "ok" : "", _alts: "",
        })) as LinhaGrade[],
        linhaVazia(COLS),
      ]);
      setSujo(false); setErro(null); setMarcadas(new Set()); setCarregouOk(true);
      /* Lista colada e não salva sumia no primeiro recarregar — "Atualizar
         versão", F5, fechar a aba. Aconteceu mais de uma vez (PJ359, PJ362–364,
         set/2026): o banco nunca recebeu essas listas. Agora o que não foi
         salvo fica guardado neste navegador e volta aqui, à vista. */
      try {
        const bruto = window.localStorage.getItem(`painel.materiais.rascunho.${empresa}.${codigoProjeto}`);
        if (bruto) {
          const r = JSON.parse(bruto) as { em: number; linhas: LinhaGrade[] };
          if (Array.isArray(r.linhas) && r.linhas.some((l) => String(l.item ?? "").trim())) {
            setLinhas(r.linhas);
            setSujo(true);
            setRascunhoDe(r.em);
          }
        }
      } catch { /* storage bloqueado: segue sem rascunho */ }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCarregouOk(false);
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto, COLS]);

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
  const equipamentos = useMemo(
    () => Array.from(new Set(validas.map((l) => String(l.equipamento || "Geral")))).sort(),
    [validas]);

  const visiveis = useMemo(
    () => (equipFiltro ? linhas.filter((l) => !l.item?.trim() || String(l.equipamento || "Geral") === equipFiltro) : linhas),
    [linhas, equipFiltro]);

  const salvar = useCallback(async (confirmarRemocao = false) => {
    if (!carregouOk) {
      setErro("A lista não chegou a carregar. Recarregue a página antes de salvar — "
            + "gravar agora apagaria o que está no projeto.");
      return;
    }
    if (validas.length < original) {
      const ok = window.confirm(
        `A lista tem ${original} item(ns) gravado(s) e você está salvando ${validas.length}.\n\n` +
        `${original - validas.length} item(ns) serão REMOVIDOS do projeto. Confirma?`);
      if (!ok) return;
    }
    setSalvando(true); setErro(null); setAviso(null);
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
  }, [empresa, codigoProjeto, validas, original, comPc, carregar, onGravado, carregouOk]);

  /** Ref para o salvar poder rechamar a si mesmo depois da confirmação, sem
   *  entrar na lista de dependências do próprio useCallback. */
  const salvarRef = useRef<((c?: boolean) => Promise<void>) | null>(null);
  salvarRef.current = salvar;

  // ── Catálogo do Omie ────────────────────────────────────────────────────
  const [casando, setCasando] = useState(false);

  /** Casa com o catálogo as linhas com texto e sem vínculo. Aceita sozinho só o
   *  que é muito parecido E tem as mesmas medidas; o resto fica "conferir". */
  const casarLinhas = useCallback(async (base: LinhaGrade[]) => {
    const alvo = base.map((l, i) => ({ l, i }))
      .filter(({ l }) => String(l.item ?? "").trim() && !l.cat_ncod_prod && l._match !== "sem");
    if (!alvo.length) return base;
    const r = await fetch("/api/catalogo/casar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itens: alvo.map(({ l }) => [l.item, l.modelo].filter(Boolean).join(" ")) }),
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
    setAviso(`Catálogo do Omie: ${ok} item(ns) casado(s)`
      + (conf ? ` · ${conf} para CONFERIR (amarelo — clique no Item e escolha)` : "")
      + (sem ? ` · ${sem} sem correspondência` : "") + ". Nada foi gravado ainda: confira e clique em Salvar lista.");
    return novas;
  }, []);

  const casarAgora = useCallback(async () => {
    setCasando(true); setErro(null);
    try {
      const novas = await casarLinhas(linhas);
      if (novas !== linhas) { setLinhas(novas); setSujo(true); }
      else setAviso("Todas as linhas já estão ligadas ao catálogo.");
    } catch (e) { setErro(`Não consegui casar com o catálogo: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setCasando(false); }
  }, [casarLinhas, linhas]);

  /** Depois de colar do Excel, casa sozinho — o paste chega ao estado no
   *  próximo render, então o efeito espera a lista nova. */
  const [casarAposColar, setCasarAposColar] = useState(false);
  useEffect(() => {
    if (!casarAposColar) return;
    setCasarAposColar(false);
    void casarAgora();
  }, [casarAposColar, casarAgora]);

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

  const chaveItem = (eq: string, item: string) =>
    `${String(eq || "Geral").trim().toLowerCase()}|${String(item).trim().toLowerCase()}`;
  const naLista = useMemo(() => new Set(validas.map((l) => chaveItem(l.equipamento, l.item))), [validas]);

  const carregarCp = useCallback(async () => {
    setCpCarregando(true); setCpErro(null);
    try {
      const r = await fetch(`/api/rc-projetos/itens-cp?codigo_projeto=${codigoProjeto}`);
      const j = (await r.json()) as { proposta?: string | null; itens?: ItemCp[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setCp({ proposta: j.proposta ?? null, itens: j.itens ?? [] });
      setCpMarcados(new Set());
    } catch (e) {
      setCpErro(e instanceof Error ? e.message : String(e));
    } finally { setCpCarregando(false); }
  }, [codigoProjeto]);
  useEffect(() => { if (subAba === "cp" && !cp && !cpCarregando) void carregarCp(); },
    [subAba, cp, cpCarregando, carregarCp]);

  const adicionarDaCp = useCallback(() => {
    if (!cp) return;
    const novas: LinhaGrade[] = [];
    for (const k of [...cpMarcados].sort((a, b) => a - b)) {
      const it = cp.itens[k];
      if (!it || naLista.has(chaveItem(it.equipamento, it.item))) continue;
      const c = it.casamento;
      const base: LinhaGrade = {
        ...linhaVazia(COLS), equipamento: it.equipamento, item: it.item,
        qtd: it.qtd != null ? String(it.qtd) : "", modelo: it.modelo ?? "",
        // Sem compra anterior no Omie, o custo usado na CP é o melhor valor que há.
        cat_valor_unit: it.custo_cp != null ? String(it.custo_cp) : "",
        observacao: `CP ${cp.proposta ?? ""}`.trim(),
      };
      novas.push(c?.melhor
        ? { ...base, ...camposDoCatalogo(c.melhor, c.status === "ok" ? "ok" : "conferir",
              c.status === "ok" ? [] : c.alternativas, base.cat_valor_unit) }
        : { ...base, _match: "sem" });
    }
    if (!novas.length) { setAviso("Nada novo para adicionar — os marcados já estão na lista."); return; }
    setLinhas([...linhas.filter((l) => String(l.item ?? "").trim()), ...novas, linhaVazia(COLS)]);
    setSujo(true);
    setCpMarcados(new Set());
    setSubAba("lista");
    const conf = novas.filter((l) => l._match === "conferir").length;
    setAviso(`${novas.length} item(ns) da CP adicionados à lista`
      + (conf ? ` · ${conf} para CONFERIR (amarelo)` : "") + ". Nada foi gravado ainda: clique em Salvar lista.");
  }, [cp, cpMarcados, naLista, linhas, COLS]);

  const totalLista = useMemo(
    () => validas.reduce((a, l) => a + num(l.qtd) * num(l.cat_valor_unit), 0), [validas]);

  /** Vincula as marcadas a um PC. Escreve direto pela rota de vínculo em vez de
   *  mexer na grade: são itens que já existem no banco, e passar por um salvar
   *  da lista inteira arriscaria carregar junto uma edição não intencional. */
  /* Vínculo automático: casa cada item com o item comprado nos pedidos DESTE
     projeto e grava o número. Só sobra para a mão o que não achou — e o que
     casou por semelhança (não por texto idêntico) fica listado para conferir. */
  const [autoLink, setAutoLink] = useState<{
    total: number; exatos: number; similares: number; semPc: number;
    palpites: Array<{ id: string; item: string; pc: string | null; score: number; descPc: string }>;
  } | null>(null);
  const vincularAuto = useCallback(async () => {
    setSalvando(true); setErro(null); setAutoLink(null);
    try {
      const r = await fetch("/api/rc-projetos/itens/auto-link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, aplicar: true }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? "falha ao vincular"); return; }
      setAutoLink(j);
      setAviso(j.gravados
        ? `${j.gravados} item(ns) vinculados — ${j.exatos} por descrição idêntica, ${j.similares} por semelhança` +
          (j.semPc ? `; ${j.semPc} sem pedido correspondente, para vincular à mão` : "")
        : (j.aviso ?? "Nenhum item novo para vincular."));
      await carregar();
      onGravado?.();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSalvando(false); }
  }, [empresa, codigoProjeto, carregar, onGravado]);

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
    const dados = validas.map((l) => ({
      Equipamento: l.equipamento, Item: l.item, Qtd: l.qtd, Modelo: l.modelo,
      "Valor unit.": l.cat_valor_unit ? num(l.cat_valor_unit) : "",
      Total: num(l.qtd) * num(l.cat_valor_unit) || "",
      "Código Omie": l.cat_codigo, "Fornecedor sugerido": l.cat_fornecedor,
      "Entrega (d)": l.cat_entrega_dias, "Fatura (d)": l.cat_fat_dias,
      PC: l.pc_numero, Fornecedor: l._fornecedor,
      "Prev. PC": dia(l._prev_efetiva), Status: statusDe(l).rot,
      Observação: l.observacao,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Materiais");
    XLSX.writeFile(wb, `materiais-projeto-${codigoProjeto}.xlsx`);
  }, [validas, codigoProjeto]);

  const alternar = useCallback((id: string, _i: number, _shift: boolean) => {
    setMarcadas((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-2.5">
      <header className="flex items-baseline gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Lista de materiais
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Digite ou cole do Excel as colunas <strong>Equipamento · Item · Qtd · Modelo · PC · Observação</strong> (e, se quiser, Valor unit.).
            Ao digitar o Item, o catálogo do Omie sugere o produto com <strong>último preço pago, fornecedor e prazos médios</strong>;
            ao colar, casa sozinho — o que não for certeza fica amarelo para conferir.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {totalLista > 0 && (
            <span className="text-[11px] font-semibold text-ww-text tabular-nums" title="Soma de Qtd × Valor unit. da lista">
              Total da lista {brl(totalLista)}
            </span>
          )}
          {resumo && (
            <span className="text-[10.5px] text-ww-textFaint tabular-nums">
              Budget {brl(resumo.valor_budget)} · comprometido {brl(resumo.valor_comprometido)} ·
              resta {brl(resumo.valor_restante)}
            </span>
          )}
          <button type="button" onClick={() => void casarAgora()} disabled={salvando || casando}
            title="Liga cada linha ao item do catálogo do Omie: último preço pago, fornecedor e prazos médios"
            className="px-2 py-1 text-[11px] rounded-lg border border-emerald-400 dark:border-emerald-700
                       bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200
                       hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition disabled:opacity-40">
            {casando ? "…" : "⚡ Casar com o Omie"}
          </button>
          <button type="button" onClick={() => void vincularAuto()} disabled={salvando}
            title="Procura, nos pedidos de compra deste projeto, o item que corresponde a cada linha — e grava o número do PC"
            className="px-2 py-1 text-[11px] rounded-lg border border-sky-400 dark:border-sky-700
                       bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200
                       hover:bg-sky-100 dark:hover:bg-sky-900/50 transition disabled:opacity-40">
            ⇄ Vincular PCs automaticamente
          </button>
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
      </header>

      {/* Filtro por equipamento — o que antes eram abas. Vira filtro porque a
          tabela agora é uma só e trocar de aba escondia metade da lista. */}
      {equipamentos.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => setEquipFiltro(null)}
            className={`px-2 py-0.5 text-[11px] rounded border transition ${
              !equipFiltro ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                           : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            Todos <span className="tabular-nums opacity-70">{validas.length}</span>
          </button>
          {equipamentos.map((eq) => {
            const n = validas.filter((l) => String(l.equipamento || "Geral") === eq).length;
            return (
              <button key={eq} type="button" onClick={() => setEquipFiltro(eq)}
                className={`px-2 py-0.5 text-[11px] rounded border transition ${
                  equipFiltro === eq ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                     : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {eq} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {marcadas.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-ww-accent/40 bg-ww-accentSoft text-[12px]">
          <strong className="text-ww-accent">{marcadas.size} item(ns) marcados</strong>
          <button type="button" onClick={() => setPicker(true)}
            className="px-2.5 py-1 rounded-lg bg-ww-accent text-white text-[11.5px] font-semibold hover:brightness-110 transition">
            Vincular a um PC
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
            composição de preço da proposta <strong>{cp.proposta}</strong> · marque o que vai usar e clique em Adicionar
          </span>
        )}
      </div>

      {subAba === "cp" ? (
        <div className="space-y-2">
          {cpCarregando && <p className="text-[11.5px] text-ww-textFaint py-3">Lendo a CP no CRM e casando com o catálogo do Omie…</p>}
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
                  onClick={() => setCpMarcados(new Set(cp.itens.map((it, k) => [it, k] as const)
                    .filter(([it]) => !naLista.has(chaveItem(it.equipamento, it.item))).map(([, k]) => k)))}>
                  marcar todos os que faltam
                </button>
                <button type="button" className="text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => setCpMarcados(new Set())}>limpar</button>
                <button type="button" className="ml-auto text-[11px] text-ww-textMuted hover:text-ww-text" onClick={() => void carregarCp()}>↻ reler a CP</button>
              </div>
              <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 480 }}>
                <table className="w-full text-[11.5px] border-collapse">
                  <thead className="sticky top-0 bg-ww-panel text-ww-textMuted">
                    <tr className="text-left">
                      <th className="p-1.5 w-7"></th>
                      <th className="p-1.5">Equipamento</th>
                      <th className="p-1.5">Item da CP</th>
                      <th className="p-1.5 text-right">Qtd</th>
                      <th className="p-1.5 text-right">Custo CP</th>
                      <th className="p-1.5">No Omie</th>
                      <th className="p-1.5 text-right">Últ. preço</th>
                      <th className="p-1.5">Fornecedor</th>
                      <th className="p-1.5">Entrega · Fatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cp.itens.map((it, k) => {
                      const ja = naLista.has(chaveItem(it.equipamento, it.item));
                      const m = it.casamento?.melhor;
                      const st = it.casamento?.status ?? "sem";
                      return (
                        <tr key={k} className={`border-t border-ww-border/50 ${ja ? "opacity-50" : ""}`}>
                          <td className="p-1.5 text-center">
                            {ja ? <span title="Já está na minha lista">✓</span>
                              : <input type="checkbox" checked={cpMarcados.has(k)}
                                  onChange={() => setCpMarcados((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />}
                          </td>
                          <td className="p-1.5 text-ww-textMuted">{it.equipamento}</td>
                          <td className="p-1.5 text-ww-text">{it.item}{it.modelo ? <span className="text-ww-textFaint"> · {it.modelo}</span> : null}</td>
                          <td className="p-1.5 text-right tabular-nums">{it.qtd ?? "—"}</td>
                          <td className="p-1.5 text-right tabular-nums">{brl(it.custo_cp)}</td>
                          <td className="p-1.5">
                            {!m ? <span className="text-ww-textFaint">sem correspondência</span>
                              : <span className={st === "ok" ? "text-ww-textMuted" : "text-amber-700 dark:text-amber-300"} title={m.descricao}>
                                  {st === "ok" ? "✓ " : "⚠ conferir · "}{m.descricao.length > 48 ? `${m.descricao.slice(0, 48)}…` : m.descricao}
                                </span>}
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
                Ao adicionar, o valor vem do último preço pago no Omie (sem compra anterior, o custo da CP). O que ficar
                amarelo na lista é casamento incerto: clique no Item e escolha o produto certo.
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
              if (equipFiltro) {
                const ocultas = linhas.filter((x) => x.item?.trim() && String(x.equipamento || "Geral") !== equipFiltro);
                setLinhas([...ocultas, ...l]);
              } else setLinhas(l);
              setSujo(true);
            }}
            altura={480}
            selecao={{
              marcadas,
              podeMarcar: (l) => l._id.startsWith("db"),
              onAlternar: alternar,
              onTodas: (marcar) => setMarcadas(marcar
                ? new Set(visiveis.filter((l) => l._id.startsWith("db")).map((l) => l._id))
                : new Set()),
            }}
            vazioMsg="Digite, cole do Excel ou use o botão de planilha acima." />}

      {autoLink && autoLink.palpites.length > 0 && (
        <details open className="rounded-lg border border-ww-border bg-ww-bg/40 px-3 py-2">
          <summary className="text-[11.5px] text-ww-text cursor-pointer">
            Conferir o vínculo automático — {autoLink.similares} por semelhança,{" "}
            {autoLink.semPc} sem pedido correspondente
          </summary>
          <table className="w-full mt-2 text-[11px]">
            <tbody>
              {autoLink.palpites.map((p) => (
                <tr key={p.id} className="border-t border-ww-border/60">
                  <td className="py-1 pr-2 text-ww-text">{p.item}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {p.pc
                      ? <span className="text-emerald-600 dark:text-emerald-300">→ PC {p.pc}</span>
                      : <span className="text-ww-textFaint">sem correspondência</span>}
                  </td>
                  <td className="py-1 text-ww-textMuted">{p.descPc || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10.5px] text-ww-textFaint mt-1.5">
            O que ficou sem correspondência vincula-se à mão: marque as linhas na tabela e use “Vincular ao PC”.
            Para trocar um vínculo, é o mesmo caminho.
          </p>
        </details>
      )}

      {picker && (
        <PcPickerModal empresa={empresa} codigoProjeto={codigoProjeto}
          title={`Vincular ${marcadas.size} item(ns) a um PC`}
          onClose={() => setPicker(false)} onConfirm={vincular} />
      )}
    </section>
  );
}
