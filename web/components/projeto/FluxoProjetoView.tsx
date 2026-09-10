"use client";

// Fluxo de caixa previsto do projeto — lançar, aprovar, e comparar com o real.
//
// ── O que existia ────────────────────────────────────────────────────────────
// "Fluxo Financeiro" era só um botão de upload. Sem planilha não havia caminho,
// e o que ele gravava eram três totais agregados — que não desenham curva
// nenhuma: total sem data não tem eixo x, e sem separar entrada de saída não há
// fluxo, há orçamento.
//
// ── Duas grades, não uma com seletor ─────────────────────────────────────────
// Entradas e saídas em tabelas separadas. Uma grade só exigiria uma coluna
// "tipo" com combo em cada linha — e colar 30 linhas do Excel teria que trazer
// a palavra "entrada" repetida 30 vezes. Separado, o que se cola é só
// descrição, data e valor, que é o que a planilha de quem planeja tem.
//
// ── A aprovação é do PLANO INTEIRO ───────────────────────────────────────────
// O Marcelo desenha, o Benny aprova, e é essa aprovação que libera o Marcelo a
// aprovar os PCs do projeto. Por isso o estado vive no projeto e não na linha:
// não existe "metade do plano aprovada". Mexeu numa linha depois de aprovado, a
// aprovação cai (trigger no banco) — senão daria pra aprovar compra contra um
// plano que já não é o que foi lido.

import { useCallback, useEffect, useMemo, useState } from "react";
import GradeEditavel, {
  brl, linhaVazia, num, type ColunaGrade, type LinhaGrade,
} from "./GradeEditavel";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizBar from "@/components/viz/VizBar";

type LinhaApi = {
  id: number; tipo: "entrada" | "saida"; descricao: string; categoria: string | null;
  data_prevista: string; valor: number; observacao: string | null; origem: string; ordem: number;
};
type Cabecalho = {
  status: "rascunho" | "pendente" | "aprovado" | "rejeitado";
  versao: number;
  enviado_por?: string | null; enviado_em?: string | null;
  decidido_por?: string | null; decidido_em?: string | null; motivo?: string | null;
  total_entradas_aprovado?: number | null; total_saidas_aprovado?: number | null;
  linhas_aprovadas?: number | null;
};
type RealizadoRow = {
  mes: string; entrada_realizada: number; saida_realizada: number;
  qtd_entradas: number; qtd_saidas: number;
};
type Cobertura = {
  titulos_receber: number; valor_receber: number;
  titulos_pagar: number; valor_pagar: number; compras_no_projeto: number;
};
type Evento = {
  versao: number; acao: string; por: string | null; em: string;
  motivo: string | null; total_entradas: number | null; total_saidas: number | null; linhas: number | null;
};
type Payload = {
  linhas: LinhaApi[]; cabecalho: Cabecalho; realizado: RealizadoRow[];
  cobertura: Cobertura | null; eventos: Evento[];
  pode_editar: boolean; pode_aprovar: boolean; eu: string;
  error?: string;
};

