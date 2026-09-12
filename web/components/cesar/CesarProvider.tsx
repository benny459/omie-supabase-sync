"use client";

// O Cesar na tela: um provider global e um painel lateral.
//
// Provider global porque a mesma conversa tem que ser alcançável de dois
// lugares: do botão de um gráfico específico e do botão geral. Se cada gráfico
// tivesse o próprio chat, perguntar "e comparado com julho?" depois de abrir por
// outro gráfico começaria do zero — e é justamente a segunda pergunta que
// importa.
//
// Painel lateral, não modal: a pergunta quase sempre é SOBRE o que está na tela,
// e um modal esconde o gráfico que motivou a pergunta.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Msg = { role: "user" | "assistant"; content: string };
/** Uma consulta que o Cesar fez enquanto pensava. Fica visível: uma resposta
 *  financeira sem dizer de onde veio é uma opinião. */
type Passo = { nome: string; linhas?: number; truncado?: boolean; erro?: string | null };
type Conversa = {
  id: string; titulo: string; origem: string | null;
  criada_em: string; atualizada_em: string;
};

type Ctx = {
  abrir: (opts?: { contexto?: string; pergunta?: string; origem?: string }) => void;
  aberto: boolean;
};
const CesarCtx = createContext<Ctx>({ abrir: () => {}, aberto: false });
export const useCesar = () => useContext(CesarCtx);

/** Resume um gráfico em texto para o Cesar. Mandar o JSON cru gastaria contexto
 *  com chave repetida; uma tabela curta diz o mesmo em menos. */
export function contextoDeGrafico(
  titulo: string, subtitulo: string | undefined,
  rows: Array<Record<string, unknown>>, series: Array<{ key: string; label: string }>,
): string {
  const cab = ["categoria", ...series.map((s) => s.label)].join(" | ");
  const linhas = rows.slice(0, 40).map((r) =>
    [String(r.x ?? ""), ...series.map((s) => {
      const v = r[s.key];
      return v == null ? "" : typeof v === "number" ? v.toFixed(2) : String(v);
    })].join(" | "));
  return [
    `Gráfico: ${titulo}`,
    subtitulo ? `Descrição: ${subtitulo}` : "",
    "",
    cab, ...linhas,
    rows.length > 40 ? `… (${rows.length} linhas no total, 40 mostradas)` : "",
  ].filter(Boolean).join("\n");
}

