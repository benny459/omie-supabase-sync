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

import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import GradeEditavel, { linhaVazia, num, type ColunaGrade, type LinhaGrade } from "./GradeEditavel";
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
};
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

  // ── Colunas ───────────────────────────────────────────────────────────────
  // As quatro primeiras se editam; as três últimas vêm do PC e são de leitura.
  // A fronteira é visível: célula de leitura tem fundo próprio.
  const COLS: ColunaGrade[] = useMemo(() => [
    { key: "equipamento", label: "Equipamento", w: 150 },
    { key: "item",        label: "Item",        w: 300 },
    { key: "qtd",         label: "Qtd",         w: 62, tipo: "num", alinhaDireita: true },
    { key: "modelo",      label: "Modelo",      w: 140 },
    { key: "pc_numero",   label: "PC",          w: 84 },
    { key: "observacao",  label: "Observação",  w: 170 },
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

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const supa = supaBrowser();
      const approval = supa.schema("approval" as never);
      const [itens, res] = await Promise.all([
        approval.from("v_rc_projetos_itens")
          .select("id, equipamento, item, qtd, modelo, observacao, pc_numero, nome_fornecedor, dt_previsao, nova_prev_materiais, mt_data_recebimento_nf, pc_etapa_texto")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto)
          .order("equipamento", { ascending: true }).order("item", { ascending: true }),
        approval.from("v_rc_projetos_resumo")
          .select("valor_budget, valor_comprometido, valor_restante, qtd_itens, qtd_itens_com_pc")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto).maybeSingle(),
      ]);
      if (itens.error) { setErro(itens.error.message); return; }
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
        })) as LinhaGrade[],
        linhaVazia(COLS),
      ]);
      setSujo(false); setErro(null); setMarcadas(new Set());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto, COLS]);

  useEffect(() => { void carregar(); }, [carregar]);

  const validas = useMemo(() => linhas.filter((l) => String(l.item ?? "").trim()), [linhas]);
  const comPc = validas.filter((l) => String(l.pc_numero ?? "").trim()).length;
  const equipamentos = useMemo(
    () => Array.from(new Set(validas.map((l) => String(l.equipamento || "Geral")))).sort(),
    [validas]);

  const visiveis = useMemo(
    () => (equipFiltro ? linhas.filter((l) => !l.item?.trim() || String(l.equipamento || "Geral") === equipFiltro) : linhas),
    [linhas, equipFiltro]);

  const salvar = useCallback(async () => {
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
          items: validas.map((l) => ({
            equipamento: String(l.equipamento ?? "").trim() || "Geral",
            item: String(l.item ?? "").trim(),
            qtd: l.qtd?.trim() ? num(l.qtd) : null,
            modelo: String(l.modelo ?? "").trim() || null,
            observacao: String(l.observacao ?? "").trim() || null,
            pc_numero: String(l.pc_numero ?? "").trim() || null,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(`${validas.length} item(ns) gravado(s)${comPc ? `, ${comPc} com PC vinculado` : ""}.`);
      await carregar();
      onGravado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, validas, original, comPc, carregar, onGravado]);

  /** Vincula as marcadas a um PC. Escreve direto pela rota de vínculo em vez de
   *  mexer na grade: são itens que já existem no banco, e passar por um salvar
   *  da lista inteira arriscaria carregar junto uma edição não intencional. */
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
            Digite ou cole do Excel as colunas <strong>Equipamento · Item · Qtd · Modelo · PC · Observação</strong>.
            As três últimas colunas vêm do pedido vinculado e são só de leitura.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {resumo && (
            <span className="text-[10.5px] text-ww-textFaint tabular-nums">
              Budget {brl(resumo.valor_budget)} · comprometido {brl(resumo.valor_comprometido)} ·
              resta {brl(resumo.valor_restante)}
            </span>
          )}
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
      {sujo && validas.length < original && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Você tinha {original} item(ns) e agora há {validas.length}. Salvar vai <strong>remover</strong> a
          diferença — a lista gravada passa a ser exatamente o que está nesta grade.
        </div>
      )}

      {carregando
        ? <p className="text-[11.5px] text-ww-textFaint py-3">Carregando a lista…</p>
        : <GradeEditavel cols={COLS} linhas={visiveis}
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

      {picker && (
        <PcPickerModal empresa={empresa} codigoProjeto={codigoProjeto}
          title={`Vincular ${marcadas.size} item(ns) a um PC`}
          onClose={() => setPicker(false)} onConfirm={vincular} />
      )}
    </section>
  );
}
