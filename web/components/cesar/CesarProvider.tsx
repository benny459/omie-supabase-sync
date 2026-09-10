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
  const contextoRef = useRef<string | undefined>(undefined);
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
        body: JSON.stringify({ mensagens: novas, contexto: contextoRef.current }),
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

          if (ev.t === "texto") {
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

  const limpar = () => { setMsgs([]); setPassos([]); setErro(null); contextoRef.current = undefined; setOrigem(null); };

  return (
    <CesarCtx.Provider value={{ abrir, aberto }}>
      {children}

      {/* Lançador flutuante. Só aparece com o painel fechado. */}
      {!aberto && (
        <button
          type="button" onClick={() => abrir()}
          title="Cesar — analista financeiro. Pergunte qualquer coisa sobre caixa, recebíveis, margem ou despesa."
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-2
                     pl-3 pr-4 py-2 rounded-full border border-ww-border bg-ww-panel/95 backdrop-blur
                     shadow-lg text-[12px] text-ww-text hover:border-ww-accent/60 hover:shadow-xl transition-all"
        >
          <span aria-hidden className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-500 to-violet-500
                                       text-white text-[11px] font-bold grid place-items-center">C</span>
          Perguntar ao <strong className="font-semibold">Cesar</strong>
        </button>
      )}

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
            {msgs.length > 0 && (
              <button type="button" onClick={limpar} disabled={pensando}
                className="ml-auto px-2 py-0.5 text-[10.5px] rounded border border-ww-border text-ww-textMuted
                           hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
                Nova conversa
              </button>
            )}
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
              className={`${msgs.length ? "" : "ml-auto"} w-7 h-7 shrink-0 rounded-lg border border-ww-border
                          text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition`}>
              ✕
            </button>
          </header>

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