export default function CesarProvider({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState<string | null>(null);
  /** Painel do histórico aberto por cima da conversa. */
  const [verHistorico, setVerHistorico] = useState(false);
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const contextoRef = useRef<string | undefined>(undefined);
  /** Em qual conversa estamos gravando. Null = a próxima pergunta cria uma. */
  const conversaRef = useRef<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const abrir = useCallback((opts?: { contexto?: string; pergunta?: string; origem?: string }) => {
    if (opts?.contexto) contextoRef.current = opts.contexto;
    setOrigem(opts?.origem ?? null);
    setAberto(true);
    if (opts?.pergunta) setRascunho(opts.pergunta);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, passos, pensando]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !pensando) setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [pensando]);

  const perguntar = useCallback(async (texto: string) => {
    const t = texto.trim();
    if (!t || pensando) return;
    setRascunho("");
    setErro(null);
    setPassos([]);
    const novas: Msg[] = [...msgs, { role: "user", content: t }];
    setMsgs([...novas, { role: "assistant", content: "" }]);
    setPensando(true);

    try {
      const r = await fetch("/api/cesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensagens: novas, contexto: contextoRef.current,
          conversa_id: conversaRef.current, origem,
        }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        setErro(j.error ?? r.statusText);
        setMsgs(novas);
        return;
      }

      const leitor = r.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        // SSE separa eventos por linha em branco; o último pedaço pode estar
        // partido no meio, então volta pro buffer.
        const partes = buffer.split("\n\n");
        buffer = partes.pop() ?? "";
        for (const p of partes) {
          const linha = p.split("\n").find((l) => l.startsWith("data: "));
          if (!linha) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(linha.slice(6)); } catch { continue; }

          if (ev.t === "conversa") {
            // Chega antes da primeira palavra: a partir daqui a próxima
            // pergunta continua ESTA conversa em vez de abrir outra.
            conversaRef.current = (ev.id as string) ?? null;
            setConversas(null);        // a lista ficou velha
          } else if (ev.t === "texto") {
            setMsgs((m) => {
              const c = [...m];
              const u = c[c.length - 1];
              if (u?.role === "assistant") c[c.length - 1] = { ...u, content: u.content + String(ev.v) };
              return c;
            });
          } else if (ev.t === "ferramenta") {
            setPassos((p2) => [...p2, { nome: String(ev.nome) }]);
          } else if (ev.t === "resultado") {
            setPassos((p2) => {
              const c = [...p2];
              const i = c.map((x) => x.nome).lastIndexOf(String(ev.nome));
              if (i >= 0) c[i] = { ...c[i], linhas: Number(ev.linhas), truncado: !!ev.truncado,
                                   erro: (ev.erro as string) ?? null };
              return c;
            });
          } else if (ev.t === "acao") {
            // Ação pro navegador. Hoje só uma: desenhar e baixar o PDF do
            // report. Import dinâmico porque o jsPDF pesa e o painel inteiro
            // não deve pagar por ele — só quem pediu um report.
            const payload = ev.payload as { acao?: string; report?: unknown } | undefined;
            if (payload?.acao === "report_pdf" && payload.report) {
              try {
                const { gerarReportPDF } = await import("@/lib/cesar/report-pdf");
                gerarReportPDF(payload.report as import("@/lib/cesar/report-pdf").ReportPayload);
              } catch (e) {
                setErro(`Não consegui gerar o PDF: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          } else if (ev.t === "erro") {
            setErro(String(ev.v));
          }
        }
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setPensando(false);
    }
  }, [msgs, pensando]);

  const limpar = () => {
    setMsgs([]); setPassos([]); setErro(null);
    contextoRef.current = undefined; conversaRef.current = null;
    setOrigem(null); setVerHistorico(false);
  };

  /** Busca a lista só quando o histórico é aberto, e só se estiver velha —
   *  carregá-la no mount custaria uma consulta em toda visita ao painel para
   *  um recurso que se usa de vez em quando. */
  const abrirHistorico = useCallback(async () => {
    setVerHistorico(true);
    if (conversas) return;
    try {
      const r = await fetch("/api/cesar/conversas", { cache: "no-store" });
      const j = await r.json();
      setConversas(r.ok ? (j.conversas ?? []) : []);
      if (!r.ok) setErro(j.error ?? r.statusText);
    } catch (e) {
      setConversas([]);
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [conversas]);

  const retomar = useCallback(async (c: Conversa) => {
    setVerHistorico(false);
    setErro(null); setPassos([]);
    setMsgs([{ role: "assistant", content: "" }]);   // segura o layout
    try {
      const r = await fetch(`/api/cesar/conversas?id=${c.id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); setMsgs([]); return; }
      setMsgs((j.mensagens as Array<{ papel: string; conteudo: string }>)
        .map((m) => ({ role: m.papel as "user" | "assistant", content: m.conteudo })));
      conversaRef.current = c.id;
      setOrigem(c.origem);
      // O contexto do gráfico NÃO volta: aquele recorte era o da tela naquele
      // dia e hoje os números são outros. Reanexar levaria o Cesar a raciocinar
      // sobre um retrato vencido sem ninguém perceber.
      contextoRef.current = undefined;
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setMsgs([]);
    }
  }, []);

  const apagar = useCallback(async (id: string) => {
    setConversas((cs) => (cs ?? []).filter((c) => c.id !== id));
    if (conversaRef.current === id) { conversaRef.current = null; setMsgs([]); }
    await fetch(`/api/cesar/conversas?id=${id}`, { method: "DELETE" });
  }, []);

  return (
    <CesarCtx.Provider value={{ abrir, aberto }}>
      {children}

      {/* Sem lançador flutuante: a porta do Cesar é o BotaoCesar na barra de
          cima. A pílula que ficava no rodapé era fixa no meio da tela e tapava
          conteúdo — em Projetos, caía em cima da linha do pipeline. */}

      {aberto && (
        <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[min(560px,92vw)]
                          flex flex-col bg-ww-bg border-l border-ww-border shadow-2xl">
          <header className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-ww-border">
            <span aria-hidden className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-500 to-violet-500
                                          text-white text-[12px] font-bold grid place-items-center shrink-0">C</span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ww-text leading-tight">Cesar</div>
              <div className="text-[10.5px] text-ww-textMuted truncate">
                {origem ? `a partir de: ${origem}` : "analista financeiro · lê o seu Omie"}
              </div>
            </div>
            {/* Relógio = histórico. Fica sempre visível, inclusive na conversa
                vazia: é justamente aí que se quer voltar a uma antiga. */}
            <button type="button"
              onClick={() => (verHistorico ? setVerHistorico(false) : void abrirHistorico())}
              aria-pressed={verHistorico}
              title="Conversas anteriores"
              className={`ml-auto w-7 h-7 shrink-0 grid place-items-center rounded-lg border transition ${
                verHistorico
                  ? "border-ww-accent/70 text-ww-accent bg-ww-accent/15"
                  : "border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
              <Relogio />
            </button>
            {msgs.length > 0 && (
              <button type="button" onClick={limpar} disabled={pensando}
                className="px-2 py-0.5 text-[10.5px] shrink-0 rounded border border-ww-border text-ww-textMuted
                           hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
                Nova
              </button>
            )}
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
              className="w-7 h-7 shrink-0 rounded-lg border border-ww-border
                         text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition">
              ✕
            </button>
          </header>

          {verHistorico && (
            <Historico
              conversas={conversas}
              atual={conversaRef.current}
              onAbrir={(c) => void retomar(c)}
              onApagar={(id) => void apagar(id)}
              onNova={limpar}
            />
          )}

          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
            {msgs.length === 0 && <Vazio onEscolher={(q) => void perguntar(q)} temContexto={!!contextoRef.current} />}

            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-ww-accent/15
                                  border border-ww-accent/30 text-[12.5px] text-ww-text whitespace-pre-wrap">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-ww-text cesar-md">
                    {m.content
                      ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      : pensando && <Pensando passos={passos} />}
                  </div>
                )}
              </div>
            ))}

            {/* Passos aparecem acima do texto enquanto ele não começou, e ficam
                embaixo depois — para não empurrar a resposta enquanto se lê. */}
            {pensando && msgs[msgs.length - 1]?.content && passos.length > 0 && (
              <Passos passos={passos} />
            )}

            {erro && (
              <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10
                              text-[11.5px] text-rose-700 dark:text-rose-300">
                <strong>Erro:</strong> {erro}
              </div>
            )}
            <div ref={fimRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void perguntar(rascunho); }}
            className="border-t border-ww-border p-2.5 flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                // Enter envia, Shift+Enter quebra linha — a convenção de chat.
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void perguntar(rascunho); }
              }}
              rows={2}
              placeholder="Pergunte sobre caixa, recebíveis, margem, despesa…"
              className="flex-1 resize-none text-[12.5px] bg-ww-panel border border-ww-border rounded-lg
                         px-2.5 py-2 text-ww-text placeholder:text-ww-textFaint focus:outline-none
                         focus:border-ww-accent/60"
            />
            <button
              type="submit" disabled={pensando || !rascunho.trim()}
              className="shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold bg-ww-accent text-white
                         disabled:opacity-35 disabled:cursor-not-allowed hover:brightness-110 transition"
            >
              {pensando ? "…" : "Enviar"}
            </button>
          </form>
        </aside>
      )}
    </CesarCtx.Provider>
  );
}

/** Relógio com a seta de retorno — o desenho universal de "voltar no tempo".
 *  Um relógio liso diria "agendar"; a seta é o que muda o verbo. */
const Relogio = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/** Quanto tempo faz, em português curto. Data absoluta obriga a calcular; "há
 *  2 h" responde "foi hoje?" na hora, que é a pergunta de quem procura. */
function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1)     return "agora";
  if (min < 60)    return `há ${min} min`;
  if (min < 24*60) return `há ${Math.round(min/60)} h`;
  const d = Math.round(min / (24*60));
  if (d === 1)  return "ontem";
  if (d < 30)   return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function Historico({
  conversas, atual, onAbrir, onApagar, onNova,
}: {
  conversas: Conversa[] | null;
  atual: string | null;
  onAbrir: (c: Conversa) => void;
  onApagar: (id: string) => void;
  onNova: () => void;
}) {
  return (
    <div className="border-b border-ww-border bg-ww-panel/60 max-h-[46vh] overflow-y-auto">
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1">
        <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
          Conversas anteriores
        </span>
        <button type="button" onClick={onNova}
          className="ml-auto text-[10.5px] text-ww-accent hover:underline">
          + começar do zero
        </button>
      </div>

      {conversas == null && (
        <p className="px-3.5 py-3 text-[11.5px] text-ww-textFaint">carregando…</p>
      )}
      {conversas?.length === 0 && (
        <p className="px-3.5 py-3 text-[11.5px] text-ww-textFaint">
          Nenhuma conversa ainda. A primeira pergunta já fica guardada aqui.
        </p>
      )}

      <ul className="pb-2">
        {(conversas ?? []).map((c) => (
          <li key={c.id} className="group/conv flex items-start gap-2 px-3.5 py-1.5 hover:bg-ww-rowHover transition-colors">
            <button type="button" onClick={() => onAbrir(c)}
              className="min-w-0 flex-1 text-left">
              <div className={`text-[12px] truncate ${
                c.id === atual ? "text-ww-accent font-semibold" : "text-ww-text"}`}>
                {c.titulo}
              </div>
              <div className="text-[10px] text-ww-textFaint truncate">
                {quando(c.atualizada_em)}
                {c.origem ? ` · ${c.origem}` : ""}
                {c.id === atual ? " · aberta" : ""}
              </div>
            </button>
            {/* Aparece no hover: apagar não pode ser um alvo permanente ao lado
                de cada linha que se quer clicar pra abrir. */}
            <button type="button" onClick={() => onApagar(c.id)}
              title="Apagar esta conversa"
              className="shrink-0 mt-0.5 px-1.5 text-[11px] rounded text-ww-textFaint opacity-0
                         group-hover/conv:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROTULO: Record<string, string> = {
  saldo_por_conta: "saldos em conta",
  fluxo_realizado: "caixa realizado",
  fluxo_titulos: "títulos da curva",
  titulos_resumo: "totais em aberto",
  titulos_aging: "idade do atraso",
  titulos_horizonte: "horizonte do saldo",
  titulos_mensal: "emitido × liquidado",
  top_contrapartes: "maiores contrapartes",
  em_atraso: "quem está em atraso",
  titulos_detalhe: "títulos linha a linha",
  faturamento_resumo: "resumo do faturamento",
  faturamento_mensal_categoria: "faturamento por tipo",
  coorte_faturamento: "coorte de faturamento",
  coorte_por_tipo_venda: "coorte por tipo de venda",
  coorte_detalhe: "detalhe da coorte",
  maiores_faturamentos: "maiores faturamentos",
  prazos_faturamento: "prazos praticados",
  dre: "DRE",
  dre_despesas: "despesas por categoria",
  dre_despesas_detalhe: "despesas linha a linha",
  previsto_realizado_mensal: "previsto × realizado",
  ciclo_financeiro: "ciclo financeiro",
  margem_total: "margem consolidada",
  margem_por_venda: "margem por venda",
  margem_por_projeto: "margem por projeto",
  cobertura_custo_projeto: "cobertura de custo",
  rentabilidade_cliente: "rentabilidade por cliente",
  vendas_resumo: "resumo de vendas",
  compras_mensal: "compras por mês",
  compras_por_grupo: "compras por grupo",
  criar_ticket: "abrindo o chamado",
  consultar_ticket: "consultando seus chamados",
  gerar_report_pdf: "montando o PDF do report",
  salvar_report: "incorporando o report ao controle",
};

function Passos({ passos }: { passos: Passo[] }) {
  return (
    <ul className="space-y-0.5 pt-1">
      {passos.map((p, i) => (
        <li key={i} className="flex items-center gap-1.5 text-[10.5px] text-ww-textFaint">
          <span aria-hidden className={p.erro ? "text-rose-500" : p.linhas != null ? "text-emerald-500" : ""}>
            {p.erro ? "✕" : p.linhas != null ? "✓" : "○"}
          </span>
          <span>{ROTULO[p.nome] ?? p.nome}</span>
          {p.linhas != null && !p.erro && (
            <span className="tabular-nums">· {p.linhas} linha{p.linhas === 1 ? "" : "s"}
              {p.truncado ? " (amostra)" : ""}</span>
          )}
          {p.erro && <span className="text-rose-500 truncate">· {p.erro}</span>}
        </li>
      ))}
    </ul>
  );
}

function Pensando({ passos }: { passos: Passo[] }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11.5px] text-ww-textMuted">
        <span className="inline-flex gap-0.5">
          <Ponto d={0} /><Ponto d={150} /><Ponto d={300} />
        </span>
        {passos.length ? "consultando…" : "pensando…"}
      </div>
      {passos.length > 0 && <Passos passos={passos} />}
    </div>
  );
}

const Ponto = ({ d }: { d: number }) => (
  <span aria-hidden className="w-1 h-1 rounded-full bg-ww-textFaint animate-pulse"
        style={{ animationDelay: `${d}ms` }} />
);

function Vazio({ onEscolher, temContexto }: { onEscolher: (q: string) => void; temContexto: boolean }) {
  const sugestoes = temContexto
    ? ["O que mais chama atenção neste gráfico?",
       "Isso está melhor ou pior que nos meses anteriores?",
       "Quem são os nomes por trás desses números?"]
    : ["Como está meu caixa nos próximos 30 dias?",
       "Quem me deve e há quanto tempo?",
       "Onde eu mais gastei este ano?",
       "Que tipo de venda demora mais pra receber?"];
  return (
    <div className="space-y-2.5 pt-1">
      <p className="text-[12px] text-ww-textMuted leading-relaxed">
        Sou o Cesar. Leio o seu financeiro pelas mesmas funções que alimentam este
        painel — então o número que eu der é o que está na tela. Não escrevo
        consulta nova nem estimo o que não sei; quando faltar dado, eu digo.
      </p>
      <div className="flex flex-col gap-1.5">
        {sugestoes.map((s) => (
          <button key={s} type="button" onClick={() => onEscolher(s)}
            className="text-left text-[12px] px-2.5 py-1.5 rounded-lg border border-ww-border
                       text-ww-textMuted hover:text-ww-text hover:border-ww-accent/50
                       hover:bg-ww-rowHover transition">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