const COLS: ColunaGrade[] = [
  { key: "descricao", label: "Descrição",  w: 300 },
  { key: "categoria", label: "Categoria",  w: 150 },
  { key: "data",      label: "Data",       w: 140, tipo: "data" },
  { key: "valor",     label: "Valor",      w: 130, tipo: "moeda", alinhaDireita: true },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBr = (iso: string) => {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

/** Linhas da API → linhas da grade. A grade guarda tudo como string porque é o
 *  que um input devolve; a conversão acontece na borda, dos dois lados. */
const paraGrade = (ls: LinhaApi[]): LinhaGrade[] => {
  const g = ls.map((l) => ({
    _id: `db${l.id}`,
    descricao: l.descricao,
    categoria: l.categoria ?? "",
    data: l.data_prevista,
    valor: String(l.valor).replace(".", ","),
  })) as LinhaGrade[];
  return g.length ? [...g, linhaVazia(COLS)] : [linhaVazia(COLS)];
};

const TOM: Record<Cabecalho["status"], { rot: string; classe: string; dica: string }> = {
  rascunho:  { rot: "Rascunho", classe: "border-ww-border bg-ww-panel text-ww-textMuted",
               dica: "Ainda não foi enviado para aprovação." },
  pendente:  { rot: "Aguardando aprovação", classe: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
               dica: "Enviado. As compras do projeto continuam travadas até a decisão." },
  aprovado:  { rot: "Aprovado", classe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
               dica: "As compras deste projeto já podem ser aprovadas." },
  rejeitado: { rot: "Rejeitado", classe: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
               dica: "Ajuste o plano e envie de novo." },
};

export default function FluxoProjetoView({
  empresa, codigoProjeto, nomeProjeto,
}: {
  empresa: string; codigoProjeto: number; nomeProjeto?: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [entradas, setEntradas] = useState<LinhaGrade[]>([linhaVazia(COLS)]);
  const [saidas, setSaidas] = useState<LinhaGrade[]>([linhaVazia(COLS)]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Marca que a grade foi tocada. Sem isso não dá pra distinguir "nada mudou"
   *  de "mudou e voltou ao mesmo" — e o botão de salvar mentiria nos dois. */
  const [sujo, setSujo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(
        `/api/rc-projetos/fluxo?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setErro(null);
      setData(j);
      setEntradas(paraGrade(j.linhas.filter((l) => l.tipo === "entrada")));
      setSaidas(paraGrade(j.linhas.filter((l) => l.tipo === "saida")));
      setSujo(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void carregar(); }, [carregar]);

  const preenchidas = (ls: LinhaGrade[]) =>
    ls.filter((l) => l.descricao?.trim() || l.valor?.trim());

  const totEnt = preenchidas(entradas).reduce((a, l) => a + num(l.valor), 0);
  const totSai = preenchidas(saidas).reduce((a, l) => a + num(l.valor), 0);
  const margem = totEnt > 0 ? ((totEnt - totSai) / totEnt) * 100 : null;

  const salvar = useCallback(async () => {
    setSalvando(true); setErro(null); setAviso(null);
    const monta = (ls: LinhaGrade[], tipo: "entrada" | "saida") =>
      preenchidas(ls).map((l) => ({
        tipo, descricao: l.descricao ?? "", categoria: l.categoria || null,
        data_prevista: l.data ?? "", valor: num(l.valor), origem: "manual" as const,
      }));
    try {
      const r = await fetch("/api/rc-projetos/fluxo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          linhas: [...monta(entradas, "entrada"), ...monta(saidas, "saida")],
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(`${j.linhas} linha(s) gravada(s).`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, entradas, saidas, carregar]);

  const decidir = useCallback(async (acao: string, motivo?: string) => {
    setSalvando(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, acao, motivo }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(
        acao === "enviar"  ? "Enviado para aprovação."
      : acao === "aprovar" ? "Fluxo aprovado — as compras deste projeto já podem ser aprovadas."
      : acao === "rejeitar" ? "Fluxo rejeitado."
      : "Fluxo reaberto para edição.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, carregar]);

  /** Previsto e realizado no MESMO eixo de meses. Os dois lados podem ter meses
   *  que o outro não tem — sem unir as chaves, um mês só realizado sumiria. */
  const grafico = useMemo(() => {
    const acc = new Map<string, { pe: number; ps: number; re: number; rs: number }>();
    const pega = (m: string) => acc.get(m) ?? { pe: 0, ps: 0, re: 0, rs: 0 };

    for (const l of preenchidas(entradas)) {
      if (!l.data) continue;
      const m = l.data.slice(0, 7);
      const c = pega(m); c.pe += num(l.valor); acc.set(m, c);
    }
    for (const l of preenchidas(saidas)) {
      if (!l.data) continue;
      const m = l.data.slice(0, 7);
      const c = pega(m); c.ps += num(l.valor); acc.set(m, c);
    }
    for (const r of data?.realizado ?? []) {
      const m = r.mes.slice(0, 7);
      const c = pega(m);
      c.re += Number(r.entrada_realizada) || 0;
      c.rs += Number(r.saida_realizada) || 0;
      acc.set(m, c);
    }
    return Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({
        x: mesBr(`${m}-01`),
        "Entrada prevista":  v.pe,
        "Entrada realizada": v.re,
        "Saída prevista":    v.ps,
        "Saída realizada":   v.rs,
      }));
  }, [entradas, saidas, data]);

  // Previsto vazado, realizado sólido: é a MESMA medida em dois estados, então
  // a cor continua dizendo de que medida se trata e o preenchimento diz o
  // estado. Quatro cores fariam procurar quatro coisas onde existem duas.
  const serie: SeriesDef[] = [
    { key: "Entrada prevista",  label: "Entrada prevista",  slot: 5, mark: "rect", variante: "vazada" },
    { key: "Entrada realizada", label: "Entrada realizada", slot: 5, mark: "rect" },
    { key: "Saída prevista",    label: "Saída prevista",    slot: 3, mark: "rect", variante: "vazada" },
    { key: "Saída realizada",   label: "Saída realizada",   slot: 3, mark: "rect" },
  ];

  const cab = data?.cabecalho ?? { status: "rascunho" as const, versao: 1 };
  const tom = TOM[cab.status];
  const podeEditar  = data?.pode_editar ?? false;
  const podeAprovar = data?.pode_aprovar ?? false;
  const realTot = (data?.realizado ?? []).reduce(
    (a, r) => ({ e: a.e + Number(r.entrada_realizada || 0), s: a.s + Number(r.saida_realizada || 0) }),
    { e: 0, s: 0 });

  return (
    <div className="space-y-3.5">
      {/* Faixa de estado. Fica no topo porque é ela que responde "posso comprar
          neste projeto?" — a pergunta que traz a maioria das pessoas aqui. */}
      <div className={`flex items-start gap-3 flex-wrap px-3.5 py-2.5 rounded-xl border text-[12px] ${tom.classe}`}>
        <div className="min-w-0">
          <strong>{tom.rot}</strong>
          {cab.versao > 1 && <span className="opacity-70"> · v{cab.versao}</span>}
          <span className="block text-[11px] opacity-90 mt-0.5">
            {tom.dica}
            {cab.status === "aprovado" && cab.decidido_por && (
              <> Aprovado por {cab.decidido_por}
                {cab.decidido_em ? ` em ${new Date(cab.decidido_em).toLocaleDateString("pt-BR")}` : ""}.</>
            )}
            {cab.status === "rejeitado" && cab.motivo && <> Motivo: <em>{cab.motivo}</em></>}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {podeEditar && (
            <button type="button" onClick={() => void salvar()}
              disabled={salvando || !sujo}
              title={sujo ? "Grava as linhas no painel" : "Nada mudou desde a última gravação"}
              className={`px-2.5 py-1 text-[11.5px] rounded-lg border transition ${
                sujo ? "border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110"
                     : "border-ww-border text-ww-textFaint cursor-not-allowed"}`}>
              {salvando ? "…" : "Salvar"}
            </button>
          )}
          {podeEditar && cab.status !== "pendente" && (
            <button type="button" onClick={() => void decidir("enviar")}
              disabled={salvando || sujo || !(totEnt || totSai)}
              title={sujo ? "Salve antes de enviar" : "Manda para aprovação do administrador"}
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-text
                         hover:bg-ww-rowHover transition disabled:opacity-40">
              Enviar para aprovação
            </button>
          )}
          {podeAprovar && cab.status === "pendente" && (
            <>
              <button type="button" onClick={() => void decidir("aprovar")} disabled={salvando}
                className="px-2.5 py-1 text-[11.5px] rounded-lg bg-emerald-600 text-white font-semibold
                           hover:brightness-110 transition disabled:opacity-40">
                Aprovar fluxo
              </button>
              <button type="button" disabled={salvando}
                onClick={() => {
                  const m = window.prompt("Motivo da rejeição:");
                  if (m?.trim()) void decidir("rejeitar", m.trim());
                }}
                className="px-2.5 py-1 text-[11.5px] rounded-lg border border-rose-500/50
                           text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 transition disabled:opacity-40">
                Rejeitar
              </button>
            </>
          )}
          {podeAprovar && cab.status === "aprovado" && (
            <button type="button" onClick={() => void decidir("reabrir")} disabled={salvando}
              title="Volta para rascunho — as compras do projeto voltam a ficar travadas"
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted
                         hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              Reabrir
            </button>
          )}
        </div>
      </div>

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
      {sujo && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Há alterações não gravadas. O gráfico já mostra o que você digitou; o painel só passa a
          considerar depois de <strong>Salvar</strong>.
        </div>
      )}

      {/* Números-âncora. Um plano sem total é uma lista; com total é uma decisão. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { rot: "Entradas previstas", val: brl(totEnt), sub: `${preenchidas(entradas).length} lançamento(s)`, tom: "receber" },
          { rot: "Saídas previstas",   val: brl(totSai), sub: `${preenchidas(saidas).length} lançamento(s)`,   tom: "pagar" },
          { rot: "Resultado previsto", val: brl(totEnt - totSai),
            sub: margem == null ? "sem entrada lançada" : `margem de ${margem.toFixed(1).replace(".", ",")}%`,
            tom: totEnt - totSai >= 0 ? "receber" : "pagar" },
          { rot: "Realizado no caixa", val: brl(realTot.e - realTot.s),
            sub: `${brl(realTot.e)} entrou · ${brl(realTot.s)} saiu`, tom: "neutro" },
        ].map((c) => (
          <div key={c.rot} className={`rounded-xl border p-3 ${
            c.tom === "receber" ? "border-emerald-500/25 bg-emerald-500/[0.06]"
          : c.tom === "pagar"   ? "border-rose-500/25 bg-rose-500/[0.06]"
          :                       "border-ww-border bg-ww-panel"}`}>
            <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{c.rot}</div>
            <div className={`text-[18px] font-bold tabular-nums tracking-[-0.5px] mt-1 ${
              c.tom === "receber" ? "text-emerald-600 dark:text-emerald-300"
            : c.tom === "pagar"   ? "text-rose-600 dark:text-rose-300"
            :                       "text-ww-text"}`}>{c.val}</div>
            <div className="text-[10.5px] text-ww-textMuted mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <ChartFrame
        title={`Previsto × realizado${nomeProjeto ? ` — ${nomeProjeto}` : ""}`}
        subtitle={
          "Barra vazada = previsto (o que você lançou abaixo); cheia = o que de fato entrou e saiu do caixa, pela data da baixa do título. "
          + (data?.cobertura
              ? `Realizado depende do título carregar o código do projeto: ${data.cobertura.titulos_pagar} título(s) a pagar e ${data.cobertura.titulos_receber} a receber estão vinculados, sobre ${data.cobertura.compras_no_projeto} compra(s) no projeto — o que sai sem vínculo não aparece aqui.`
              : "")
        }
        series={serie} rows={grafico} valueFormat={(v) => brl(Number(v))}
        loading={carregando} height={300}
      >
        {(vis) => (
          <VizBar rows={grafico}
            series={serie.filter((s) => vis.some((v) => v.key === s.key))}
            valueFormat={(v) => brl(v)} />
        )}
      </ChartFrame>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <Secao
          titulo="Entradas previstas"
          dica="O que você espera receber: parcelas do PV, medições. Digite, ou cole do Excel as colunas Descrição · Categoria · Data · Valor."
          total={totEnt} tom="receber"
          linhas={entradas} onChange={(l) => { setEntradas(l); setSujo(true); }}
          somenteLeitura={!podeEditar}
        />
        <Secao
          titulo="Saídas previstas"
          dica="O que você espera pagar: compras, serviços, despesas do projeto."
          total={totSai} tom="pagar"
          linhas={saidas} onChange={(l) => { setSaidas(l); setSujo(true); }}
          somenteLeitura={!podeEditar}
        />
      </div>

      {(data?.eventos?.length ?? 0) > 0 && (
        <details className="rounded-xl border border-ww-border bg-ww-panel px-3.5 py-2.5">
          <summary className="text-[11.5px] text-ww-textMuted cursor-pointer">
            Histórico de aprovação ({data!.eventos.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data!.eventos.map((e, i) => (
              <li key={i} className="text-[11px] text-ww-textMuted flex gap-2 flex-wrap">
                <span className="tabular-nums text-ww-textFaint">
                  {new Date(e.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <strong className="text-ww-text">{e.acao}</strong>
                <span>v{e.versao} · {e.por ?? "—"}</span>
                {e.total_entradas != null && (
                  <span className="tabular-nums">
                    {brl(Number(e.total_entradas))} entra · {brl(Number(e.total_saidas ?? 0))} sai · {e.linhas} linha(s)
                  </span>
                )}
                {e.motivo && <em className="text-ww-textFaint">“{e.motivo}”</em>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Secao({
  titulo, dica, total, tom, linhas, onChange, somenteLeitura,
}: {
  titulo: string; dica: string; total: number; tom: "receber" | "pagar";
  linhas: LinhaGrade[]; onChange: (l: LinhaGrade[]) => void; somenteLeitura: boolean;
}) {
  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0">
      <header className="flex items-baseline gap-3 mb-2">
        <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
        <span className={`ml-auto text-[15px] font-bold tabular-nums ${
          tom === "receber" ? "text-emerald-600 dark:text-emerald-300"
                            : "text-rose-600 dark:text-rose-300"}`}>
          {brl(total)}
        </span>
      </header>
      <p className="text-[11px] text-ww-textMuted mb-2">{dica}</p>
      {somenteLeitura ? (
        <p className="text-[11.5px] text-ww-textFaint py-2">
          Você não tem permissão para lançar o fluxo — só leitura.
        </p>
      ) : (
        <GradeEditavel cols={COLS} linhas={linhas} onChange={onChange} altura={300}
          vazioMsg="Digite ou cole do Excel." />
      )}
    </section>
  );
}
