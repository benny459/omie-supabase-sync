"use client";

// Lista de materiais como planilha: digitar, colar do Excel, ou subir o XLSX.
//
// ── O que mudou ──────────────────────────────────────────────────────────────
// Antes o único caminho era o upload. Quem precisava acrescentar UM item tinha
// que abrir o Excel, achar o arquivo mestre, editar, salvar e subir de novo —
// e cada volta dessas é uma chance de a planilha do disco divergir da lista do
// painel.
//
// ── Grava pela MESMA rota do upload ──────────────────────────────────────────
// /api/rc-projetos/upload já recebe `items[]` e faz o sync destrutivo (insere
// novos, atualiza existentes por item_norm, apaga o que sumiu). Escrever uma
// segunda rota "manual" criaria duas definições do que é a lista — e elas
// divergiriam no primeiro ajuste de regra. O gesto muda; a gravação, não.
//
// ── Por que a coluna PC vive aqui ────────────────────────────────────────────
// A rota já aceita pc_numero. Deixar o vínculo item→PC editável na mesma grade
// evita a viagem "salva a lista, abre outra tela, vincula um a um" — e é o
// vínculo que faz o material aparecer com status de recebimento.

import { useCallback, useEffect, useMemo, useState } from "react";
import GradeEditavel, { linhaVazia, num, type ColunaGrade, type LinhaGrade } from "./GradeEditavel";
import { supaBrowser } from "@/lib/supabase";

const COLS: ColunaGrade[] = [
  { key: "equipamento", label: "Equipamento", w: 190 },
  { key: "item",        label: "Item",        w: 320 },
  { key: "qtd",         label: "Qtd",         w: 72, tipo: "num", alinhaDireita: true },
  { key: "modelo",      label: "Modelo",      w: 160 },
  { key: "pc_numero",   label: "PC",          w: 110 },
  { key: "observacao",  label: "Observação",  w: 200 },
];

type ItemRow = {
  id: string; equipamento: string | null; item: string;
  qtd: number | null; modelo: string | null; observacao: string | null;
  pc_numero: string | null;
};

export default function MateriaisGrade({
  empresa, codigoProjeto, onGravado,
}: {
  empresa: string; codigoProjeto: number; onGravado?: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaGrade[]>([linhaVazia(COLS)]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sujo, setSujo] = useState(false);
  /** Quantos itens existiam ao carregar. É o número que a confirmação de
   *  remoção precisa citar — "vai apagar 12 itens" só é honesto se souber 12. */
  const [original, setOriginal] = useState(0);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const supa = supaBrowser();
      const { data, error } = await supa.schema("approval" as never)
        .from("v_rc_projetos_itens")
        .select("id, equipamento, item, qtd, modelo, observacao, pc_numero")
        .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto)
        .order("equipamento", { ascending: true }).order("item", { ascending: true });
      if (error) { setErro(error.message); return; }
      const rows = (data ?? []) as ItemRow[];
      setOriginal(rows.length);
      setLinhas([
        ...rows.map((r) => ({
          _id: `db${r.id}`,
          equipamento: r.equipamento ?? "",
          item: r.item ?? "",
          qtd: r.qtd == null ? "" : String(r.qtd),
          modelo: r.modelo ?? "",
          pc_numero: r.pc_numero ?? "",
          observacao: r.observacao ?? "",
        })) as LinhaGrade[],
        linhaVazia(COLS),
      ]);
      setSujo(false); setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void carregar(); }, [carregar]);

  const validas = useMemo(
    () => linhas.filter((l) => String(l.item ?? "").trim()),
    [linhas]);
  const comPc = validas.filter((l) => String(l.pc_numero ?? "").trim()).length;

  const salvar = useCallback(async () => {
    // A rota faz sync DESTRUTIVO: o que não estiver aqui será apagado. Isso é
    // o comportamento certo para "esta é a lista", mas salvar uma grade
    // encolhida sem avisar apagaria itens em silêncio.
    if (validas.length < original) {
      const some = original - validas.length;
      const ok = window.confirm(
        `A lista tem ${original} item(ns) gravado(s) e você está salvando ${validas.length}.\n\n` +
        `${some} item(ns) serão REMOVIDOS do projeto. Confirma?`);
      if (!ok) return;
    }
    setSalvando(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-2.5">
      <header className="flex items-baseline gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Lista de materiais — edição direta
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Digite, ou cole do Excel as colunas <strong>Equipamento · Item · Qtd · Modelo · PC · Observação</strong>.
            Preencher a coluna <strong>PC</strong> já vincula o item ao pedido de compra — é o vínculo que traz
            previsão, logística e recebimento pra linha.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10.5px] text-ww-textFaint tabular-nums">
            {validas.length} item(ns){comPc ? ` · ${comPc} com PC` : ""}
          </span>
          <button type="button" onClick={() => void salvar()} disabled={salvando || !sujo}
            title={sujo ? "Grava a lista inteira" : "Nada mudou desde a última gravação"}
            className={`px-2.5 py-1 text-[11.5px] rounded-lg border transition ${
              sujo ? "border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110"
                   : "border-ww-border text-ww-textFaint cursor-not-allowed"}`}>
            {salvando ? "…" : "Salvar lista"}
          </button>
        </div>
      </header>

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
        : <GradeEditavel cols={COLS} linhas={linhas}
            onChange={(l) => { setLinhas(l); setSujo(true); }}
            altura={420}
            vazioMsg="Digite, cole do Excel ou use o botão de planilha acima." />}
    </section>
  );
}
